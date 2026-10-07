const { design } = require('../src/design');
const { aabb } = require('../src/geometry');
const { typical } = require('./fixtures');

const modelFor = (over = {}) => {
  const r = design({ ...typical, ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.model;
};
const byGroup = (m, g) => m.parts.filter((p) => p.group === g);
const part = (m, id) => m.parts.find((p) => p.id === id);
const within = (p, box) => p.position.every((c, i) => c - p.size[i] / 2 >= box.min[i] - 0.11 && c + p.size[i] / 2 <= box.max[i] + 0.11);

describe('buildModel (oil, Dyn11, 1000 kVA)', () => {
  const m = modelFor();

  test('is plain JSON in millimetres, flagged as an estimate', () => {
    expect(m.units).toBe('mm');
    expect(m.estimate).toBe(true);
    expect(m.notice).toMatch(/placeholder/);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  test('every part has a unique id, finite numbers and a positive size', () => {
    const ids = m.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    m.parts.forEach((p) => {
      [...p.position, ...p.size].forEach((n) => expect(Number.isFinite(n)).toBe(true));
      p.size.forEach((s) => expect(s).toBeGreaterThan(0));
    });
  });

  test('three limbs, each with an LV winding inside an HV winding', () => {
    expect(byGroup(m, 'winding-hv')).toHaveLength(3);
    expect(byGroup(m, 'winding-lv')).toHaveLength(3);
    ['U', 'V', 'W'].forEach((ph) => {
      const hv = part(m, `winding-hv-${ph}`);
      const lv = part(m, `winding-lv-${ph}`);
      expect(lv.outerRadius).toBeLessThan(hv.innerRadius);
      expect(hv.innerRadius).toBeGreaterThan(part(m, `core-limb-${ph}`).radius);
      expect(hv.position[0]).toBe(lv.position[0]);
    });
  });

  test('adjacent HV windings do not touch', () => {
    const [u, v, w] = ['U', 'V', 'W'].map((p) => part(m, `winding-hv-${p}`));
    expect(v.position[0] - u.position[0]).toBeGreaterThan(2 * u.outerRadius);
    expect(w.position[0] - v.position[0]).toBeGreaterThan(2 * v.outerRadius);
  });

  test('windings fit in the core window, between the yokes', () => {
    const bottom = part(m, 'core-yoke-bottom');
    const top = part(m, 'core-yoke-top');
    const winTop = bottom.position[1] + bottom.size[1] / 2 + m.meta.windowHeightMm;
    expect(top.position[1] - top.size[1] / 2).toBeCloseTo(winTop, 0);
    [...byGroup(m, 'winding-hv'), ...byGroup(m, 'winding-lv')].forEach((w) => {
      expect(w.position[1] - w.height / 2).toBeGreaterThanOrEqual(bottom.position[1] + bottom.size[1] / 2);
      expect(w.position[1] + w.height / 2).toBeLessThanOrEqual(top.position[1] - top.size[1] / 2);
    });
  });

  test('the whole active part sits inside the tank interior', () => {
    const { tankInner } = m.meta;
    const inner = {
      min: [-tankInner.length / 2, tankInner.bottomY, -tankInner.width / 2],
      max: [tankInner.length / 2, tankInner.bottomY + tankInner.height, tankInner.width / 2],
    };
    m.parts.filter((p) => p.layer === 'active').forEach((p) => expect(within(p, inner)).toBe(true));
  });

  test('bushings sit on the cover, HV on one side and LV on the other, over the limbs', () => {
    const hv = byGroup(m, 'bushing-hv');
    const lv = byGroup(m, 'bushing-lv');
    expect(hv).toHaveLength(3);
    expect(lv).toHaveLength(4); // Dyn11: neutral on LV only
    hv.forEach((b) => expect(b.position[2]).toBeLessThan(0));
    lv.forEach((b) => expect(b.position[2]).toBeGreaterThan(0));
    ['U', 'V', 'W'].forEach((ph) => {
      expect(part(m, `bushing-hv-${ph}`).position[0]).toBe(part(m, `winding-hv-${ph}`).position[0]);
    });
    hv.concat(lv).forEach((b) => expect(b.position[1] - b.size[1] / 2).toBeCloseTo(m.meta.coverTopMm, 0));
  });

  test('bushings stay within the cover outline', () => {
    const cover = part(m, 'tank-cover');
    const box = { min: cover.position.map((c, i) => c - cover.size[i] / 2), max: cover.position.map((c, i) => c + cover.size[i] / 2) };
    [...byGroup(m, 'bushing-hv'), ...byGroup(m, 'bushing-lv')].forEach((b) => {
      expect(b.position[0] - b.radius).toBeGreaterThan(box.min[0]);
      expect(b.position[0] + b.radius).toBeLessThan(box.max[0]);
      expect(b.position[2] - b.radius).toBeGreaterThan(box.min[2]);
      expect(b.position[2] + b.radius).toBeLessThan(box.max[2]);
    });
  });

  test('HV bushings are taller than LV ones (higher voltage class)', () => {
    expect(part(m, 'bushing-hv-U').height).toBeGreaterThan(part(m, 'bushing-lv-U').height);
  });

  test('a ≤1600 kVA unit with automatic oil preservation is hermetic: fins, no conservator', () => {
    expect(byGroup(m, 'cooling').every((p) => p.shape === 'fins')).toBe(true);
    expect(byGroup(m, 'cooling')).toHaveLength(2);
    expect(byGroup(m, 'conservator')).toHaveLength(0);
  });

  test('overall dimensions come from the union of all parts', () => {
    const b = aabb(m.parts);
    expect(m.bounds).toEqual(b);
    expect(m.overall.lengthMm).toBeCloseTo(b.max[0] - b.min[0], -1);
    expect(m.overall.heightMm).toBeCloseTo(b.max[1] - b.min[1], -1);
    expect(m.overall.heightMm).toBeGreaterThan(m.overall.widthMm / 2);
    expect(b.min[1]).toBeCloseTo(0, 5); // stands on the floor
  });
});

describe('variants', () => {
  test('neutral bushings follow the vector group', () => {
    expect(byGroup(modelFor({ vectorGroup: 'Dd0' }), 'bushing-lv')).toHaveLength(3);
    const yn = modelFor({ vectorGroup: 'YNyn0' });
    expect(part(yn, 'bushing-hv-N')).toBeDefined();
    expect(part(yn, 'bushing-lv-N')).toBeDefined();
    expect(byGroup(yn, 'bushing-hv')).toHaveLength(4);
  });

  test('bushing counts agree with the bill of materials', () => {
    ['Dyn11', 'YNyn0', 'Dd0', 'Yzn5'].forEach((vectorGroup) => {
      const r = design({ ...typical, vectorGroup });
      const bomQty = (item) => r.bom.lines.filter((l) => l.item === item).reduce((s, l) => s + l.qty, 0);
      expect(byGroup(r.model, 'bushing-hv')).toHaveLength(bomQty('HV bushing (phase)') + bomQty('HV bushing (neutral)'));
      expect(byGroup(r.model, 'bushing-lv')).toHaveLength(bomQty('LV bushing (phase)') + bomQty('LV bushing (neutral)'));
    });
  });

  test('conservator type: radiators match the BOM, conservator above the bushings', () => {
    const r = design({ ...typical, ratedPowerKva: 2500, p0W: 2200, pkW: 21000 });
    const m = r.model;
    const radiators = m.parts.filter((p) => p.name === 'Radiator panel');
    const bomPanels = r.bom.lines.find((l) => l.item === 'Radiator panel').qty;
    expect(radiators).toHaveLength(bomPanels);
    expect(byGroup(m, 'cooling').some((p) => p.shape === 'fins')).toBe(false);
    const conservator = part(m, 'conservator');
    const tallest = Math.max(...byGroup(m, 'bushing-hv').map((b) => b.position[1] + b.size[1] / 2));
    expect(conservator.position[1] - conservator.radius).toBeGreaterThan(tallest);
    expect(part(m, 'buchholz-relay')).toBeDefined();
  });

  test('explicit sealing overrides the rating-based default', () => {
    expect(part(modelFor({ ratedPowerKva: 630, sealing: 'conservator', p0W: 800, pkW: 6500 }), 'conservator')).toBeDefined();
    expect(part(modelFor({ ratedPowerKva: 2500, sealing: 'hermetic', p0W: 2200, pkW: 21000 }), 'conservator')).toBeUndefined();
  });

  test('tap changer hardware follows the tap type', () => {
    expect(part(modelFor(), 'tap-switch-handle')).toBeDefined();
    const oltc = modelFor({ tapType: 'OLTC' });
    expect(part(oltc, 'oltc-head')).toBeDefined();
    expect(part(oltc, 'oltc-drive')).toBeDefined();
    const none = modelFor({ tapType: 'none' });
    ['tap-switch-handle', 'oltc-head', 'oltc-drive'].forEach((id) => expect(part(none, id)).toBeUndefined());
  });

  test('ONAF adds fans', () => {
    expect(modelFor({ cooling: 'ONAF' }).parts.filter((p) => p.name === 'Cooling fan')).toHaveLength(2);
    expect(modelFor().parts.filter((p) => p.name === 'Cooling fan')).toHaveLength(0);
  });

  test('dry type: no tank, oil hardware or bushings; terminals and clamps instead', () => {
    const m = modelFor({ type: 'dry' });
    expect(m.meta.tankInner).toBeNull();
    ['tank-body', 'tank-cover', 'conservator', 'drain-valve'].forEach((id) => expect(part(m, id)).toBeUndefined());
    expect(m.parts.some((p) => p.shape === 'bushing')).toBe(false);
    expect(byGroup(m, 'bushing-hv').every((p) => p.layer === 'terminals')).toBe(true);
    expect(byGroup(m, 'bushing-hv')).toHaveLength(3);
    expect(byGroup(m, 'bushing-lv')).toHaveLength(4);
    expect(part(m, 'clamp-top')).toBeDefined();
    expect(aabb(m.parts).min[1]).toBeCloseTo(0, 5);
  });

  test('size grows with rating', () => {
    const small = modelFor({ ratedPowerKva: 250, p0W: 400, pkW: 3000 });
    const large = modelFor({ ratedPowerKva: 2500, p0W: 2200, pkW: 21000 });
    expect(large.meta.coreDiameterMm).toBeGreaterThan(small.meta.coreDiameterMm);
    expect(large.overall.lengthMm).toBeGreaterThan(small.overall.lengthMm);
    expect(large.overall.heightMm).toBeGreaterThan(small.overall.heightMm);
  });

  test('higher voltage class gives more clearance and taller bushings', () => {
    const lowKv = modelFor({ hvKv: 10 });
    const highKv = modelFor({ hvKv: 33 });
    expect(highKv.meta.tankInner.length).toBeGreaterThan(lowKv.meta.tankInner.length);
    expect(part(highKv, 'bushing-hv-U').height).toBeGreaterThan(part(lowKv, 'bushing-hv-U').height);
  });

  test('deterministic', () => {
    expect(modelFor()).toEqual(modelFor());
  });

  test('stays sane across the whole supported rating range', () => {
    [50, 160, 630, 2500, 10000, 50000].forEach((kva) => {
      const m = modelFor({ ratedPowerKva: kva, p0W: kva * 1.1, pkW: kva * 9 });
      m.parts.forEach((p) => [...p.position, ...p.size].forEach((n) => expect(Number.isFinite(n)).toBe(true)));
      expect(m.overall.heightMm).toBeGreaterThan(0);
    });
  });
});
