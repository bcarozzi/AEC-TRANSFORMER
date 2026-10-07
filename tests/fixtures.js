// A typical 1000 kVA, 20/0.4 kV oil-immersed distribution transformer.
const typical = {
  name: 'TR-001',
  ratedPowerKva: 1000,
  hvKv: 20,
  lvKv: 0.4,
  vectorGroup: 'Dyn11',
  ukPct: 6,
  p0W: 1100,
  pkW: 10500,
};

module.exports = { typical };
