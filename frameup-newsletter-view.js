// Dashboard → Newsletter (admins only): every Newsletter export people make.
// Image exports (Feature Image, headers, Video / Tag / Archive Page FI...)
// come from the task list dashboard-data.js already loads; copied widget HTML
// and image links come from the usage log (ESDashboardData.fetchUsageEvents).
// Summary strip, exports over time, breakdowns by asset, person and
// newsletter, and a recent-exports table with filters and search.
//
// Mounted by dashboard.html into <section id="newsletter-view">. The maths
// lives in frameup-newsletter-stats.js. Nothing here writes anywhere.
(() => {
  'use strict';

  const S = window.FrameUpNewsletterStats;
  if (!S) return;

  const RANGES = [7, 30, 90];
  const PAGE = 25;
  const EVENTS_DAYS = 90;

  const state = {
    days: 30,
    filters: { person: '', asset: '', brand: '', search: '' },
    limit: PAGE,
    events: { rows: [], ready: false, loading: false, loaded: false, error: '' },
    model: null,
  };
  let root = null;
  let searchTimer = 0;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('en-US');
  const plural = (n, one, many = `${one}s`) => `${fmt(n)} ${n === 1 ? one : many}`;
  const dayLabel = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const whenLabel = ms => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));

  // ── Data ──────────────────────────────────────────────────────────────────
  function dashboardState() {
    try { return window.ESDashboardData?.getDashboardState?.() || null; } catch (error) { return null; }
  }

  // 'loading' | 'error' | 'stale' | 'ready', the same rule as the Overview.
  function phaseOf(dash) {
    if (!dash) return 'error';
    const tasks = dash.tasks || [];
    if (dash.cloudSyncStatus?.ok === false) return tasks.length ? 'stale' : 'error';
    if (dash.cloudSyncStatus?.ok == null && !tasks.length) return 'loading';
    return 'ready';
  }

  async function loadEvents({ force = false } = {}) {
    const fetcher = window.ESDashboardData?.fetchUsageEvents;
    if (!fetcher || state.events.loading || (state.events.loaded && !force)) return;
    state.events.loading = true;
    render();
    try {
      const since = new Date(Date.now() - EVENTS_DAYS * 86400000).toISOString();
      const result = await fetcher({ sinceIso: since, tool: 'newsletter', categories: ['copy', 'share'] });
      state.events.rows = result?.rows || [];
      state.events.ready = Boolean(result?.ready);
      state.events.error = result?.ready ? '' : String(result?.error || '');
    } catch (error) {
      state.events.ready = false;
      state.events.error = String(error?.message || error);
    } finally {
      state.events.loading = false;
      state.events.loaded = true;
      render();
    }
  }

  function buildModel() {
    const dash = dashboardState();
    const phase = phaseOf(dash);
    const names = {};
    (dash?.people || []).forEach(person => {
      const email = String(person?.email || '').toLowerCase();
      // Skip placeholder names (the email, or the part before the @).
      const name = String(person?.name || '').trim();
      if (email && name && !/@/.test(name) && name.toLowerCase() !== email.split('@')[0]) names[email] = name;
    });
    const all = S.combine({ tasks: dash?.tasks || [], events: state.events.rows, names });
    const f = state.filters;
    const scoped = S.applyFilters(all, { person: f.person, asset: f.asset, brand: f.brand, search: f.search });
    const summary = S.summarize(scoped, { days: state.days });
    const rows = scoped.filter(row => row.at >= summary.range.from && row.at <= summary.range.to);
    const options = S.filterOptions(all);
    const legacyInRange = rows.filter(row => row.kind === 'image' && !row.detailed).length;
    return { phase, all, rows, summary, options, legacyInRange };
  }

  // ── Pieces ────────────────────────────────────────────────────────────────
  function select(id, key, label, value, allLabel, items) {
    return `<label class="nl-filter" for="${id}"><span class="nl-filter__label">${esc(label)}</span>
      <select class="es-select nl-select" id="${id}" data-nl-filter="${key}">
        <option value="">${esc(allLabel)}</option>
        ${items.map(item => `<option value="${esc(item.key)}"${item.key === value ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}
      </select></label>`;
  }

  function toolbar(m) {
    const f = state.filters;
    const active = f.person || f.asset || f.brand || f.search;
    const opts = m?.options || { people: [], assets: [], brands: [] };
    const brands = opts.brands.length ? [...opts.brands, { key: '__none', label: 'Not recorded' }] : [];
    return `
      <div class="nl-toolbar" role="group" aria-label="Newsletter export filters">
        <div class="nl-filter"><span class="nl-filter__label" id="nl-range-label">Date range</span>
          <div class="dov-segment" role="group" aria-labelledby="nl-range-label">
            ${RANGES.map(days => `<button type="button" data-nl-range="${days}" aria-pressed="${state.days === days}">${days}d</button>`).join('')}
          </div>
        </div>
        ${select('nl-filter-person', 'person', 'Person', f.person, 'Everyone', opts.people)}
        ${select('nl-filter-asset', 'asset', 'Asset type', f.asset, 'All assets', opts.assets)}
        ${brands.length ? select('nl-filter-brand', 'brand', 'Newsletter', f.brand, 'All newsletters', brands) : ''}
        <label class="nl-filter nl-filter--search" for="nl-search"><span class="nl-filter__label">Search</span>
          <span class="es-search nl-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
            <input type="search" id="nl-search" placeholder="Headline, file, person" value="${esc(f.search)}" autocomplete="off">
          </span>
        </label>
        <span class="nl-toolbar__end">
          ${active ? '<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-nl-reset>Clear filters</button>' : ''}
          <button class="es-btn es-btn--sm es-btn--secondary" type="button" data-nl-refresh${state.events.loading ? ' aria-busy="true" disabled' : ''}>Refresh</button>
        </span>
      </div>`;
  }

  function notices(m) {
    if (!m || m.phase === 'loading') return '';
    const out = [];
    if (m.phase === 'stale') out.push('<p class="nl-notice" role="status"><strong>Couldn’t refresh.</strong> Showing the exports loaded earlier.</p>');
    if (state.events.loaded && !state.events.ready) {
      out.push('<p class="nl-notice" role="status">Copied widget HTML and image links aren’t included: the usage log couldn’t be read. Image exports are complete.</p>');
    }
    if (m.legacyInRange) {
      out.push(`<p class="nl-notice" role="status">The newsletter brand is recorded for exports from Nov 21, 2026. ${plural(m.legacyInRange, 'older export')} in this range show the asset from the template name and no brand.</p>`);
    }
    return out.join('');
  }

  function kpis(m) {
    const loading = !m || m.phase === 'loading';
    const s = m?.summary;
    const tile = (label, value, meta, extra = '') => `
      <article class="dov-kpi nl-kpi${loading ? ' is-loading' : ''}${extra}">
        <h3 class="dov-kpi-label es-type-eyebrow">${esc(label)}</h3>
        <p class="dov-kpi-value">${loading ? '—' : value}</p>
        <p class="dov-kpi-meta">${loading ? '&nbsp;' : meta}</p>
      </article>`;
    const top = (entry, unit) => entry ? `<span class="nl-kpi-name" title="${esc(entry.label)}">${esc(entry.label)}</span>` : '<span class="nl-kpi-name is-none">None yet</span>';
    return `<section class="nl-kpis" aria-label="Newsletter export totals">
      ${tile('This week', fmt(s?.thisWeek), 'Since Monday')}
      ${tile('Last 7 days', fmt(s?.last7), 'Including today')}
      ${tile('Last 30 days', fmt(s?.last30), 'Including today')}
      ${tile('Last 90 days', fmt(s?.last90), 'Including today')}
      ${tile('Most exported', top(s?.topAsset), s?.topAsset ? `${plural(s.topAsset.count, 'export')} in ${state.days} days` : `In the last ${state.days} days`, ' is-text')}
      ${tile('Most active', top(s?.topPerson), s?.topPerson ? `${plural(s.topPerson.count, 'export')} in ${state.days} days` : `In the last ${state.days} days`, ' is-text')}
    </section>`;
  }

  function skeleton(rows = 4, kind = 'row') {
    return `<div class="dov-skel is-${kind}" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => '<div class="dov-skel-row"><span class="es-skeleton dov-skel-dot"></span><span class="dov-skel-lines"><span class="es-skeleton"></span><span class="es-skeleton"></span></span></div>').join('')}</div>`;
  }

  function filtered() {
    const f = state.filters;
    return Boolean(f.person || f.asset || f.brand || f.search);
  }

  function empty(title, body) {
    return `<div class="dov-empty"><p class="dov-empty-title">${esc(title)}</p>${body ? `<p class="dov-empty-text">${esc(body)}</p>` : ''}</div>`;
  }
  function noneInRange() {
    return filtered()
      ? empty('No newsletter exports match these filters', 'Clear the filters or pick a longer range.')
      : empty(`No newsletter exports in the last ${state.days} days`, 'Exports from the Newsletter workspace show up here.');
  }

  // Same look as the Overview's "Exports over time" (line, soft area, round
  // HTML dots, hover line and tooltip); weekly totals above 30 days.
  function chart(m) {
    const { weekly, buckets } = m.summary.series;
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    if (!total) return noneInRange();
    const width = 640;
    const height = 180;
    const pad = { l: 8, r: 14, t: 16, b: 8 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const max = Math.max(1, ...buckets.map(b => b.count));
    const stepX = buckets.length > 1 ? plotW / (buckets.length - 1) : 0;
    const points = buckets.map((b, i) => ({ ...b, x: pad.l + stepX * i, y: pad.t + (1 - b.count / max) * plotH }));
    const line = points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const floorY = (pad.t + plotH).toFixed(1);
    const area = `${line} L ${points.at(-1).x.toFixed(1)} ${floorY} L ${points[0].x.toFixed(1)} ${floorY} Z`;
    const grid = [0, 0.5, 1].map(t => `<line x1="${pad.l}" x2="${pad.l + plotW}" y1="${(pad.t + (1 - t) * plotH).toFixed(1)}" y2="${(pad.t + (1 - t) * plotH).toFixed(1)}" class="dov-chart-grid"/>`).join('');
    const tickCount = Math.min(state.days === 90 ? 7 : 6, points.length);
    const tickStep = tickCount > 1 ? (points.length - 1) / (tickCount - 1) : 0;
    const ticks = Array.from({ length: tickCount }, (_, i) => points[Math.round(i * tickStep)]);
    const pct = (v, of) => `${((v / of) * 100).toFixed(2)}%`;
    const dot = (p, last) => `<span class="dov-chart-pt${last ? ' is-last' : ''}" style="left:${pct(p.x, width)};top:${pct(p.y, height)}"></span>`;
    const dots = points.length <= 31 ? points.map((p, i) => dot(p, i === points.length - 1)).join('') : dot(points.at(-1), true);
    const peak = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);
    const label = `Newsletter exports in the last ${state.days} days, ${weekly ? 'weekly' : 'daily'}: ${total} in total, peak ${peak.count} ${weekly ? 'in the week of' : 'on'} ${dayLabel(peak.at)}`;
    state.chartPoints = points;
    return `
      <div class="exports-trend-chart-wrap dov-chart nl-chart">
        <span class="dov-chart-max" aria-hidden="true">${fmt(max)}</span>
        <div class="dov-chart-plot">
          <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
            ${grid}
            <path d="${area}" class="dov-chart-area"/>
            <path d="${line}" class="dov-chart-line"/>
            <line class="chart-hover-line" x1="0" y1="${pad.t}" x2="0" y2="${floorY}" opacity="0"/>
          </svg>
          <div class="dov-chart-pts" aria-hidden="true">${dots}</div>
        </div>
        <div class="chart-x-axis dov-chart-axis">${ticks.map(p => `<span class="chart-x-label" style="left:${pct(p.x, width)}">${esc(dayLabel(p.at))}</span>`).join('')}</div>
        <div class="chart-tooltip"></div>
      </div>`;
  }

  function chartMeta(m) {
    const { weekly, buckets } = m.summary.series;
    const total = buckets.reduce((sum, b) => sum + b.count, 0);
    if (!total) return `${weekly ? 'Weekly' : 'Daily'} exports in the last ${state.days} days`;
    const peak = buckets.reduce((best, b) => (b.count > best.count ? b : best), buckets[0]);
    return `${plural(total, 'export')} · ${weekly ? 'weekly' : 'daily'} · peak ${fmt(peak.count)} ${weekly ? 'in the week of' : 'on'} ${dayLabel(peak.at)}`;
  }

  function bindChart() {
    const wrap = root.querySelector('.nl-chart');
    const svg = wrap?.querySelector('svg');
    const hoverLine = wrap?.querySelector('.chart-hover-line');
    const tooltip = wrap?.querySelector('.chart-tooltip');
    const points = state.chartPoints || [];
    if (!svg || !hoverLine || !tooltip || !points.length) return;
    const width = 640;
    const show = index => {
      const p = points[index];
      if (!p) return;
      hoverLine.style.transform = `translateX(${p.x}px)`;
      hoverLine.setAttribute('opacity', '1');
      tooltip.innerHTML = `<strong>${plural(p.count, 'export')}</strong><span>${esc(p.weekly ? `Week of ${dayLabel(p.at)}` : new Date(p.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))}</span>`;
      const svgRect = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      tooltip.style.left = `${(svgRect.left - wrapRect.left) + p.x * (svgRect.width / width)}px`;
      tooltip.style.top = `${(svgRect.top - wrapRect.top) + p.y * (svgRect.height / Number(svg.viewBox.baseVal.height || 1))}px`;
      tooltip.classList.add('is-visible');
    };
    svg.addEventListener('pointermove', event => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const relX = ((event.clientX - rect.left) / rect.width) * width;
      let nearest = 0;
      points.forEach((p, i) => { if (Math.abs(p.x - relX) < Math.abs(points[nearest].x - relX)) nearest = i; });
      show(nearest);
    });
    svg.addEventListener('pointerleave', () => { hoverLine.setAttribute('opacity', '0'); tooltip.classList.remove('is-visible'); });
  }

  // Bars like the Overview's; each label filters the view.
  function bars(list, { filterKey, total, max: maxRows = 10 } = {}) {
    if (!list.length) return noneInRange();
    const shown = list.slice(0, maxRows);
    const max = Math.max(1, ...shown.map(row => row.count));
    const rest = list.length - shown.length;
    return `<ul class="dov-bars has-share nl-bars">${shown.map(row => `
      <li class="dov-bar-row">
        <span class="dov-bar-label"><button class="nl-link" type="button" data-nl-pick="${filterKey}" data-nl-value="${esc(row.key)}" aria-label="Show only ${esc(row.label)}" title="${esc(row.label)}">${esc(row.label)}</button></span>
        <span class="dov-bar-track" aria-hidden="true"><span style="width:${Math.max(2, (row.count / max) * 100).toFixed(1)}%"></span></span>
        <span class="dov-bar-value">${fmt(row.count)}</span><span class="dov-bar-share">${total ? Math.round((row.count / total) * 100) : 0}%</span>
      </li>`).join('')}</ul>${rest > 0 ? `<p class="dov-note">and ${fmt(rest)} more</p>` : ''}`;
  }

  function brandCard(m) {
    const s = m.summary;
    if (!s.total) return noneInRange();
    if (!s.byBrand.length) return empty('No newsletter recorded yet', 'Exports from Nov 21, 2026 record which newsletter they were made for.');
    return `${bars(s.byBrand, { filterKey: 'brand', total: s.total })}${s.brandMissing ? `<p class="dov-note">${plural(s.brandMissing, 'export')} without a recorded newsletter.</p>` : ''}`;
  }

  function table(m) {
    const rows = m.rows;
    if (!rows.length) return noneInRange();
    const shown = rows.slice(0, state.limit);
    return `<div class="nl-table-wrap"><table class="dov-table is-exports nl-table">
      <caption class="sr-only">Recent newsletter exports, newest first</caption>
      <thead><tr>
        <th scope="col"><span class="sr-only">Preview</span></th>
        <th scope="col">Design</th>
        <th scope="col">Asset</th>
        <th scope="col">Newsletter</th>
        <th scope="col">Size · file</th>
        <th scope="col">Exported by</th>
        <th scope="col">When</th>
        <th scope="col"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>${shown.map(row => {
        const image = row.kind === 'image' && row.taskId;
        const thumb = image
          ? `<button class="dov-thumb nl-thumb" type="button" data-preview-task="${esc(row.taskId)}" aria-label="Preview ${esc(row.title)}"><span class="es-skeleton"></span></button>`
          : `<span class="nl-thumb is-kind" aria-hidden="true">${row.kind === 'html' ? '&lt;/&gt;' : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'}</span>`;

        return `<tr${image ? ` data-task-id="${esc(row.taskId)}"` : ''}>
          <td class="dov-td-thumb">${thumb}</td>
          <td class="dov-td-main"><span class="dov-cell-title" title="${esc(row.title)}">${esc(row.title)}</span><span class="dov-cell-meta">${esc(row.filename || S.KINDS[row.kind])}</span></td>
          <td class="dov-td-ws nl-td-asset"><span class="dov-cell-strong">${esc(row.assetLabel)}</span><span class="dov-cell-meta">${esc(S.KINDS[row.kind])}</span></td>
          <td class="nl-td-brand">${row.brandRecorded ? esc(row.brandLabel) : '<span class="nl-muted">Not recorded</span>'}</td>
          <td class="nl-td-size"><span class="dov-cell-strong">${esc(row.size || '—')}</span><span class="dov-cell-meta">${esc(row.format || '')}</span></td>
          <td class="dov-td-who">${esc(row.name)}</td>
          <td class="dov-td-when"><time datetime="${new Date(row.at).toISOString()}">${esc(whenLabel(row.at))}</time></td>
          <td class="dov-td-actions">${image ? `<button class="es-btn es-btn--tertiary es-btn--sm" type="button" data-open-task="${esc(row.taskId)}">Details</button>` : ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="nl-table-foot">
      <p class="dov-card-meta" role="status">Showing ${fmt(shown.length)} of ${fmt(rows.length)}</p>
      ${rows.length > shown.length ? '<button class="es-btn es-btn--sm es-btn--secondary" type="button" data-nl-more>Show more</button>' : ''}
    </div>`;
  }

  function card(title, meta, body, { flush = false, id = '' } = {}) {
    return `<article class="dov-card"${id ? ` id="${id}"` : ''}>
      <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">${esc(title)}</h3><p class="dov-card-meta">${esc(meta)}</p></div></header>
      <div class="dov-card-body${flush ? ' is-flush' : ''}">${body}</div>
    </article>`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    if (!root || root.hidden) return;
    const active = document.activeElement && root.contains(document.activeElement) ? document.activeElement : null;
    const focusId = active?.id || '';
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    const m = buildModel();
    state.model = m;
    const loading = m.phase === 'loading';
    const range = `the last ${state.days} days`;
    let body;
    if (m.phase === 'error') {
      body = '<div class="dov-error nl-error" role="alert"><p>Couldn’t load newsletter exports from Supabase.</p><button class="es-btn es-btn--sm" type="button" data-nl-refresh>Try again</button></div>';
    } else {
      const s = m.summary;
      body = `
        ${kpis(m)}
        <section class="dov-section" aria-labelledby="nl-time-title">
          <h2 class="dov-section-title es-type-section" id="nl-time-title">Over time</h2>
          <div class="dov-grid is-2-1">
            ${card('Newsletter exports over time', loading ? 'Loading…' : chartMeta(m), loading ? skeleton(1, 'chart') : chart(m))}
            ${card('By asset type', loading ? 'Loading…' : `${plural(s.total, 'export')} in ${range}`, loading ? skeleton(6) : bars(s.byAsset, { filterKey: 'asset', total: s.total, max: 8 }))}
          </div>
        </section>
        <section class="dov-section" aria-labelledby="nl-who-title">
          <h2 class="dov-section-title es-type-section" id="nl-who-title">People and newsletters</h2>
          <div class="dov-grid is-1-1">
            ${card('By person', loading ? 'Loading…' : `${plural(s.people, 'person', 'people')} exported in ${range}`, loading ? skeleton(5) : bars(s.byPerson, { filterKey: 'person', total: s.total }))}
            ${card('By newsletter', 'Which newsletter the export was made for', loading ? skeleton(5) : brandCard(m))}
          </div>
        </section>
        <section class="dov-section" aria-labelledby="nl-recent-title">
          <h2 class="dov-section-title es-type-section" id="nl-recent-title">Recent exports</h2>
          ${card('Every newsletter export', loading ? 'Loading…' : `${plural(m.rows.length, 'export')} in ${range} · newest first`, loading ? skeleton(6) : table(m), { flush: true, id: 'nl-recent-card' })}
        </section>`;
    }
    root.innerHTML = `
      <header class="nl-head">
        <h2 class="dov-section-title es-type-section" id="newsletter-title">Newsletter</h2>
        <p class="dov-card-meta">What people export from the Newsletter workspace: images, copied widget HTML and image links.</p>
      </header>
      ${toolbar(m)}
      ${notices(m)}
      ${body}`;
    bindChart();
    window.FrameUpDashboardPreviews?.hydrate?.();
    if (focusId) {
      const el = document.getElementById(focusId);
      el?.focus();
      if (caret && el && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(caret[0], caret[1]); } catch (error) { /* not a text field */ } }
    }
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bind() {
    root.addEventListener('click', event => {
      const range = event.target.closest('[data-nl-range]');
      if (range) { state.days = Number(range.dataset.nlRange); state.limit = PAGE; render(); root.querySelector(`[data-nl-range="${state.days}"]`)?.focus(); return; }
      if (event.target.closest('[data-nl-refresh]')) {
        Promise.allSettled([window.ESDashboardData?.refreshCloudDashboardData?.(), loadEvents({ force: true })]).finally(render);
        return;
      }
      if (event.target.closest('[data-nl-reset]')) {
        state.filters = { person: '', asset: '', brand: '', search: '' };
        state.limit = PAGE;
        render();
        root.querySelector('#nl-filter-person')?.focus();
        return;
      }
      if (event.target.closest('[data-nl-more]')) { state.limit += PAGE; render(); root.querySelector('[data-nl-more]')?.focus(); return; }
      const pick = event.target.closest('[data-nl-pick]');
      if (pick) {
        state.filters[pick.dataset.nlPick] = pick.dataset.nlValue;
        state.limit = PAGE;
        render();
        root.querySelector(`#nl-filter-${pick.dataset.nlPick}`)?.focus();
      }
    });
    root.addEventListener('change', event => {
      const sel = event.target.closest('[data-nl-filter]');
      if (!sel) return;
      state.filters[sel.dataset.nlFilter] = sel.value;
      state.limit = PAGE;
      render();
    });
    root.addEventListener('input', event => {
      if (event.target.id !== 'nl-search') return;
      const value = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.filters.search = value; state.limit = PAGE; render(); }, 180);
    });
  }

  function mount(section) {
    root = section;
    bind();
    const maybeLoad = () => {
      if (section.hidden) return;
      render();
      loadEvents();
    };
    new MutationObserver(maybeLoad).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('es-dashboard-data-change', () => render());
    maybeLoad();
  }

  function boot() {
    const section = document.getElementById('newsletter-view');
    if (section) mount(section);
  }

  window.FrameUpNewsletterView = Object.freeze({ mount, render, refresh: () => loadEvents({ force: true }) });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
