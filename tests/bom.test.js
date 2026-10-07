const { design } = require('../src/design');
const { pick, loadCatalog } = require('../src/bom');
const { typical } = require('./fixtures');

const bomFor = (over = {}) => {
  const r = design({ ...typical, ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.bom;
};
const line = (bom, item) => bom.lines.find((l) => l.item === item);

describe('generateBom', () => {
  test('Dyn11 has 3 HV and 3+1 LV terminals (neutral only on LV)', () => {
    const bom = bomFor();
    expect(line(bom, 'HV bushing (phase)').qty).toBe(3);
    expect(line(bom, 'HV bushing (neutral)')).toBeUndefined();
    expect(line(bom, 'LV bushing (phase)').qty).toBe(3);
    expect(line(bom, 'LV bushing (neutral)').qty).toBe(1);
  });

  test('YNyn0 has neutral bushings on both sides', () => {
    const bom = bomFor({ vectorGroup: 'YNyn0' });
    expect(line(bom, 'HV bushing (neutral)').qty).toBe(1);
    expect(line(bom, 'LV bushing (neutral)').qty).toBe(1);
  });

  test('bushings are picked by Um class and rated current', () => {
    const bom = bomFor();
    // 20 kV -> Um 24 kV, 28.9 A -> smallest 250 A; 0.4 kV -> 1.1 kV class, 1443 A -> 2000 A
    expect(line(bom, 'HV bushing (phase)').code).toBe('BSH-24-250');
    expect(line(bom, 'LV bushing (phase)').code).toBe('BSH-1.1-2000');
  });

  test('unmatchable rating is reported, not silently dropped', () => {
    const bom = bomFor({ ratedPowerKva: 10000, lvKv: 0.4 }); // LV current ≈ 14.4 kA, beyond the catalog
    const lv = line(bom, 'LV bushing (phase)');
    expect(lv.confidence).toBe('unmatched');
    expect(lv.code).toBeNull();
    expect(bom.warnings.join(' ')).toMatch(/No catalog item for "LV bushing \(phase\)"/);
  });

  test('every placeholder-sized line is flagged and a warning says so', () => {
    const bom = bomFor();
    const estimates = bom.lines.filter((l) => l.confidence === 'estimate');
    expect(estimates.map((l) => l.item)).toEqual(expect.arrayContaining(['Core steel (grain-oriented)', 'Insulating oil']));
    expect(bom.warnings[0]).toMatch(/placeholder sizing rules/);
  });

  test('oil preservation default depends on rating and is recorded as an assumption', () => {
    const small = bomFor({ ratedPowerKva: 630 });
    expect(small.assumptions.join(' ')).toMatch(/hermetic assumed/);
    expect(line(small, 'Buchholz relay')).toBeUndefined();

    const big = bomFor({ ratedPowerKva: 2500 });
    expect(big.assumptions.join(' ')).toMatch(/conservator assumed/);
    expect(line(big, 'Buchholz relay').qty).toBe(1);
    expect(line(big, 'Dehydrating breather').qty).toBe(1);
    expect(line(big, 'Radiator panel').qty).toBeGreaterThan(0);
  });

  test('explicit sealing overrides the default without an assumption', () => {
    const bom = bomFor({ ratedPowerKva: 630, sealing: 'conservator' });
    expect(bom.assumptions).toEqual([]);
    expect(line(bom, 'Buchholz relay')).toBeDefined();
  });

  test('tap changer line follows tap type', () => {
    expect(line(bomFor(), 'Off-circuit tap switch').basis).toMatch(/5 positions/);
    expect(line(bomFor({ tapType: 'OLTC' }), 'On-load tap changer')).toBeDefined();
    const none = bomFor({ tapType: 'none' });
    expect(line(none, 'Off-circuit tap switch')).toBeUndefined();
    expect(line(none, 'On-load tap changer')).toBeUndefined();
  });

  test('dry type: no oil, tank or bushings; PT100 sensors and terminals instead', () => {
    const bom = bomFor({ type: 'dry' });
    expect(line(bom, 'Insulating oil')).toBeUndefined();
    expect(line(bom, 'Tank and cover (steel)')).toBeUndefined();
    expect(line(bom, 'HV bushing (phase)')).toBeUndefined();
    expect(line(bom, 'HV terminal (phase)').qty).toBe(3);
    expect(line(bom, 'Winding temperature sensor (PT100)').qty).toBe(3);
    expect(bom.assumptions).toEqual([]);
  });

  test('aluminium windings need less conductor mass than copper', () => {
    const cu = line(bomFor({ windingMaterial: 'Cu' }), 'HV winding conductor (copper)').qty;
    const al = line(bomFor({ windingMaterial: 'Al' }), 'HV winding conductor (aluminium)').qty;
    expect(al).toBeLessThan(cu);
  });

  test('masses grow with rating', () => {
    const small = bomFor({ ratedPowerKva: 400 }).totalMassKg;
    const large = bomFor({ ratedPowerKva: 1600 }).totalMassKg;
    expect(large).toBeGreaterThan(small);
  });

  test('a custom catalog is honoured', () => {
    const catalog = { items: [{ code: 'X-1', category: 'bushing', description: 'only one', voltageClassKv: 24, ratedCurrentA: 3000 }] };
    const r = design(typical, { catalog });
    expect(r.bom.lines.find((l) => l.item === 'HV bushing (phase)').code).toBe('X-1');
    expect(r.bom.warnings.join(' ')).toMatch(/Catalog has no accessory/);
  });
});

describe('pick', () => {
  const catalog = loadCatalog();
  test('smallest class and current that fit', () => {
    expect(pick(catalog, { category: 'bushing', minClassKv: 24, minCurrentA: 300 }).code).toBe('BSH-24-630');
    expect(pick(catalog, { category: 'bushing', minClassKv: 20, minCurrentA: 1 }).code).toBe('BSH-24-250');
    expect(pick(catalog, { category: 'bushing', minClassKv: 24, minCurrentA: 1e6 })).toBeUndefined();
  });
  test('on-load changers must support enough positions', () => {
    expect(pick(catalog, { category: 'oltc', minClassKv: 24, minCurrentA: 30, minPositions: 17 })).toBeDefined();
    expect(pick(catalog, { category: 'oltc', minClassKv: 24, minCurrentA: 30, minPositions: 19 })).toBeUndefined();
  });
});
