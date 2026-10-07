// Company-specific sizing rules for the BOM live here.
//
// !!! EVERYTHING IN THIS FILE IS A PLACEHOLDER !!!
// These are rough scaling laws so the pipeline produces plausible-looking
// output end to end. They are NOT engineering values. Replace each function
// with your real design rules (or with the output of your calculation sheets)
// before anyone relies on a quantity. Every BOM line that depends on this
// file is tagged confidence "estimate" so it stays visible in the UI and the
// Excel export until it is replaced.

const OIL_DENSITY_KG_PER_L = 0.88;

// Total mass of a typical distribution/power transformer ~ k · S^0.75 (kg, S in kVA).
const MASS_COEFFICIENT = 18;

// Share of total mass per component. The remainder is fittings, radiators, etc.
const MASS_SHARE = {
  oil: { core: 0.25, conductor: 0.15, insulation: 0.05, oil: 0.22, tank: 0.2 },
  dry: { core: 0.4, conductor: 0.25, insulation: 0.2 },
};

// Aluminium needs roughly half the mass of copper for the same resistance.
const CONDUCTOR_MASS_FACTOR = { Cu: 1, Al: 0.5 };

// Heat a radiator panel is assumed to dissipate (W).
const RADIATOR_W_PER_PANEL = 1500;

const roundTo = (value, step) => Math.round(value / step) * step;

function estimateMasses(spec) {
  const total = MASS_COEFFICIENT * spec.ratedPowerKva ** 0.75;
  const share = MASS_SHARE[spec.type];
  const conductorTotal = total * share.conductor * CONDUCTOR_MASS_FACTOR[spec.windingMaterial];
  const masses = {
    totalKg: roundTo(total, 5),
    coreKg: roundTo(total * share.core, 5),
    // HV and LV windings carry roughly equal conductor mass.
    hvConductorKg: roundTo(conductorTotal / 2, 5),
    lvConductorKg: roundTo(conductorTotal / 2, 5),
    insulationKg: roundTo(total * share.insulation, 5),
  };
  if (spec.type === 'oil') {
    masses.oilKg = roundTo(total * share.oil, 5);
    masses.oilLitres = roundTo(masses.oilKg / OIL_DENSITY_KG_PER_L, 5);
    masses.tankKg = roundTo(total * share.tank, 5);
  }
  return masses;
}

// Oil preservation when the spec does not say. Hermetic tanks are normal in the
// distribution range; larger units get a conservator.
function defaultSealing(spec) {
  return spec.ratedPowerKva > 1600 ? 'conservator' : 'hermetic';
}

function radiatorPanels(spec) {
  return Math.ceil((spec.p0W + spec.pkW) / RADIATOR_W_PER_PANEL);
}

module.exports = { estimateMasses, defaultSealing, radiatorPanels, MASS_COEFFICIENT, RADIATOR_W_PER_PANEL };
