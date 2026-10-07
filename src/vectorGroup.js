// IEC 60076-1 vector group notation, e.g. "Dyn11", "YNyn0", "Yzn5".
// HV letters are upper case, LV letters lower case, "n" = neutral brought out.
// Clock number = LV phase displacement behind HV, in 30° steps (0-11).

const RE = /^(YN|Y|D|ZN|Z)(yn|y|d|zn|z)(\d{1,2})$/;

// Y has no inherent 30° offset; D and Z do. Clock number is odd exactly when the
// two windings sit in different classes (Dy, Yd, Yz, Zy) and even otherwise
// (Yy, Dd, Dz, Zz).
const PARITY_CLASS = { Y: 0, D: 1, Z: 1 };

function describeWinding(letters) {
  const kind = letters[0].toUpperCase();
  return { kind, neutral: letters.length === 2 };
}

function parseVectorGroup(raw) {
  const text = String(raw ?? '').trim();
  const m = RE.exec(text);
  if (!m) {
    return { ok: false, error: `"${text}" is not a valid vector group (expected e.g. Dyn11, YNyn0, Yzn5)` };
  }
  const hv = describeWinding(m[1]);
  const lv = describeWinding(m[2]);
  const clock = Number(m[3]);
  if (clock > 11) {
    return { ok: false, error: `Clock number must be 0-11, got ${clock}` };
  }
  const mustBeOdd = PARITY_CLASS[hv.kind] !== PARITY_CLASS[lv.kind];
  if (mustBeOdd !== (clock % 2 === 1)) {
    return {
      ok: false,
      error: `Clock number ${clock} is not possible for ${m[1]}${m[2]}: ${mustBeOdd ? 'odd' : 'even'} numbers are required`,
    };
  }
  return {
    ok: true,
    raw: text,
    hv,
    lv,
    clock,
    displacementDeg: clock * 30,
  };
}

module.exports = { parseVectorGroup };
