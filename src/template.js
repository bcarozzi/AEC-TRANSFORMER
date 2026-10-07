const { FIELDS } = require('./fields');

const EXAMPLES = {
  name: 'TR-001', type: 'oil', ratedPowerKva: 1000, frequencyHz: 50, hvKv: 20, lvKv: 0.4,
  vectorGroup: 'Dyn11', ukPct: 6, p0W: 1100, pkW: 10500, i0Pct: 0.3, cooling: 'ONAN',
  windingMaterial: 'Cu', tapType: 'OCTC', tapStepPct: 2.5, tapStepsEachSide: 2,
  sealing: '', hvBilKv: 125, hvAcKv: 50,
};

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Key/value CSV the importer reads back unchanged.
function templateCsv() {
  const rows = [['Parameter', 'Value', 'Unit', 'Notes']];
  for (const f of FIELDS) {
    const notes = [f.required ? 'required' : 'optional'];
    if (f.options) notes.push(`one of ${f.options.join(', ')}`);
    if (f.default !== undefined) notes.push(`default ${f.default}`);
    rows.push([f.label, EXAMPLES[f.key] ?? '', f.unit ?? '', notes.join('; ')]);
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}

module.exports = { templateCsv };
