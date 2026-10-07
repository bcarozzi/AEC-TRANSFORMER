(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  // Tiny DOM builder. Strings become text nodes, so server data never turns into markup.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    children.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
  }

  // Like parent.append(), but skips null/false. The DOM would otherwise insert the text "null".
  function put(parent, ...children) {
    parent.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return parent;
  }

  const fmt = (n, d = 1) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt0 = (n) => fmt(n, 0);
  const sig = (n, digits = 4) => Number(Number(n).toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 8 });

  const GROUPS = [
    { title: 'General', keys: ['name', 'type', 'ratedPowerKva', 'frequencyHz', 'cooling', 'windingMaterial', 'sealing'] },
    { title: 'Voltages and connection', keys: ['hvKv', 'lvKv', 'vectorGroup', 'tapType', 'tapStepPct', 'tapStepsEachSide', 'hvBilKv', 'hvAcKv'] },
    { title: 'Performance', keys: ['ukPct', 'i0Pct', 'p0W', 'pkW'] },
  ];
  const PAIRS = [['frequencyHz', 'cooling'], ['hvKv', 'lvKv'], ['tapStepPct', 'tapStepsEachSide'], ['hvBilKv', 'hvAcKv'], ['ukPct', 'i0Pct'], ['p0W', 'pkW']];
  const COOLING = { oil: ['ONAN', 'ONAF'], dry: ['AN', 'AF'] };
  const ENUM_LABELS = {
    type: { oil: 'Oil-immersed', dry: 'Dry-type' },
    windingMaterial: { Cu: 'Copper', Al: 'Aluminium' },
    tapType: { none: 'None (fixed ratio)', OCTC: 'Off-circuit (OCTC)', OLTC: 'On-load (OLTC)' },
    sealing: { '': 'Automatic (by rating)', hermetic: 'Hermetically sealed', conservator: 'With conservator' },
  };
  const EXAMPLE = {
    name: 'TR-001', type: 'oil', ratedPowerKva: '1000', frequencyHz: '50', cooling: 'ONAN', windingMaterial: 'Cu', sealing: '',
    hvKv: '20', lvKv: '0.4', vectorGroup: 'Dyn11', tapType: 'OCTC', tapStepPct: '2.5', tapStepsEachSide: '2', hvBilKv: '125', hvAcKv: '50',
    ukPct: '6', i0Pct: '0.3', p0W: '1100', pkW: '10500',
  };
  const CONFIDENCE = {
    designed: { icon: '✓', text: 'Designed', help: 'Your own as-designed value' },
    derived: { icon: '✓', text: 'Derived', help: 'Follows directly from the specification' },
    catalog: { icon: '✓', text: 'Catalog', help: 'Catalog item chosen by rating' },
    default: { icon: '○', text: 'Default', help: 'Standard accessory set assumed' },
    estimate: { icon: '▲', text: 'Estimate', help: 'Placeholder sizing rule: replace before relying on it' },
    unmatched: { icon: '✕', text: 'Unmatched', help: 'Nothing in the catalog fits: needs a human' },
  };
  const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

  const state = { fields: [], designedGroups: [], designedBox: null, inputs: {}, errors: {}, design: null, tab: 'overview', onlyAttention: false };
  let timer = null;
  let seq = 0;

  // ---------- form ----------

  function buildField(f) {
    const id = `f-${f.key}`;
    let input;
    if (f.type === 'enum') {
      input = h('select', { id, name: f.key });
    } else {
      input = h('input', { id, name: f.key, type: 'text', inputmode: f.type === 'number' ? 'decimal' : 'text', placeholder: f.default !== undefined ? String(f.default) : '' });
    }
    input.setAttribute('aria-describedby', `err-${f.key}`);
    state.inputs[f.key] = input;
    const label = h('span', { class: 'label' }, f.label, f.unit ? h('span', { class: 'unit' }, ` (${f.unit})`) : null, f.required ? ' *' : null);
    const error = h('span', { class: 'error', id: `err-${f.key}` });
    return h('label', { class: 'field', for: id, 'data-key': f.key }, label, input, error);
  }

  function buildForm() {
    const form = $('#spec-form');
    const byKey = Object.fromEntries(state.fields.map((f) => [f.key, f]));
    const built = {};
    state.fields.forEach((f) => { built[f.key] = buildField(f); });
    GROUPS.forEach((g) => {
      const fs = h('fieldset', {}, h('legend', {}, g.title));
      const done = new Set();
      g.keys.forEach((k) => {
        if (done.has(k) || !byKey[k]) return;
        const pair = PAIRS.find((p) => p[0] === k && g.keys.includes(p[1]));
        if (pair) {
          pair.forEach((x) => done.add(x));
          fs.append(h('div', { class: 'row-2' }, built[pair[0]], built[pair[1]]));
        } else {
          fs.append(built[k]);
        }
      });
      form.append(fs);
    });
    buildDesignedSection(form, built);
    form.addEventListener('input', schedule);
    form.addEventListener('change', () => { syncDependent(); schedule(); });
    form.addEventListener('submit', (e) => e.preventDefault());
    fillEnumOptions();
  }

  // Optional real values from the engineers' own calculations; blank means "keep the estimate".
  function buildDesignedSection(form, built) {
    const designed = state.fields.filter((f) => f.section === 'designed');
    if (!designed.length) return;
    const box = h('details', { class: 'designed' },
      h('summary', {}, 'As-designed data (optional) ', h('span', { class: 'count', id: 'designed-count' }, '')),
      h('p', { class: 'hint' }, 'Enter your real values to replace the placeholder estimates. A blank field keeps its estimate, shown in grey. Lengths are in mm.'));
    state.designedGroups.forEach((g) => {
      const fs = h('fieldset', {}, h('legend', {}, g.title));
      const inGroup = designed.filter((f) => f.group === g.id);
      for (let i = 0; i < inGroup.length; i += 2) {
        const [a, b] = [inGroup[i], inGroup[i + 1]];
        fs.append(b ? h('div', { class: 'row-2' }, built[a.key], built[b.key]) : built[a.key]);
      }
      box.append(fs);
    });
    form.append(box);
    state.designedBox = box;
  }

  const isDesignedKey = (key) => state.fields.some((f) => f.key === key && f.section === 'designed');

  // Show each blank input's estimate as its placeholder, and how many values are real.
  function updateDesignedUi(rows) {
    rows.forEach((r) => {
      const el = state.inputs[r.key];
      if (el) el.placeholder = r.source === 'estimate' ? `~${r.value}` : '';
    });
    const count = $('#designed-count');
    if (count) {
      const n = rows.filter((r) => r.source === 'designed').length;
      count.textContent = n ? `${n} of ${rows.length} entered` : 'none entered';
    }
  }

  function fillEnumOptions() {
    state.fields.filter((f) => f.type === 'enum' && f.key !== 'cooling').forEach((f) => {
      const sel = state.inputs[f.key];
      const options = f.key === 'sealing' ? ['', ...f.options] : f.options;
      sel.replaceChildren(...options.map((o) => h('option', { value: o }, (ENUM_LABELS[f.key] || {})[o] ?? o)));
    });
    syncCooling();
  }

  function syncCooling(preferred) {
    const sel = state.inputs.cooling;
    const options = COOLING[state.inputs.type.value] || COOLING.oil;
    const keep = preferred ?? sel.value;
    sel.replaceChildren(...options.map((o) => h('option', { value: o }, o)));
    sel.value = options.includes(keep) ? keep : options[0];
  }

  function syncDependent() {
    syncCooling();
    const dry = state.inputs.type.value === 'dry';
    $('[data-key="sealing"]').classList.toggle('hidden', dry);
    state.fields.filter((f) => f.oilOnly).forEach((f) => $(`[data-key="${f.key}"]`).classList.toggle('hidden', dry));
    const noTap = state.inputs.tapType.value === 'none';
    ['tapStepPct', 'tapStepsEachSide'].forEach((k) => { state.inputs[k].disabled = noTap; });
  }

  function setValues(values) {
    state.fields.forEach((f) => {
      const el = state.inputs[f.key];
      if (f.key === 'cooling') return;
      let v = values[f.key];
      if (v === undefined || v === null) v = f.type === 'enum' ? (f.key === 'sealing' ? '' : f.default ?? f.options[0]) : '';
      el.value = String(v);
      if (f.type === 'enum' && el.value !== String(v)) el.value = f.key === 'sealing' ? '' : f.options[0];
    });
    syncCooling(values.cooling);
    syncDependent();
    if (state.designedBox && state.fields.some((f) => f.section === 'designed' && state.inputs[f.key].value !== '')) {
      state.designedBox.open = true;
    }
  }

  function collect() {
    const out = {};
    state.fields.forEach((f) => {
      const el = state.inputs[f.key];
      out[f.key] = el.disabled || el.closest('.field').classList.contains('hidden') ? '' : el.value;
    });
    if (state.inputs.tapType.value === 'none') { out.tapStepPct = ''; out.tapStepsEachSide = ''; }
    return out;
  }

  function showErrors(errors) {
    state.fields.forEach((f) => {
      const msg = errors.filter((e) => e.field === f.key).map((e) => e.message).join('. ');
      $(`#err-${f.key}`).textContent = msg;
      state.inputs[f.key].setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    // An error inside a collapsed section would be invisible.
    if (state.designedBox && errors.some((e) => isDesignedKey(e.field))) state.designedBox.open = true;
  }

  function renderSpecWarnings(warnings) {
    const box = $('#spec-warnings');
    box.replaceChildren();
    if (!warnings || !warnings.length) return;
    box.append(h('div', { class: 'msg warning' }, h('strong', {}, 'Check these'), h('ul', {}, warnings.map((w) => h('li', {}, w.message)))));
  }

  // ---------- design request ----------

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  async function run() {
    const mine = ++seq;
    let res;
    let data;
    try {
      res = await fetch('/api/design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) });
      data = await res.json();
    } catch (err) {
      if (mine === seq) setStatus('error', 'Could not reach the server.');
      return;
    }
    if (mine !== seq) return; // a newer request superseded this one
    if (!data.ok) {
      state.design = null;
      showErrors(data.errors || []);
      renderSpecWarnings([]);
      const unplaced = (data.errors || []).filter((e) => !state.inputs[e.field]);
      setStatus('error', `Fix the highlighted fields to see results (${(data.errors || []).length} problem${(data.errors || []).length === 1 ? '' : 's'}).`, unplaced.map((e) => e.message));
      renderResults();
      return;
    }
    state.design = data;
    showErrors([]);
    updateDesignedUi(data.designData);
    renderSpecWarnings(data.warnings);
    setStatus(null);
    renderResults();
  }

  function setStatus(kind, text, extra) {
    const box = $('#status');
    box.replaceChildren();
    if (!kind) return;
    box.append(h('div', { class: `msg ${kind}` }, text, extra && extra.length ? h('ul', {}, extra.map((x) => h('li', {}, x))) : null));
  }

  // ---------- results ----------

  const panels = { overview: $('#view-overview'), schematics: $('#view-schematics'), model: $('#view-model'), diagrams: $('#view-diagrams'), bom: $('#view-bom') };

  function renderResults() {
    const d = state.design;
    // The 3D panel keeps its WebGL canvas between updates, so it is never cleared here.
    Object.entries(panels).forEach(([k, p]) => { if (k !== 'model') p.replaceChildren(); });
    updateModel(d);
    if (!d) {
      panels.overview.append(h('div', { class: 'card' }, h('p', { class: 'hint' }, 'Complete the specification on the left to see results.')));
      return;
    }
    renderOverview(d);
    renderSchematics(d);
    renderDiagrams(d);
    renderBom(d);
  }

  function tile(label, value, sub) {
    return h('div', { class: 'tile' }, h('div', { class: 't-label' }, label), h('div', { class: 't-value' }, value), sub ? h('div', { class: 't-sub' }, sub) : null);
  }

  function renderOverview(d) {
    const { derived: x, spec, bom } = d;
    put(panels.overview,
      h('div', { class: 'tiles' },
        tile('Rated current, HV', `${fmt(x.currents.hvA, 1)} A`, `at ${sig(spec.hvKv)} kV`),
        tile('Rated current, LV', `${fmt0(x.currents.lvA)} A`, `at ${sig(spec.lvKv)} kV`),
        tile('Impedance uk', `${fmt(x.impedance.ukPct, 2)} %`, `ur ${fmt(x.impedance.urPct, 2)} % · ux ${fmt(x.impedance.uxPct, 2)} %`),
        tile('Efficiency at rated load', `${fmt(x.efficiency.ratedPf1Pct, 2)} %`, `cos φ = 1 · ${fmt(x.efficiency.ratedPf08Pct, 2)} % at cos φ = 0.8`),
        tile('Peak efficiency', `${fmt(x.efficiency.maxPf1Pct, 2)} %`, `at ${fmt(x.efficiency.maxLoadFactor * 100, 0)} % of rated load`),
        tile('Voltage regulation', `${fmt(x.regulation.ratedPf08LagPct, 2)} %`, `rated load, cos φ = 0.8 lagging · ${fmt(x.regulation.ratedPf1Pct, 2)} % at cos φ = 1`),
        tile('Total losses', `${fmt(x.totalLossesW / 1000, 2)} kW`, `no-load ${fmt0(spec.p0W)} W · load ${fmt0(spec.pkW)} W`),
        bom.totalMassSource === 'designed'
          ? tile('Total mass', `${fmt0(bom.totalMassKg)} kg`, 'from your design data')
          : tile('Estimated total mass', `~${fmt0(bom.totalMassKg)} kg`, 'placeholder estimate, not a design value'),
        tile(d.model.estimate ? 'Estimated overall size' : 'Overall size', `${fmt0(d.model.overall.lengthMm)} × ${fmt0(d.model.overall.widthMm)} × ${fmt0(d.model.overall.heightMm)} mm`,
          d.model.estimate ? 'L × W × H, includes placeholder estimates' : 'L × W × H, from design data (fittings simplified)')
      ),
      designDataCard(d),
      equivalentCircuitCard(d),
      x.taps.length ? tapCard(d) : null
    );
  }

  function designDataCard(d) {
    const rows = d.designData;
    const n = rows.filter((r) => r.source === 'designed').length;
    const body = [];
    state.designedGroups.forEach((g) => {
      const inGroup = rows.filter((r) => r.group === g.id);
      if (!inGroup.length) return;
      body.push(h('tr', { class: 'group-row' }, h('td', { colspan: 3 }, g.title)));
      inGroup.forEach((r) => {
        const c = CONFIDENCE[r.source === 'designed' ? 'designed' : 'estimate'];
        body.push(h('tr', {},
          h('td', {}, r.label),
          h('td', { class: 'num' }, `${r.source === 'estimate' ? '~' : ''}${r.value.toLocaleString('en-US')}${r.unit ? ` ${r.unit}` : ''}`),
          h('td', {}, h('span', { class: `badge ${r.source === 'designed' ? 'designed' : 'estimate'}`, title: c.help }, `${c.icon} ${c.text}`))));
      });
    });
    return h('div', { class: 'card table-wrap' },
      h('table', {},
        h('caption', {}, 'Design data in use'),
        h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, 'Value'), h('th', {}, 'Source'))),
        h('tbody', {}, body)),
      h('p', { class: 'hint', style: 'margin-top:8px' }, n === rows.length
        ? `All ${n} values come from your design data.`
        : n
          ? `${n} of ${rows.length} values come from your design data; the rest are placeholder estimates. Enter them under "As-designed data" to replace them.`
          : 'Nothing entered yet: every value is a placeholder estimate. Enter your real values under "As-designed data" or import them from a table.'));
  }

  function equivalentCircuitCard(d) {
    const { hv, lv } = d.derived.equivalentCircuit;
    const row = (name, key, unit) => h('tr', {}, h('td', {}, name), h('td', { class: 'num' }, hv[key] == null ? '—' : `${sig(hv[key])} ${unit}`), h('td', { class: 'num' }, lv[key] == null ? '—' : `${sig(lv[key])} ${unit}`));
    return h('div', { class: 'card table-wrap' },
      h('table', {},
        h('caption', {}, 'Equivalent circuit (per phase, star-equivalent)'),
        h('thead', {}, h('tr', {}, h('th', {}, 'Parameter'), h('th', { class: 'num' }, `Referred to HV (${sig(d.spec.hvKv)} kV)`), h('th', { class: 'num' }, `Referred to LV (${sig(d.spec.lvKv)} kV)`))),
        h('tbody', {},
          row('Winding resistance Rk', 'rkOhm', 'Ω'),
          row('Leakage reactance Xk', 'xkOhm', 'Ω'),
          row('Short-circuit impedance Zk', 'zkOhm', 'Ω'),
          row('Core-loss resistance Rm', 'rmOhm', 'Ω'),
          row('Magnetising reactance Xm', 'xmOhm', 'Ω'))),
      hv.xmOhm == null ? h('p', { class: 'hint', style: 'margin-top:8px' }, 'Magnetising reactance needs the no-load current i0 (and i0 must exceed the loss component).') : null);
  }

  function tapCard(d) {
    return h('div', { class: 'card table-wrap' },
      h('table', {},
        h('caption', {}, `Tap positions (${d.spec.tapType}, on the HV winding)`),
        h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Position'), h('th', { class: 'num' }, 'Change'), h('th', { class: 'num' }, 'HV voltage'))),
        h('tbody', {}, d.derived.taps.map((t) => h('tr', {},
          h('td', { class: 'num' }, t.position),
          h('td', { class: 'num' }, `${t.percent > 0 ? '+' : ''}${fmt(t.percent, 1)} %`),
          h('td', { class: 'num' }, `${fmt(t.hvKv, 3)} kV`))))));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function svgCard(title, svgString, filename) {
    const body = h('div', { class: 'diagram' });
    body.innerHTML = svgString; // produced and escaped by the server (src/schematics.js)
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, title),
        h('button', {
          type: 'button',
          class: 'btn subtle',
          onclick: () => downloadBlob(new Blob([svgString.replace('<svg ', '<svg style="color:#1b1b1a;background:#ffffff" ')], { type: 'image/svg+xml' }), filename),
        }, 'Download SVG')),
      body);
  }

  function renderSchematics(d) {
    const base = (d.spec.name || 'transformer').replace(/[^A-Za-z0-9_-]+/g, '_');
    panels.schematics.append(h('div', { class: 'diagram-grid' },
      svgCard('Single-line diagram', d.svg.singleLine, `${base}-single-line.svg`),
      svgCard('Vector group', d.svg.phasor, `${base}-vector-group.svg`)));
  }

  function renderDiagrams(d) {
    const c = d.derived.curves;
    const xs = c.loadFactors;
    const common = { xs, xLabel: 'Load factor k (fraction of rated load)', tableLabel: 'Load factor k', xTicks: [0.2, 0.4, 0.6, 0.8, 1, 1.2], xFormat: (v) => v.toFixed(2), refX: { x: 1, label: 'Rated load' } };
    const effBox = h('div', { class: 'card chart-card' });
    const regBox = h('div', { class: 'card chart-card' });
    panels.diagrams.append(effBox, regBox);

    const e = d.derived.efficiency;
    window.TDCharts.lineChart(effBox, {
      ...common,
      title: 'Efficiency vs load',
      yLabel: 'Efficiency (%)',
      yUnit: '%',
      yDigits: 2,
      series: c.efficiency.map((s, i) => ({ label: s.label, values: s.values, color: SERIES[i] })),
      highlight: e.maxLoadFactor >= xs[0] && e.maxLoadFactor <= xs[xs.length - 1]
        ? { x: e.maxLoadFactor, y: e.maxPf1Pct, label: `Peak ${fmt(e.maxPf1Pct, 2)} % at k = ${fmt(e.maxLoadFactor, 2)}`, seriesIndex: 0 }
        : null,
    });
    window.TDCharts.lineChart(regBox, {
      ...common,
      title: 'Voltage regulation vs load',
      yLabel: 'Voltage drop (%)',
      yUnit: '%',
      yDigits: 2,
      series: c.regulation.map((s, i) => ({ label: s.label, values: s.values, color: SERIES[i] })),
    });
  }

  function qtyText(q) {
    return typeof q === 'number' ? (Number.isInteger(q) ? fmt0(q) : fmt(q, 1)) : String(q);
  }

  function renderBom(d) {
    const { bom, spec } = d;
    const holder = h('div', { class: 'card' });
    const tableHolder = h('div', { class: 'table-wrap' });

    const draw = () => {
      const lines = bom.lines.filter((l) => !state.onlyAttention || l.confidence === 'estimate' || l.confidence === 'unmatched');
      let group = null;
      const rows = [];
      lines.forEach((l) => {
        if (l.group !== group) {
          group = l.group;
          rows.push(h('tr', { class: 'group-row' }, h('td', { colspan: 7 }, group)));
        }
        const c = CONFIDENCE[l.confidence];
        rows.push(h('tr', {},
          h('td', {}, l.item),
          h('td', {}, l.description),
          h('td', { class: 'num' }, qtyText(l.qty)),
          h('td', {}, l.unit),
          h('td', { class: 'code' }, l.code || ''),
          h('td', {}, h('span', { class: `badge ${l.confidence}`, title: c.help }, `${c.icon} ${c.text}`)),
          h('td', { class: 'basis' }, l.basis)));
      });
      tableHolder.replaceChildren(h('table', {},
        h('caption', {}, `${spec.name || 'Transformer'}: ${fmt0(spec.ratedPowerKva)} kVA, ${sig(spec.hvKv)}/${sig(spec.lvKv)} kV, ${spec.vectorGroup}`),
        h('thead', {}, h('tr', {}, ['Item', 'Description', 'Qty', 'Unit', 'Catalog code', 'Confidence', 'Basis'].map((t, i) => h('th', { class: i === 2 ? 'num' : '' }, t)))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 7 }, 'Nothing needs attention.')))));
    };

    const checkbox = h('input', { type: 'checkbox', id: 'only-attention', onchange: (e) => { state.onlyAttention = e.target.checked; draw(); } });
    checkbox.checked = state.onlyAttention;
    const xlsxBtn = h('button', { type: 'button', class: 'btn primary', onclick: downloadBom }, 'Download BOM (.xlsx)');

    const notices = [];
    bom.warnings.forEach((w) => notices.push(h('div', { class: 'msg warning' }, w)));
    bom.assumptions.forEach((a) => notices.push(h('div', { class: 'msg info' }, `Assumption: ${a}`)));
    if (bom.catalogNotice) notices.push(h('div', { class: 'msg info' }, bom.catalogNotice));

    const legend = h('dl', { class: 'kv', style: 'margin-top:12px' }, Object.values(CONFIDENCE).flatMap((c) => [h('dt', {}, `${c.icon} ${c.text}`), h('dd', {}, c.help)]));

    holder.append(
      h('div', { class: 'toolbar' }, h('label', { for: 'only-attention' }, checkbox, 'Show only lines that need attention'), xlsxBtn),
      ...notices, h('div', { style: 'height:10px' }), tableHolder, legend);
    panels.bom.append(holder);
    draw();
  }

  async function downloadBom() {
    try {
      const res = await fetch('/api/bom.xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collect()) });
      if (!res.ok) throw new Error(String(res.status));
      const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'bom.xlsx';
      downloadBlob(await res.blob(), name);
    } catch (err) {
      setStatus('error', 'Could not create the Excel file.');
    }
  }

  // ---------- 3D model ----------

  const LAYERS = [
    ['active', 'Active part'],
    ['tank', 'Tank'],
    ['cooling', 'Cooling'],
    ['terminals', 'Bushings / terminals'],
    ['accessories', 'Accessories'],
  ];
  const model3d = { viewer: null, loading: false, failed: false, pending: null, ui: null, layers: Object.fromEntries(LAYERS.map(([k]) => [k, true])), xray: true };

  function buildModelPanel() {
    const hover = h('div', { class: 'viewer-label', hidden: true });
    const stage = h('div', { class: 'viewer', role: 'img', 'aria-label': 'Interactive 3D model of the transformer. Drag to rotate, scroll to zoom, right-drag to pan.' });
    stage.append(hover);
    const info = h('p', { class: 'hint' });
    const status = h('div');
    const layerBoxes = LAYERS.map(([key, label]) => {
      const box = h('input', { type: 'checkbox', id: `layer-${key}`, onchange: (e) => { model3d.layers[key] = e.target.checked; model3d.viewer && model3d.viewer.setLayerVisible(key, e.target.checked); } });
      box.checked = true;
      return h('label', { for: `layer-${key}` }, box, label);
    });
    const xray = h('input', { type: 'checkbox', id: 'xray', onchange: (e) => { model3d.xray = e.target.checked; model3d.viewer && model3d.viewer.setXray(e.target.checked); } });
    xray.checked = true;
    const viewBtn = (label, action) => h('button', { type: 'button', class: 'btn subtle', onclick: () => model3d.viewer && action(model3d.viewer) }, label);
    const exportBtn = h('button', { type: 'button', class: 'btn primary', onclick: exportGlb }, 'Download .glb');

    panels.model.append(h('div', { class: 'card' },
      h('div', { class: 'toolbar' }, h('div', { class: 'checks' }, layerBoxes, h('label', { for: 'xray' }, xray, 'X-ray tank')), exportBtn),
      h('div', { class: 'toolbar', style: 'margin-top:8px' }, h('div', { class: 'views' }, viewBtn('Isometric', (v) => v.setView('iso')), viewBtn('Front (LV side)', (v) => v.setView('front')), viewBtn('Side', (v) => v.setView('side')), viewBtn('Top', (v) => v.setView('top')), viewBtn('Reset view', (v) => v.fit())), info),
      status,
      stage,
      h('div', { class: 'legend', style: 'margin-top:10px' },
        [['var(--series-1)', 'HV winding'], ['var(--series-2)', 'LV winding'], ['#59616c', 'Core'], ['#a0653f', 'Bushings'], ['#9aa7b5', 'Tank, radiators']].map(([c, t]) =>
          h('span', { class: 'key' }, h('span', { class: 'swatch', style: `background:${c}` }, ''), t))),
      h('p', { class: 'hint' }, 'Colours identify HV and LV windings, not the real materials. Drag to rotate, scroll to zoom, right-drag to pan. "Download .glb" exports what is visible, in metres.')));
    model3d.ui = { stage, hover, info, status };
    return model3d.ui;
  }

  function applyModelUi() {
    const v = model3d.viewer;
    LAYERS.forEach(([k]) => v.setLayerVisible(k, model3d.layers[k]));
    v.setXray(model3d.xray);
  }

  // Text above the viewer. `state.design` is null while the specification is invalid.
  function refreshModelText() {
    if (!model3d.ui) return;
    const m = model3d.pending;
    model3d.ui.info.textContent = m ? `${m.estimate ? '≈ ' : ''}${fmt0(m.overall.lengthMm)} × ${fmt0(m.overall.widthMm)} × ${fmt0(m.overall.heightMm)} mm (L × W × H)${m.estimate ? ', includes placeholder estimates' : ', from design data'}` : '';
    model3d.ui.status.replaceChildren();
    put(model3d.ui.status,
      m ? h('div', { class: `msg ${m.estimate ? 'warning' : 'info'}` }, m.notice) : null,
      !state.design && m ? h('div', { class: 'msg info' }, 'The specification has errors. Showing the last valid model.') : null);
  }

  // Called with the new design, or null when the specification became invalid (the last model stays).
  function updateModel(d) {
    if (d) model3d.pending = d.model;
    refreshModelText();
    if (model3d.viewer && d) {
      model3d.viewer.setModel(d.model);
      applyModelUi();
    }
  }

  async function ensureModelPanel() {
    if (!model3d.ui) buildModelPanel();
    if (model3d.viewer || model3d.loading || model3d.failed) {
      refreshModelText();
      return;
    }
    model3d.loading = true;
    model3d.ui.stage.append(h('div', { class: 'viewer-msg', id: 'viewer-loading' }, 'Loading 3D viewer…'));
    try {
      const { createViewer } = await import('/model3d.js');
      const viewer = createViewer(model3d.ui.stage, {
        onHover: (part, x, y) => {
          const label = model3d.ui.hover;
          label.hidden = !part;
          if (part) {
            label.textContent = part.name;
            label.style.left = `${x + 14}px`;
            label.style.top = `${y + 14}px`;
          }
        },
      });
      if (!viewer) throw new Error('WebGL is not available');
      model3d.viewer = viewer;
      if (model3d.pending) { viewer.setModel(model3d.pending); applyModelUi(); }
    } catch (err) {
      model3d.failed = true;
      model3d.ui.stage.replaceChildren(h('div', { class: 'viewer-msg' }, 'The 3D viewer could not start. It needs a browser with WebGL enabled.'));
    } finally {
      model3d.loading = false;
      const loading = $('#viewer-loading');
      if (loading) loading.remove();
    }
    refreshModelText();
  }

  async function exportGlb() {
    if (!model3d.viewer) return;
    try {
      const blob = await model3d.viewer.exportGlb();
      const base = ((state.design && state.design.spec.name) || 'transformer').replace(/[^A-Za-z0-9_-]+/g, '_');
      downloadBlob(blob, `${base}.glb`);
    } catch (err) {
      setStatus('error', 'Could not export the 3D model.');
    }
  }

  // ---------- tabs ----------

  function selectTab(name, focus) {
    state.tab = name;
    Object.entries(panels).forEach(([k, p]) => { p.hidden = k !== name; });
    document.querySelectorAll('.tabs [role="tab"]').forEach((t) => {
      const on = t.id === `tab-${name}`;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    if (name === 'model') ensureModelPanel();
  }

  function initTabs() {
    const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => selectTab(t.id.replace('tab-', '')));
      t.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        selectTab(tabs[(i + step + tabs.length) % tabs.length].id.replace('tab-', ''), true);
      });
    });
  }

  // ---------- import ----------

  function initImport() {
    const input = $('#file-input');
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (file) await importFile(file);
    });
    $('#reset').addEventListener('click', () => {
      $('#import-result').replaceChildren();
      setValues(EXAMPLE);
      schedule();
    });
  }

  async function importFile(file) {
    const box = $('#import-result');
    box.replaceChildren(h('p', { class: 'hint' }, `Reading ${file.name}…`));
    let data;
    try {
      const res = await fetch('/api/import', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
      data = await res.json();
      if (!res.ok) {
        box.replaceChildren(h('div', { class: 'msg error' }, data.error || 'Import failed'));
        return;
      }
    } catch (err) {
      box.replaceChildren(h('div', { class: 'msg error' }, 'Could not reach the server.'));
      return;
    }
    renderImport(box, data, file.name);
  }

  function renderImport(box, data, filename) {
    box.replaceChildren();
    if (!data.specs.length) {
      box.append(h('div', { class: 'msg error' }, `No transformer data recognised in ${filename}. Download the template to see the expected layout.`,
        data.ignoredColumns.length ? h('div', {}, `Columns not recognised: ${data.ignoredColumns.join(', ')}`) : null));
      return;
    }
    const details = h('div');
    const buttons = [];
    const pick = (spec, btn) => {
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      setValues(spec.values);
      details.replaceChildren();
      if (spec.notes.length) {
        details.append(h('div', { class: 'msg warning' }, h('strong', {}, 'Import notes'), h('ul', {}, spec.notes.map((n) => h('li', {}, n.message)))));
      }
      run();
    };
    data.specs.forEach((s, i) => {
      const label = `${i + 1}. ${s.values.name || 'Unnamed'}${s.values.ratedPowerKva ? ` · ${s.values.ratedPowerKva} kVA` : ''} ${s.validation.ok ? '✓' : `✕ ${s.validation.errors.length} problem${s.validation.errors.length === 1 ? '' : 's'}`}`;
      const btn = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', onclick: () => pick(s, btn) }, label);
      buttons.push(btn);
    });
    put(box,
      h('div', { class: 'msg ok' }, `Read ${data.specs.length} transformer${data.specs.length === 1 ? '' : 's'} from ${filename} (${data.layout} layout).`),
      data.ignoredColumns.length ? h('div', { class: 'msg info' }, `Not recognised, ignored: ${data.ignoredColumns.join(', ')}`) : null,
      data.specs.length > 1 ? h('div', { class: 'candidates' }, buttons) : null,
      details);
    pick(data.specs[0], buttons[0]);
  }

  // ---------- start ----------

  async function init() {
    initTabs();
    try {
      const res = await fetch('/api/fields');
      const body = await res.json();
      state.fields = body.fields;
      state.designedGroups = body.designedGroups || [];
    } catch (err) {
      setStatus('error', 'Could not load the form from the server.');
      return;
    }
    buildForm();
    initImport();
    setValues(EXAMPLE);
    renderResults();
    run();
  }

  init();
})();
