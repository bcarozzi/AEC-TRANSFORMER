// Parametric 3D scene description for a three-phase two-winding transformer.
//
// Output is plain JSON (millimetres, Y up, X along the limb row, Z across):
// a list of parts, each with a centre `position`, an axis-aligned `size`
// (its bounding box) and a `shape` the viewer knows how to build. The server
// never touches WebGL; the browser turns this into meshes (public/model3d.js).
//
// Dimensions come from src/dimensionRules.js and src/bomRules.js, which are
// PLACEHOLDERS: the model is indicative, not a manufacturing drawing.

const rules = require('./dimensionRules');
const bomRules = require('./bomRules');

const WHEEL_RADIUS = 60;
const CHANNEL_HEIGHT = 40;
const TANK_BOTTOM_Y = 160; // underside of the tank, above wheels and channels
const FLOOR_CLEARANCE = 40; // under the bottom yoke
const COVER_THICKNESS = 8;
const COVER_OVERHANG = 20;
const DRY_BASE_HEIGHT = 80;

const r1 = (v) => Math.round(v * 10) / 10;
const rv = (a) => a.map(r1);

function boxPart(id, name, layer, group, position, size, material) {
  return { id, name, layer, group, shape: 'box', material, position: rv(position), size: rv(size) };
}

function cylinderPart(id, name, layer, group, position, radius, height, axis, material) {
  const size = axis === 'y' ? [2 * radius, height, 2 * radius] : axis === 'x' ? [height, 2 * radius, 2 * radius] : [2 * radius, 2 * radius, height];
  return { id, name, layer, group, shape: 'cylinder', axis, radius: r1(radius), height: r1(height), material, position: rv(position), size: rv(size) };
}

function tubePart(id, name, layer, group, position, innerRadius, outerRadius, height, material) {
  return {
    id, name, layer, group, shape: 'tube', innerRadius: r1(innerRadius), outerRadius: r1(outerRadius), height: r1(height),
    material, position: rv(position), size: rv([2 * outerRadius, height, 2 * outerRadius]),
  };
}

function bushingPart(id, name, group, position, radius, height) {
  return {
    id, name, layer: 'terminals', group, shape: 'bushing', radius: r1(radius), height: r1(height), sheds: Math.max(2, Math.round(height / 32)),
    material: 'porcelain', position: rv(position), size: rv([2 * radius, height, 2 * radius]),
  };
}

function aabb(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  parts.forEach((p) => {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i], p.position[i] - p.size[i] / 2);
      max[i] = Math.max(max[i], p.position[i] + p.size[i] / 2);
    }
  });
  return { min: rv(min), max: rv(max) };
}

const PHASES = ['U', 'V', 'W'];

function buildModel(spec, derived) {
  const isOil = spec.type === 'oil';
  const vg = derived.vectorGroup;
  const kva = spec.ratedPowerKva;
  const parts = [];

  // --- active part ---
  const d = rules.coreDiameterMm(kva);
  const windowH = rules.windowHeightMm(d);
  const yokeH = rules.yokeHeightMm(d);
  const lvIn = d / 2 + rules.CORE_TO_LV_GAP_MM;
  const lvOut = lvIn + rules.LV_RADIAL * d;
  const hvIn = lvOut + rules.DUCT_RADIAL * d;
  const hvOut = hvIn + rules.HV_RADIAL * d;
  const pitch = 2 * hvOut + 0.08 * d + 20;
  const lvH = windowH - 2 * rules.END_INSULATION_MM;
  const hvH = lvH - 20;
  const coreLen = 2 * pitch + d;
  const coreH = windowH + 2 * yokeH;
  const activeLen = 2 * pitch + 2 * hvOut;
  const limbX = [-pitch, 0, pitch];

  const umHv = derived.umHvKv;
  const umLv = derived.umLvKv;

  // --- vertical layout ---
  let tankInner = null;
  let tankOuter = null;
  let wallT = 0;
  let coverTop = 0;
  let bodyH = 0;
  let activeBottom;

  if (isOil) {
    wallT = rules.wallThicknessMm(kva);
    activeBottom = TANK_BOTTOM_Y + wallT + FLOOR_CLEARANCE;
    const c = rules.clearanceMm(umHv);
    const innerLen = activeLen + 2 * c;
    const innerWid = 2 * hvOut + 2 * c + 60;
    const innerH = FLOOR_CLEARANCE + coreH + rules.spaceAboveMm(umHv);
    bodyH = innerH + wallT;
    tankInner = { length: r1(innerLen), width: r1(innerWid), height: r1(innerH), bottomY: r1(TANK_BOTTOM_Y + wallT) };
    tankOuter = { length: r1(innerLen + 2 * wallT), width: r1(innerWid + 2 * wallT), height: r1(bodyH) };
    coverTop = TANK_BOTTOM_Y + bodyH + COVER_THICKNESS;
  } else {
    activeBottom = DRY_BASE_HEIGHT;
  }

  const windowCentreY = activeBottom + yokeH + windowH / 2;

  parts.push(boxPart('core-yoke-bottom', 'Core yoke (bottom)', 'active', 'core', [0, activeBottom + yokeH / 2, 0], [coreLen, yokeH, d], 'core'));
  parts.push(boxPart('core-yoke-top', 'Core yoke (top)', 'active', 'core', [0, activeBottom + yokeH + windowH + yokeH / 2, 0], [coreLen, yokeH, d], 'core'));
  limbX.forEach((x, i) => {
    parts.push(cylinderPart(`core-limb-${PHASES[i]}`, `Core limb ${PHASES[i]}`, 'active', 'core', [x, windowCentreY, 0], d / 2, windowH, 'y', 'core'));
    parts.push(tubePart(`winding-lv-${PHASES[i]}`, `LV winding ${PHASES[i]}`, 'active', 'winding-lv', [x, windowCentreY, 0], lvIn, lvOut, lvH, 'winding-lv'));
    parts.push(tubePart(`winding-hv-${PHASES[i]}`, `HV winding ${PHASES[i]}`, 'active', 'winding-hv', [x, windowCentreY, 0], hvIn, hvOut, hvH, 'winding-hv'));
  });

  if (isOil) {
    buildOilExterior();
  } else {
    buildDryExterior();
  }

  function buildOilExterior() {
    const L = tankOuter.length;
    const W = tankOuter.width;
    const bodyCentreY = TANK_BOTTOM_Y + bodyH / 2;
    const sealing = spec.sealing ?? bomRules.defaultSealing(spec);

    parts.push(boxPart('tank-body', 'Tank', 'tank', 'tank', [0, bodyCentreY, 0], [L, bodyH, W], 'tank'));
    parts.push(boxPart('tank-cover', 'Tank cover', 'tank', 'tank', [0, TANK_BOTTOM_Y + bodyH + COVER_THICKNESS / 2, 0], [L + 2 * COVER_OVERHANG, COVER_THICKNESS, W + 2 * COVER_OVERHANG], 'cover'));

    // Base: two channels, four wheels.
    const wheelX = L / 2 - 140;
    const wheelZ = W / 2 - 80;
    [-1, 1].forEach((sz) => {
      parts.push(boxPart(`base-channel-${sz < 0 ? 'rear' : 'front'}`, 'Base channel', 'accessories', 'base', [0, TANK_BOTTOM_Y - CHANNEL_HEIGHT / 2, sz * wheelZ], [L, CHANNEL_HEIGHT, 90], 'steel'));
      [-1, 1].forEach((sx) => {
        parts.push(cylinderPart(`wheel-${sx < 0 ? 'l' : 'r'}-${sz < 0 ? 'rear' : 'front'}`, 'Roller', 'accessories', 'base', [sx * wheelX, WHEEL_RADIUS, sz * wheelZ], WHEEL_RADIUS, 40, 'z', 'steel'));
      });
    });

    // Bushings: HV row at -z, LV row at +z, over the limbs. Neutrals toward +x.
    const zOff = tankInner.width / 4;
    const xNeutral = pitch + (tankInner.length / 2 - pitch) * 0.55;
    const hvH2 = rules.bushingHeightMm(umHv);
    const hvR = rules.bushingRadiusMm(umHv);
    const lvH2 = rules.bushingHeightMm(umLv);
    const lvR = rules.bushingRadiusMm(umLv);
    limbX.forEach((x, i) => {
      parts.push(bushingPart(`bushing-hv-${PHASES[i]}`, `HV bushing 1${PHASES[i]}`, 'bushing-hv', [x, coverTop + hvH2 / 2, -zOff], hvR, hvH2));
      parts.push(bushingPart(`bushing-lv-${PHASES[i]}`, `LV bushing 2${PHASES[i].toLowerCase()}`, 'bushing-lv', [x, coverTop + lvH2 / 2, zOff], lvR, lvH2));
    });
    if (vg.hv.neutral) parts.push(bushingPart('bushing-hv-N', 'HV neutral bushing 1N', 'bushing-hv', [xNeutral, coverTop + hvH2 / 2, -zOff], hvR, hvH2));
    if (vg.lv.neutral) parts.push(bushingPart('bushing-lv-N', 'LV neutral bushing 2n', 'bushing-lv', [xNeutral, coverTop + lvH2 / 2, zOff], lvR, lvH2));

    // Cooling and oil preservation.
    if (sealing === 'hermetic') {
      const finH = bodyH * 0.7;
      const finDepth = 90;
      [-1, 1].forEach((sz) => {
        parts.push({
          id: `fins-${sz < 0 ? 'rear' : 'front'}`, name: 'Corrugated fins', layer: 'cooling', group: 'cooling', shape: 'fins', material: 'tank',
          pitch: 45, thickness: 2,
          position: rv([0, TANK_BOTTOM_Y + bodyH * 0.45, sz * (W / 2 + finDepth / 2)]), size: rv([L - 80, finH, finDepth]),
        });
      });
    } else {
      const n = bomRules.radiatorPanels(spec);
      const sides = [Math.ceil(n / 2), Math.floor(n / 2)];
      const panelH = bodyH * 0.75;
      const panelPitch = Math.max(55, Math.min(70, (L - 100) / Math.max(sides[0], 1)));
      [-1, 1].forEach((sz, si) => {
        const k = sides[si];
        if (!k) return;
        for (let i = 0; i < k; i += 1) {
          const x = (i - (k - 1) / 2) * panelPitch;
          parts.push(boxPart(`radiator-${sz < 0 ? 'rear' : 'front'}-${i + 1}`, 'Radiator panel', 'cooling', 'cooling', [x, TANK_BOTTOM_Y + bodyH * 0.5, sz * (W / 2 + 80 + 260)], [45, panelH, 520], 'tank'));
        }
        const rowLen = (k - 1) * panelPitch + 45;
        [-1, 1].forEach((sy) => {
          parts.push(boxPart(`radiator-header-${sz < 0 ? 'rear' : 'front'}-${sy < 0 ? 'bottom' : 'top'}`, 'Radiator header', 'cooling', 'cooling', [0, TANK_BOTTOM_Y + bodyH * 0.5 + sy * (panelH / 2 - 20), sz * (W / 2 + 40)], [rowLen, 40, 80], 'steel'));
        });
      });

      // Conservator above the bushings, fed through a Buchholz relay.
      const oilLitres = bomRules.estimateMasses(spec).oilLitres;
      const conservatorLen = 0.7 * L;
      const conservatorR = Math.sqrt((0.1 * oilLitres * 1e6) / (Math.PI * conservatorLen));
      const conservatorY = coverTop + hvH2 + conservatorR + 60;
      const pipeX = -tankInner.length / 4;
      parts.push(cylinderPart('conservator', 'Conservator', 'accessories', 'conservator', [0, conservatorY, 0], conservatorR, conservatorLen, 'x', 'tank'));
      [-1, 1].forEach((sx) => {
        const legH = conservatorY - conservatorR - coverTop;
        parts.push(boxPart(`conservator-leg-${sx < 0 ? 'l' : 'r'}`, 'Conservator support', 'accessories', 'conservator', [sx * conservatorLen * 0.38, coverTop + legH / 2, 0], [40, legH, 40], 'steel'));
      });
      const pipeH = conservatorY - conservatorR - coverTop;
      parts.push(cylinderPart('buchholz-pipe', 'Conservator pipe', 'accessories', 'conservator', [pipeX, coverTop + pipeH / 2, 0], 25, pipeH, 'y', 'steel'));
      parts.push(cylinderPart('buchholz-relay', 'Buchholz relay', 'accessories', 'conservator', [pipeX, coverTop + pipeH / 2, 0], 55, 150, 'x', 'accessory'));
    }

    // Accessories.
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      parts.push(boxPart(`lifting-lug-${sx < 0 ? 'l' : 'r'}-${sz < 0 ? 'rear' : 'front'}`, 'Lifting lug', 'accessories', 'accessory', [sx * (L / 2 - 40), coverTop + 30, sz * (W / 2 - 40)], [12, 60, 50], 'steel'));
    }));
    parts.push(boxPart('nameplate', 'Rating plate', 'accessories', 'accessory', [L / 2 + 1.5, TANK_BOTTOM_Y + bodyH * 0.6, zOff], [3, 120, 170], 'accessory'));
    parts.push(cylinderPart('drain-valve', 'Drain valve', 'accessories', 'accessory', [-L / 2 - 45, TANK_BOTTOM_Y + 80, 0], 22, 90, 'x', 'accessory'));
    parts.push(cylinderPart('pressure-relief', 'Pressure relief device', 'accessories', 'accessory', [-(tankInner.length / 2 - 130), coverTop + 40, 0], 55, 80, 'y', 'accessory'));
    if (spec.tapType === 'OCTC') {
      parts.push(cylinderPart('tap-switch-handle', 'Off-circuit tap switch handle', 'accessories', 'accessory', [pitch / 2, coverTop + 50, 0], 28, 100, 'y', 'accessory'));
    } else if (spec.tapType === 'OLTC') {
      parts.push(cylinderPart('oltc-head', 'On-load tap changer head', 'accessories', 'accessory', [pitch / 2, coverTop + 85, 0], 90, 170, 'y', 'accessory'));
      parts.push(boxPart('oltc-drive', 'Motor drive', 'accessories', 'accessory', [L / 2 + 110, TANK_BOTTOM_Y + bodyH * 0.5, -zOff], [220, 420, 300], 'accessory'));
    }
    if (spec.cooling === 'ONAF') {
      [-1, 1].forEach((sz) => {
        parts.push(cylinderPart(`fan-${sz < 0 ? 'rear' : 'front'}`, 'Cooling fan', 'cooling', 'cooling', [0, TANK_BOTTOM_Y + bodyH * 0.2, sz * (W / 2 + 400)], 160, 60, 'z', 'accessory'));
      });
    }
  }

  function buildDryExterior() {
    // Base rails and clamps; terminals above the top yoke, HV at -z, LV at +z.
    [-1, 1].forEach((sz) => {
      parts.push(boxPart(`base-rail-${sz < 0 ? 'rear' : 'front'}`, 'Base rail', 'accessories', 'base', [0, DRY_BASE_HEIGHT / 2, sz * (d / 2)], [coreLen + 80, DRY_BASE_HEIGHT, 60], 'steel'));
    });
    parts.push(boxPart('clamp-top', 'Top clamp', 'active', 'core', [0, activeBottom + 2 * yokeH + windowH + 10, 0], [coreLen + 40, 20, d + 40], 'steel'));
    parts.push(boxPart('clamp-bottom', 'Bottom clamp', 'active', 'core', [0, activeBottom - 10, 0], [coreLen + 40, 20, d + 40], 'steel'));
    const top = activeBottom + 2 * yokeH + windowH + 20;
    const postR = rules.bushingRadiusMm(umHv) / 2 + 10;
    const lvPostR = rules.bushingRadiusMm(umLv) / 2 + 10;
    limbX.forEach((x, i) => {
      parts.push(cylinderPart(`terminal-hv-${PHASES[i]}`, `HV terminal 1${PHASES[i]}`, 'terminals', 'bushing-hv', [x, top + 35, -d / 4], postR, 70, 'y', 'accessory'));
      parts.push(cylinderPart(`terminal-lv-${PHASES[i]}`, `LV terminal 2${PHASES[i].toLowerCase()}`, 'terminals', 'bushing-lv', [x, top + 35, d / 4], lvPostR, 70, 'y', 'accessory'));
    });
    const xN = pitch + (hvOut + d / 2) * 0.5;
    if (vg.hv.neutral) parts.push(cylinderPart('terminal-hv-N', 'HV neutral terminal 1N', 'terminals', 'bushing-hv', [xN, top + 35, -d / 4], postR, 70, 'y', 'accessory'));
    if (vg.lv.neutral) parts.push(cylinderPart('terminal-lv-N', 'LV neutral terminal 2n', 'terminals', 'bushing-lv', [xN, top + 35, d / 4], lvPostR, 70, 'y', 'accessory'));
    parts.push(boxPart('nameplate', 'Rating plate', 'accessories', 'accessory', [coreLen / 2 + 22, activeBottom + yokeH + windowH / 2, 0], [3, 120, 170], 'accessory'));
    if (spec.cooling === 'AF') {
      [-1, 1].forEach((sz) => {
        parts.push(cylinderPart(`fan-${sz < 0 ? 'rear' : 'front'}`, 'Cooling fan', 'cooling', 'cooling', [0, DRY_BASE_HEIGHT + 120, sz * (d / 2 + 160)], 120, 60, 'z', 'accessory'));
      });
    }
  }

  const bounds = aabb(parts);
  const round10 = (v) => Math.round(v / 10) * 10;
  const layers = {};
  parts.forEach((p) => { layers[p.layer] = (layers[p.layer] || 0) + 1; });

  return {
    units: 'mm',
    estimate: true,
    notice: 'Indicative model from placeholder dimension rules (src/dimensionRules.js). Not a manufacturing drawing.',
    parts,
    bounds,
    overall: {
      lengthMm: round10(bounds.max[0] - bounds.min[0]),
      widthMm: round10(bounds.max[2] - bounds.min[2]),
      heightMm: round10(bounds.max[1] - bounds.min[1]),
    },
    meta: {
      type: spec.type,
      coreDiameterMm: r1(d),
      windowHeightMm: r1(windowH),
      phasePitchMm: r1(pitch),
      winding: { lvInnerMm: r1(lvIn), lvOuterMm: r1(lvOut), hvInnerMm: r1(hvIn), hvOuterMm: r1(hvOut) },
      tankInner,
      tankOuter,
      coverTopMm: r1(coverTop),
      layers,
    },
  };
}

module.exports = { buildModel, aabb };
