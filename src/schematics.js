// Electrical schematics as SVG strings.
//
// Colours: strokes and text use currentColor so the page theme (or a wrapper
// that sets `color`) decides ink; the two accents use CSS variables with
// fallbacks so a standalone .svg still renders.

const HV_COLOR = 'var(--series-1, #2a78d6)';
const LV_COLOR = 'var(--series-2, #eb6834)';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

const WINDING_NAME = { D: 'delta', Y: 'star', Z: 'zigzag' };

const point = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];

// IEC winding connection symbol centred on (cx, cy). Angles are SVG degrees (0 = right, 90 = down).
function windingSymbol(cx, cy, winding, color) {
  const stroke = `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  let body = '';
  if (winding.kind === 'D') {
    body = `<polygon points="${cx},${cy - 20} ${cx - 20},${cy + 14} ${cx + 20},${cy + 14}" ${stroke}/>`;
  } else {
    const arms = [-90, 30, 150].map((a) => ({ a, end: point(cx, cy, 20, a) }));
    body = arms.map(({ end }) => `<line x1="${cx}" y1="${cy}" x2="${end[0].toFixed(1)}" y2="${end[1].toFixed(1)}" ${stroke}/>`).join('');
    if (winding.kind === 'Z') {
      // A bar across each arm marks the zigzag.
      body += arms
        .map(({ a }) => {
          const [mx, my] = point(cx, cy, 13, a);
          const [x1, y1] = point(mx, my, 6, a + 90);
          const [x2, y2] = point(mx, my, 6, a - 90);
          return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${stroke}/>`;
        })
        .join('');
    }
    if (winding.neutral) {
      body += `<line x1="${cx}" y1="${cy}" x2="${cx + 34}" y2="${cy}" ${stroke}/><circle cx="${cx + 34}" cy="${cy}" r="3" fill="currentColor"/><text x="${cx + 42}" y="${cy + 4}" font-size="13" fill="currentColor">N</text>`;
    }
  }
  return `<g style="color:${color}">${body}</g>`;
}

function describeWinding(w) {
  return `${WINDING_NAME[w.kind]}${w.neutral ? ' + neutral' : ''}`;
}

function singleLineSvg(spec, derived) {
  const vg = derived.vectorGroup;
  const cx = 280;
  const line = `stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"`;
  const title = spec.name || 'Transformer';

  const tap = derived.taps.length
    ? `<g style="color:var(--text-2, #52514e)">
        <line x1="236" y1="200" x2="318" y2="124" ${line} marker-end="url(#sl-arrow)"/>
        <text x="${cx - 62}" y="${150}" text-anchor="end" font-size="13.5" fill="currentColor">${esc(spec.tapType)}</text>
        <text x="${cx - 62}" y="${167}" text-anchor="end" font-size="13.5" fill="currentColor">±${spec.tapStepsEachSide} × ${spec.tapStepPct}%</text>
      </g>`
    : '';

  const rows = [
    `uk ${fmt(derived.impedance.ukPct, 2)}%   ur ${fmt(derived.impedance.urPct, 2)}%   ux ${fmt(derived.impedance.uxPct, 2)}%`,
    `P0 ${fmt0(spec.p0W)} W   Pk ${fmt0(spec.pkW)} W   η ${fmt(derived.efficiency.ratedPf1Pct, 2)}% at rated load`,
    `In ${fmt(derived.currents.hvA, 1)} A / ${fmt0(derived.currents.lvA)} A   Um ${derived.umHvKv} kV / ${derived.umLvKv} kV`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 400" role="img" aria-label="Single-line diagram of ${esc(title)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
  <defs>
    <marker id="sl-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker>
  </defs>
  <text x="20" y="28" font-size="19" font-weight="600" fill="currentColor">${esc(title)}</text>
  <text x="20" y="49" font-size="14" fill="currentColor" opacity="0.75">${fmt0(spec.ratedPowerKva)} kVA · ${spec.frequencyHz} Hz · ${esc(spec.cooling)} · ${esc(vg.raw)}</text>

  <g style="color:${HV_COLOR}">
    <line x1="${cx}" y1="74" x2="${cx}" y2="114" ${line}/>
    <circle cx="${cx}" cy="74" r="4" fill="currentColor"/>
    <line x1="${cx - 6}" y1="98" x2="${cx + 6}" y2="90" ${line}/><line x1="${cx - 6}" y1="104" x2="${cx + 6}" y2="96" ${line}/><line x1="${cx - 6}" y1="110" x2="${cx + 6}" y2="102" ${line}/>
  </g>
  <text x="${cx - 14}" y="70" text-anchor="end" font-size="14.5" font-weight="600" fill="currentColor">HV ${fmt(spec.hvKv, spec.hvKv % 1 ? 2 : 0)} kV</text>
  <text x="${cx - 14}" y="88" text-anchor="end" font-size="13.5" fill="currentColor" opacity="0.8">${fmt(derived.currents.hvA, 1)} A</text>

  <circle cx="${cx}" cy="160" r="46" ${line} style="color:${HV_COLOR}"/>
  <circle cx="${cx}" cy="214" r="46" ${line} style="color:${LV_COLOR}"/>
  ${tap}

  <g style="color:${LV_COLOR}">
    <line x1="${cx}" y1="260" x2="${cx}" y2="300" ${line}/>
    <circle cx="${cx}" cy="300" r="4" fill="currentColor"/>
    <line x1="${cx - 6}" y1="278" x2="${cx + 6}" y2="270" ${line}/><line x1="${cx - 6}" y1="284" x2="${cx + 6}" y2="276" ${line}/><line x1="${cx - 6}" y1="290" x2="${cx + 6}" y2="282" ${line}/>
  </g>
  <text x="${cx - 14}" y="296" text-anchor="end" font-size="14.5" font-weight="600" fill="currentColor">LV ${fmt(spec.lvKv, spec.lvKv % 1 ? 2 : 0)} kV</text>
  <text x="${cx - 14}" y="314" text-anchor="end" font-size="13.5" fill="currentColor" opacity="0.8">${fmt0(derived.currents.lvA)} A</text>

  <line x1="326" y1="150" x2="398" y2="140" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  <line x1="326" y1="224" x2="398" y2="250" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  ${windingSymbol(426, 140, vg.hv, HV_COLOR)}
  <text x="426" y="184" text-anchor="middle" font-size="13.5" fill="currentColor" opacity="0.9">HV winding: ${esc(describeWinding(vg.hv))}</text>
  ${windingSymbol(426, 250, vg.lv, LV_COLOR)}
  <text x="426" y="294" text-anchor="middle" font-size="13.5" fill="currentColor" opacity="0.9">LV winding: ${esc(describeWinding(vg.lv))}</text>

  ${rows.map((r, i) => `<text x="20" y="${350 + i * 20}" font-size="14" fill="currentColor" opacity="0.9">${esc(r)}</text>`).join('\n  ')}
</svg>`;
}

// Clock-face phasor diagram. Phasors rotate counter-clockwise (IEC 60076-1),
// so with 1U at 12 o'clock, 1V sits at 4 and 1W at 8. LV is displaced
// clock × 30° clockwise (lagging).
function phasorSvg(vectorGroup) {
  const cx = 180;
  const cy = 170;
  const faceR = 132;
  const lines = [];

  for (let h = 0; h < 12; h += 1) {
    const [x1, y1] = point(cx, cy, faceR - 6, h * 30 - 90);
    const [x2, y2] = point(cx, cy, faceR, h * 30 - 90);
    const [tx, ty] = point(cx, cy, faceR + 15, h * 30 - 90);
    lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="currentColor" stroke-width="1" opacity="0.5"/>`);
    lines.push(`<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="currentColor" opacity="${h === vectorGroup.clock ? 1 : 0.6}" font-weight="${h === vectorGroup.clock ? 700 : 400}">${h === 0 ? 12 : h}</text>`);
  }

  const star = (length, labelR, offsetDeg, prefix, color, marker) =>
    [0, 120, 240]
      .map((a, i) => {
        const deg = a + offsetDeg - 90;
        const [x, y] = point(cx, cy, length, deg);
        const [lx, ly] = point(cx, cy, labelR, deg);
        const name = `${prefix}${'UVW'[i]}`;
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" marker-end="url(#${marker})" style="color:${color}"/>
  <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="600" fill="currentColor">${name}</text>`;
      })
      .join('\n  ');

  const lag = vectorGroup.displacementDeg;
  const caption = lag === 0 ? 'LV in phase with HV' : `LV lags HV by ${lag}°`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 372" role="img" aria-label="Vector group phasor diagram ${esc(vectorGroup.raw)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
  <defs>
    <marker id="ph-arrow-hv" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill:${HV_COLOR}"/></marker>
    <marker id="ph-arrow-lv" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto"><path d="M0,0 L10,5 L0,10 z" style="fill:${LV_COLOR}"/></marker>
  </defs>
  <circle cx="${cx}" cy="${cy}" r="${faceR}" fill="none" stroke="currentColor" stroke-width="1" opacity="0.35"/>
  ${lines.join('\n  ')}
  ${star(98, 115, 0, '1', HV_COLOR, 'ph-arrow-hv')}
  ${star(70, 87, lag, '2', LV_COLOR, 'ph-arrow-lv')}
  <text x="${cx}" y="338" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">${esc(vectorGroup.raw)}: ${esc(caption)}</text>
  <text x="${cx}" y="357" text-anchor="middle" font-size="11.5" fill="currentColor" opacity="0.7">Terminal voltage phasors (line-to-neutral equivalent)</text>
</svg>`;
}

module.exports = { singleLineSvg, phasorSvg, esc };
