// Electrical performance of a three-phase two-winding transformer, from
// nameplate data. Formulas follow IEC 60076-1 (approximate voltage regulation)
// and standard per-phase star-equivalent circuit practice.

const SQRT3 = Math.sqrt(3);
const { nextUm } = require('./spec');

const rad = (deg) => (deg * Math.PI) / 180;

function ratedCurrentA(powerKva, lineKv) {
  return (powerKva * 1000) / (SQRT3 * lineKv * 1000);
}

// Impedance split. uk, ur, ux all in % of rated.
function impedance(spec) {
  const ur = (spec.pkW / 1000 / spec.ratedPowerKva) * 100;
  const ux = Math.sqrt(spec.ukPct ** 2 - ur ** 2);
  return { ukPct: spec.ukPct, urPct: ur, uxPct: ux };
}

// Per-phase (star-equivalent) series branch + optional magnetising branch,
// referred to one winding. Zbase = U² / S.
function equivalentCircuit(spec, imp, lineKv) {
  const uV = lineKv * 1000;
  const zBase = (uV * uV) / (spec.ratedPowerKva * 1000);
  const rk = (imp.urPct / 100) * zBase;
  const xk = (imp.uxPct / 100) * zBase;
  const rm = (uV * uV) / spec.p0W;

  let xm = null;
  if (spec.i0Pct) {
    const iN = ratedCurrentA(spec.ratedPowerKva, lineKv);
    const i0 = (spec.i0Pct / 100) * iN;
    const iFe = spec.p0W / (SQRT3 * uV);
    if (i0 > iFe) {
      const iMu = Math.sqrt(i0 ** 2 - iFe ** 2);
      xm = uV / SQRT3 / iMu;
    }
  }
  return { voltageKv: lineKv, zBaseOhm: zBase, rkOhm: rk, xkOhm: xk, zkOhm: (imp.ukPct / 100) * zBase, rmOhm: rm, xmOhm: xm };
}

// Efficiency (%) at load factor k and power factor cosφ.
function efficiencyPct(spec, k, pf) {
  const out = k * spec.ratedPowerKva * 1000 * pf;
  return (out / (out + spec.p0W + k * k * spec.pkW)) * 100;
}

// Voltage regulation (%) at load factor k. phiDeg > 0 lagging, < 0 leading.
// IEC 60076-1 approximation: k(ur·cosφ + ux·sinφ) + k²(ux·cosφ − ur·sinφ)²/200
function regulationPct(imp, k, phiDeg) {
  const c = Math.cos(rad(phiDeg));
  const s = Math.sin(rad(phiDeg));
  return k * (imp.urPct * c + imp.uxPct * s) + (k * k * (imp.uxPct * c - imp.urPct * s) ** 2) / 200;
}

// Taps on the HV winding: position 1 is the highest voltage (most turns).
function tapTable(spec) {
  if (spec.tapType === 'none') return [];
  const rows = [];
  for (let i = -spec.tapStepsEachSide; i <= spec.tapStepsEachSide; i += 1) {
    const pct = i === 0 ? 0 : -i * spec.tapStepPct;
    rows.push({
      position: i + spec.tapStepsEachSide + 1,
      percent: pct,
      hvKv: spec.hvKv * (1 + pct / 100),
    });
  }
  // Positions run from highest voltage down.
  return rows.sort((a, b) => b.percent - a.percent).map((r, idx) => ({ ...r, position: idx + 1 }));
}

// Load factors 0.05 .. 1.2 in steps of 0.05.
const LOAD_FACTORS = Array.from({ length: 24 }, (_, i) => Math.round((i + 1) * 5) / 100);

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function curves(spec, imp) {
  return {
    loadFactors: LOAD_FACTORS,
    efficiency: [
      { id: 'pf1', label: 'cos φ = 1', values: LOAD_FACTORS.map((k) => round(efficiencyPct(spec, k, 1), 4)) },
      { id: 'pf08', label: 'cos φ = 0.8', values: LOAD_FACTORS.map((k) => round(efficiencyPct(spec, k, 0.8), 4)) },
    ],
    regulation: [
      { id: 'pf1', label: 'cos φ = 1', values: LOAD_FACTORS.map((k) => round(regulationPct(imp, k, 0), 4)) },
      { id: 'pf08lag', label: 'cos φ = 0.8 lagging', values: LOAD_FACTORS.map((k) => round(regulationPct(imp, k, Math.acos(0.8) * 180 / Math.PI), 4)) },
      { id: 'pf08lead', label: 'cos φ = 0.8 leading', values: LOAD_FACTORS.map((k) => round(regulationPct(imp, k, -Math.acos(0.8) * 180 / Math.PI), 4)) },
    ],
  };
}

function derive(spec, vectorGroup) {
  const imp = impedance(spec);
  const kMax = Math.sqrt(spec.p0W / spec.pkW);
  const phi08 = (Math.acos(0.8) * 180) / Math.PI;

  return {
    umHvKv: nextUm(spec.hvKv),
    umLvKv: nextUm(spec.lvKv),
    ratio: spec.hvKv / spec.lvKv,
    currents: {
      hvA: ratedCurrentA(spec.ratedPowerKva, spec.hvKv),
      lvA: ratedCurrentA(spec.ratedPowerKva, spec.lvKv),
    },
    vectorGroup,
    impedance: imp,
    equivalentCircuit: {
      hv: equivalentCircuit(spec, imp, spec.hvKv),
      lv: equivalentCircuit(spec, imp, spec.lvKv),
    },
    taps: tapTable(spec),
    efficiency: {
      ratedPf1Pct: efficiencyPct(spec, 1, 1),
      ratedPf08Pct: efficiencyPct(spec, 1, 0.8),
      maxLoadFactor: kMax,
      maxPf1Pct: efficiencyPct(spec, kMax, 1),
    },
    regulation: {
      ratedPf1Pct: regulationPct(imp, 1, 0),
      ratedPf08LagPct: regulationPct(imp, 1, phi08),
      ratedPf08LeadPct: regulationPct(imp, 1, -phi08),
    },
    totalLossesW: spec.p0W + spec.pkW,
    curves: curves(spec, imp),
  };
}

module.exports = { derive, impedance, efficiencyPct, regulationPct, ratedCurrentA, tapTable, equivalentCircuit };
