const ExcelJS = require('exceljs');
const { FIELDS } = require('../fields');

const CONFIDENCE_FILL = {
  derived: 'FFE3F1E6',
  catalog: 'FFE3F1E6',
  default: 'FFF3F2EC',
  estimate: 'FFFFF1CC',
  unmatched: 'FFFBD9D9',
};

const CONFIDENCE_HELP = {
  derived: 'Follows directly from the specification',
  catalog: 'Catalog item chosen by rating',
  default: 'Standard accessory set assumed',
  estimate: 'PLACEHOLDER sizing rule: replace before relying on it',
  unmatched: 'Nothing in the catalog fits: needs a human',
};

async function bomWorkbook(spec, derived, bom) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'transformer-designer';
  wb.created = new Date();

  const ws = wb.addWorksheet('BOM', { views: [{ state: 'frozen', ySplit: 4 }] });
  ws.columns = [
    { key: 'no', width: 6 },
    { key: 'group', width: 26 },
    { key: 'item', width: 38 },
    { key: 'description', width: 44 },
    { key: 'qty', width: 10 },
    { key: 'unit', width: 8 },
    { key: 'code', width: 18 },
    { key: 'confidence', width: 13 },
    { key: 'basis', width: 70 },
  ];

  ws.getCell('A1').value = `Bill of materials: ${spec.name || 'Transformer'}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = `${spec.ratedPowerKva} kVA, ${spec.hvKv}/${spec.lvKv} kV, ${spec.vectorGroup}, ${spec.cooling}`;
  const header = ws.getRow(4);
  header.values = ['#', 'Group', 'Item', 'Description', 'Qty', 'Unit', 'Catalog code', 'Confidence', 'Basis'];
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDE3EA' } };
    c.border = { bottom: { style: 'thin' } };
  });

  bom.lines.forEach((l, i) => {
    const row = ws.addRow({
      no: i + 1, group: l.group, item: l.item, description: l.description, qty: l.qty, unit: l.unit,
      code: l.code ?? '', confidence: l.confidence, basis: l.basis,
    });
    row.getCell('confidence').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CONFIDENCE_FILL[l.confidence] ?? 'FFFFFFFF' } };
    row.getCell('qty').alignment = { horizontal: 'right' };
  });

  const notes = wb.addWorksheet('Notes');
  notes.columns = [{ width: 16 }, { width: 100 }];
  notes.addRow(['Confidence', 'Meaning']).font = { bold: true };
  Object.entries(CONFIDENCE_HELP).forEach(([k, v]) => notes.addRow([k, v]));
  notes.addRow([]);
  if (bom.catalogNotice) notes.addRow(['Catalog', bom.catalogNotice]);
  bom.assumptions.forEach((a) => notes.addRow(['Assumption', a]));
  bom.warnings.forEach((w) => notes.addRow(['Warning', w]));

  const sheet = wb.addWorksheet('Specification');
  sheet.columns = [{ width: 42 }, { width: 18 }, { width: 8 }];
  sheet.addRow(['Parameter', 'Value', 'Unit']).font = { bold: true };
  FIELDS.forEach((f) => {
    const v = spec[f.key];
    if (v !== undefined) sheet.addRow([f.label, v, f.unit ?? '']);
  });
  sheet.addRow([]);
  sheet.addRow(['Derived', '', '']).font = { bold: true };
  sheet.addRow(['Rated current HV', Number(derived.currents.hvA.toFixed(2)), 'A']);
  sheet.addRow(['Rated current LV', Number(derived.currents.lvA.toFixed(1)), 'A']);
  sheet.addRow(['Resistive drop ur', Number(derived.impedance.urPct.toFixed(3)), '%']);
  sheet.addRow(['Reactive drop ux', Number(derived.impedance.uxPct.toFixed(3)), '%']);
  sheet.addRow(['Efficiency at rated load, cos φ = 1', Number(derived.efficiency.ratedPf1Pct.toFixed(3)), '%']);
  sheet.addRow(['Maximum efficiency load factor', Number(derived.efficiency.maxLoadFactor.toFixed(3)), '']);

  return wb;
}

module.exports = { bomWorkbook };
