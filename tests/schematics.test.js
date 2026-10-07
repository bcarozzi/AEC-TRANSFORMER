const { design } = require('../src/design');
const { singleLineSvg, phasorSvg } = require('../src/schematics');
const { parseVectorGroup } = require('../src/vectorGroup');
const { typical } = require('./fixtures');

const make = (over = {}) => {
  const r = design({ ...typical, ...over });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe('single-line diagram', () => {
  test('is well-formed SVG carrying the key data', () => {
    const { svg } = make();
    expect(svg.singleLine).toMatch(/^<svg [^>]*viewBox/);
    expect(svg.singleLine.trim().endsWith('</svg>')).toBe(true);
    expect(svg.singleLine).toContain('TR-001');
    expect(svg.singleLine).toContain('1,000 kVA');
    expect(svg.singleLine).toContain('Dyn11');
    expect(svg.singleLine).toContain('HV winding: delta');
    expect(svg.singleLine).toContain('LV winding: star + neutral');
  });

  test('shows tap arrow only when there is a tap changer', () => {
    expect(make().svg.singleLine).toContain('±2 × 2.5%');
    expect(make({ tapType: 'none' }).svg.singleLine).not.toContain('marker-end="url(#sl-arrow)"');
  });

  test('neutral marker follows the vector group', () => {
    expect(make({ vectorGroup: 'Dd0' }).svg.singleLine).not.toMatch(/>N<\/text>/);
    expect(make({ vectorGroup: 'Yzn11' }).svg.singleLine).toMatch(/>N<\/text>/);
  });

  test('escapes markup in the project name (it is injected into the page as HTML)', () => {
    const { svg } = make({ name: '<img src=x onerror=alert(1)>"&' });
    expect(svg.singleLine).not.toContain('<img');
    expect(svg.singleLine).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;');
  });
});

describe('phasor diagram', () => {
  test('labels the clock number and displacement', () => {
    const svg = phasorSvg(parseVectorGroup('Dyn11'));
    expect(svg).toContain('Dyn11: LV lags HV by 330°');
    ['1U', '1V', '1W', '2U', '2V', '2W'].forEach((l) => expect(svg).toContain(`>${l}<`));
  });

  test('captions: in phase for clock 0, otherwise the lag in degrees', () => {
    expect(phasorSvg(parseVectorGroup('Dd6'))).toContain('LV lags HV by 180°');
    expect(phasorSvg(parseVectorGroup('Yyn0'))).toContain('LV in phase with HV');
  });

  test('2U ends where a clock hand at that hour would', () => {
    const vg = parseVectorGroup('Dyn11');
    const svg = phasorSvg(vg);
    // 330° clockwise from 12 o'clock = 11 o'clock = up-left: x < centre (180), y < centre (170)
    const m = /x2="([\d.]+)" y2="([\d.]+)"[^>]*marker-end="url\(#ph-arrow-lv\)"/.exec(svg);
    expect(Number(m[1])).toBeLessThan(180);
    expect(Number(m[2])).toBeLessThan(170);
  });
});
