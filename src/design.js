const { validateSpec } = require('./spec');
const { derive } = require('./calc');
const { generateBom } = require('./bom');
const { singleLineSvg, phasorSvg } = require('./schematics');

// Validate a raw spec and produce everything the UI shows.
function design(raw, options = {}) {
  const v = validateSpec(raw);
  if (!v.ok) return { ok: false, errors: v.errors };

  const derived = derive(v.spec, v.vectorGroup);
  const bom = generateBom(v.spec, derived, options);

  return {
    ok: true,
    spec: v.spec,
    warnings: v.warnings,
    derived,
    bom,
    svg: {
      singleLine: singleLineSvg(v.spec, derived),
      phasor: phasorSvg(derived.vectorGroup),
    },
  };
}

module.exports = { design };
