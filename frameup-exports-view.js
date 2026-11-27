// Dashboard → Exports (admins only): everything that left FrameUp, from every
// tool, the way Social Media exports have always shown: who, what, when,
// which format and size, where it went (downloaded, copied, link, published)
// and a thumbnail.
//
// Mounted by dashboard.html into <section id="exports-view"> at the top of the
// Exports tab (the editor review list stays below it). Loads its own data the
// first time the tab is shown (and on Refresh). The maths is
// FrameUpUsage.exportSummary (frameup-usage.js); rows come from
// frameup_usage_events (frameup-track.js exported()), plus older editor
// exports (es_designer_tasks) and export_done events from before the first
// usage event, so nothing is counted twice.
//
// Thumbnails: editor exports use their stored preview (the dashboard's own
// on-screen loader, data-preview-task); every other row loads its small
// thumb column only when it scrolls into view. Before the thumbs migration
// (20261129120000_frameup_usage_thumbs.sql) rows show a format icon.
(() => {
  'use strict';

  const U = window.FrameUpUsage;
  if (!U || !U.exportSummary) return;

  const DAY = 86400000;
  const LOAD_DAYS = 90;
  const RANGES = [7, 30, 90];
  const PAGE = 60;
  const USAGE_MIGRATION = '20261125120000_frameup_usage_events.sql';
  const THUMB_MIGRATION = '20261129120000_frameup_usage_thumbs.sql';
  const FORMAT_ICONS = {
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    zip: '<path d="M10 12v-1"/><path d="M10 18v-2"/><path d="M10 7V6"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01"/><circle cx="10" cy="20" r="2"/>',
    text: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    product: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  };
  const iconFor = row => {
    if (/^(mp4|webm)$/.test(row.format)) return FORMAT_ICONS.video;
    if (row.format === 'zip') return FORMAT_ICONS.zip;
    if (/^(srt|vtt|transcript)$/.test(row.format)) return FORMAT_ICONS.text;
    if (/html/.test(row.format)) return FORMAT_ICONS.code;
    if (row.format === 'product' || row.dest === 'publish') return FORMAT_ICONS.product;
    if (row.dest === 'link') return FORMAT_ICONS.link;
    return FORMAT_ICONS.image;
  };
  const svg = (paths, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const state = {
    range: 30,
    filters: { tool: '', person: '', dest: '' },
    shown: PAGE,
    data: null,
    loading: false,
    error: '',
    thumbs: new Map(),      // usage event id -> thumb ('' = none)
    thumbsMissing: false,   // the thumbs migration has not run
  };
  let root = null;
  let client = null;

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const fmt = value => Number(value || 0).toLocaleString('en-US');
  const dateLabel = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeLabel = ms => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const ago = ms => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
    return dateLabel(ms);
  };
  const isMissing = error => /does not exist|could not find|schema cache|PGRST20[0-9]|42P01|42703|42883/i.test(`${error?.code || ''} ${error?.message || ''}`);
  const sizeText = size => String(size || '').replace('x', ' × ');
  const safeThumb = value => (/^data:image\/(jpeg|webp|png);base64,/.test(value) || /^https:\/\//i.test(value) ? value : '');

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
    client = await getClient();
    const ready = { events: false, tasks: false, impact: false };
    const out = { events: [], tasks: [], impactEvents: [], names: {}, firstEventAt: null, ready };
    if (!client) return out;
    const since = new Date(Date.now() - LOAD_DAYS * DAY).toISOString();
    const safe = async (key, run) => {
      try { const rows = await run(); if (key) ready[key] = true; return rows; } catch (error) {
        if (!isMissing(error)) console.warn(`[exports] ${key || 'lookup'} failed:`, error?.message || error);
        return null;
      }
    };
    const [events, first, tasks, impactEvents, profiles] = await Promise.all([
      // Copies and links only count when exported() marked them (meta.out).
      safe('events', () => pageAll(() => client.from('frameup_usage_events')
        .select('id,created_at,user_email,category,tool,action,label,meta')
        .in('category', ['export', 'download', 'copy', 'share'])
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

  // ── Thumbnails (usage rows) ───────────────────────────────────────────────
  const thumbQueue = new Set();
  let thumbTimer = null;
  const thumbObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        thumbObserver.unobserve(entry.target);
        queueThumb(entry.target.dataset.xvThumb);
      }), { rootMargin: '300px 0px' })
    : null;

  function queueThumb(id) {
    if (!id || state.thumbsMissing || state.thumbs.has(id)) return;
    thumbQueue.add(id);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(loadThumbs, 60);
  }

  async function loadThumbs() {
    const ids = [...thumbQueue].slice(0, 40);
    ids.forEach(id => thumbQueue.delete(id));
    if (!ids.length || !client) return;
    ids.forEach(id => state.thumbs.set(id, ''));
    try {
      const { data, error } = await client.from('frameup_usage_events').select('id,thumb').in('id', ids);
      if (error) throw error;
      (data || []).forEach(row => { const thumb = safeThumb(String(row.thumb || '')); state.thumbs.set(String(row.id), thumb); if (thumb) paintThumb(String(row.id), thumb); });
    } catch (error) {
      if (isMissing(error)) state.thumbsMissing = true;
    }
    if (thumbQueue.size) thumbTimer = setTimeout(loadThumbs, 60);
  }

  function paintThumb(id, thumb) {
    root?.querySelectorAll(`[data-xv-thumb="${CSS.escape(id)}"]`).forEach(el => {
      if (el.querySelector('img')) return;
      el.innerHTML = `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async">`;
      el.classList.add('has-img');
    });
  }

  function hydrateThumbs() {
    thumbObserver?.disconnect();
    root.querySelectorAll('[data-xv-thumb]').forEach(el => {
      const id = el.dataset.xvThumb;
      const known = state.thumbs.get(id);
      if (known) { paintThumb(id, known); return; }
      if (known === '' || state.thumbsMissing) return;
      if (thumbObserver) thumbObserver.observe(el); else queueThumb(id);
    });
    // Editor exports: the dashboard's own preview loader.
    try { window.FrameUpDashboardPreviews?.hydrate?.(); } catch (error) { /* previews are optional */ }
  }

  // ── Model ─────────────────────────────────────────────────────────────────
  function model() {
    const data = state.data;
    if (!data) return null;
    const combined = U.combine(data);
    const range = U.rangeFor(state.range);
    const inRange = U.applyFilters(combined.rows, { from: range.from, to: range.to }).filter(U.isExport);
    const rows = U.applyFilters(inRange, { tool: state.filters.tool, person: state.filters.person })
      .filter(row => !state.filters.dest || U.destOf(row) === state.filters.dest);
    const summary = U.exportSummary(rows, { from: range.from, to: range.to, names: data.names, recent: state.shown });
    const options = U.filterOptions(inRange, data.names);
    const toolsWithData = new Set(inRange.map(row => row.tool));
    options.tools = options.tools.filter(t => toolsWithData.has(t.key) || ['social', 'youtube', 'newsletter', 'generate', 'video-ads', 'reels', 'reels-studio', 'merch'].includes(t.key));
    return { combined, range, rows, summary, options };
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function select(id, label, value, allLabel, items) {
    return `<label class="usage-filter" for="${id}"><span class="usage-filter__label">${esc(label)}</span>
      <select class="es-select usage-select" id="${id}" data-xv-filter="${id.replace('xv-filter-', '')}">
        <option value="">${esc(allLabel)}</option>
        ${items.map(item => `<option value="${esc(item.key)}"${item.key === value ? ' selected' : ''}>${esc(item.label)}</option>`).join('')}
      </select></label>`;
  }

  function toolbar(m) {
    const f = state.filters;
    const active = f.tool || f.person || f.dest;
    const opts = m?.options || { tools: [], people: [] };
    const dests = Object.entries(U.DEST_LABELS).map(([key, label]) => ({ key, label }));
    return `
      <div class="usage-toolbar" role="group" aria-label="Export filters">
        <div class="dov-segment" role="group" aria-label="Time range">
          ${RANGES.map(days => `<button type="button" data-xv-range="${days}" aria-pressed="${state.range === days}">${days}d</button>`).join('')}
        </div>
        ${select('xv-filter-tool', 'Tool', f.tool, 'All tools', opts.tools)}
        ${select('xv-filter-person', 'Person', f.person, 'Everyone', opts.people)}
        ${select('xv-filter-dest', 'Where it went', f.dest, 'Anywhere', dests)}
        <span class="usage-toolbar__end">
          ${active ? '<button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-xv-reset>Clear filters</button>' : ''}
          <button class="es-btn es-btn--sm es-btn--secondary" type="button" data-xv-refresh${state.loading ? ' aria-busy="true" disabled' : ''}>Refresh</button>
        </span>
      </div>`;
  }

  function notices(m) {
    const data = state.data;
    if (!data) return '';
    if (!data.ready.events) {
      return `<p class="usage-notice" role="status"><strong>Exports from every tool are waiting for a database update.</strong> Until <code>${esc(USAGE_MIGRATION)}</code> runs, this shows editor exports and older video exports only. The rest are kept on each person’s device and sent once it runs.</p>`;
    }
    const out = [];
    if (m?.combined.trackingSince && m.combined.trackingSince > m.range.from) {
      out.push(`Every tool is counted from ${esc(dateLabel(m.combined.trackingSince))}. Before that, only editor and video exports were tracked.`);
    }
    if (state.thumbsMissing) out.push(`Thumbnails for non-editor exports appear once <code>${esc(THUMB_MIGRATION)}</code> runs.`);
    return out.length ? `<p class="usage-notice" role="status">${out.join(' ')}</p>` : '';
  }

  function kpis(m) {
    const s = m?.summary;
    const d = s?.dests || {};
    const tiles = [
      ['Exports', s?.total, s ? `${fmt(s.files)} file${s.files === 1 ? '' : 's'} · ${fmt(s.people)} ${s.people === 1 ? 'person' : 'people'}` : ''],
      ['Downloaded', d.download, 'Images, videos, ZIPs, caption files'],
      ['Copied and links', (d.clipboard || 0) + (d.link || 0), 'Finished HTML and image links'],
      ['Published', d.publish, 'Products created on Fourthwall'],
    ];
    return `<section class="dov-kpis" aria-label="Export totals">${tiles.map(([label, value, meta]) => `
      <article class="dov-kpi${m ? '' : ' is-loading'}">
        <h3 class="dov-kpi-label es-type-eyebrow">${esc(label)}</h3>
        <p class="dov-kpi-value">${m ? fmt(value || 0) : '—'}</p>
        <p class="dov-kpi-meta">${esc(meta)}</p>
      </article>`).join('')}</section>`;
  }

  function toolTable(m) {
    const tools = m.summary.byTool;
    if (!tools.length) return emptyState();
    const max = Math.max(1, ...tools.map(t => t.count));
    return `<div class="usage-table-wrap"><table class="usage-table xv-tools">
      <caption class="sr-only">Exports by tool</caption>
      <thead><tr><th scope="col">Tool</th><th scope="col">Formats</th><th scope="col" class="is-num">Exports</th><th scope="col" class="is-num">Files</th><th scope="col" class="is-num">People</th><th scope="col">Last export</th></tr></thead>
      <tbody>${tools.map(tool => `
        <tr>
          <th scope="row"><button class="usage-link" type="button" data-xv-tool="${esc(tool.key)}" aria-label="Show only ${esc(tool.label)}">${esc(tool.label)}</button>
            <span class="xv-bar" aria-hidden="true"><span style="width:${Math.max(3, (tool.count / max) * 100).toFixed(1)}%"></span></span></th>
          <td><span class="xv-chips">${tool.formatList.slice(0, 4).map(f => `<span class="xv-chip">${esc(f.label)} <b>${fmt(f.count)}</b></span>`).join('')}</span></td>
          <td class="is-num"><strong>${fmt(tool.count)}</strong></td>
          <td class="is-num">${fmt(tool.files)}</td>
          <td class="is-num">${fmt(tool.people)}</td>
          <td><time datetime="${new Date(tool.lastAt).toISOString()}">${esc(ago(tool.lastAt))}</time></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
  }

  function thumbCell(row) {
    const title = row.label || row.template || row.formatLabel;
    if (row.taskId) {
      return `<button class="dov-thumb xv-thumb" type="button" data-preview-task="${esc(row.taskId)}" aria-label="Preview ${esc(title)}"><span class="es-skeleton"></span></button>`;
    }
    const known = state.thumbs.get(row.id);
    const legacy = row.legacy;
    return `<span class="dov-thumb xv-thumb is-static${known ? ' has-img' : ''}"${legacy ? '' : ` data-xv-thumb="${esc(row.id)}"`}>${known ? `<img src="${esc(known)}" alt="" loading="lazy" decoding="async">` : `<span class="xv-thumb__icon">${svg(iconFor(row))}</span>`}</span>`;
  }

  function list(m) {
    const rows = m.summary.recent;
    if (!rows.length) return emptyState();
    const more = m.summary.total > rows.length;
    return `<ul class="xv-list" aria-label="Recent exports">${rows.map(row => {
      const sub = [row.template && row.template !== row.label ? row.template : '', row.meta?.file || ''].filter(Boolean).join(' · ');
      const spec = [row.formatLabel, sizeText(row.size), row.meta?.count > 1 ? `${fmt(row.meta.count)} files` : '', row.meta?.sec ? `${row.meta.sec}s` : '', row.meta?.kb ? (row.meta.kb >= 1024 ? `${(row.meta.kb / 1024).toFixed(1)} MB` : `${fmt(row.meta.kb)} KB`) : ''].filter(Boolean).join(' · ');
      return `
      <li class="xv-row">
        ${thumbCell(row)}
        <span class="xv-main"><span class="dov-cell-title" title="${esc(row.label || '')}">${esc(row.label || row.template || 'Untitled export')}</span><span class="dov-cell-meta">${esc(sub || row.toolLabel)}</span></span>
        <span class="xv-tool"><span class="dov-cell-strong">${esc(row.toolLabel)}</span><span class="dov-cell-meta">${esc(spec)}</span></span>
        <span class="xv-dest" data-dest="${esc(row.dest)}">${esc(row.destLabel)}</span>
        <span class="xv-who"><button class="usage-link xv-person" type="button" data-xv-person="${esc(row.email)}" aria-label="Show only ${esc(row.name)}">${esc(row.name)}</button></span>
        <time class="dov-cell-meta xv-when" datetime="${new Date(row.at).toISOString()}" title="${esc(timeLabel(row.at))}">${esc(ago(row.at))}</time>
      </li>`;
    }).join('')}</ul>
    ${more ? `<div class="xv-more"><button class="es-btn es-btn--sm es-btn--secondary" type="button" data-xv-more>Show more (${fmt(m.summary.total - rows.length)} older)</button></div>` : ''}`;
  }

  function emptyState() {
    const filtered = state.filters.tool || state.filters.person || state.filters.dest;
    return `<div class="es-empty usage-empty"><p class="es-empty__title">No exports${filtered ? ' with these filters' : ' in this range'}</p><p class="es-empty__copy">${filtered ? 'Clear the filters or pick a longer range.' : 'Every download, finished copy, link and publish from every tool shows up here.'}</p></div>`;
  }

  function skeleton(rows = 4) {
    return `<div class="dov-skel is-row" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => '<div class="dov-skel-row"><span class="es-skeleton dov-skel-dot"></span><span class="dov-skel-lines"><span class="es-skeleton"></span><span class="es-skeleton"></span></span></div>').join('')}</div>`;
  }

  function card(title, meta, body, { flush = false } = {}) {
    return `<article class="dov-card">
      <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">${esc(title)}</h3><p class="dov-card-meta">${esc(meta)}</p></div></header>
      <div class="dov-card-body${flush ? ' is-flush' : ''}">${body}</div>
    </article>`;
  }

  function render() {
    if (!root) return;
    const focusId = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id || '' : '';
    const m = state.loading && !state.data ? null : model();
    const loading = !m;
    let body;
    if (state.error && !state.data) {
      body = `<div class="es-error-state" role="alert"><p class="es-error-state__title">Couldn’t load exports</p><p class="es-error-state__copy">${esc(state.error)}</p><button class="es-btn es-btn--sm" type="button" data-xv-refresh>Try again</button></div>`;
    } else {
      body = `
        ${kpis(m)}
        <section class="dov-section" aria-labelledby="xv-tools-title">
          <h2 class="dov-section-title es-type-section" id="xv-tools-title">By tool</h2>
          ${card('Exports per tool', 'Pick a tool to see only its exports', loading ? skeleton(5) : toolTable(m), { flush: true })}
        </section>
        <section class="dov-section" aria-labelledby="xv-recent-title">
          <h2 class="dov-section-title es-type-section" id="xv-recent-title">Recent exports</h2>
          ${card('Every tool, newest first', loading ? 'Loading…' : `${fmt(m.summary.total)} in the last ${state.range} days`, loading ? skeleton(6) : list(m), { flush: true })}
        </section>`;
    }
    root.innerHTML = `
      <header class="usage-head">
        <div class="usage-head__copy">
          <h2 class="dov-section-title es-type-section" id="exports-title">Exports</h2>
          <p class="dov-card-meta">Everything that left FrameUp, from every tool: files downloaded, finished HTML and links copied, and products published.</p>
        </div>
      </header>
      ${toolbar(m)}
      ${notices(m)}
      ${body}`;
    if (focusId) document.getElementById(focusId)?.focus();
    if (m) hydrateThumbs();
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bind() {
    root.addEventListener('click', event => {
      const range = event.target.closest('[data-xv-range]');
      if (range) { state.range = Number(range.dataset.xvRange); state.shown = PAGE; render(); root.querySelector(`[data-xv-range="${state.range}"]`)?.focus(); return; }
      if (event.target.closest('[data-xv-refresh]')) { refresh(); return; }
      if (event.target.closest('[data-xv-reset]')) { state.filters = { tool: '', person: '', dest: '' }; state.shown = PAGE; render(); root.querySelector('#xv-filter-tool')?.focus(); return; }
      if (event.target.closest('[data-xv-more]')) { state.shown += PAGE; render(); return; }
      const tool = event.target.closest('[data-xv-tool]');
      if (tool) { state.filters.tool = tool.dataset.xvTool; state.shown = PAGE; render(); root.querySelector('#xv-filter-tool')?.focus(); return; }
      const person = event.target.closest('[data-xv-person]');
      if (person) { state.filters.person = person.dataset.xvPerson; state.shown = PAGE; render(); root.querySelector('#xv-filter-person')?.focus(); }
    });
    root.addEventListener('change', event => {
      const sel = event.target.closest('[data-xv-filter]');
      if (!sel) return;
      state.filters[sel.dataset.xvFilter] = sel.value;
      state.shown = PAGE;
      render();
    });
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
    const section = document.getElementById('exports-view');
    if (section) mount(section);
  }

  window.FrameUpExportsView = Object.freeze({ mount, refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
