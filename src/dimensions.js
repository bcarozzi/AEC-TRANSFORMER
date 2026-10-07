// Merges the engineer's as-designed values with the placeholder rules.
//
// Every optional "designed" field in the spec (see src/fields.js) replaces the
// rule for that one item; anything left blank keeps its estimate. Each resolved
// value carries its source ("designed" or "estimate") so the BOM, the 3D model
// and the UI can say which numbers are real. Also checks that the designed
// numbers are physically consistent with each other.

const rules = require('./dimensionRules');
const bomRules = require('./bomRules');
const { FIELDS } = require('./fields');

// Sanity limits (not design rules): below these the geometry is impossible.
const MIN_RADIAL_GAP_MM = 3; // core to LV, LV to HV, each side
const MIN_PHASE_GAP_MM = 10; // between neighbouring HV windings
const MIN_TANK_CLEARANCE_MM = 20; // active part to tank wall, each side
const MIN_SPACE_ABOVE_MM = 60; // above the top yoke
const OIL_DENSITY_KG_PER_L = 0.88;

const CORE_WINDING_KEYS = ['coreDiameterMm', 'windowHeightMm', 'phasePitchMm', 'lvInnerDiameterMm', 'lvOuterDiameterMm', 'hvInnerDiameterMm', 'hvOuterDiameterMm', 'lvHeightMm', 'hvHeightMm'];
const TANK_KEYS = ['tankLengthMm', 'tankWidthMm', 'tankHeightMm'];

const r1 = (v) => Math.round(v * 10) / 10;

// Oil preservation: explicit choice, else implied by a given radiator count, else by rating.
function resolveSealing(spec) {
  if (spec.type !== 'oil') return { value: null, source: 'n/a' };
  if (spec.sealing) return { value: spec.sealing, source: 'specified' };
  if (spec.radiatorPanels) return { value: 'conservator', source: 'radiators' };
  return { value: bomRules.defaultSealing(spec), source: 'rating' };
}

function resolveRadiators(spec) {
  return spec.radiatorPanels !== undefined
    ? { count: spec.radiatorPanels, source: 'designed' }
    : { count: bomRules.radiatorPanels(spec), source: 'estimate' };
}

function resolveDimensions(spec, umHvKv) {
  const isOil = spec.type === 'oil';
  const kva = spec.ratedPowerKva;
  const values = {};
  const sources = {};
  const take = (key, estimate) => {
    if (spec[key] !== undefined) {
      values[key] = spec[key];
      sources[key] = 'designed';
    } else {
      values[key] = estimate();
      sources[key] = 'estimate';
    }
    return values[key];
  };

  // Each estimate builds on the values already resolved, so one real number
  // (say the core diameter) pulls its neighbours with it.
  const d = take('coreDiameterMm', () => rules.coreDiameterMm(kva));
  const windowH = take('windowHeightMm', () => rules.windowHeightMm(d));
  const lvInD = take('lvInnerDiameterMm', () => d + 2 * rules.CORE_TO_LV_GAP_MM);
  const lvOutD = take('lvOuterDiameterMm', () => lvInD + 2 * rules.LV_RADIAL * d);
  const hvInD = take('hvInnerDiameterMm', () => lvOutD + 2 * rules.DUCT_RADIAL * d);
  const hvOutD = take('hvOuterDiameterMm', () => hvInD + 2 * rules.HV_RADIAL * d);
  const pitch = take('phasePitchMm', () => hvOutD + 0.08 * d + 20);
  const lvH = take('lvHeightMm', () => windowH - 2 * rules.END_INSULATION_MM);
  take('hvHeightMm', () => lvH - 20);

  const yokeH = rules.yokeHeightMm(d);
  const geo = {
    coreLengthMm: 2 * pitch + d,
    yokeHeightMm: yokeH,
    coreHeightMm: windowH + 2 * yokeH,
    activeLengthMm: 2 * pitch + hvOutD,
    activeWidthMm: Math.max(d, hvOutD),
    inner: null,
    wallMm: 0,
    clearanceMm: 0,
  };

  if (isOil) {
    const wall = rules.wallThicknessMm(kva);
    const c = rules.clearanceMm(umHvKv);
    geo.wallMm = wall;
    geo.clearanceMm = c;
    const length = take('tankLengthMm', () => geo.activeLengthMm + 2 * c + 2 * wall);
    const width = take('tankWidthMm', () => hvOutD + 2 * c + 60 + 2 * wall);
    const height = take('tankHeightMm', () => rules.FLOOR_CLEARANCE_MM + geo.coreHeightMm + rules.spaceAboveMm(umHvKv) + wall);
    geo.inner = { lengthMm: length - 2 * wall, widthMm: width - 2 * wall, heightMm: height - wall };
  }

  const keys = isOil ? [...CORE_WINDING_KEYS, ...TANK_KEYS] : CORE_WINDING_KEYS;
  const designed = keys.filter((k) => sources[k] === 'designed').length;
  return { values, sources, geo, completeness: { designed, total: keys.length } };
}

function resolveMasses(spec) {
  const est = bomRules.estimateMasses(spec);
  const isOil = spec.type === 'oil';
  const values = {};
  const sources = {};
  const take = (key, specKey, estimate) => {
    values[key] = spec[specKey] ?? estimate;
    sources[key] = spec[specKey] !== undefined ? 'designed' : 'estimate';
  };
  take('coreKg', 'coreMassKg', est.coreKg);
  take('hvConductorKg', 'hvConductorMassKg', est.hvConductorKg);
  take('lvConductorKg', 'lvConductorMassKg', est.lvConductorKg);
  take('insulationKg', 'insulationMassKg', est.insulationKg);
  if (isOil) {
    take('oilLitres', 'oilLitres', est.oilLitres);
    take('tankKg', 'tankMassKg', est.tankKg);
  }
  // Fittings are not itemised, so an estimated total is never below the sum of its parts.
  const parts = values.coreKg + values.hvConductorKg + values.lvConductorKg + values.insulationKg
    + (isOil ? values.oilLitres * OIL_DENSITY_KG_PER_L + values.tankKg : 0);
  values.totalKg = spec.totalMassKg ?? Math.max(est.totalKg, Math.round(parts));
  sources.totalKg = spec.totalMassKg !== undefined ? 'designed' : 'estimate';
  return { values, sources, partsKg: parts, estimated: est };
}

// --- consistency of the designed numbers ---

function validateDesignData(spec, umHvKv) {
  const errors = [];
  const warnings = [];
  const label = (key) => FIELDS.find((f) => f.key === key).label;
  const isOil = spec.type === 'oil';

  // Fields that only make sense for oil-immersed units.
  FIELDS.filter((f) => f.oilOnly && spec[f.key] !== undefined && !isOil).forEach((f) => {
    errors.push({ field: f.key, message: `${f.label} applies to oil-immersed transformers only` });
  });
  if (spec.radiatorPanels !== undefined && spec.sealing === 'hermetic') {
    errors.push({ field: 'radiatorPanels', message: 'Radiator panels need a conservator-type unit; a hermetic tank uses corrugated fins' });
  }
  if (errors.length) return { errors, warnings };

  const dims = resolveDimensions(spec, umHvKv);
  const v = dims.values;
  const designed = (key) => spec[key] !== undefined;
  // Blame a designed field if one is involved; if everything is estimated the rules are consistent by construction.
  const fail = (involved, message) => {
    const field = involved.find(designed);
    if (field) errors.push({ field, message });
  };

  if (v.lvInnerDiameterMm < v.coreDiameterMm + 2 * MIN_RADIAL_GAP_MM) {
    fail(['lvInnerDiameterMm', 'coreDiameterMm'], `${label('lvInnerDiameterMm')} (${r1(v.lvInnerDiameterMm)} mm) must be at least the core diameter + ${2 * MIN_RADIAL_GAP_MM} mm (${r1(v.coreDiameterMm + 2 * MIN_RADIAL_GAP_MM)} mm)`);
  }
  if (v.lvOuterDiameterMm <= v.lvInnerDiameterMm) {
    fail(['lvOuterDiameterMm', 'lvInnerDiameterMm'], `${label('lvOuterDiameterMm')} (${r1(v.lvOuterDiameterMm)} mm) must be larger than the LV inner diameter (${r1(v.lvInnerDiameterMm)} mm)`);
  }
  if (v.hvInnerDiameterMm < v.lvOuterDiameterMm + 2 * MIN_RADIAL_GAP_MM) {
    fail(['hvInnerDiameterMm', 'lvOuterDiameterMm'], `${label('hvInnerDiameterMm')} (${r1(v.hvInnerDiameterMm)} mm) must be at least the LV outer diameter + ${2 * MIN_RADIAL_GAP_MM} mm (${r1(v.lvOuterDiameterMm + 2 * MIN_RADIAL_GAP_MM)} mm)`);
  }
  if (v.hvOuterDiameterMm <= v.hvInnerDiameterMm) {
    fail(['hvOuterDiameterMm', 'hvInnerDiameterMm'], `${label('hvOuterDiameterMm')} (${r1(v.hvOuterDiameterMm)} mm) must be larger than the HV inner diameter (${r1(v.hvInnerDiameterMm)} mm)`);
  }
  if (v.phasePitchMm < v.hvOuterDiameterMm + MIN_PHASE_GAP_MM) {
    fail(['phasePitchMm', 'hvOuterDiameterMm'], `${label('phasePitchMm')} (${r1(v.phasePitchMm)} mm) must be at least the HV outer diameter + ${MIN_PHASE_GAP_MM} mm (${r1(v.hvOuterDiameterMm + MIN_PHASE_GAP_MM)} mm), or neighbouring windings touch`);
  }
  ['lvHeightMm', 'hvHeightMm'].forEach((k) => {
    if (v[k] > v.windowHeightMm) {
      fail([k, 'windowHeightMm'], `${label(k)} (${r1(v[k])} mm) exceeds the core window height (${r1(v.windowHeightMm)} mm)`);
    }
  });

  if (isOil) {
    const inner = dims.geo.inner;
    const need = [
      ['tankLengthMm', inner.lengthMm, dims.geo.activeLengthMm + 2 * MIN_TANK_CLEARANCE_MM, 'limb centre distance × 2 + HV outer diameter'],
      ['tankWidthMm', inner.widthMm, v.hvOuterDiameterMm + 2 * MIN_TANK_CLEARANCE_MM, 'HV outer diameter'],
      ['tankHeightMm', inner.heightMm, rules.FLOOR_CLEARANCE_MM + dims.geo.coreHeightMm + MIN_SPACE_ABOVE_MM, 'core height + floor clearance'],
    ];
    need.forEach(([key, have, min, basis]) => {
      if (have < min) {
        const wall = dims.geo.wallMm;
        const outerMin = key === 'tankHeightMm' ? min + wall : min + 2 * wall;
        fail([key], `Tank is too small for the active part: ${label(key).toLowerCase()} ${r1(v[key])} mm leaves ${r1(have)} mm inside, but at least ${r1(min)} mm is needed (${basis} + clearances). Minimum outer size about ${r1(outerMin)} mm`);
      }
    });
  }

  // Plausibility, against the rough placeholder values. Wide thresholds: this only catches unit slips (cm vs mm, t vs kg).
  const masses = resolveMasses(spec);
  const typical = {
    totalMassKg: masses.estimated.totalKg, coreMassKg: masses.estimated.coreKg, hvConductorMassKg: masses.estimated.hvConductorKg,
    lvConductorMassKg: masses.estimated.lvConductorKg, insulationMassKg: masses.estimated.insulationKg,
    oilLitres: masses.estimated.oilLitres, tankMassKg: masses.estimated.tankKg,
  };
  Object.entries(typical).forEach(([key, est]) => {
    if (spec[key] === undefined || !est) return;
    const ratio = spec[key] / est;
    if (ratio > 2.5 || ratio < 0.4) {
      const unit = FIELDS.find((f) => f.key === key).unit;
      const how = ratio > 1 ? `${r1(ratio)}× more than` : `${r1(1 / ratio)}× less than`;
      warnings.push({ field: key, level: 'warning', message: `${label(key)} ${spec[key]} ${unit} is ${how} the rough typical value for this rating (about ${Math.round(est)} ${unit}). Check the unit.` });
    }
  });
  if (spec.coreDiameterMm !== undefined) {
    const est = rules.coreDiameterMm(spec.ratedPowerKva);
    const ratio = spec.coreDiameterMm / est;
    if (ratio > 1.8 || ratio < 0.55) {
      warnings.push({ field: 'coreDiameterMm', level: 'warning', message: `Core diameter ${spec.coreDiameterMm} mm is far from the rough typical value for ${spec.ratedPowerKva} kVA (about ${Math.round(est)} mm). Check the unit.` });
    }
  }
  if (spec.totalMassKg !== undefined && masses.partsKg > spec.totalMassKg * 1.001) {
    warnings.push({ field: 'totalMassKg', level: 'warning', message: `Total mass ${spec.totalMassKg} kg is less than the sum of the component masses (${Math.round(masses.partsKg)} kg)` });
  }
  return { errors, warnings };
}

// Every designed field with the value in use and where it came from. The UI shows
// the estimate as the placeholder of blank inputs, so engineers see what they would override.
function designDataRows(spec, umHvKv) {
  const dims = resolveDimensions(spec, umHvKv);
  const masses = resolveMasses(spec);
  const radiators = resolveRadiators(spec);
  const massKey = { totalMassKg: 'totalKg', coreMassKg: 'coreKg', hvConductorMassKg: 'hvConductorKg', lvConductorMassKg: 'lvConductorKg', insulationMassKg: 'insulationKg', oilLitres: 'oilLitres', tankMassKg: 'tankKg' };
  const isOil = spec.type === 'oil';
  // A hermetic tank has corrugated fins, not radiator panels, so that row would only mislead.
  const hasRadiators = isOil && resolveSealing(spec).value === 'conservator';
  return FIELDS.filter((f) => f.section === 'designed' && (isOil || !f.oilOnly) && (f.key !== 'radiatorPanels' || hasRadiators)).map((f) => {
    let value;
    let source;
    if (f.key === 'radiatorPanels') {
      ({ count: value, source } = radiators);
    } else if (massKey[f.key]) {
      value = masses.values[massKey[f.key]];
      source = masses.sources[massKey[f.key]];
    } else {
      value = dims.values[f.key];
      source = dims.sources[f.key];
    }
    return { key: f.key, label: f.label, unit: f.unit ?? null, group: f.group, value: f.integer ? Math.round(value) : r1(value), source };
  });
}

module.exports = {
  resolveDimensions, resolveMasses, resolveRadiators, resolveSealing, validateDesignData, designDataRows,
  CORE_WINDING_KEYS, TANK_KEYS, OIL_DENSITY_KG_PER_L,
};
