const { validateSpec } = require('../src/spec');
const { derive, efficiencyPct, regulationPct } = require('../src/calc');
const { typical } = require('./fixtures');

const build = (over = {}) => {
  const v = validateSpec({ ...typical, ...over });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return { spec: v.spec, d: derive(v.spec, v.vectorGroup) };
};

describe('derive', () => {
  const { spec, d } = build();

  test('rated currents', () => {
    expect(d.currents.hvA).toBeCloseTo(28.8675, 3);
    expect(d.currents.lvA).toBeCloseTo(1443.3757, 3);
  });

  test('impedance split: ur = Pk/Sn, ux = sqrt(uk² - ur²)', () => {
    expect(d.impedance.urPct).toBeCloseTo(1.05, 6);
    expect(d.impedance.uxPct).toBeCloseTo(5.9074, 3);
    expect(d.impedance.urPct ** 2 + d.impedance.uxPct ** 2).toBeCloseTo(36, 6);
  });

  test('equivalent circuit referred to HV and LV', () => {
    const hv = d.equivalentCircuit.hv;
    expect(hv.zBaseOhm).toBeCloseTo(400, 6);
    expect(hv.zkOhm).toBeCloseTo(24, 6);
    expect(hv.rkOhm).toBeCloseTo(4.2, 6);
    expect(Math.hypot(hv.rkOhm, hv.xkOhm)).toBeCloseTo(24, 6);
    expect(d.equivalentCircuit.lv.zkOhm).toBeCloseTo(0.0096, 6);
    // Same transformer seen from either side: impedances scale with the ratio squared.
    expect(hv.zkOhm / d.equivalentCircuit.lv.zkOhm).toBeCloseTo(d.ratio ** 2, 6);
  });

  test('magnetising branch needs i0 and is skipped when losses exceed it', () => {
    expect(d.equivalentCircuit.hv.xmOhm).toBeNull();
    const withI0 = build({ i0Pct: 0.5 }).d.equivalentCircuit.hv;
    expect(withI0.xmOhm).toBeGreaterThan(0);
    // i0 smaller than the loss component: no real magnetising reactance.
    expect(build({ i0Pct: 0.01 }).d.equivalentCircuit.hv.xmOhm).toBeNull();
  });

  test('efficiency', () => {
    expect(d.efficiency.ratedPf1Pct).toBeCloseTo(98.8533, 3);
    expect(d.efficiency.ratedPf08Pct).toBeCloseTo(98.5707, 3);
    expect(d.efficiency.maxLoadFactor).toBeCloseTo(Math.sqrt(1100 / 10500), 9);
    // Peak really is the peak
    expect(efficiencyPct(spec, d.efficiency.maxLoadFactor, 1)).toBeGreaterThan(efficiencyPct(spec, 0.5, 1));
    expect(d.efficiency.maxPf1Pct).toBeGreaterThan(efficiencyPct(spec, 1, 1));
  });

  test('voltage regulation (IEC 60076-1 approximation)', () => {
    expect(d.regulation.ratedPf1Pct).toBeCloseTo(1.2245, 3);
    expect(d.regulation.ratedPf08LagPct).toBeCloseTo(4.4683, 3);
    expect(d.regulation.ratedPf08LeadPct).toBeLessThan(0);
  });

  test('regulation is zero at no load', () => {
    expect(regulationPct(d.impedance, 0, 0)).toBe(0);
  });

  test('Um comes from the standard series', () => {
    expect(d.umHvKv).toBe(24);
    expect(d.umLvKv).toBe(1.1);
    expect(build({ hvKv: 33 }).d.umHvKv).toBe(36);
    expect(build({ hvKv: 10 }).d.umHvKv).toBe(12);
    expect(build({ hvKv: 15 }).d.umHvKv).toBe(17.5);
  });

  test('tap table runs from highest HV voltage to lowest, nominal in the middle', () => {
    expect(d.taps.map((t) => t.percent)).toEqual([5, 2.5, 0, -2.5, -5]);
    expect(d.taps.map((t) => t.position)).toEqual([1, 2, 3, 4, 5]);
    expect(d.taps[0].hvKv).toBeCloseTo(21, 9);
    expect(Object.is(d.taps[2].percent, 0)).toBe(true);
    expect(build({ tapType: 'none' }).d.taps).toEqual([]);
  });

  test('curves cover load factors 0.05-1.2 with matching series lengths', () => {
    const c = d.curves;
    expect(c.loadFactors[0]).toBe(0.05);
    expect(c.loadFactors.at(-1)).toBe(1.2);
    [...c.efficiency, ...c.regulation].forEach((s) => expect(s.values).toHaveLength(c.loadFactors.length));
    const k1 = c.loadFactors.indexOf(1);
    expect(c.efficiency[0].values[k1]).toBeCloseTo(98.8533, 3);
    expect(c.regulation[1].values[k1]).toBeCloseTo(4.4683, 3);
  });
});
