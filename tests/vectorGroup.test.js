const { parseVectorGroup } = require('../src/vectorGroup');

describe('parseVectorGroup', () => {
  test('parses Dyn11', () => {
    const vg = parseVectorGroup('Dyn11');
    expect(vg).toMatchObject({ ok: true, clock: 11, displacementDeg: 330 });
    expect(vg.hv).toEqual({ kind: 'D', neutral: false });
    expect(vg.lv).toEqual({ kind: 'Y', neutral: true });
  });

  test.each(['Dyn11', 'Dyn5', 'YNyn0', 'Yyn0', 'Yzn11', 'Yzn5', 'Dd0', 'Dd6', 'Dz0', 'Dz10', 'YNd11', 'Yd1'])('accepts %s', (g) => {
    expect(parseVectorGroup(g).ok).toBe(true);
  });

  test.each([
    ['Dyn10', /odd/],
    ['Yy1', /even/],
    ['Dd5', /even/],
    ['Yzn0', /odd/],
    ['Dyn12', /0-11/],
  ])('rejects impossible clock number in %s', (g, msg) => {
    const r = parseVectorGroup(g);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(msg);
  });

  test.each(['', 'dyn11', 'Dyn', 'Xyn11', 'Dyn11+d', null, undefined])('rejects malformed %p', (g) => {
    expect(parseVectorGroup(g).ok).toBe(false);
  });
});
