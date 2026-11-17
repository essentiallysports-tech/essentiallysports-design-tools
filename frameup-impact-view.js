// Dashboard → Impact (admins only). Weekly exports (the north-star proxy),
// active users, exports per creator, time to export, template leaderboard
// with posted rate and imported results, Generate run → export, AI cost per
// export, request on-time rate, and the Meta Ads / Beehiiv CSV import.
//
// Mounted by dashboard.html into <section id="impact-view">. It loads its own
// data the first time the section is shown (and on Refresh), reading:
//   es_designer_tasks (exports + requests), frameup_events, frameup_ai_usage,
//   frameup_post_links, frameup_post_results.
// Every source is optional: a missing table (migration not applied yet) just
// leaves its numbers as "—" with a note. All maths lives in frameup-impact.js.
(() => {
  'use strict';

  const I = window.FrameUpImpact;
  if (!I) return;

  const DAY = 86400000;
  const RANGES = [7, 30, 90];
  const MIGRATION = 'supabase/migrations/20261118124600_frameup_post_links.sql';
  const SOURCE_LABELS = { editor: 'Editor', generate: 'Generate', 'video-ads': 'Video Ads', reels: 'Reels' };
  const MATCH_LABELS = { ad_id: 'Ad id', ad_name: 'Ad name', ad_name_parts: 'Ad name parts', url: 'Link', manual: 'Manual', none: 'No match' };

  const state = { range: 30, data: null, loading: false, loadedAt: 0, error: '', importer: null };
  let root = null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const num = value => (value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 }));
  const pct = value => (value == null || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`);
  const usd = value => (value == null || !Number.isFinite(value) ? '—' : value < 0.1 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`);
  const mins = ms => {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const m = ms / 60000;
    if (m < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
    if (m < 60) return `${m < 10 ? m.toFixed(1) : Math.round(m)} min`;
    return `${(m / 60).toFixed(1)} h`;
  };
  const weekLabel = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const isMissing = error => /does not exist|could not find|schema cache|PGRST20[25]|42P01|42883/i.test(`${error?.code || ''} ${error?.message || ''}`);

  async function getClient() {
    const auth = window.ESAuth;
    if (!auth) return null;
    if (auth.ensureSupabaseReady && !(await auth.ensureSupabaseReady())) return null;
    return auth.getSupabaseClient?.() || null;
  }

  async function pageAll(build, max = 5000) {
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
    const since = new Date(Date.now() - 120 * DAY).toISOString();
    const ready = { tasks: false, events: false, usage: false, links: false, results: false };
    const out = { tasks: [], requests: [], events: [], usage: [], links: [], results: [], ready };
    if (!client) return out;

    const safe = async (key, run) => {
      try { const rows = await run(); ready[key] = true; return rows; } catch (error) {
        if (!isMissing(error)) console.warn(`[impact] ${key} failed:`, error?.message || error);
        return [];
      }
    };

    const [tasks, requests, events, usage, links, results] = await Promise.all([
      safe('tasks', () => pageAll(() => client.from('es_designer_tasks')
        .select('id,creator_email,creator_name,workspace,workspace_variant,team_or_league,created_at,meta_exported_at:metadata->>exportedAt,meta_duration_ms:metadata->>durationMs,meta_gen:metadata->generated->>postType')
        .eq('task_type', 'exported_design')
        .gte('created_at', since)
        .order('created_at', { ascending: false }))),
      safe('tasks', () => pageAll(() => client.from('es_designer_tasks')
        .select('id,status,design_due_at,completed_at,created_at')
        .eq('task_type', 'design_request')
        .not('design_due_at', 'is', null)
        .gte('design_due_at', since)
        .order('design_due_at', { ascending: false }))),
      safe('events', () => pageAll(() => client.from('frameup_events')
        .select('created_at,user_email,event,source,session_id,task_id,meta')
        .gte('created_at', since)
        .order('created_at', { ascending: false }))),
      safe('usage', async () => {
        const result = await window.ESDashboardData?.fetchAiUsage?.({ sinceIso: since });
        if (!result?.ready) throw new Error('frameup_ai_usage does not exist');
        return result.rows;
      }),
      safe('links', () => pageAll(() => client.from('frameup_post_links')
        .select('id,created_at,user_email,task_id,source,platform,url,external_id,brand,style,angle,size,ad_name,posted_at,design_ref')
        .order('created_at', { ascending: false }))),
      safe('results', () => pageAll(() => client.from('frameup_post_results')
        .select('id,imported_at,source,row_key,task_id,post_link_id,match_method,title,url,ad_name,metrics,period_start,period_end')
        .order('imported_at', { ascending: false }))),
    ]);
    Object.assign(out, { tasks, requests, events, usage, links, results });
    return out;
  }

  // Exports from every tool, in one shape.
  function exportsOf(data) {
    const fromTasks = data.tasks.map(task => ({
      at: task.meta_exported_at || task.created_at,
      email: task.creator_email,
      name: task.creator_name,
      source: 'editor',
      workspace: task.workspace,
      template: task.workspace_variant,
      taskId: task.id,
      durationMs: Number(task.meta_duration_ms),
      aiMade: task.meta_gen ? 'generate' : '',
    }));
    const fromEvents = data.events
      .filter(event => event.event === 'export_done' && event.source && event.source !== 'editor')
      .map(event => ({
        at: event.created_at,
        email: event.user_email,
        name: '',
        source: event.source,
        workspace: SOURCE_LABELS[event.source] || event.source,
        template: event.meta?.template || event.meta?.style || '',
        taskId: event.task_id,
        aiMade: event.source === 'generate' ? 'generate' : event.source === 'video-ads' ? 'video-ads' : '',
        adNames: Array.isArray(event.meta?.ad_names) ? event.meta.ad_names : [],
        brand: event.meta?.brand, style: event.meta?.style, angle: event.meta?.angle,
      }));
    return [...fromTasks, ...fromEvents];
  }

  function compute(data, rangeDays) {
    const now = Date.now();
    const since = now - rangeDays * DAY;
    const prevSince = since - rangeDays * DAY;
    const exports = exportsOf(data);
    const thisWeek = Date.parse(I.weekStart(now));
    const lastWeek = thisWeek - 7 * DAY;
    const people = [
      ...exports.map(item => ({ at: item.at, email: item.email })),
      ...data.events.map(event => ({ at: event.created_at, email: event.user_email })),
    ];
    const names = new Map(data.tasks.map(task => [String(task.creator_email || '').toLowerCase(), task.creator_name]).filter(([email, name]) => email && name));
    const inRange = item => Date.parse(item.at) >= since;
    return {
      exports,
      weekly: I.weeklyCounts(exports, { weeks: 12, now }),
      exportsThisWeek: exports.filter(item => Date.parse(item.at) >= thisWeek).length,
      exportsLastWeek: exports.filter(item => Date.parse(item.at) >= lastWeek && Date.parse(item.at) < thisWeek).length,
      exportsRange: exports.filter(inRange).length,
      exportsPrev: exports.filter(item => Date.parse(item.at) >= prevSince && Date.parse(item.at) < since).length,
      activeUsers: I.activeUsers(people, since),
      activePrev: I.activeUsers(people, prevSince, since),
      creators: I.exportsPerCreator(exports, since).map(row => ({ ...row, name: row.name || names.get(row.email) || row.email.split('@')[0] })),
      time: I.timeToExport({ events: data.events.map(e => ({ ...e, at: e.created_at })), tasks: exports.filter(e => e.source === 'editor') }, since),
      posted: I.postedRate({ exports, links: data.links }, since),
      leaderboard: I.templateLeaderboard({ exports, links: data.links, results: data.results }, since),
      generate: I.generateRunToExport({ events: data.events.map(e => ({ ...e, at: e.created_at })), usage: data.usage, exports }, since),
      cost: I.aiCostPerExport({ usage: data.usage, exports }, since),
      requests: I.requestOnTimeRate(data.requests.map(r => ({ dueAt: r.design_due_at, completedAt: r.completed_at, createdAt: r.created_at, status: r.status })), since, Infinity, now),
      resultsCount: data.results.length,
      matchedResults: data.results.filter(row => row.task_id).length,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function delta(current, previous, { lowerIsBetter = false, label = 'vs previous' } = {}) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return `<span class="dov-delta-vs">${esc(label)}: —</span>`;
    const change = (current - previous) / previous;
    const up = change > 0.005;
    const down = change < -0.005;
    const good = lowerIsBetter ? down : up;
    const bad = lowerIsBetter ? up : down;
    const tone = good ? 'is-up' : bad ? 'is-down' : 'is-flat';
    return `<span class="dov-delta ${tone}">${change > 0 ? '+' : ''}${Math.round(change * 100)}%</span><span class="dov-delta-vs">${esc(label)}</span>`;
  }

  function kpi({ label, value, deltaHtml = '', meta = '', key }) {
    return `<article class="dov-kpi" data-impact-kpi="${esc(key)}">
      <h3 class="dov-kpi-label es-type-eyebrow">${esc(label)}</h3>
      <p class="dov-kpi-value">${esc(value)}</p>
      <p class="dov-kpi-delta">${deltaHtml}</p>
      <p class="dov-kpi-meta" title="${esc(meta)}">${esc(meta)}</p>
    </article>`;
  }

  function weeklyChart(weekly) {
    const max = Math.max(1, ...weekly.map(w => w.count));
    // Draw at about the card's real width so labels stay readable on phones.
    const W = Math.round(Math.max(320, Math.min(640, (root?.clientWidth || 640) * (window.innerWidth > 900 ? 0.6 : 1) - 48)));
    const every = W < 480 ? 3 : 2;
    const H = 180;
    const pad = { top: 22, bottom: 26, side: 4 };
    const slot = (W - pad.side * 2) / weekly.length;
    const barW = Math.min(36, slot * 0.62);
    const usable = H - pad.top - pad.bottom;
    const bars = weekly.map((w, i) => {
      const h = w.count ? Math.max(3, (w.count / max) * usable) : 0;
      const x = pad.side + i * slot + (slot - barW) / 2;
      const y = H - pad.bottom - h;
      const current = i === weekly.length - 1;
      const showLabel = (weekly.length - 1 - i) % every === 0;
      return `<g class="ip-bar${current ? ' is-current' : ''}">
        <title>Week of ${esc(weekLabel(w.week))}: ${w.count} export${w.count === 1 ? '' : 's'}${current ? ' (so far)' : ''}</title>
        <rect x="${x.toFixed(1)}" y="${(H - pad.bottom - usable).toFixed(1)}" width="${barW.toFixed(1)}" height="${usable}" class="ip-bar__hit"/>
        ${h ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4" class="ip-bar__fill"/>` : `<rect x="${x.toFixed(1)}" y="${(H - pad.bottom - 2).toFixed(1)}" width="${barW.toFixed(1)}" height="2" rx="1" class="ip-bar__zero"/>`}
        ${w.count ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="ip-bar__value">${w.count}</text>` : ''}
        ${showLabel ? `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ip-bar__label">${esc(weekLabel(w.week))}</text>` : ''}
      </g>`;
    }).join('');
    const total = weekly.reduce((sum, w) => sum + w.count, 0);
    return `<svg class="ip-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Exports per week for the last 12 weeks, ${total} in total">${bars}</svg>`;
  }

  function table(head, rows, cls = '') {
    return `<div class="ip-table-wrap"><table class="dov-table ${cls}"><thead><tr>${head.map(([label, num]) => `<th scope="col"${num ? ' class="is-num"' : ''}>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  const empty = (title, copy) => `<div class="es-empty ip-empty"><p class="es-empty__title">${esc(title)}</p><p class="es-empty__copy">${esc(copy)}</p></div>`;

  function render() {
    if (!root) return;
    const data = state.data;
    const m = data ? compute(data, state.range) : null;
    const ready = data?.ready || {};
    const missing = data ? ['events', 'links', 'results'].filter(key => !ready[key]) : [];
    const rangeText = `Showing the last ${state.range} days. Weekly chart: last 12 weeks (Monday to Sunday, UTC).`;
    const loading = state.loading && !data;

    root.innerHTML = `
      <div class="dov-rangebar">
        <p class="dov-rangebar-text">${esc(rangeText)}</p>
        <div class="ip-rangebar-actions">
          <div class="dov-segment" role="group" aria-label="Time range for Impact">
            ${RANGES.map(days => `<button type="button" data-impact-range="${days}" aria-pressed="${days === state.range}">${days}d</button>`).join('')}
          </div>
          <button class="es-btn es-btn--sm es-btn--tertiary es-refresh" type="button" data-impact-refresh ${state.loading ? 'aria-busy="true"' : ''}>Refresh</button>
        </div>
      </div>
      ${missing.length && data ? `<div class="es-callout ip-callout" role="note"><div><strong>Posted links, events and imports are waiting for the database update.</strong> Apply <code>${esc(MIGRATION)}</code> to turn on ${esc(missing.join(', '))}. Until then this view uses exports, requests and AI usage only.</div></div>` : ''}
      ${state.error ? `<div class="es-error-state" role="alert"><p class="es-error-state__title">Couldn’t load Impact</p><p class="es-error-state__copy">${esc(state.error)}</p><button class="es-btn es-btn--sm" type="button" data-impact-refresh>Try again</button></div>` : ''}

      <section class="dov-kpis${loading ? ' is-loading' : ''}" aria-label="North-star and output">
        ${kpi({ key: 'weekly', label: 'Exports this week', value: m ? num(m.exportsThisWeek) : '—', deltaHtml: m ? delta(m.exportsThisWeek, m.exportsLastWeek, { label: `vs ${num(m.exportsLastWeek)} last week` }) : '', meta: 'North-star proxy (all tools)' })}
        ${kpi({ key: 'active', label: 'Active users', value: m ? num(m.activeUsers) : '—', deltaHtml: m ? delta(m.activeUsers, m.activePrev) : '', meta: m ? `${num(m.exportsRange)} exports in ${state.range} days` : '' })}
        ${kpi({ key: 'time', label: 'Median time to export', value: m ? mins(m.time.medianMs) : '—', meta: m ? (m.time.method === 'events' ? `${num(m.time.samples)} exports, from design start` : m.time.method === 'tasks' ? `${num(m.time.samples)} editor sessions (first export a day)` : 'No timed exports yet') : '' })}
        ${kpi({ key: 'posted', label: 'Posted rate', value: m && ready.links ? pct(m.posted.rate) : '—', meta: m && ready.links ? `${num(m.posted.posted)} of ${num(m.posted.exports)} exports have a link` : 'Needs the post links table' })}
      </section>
      <section class="dov-kpis${loading ? ' is-loading' : ''} ip-kpis-2" aria-label="AI and requests">
        ${kpi({ key: 'generate', label: 'Generate run → export', value: m ? pct(m.generate.rate) : '—', meta: m ? `${num(m.generate.exports)} exports from ${num(m.generate.runs)} runs${m.generate.method === 'usage' ? ' (runs from AI usage)' : ''}` : '' })}
        ${kpi({ key: 'cost', label: 'AI cost per export', value: m && ready.usage ? usd(m.cost.perExport) : '—', meta: m && ready.usage ? `${usd(m.cost.spend)} spent · ${usd(m.cost.perAiExport)} per AI export` : 'Needs AI usage' })}
        ${kpi({ key: 'requests', label: 'Requests on time', value: m ? pct(m.requests.rate) : '—', meta: m ? (m.requests.due ? `${num(m.requests.onTime)} of ${num(m.requests.due)} on time · ${num(m.requests.late)} late · ${num(m.requests.overdue)} overdue` : 'No requests due in this range') : '' })}
        ${kpi({ key: 'results', label: 'Imported results', value: m && ready.results ? num(m.resultsCount) : '—', meta: m && ready.results ? `${num(m.matchedResults)} matched to a design` : 'Needs the results table' })}
      </section>

      <section class="dov-section" aria-labelledby="ip-output-title">
        <h2 class="dov-section-title es-type-section" id="ip-output-title">Output</h2>
        <div class="dov-grid is-2-1">
          <article class="dov-card">
            <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">Exports per week</h3><p class="dov-card-meta">Editor, Generate, Video Ads and Reels. This week is so far.</p></div></header>
            <div class="dov-card-body">${m ? weeklyChart(m.weekly) : '<div class="es-skeleton ip-chart-skeleton"></div>'}</div>
          </article>
          <article class="dov-card">
            <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">Exports per creator</h3><p class="dov-card-meta">Last ${state.range} days</p></div></header>
            <div class="dov-card-body is-flush">${m ? (m.creators.length
              ? table([['Creator'], ['Exports', true]], m.creators.slice(0, 10).map(row => `<tr><td><span class="dov-cell-title">${esc(row.name)}</span><span class="dov-cell-meta">${esc(Object.entries(row.sources).map(([s, n]) => `${SOURCE_LABELS[s] || s} ${n}`).join(' · '))}</span></td><td class="is-num">${num(row.exports)}</td></tr>`), 'ip-table-creators')
              : empty('No exports in this range', 'Exports from every tool show up here.')) : ''}</div>
          </article>
        </div>
      </section>

      <section class="dov-section" aria-labelledby="ip-templates-title">
        <h2 class="dov-section-title es-type-section" id="ip-templates-title">Template leaderboard</h2>
        <article class="dov-card">
          <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">Which templates earn their keep</h3><p class="dov-card-meta">Exports, how many were posted, and imported results (clicks, impressions, opens) over the last ${state.range} days</p></div></header>
          <div class="dov-card-body is-flush">${m ? (m.leaderboard.length
            ? table([['Template'], ['Exports', true], ['Creators', true], ['Posted', true], ['Clicks', true], ['Impr. / opens', true]], m.leaderboard.slice(0, 15).map(row => `<tr>
                <td><span class="dov-cell-title">${esc(row.template)}</span><span class="dov-cell-meta">${esc(row.workspace || '')}</span></td>
                <td class="is-num">${num(row.exports)}</td>
                <td class="is-num">${num(row.creators)}</td>
                <td class="is-num">${ready.links ? `${pct(row.postedRate)}` : '—'}</td>
                <td class="is-num">${row.withResults ? num(row.results.clicks) : '—'}</td>
                <td class="is-num">${row.withResults ? num(row.results.impressions ?? row.results.opens) : '—'}</td>
              </tr>`), 'ip-table-leaderboard')
            : empty('No exports in this range', 'Pick a longer range, or check back after the team exports.')) : ''}</div>
        </article>
      </section>

      <section class="dov-section" aria-labelledby="ip-results-title">
        <h2 class="dov-section-title es-type-section" id="ip-results-title">Results</h2>
        <div class="dov-grid is-1-1">
          <article class="dov-card" id="ip-import-card">
            <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">Import results</h3><p class="dov-card-meta">A Meta Ads Manager or Beehiiv posts CSV. Rows match designs by ad id, ad name or posted link.</p></div></header>
            <div class="dov-card-body" id="ip-import"></div>
          </article>
          <article class="dov-card">
            <header class="dov-card-head"><div><h3 class="dov-card-title es-type-card-title">Recently posted</h3><p class="dov-card-meta">Links people pasted after exporting</p></div></header>
            <div class="dov-card-body is-flush">${data ? (!ready.links ? empty('Posted links aren’t on yet', 'They appear here once the database update is applied.') : data.links.length
              ? table([['Where'], ['Design'], ['When', true]], data.links.slice(0, 8).map(link => `<tr>
                  <td><span class="dov-pill is-good has-dot">${esc(I.PLATFORMS[link.platform] || 'Link')}</span></td>
                  <td>${link.url ? `<a class="ip-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.design_ref || link.url.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : `<span class="dov-cell-title">${esc(link.design_ref || `Ad ${link.external_id}`)}</span>`}<span class="dov-cell-meta">${esc([SOURCE_LABELS[link.source] || link.source, String(link.user_email || '').split('@')[0]].filter(Boolean).join(' · '))}</span></td>
                  <td class="is-num">${esc(new Date(link.posted_at || link.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</td>
                </tr>`), 'ip-table-links')
              : empty('No posted links yet', 'After an export, people paste where it went live.')) : ''}</div>
          </article>
        </div>
      </section>`;

    renderImporter();
  }

  // ── CSV import ────────────────────────────────────────────────────────────
  function renderImporter() {
    const host = root?.querySelector('#ip-import');
    if (!host) return;
    const imp = state.importer;
    const ready = state.data?.ready || {};
    const api = state.api;
    const apiLine = api
      ? Object.entries(api.sources || {}).map(([, s]) => `${s.label}: ${s.configured ? 'connected (pull coming soon)' : 'not connected'}`).join(' · ')
      : 'API pull: checking…';
    if (!imp) {
      host.innerHTML = `
        <div class="ip-import-start">
          <label class="es-btn es-btn--sm ip-file">
            <input type="file" accept=".csv,text/csv" data-impact-file class="sr-only">
            <span>Choose a CSV</span>
          </label>
          <p class="dov-note">In Ads Manager: Reports → Export table data → CSV, at ad level. In Beehiiv: Posts → Export.${ready.results ? '' : ' Importing needs the database update; you can still preview a file.'}</p>
          <p class="dov-note ip-api-line" data-impact-api>${esc(apiLine)}</p>
        </div>`;
      return;
    }
    const fields = I.IMPORT_FIELDS[imp.kind] || [];
    const optionHtml = selected => `<option value="">Not in file</option>${imp.headers.map((h, i) => `<option value="${i}"${selected === i ? ' selected' : ''}>${esc(h)}</option>`).join('')}`;
    const matched = imp.matched || [];
    const counts = matched.reduce((acc, row) => { acc[row.match.method === 'none' ? 'none' : 'hit'] += 1; return acc; }, { hit: 0, none: 0 });
    const keyOk = imp.kind === 'meta_ads' ? (imp.mapping.ad_id != null || imp.mapping.ad_name != null) : (imp.mapping.url != null || imp.mapping.post_id != null || imp.mapping.title != null);
    host.innerHTML = `
      <div class="ip-import">
        <div class="ip-import-file">
          <span class="dov-cell-title">${esc(imp.fileName)}</span>
          <span class="dov-cell-meta">${num(imp.rows.length)} rows · ${esc(imp.headers.length)} columns</span>
        </div>
        <label class="es-field ip-kind">
          <span class="es-field__label">File type</span>
          <select class="es-select es-select--sm" data-impact-kind>
            <option value="meta_ads"${imp.kind === 'meta_ads' ? ' selected' : ''}>Meta Ads results</option>
            <option value="beehiiv"${imp.kind === 'beehiiv' ? ' selected' : ''}>Beehiiv post stats</option>
          </select>
        </label>
        <details class="ip-mapping"${keyOk ? '' : ' open'}>
          <summary>Columns (${Object.keys(imp.mapping).length} of ${fields.length} found)</summary>
          <div class="ip-mapping-grid">
            ${fields.map(([field, label]) => `<label class="es-field"><span class="es-field__label">${esc(label)}</span><select class="es-select es-select--sm" data-impact-map="${esc(field)}">${optionHtml(imp.mapping[field])}</select></label>`).join('')}
          </div>
        </details>
        ${keyOk ? '' : `<p class="es-field__error" role="alert">${imp.kind === 'meta_ads' ? 'Pick the Ad ID or Ad name column so rows can be matched.' : 'Pick the post URL, post ID or title column so rows can be matched.'}</p>`}
        ${keyOk ? `<p class="dov-note ip-summary" aria-live="polite"><strong>${num(matched.length)} rows</strong> · ${num(counts.hit)} matched to a design · ${num(counts.none)} not matched yet (kept, and matched on a later import)</p>
          ${table([['Row'], ['Match'], [imp.kind === 'meta_ads' ? 'Clicks' : 'Opens', true]], matched.slice(0, 6).map(row => `<tr>
            <td><span class="dov-cell-title">${esc(row.adName || row.title || row.url || row.rowKey)}</span><span class="dov-cell-meta">${esc([row.periodStart, row.periodEnd && row.periodEnd !== row.periodStart ? row.periodEnd : ''].filter(Boolean).join(' → '))}</span></td>
            <td><span class="dov-pill ${row.match.method === 'none' ? 'is-neutral' : 'is-good'} has-dot">${esc(MATCH_LABELS[row.match.method])}</span></td>
            <td class="is-num">${num(imp.kind === 'meta_ads' ? row.metrics.clicks : row.metrics.opens)}</td>
          </tr>`), 'ip-table-preview')}` : ''}
        <div class="ip-import-actions">
          <button class="es-btn es-btn--primary es-btn--sm" type="button" data-impact-import ${!keyOk || !matched.length || !ready.results || imp.busy ? 'disabled' : ''} ${imp.busy ? 'aria-busy="true"' : ''}>Import ${num(matched.length)} rows</button>
          <button class="es-btn es-btn--sm es-btn--tertiary" type="button" data-impact-cancel>Choose another file</button>
        </div>
        <p class="dov-note" aria-live="polite" data-impact-status>${esc(imp.status || (ready.results ? '' : 'Preview only: importing needs the database update.'))}</p>
      </div>`;
  }

  function rematch() {
    const imp = state.importer;
    if (!imp) return;
    const data = state.data || { links: [], events: [] };
    const results = I.rowsToResults(imp.rows, imp.mapping, imp.kind);
    const exports = exportsOf({ tasks: [], events: data.events || [] }).flatMap(item => (item.adNames?.length
      ? item.adNames.map(adName => ({ ...item, adName, size: (I.parseAdName(adName) || {}).size || '' , exportedAt: item.at }))
      : [{ ...item, exportedAt: item.at }]));
    imp.matched = I.matchResults(results, { links: data.links || [], exports });
  }

  async function readFile(file) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { state.importer = null; renderImporter(); alertStatus('That file is over 10 MB. Export a shorter date range.'); return; }
    const text = await file.text();
    const { headers, rows } = I.parseCsv(text);
    const kind = I.detectCsvKind(headers) || 'meta_ads';
    state.importer = { fileName: file.name, headers, rows, kind, mapping: I.guessMapping(headers, kind), status: '' };
    rematch();
    renderImporter();
    root.querySelector('[data-impact-kind]')?.focus();
  }

  function alertStatus(text) {
    const node = root?.querySelector('[data-impact-status]') || root?.querySelector('.ip-import-start .dov-note');
    if (node) node.textContent = text;
  }

  async function runImport() {
    const imp = state.importer;
    if (!imp?.matched?.length || imp.busy) return;
    imp.busy = true;
    imp.status = 'Importing…';
    renderImporter();
    try {
      const client = await getClient();
      const session = client ? (await client.auth.getSession())?.data?.session : null;
      if (!client || !session) throw new Error('Sign in again, then retry.');
      const by = String(session.user?.email || '').toLowerCase();
      const rows = imp.matched.map(row => ({
        imported_by: by,
        source: imp.kind,
        row_key: row.rowKey,
        period_start: row.periodStart,
        period_end: row.periodEnd,
        task_id: row.match.taskId,
        post_link_id: row.match.postLinkId,
        match_method: row.match.method,
        title: row.title.slice(0, 400),
        url: row.url.slice(0, 2000),
        ad_name: row.adName.slice(0, 400),
        brand: row.parsedName?.brand || '',
        style: row.parsedName?.style || '',
        metrics: row.metrics,
        raw: row.raw,
        imported_at: new Date().toISOString(),
      }));
      // Same file twice: the latest row for a key wins (one upsert per key).
      const unique = [...new Map(rows.map(row => [`${row.row_key}|${row.period_start}|${row.period_end}`, row])).values()];
      for (let i = 0; i < unique.length; i += 500) {
        const { error } = await client.from('frameup_post_results').upsert(unique.slice(i, i + 500), { onConflict: 'source,row_key,period_start,period_end' });
        if (error) throw error;
      }
      const matchedCount = unique.filter(row => row.task_id).length;
      state.importer = null;
      await refresh();
      alertStatus(`Imported ${unique.length} rows, ${matchedCount} matched to a design.`);
    } catch (error) {
      imp.busy = false;
      imp.status = isMissing(error) ? 'Importing needs the database update (frameup_post_results).' : `Import failed: ${error?.message || 'try again'}.`;
      renderImporter();
    }
  }

  async function loadApiStatus() {
    try {
      const fetcher = window.ESAuth?.fetchWithAuth || fetch;
      const response = await fetcher('/api/impact-stats');
      const body = await response.json().catch(() => null);
      state.api = response.ok && body?.ok ? body : { sources: { beehiiv: { label: 'Beehiiv API', configured: false }, meta: { label: 'Meta Ads API', configured: false } } };
    } catch (error) {
      state.api = { sources: { beehiiv: { label: 'Beehiiv API', configured: false }, meta: { label: 'Meta Ads API', configured: false } } };
    }
    const node = root?.querySelector('[data-impact-api]');
    if (node) node.textContent = Object.values(state.api.sources).map(s => `${s.label}: ${s.configured ? 'connected (pull coming soon)' : 'not connected'}`).join(' · ');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    render();
    try {
      state.data = await loadData();
      state.loadedAt = Date.now();
    } catch (error) {
      state.error = error?.message || 'Something went wrong.';
    } finally {
      state.loading = false;
      if (state.importer) rematch();
      render();
    }
  }

  function bind() {
    root.addEventListener('click', event => {
      const range = event.target.closest('[data-impact-range]');
      if (range) { state.range = Number(range.dataset.impactRange) || 30; render(); root.querySelector(`[data-impact-range="${state.range}"]`)?.focus(); return; }
      if (event.target.closest('[data-impact-refresh]')) { refresh(); return; }
      if (event.target.closest('[data-impact-import]')) { runImport(); return; }
      if (event.target.closest('[data-impact-cancel]')) { state.importer = null; renderImporter(); root.querySelector('[data-impact-file]')?.focus(); }
    });
    root.addEventListener('change', event => {
      if (event.target.matches('[data-impact-file]')) { readFile(event.target.files?.[0]); return; }
      const imp = state.importer;
      if (!imp) return;
      if (event.target.matches('[data-impact-kind]')) {
        imp.kind = event.target.value;
        imp.mapping = I.guessMapping(imp.headers, imp.kind);
        rematch();
        renderImporter();
        root.querySelector('[data-impact-kind]')?.focus();
        return;
      }
      const field = event.target.dataset?.impactMap;
      if (field) {
        if (event.target.value === '') delete imp.mapping[field];
        else imp.mapping[field] = Number(event.target.value);
        rematch();
        renderImporter();
        const again = root.querySelector(`[data-impact-map="${CSS.escape(field)}"]`);
        again?.closest('details')?.setAttribute('open', '');
        again?.focus();
      }
    });
  }

  function mount(section) {
    if (!section || root) return;
    root = section;
    bind();
    const isShown = () => !section.hidden && section.offsetParent !== null;
    const maybeLoad = () => {
      if (!isShown()) return;
      if (!state.data && !state.loading) { refresh(); loadApiStatus(); }
    };
    new MutationObserver(maybeLoad).observe(section, { attributes: true, attributeFilter: ['hidden'] });
    render();
    maybeLoad();
  }

  window.FrameUpImpactView = Object.freeze({ mount, refresh, compute, exportsOf });
  const boot = () => mount(document.getElementById('impact-view'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
