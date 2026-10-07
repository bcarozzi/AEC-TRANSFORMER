const { validateSpec, withDefaults } = require('../src/spec');
const { typical } = require('./fixtures');

const errorsFor = (over) => {
  const r = validateSpec({ ...typical, ...over });
  expect(r.ok).toBe(false);
  return Object.fromEntries(r.errors.map((e) => [e.field, e.message]));
};

describe('validateSpec', () => {
  test('accepts a typical spec and fills defaults', () => {
    const r = validateSpec(typical);
    expect(r.ok).toBe(true);
    expect(r.spec).toMatchObject({
      type: 'oil', cooling: 'ONAN', frequencyHz: 50, windingMaterial: 'Cu', tapType: 'OCTC', tapStepPct: 2.5, tapStepsEachSide: 2,
    });
    expect(r.warnings).toEqual([]);
  });

  test('accepts numbers typed as strings, including decimal commas', () => {
    const r = validateSpec({ ...typical, ratedPowerKva: '1000', lvKv: '0,4', ukPct: ' 6 ' });
    expect(r.ok).toBe(true);
    expect(r.spec.lvKv).toBe(0.4);
  });

  test('blank form fields count as missing, not as 0', () => {
    const e = errorsFor({ ratedPowerKva: '', p0W: null });
    expect(e.ratedPowerKva).toMatch(/required/);
    expect(e.p0W).toMatch(/required/);
  });

  test('dry type defaults to AN cooling and rejects oil cooling', () => {
    expect(validateSpec({ ...typical, type: 'dry' }).spec.cooling).toBe('AN');
    expect(errorsFor({ type: 'dry', cooling: 'ONAN' }).cooling).toMatch(/does not apply/);
    expect(errorsFor({ type: 'oil', cooling: 'AN' }).cooling).toMatch(/does not apply/);
  });

  test('rejects negative, zero and non-numeric values', () => {
    expect(errorsFor({ ratedPowerKva: -5 }).ratedPowerKva).toMatch(/greater than 0/);
    expect(errorsFor({ hvKv: 0 }).hvKv).toMatch(/greater than 0/);
    expect(errorsFor({ pkW: 'abc' }).pkW).toMatch(/number/);
  });

  test('rejects frequencies other than 50/60 Hz', () => {
    expect(errorsFor({ frequencyHz: 400 }).frequencyHz).toMatch(/50 or 60/);
  });

  test('rejects bad vector group, with a reason', () => {
    expect(errorsFor({ vectorGroup: 'Dyn10' }).vectorGroup).toMatch(/odd/);
  });

  test('rejects HV <= LV', () => {
    expect(errorsFor({ hvKv: 0.4, lvKv: 20 }).hvKv).toMatch(/higher than LV/);
  });

  test('rejects losses that make ur >= uk (physically impossible)', () => {
    expect(errorsFor({ pkW: 70000 }).pkW).toMatch(/cannot be/);
  });

  test('a tap changer needs at least one step; blank tap fields take their defaults', () => {
    expect(validateSpec({ ...typical, tapType: 'none' }).ok).toBe(true);
    expect(errorsFor({ tapType: 'OLTC', tapStepsEachSide: 0 }).tapStepsEachSide).toMatch(/at least one step/);
    const blank = validateSpec({ ...typical, tapType: 'OLTC', tapStepPct: '', tapStepsEachSide: '' });
    expect(blank.spec).toMatchObject({ tapStepPct: 2.5, tapStepsEachSide: 2 });
  });

  test('oil preservation does not apply to dry type', () => {
    expect(errorsFor({ type: 'dry', sealing: 'hermetic' }).sealing).toMatch(/oil-immersed/);
  });

  test('plausibility problems warn but do not block', () => {
    const r = validateSpec({ ...typical, ratedPowerKva: 1010, ukPct: 20, p0W: 20000 });
    expect(r.ok).toBe(true);
    const fields = r.warnings.map((w) => w.field);
    expect(fields).toEqual(expect.arrayContaining(['ratedPowerKva', 'ukPct', 'p0W']));
  });

  test('withDefaults does not mutate its input', () => {
    const input = { ...typical };
    withDefaults(input);
    expect(input).toEqual(typical);
  });

  test('ignores unknown keys instead of echoing them back', () => {
    const r = validateSpec({ ...typical, __proto__: { x: 1 }, evil: '<script>' });
    expect(r.ok).toBe(true);
    expect(r.spec.evil).toBeUndefined();
  });
});
