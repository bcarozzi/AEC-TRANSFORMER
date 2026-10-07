const ExcelJS = require('exceljs');
const { importRows, importTable, parseNumberText, readCsv, splitHeader } = require('../src/importers/table');
const { templateCsv } = require('../src/template');

describe('parseNumberText', () => {
  test.each([
    ['1000', 1000, null],
    ['0,4', 0.4, null],
    ['0.4', 0.4, null],
    ['1.234,5', 1234.5, null],
    ['1,234.5', 1234.5, null],
    ['20 kV', 20, 'kV'],
    ['6%', 6, '%'],
    ['  1 500 ', 1500, null],
  ])('%s', (text, value, unit) => {
    expect(parseNumberText(text)).toMatchObject({ value, unit });
  });

  test('flags the 1.100 / 1,100 ambiguity instead of guessing silently', () => {
    expect(parseNumberText('1.100').note[0]).toMatch(/ambiguous/);
    expect(parseNumberText('1,100').note[0]).toMatch(/ambiguous/);
    expect(parseNumberText('1.1').note).toEqual([]);
  });

  test('rejects garbage', () => {
    expect(parseNumberText('abc')).toBeNull();
    expect(parseNumberText('')).toBeNull();
  });
});

describe('splitHeader', () => {
  test('separates bracketed units', () => {
    expect(splitHeader('Rated power [kVA]')).toEqual({ label: 'Rated power', unit: 'kVA' });
    expect(splitHeader('Tensione (kV)')).toEqual({ label: 'Tensione', unit: 'kV' });
    expect(splitHeader('uk')).toEqual({ label: 'uk', unit: null });
  });
});

describe('tabular layout', () => {
  const rows = [
    ['Name', 'Rated power [kVA]', 'HV voltage [kV]', 'LV voltage [V]', 'Vector group', 'uk [%]', 'P0 [W]', 'Pk [kW]', 'Colour'],
    ['T-A', 1000, 20, 400, 'Dyn11', 6, 1100, 10.5, 'grey'],
    ['T-B', 630, 15, 400, 'Dyn11', 4, 800, 6.5, 'grey'],
  ];

  test('reads one transformer per row and converts units', () => {
    const r = importRows(rows);
    expect(r.layout).toBe('tabular');
    expect(r.specs).toHaveLength(2);
    expect(r.specs[0].values).toMatchObject({ name: 'T-A', ratedPowerKva: 1000, hvKv: 20, lvKv: 0.4, pkW: 10500 });
    expect(r.specs[0].validation.ok).toBe(true);
    expect(r.specs[1].values.hvKv).toBe(15);
  });

  test('reports columns it could not map', () => {
    expect(importRows(rows).ignoredColumns).toEqual(['Colour']);
  });

  test('a row with problems carries field-level errors, not an exception', () => {
    const bad = [rows[0], ['T-C', 1000, 20, 400, 'Dyn10', 6, 1100, 10.5, '']];
    const r = importRows(bad);
    expect(r.specs[0].validation.ok).toBe(false);
    expect(r.specs[0].validation.errors.map((e) => e.field)).toContain('vectorGroup');
  });

  test('skips blank rows', () => {
    expect(importRows([rows[0], rows[1], ['', '', '', '', '', '', '', '', '']]).specs).toHaveLength(1);
  });

  test('flags unreadable numbers and unknown units', () => {
    const r = importRows([['Rated power', 'HV'], ['lots', '20 furlongs']]);
    const msgs = r.specs[0].notes.map((n) => n.message).join(' | ');
    expect(msgs).toMatch(/cannot read "lots"/);
    expect(msgs).toMatch(/unknown unit "furlongs"/);
  });
});

describe('key/value layout', () => {
  test('reads Italian parameter names and the unit column', () => {
    const r = importRows([
      ['Potenza nominale', '1', 'MVA'],
      ['Tensione primaria', '20', 'kV'],
      ['Tensione secondaria', '400', 'V'],
      ['Gruppo vettoriale', 'DYN11'],
      ['Tensione di cortocircuito', '6'],
      ['Perdite a vuoto', '1,1', 'kW'],
      ['Perdite a carico', '10,5', 'kW'],
      ['Raffreddamento', 'ONAN'],
      ['Tipo', 'olio'],
      ['Avvolgimenti', 'Rame'],
      ['Regolazione', 'sottocarico'],
    ]);
    expect(r.layout).toBe('key-value');
    expect(r.specs).toHaveLength(1);
    expect(r.specs[0].values).toMatchObject({
      ratedPowerKva: 1000, hvKv: 20, lvKv: 0.4, vectorGroup: 'Dyn11', ukPct: 6, p0W: 1100, pkW: 10500,
      type: 'oil', windingMaterial: 'Cu', tapType: 'OLTC',
    });
    expect(r.specs[0].validation.ok).toBe(true);
    expect(r.specs[0].notes.map((n) => n.message).join()).toMatch(/DYN11" written as Dyn11/);
  });

  test('brackets like (P0) are qualifiers, not units', () => {
    const r = importRows([['No-load losses (P0)', '1100'], ['Rated power', '1000'], ['Load losses', '10500']]);
    expect(r.specs[0].values.p0W).toBe(1100);
    expect(r.specs[0].notes).toEqual([]);
  });
});

describe('edge cases', () => {
  test('empty and unrecognised input', () => {
    expect(importRows([]).specs).toEqual([]);
    expect(importRows([['foo', 'bar'], [1, 2]])).toMatchObject({ layout: 'unrecognised', specs: [] });
  });

  test('caps row count', () => {
    const rows = [['Rated power [kVA]', 'HV [kV]'], ...Array.from({ length: 5000 }, () => [1000, 20])];
    expect(importRows(rows).specs.length).toBeLessThanOrEqual(2000);
  });
});

describe('files', () => {
  test('CSV with semicolons and decimal commas (Italian Excel export)', async () => {
    const csv = '﻿Nome;Potenza [kVA];Tensione primaria [kV];Tensione secondaria [kV];Gruppo vettoriale;uk [%];P0 [W];Pk [W]\n'
      + 'T1;1000;20;0,4;Dyn11;6;1100;10500\n';
    const r = await importTable(Buffer.from(csv), 'dati.csv');
    expect(r.specs[0].values).toMatchObject({ name: 'T1', lvKv: 0.4, ratedPowerKva: 1000 });
    expect(r.specs[0].validation.ok).toBe(true);
  });

  test('XLSX round trip', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Name', 'Rated power [kVA]', 'HV [kV]', 'LV [kV]', 'Vector group', 'uk [%]', 'P0 [W]', 'Pk [W]']);
    ws.addRow(['X1', 1600, 20, 0.4, 'Dyn11', 6, 1700, 14000]);
    ws.addRow(['X2', 2500, 20, 0.69, 'Dyn11', 6, 2200, 21000]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await importTable(buffer, 'plant.XLSX');
    expect(r.specs.map((s) => s.values.name)).toEqual(['X1', 'X2']);
    expect(r.specs.every((s) => s.validation.ok)).toBe(true);
  });

  test('XLSX formula cells use their cached result', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Data');
    ws.addRow(['Rated power [kVA]', 'HV [kV]']);
    ws.addRow([{ formula: '500+500', result: 1000 }, 20]);
    const r = await importTable(Buffer.from(await wb.xlsx.writeBuffer()), 'f.xlsx');
    expect(r.specs[0].values.ratedPowerKva).toBe(1000);
  });

  test('rejects other file types and corrupt xlsx', async () => {
    await expect(importTable(Buffer.from('x'), 'drawing.dwg')).rejects.toThrow(/Unsupported file type/);
    await expect(importTable(Buffer.from('not a zip'), 'broken.xlsx')).rejects.toThrow();
  });

  test('the downloadable template imports back into a valid spec', async () => {
    const r = await importTable(Buffer.from(templateCsv()), 'template.csv');
    expect(r.layout).toBe('key-value');
    expect(r.specs[0].validation.ok).toBe(true);
    expect(r.specs[0].notes).toEqual([]);
    expect(r.specs[0].values).toMatchObject({ ratedPowerKva: 1000, hvKv: 20, lvKv: 0.4, vectorGroup: 'Dyn11', pkW: 10500 });
  });

  test('readCsv copes with quotes', () => {
    expect(readCsv('a,b\n"x,y",2\n')).toEqual([['a', 'b'], ['x,y', '2']]);
  });
});
