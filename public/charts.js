// Minimal accessible line charts (SVG, no dependencies).
//
// Follows the data-viz rules used across this app: thin 2px lines, hairline
// solid grid, a legend whenever there is more than one series, direct end
// labels only when they fit without colliding, a crosshair + tooltip on
// hover and keyboard, and a table view of the same numbers.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    if (parent) parent.appendChild(el);
    return el;
  }

  function html(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else el.setAttribute(k, v);
    });
    children.flat().forEach((c) => el.append(c));
    return el;
  }

  function niceNum(range, round) {
    const exp = Math.floor(Math.log10(range));
    const f = range / 10 ** exp;
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * 10 ** exp;
  }

  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const step = niceNum((max - min) / (count - 1), true);
    const start = Math.floor(min / step + 1e-9) * step;
    const end = Math.ceil(max / step - 1e-9) * step;
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const ticks = [];
    const n = Math.round((end - start) / step);
    for (let i = 0; i <= n; i += 1) ticks.push(Number((start + i * step).toFixed(decimals)));
    return { ticks, min: ticks[0], max: ticks[ticks.length - 1], decimals };
  }

  const fmt = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  const W = 680;
  const H = 340;
  const MARGIN = { t: 16, b: 48, l: 58 };
  const LABEL_GAP = 15;

  function lineChart(root, opts) {
    const { title, xs, series, xLabel, yLabel, yUnit = '', yDigits = 2, xTicks, xFormat, refX, highlight, tableLabel } = opts;
    root.replaceChildren();

    // --- y scale first: it decides whether direct end labels fit.
    const all = series.flatMap((s) => s.values).concat(highlight ? [highlight.y] : []);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo || 1) * 0.04;
    const yt = niceTicks(lo - pad, hi + pad, 6);
    const plotH = H - MARGIN.t - MARGIN.b;
    const yPx = (v) => MARGIN.t + plotH * (1 - (v - yt.min) / (yt.max - yt.min));

    const endYs = series.map((s) => yPx(s.values[s.values.length - 1])).sort((a, b) => a - b);
    const directLabels = series.length > 1 && endYs.every((y, i) => i === 0 || y - endYs[i - 1] >= LABEL_GAP);
    const m = { ...MARGIN, r: directLabels ? 138 : 26 };

    const plotW = W - m.l - m.r;
    const x0 = xs[0];
    const x1 = xs[xs.length - 1];
    const xPx = (v) => m.l + (plotW * (v - x0)) / (x1 - x0);

    // --- header, legend
    const toggle = html('button', { type: 'button', class: 'btn subtle', 'aria-pressed': 'false' }, 'Table view');
    root.append(html('div', { class: 'card-head' }, html('h3', {}, title), toggle));
    if (series.length > 1) {
      root.append(
        html('div', { class: 'legend' }, series.map((s) =>
          html('span', { class: 'key' }, html('span', { class: 'swatch', style: `background:${s.color}` }), s.label)))
      );
    }

    // --- chart
    const wrap = html('div', {
      class: 'chart-wrap',
      tabindex: '0',
      role: 'group',
      'aria-label': `${title}. Use the left and right arrow keys to read values.`,
    });
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-hidden': 'true' }, wrap);

    yt.ticks.forEach((t) => {
      const y = yPx(t);
      svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
      const lab = svgEl('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 12, fill: 'var(--text-2)' }, svg);
      lab.textContent = fmt(t, yt.decimals);
    });
    if (yt.min < 0 && yt.max > 0) {
      svgEl('line', { x1: m.l, x2: W - m.r, y1: yPx(0), y2: yPx(0), stroke: 'var(--muted)', 'stroke-width': 1 }, svg);
    }
    xTicks.forEach((t) => {
      const lab = svgEl('text', { x: xPx(t), y: H - m.b + 18, 'text-anchor': 'middle', 'font-size': 12, fill: 'var(--text-2)' }, svg);
      lab.textContent = xFormat(t);
    });
    svgEl('text', { x: m.l + plotW / 2, y: H - 8, 'text-anchor': 'middle', 'font-size': 12.5, fill: 'var(--text-2)' }, svg).textContent = xLabel;
    svgEl('text', { transform: `translate(14 ${MARGIN.t + plotH / 2}) rotate(-90)`, 'text-anchor': 'middle', 'font-size': 12.5, fill: 'var(--text-2)' }, svg).textContent = yLabel;

    if (refX) {
      svgEl('line', { x1: xPx(refX.x), x2: xPx(refX.x), y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-width': 1, opacity: 0.6 }, svg);
      svgEl('text', { x: xPx(refX.x) - 4, y: m.t + 12, 'text-anchor': 'end', 'font-size': 11.5, fill: 'var(--muted)' }, svg).textContent = refX.label;
    }

    series.forEach((s) => {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${xPx(xs[i]).toFixed(1)} ${yPx(v).toFixed(1)}`).join('');
      svgEl('path', { d, fill: 'none', style: `stroke:${s.color}`, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      const ex = xPx(x1);
      const ey = yPx(s.values[s.values.length - 1]);
      svgEl('circle', { cx: ex, cy: ey, r: 4, style: `fill:${s.color};stroke:var(--surface)`, 'stroke-width': 2 }, svg);
      if (directLabels) {
        svgEl('line', { x1: ex + 9, x2: ex + 21, y1: ey, y2: ey, style: `stroke:${s.color}`, 'stroke-width': 2, 'stroke-linecap': 'round' }, svg);
        svgEl('text', { x: ex + 26, y: ey + 4, 'font-size': 12, fill: 'var(--text-2)' }, svg).textContent = s.label;
      }
    });

    if (highlight) {
      const hx = xPx(highlight.x);
      const hy = yPx(highlight.y);
      const color = series[highlight.seriesIndex || 0].color;
      svgEl('circle', { cx: hx, cy: hy, r: 5, style: `fill:${color};stroke:var(--surface)`, 'stroke-width': 2 }, svg);
      const onLeft = hx < m.l + plotW * 0.55;
      svgEl('text', { x: hx + (onLeft ? 10 : -10), y: hy - 10, 'text-anchor': onLeft ? 'start' : 'end', 'font-size': 12, 'font-weight': 600, fill: 'var(--text)' }, svg).textContent = highlight.label;
    }

    // --- hover layer
    const cross = svgEl('line', { y1: m.t, y2: H - m.b, stroke: 'var(--muted)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    const dots = series.map((s) => svgEl('circle', { r: 4.5, style: `fill:${s.color};stroke:var(--surface)`, 'stroke-width': 2, visibility: 'hidden' }, svg));
    const hit = svgEl('rect', { x: m.l, y: m.t, width: plotW, height: plotH, fill: 'transparent' }, svg);
    const tip = html('div', { class: 'tooltip', hidden: '' });
    const live = html('span', { 'aria-live': 'polite', style: 'position:absolute;left:-9999px' });
    wrap.append(tip, live);

    let current = -1;
    function show(i, announce) {
      current = Math.max(0, Math.min(xs.length - 1, i));
      const x = xPx(xs[current]);
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.setAttribute('visibility', 'visible');
      dots.forEach((d, k) => {
        d.setAttribute('cx', x);
        d.setAttribute('cy', yPx(series[k].values[current]));
        d.setAttribute('visibility', 'visible');
      });
      tip.replaceChildren(
        html('div', { class: 'tt-title' }, `${xLabel.split(' (')[0]} = ${xFormat(xs[current])}`),
        ...series.map((s) => html('div', { class: 'tt-row' },
          html('span', { class: 'tt-dot', style: `background:${s.color}` }),
          s.label,
          html('span', { class: 'tt-val' }, `${fmt(s.values[current], yDigits)}${yUnit ? ` ${yUnit}` : ''}`)))
      );
      tip.hidden = false;
      const scale = wrap.getBoundingClientRect().width / W;
      const px = x * scale;
      // Keep the tooltip inside the plot so it never covers the end labels.
      const limit = (W - m.r) * scale;
      const left = px + 14 + tip.offsetWidth > limit ? px - tip.offsetWidth - 14 : px + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${m.t * scale}px`;
      if (announce) live.textContent = tip.textContent;
    }
    function hide() {
      current = -1;
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
    }
    function nearest(evt) {
      const rect = svg.getBoundingClientRect();
      const x = ((evt.clientX - rect.left) * W) / rect.width;
      let best = 0;
      xs.forEach((v, i) => { if (Math.abs(xPx(v) - x) < Math.abs(xPx(xs[best]) - x)) best = i; });
      return best;
    }
    hit.addEventListener('pointermove', (e) => show(nearest(e)));
    hit.addEventListener('pointerdown', (e) => show(nearest(e)));
    hit.addEventListener('pointerleave', hide);
    wrap.addEventListener('blur', hide);
    wrap.addEventListener('keydown', (e) => {
      const last = xs.length - 1;
      const keys = { ArrowRight: () => show(current < 0 ? 0 : current + 1, true), ArrowLeft: () => show(current < 0 ? last : current - 1, true), Home: () => show(0, true), End: () => show(last, true), Escape: hide };
      if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
    });

    // --- table view: the same numbers, for screen readers, copying and low-contrast colours
    const table = html('div', { class: 'table-wrap', hidden: '' },
      html('table', {},
        html('caption', {}, `${title}: data`),
        html('thead', {}, html('tr', {},
          html('th', { class: 'num' }, tableLabel || xLabel),
          series.map((s) => html('th', { class: 'num' }, `${s.label}${yUnit ? ` (${yUnit})` : ''}`)))),
        html('tbody', {}, xs.map((x, i) => html('tr', {},
          html('td', { class: 'num' }, xFormat(x)),
          series.map((s) => html('td', { class: 'num' }, fmt(s.values[i], yDigits))))))));

    toggle.addEventListener('click', () => {
      const on = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(on));
      toggle.textContent = on ? 'Chart view' : 'Table view';
      wrap.hidden = on;
      table.hidden = !on;
    });

    root.append(wrap, table);
  }

  window.TDCharts = { lineChart, niceTicks };
})();
