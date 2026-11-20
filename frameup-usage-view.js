// Dashboard → Usage (admins only): everything people took from FrameUp,
// grouped by type (export, download, copy, link, opened in a tool, generated)
// and by tool, with filters (range, tool, type, person), a daily chart, top
// people and a recent feed.
//
// Mounted by dashboard.html into <section id="usage-view">. Loads its own data
// the first time the section is shown (and on Refresh). The maths lives in
// frameup-usage.js. Every source is optional: before the usage-events
// migration runs, the view shows exports from the older tables and says so.
(() => {
  'use strict';

  const U = window.FrameUpUsage;
  if (!U) return;

  const DAY = 86400000;
  const LOAD_DAYS = 90;
  const RANGES = [7, 30, 90];
  const MIGRATION = 'supabase/migrations/20261125120000_frameup_usage_events.sql';
  const ICONS = {
    export: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    download: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    share: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    generate: '<path d="M9.94 14.06 4 20"/><path d="m14 4 6 6"/><path d="M17 2v4"/><path d="M19 4h-4"/><path d="M5 2v2"/><path d="M6 3H4"/><path d="m11 7 6 6-4 4-6-6z"/>',
  };
  const VERBS = { export: 'exported', download: 'downloaded', copy: 'copied', share: 'shared a link', open: 'opened in a tool', generate: 'generated' };
  const icon = (paths, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const state = {
    range: 30,
    filters: { tool: '', category: '', person: '' },
    data: null,
    loading: false,
    error: '',
  };
  let root = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('en-US');
  const dateLabel = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const ago = ms => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
    return dateLabel(ms);
  };
  const isMissing = error => /does not exist|could not find|schema cache|PGRST20[25]|42P01|42883/i.test(`${error?.code || ''} ${error?.message || ''}`);

  async function getClient() {
    const auth = window.ESAuth;
    if (!auth) return null;
    if (auth.ensureSupabaseReady && !(await auth.ensureSupabaseReady())) return null;
    return auth.getSupabaseClient?.() || null;
  }

  async function pageAll(build, max = 20000) {
    const rows = [];
    for (let from = 0; from < max; from += 1000) {
      const { data, error } = await build().range(from, from + 999);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  async function loadData() {
    const client = await getClient();
    const ready = { events: false, tasks: false, impact: false };
    const out = { events: [], tasks: [], impactEvents: [], names: {}, firstEventAt: null, ready };
    if (!client) return out;
    const since = new Date(Date.now() - LOAD_DAYS * DAY).toISOString();
    const safe = async (key, run) => {
      try { const rows = await run(); if (key) ready[key] = true; return rows; } catch (error) {
        if (!isMissing(error)) console.warn(`[usage] ${key || 'names'} failed:`, error?.message || error);
        return null;
      }
    };
    const [events, first, tasks, impactEvents, profiles] = await Promise.all([
      safe('events', () => pageAll(() => client.from('frameup_usage_events')
        .select('id,created_at,user_email,category,tool,action,label,meta')
        .gte('created_at', since)
        .order('created_at', { ascending: false }))),
      safe('', async () => {
        const { data, error } = await client.from('frameup_usage_events').select('created_at').order('created_at', { ascending: true }).limit(1);
        if (error) throw error;
        return data?.[0]?.created_at || null;
      }),
      safe('tasks', () => pageAll(() => client.from('es_designer_tasks')
        .select('id,title,creator_email,creator_name,workspace,workspace_variant,created_at,meta_exported_at:metadata->>exportedAt,meta_gen:metadata->generated->>source')
        .eq('task_type', 'exported_design')
        .gte('created_at', since)
        .order('created_at', { ascending: false }))),
      safe('impact', () => pageAll(() => client.from('frameup_events')
        .select('id,created_at,user_email,event,source,meta')
        .eq('event', 'export_done')
        .gte('created_at', since)
        .order('created_at', { ascending: false }))),
      safe('', async () => {
        const { data, error } = await client.from('es_designer_profiles').select('email,name');
        if (error) throw error;
        return data || [];
      }),
    ]);
    (profiles || []).forEach(p => { if (p?.email && p.name) out.names[String(p.email).toLowerCase()] = p.name; });
    Object.assign(out, { events: events || [], firstEventAt: first || null, tasks: tasks || [], impactEvents: impactEvents || [] });
    return out;
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    render();
    try {
      state.data = await loadData();
    } catch (error) {
      state.error = error?.message || 'Something went wrong.';
    } finally {
      state.loading = false;
      render();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function model() {
    const data = state.data;
    if (!data) return null;
    const combined = U.combine(data);
    const range = U.rangeFor(state.range);
    const rows = U.applyFilters(combined.rows, { ...state.filters, from: range.from, to: range.to });
    const summary = U.summarize(rows, { from: range.from, to: range.to, names: data.names });
    const options = U.filterOptions(U.applyFilters(combined.rows, { from: range.from, to: range.to }), data.names);
    return { combined, range, rows, summary, options };
  }

  function select(id, label, value, allLabel, items) {
    return `<label class="usage-filter" for="${id}"><span class="usage-filter__label">${esc(label)}</span>
      <select class="es-select usage-select" id="${id}" data-usage-filter="${id.replace('usage-filter-', '')}">
        <option value="">${esc(allLabel)}</option>
        ${items.map(item => `<option value="${esc(item.key)}"${item.key === value ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}
      </select></label>`;
  }

  function toolbar(m) {
    const f = state.filters;
    const active = f.tool || f.category || f.person;
    const opts = m?.options || { tools: [], categories: [], people: [] };
    return `
      <div class="usage-toolbar" role="group" aria-label="Usage filters">
        <div class="dov-segment" role="group" aria-label="Time range">
          ${RANGES.map(days => `<button type="button" data-usage-range="${days}" aria-pressed="${state.range === days}">${days}d</button>`).join('')}
        </div>
        ${select('usage-filter-tool', 'Tool', f.tool, 'All tools', opts.tools)}
        ${select('usage-filter-category', 'Type', f.category, 'All types', opts.categories)}
        ${select('usage-filter-person', 'Person', f.person, 'Everyone', opts.people)}
        <span class="usage-toolbar__end">
          ${active ? '<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-usage-reset>Clear filters</button>' : ''}
          <button class="es-btn es-btn--sm es-btn--secondary" type="button" data-usage-refresh${state.loading ? ' aria-busy="true" disabled' : ''}>Refresh</button>
        </span>
      </div>`;
  }

  function notices(m) {
    const data = state.data;
    if (!data) return '';
    const out = [];
    if (!data.ready.events) {
      out.push(`<p class="usage-notice" role="status"><strong>Detailed tracking is waiting for a database update.</strong> Until <code>${esc(MIGRATION.split('/').pop())}</code> runs, this page shows exports only. Downloads, copies and links are kept on each person’s device and sent once it runs.</p>`);
    } else if (m?.combined.trackingSince && m.combined.trackingSince > m.range.from) {
      out.push(`<p class="usage-notice" role="status">Downloads, copies, links and hand-offs are counted from ${esc(dateLabel(m.combined.trackingSince))}. Before that, only exports were tracked.</p>`);
    }
    return out.join('');
  }

  function kpis(m) {
    const by = key => m ? (m.summary.byCategory.find(c => c.key === key)?.count || 0) : 0;
    const tiles = [
      ['Taken in total', m ? m.summary.total : 0, m ? `${fmt(m.summary.people)} ${m.summary.people === 1 ? 'person' : 'people'}` : ''],
      ['Exports', by('export'), 'Images, videos and ZIPs'],
      ['Downloads', by('download'), 'Photos, caption files, files again'],
      ['Copies and links', by('copy') + by('share'), 'Text, HTML and shared links'],
    ];
    return `<section class="dov-kpis" aria-label="Totals">${tiles.map(([label, value, meta]) => `
      <article class="dov-kpi${m ? '' : ' is-loading'}">
        <h3 class="dov-kpi-label es-type-eyebrow">${esc(label)}</h3>
        <p class="dov-kpi-value">${m ? fmt(value) : '—'}</p>
        <p class="dov-kpi-meta">${esc(meta)}</p>
      </article>`).join('')}</section>`;
  }

  function legend() {
    return `<ul class="usage-legend" aria-label="Types">${U.CATEGORY_ORDER.map(key => `<li><span class="usage-swatch" data-cat="${key}" aria-hidden="true"></span>${esc(U.categoryLabel(key))}</li>`).join('')}</ul>`;
  }

  function chart(m) {
    const series = m.summary.series;
    const max = Math.max(1, ...series.map(day => day.total));
    const step = series.length > 45 ? 14 : series.length > 10 ? 7 : 1;
    const label = `${fmt(m.summary.total)} things taken over ${series.length} days; busiest day ${fmt(max)}.`;
    return `
      <div class="usage-chart" role="img" aria-label="${esc(label)}">
        <span class="usage-chart__max" aria-hidden="true">${fmt(max)}</span>
        <div class="usage-chart__plot" style="--usage-days:${series.length}">
          ${series.map((day, i) => `<div class="usage-col" data-day="${i}">${U.CATEGORY_ORDER.filter(key => day.categories[key]).map(key => `<span class="usage-seg" data-cat="${key}" style="height:${((day.categories[key] / max) * 100).toFixed(2)}%"></span>`).join('')}</div>`).join('')}
        </div>
        <div class="usage-chart__axis" aria-hidden="true">${series.map((day, i) => (i % step === 0 || i === series.length - 1) && !(i !== series.length - 1 && series.length - 1 - i < step / 2) ? `<span style="left:${(((i + 0.5) / series.length) * 100).toFixed(2)}%">${esc(dateLabel(day.at))}</span>` : '').join('')}</div>
        <div class="usage-tip" hidden></div>
      </div>
      ${legend()}`;
  }

  function categoryBars(m) {
    const max = Math.max(1, ...m.summary.byCategory.map(c => c.count));
    return `<ul class="dov-bars usage-type-bars">${m.summary.byCategory.map(c => `
      <li class="dov-bar-row${c.count ? '' : ' is-zero'}">
        <span class="dov-bar-label"><span class="dov-cell-strong usage-cat-name"><span class="usage-swatch" data-cat="${c.key}" aria-hidden="true"></span>${esc(c.label)}</span></span>
        <span class="dov-bar-track" aria-hidden="true"><span data-cat="${c.key}" style="width:${c.count ? Math.max(2, (c.count / max) * 100).toFixed(1) : 0}%"></span></span>
        <span class="dov-bar-value">${fmt(c.count)}</span>
      </li>`).join('')}</ul>`;
  }

  function toolTable(m) {
    if (!m.summary.byTool.length) return emptyState();
    const cats = U.CATEGORY_ORDER;
    return `<div class="usage-table-wrap"><table class="usage-table">
      <caption class="sr-only">Things taken by tool and type</caption>
      <thead><tr><th scope="col">Tool</th>${cats.map(key => `<th scope="col" class="is-num">${esc(U.categoryLabel(key))}</th>`).join('')}<th scope="col" class="is-num">Total</th></tr></thead>
      <tbody>${m.summary.byTool.map(tool => `
        <tr>
          <th scope="row"><button class="usage-link" type="button" data-usage-tool="${esc(tool.key)}" aria-label="Show only ${esc(tool.label)}">${esc(tool.label)}</button></th>
          ${cats.map(key => `<td class="is-num${tool.categories[key] ? '' : ' is-zero'}">${tool.categories[key] ? fmt(tool.categories[key]) : '–'}</td>`).join('')}
          <td class="is-num"><strong>${fmt(tool.count)}</strong></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function people(m) {
    const list = m.summary.topPeople.slice(0, 8);
    if (!list.length) return emptyState();
    return `<ul class="dov-list">${list.map(p => `
      <li class="dov-list-item">
        <span class="dov-avatar" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="dov-list-copy"><button class="usage-link dov-cell-strong" type="button" data-usage-person="${esc(p.email)}" aria-label="Show only ${esc(p.name)}">${esc(p.name)}</button><span class="dov-cell-meta">Mostly ${esc(p.topToolLabel)} · last ${esc(ago(p.lastAt))}</span></span>
        <span class="dov-bar-value">${fmt(p.count)}</span>
      </li>`).join('')}</ul>`;
  }

  function feed(m) {
    if (!m.summary.recent.length) return emptyState();
    return `<ul class="dov-feed usage-feed">${m.summary.recent.map(row => `
      <li class="dov-feed-item">
        <span class="dov-feed-icon usage-feed-icon" data-cat="${row.category}" aria-hidden="true">${icon(ICONS[row.category] || ICONS.export)}</span>
        <span class="dov-feed-copy">
          <span class="dov-cell-strong">${esc(row.name)} ${esc(VERBS[row.category] || 'took')}</span>
          <span class="dov-cell-meta">${[row.actionLabel, row.toolLabel, row.label].filter(Boolean).map(esc).join(' · ')}</span>
        </span>
        <time class="dov-cell-meta usage-feed-time" datetime="${new Date(row.at).toISOString()}">${esc(ago(row.at))}</time>
      </li>`).join('')}</ul>`;
  }

  function emptyState() {
    const filtered = state.filters.tool || state.filters.category || state.filters.person;
    return `<div class="es-empty usage-empty"><p class="es-empty__title">Nothing taken${filtered ? ' with these filters' : ' in this range'}</p><p class="es-empty__copy">${filtered ? 'Clear the filters or pick a longer range.' : 'Exports, downloads, copies and links show up here as people use FrameUp.'}</p></div>`;
  }

  function skeleton(rows = 4, kind = 'row') {
    return `<div class="dov-skel is-${kind}" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => '<div class="dov-skel-row"><span class="es-skeleton dov-skel-dot"></span><span class="dov-skel-lines"><span class="es-skeleton"></span><span class="es-skeleton"></span></span></div>').join('')}</div>`;
  }

  function card(title, meta, body, { flush = false, id = '' } = {}) {
    return `<article class="dov-card"${id ? ` id="${id}"` : ''}>
      <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">${esc(title)}</h3><p class="dov-card-meta">${esc(meta)}</p></div></header>
      <div class="dov-card-body${flush ? ' is-flush' : ''}">${body}</div>
    </article>`;
  }

  function render() {
    if (!root) return;
    const focusId = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id || '' : '';
    const m = state.loading && !state.data ? null : model();
    state.model = m;
    const rangeText = `the last ${state.range} days`;
    const loading = !m;
    let body;
    if (state.error && !state.data) {
      body = `<div class="es-error-state" role="alert"><p class="es-error-state__title">Couldn’t load usage</p><p class="es-error-state__copy">${esc(state.error)}</p><button class="es-btn es-btn--sm" type="button" data-usage-refresh>Try again</button></div>`;
    } else {
      body = `
        ${kpis(m)}
        <section class="dov-section" aria-labelledby="usage-time-title">
          <h2 class="dov-section-title es-type-section" id="usage-time-title">Over time</h2>
          <div class="dov-grid is-2-1">
            ${card('Taken per day', loading ? 'Loading…' : `${fmt(m.summary.total)} in ${rangeText}, by type`, loading ? skeleton(1, 'chart') : m.summary.total ? chart(m) : emptyState(), { id: 'usage-chart-card' })}
            ${card('By type', 'Same range and filters', loading ? skeleton(6) : categoryBars(m))}
          </div>
        </section>
        <section class="dov-section" aria-labelledby="usage-tools-title">
          <h2 class="dov-section-title es-type-section" id="usage-tools-title">By tool</h2>
          ${card('What each tool gave out', 'Pick a tool to see only that tool', loading ? skeleton(5) : toolTable(m), { flush: true })}
        </section>
        <section class="dov-section" aria-labelledby="usage-people-title">
          <h2 class="dov-section-title es-type-section" id="usage-people-title">People and recent activity</h2>
          <div class="dov-grid is-1-2">
            ${card('Top people', loading ? 'Loading…' : `${fmt(m.summary.people)} ${m.summary.people === 1 ? 'person' : 'people'} took something`, loading ? skeleton(5) : people(m), { flush: true })}
            ${card('Recent', 'Newest first', loading ? skeleton(6) : feed(m), { flush: true })}
          </div>
        </section>`;
    }
    root.innerHTML = `
      <header class="usage-head">
        <div class="usage-head__copy">
          <h2 class="dov-section-title es-type-section" id="usage-title">Usage</h2>
          <p class="dov-card-meta">Everything people take from FrameUp: exports, downloads, copies, links and hand-offs between tools.</p>
        </div>
      </header>
      ${toolbar(m)}
      ${notices(m)}
      ${body}`;
    if (focusId) document.getElementById(focusId)?.focus();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function showTip(col) {
    const m = state.model;
    const wrap = col.closest('.usage-chart');
    const tip = wrap?.querySelector('.usage-tip');
    const day = m?.summary.series[Number(col.dataset.day)];
    if (!tip || !day) return;
    const lines = U.CATEGORY_ORDER.filter(key => day.categories[key]).map(key => `<li><span class="usage-swatch" data-cat="${key}" aria-hidden="true"></span>${esc(U.categoryLabel(key))}<strong>${fmt(day.categories[key])}</strong></li>`).join('');
    tip.innerHTML = `<p class="usage-tip__title">${esc(new Date(day.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }))} · ${fmt(day.total)}</p>${lines ? `<ul>${lines}</ul>` : '<p class="dov-cell-meta">Nothing taken</p>'}`;
    tip.hidden = false;
    const wrapBox = wrap.getBoundingClientRect();
    const colBox = col.getBoundingClientRect();
    const x = colBox.left - wrapBox.left + colBox.width / 2;
    tip.style.left = `${Math.min(Math.max(x, tip.offsetWidth / 2), wrapBox.width - tip.offsetWidth / 2)}px`;
    wrap.querySelectorAll('.usage-col.is-hover').forEach(el => el.classList.remove('is-hover'));
    col.classList.add('is-hover');
  }

  function bind() {
    root.addEventListener('click', event => {
      const range = event.target.closest('[data-usage-range]');
      if (range) { state.range = Number(range.dataset.usageRange); render(); root.querySelector(`[data-usage-range="${state.range}"]`)?.focus(); return; }
      if (event.target.closest('[data-usage-refresh]')) { refresh(); return; }
      if (event.target.closest('[data-usage-reset]')) { state.filters = { tool: '', category: '', person: '' }; render(); root.querySelector('#usage-filter-tool')?.focus(); return; }
      const tool = event.target.closest('[data-usage-tool]');
      if (tool) { state.filters.tool = tool.dataset.usageTool; render(); root.querySelector('#usage-filter-tool')?.focus(); return; }
      const person = event.target.closest('[data-usage-person]');
      if (person) { state.filters.person = person.dataset.usagePerson; render(); root.querySelector('#usage-filter-person')?.focus(); }
    });
    root.addEventListener('change', event => {
      const sel = event.target.closest('[data-usage-filter]');
      if (!sel) return;
      state.filters[sel.dataset.usageFilter] = sel.value;
      render();
    });
    const hideTip = () => {
      root.querySelectorAll('.usage-tip').forEach(tip => { tip.hidden = true; });
      root.querySelectorAll('.usage-col.is-hover').forEach(el => el.classList.remove('is-hover'));
    };
    root.addEventListener('pointerover', event => {
      const col = event.target.closest('.usage-col');
      if (col) showTip(col); else if (!event.target.closest('.usage-tip')) hideTip();
    });
    root.addEventListener('pointerleave', hideTip);
  }

  function mount(section) {
    root = section;
    bind();
    const maybeLoad = () => {
      if (section.hidden) return;
      if (!state.data && !state.loading) refresh(); else render();
    };
    new MutationObserver(maybeLoad).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    maybeLoad();
  }

  function boot() {
    const section = document.getElementById('usage-view');
    if (section) mount(section);
  }

  window.FrameUpUsageView = Object.freeze({ mount, refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
