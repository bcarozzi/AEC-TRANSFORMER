const { z } = require('zod');
const { FIELDS } = require('./fields');
const { parseVectorGroup } = require('./vectorGroup');
const { validateDesignData } = require('./dimensions');

// Highest voltage for equipment Um (kV), IEC 60076-3 / IEC 60038 series.
const UM_SERIES = [1.1, 3.6, 7.2, 12, 17.5, 24, 36, 52, 72.5, 100, 123, 145, 170, 245, 300, 362, 420, 550];

// Preferred rated powers, R10 series (kVA).
const R10_KVA = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000, 25000, 31500,
];

const COOLING_BY_TYPE = { oil: ['ONAN', 'ONAF'], dry: ['AN', 'AF'] };

function nextUm(unKv) {
  return UM_SERIES.find((um) => um >= unKv) ?? null;
}

// Accept "1,5" as well as 1.5; blanks become undefined so optional fields pass.
function toNumber(v) {
  if (v === '' || v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isNaN(n) ? v : n;
  }
  return v;
}

function toOptionalString(v) {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
}

const number = () => z.preprocess(toNumber, z.number({ invalid_type_error: 'must be a number', required_error: 'is required' }).finite());
const positive = () => number().pipe(z.number().positive('must be greater than 0'));
const optionalNumber = () => z.preprocess(toNumber, z.number({ invalid_type_error: 'must be a number' }).finite().optional());
const optionalPositive = () => z.preprocess(toNumber, z.number({ invalid_type_error: 'must be a number' }).positive('must be greater than 0').optional());

const optionalMass = () => z.preprocess(toNumber, z.number({ invalid_type_error: 'must be a number' }).positive('must be greater than 0').max(5_000_000, 'is unrealistically large').optional());
const optionalLength = () => z.preprocess(toNumber, z.number({ invalid_type_error: 'must be a number' }).positive('must be greater than 0').max(100_000, 'is unrealistically large').optional());

const SpecSchema = z.object({
  name: z.preprocess(toOptionalString, z.string().max(120).optional()),
  type: z.enum(['oil', 'dry']),
  ratedPowerKva: positive().pipe(z.number().max(1_000_000, 'is unrealistically large')),
  frequencyHz: number().pipe(z.number().refine((f) => f === 50 || f === 60, 'must be 50 or 60')),
  hvKv: positive().pipe(z.number().max(1200, 'is unrealistically large')),
  lvKv: positive().pipe(z.number().max(1200, 'is unrealistically large')),
  vectorGroup: z.string({ required_error: 'is required' }).trim().min(1, 'is required'),
  ukPct: positive().pipe(z.number().max(40, 'is unrealistically large')),
  p0W: positive(),
  pkW: positive(),
  i0Pct: optionalPositive().pipe(z.number().max(20).optional()),
  cooling: z.enum(['ONAN', 'ONAF', 'AN', 'AF']),
  windingMaterial: z.enum(['Cu', 'Al']),
  tapType: z.enum(['none', 'OCTC', 'OLTC']),
  tapStepPct: optionalPositive().pipe(z.number().max(10).optional()),
  tapStepsEachSide: optionalNumber().pipe(z.number().int('must be a whole number').min(0).max(32).optional()),
  sealing: z.enum(['hermetic', 'conservator']).optional(),
  hvBilKv: optionalPositive(),
  hvAcKv: optionalPositive(),

  // As-designed data (optional). Upper bounds only catch unit slips (m for mm, t for kg).
  totalMassKg: optionalMass(),
  coreMassKg: optionalMass(),
  hvConductorMassKg: optionalMass(),
  lvConductorMassKg: optionalMass(),
  insulationMassKg: optionalMass(),
  oilLitres: optionalMass(),
  tankMassKg: optionalMass(),
  coreDiameterMm: optionalLength(),
  windowHeightMm: optionalLength(),
  phasePitchMm: optionalLength(),
  lvInnerDiameterMm: optionalLength(),
  lvOuterDiameterMm: optionalLength(),
  hvInnerDiameterMm: optionalLength(),
  hvOuterDiameterMm: optionalLength(),
  lvHeightMm: optionalLength(),
  hvHeightMm: optionalLength(),
  tankLengthMm: optionalLength(),
  tankWidthMm: optionalLength(),
  tankHeightMm: optionalLength(),
  radiatorPanels: z.preprocess(toNumber, z.number({ invalid_type_error: 'must be a number' }).int('must be a whole number').positive('must be greater than 0').max(400, 'is unrealistically large').optional()),
});

function blankToUndefined(v) {
  return v === '' || v === null ? undefined : v;
}

// Fill documented defaults before validation. Cooling depends on type.
function withDefaults(raw) {
  const input = { ...(raw ?? {}) };
  for (const f of FIELDS) input[f.key] = blankToUndefined(input[f.key]);
  const out = { ...input };
  for (const f of FIELDS) {
    if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  }
  if (out.cooling === undefined) {
    out.cooling = COOLING_BY_TYPE[out.type === 'dry' ? 'dry' : 'oil'][0];
  }
  return out;
}

// Returns { ok: true, spec, vectorGroup, warnings } or { ok: false, errors: [{field, message}] }.
// Independent problems are all reported in one pass, so a form can show them together.
function validateSpec(raw) {
  const candidate = withDefaults(raw);
  const parsed = SpecSchema.safeParse(candidate);
  const errors = [];
  const labelOf = (field) => FIELDS.find((f) => f.key === field)?.label ?? field;

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] ?? '_';
      errors.push({ field, message: `${labelOf(field)} ${issue.message}`.replace(/\s+/g, ' ') });
    }
  }

  // Cross-field checks run only when the fields they read are individually valid.
  const bad = (...fields) => errors.some((e) => fields.includes(e.field));
  const num = (key) => {
    const v = toNumber(candidate[key]);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };

  let vg = null;
  if (!bad('vectorGroup')) {
    vg = parseVectorGroup(candidate.vectorGroup);
    if (!vg.ok) errors.push({ field: 'vectorGroup', message: vg.error });
  }
  if (!bad('type', 'cooling') && !COOLING_BY_TYPE[candidate.type].includes(candidate.cooling)) {
    errors.push({
      field: 'cooling',
      message: `Cooling ${candidate.cooling} does not apply to ${candidate.type}-type transformers (use ${COOLING_BY_TYPE[candidate.type].join(' or ')})`,
    });
  }
  if (!bad('type', 'sealing') && candidate.type === 'dry' && candidate.sealing) {
    errors.push({ field: 'sealing', message: 'Oil preservation only applies to oil-immersed transformers' });
  }
  if (!bad('hvKv', 'lvKv') && num('hvKv') <= num('lvKv')) {
    errors.push({ field: 'hvKv', message: 'HV voltage must be higher than LV voltage (step-down transformers only for now)' });
  }
  if (!bad('pkW', 'ratedPowerKva', 'ukPct')) {
    const urPct = (num('pkW') / 1000 / num('ratedPowerKva')) * 100;
    if (urPct >= num('ukPct')) {
      errors.push({ field: 'pkW', message: `Load losses give a resistive drop of ${urPct.toFixed(2)}%, which cannot be ≥ uk (${num('ukPct')}%)` });
    }
  }
  if (!bad('tapType', 'tapStepsEachSide') && candidate.tapType !== 'none' && num('tapStepsEachSide') < 1) {
    errors.push({ field: 'tapStepsEachSide', message: 'A tap changer needs at least one step each side (choose "none" for a fixed ratio)' });
  }

  let designWarnings = [];
  if (parsed.success) {
    const design = validateDesignData(parsed.data, nextUm(parsed.data.hvKv));
    errors.push(...design.errors);
    designWarnings = design.warnings;
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, spec: parsed.data, vectorGroup: vg, warnings: [...crossChecks(parsed.data), ...designWarnings] };
}

// Soft plausibility checks: never block, but tell the engineer.
function crossChecks(spec) {
  const w = [];
  if (!R10_KVA.includes(spec.ratedPowerKva)) {
    w.push({ field: 'ratedPowerKva', level: 'info', message: `${spec.ratedPowerKva} kVA is not on the R10 preferred series` });
  }
  if (spec.ukPct < 3 || spec.ukPct > 15) {
    w.push({ field: 'ukPct', level: 'warning', message: `uk = ${spec.ukPct}% is outside the usual 3-15% range for power transformers` });
  }
  if (spec.p0W > spec.pkW) {
    w.push({ field: 'p0W', level: 'warning', message: 'No-load losses exceed load losses: check the values are not swapped' });
  }
  const totalPct = ((spec.p0W + spec.pkW) / 1000 / spec.ratedPowerKva) * 100;
  if (totalPct > 3) {
    w.push({ field: 'pkW', level: 'warning', message: `Total losses are ${totalPct.toFixed(2)}% of rated power, which is unusually high` });
  }
  if (nextUm(spec.hvKv) === null) {
    w.push({ field: 'hvKv', level: 'warning', message: `No standard Um found for ${spec.hvKv} kV` });
  }
  if (spec.hvBilKv && !spec.hvAcKv) {
    w.push({ field: 'hvAcKv', level: 'info', message: 'BIL given without a power-frequency withstand value' });
  }
  return w;
}

module.exports = { validateSpec, withDefaults, nextUm, SpecSchema, R10_KVA, UM_SERIES, COOLING_BY_TYPE };
