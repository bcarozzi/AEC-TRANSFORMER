// Company-specific sizing rules for the 3D model live here.
//
// !!! EVERYTHING IN THIS FILE IS A PLACEHOLDER !!!
// These are rough scaling laws so the model looks like a plausible transformer
// of the right rating. They are NOT design dimensions: a real design comes from
// your calculation sheets and drawings. Replace each function with your rules
// (or feed measured dimensions in) before anyone relies on a size.
// All lengths are millimetres.

// Core limb diameter grows roughly with S^0.35.
const coreDiameterMm = (kva) => 22 * kva ** 0.35;

// Window height as a multiple of limb diameter.
const windowHeightMm = (d) => 2.6 * d;
const yokeHeightMm = (d) => 0.85 * d;

// Winding build, as fractions of the core diameter.
const LV_RADIAL = 0.1;
const DUCT_RADIAL = 0.1;
const HV_RADIAL = 0.14;
const CORE_TO_LV_GAP_MM = 12;
const END_INSULATION_MM = 40; // each end of the winding stack

// Clearance from active part to tank wall and space above the core, growing with Um (kV).
const clearanceMm = (umKv) => 50 + 3 * umKv;
const spaceAboveMm = (umKv) => 120 + 5 * umKv;

const wallThicknessMm = (kva) => Math.min(8, 3 + 0.003 * kva);

// Bushing size from highest voltage for equipment Um (kV).
const bushingHeightMm = (umKv) => 140 + 10 * umKv;
const bushingRadiusMm = (umKv) => 30 + umKv;

module.exports = {
  coreDiameterMm,
  windowHeightMm,
  yokeHeightMm,
  LV_RADIAL,
  DUCT_RADIAL,
  HV_RADIAL,
  CORE_TO_LV_GAP_MM,
  END_INSULATION_MM,
  clearanceMm,
  spaceAboveMm,
  wallThicknessMm,
  bushingHeightMm,
  bushingRadiusMm,
};
