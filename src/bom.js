const fs = require('fs');
const path = require('path');
const defaultRules = require('./bomRules');

const DEFAULT_CATALOG_PATH = path.join(__dirname, '..', 'data', 'catalog.json');

// Line confidence, most to least certain:
//   derived   - follows directly from the spec (e.g. bushing count from the vector group)
//   catalog   - catalog item picked by rating (smallest class and current that fit)
//   default   - standard accessory set assumed; edit if your product differs
//   estimate  - placeholder sizing rule from bomRules.js, must be replaced
//   unmatched - nothing in the catalog fits; needs a human
const CONFIDENCE = ['derived', 'catalog', 'default', 'estimate', 'unmatched'];

function loadCatalog(file = DEFAULT_CATALOG_PATH) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.items)) throw new Error(`Catalog ${file} has no "items" array`);
  return data;
}

// Smallest voltage class, then smallest current, that satisfies the need.
function pick(catalog, { category, minClassKv, minCurrentA, minPositions }) {
  return catalog.items
    .filter((i) => i.category === category)
    .filter((i) => i.voltageClassKv >= minClassKv && i.ratedCurrentA >= minCurrentA)
    .filter((i) => minPositions === undefined || i.maxPositions >= minPositions)
    .sort((a, b) => a.voltageClassKv - b.voltageClassKv || a.ratedCurrentA - b.ratedCurrentA)[0];
}

function fixedItem(catalog, key) {
  return catalog.items.find((i) => i.category === 'accessory' && i.key === key);
}

function generateBom(spec, derived, { catalog = loadCatalog(), rules = defaultRules } = {}) {
  const lines = [];
  const warnings = [];
  const assumptions = [];

  const add = (group, item, qty, unit, confidence, basis, entry = null) => {
    lines.push({
      group,
      item,
      description: entry?.description ?? '',
      qty,
      unit,
      confidence,
      basis,
      code: entry?.code ?? null,
    });
  };

  const addSelected = (group, item, qty, query, basisText) => {
    const entry = pick(catalog, query);
    if (!entry) {
      add(group, item, qty, 'pcs', 'unmatched', `${basisText}; nothing in the catalog fits`);
      warnings.push(`No catalog item for "${item}" (needs class ≥ ${query.minClassKv} kV, ≥ ${query.minCurrentA.toFixed(0)} A)`);
      return;
    }
    add(group, item, qty, 'pcs', 'catalog', basisText, entry);
  };

  const addFixed = (group, item, qty, unit, key, basis, confidence = 'default') => {
    const entry = fixedItem(catalog, key);
    if (!entry) {
      add(group, item, qty, unit, 'unmatched', `${basis}; "${key}" missing from catalog`);
      warnings.push(`Catalog has no accessory "${key}"`);
      return;
    }
    add(group, item, qty, unit, confidence, basis, entry);
  };

  const masses = rules.estimateMasses(spec);
  const { vectorGroup: vg, currents } = derived;
  const isOil = spec.type === 'oil';

  // --- Active part (all placeholder estimates) ---
  const conductor = spec.windingMaterial === 'Cu' ? 'copper' : 'aluminium';
  add('Active part', 'Core steel (grain-oriented)', masses.coreKg, 'kg', 'estimate', 'Placeholder mass rule (bomRules.js)');
  add('Active part', `HV winding conductor (${conductor})`, masses.hvConductorKg, 'kg', 'estimate', 'Placeholder mass rule (bomRules.js)');
  add('Active part', `LV winding conductor (${conductor})`, masses.lvConductorKg, 'kg', 'estimate', 'Placeholder mass rule (bomRules.js)');
  add('Active part', isOil ? 'Insulation (paper, pressboard)' : 'Insulation system (resin, laminates)', masses.insulationKg, 'kg', 'estimate', 'Placeholder mass rule (bomRules.js)');

  // --- Tank, oil, cooling ---
  let sealing = spec.sealing;
  if (isOil) {
    if (!sealing) {
      sealing = rules.defaultSealing(spec);
      assumptions.push(`Oil preservation not specified: ${sealing} assumed for ${spec.ratedPowerKva} kVA`);
    }
    add('Tank and cooling', 'Insulating oil', masses.oilLitres, 'L', 'estimate', 'Placeholder mass rule (bomRules.js)');
    add('Tank and cooling', 'Tank and cover (steel)', masses.tankKg, 'kg', 'estimate', 'Placeholder mass rule (bomRules.js)');
    if (sealing === 'conservator') {
      const panels = rules.radiatorPanels(spec);
      addFixed('Tank and cooling', 'Radiator panel', panels, 'pcs', 'radiator-panel', `Placeholder: total losses ${derived.totalLossesW} W at ${rules.RADIATOR_W_PER_PANEL} W per panel`, 'estimate');
    } else {
      add('Tank and cooling', 'Corrugated fins', 'incl.', '', 'default', 'Hermetic tank: fins are part of the tank');
    }
    if (spec.cooling === 'ONAF') {
      addFixed('Tank and cooling', 'Radiator cooling fan', 2, 'pcs', 'radiator-fan', 'ONAF cooling: default of two fans');
    }
  } else if (spec.cooling === 'AF') {
    addFixed('Tank and cooling', 'Cooling fan set', 1, 'set', 'dry-fan-set', 'AF cooling: one fan set');
  }

  // --- Terminals ---
  const terminalCategory = isOil ? 'bushing' : 'terminal';
  const terminalName = isOil ? 'bushing' : 'terminal';
  const hvNeutral = vg.hv.neutral ? 1 : 0;
  const lvNeutral = vg.lv.neutral ? 1 : 0;
  const hvQuery = { category: terminalCategory, minClassKv: derived.umHvKv, minCurrentA: currents.hvA };
  const lvQuery = { category: terminalCategory, minClassKv: derived.umLvKv, minCurrentA: currents.lvA };
  const basisHv = `3 phases; class from Um ${derived.umHvKv} kV, rated current ${currents.hvA.toFixed(1)} A`;
  const basisLv = `3 phases; class from Um ${derived.umLvKv} kV, rated current ${currents.lvA.toFixed(0)} A`;
  addSelected('Terminals', `HV ${terminalName} (phase)`, 3, hvQuery, basisHv);
  if (hvNeutral) addSelected('Terminals', `HV ${terminalName} (neutral)`, 1, hvQuery, `Neutral brought out (${vg.raw}); same rating as phase`);
  addSelected('Terminals', `LV ${terminalName} (phase)`, 3, lvQuery, basisLv);
  if (lvNeutral) addSelected('Terminals', `LV ${terminalName} (neutral)`, 1, lvQuery, `Neutral brought out (${vg.raw}); same rating as phase`);

  // --- Tap changer ---
  if (spec.tapType === 'OCTC') {
    addSelected('Tap changer', 'Off-circuit tap switch', 1, { category: 'octc', minClassKv: derived.umHvKv, minCurrentA: currents.hvA },
      `${derived.taps.length} positions, ±${spec.tapStepsEachSide} × ${spec.tapStepPct}% on HV`);
  } else if (spec.tapType === 'OLTC') {
    addSelected('Tap changer', 'On-load tap changer', 1,
      { category: 'oltc', minClassKv: derived.umHvKv, minCurrentA: currents.hvA, minPositions: derived.taps.length },
      `${derived.taps.length} positions, ±${spec.tapStepsEachSide} × ${spec.tapStepPct}% on HV`);
  }

  // --- Protection and accessories ---
  const acc = 'Protection and accessories';
  if (isOil) {
    if (sealing === 'conservator') {
      addFixed(acc, 'Conservator', 1, 'pcs', 'conservator', 'Conservator tank');
      addFixed(acc, 'Buchholz relay', 1, 'pcs', 'buchholz', 'Required with a conservator');
      addFixed(acc, 'Dehydrating breather', 1, 'pcs', 'breather', 'Required with a conservator');
    }
    addFixed(acc, 'Pressure relief device', 1, 'pcs', 'pressure-relief', 'Default accessory set');
    addFixed(acc, 'Oil thermometer', 1, 'pcs', 'oil-thermometer', 'Default accessory set');
    addFixed(acc, 'Oil drain valve', 1, 'pcs', 'drain-valve', 'Default accessory set');
    addFixed(acc, 'Oil filling plug', 1, 'pcs', 'filling-plug', 'Default accessory set');
    addFixed(acc, 'Rollers', 4, 'pcs', 'rollers', 'Default accessory set');
  } else {
    addFixed(acc, 'Winding temperature sensor (PT100)', 3, 'pcs', 'pt100', 'One per limb');
  }
  addFixed(acc, 'Lifting lug', 4, 'pcs', 'lifting-lug', 'Default accessory set');
  addFixed(acc, 'Earthing terminal', 2, 'pcs', 'earthing-terminal', 'Default accessory set');
  addFixed(acc, 'Rating plate', 1, 'pcs', 'rating-plate', 'Default accessory set');

  const estimateCount = lines.filter((l) => l.confidence === 'estimate').length;
  if (estimateCount) {
    warnings.unshift(`${estimateCount} line(s) use placeholder sizing rules (confidence "estimate"). Replace src/bomRules.js with your design rules before relying on these quantities.`);
  }

  return {
    lines,
    warnings,
    assumptions,
    estimatedTotalMassKg: masses.totalKg,
    catalogNotice: catalog.notice ?? null,
  };
}

module.exports = { generateBom, loadCatalog, pick, CONFIDENCE };
