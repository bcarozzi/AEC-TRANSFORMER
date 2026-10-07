// Single source of truth for the specification fields. The schema, the
// table importer and the web form are all driven from this list.
//
// `aliases` are matched against normalised import headers (lower case, letters
// and digits only), so "Rated power [kVA]", "rated_power" and "Potenza nominale"
// all land on the same field. Italian aliases are included because source
// data sheets are often in Italian.
//
// `unit` is the canonical unit the app works in. `unitFactors` converts the
// unit written in an import header, e.g. "Rated power (MVA)" -> kVA.

const LENGTH_MM = { mm: 1, cm: 10, m: 1000 };
const MASS_KG = { kg: 1, t: 1000 };

// Optional "as-designed" value: the engineer's real number, replacing a placeholder rule.
function designed(key, label, unit, group, aliases, unitFactors, extra = {}) {
  const field = { key, label, type: 'number', required: false, section: 'designed', group, aliases, ...extra };
  if (unit) field.unit = unit;
  if (unitFactors) field.unitFactors = unitFactors;
  return field;
}

const FIELDS = [
  {
    key: 'name', label: 'Name / project', type: 'string', required: false,
    aliases: ['name', 'project', 'tag', 'id', 'nome', 'progetto', 'commessa', 'matricola'],
  },
  {
    key: 'type', label: 'Type', type: 'enum', options: ['oil', 'dry'], required: false, default: 'oil',
    aliases: ['type', 'transformertype', 'tipo', 'tipotrasformatore', 'isolamento'],
    valueAliases: {
      oil: ['oil', 'oilimmersed', 'olio', 'inolio', 'inbagnodolio'],
      dry: ['dry', 'drytype', 'resin', 'castresin', 'secco', 'inresina', 'resina'],
    },
  },
  {
    key: 'ratedPowerKva', label: 'Rated power', unit: 'kVA', type: 'number', required: true,
    aliases: ['ratedpower', 'power', 'sn', 'rating', 'potenza', 'potenzanominale', 'potenzaapparente', 'potenzakva'],
    unitFactors: { va: 0.001, kva: 1, mva: 1000 },
  },
  {
    key: 'frequencyHz', label: 'Frequency', unit: 'Hz', type: 'number', required: false, default: 50,
    aliases: ['frequency', 'freq', 'f', 'frequenza'],
  },
  {
    key: 'hvKv', label: 'HV rated voltage (line-to-line)', unit: 'kV', type: 'number', required: true,
    aliases: ['hvvoltage', 'hv', 'primaryvoltage', 'primary', 'uhv', 'u1', 'ur1', 'tensioneprimaria', 'primario', 'tensioneat', 'tensionemt', 'at'],
    unitFactors: { v: 0.001, kv: 1 },
  },
  {
    key: 'lvKv', label: 'LV rated voltage (line-to-line)', unit: 'kV', type: 'number', required: true,
    aliases: ['lvvoltage', 'lv', 'secondaryvoltage', 'secondary', 'ulv', 'u2', 'ur2', 'tensionesecondaria', 'secondario', 'tensionebt', 'bt'],
    unitFactors: { v: 0.001, kv: 1 },
  },
  {
    key: 'vectorGroup', label: 'Vector group', type: 'string', required: true,
    aliases: ['vectorgroup', 'connection', 'group', 'connectiongroup', 'gruppovettoriale', 'gruppo', 'collegamento'],
  },
  {
    key: 'ukPct', label: 'Short-circuit impedance (uk)', unit: '%', type: 'number', required: true,
    aliases: ['uk', 'ukpct', 'impedance', 'shortcircuitimpedance', 'zk', 'tensionedicortocircuito', 'vcc', 'ucc', 'ucc%', 'impedenza'],
  },
  {
    key: 'p0W', label: 'No-load losses (P0)', unit: 'W', type: 'number', required: true,
    aliases: ['p0', 'noloadlosses', 'noloadloss', 'ironlosses', 'coreloss', 'perditeavuoto', 'perditeferro', 'po'],
    unitFactors: { w: 1, kw: 1000 },
  },
  {
    key: 'pkW', label: 'Load losses (Pk, at rated current)', unit: 'W', type: 'number', required: true,
    aliases: ['pk', 'loadlosses', 'loadloss', 'copperlosses', 'shortcircuitlosses', 'perditeacarico', 'perditerame', 'perditeincortocircuito'],
    unitFactors: { w: 1, kw: 1000 },
  },
  {
    key: 'i0Pct', label: 'No-load current (i0)', unit: '%', type: 'number', required: false,
    aliases: ['i0', 'i0pct', 'noloadcurrent', 'correnteavuoto', 'io'],
  },
  {
    key: 'cooling', label: 'Cooling', type: 'enum', options: ['ONAN', 'ONAF', 'AN', 'AF'], required: false,
    aliases: ['cooling', 'coolingmethod', 'raffreddamento', 'refrigerazione'],
  },
  {
    key: 'windingMaterial', label: 'Winding material', type: 'enum', options: ['Cu', 'Al'], required: false, default: 'Cu',
    aliases: ['windingmaterial', 'conductor', 'conductormaterial', 'material', 'avvolgimenti', 'materialeavvolgimenti', 'conduttore'],
    valueAliases: { Cu: ['cu', 'copper', 'rame'], Al: ['al', 'aluminium', 'aluminum', 'alluminio'] },
  },
  {
    key: 'tapType', label: 'Tap changer', type: 'enum', options: ['none', 'OCTC', 'OLTC'], required: false, default: 'OCTC',
    aliases: ['tapchanger', 'tap', 'taptype', 'regolazione', 'commutatore', 'variatore'],
    valueAliases: {
      none: ['none', 'no', 'nessuno', 'assente', ''],
      OCTC: ['octc', 'offcircuit', 'offload', 'devo', 'vuoto', 'avuoto'],
      OLTC: ['oltc', 'onload', 'oncircuit', 'sottocarico', 'carico'],
    },
  },
  {
    key: 'tapStepPct', label: 'Tap step (HV side)', unit: '%', type: 'number', required: false, default: 2.5,
    aliases: ['tapstep', 'tapsteppct', 'step', 'passo', 'passoregolazione'],
  },
  {
    key: 'tapStepsEachSide', label: 'Tap steps each side of nominal', type: 'number', required: false, default: 2,
    aliases: ['tapsteps', 'tapstepseachside', 'steps', 'numerodipassi', 'passiperlato'],
  },
  {
    key: 'sealing', label: 'Oil preservation', type: 'enum', options: ['hermetic', 'conservator'], required: false,
    aliases: ['sealing', 'oilpreservation', 'conservator', 'conservatore', 'tipodiserbatoio', 'serbatoio'],
    valueAliases: {
      hermetic: ['hermetic', 'sealed', 'ermetico', 'integrale', 'hermeticallysealed'],
      conservator: ['conservator', 'conservatore', 'withconservator', 'conconservatore'],
    },
  },
  {
    key: 'hvBilKv', label: 'HV lightning impulse withstand (BIL)', unit: 'kV', type: 'number', required: false,
    aliases: ['hvbil', 'bil', 'li', 'lightningimpulse', 'impulso', 'tensionediimpulso'],
  },
  {
    key: 'hvAcKv', label: 'HV power-frequency withstand', unit: 'kV', type: 'number', required: false,
    aliases: ['hvac', 'acwithstand', 'powerfrequencywithstand', 'tensioneapplicata', 'tensioneaf'],
  },

  // --- As-designed data (optional). Each value overrides the placeholder rule for
  // that item; anything left blank keeps its estimate. See src/dimensions.js. ---
  designed('totalMassKg', 'Total mass', 'kg', 'masses', ['totalmass', 'totalweight', 'mass', 'weight', 'massatotale', 'pesototale', 'peso', 'pesocomplessivo'], MASS_KG),
  designed('coreMassKg', 'Core mass', 'kg', 'masses', ['coremass', 'coreweight', 'ironmass', 'massanucleo', 'pesonucleo', 'pesoferro', 'pesomagnete'], MASS_KG),
  designed('hvConductorMassKg', 'HV winding conductor mass', 'kg', 'masses', ['hvconductormass', 'hvwindingmass', 'hvcoppermass', 'hvwindingweight', 'pesoavvolgimentoat', 'pesorameat', 'massaconduttoreat'], MASS_KG),
  designed('lvConductorMassKg', 'LV winding conductor mass', 'kg', 'masses', ['lvconductormass', 'lvwindingmass', 'lvcoppermass', 'lvwindingweight', 'pesoavvolgimentobt', 'pesoramebt', 'massaconduttorebt'], MASS_KG),
  designed('insulationMassKg', 'Insulation mass', 'kg', 'masses', ['insulationmass', 'insulationweight', 'massaisolamento', 'pesoisolamento', 'pesoisolanti'], MASS_KG),
  designed('oilLitres', 'Oil volume', 'L', 'masses', ['oilvolume', 'oillitres', 'oilliters', 'oilquantity', 'volumeolio', 'quantitaolio', 'litriolio', 'olio'], { l: 1, lt: 1, litri: 1, liters: 1, litres: 1, m3: 1000 }, { oilOnly: true }),
  designed('tankMassKg', 'Tank and cover mass', 'kg', 'masses', ['tankmass', 'tankweight', 'massacassa', 'pesocassa', 'pesocassone'], MASS_KG, { oilOnly: true }),

  designed('coreDiameterMm', 'Core limb diameter', 'mm', 'core-windings', ['corediameter', 'limbdiameter', 'diametronucleo', 'diametrocolonna'], LENGTH_MM),
  designed('windowHeightMm', 'Core window height', 'mm', 'core-windings', ['windowheight', 'coreheight', 'altezzafinestra', 'altezzacolonna'], LENGTH_MM),
  designed('phasePitchMm', 'Limb centre distance', 'mm', 'core-windings', ['phasepitch', 'limbpitch', 'limbcentredistance', 'limbcenterdistance', 'interasse', 'interassecolonne', 'distanzaassi'], LENGTH_MM),
  designed('lvInnerDiameterMm', 'LV winding inner diameter', 'mm', 'core-windings', ['lvinnerdiameter', 'lvinnerdia', 'lvid', 'diametrointernobt'], LENGTH_MM),
  designed('lvOuterDiameterMm', 'LV winding outer diameter', 'mm', 'core-windings', ['lvouterdiameter', 'lvouterdia', 'lvod', 'diametroesternobt'], LENGTH_MM),
  designed('hvInnerDiameterMm', 'HV winding inner diameter', 'mm', 'core-windings', ['hvinnerdiameter', 'hvinnerdia', 'hvid', 'diametrointernoat'], LENGTH_MM),
  designed('hvOuterDiameterMm', 'HV winding outer diameter', 'mm', 'core-windings', ['hvouterdiameter', 'hvouterdia', 'hvod', 'diametroesternoat'], LENGTH_MM),
  designed('lvHeightMm', 'LV winding height', 'mm', 'core-windings', ['lvheight', 'lvwindingheight', 'altezzabt', 'altezzaavvolgimentobt'], LENGTH_MM),
  designed('hvHeightMm', 'HV winding height', 'mm', 'core-windings', ['hvheight', 'hvwindingheight', 'altezzaat', 'altezzaavvolgimentoat'], LENGTH_MM),

  designed('tankLengthMm', 'Tank length (outer)', 'mm', 'tank', ['tanklength', 'lunghezzacassa', 'lunghezzacassone'], LENGTH_MM, { oilOnly: true }),
  designed('tankWidthMm', 'Tank width (outer)', 'mm', 'tank', ['tankwidth', 'larghezzacassa', 'larghezzacassone'], LENGTH_MM, { oilOnly: true }),
  designed('tankHeightMm', 'Tank height (outer, no cover)', 'mm', 'tank', ['tankheight', 'altezzacassa', 'altezzacassone'], LENGTH_MM, { oilOnly: true }),
  designed('radiatorPanels', 'Radiator panels (total)', null, 'tank', ['radiatorpanels', 'radiators', 'numberofradiators', 'numeroradiatori', 'radiatori', 'elementiradianti'], undefined, { oilOnly: true, integer: true }),
];

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Lower case, keep letters/digits/% only.
function normaliseHeader(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, '');
}

const DESIGNED_GROUPS = [
  { id: 'masses', title: 'Masses and oil' },
  { id: 'core-windings', title: 'Core and windings' },
  { id: 'tank', title: 'Tank and cooling' },
];

module.exports = { FIELDS, FIELD_BY_KEY, DESIGNED_GROUPS, normaliseHeader };
