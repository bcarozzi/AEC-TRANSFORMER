// Import transformer specs from CSV / XLSX data tables.
//
// Two layouts are detected automatically:
//   key/value : parameter names down column A, values in column B (optional unit in C)
//   tabular   : parameter names across row 1, one transformer per following row
//
// The importer never guesses silently: everything it could not map or had to
// reinterpret comes back as a note so the engineer can check it in the review form.

const Papa = require('papaparse');
const ExcelJS = require('exceljs');
const { FIELDS, normaliseHeader } = require('../fields');
const { validateSpec } = require('../spec');

const MAX_ROWS = 2000;

// alias (normalised) -> field
const ALIAS_MAP = new Map();
for (const f of FIELDS) {
  ALIAS_MAP.set(normaliseHeader(f.key), f);
  ALIAS_MAP.set(normaliseHeader(f.label), f);
  for (const a of f.aliases) ALIAS_MAP.set(normaliseHeader(a), f);
}

// "Rated power [kVA]" -> { label: "Rated power", unit: "kVA" }
function splitHeader(text) {
  const t = String(text ?? '').trim();
  const m = /^(.*?)\s*[[(]\s*([^\])]+?)\s*[\])]\s*$/.exec(t);
  return m ? { label: m[1], unit: m[2] } : { label: t, unit: null };
}

// Header units count only if they are a unit this field understands; a bracket
// like "(P0)" or "(line-to-line)" is a qualifier, not a unit.
function recognisedUnit(field, unit) {
  if (!unit || !field.unitFactors) return null;
  return field.unitFactors[normaliseHeader(unit)] !== undefined ? unit : null;
}

function fieldForHeader(text) {
  const { label, unit } = splitHeader(text);
  const byLabel = ALIAS_MAP.get(normaliseHeader(label));
  if (byLabel) return { field: byLabel, unit: recognisedUnit(byLabel, unit) };
  const whole = ALIAS_MAP.get(normaliseHeader(text));
  return whole ? { field: whole, unit: null } : null;
}

// Locale-tolerant number parse: "1,5", "1.5", "1.234,5", "1,234.5", "20 kV".
function parseNumberText(text) {
  const m = /^([+-]?\s*[\d.,\s]+?)\s*([A-Za-zµ%]*)$/.exec(String(text).trim());
  if (!m) return null;
  let digits = m[1].replace(/\s/g, '');
  if (digits === '' || !/\d/.test(digits)) return null;
  const note = [];
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    digits = digits.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    if (/^[+-]?\d{1,3}[.,]\d{3}$/.test(digits)) {
      note.push(`"${m[1].trim()}" is ambiguous (decimal or thousands separator); read as a decimal`);
    }
    digits = digits.replace(',', '.');
  }
  const value = Number(digits);
  if (Number.isNaN(value)) return null;
  return { value, unit: m[2] || null, note };
}

const VG_CASE_RE = /^(yn|y|d|zn|z)(yn|y|d|zn|z)(\d{1,2})$/i;

function parseValue(field, rawValue, unitHint, context) {
  const notes = [];
  const text = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (text === '' || text === null || text === undefined) return { value: undefined, notes };

  if (field.type === 'number') {
    if (typeof text === 'number') {
      return { value: applyUnit(field, text, unitHint, notes, context), notes };
    }
    const parsed = parseNumberText(text);
    if (!parsed) {
      notes.push({ field: field.key, level: 'warning', message: `${context}: cannot read "${text}" as a number` });
      return { value: text, notes };
    }
    parsed.note.forEach((message) => notes.push({ field: field.key, level: 'warning', message: `${context}: ${message}` }));
    return { value: applyUnit(field, parsed.value, parsed.unit ?? unitHint, notes, context), notes };
  }

  if (field.type === 'enum') {
    const norm = normaliseHeader(text);
    for (const option of field.options) {
      if (normaliseHeader(option) === norm) return { value: option, notes };
    }
    for (const [option, aliases] of Object.entries(field.valueAliases ?? {})) {
      if (aliases.map(normaliseHeader).includes(norm)) return { value: option, notes };
    }
    notes.push({ field: field.key, level: 'warning', message: `${context}: "${text}" is not a recognised ${field.label.toLowerCase()}` });
    return { value: text, notes };
  }

  if (field.key === 'vectorGroup') {
    const m = VG_CASE_RE.exec(String(text).replace(/\s/g, ''));
    if (m) {
      const fixed = `${m[1].toUpperCase()}${m[2].toLowerCase()}${m[3]}`;
      if (fixed !== text) notes.push({ field: field.key, level: 'info', message: `${context}: vector group "${text}" written as ${fixed}` });
      return { value: fixed, notes };
    }
  }
  return { value: String(text), notes };
}

function applyUnit(field, value, unit, notes, context) {
  if (!unit || !field.unitFactors) return value;
  const factor = field.unitFactors[normaliseHeader(unit)];
  if (factor === undefined) {
    if (normaliseHeader(unit) !== normaliseHeader(field.unit ?? '')) {
      notes.push({ field: field.key, level: 'warning', message: `${context}: unknown unit "${unit}", value taken as ${field.unit}` });
    }
    return value;
  }
  return value * factor;
}

// --- file readers -> array of rows (array of cell texts/numbers) ---

function readCsv(text) {
  const clean = String(text).replace(/^﻿/, '');
  const result = Papa.parse(clean, { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
  return result.data;
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return v;
}

async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= MAX_ROWS) return;
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col - 1] = cellValue(cell.value);
      });
      rows.push(Array.from(cells, (c) => c ?? ''));
    });
    if (rows.length) return rows;
  }
  return [];
}

// --- layout detection ---

function countRecognised(texts) {
  return new Set(texts.map((t) => fieldForHeader(t)?.field.key).filter(Boolean)).size;
}

function rowsToRecords(rows) {
  const rowCount = Math.min(rows.length, MAX_ROWS);
  rows = rows.slice(0, rowCount);
  if (!rows.length) return { layout: 'empty', records: [], ignored: [] };

  const headerRowScore = countRecognised(rows[0]);
  const firstColScore = countRecognised(rows.map((r) => r[0]));

  if (firstColScore > headerRowScore) {
    // key/value layout
    const entries = [];
    const ignored = [];
    rows.forEach((r) => {
      const hit = fieldForHeader(r[0]);
      if (!hit) {
        if (String(r[0] ?? '').trim()) ignored.push(String(r[0]));
        return;
      }
      const third = String(r[2] ?? '').trim();
      entries.push({ field: hit.field, value: r[1], unit: hit.unit ?? recognisedUnit(hit.field, third), where: `row "${r[0]}"` });
    });
    return { layout: 'key-value', records: [entries], ignored };
  }

  if (headerRowScore === 0) return { layout: 'unrecognised', records: [], ignored: rows[0].map(String) };

  const columns = rows[0].map((h) => ({ header: String(h), hit: fieldForHeader(h) }));
  const ignored = columns.filter((c) => !c.hit && c.header.trim()).map((c) => c.header);
  const records = rows.slice(1).map((r, i) => {
    const entries = [];
    columns.forEach((c, idx) => {
      if (!c.hit) return;
      entries.push({ field: c.hit.field, value: r[idx], unit: c.hit.unit, where: `row ${i + 2}, column "${c.header}"` });
    });
    return entries;
  });
  return { layout: 'tabular', records: records.filter((e) => e.some((x) => String(x.value ?? '').trim() !== '')), ignored };
}

function recordToCandidate(entries, index) {
  const values = {};
  const notes = [];
  for (const e of entries) {
    const { value, notes: n } = parseValue(e.field, e.value, e.unit, e.where);
    notes.push(...n);
    if (value !== undefined) values[e.field.key] = value;
  }
  const validation = validateSpec(values);
  return {
    index,
    values,
    notes,
    validation: validation.ok
      ? { ok: true, warnings: validation.warnings }
      : { ok: false, errors: validation.errors },
  };
}

function importRows(rows) {
  const { layout, records, ignored } = rowsToRecords(rows);
  return { layout, ignoredColumns: ignored, specs: records.map(recordToCandidate) };
}

async function importTable(buffer, filename) {
  const ext = String(filename ?? '').toLowerCase().split('.').pop();
  let rows;
  if (ext === 'xlsx') rows = await readXlsx(buffer);
  else if (ext === 'csv' || ext === 'txt' || ext === 'tsv') rows = readCsv(buffer.toString('utf8'));
  else throw new Error(`Unsupported file type ".${ext}" (expected .xlsx or .csv)`);
  return importRows(rows);
}

module.exports = { importTable, importRows, readCsv, parseNumberText, splitHeader };
