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
];

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Lower case, keep letters/digits/% only.
function normaliseHeader(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, '');
}

module.exports = { FIELDS, FIELD_BY_KEY, normaliseHeader };
