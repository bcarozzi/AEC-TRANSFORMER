const request = require('supertest');
const ExcelJS = require('exceljs');
const { design } = require('../src/design');
const { validateSpec } = require('../src/spec');
const { resolveDimensions, resolveMasses, designDataRows, CORE_WINDING_KEYS, TANK_KEYS } = require('../src/dimensions');
const { FIELDS, normaliseHeader } = require('../src/fields');
const { importRows } = require('../src/importers/table');
const { createApp } = require('../src/server');
const { typical } = require('./fixtures');

const specFor = (over = {}) => {
  const v = validateSpec({ ...typical, ...over });
  if (!v.ok) throw new Error(JSON.stringify(v.errors));
  return v.spec;
};
const errorsFor = (over) => {
  const r = validateSpec({ ...typical, ...over });
  expect(r.ok).toBe(false);
  return Object.fromEntries(r.errors.map((e) => [e.field, e.message]));
};
const warningsFor = (over) => {
  const r = validateSpec({ ...typical, ...over });
  expect(r.ok).toBe(true);
  return r.warnings.map((w) => w.field);
};
const designFor = (over = {}) => {
  const r = design({ ...typical, ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const line = (r, item) => r.bom.lines.find((l) => l.item === item);

// A complete, consistent set of as-designed values for the 1000 kVA example.
const FULL = {
  coreDiameterMm: 260, windowHeightMm: 700, phasePitchMm: 520,
  lvInnerDiameterMm: 275, lvOuterDiameterMm: 340, hvInnerDiameterMm: 356, hvOuterDiameterMm: 470,
  lvHeightMm: 620, hvHeightMm: 600,
  tankLengthMm: 1700, tankWidthMm: 800, tankHeightMm: 1400,
  coreMassKg: 850, hvConductorMassKg: 260, lvConductorMassKg: 250, insulationMassKg: 150,
  oilLitres: 820, tankMassKg: 600, totalMassKg: 3450,
};

describe('field registry', () => {
  test('no two fields share an alias, label or key (the importer would let one shadow the other)', () => {
    const seen = new Map();
    FIELDS.forEach((f) => [f.key, f.label, ...f.aliases].forEach((a) => {
      const k = normaliseHeader(a);
      if (seen.has(k) && seen.get(k) !== f.key) expect({ alias: a, field: f.key, alsoClaimedBy: seen.get(k) }).toEqual(null);
      seen.set(k, f.key);
    }));
  });

  test('every designed field belongs to a known group and is optional', () => {
    const designed = FIELDS.filter((f) => f.section === 'designed');
    expect(designed).toHaveLength(20);
    designed.forEach((f) => {
      expect(['masses', 'core-windings', 'tank']).toContain(f.group);
      expect(f.required).toBe(false);
    });
  });
});

describe('resolveDimensions', () => {
  test('with nothing entered, everything is an estimate', () => {
    const d = resolveDimensions(specFor(), 24);
    expect(d.completeness).toEqual({ designed: 0, total: 12 });
    expect(Object.values(d.sources).every((s) => s === 'estimate')).toBe(true);
    expect(d.values.coreDiameterMm).toBeCloseTo(246.84, 1);
  });

  test('a designed value is used exactly, as entered', () => {
    const d = resolveDimensions(specFor({ coreDiameterMm: 260, tankLengthMm: 1700 }), 24);
    expect(d.values.coreDiameterMm).toBe(260);
    expect(d.sources.coreDiameterMm).toBe('designed');
    expect(d.values.tankLengthMm).toBe(1700);
    expect(d.completeness.designed).toBe(2);
  });

  test('one real number pulls its estimated neighbours with it', () => {
    const small = resolveDimensions(specFor({ coreDiameterMm: 200 }), 24).values;
    const large = resolveDimensions(specFor({ coreDiameterMm: 320 }), 24).values;
    ['windowHeightMm', 'lvInnerDiameterMm', 'hvOuterDiameterMm', 'phasePitchMm', 'tankLengthMm'].forEach((k) => {
      expect(large[k]).toBeGreaterThan(small[k]);
    });
    expect(large.lvInnerDiameterMm).toBeCloseTo(320 + 24, 6);
  });

  test('a designed tank sets the interior from the outer size and the wall thickness', () => {
    const d = resolveDimensions(specFor({ tankLengthMm: 1700, tankWidthMm: 800, tankHeightMm: 1400 }), 24);
    expect(d.geo.inner.lengthMm).toBeCloseTo(1700 - 2 * d.geo.wallMm, 6);
    expect(d.geo.inner.widthMm).toBeCloseTo(800 - 2 * d.geo.wallMm, 6);
    expect(d.geo.inner.heightMm).toBeCloseTo(1400 - d.geo.wallMm, 6);
  });

  test('a full set counts as complete; dry type has no tank dimensions to count', () => {
    expect(resolveDimensions(specFor(FULL), 24).completeness).toEqual({ designed: 12, total: 12 });
    const dry = resolveDimensions(specFor({ type: 'dry' }), 24);
    expect(dry.completeness.total).toBe(CORE_WINDING_KEYS.length);
    expect(dry.values.tankLengthMm).toBeUndefined();
    TANK_KEYS.forEach((k) => expect(dry.values[k]).toBeUndefined());
  });
});

describe('validation of designed values', () => {
  test('a consistent full set is accepted without warnings', () => {
    const r = validateSpec({ ...typical, ...FULL });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  test('accepts text with decimal commas and blank strings', () => {
    const r = validateSpec({ ...typical, coreDiameterMm: '260,5', windowHeightMm: '', tankLengthMm: ' 1700 ' });
    expect(r.ok).toBe(true);
    expect(r.spec.coreDiameterMm).toBe(260.5);
    expect(r.spec.windowHeightMm).toBeUndefined();
  });

  test('rejects non-positive, non-numeric and absurd values', () => {
    expect(errorsFor({ coreDiameterMm: 0 }).coreDiameterMm).toMatch(/greater than 0/);
    expect(errorsFor({ coreMassKg: -5 }).coreMassKg).toMatch(/greater than 0/);
    expect(errorsFor({ tankLengthMm: 'wide' }).tankLengthMm).toMatch(/number/);
    expect(errorsFor({ coreDiameterMm: 2_000_000 }).coreDiameterMm).toMatch(/unrealistically large/);
    expect(errorsFor({ radiatorPanels: 2.5 }).radiatorPanels).toMatch(/whole number/);
  });

  test('neighbouring HV windings may not touch', () => {
    expect(errorsFor({ phasePitchMm: 300 }).phasePitchMm).toMatch(/neighbouring windings touch/);
  });

  test('the core must fit inside the LV winding', () => {
    expect(errorsFor({ coreDiameterMm: 260, lvInnerDiameterMm: 250 }).lvInnerDiameterMm).toMatch(/at least the core diameter/);
  });

  test('windings nest in order: LV in < LV out < HV in < HV out', () => {
    expect(errorsFor({ lvInnerDiameterMm: 300, lvOuterDiameterMm: 290 }).lvOuterDiameterMm).toMatch(/larger than the LV inner/);
    expect(errorsFor({ lvOuterDiameterMm: 500, hvInnerDiameterMm: 400 }).hvInnerDiameterMm).toMatch(/at least the LV outer diameter/);
    expect(errorsFor({ hvInnerDiameterMm: 400, hvOuterDiameterMm: 380 }).hvOuterDiameterMm).toMatch(/larger than the HV inner/);
  });

  test('giving only one winding diameter is fine: the estimated ones follow it', () => {
    expect(validateSpec({ ...typical, lvOuterDiameterMm: 500 }).ok).toBe(true);
  });

  test('windings must fit the core window', () => {
    expect(errorsFor({ windowHeightMm: 500, hvHeightMm: 600 }).hvHeightMm).toMatch(/exceeds the core window height/);
  });

  test('the tank must contain the active part, in each direction', () => {
    expect(errorsFor({ tankLengthMm: 900 }).tankLengthMm).toMatch(/too small for the active part/);
    expect(errorsFor({ tankWidthMm: 400 }).tankWidthMm).toMatch(/too small/);
    expect(errorsFor({ tankHeightMm: 700 }).tankHeightMm).toMatch(/too small/);
  });

  test('the message for a small tank gives the minimum to aim for', () => {
    expect(errorsFor({ tankLengthMm: 900 }).tankLengthMm).toMatch(/Minimum outer size about \d+/);
  });

  test('an estimated neighbour is never blamed: only designed fields carry the error', () => {
    const e = errorsFor({ phasePitchMm: 300 });
    expect(Object.keys(e)).toEqual(['phasePitchMm']);
  });

  test('oil-only fields are rejected for dry type', () => {
    const e = errorsFor({ type: 'dry', tankLengthMm: 1700, oilLitres: 800, tankMassKg: 600, radiatorPanels: 4 });
    expect(Object.keys(e).sort()).toEqual(['oilLitres', 'radiatorPanels', 'tankLengthMm', 'tankMassKg']);
    expect(e.oilLitres).toMatch(/oil-immersed/);
  });

  test('radiator panels conflict with an explicit hermetic tank', () => {
    expect(errorsFor({ radiatorPanels: 6, sealing: 'hermetic' }).radiatorPanels).toMatch(/conservator/);
  });

  test('unit slips are flagged, not rejected', () => {
    expect(warningsFor({ coreDiameterMm: 26 })).toContain('coreDiameterMm'); // cm typed as mm
    expect(warningsFor({ coreMassKg: 0.8 })).toContain('coreMassKg'); // tonnes typed as kg
    expect(warningsFor({ oilLitres: 80000 })).toContain('oilLitres');
    expect(warningsFor({ coreMassKg: 850 })).toEqual([]);
  });

  test('a total below the sum of its parts is flagged', () => {
    expect(warningsFor({ coreMassKg: 1500, totalMassKg: 1200 })).toContain('totalMassKg');
  });

  test('errors in other fields do not hide design-data errors', () => {
    const r = validateSpec({ ...typical, vectorGroup: 'Dyn10', phasePitchMm: 300 });
    expect(r.errors.map((e) => e.field).sort()).toEqual(['phasePitchMm', 'vectorGroup']);
  });
});

describe('masses and the BOM', () => {
  test('designed masses are used as entered, tagged "designed", and not rounded', () => {
    const r = designFor({ coreMassKg: 853.7, oilLitres: 812, tankMassKg: 590 });
    expect(line(r, 'Core steel (grain-oriented)')).toMatchObject({ qty: 853.7, confidence: 'designed', basis: 'From design data' });
    expect(line(r, 'Insulating oil')).toMatchObject({ qty: 812, confidence: 'designed' });
    expect(line(r, 'Tank and cover (steel)')).toMatchObject({ qty: 590, confidence: 'designed' });
    // the rest keep their placeholder estimate
    expect(line(r, 'Insulation (paper, pressboard)').confidence).toBe('estimate');
  });

  test('with a full set of masses, no mass line is an estimate', () => {
    const r = designFor(FULL);
    const massLines = ['Core steel (grain-oriented)', 'HV winding conductor (copper)', 'LV winding conductor (copper)', 'Insulation (paper, pressboard)', 'Insulating oil', 'Tank and cover (steel)'];
    massLines.forEach((item) => expect(line(r, item).confidence).toBe('designed'));
    expect(r.bom.lines.filter((l) => l.confidence === 'estimate')).toEqual([]);
    expect(r.bom.warnings.join(' ')).not.toMatch(/placeholder sizing rules/);
  });

  test('the warning counts what is still estimated and what is designed', () => {
    const w = designFor({ coreMassKg: 850 }).bom.warnings[0];
    expect(w).toMatch(/5 line\(s\) still use placeholder/);
    expect(w).toMatch(/1 come from your design data/);
  });

  test('total mass: designed when given, otherwise an estimate never below the parts', () => {
    expect(designFor({ totalMassKg: 3450 }).bom).toMatchObject({ totalMassKg: 3450, totalMassSource: 'designed' });
    const est = designFor({ coreMassKg: 6000 }).bom;
    expect(est.totalMassSource).toBe('estimate');
    expect(est.totalMassKg).toBeGreaterThanOrEqual(6000 + 240 + 240 + 160);
  });

  test('a designed radiator count sets the BOM line and implies a conservator', () => {
    const r = designFor({ radiatorPanels: 6 });
    expect(line(r, 'Radiator panel')).toMatchObject({ qty: 6, confidence: 'designed' });
    expect(r.bom.assumptions.join(' ')).toMatch(/conservator assumed because a radiator count was given/);
    expect(line(r, 'Buchholz relay')).toBeDefined();
    expect(r.model.parts.filter((p) => p.name === 'Radiator panel')).toHaveLength(6);
  });

  test('an explicit sealing still wins over the default, and needs no assumption', () => {
    const r = designFor({ radiatorPanels: 6, sealing: 'conservator' });
    expect(r.bom.assumptions).toEqual([]);
  });

  test('a designed oil volume sizes the conservator', () => {
    const base = designFor({ ratedPowerKva: 2500, p0W: 2200, pkW: 21000 }).model.parts.find((p) => p.id === 'conservator');
    const more = designFor({ ratedPowerKva: 2500, p0W: 2200, pkW: 21000, oilLitres: 4000 }).model.parts.find((p) => p.id === 'conservator');
    expect(more.radius).toBeGreaterThan(base.radius);
  });

  test('resolveMasses reports sources per item', () => {
    const m = resolveMasses(specFor({ coreMassKg: 850 }));
    expect(m.sources.coreKg).toBe('designed');
    expect(m.sources.hvConductorKg).toBe('estimate');
    expect(m.values.coreKg).toBe(850);
  });
});

describe('3D model from designed dimensions', () => {
  test('winding radii and pitch are exactly the entered values', () => {
    const m = designFor(FULL).model;
    const hv = m.parts.find((p) => p.id === 'winding-hv-U');
    const lv = m.parts.find((p) => p.id === 'winding-lv-U');
    expect(hv.outerRadius).toBe(235);
    expect(hv.innerRadius).toBe(178);
    expect(lv.outerRadius).toBe(170);
    expect(lv.innerRadius).toBe(137.5);
    expect(hv.height).toBe(600);
    expect(lv.height).toBe(620);
    const w = m.parts.find((p) => p.id === 'winding-hv-W');
    expect(w.position[0] - m.parts.find((p) => p.id === 'winding-hv-V').position[0]).toBe(520);
    expect(m.parts.find((p) => p.id === 'core-limb-U').radius).toBe(130);
  });

  test('the tank is exactly the entered outer size', () => {
    const m = designFor(FULL).model;
    expect(m.meta.tankOuter).toEqual({ length: 1700, width: 800, height: 1400 });
    expect(m.parts.find((p) => p.id === 'tank-body').size).toEqual([1700, 1400, 800]);
  });

  test('a full set removes the estimate flag; a partial set says how many dimensions are real', () => {
    const full = designFor(FULL).model;
    expect(full.estimate).toBe(false);
    expect(full.completeness).toEqual({ designed: 12, total: 12 });
    expect(full.notice).toMatch(/^Built from your design dimensions/);

    const partial = designFor({ coreDiameterMm: 260, tankLengthMm: 1700 }).model;
    expect(partial.estimate).toBe(true);
    expect(partial.notice).toMatch(/2 of 12 main dimensions come from your design data/);

    const none = designFor().model;
    expect(none.estimate).toBe(true);
    expect(none.notice).toMatch(/Enter the as-designed dimensions/);
  });

  test('the active part stays inside a designed tank', () => {
    const m = designFor(FULL).model;
    const { tankInner } = m.meta;
    m.parts.filter((p) => p.layer === 'active').forEach((p) => {
      expect(p.position[0] - p.size[0] / 2).toBeGreaterThanOrEqual(-tankInner.length / 2 - 0.11);
      expect(p.position[0] + p.size[0] / 2).toBeLessThanOrEqual(tankInner.length / 2 + 0.11);
      expect(p.position[2] - p.size[2] / 2).toBeGreaterThanOrEqual(-tankInner.width / 2 - 0.11);
      expect(p.position[2] + p.size[2] / 2).toBeLessThanOrEqual(tankInner.width / 2 + 0.11);
      expect(p.position[1] - p.size[1] / 2).toBeGreaterThanOrEqual(tankInner.bottomY - 0.11);
      expect(p.position[1] + p.size[1] / 2).toBeLessThanOrEqual(tankInner.bottomY + tankInner.height + 0.11);
    });
  });

  test('the overall size follows a designed tank', () => {
    const small = designFor({ tankLengthMm: 1500 }).model.overall.lengthMm;
    const large = designFor({ tankLengthMm: 2000 }).model.overall.lengthMm;
    expect(large - small).toBeGreaterThanOrEqual(480);
  });

  test('dry type uses designed core and winding dimensions', () => {
    const m = designFor({ type: 'dry', coreDiameterMm: 260, phasePitchMm: 520, hvOuterDiameterMm: 470, lvInnerDiameterMm: 275, lvOuterDiameterMm: 340, hvInnerDiameterMm: 356 }).model;
    expect(m.parts.find((p) => p.id === 'core-limb-U').radius).toBe(130);
    expect(m.completeness.total).toBe(9);
  });
});

describe('design data rows', () => {
  test('one row per designed field, with value and source', () => {
    const rows = designDataRows(specFor({ coreMassKg: 850, coreDiameterMm: 260, sealing: 'conservator' }), 24);
    expect(rows).toHaveLength(20);
    expect(rows.find((r) => r.key === 'coreMassKg')).toMatchObject({ value: 850, source: 'designed', unit: 'kg' });
    expect(rows.find((r) => r.key === 'coreDiameterMm')).toMatchObject({ value: 260, source: 'designed' });
    expect(rows.find((r) => r.key === 'hvConductorMassKg')).toMatchObject({ value: 240, source: 'estimate' });
    expect(rows.find((r) => r.key === 'radiatorPanels')).toMatchObject({ source: 'estimate', unit: null });
  });

  test('a hermetic tank has no radiator row, unless a radiator count was entered', () => {
    const keys = (over) => designDataRows(specFor(over), 24).map((r) => r.key);
    expect(keys({})).not.toContain('radiatorPanels'); // 1000 kVA defaults to hermetic
    expect(keys({})).toHaveLength(19);
    expect(keys({ radiatorPanels: 6 })).toContain('radiatorPanels'); // implies a conservator
    expect(keys({ sealing: 'conservator' })).toContain('radiatorPanels');
  });

  test('dry type omits the oil-only rows', () => {
    const keys = designDataRows(specFor({ type: 'dry' }), 24).map((r) => r.key);
    ['oilLitres', 'tankMassKg', 'tankLengthMm', 'radiatorPanels'].forEach((k) => expect(keys).not.toContain(k));
    expect(keys).toHaveLength(14); // 5 masses + 9 core and winding dimensions
  });
});

describe('import of designed columns', () => {
  const header = ['Rated power [kVA]', 'HV [kV]', 'LV [kV]', 'Vector group', 'uk [%]', 'P0 [W]', 'Pk [W]'];
  const row = [1000, 20, 0.4, 'Dyn11', 6, 1100, 10500];

  test('reads designed columns with unit conversion', () => {
    const r = importRows([
      [...header, 'Core diameter [cm]', 'Tank length [m]', 'Core mass [t]', 'Oil volume [m³]', 'Radiators'],
      [...row, 26, 1.7, 0.85, 0.82, 6],
    ]);
    expect(r.ignoredColumns).toEqual([]);
    expect(r.specs[0].values).toMatchObject({ coreDiameterMm: 260, tankLengthMm: 1700, coreMassKg: 850, oilLitres: 820, radiatorPanels: 6 });
    expect(r.specs[0].validation.ok).toBe(true);
  });

  test('reads Italian names', () => {
    const r = importRows([
      ['Potenza', 'Tensione primaria [kV]', 'Tensione secondaria [kV]', 'Gruppo vettoriale', 'Ucc', 'Perdite a vuoto [W]', 'Perdite a carico [W]', 'Peso nucleo [kg]', 'Diametro nucleo [mm]', 'Lunghezza cassa [mm]', 'Interasse [mm]'],
      [1000, 20, 0.4, 'Dyn11', 6, 1100, 10500, 850, 260, 1700, 520],
    ]);
    expect(r.ignoredColumns).toEqual([]);
    expect(r.specs[0].values).toMatchObject({ coreMassKg: 850, coreDiameterMm: 260, tankLengthMm: 1700, phasePitchMm: 520 });
  });

  test('a designed column holding an impossible value fails validation with a field error', () => {
    const r = importRows([[...header, 'Limb pitch [mm]'], [...row, 300]]);
    expect(r.specs[0].validation.ok).toBe(false);
    expect(r.specs[0].validation.errors.map((e) => e.field)).toEqual(['phasePitchMm']);
  });

  test('key/value layout works for designed rows too', () => {
    const r = importRows([['Rated power', '1000', 'kVA'], ['HV', '20', 'kV'], ['LV', '0.4', 'kV'], ['Vector group', 'Dyn11'], ['uk', '6'], ['P0', '1100'], ['Pk', '10500'], ['Core mass', '0.85', 't'], ['Tank height', '1400', 'mm']]);
    expect(r.layout).toBe('key-value');
    expect(r.specs[0].values).toMatchObject({ coreMassKg: 850, tankHeightMm: 1400 });
  });
});

describe('API', () => {
  const app = createApp();

  test('returns designData and flags the model', async () => {
    const res = await request(app).post('/api/design').send({ ...typical, ...FULL }).expect(200);
    expect(res.body.designData).toHaveLength(19); // hermetic: no radiator row
    expect(res.body.designData.every((r) => r.source === 'designed')).toBe(true);
    expect(res.body.model.estimate).toBe(false);
    expect(res.body.bom.totalMassKg).toBe(3450);
  });

  test('returns 422 with field errors for an impossible design', async () => {
    const res = await request(app).post('/api/design').send({ ...typical, phasePitchMm: 300, tankLengthMm: 900 }).expect(422);
    expect(res.body.errors.map((e) => e.field).sort()).toEqual(['phasePitchMm', 'tankLengthMm']);
  });

  test('the Excel BOM marks designed lines and lists the designed values in the specification sheet', async () => {
    const res = await request(app).post('/api/bom.xlsx').send({ ...typical, ...FULL })
      .buffer().parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const rows = (name) => { const out = []; wb.getWorksheet(name).eachRow((row) => out.push(row.values.slice(1))); return out; };
    const bom = rows('BOM');
    const core = bom.find((r) => r[2] === 'Core steel (grain-oriented)');
    expect(core[4]).toBe(850); // qty, exactly as entered
    expect(core[7]).toBe('designed'); // confidence
    expect(rows('Specification').find((r) => r[0] === 'Core limb diameter')).toEqual(['Core limb diameter', 260, 'mm']);
    expect(rows('Notes').some((r) => r[0] === 'designed')).toBe(true);
  });

  test('field list exposes sections, groups and the oil-only flag to the form', async () => {
    const res = await request(app).get('/api/fields').expect(200);
    const f = res.body.fields.find((x) => x.key === 'tankLengthMm');
    expect(f).toMatchObject({ section: 'designed', group: 'tank', oilOnly: true, unit: 'mm' });
    expect(res.body.designedGroups.map((g) => g.id)).toEqual(['masses', 'core-windings', 'tank']);
  });

  test('the downloadable template lists the designed columns, blank', async () => {
    const res = await request(app).get('/api/template.csv').expect(200);
    expect(res.text).toMatch(/Core limb diameter,,mm,optional/);
    expect(res.text).toMatch(/Radiator panels \(total\),,,optional/);
  });
});
