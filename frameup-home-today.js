// Home → "Today": a daily start in one glance.
//   Quick actions:  Generate, Video Ads, Reels Studio, Request a design
//   Trending now:   free Trends feed (GET /api/trend-design, no AI), for the
//                   sport you pick (remembered); "Design this" opens Generate
//                   with the brief filled in and autorun=0 (nothing is spent
//                   until you press Generate)
//   My requests:    open requests I filed or am working on
//   Team exports:   the newest Gallery posts
//   My drafts:      designs saved to my account (frameup_drafts)
//
// Loads only while Home is on screen, after first paint, once per visit
// (each source is cached in sessionStorage for a few minutes, so going to an
// editor and back costs nothing). Every card has its own loading, empty and
// error state; a missing table or a signed-out preview just shows the empty
// state. Pure helpers are exported for the tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.install(window);
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const SPORT_KEY = 'frameup.home.sport';
  const CACHE_PREFIX = 'frameup.home.v1.';
  const CACHE_MS = { trends: 10 * 60 * 1000, requests: 2 * 60 * 1000, exports: 3 * 60 * 1000, drafts: 2 * 60 * 1000 };
  const OPEN = ['Backlog', 'Assigned', 'Doing', 'Review'];
  const STATUS_LABELS = { Backlog: 'New', Assigned: 'Assigned', Doing: 'In progress', Review: 'In review' };

  // ─── Pure helpers ──────────────────────────────────────────────────────
  function greeting(date = new Date()) {
    const hour = date.getHours();
    if (hour < 5) return 'Working late';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // Up to n trends for one sport ('all' = one per sport first, then the rest).
  function pickTrends(items = [], sport = 'all', n = 4) {
    const list = (Array.isArray(items) ? items : []).filter(item => item && item.title);
    if (sport && sport !== 'all') return list.filter(item => item.category === sport).slice(0, n);
    const picks = [];
    const seen = new Set();
    list.forEach(item => { if (picks.length < n && !seen.has(item.category)) { seen.add(item.category); picks.push(item); } });
    list.forEach(item => { if (picks.length < n && !picks.includes(item)) picks.push(item); });
    return picks;
  }

  // The brief carries only the trend's own words (no invented facts).
  function trendHref(item = {}, sportLabel = '') {
    const brief = [String(item.title || '').trim(), sportLabel ? `Sport: ${sportLabel}` : ''].filter(Boolean).join('\n').slice(0, 600);
    return `generate.html?brief=${encodeURIComponent(brief)}&autorun=0`;
  }

  function dueLabel(iso, now = Date.now()) {
    const due = Date.parse(iso || '');
    if (!Number.isFinite(due)) return '';
    const diff = due - now;
    if (diff < 0) return 'Overdue';
    const hours = Math.round(diff / 3600000);
    if (hours < 1) return 'Due within the hour';
    if (hours < 24) return `Due in ${hours}h`;
    const days = Math.round(hours / 24);
    return `Due in ${days}d`;
  }

  // Overdue first, then soonest due, then most recently updated.
  function sortRequests(rows = [], now = Date.now()) {
    return [...rows].sort((a, b) => {
      const ad = Date.parse(a.design_due_at || '') || Infinity;
      const bd = Date.parse(b.design_due_at || '') || Infinity;
      const ao = ad < now ? 0 : 1;
      const bo = bd < now ? 0 : 1;
      if (ao !== bo) return ao - bo;
      if (ad !== bd) return ad - bd;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  }

  function timeAgo(iso, now = Date.now()) {
    const then = Date.parse(iso || '');
    if (!Number.isFinite(then)) return '';
    const mins = Math.round((now - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  // ─── Browser ───────────────────────────────────────────────────────────
  function install(win) {
    const doc = win.document;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const isHome = () => { const hash = win.location.hash.replace('#', ''); return !hash || hash === 'frames'; };
    let started = false;
    let trendData = null;

    function readCache(key) {
      try {
        const hit = JSON.parse(win.sessionStorage.getItem(CACHE_PREFIX + key) || 'null');
        return hit && Date.now() - hit.at < CACHE_MS[key] ? hit.value : null;
      } catch (error) { return null; }
    }
    function writeCache(key, value) {
      try { win.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), value })); } catch (error) { /* full or blocked */ }
    }
    async function cached(key, load) {
      const hit = readCache(key);
      if (hit) return hit;
      const value = await load();
      if (value && value.ok) writeCache(key, value);
      return value;
    }
    function client() {
      try { return win.ESAuth?.getSupabaseClient?.() || null; } catch (error) { return null; }
    }
    async function me() {
      try { await win.ESAuth?.ensureSupabaseReady?.(); } catch (error) { /* preview */ }
      try {
        const session = await win.ESAuth?.getSession?.();
        const email = String(session?.user?.email || '').trim().toLowerCase();
        return email ? { email, id: String(session?.user?.id || ''), name: String(session?.user?.name || '').trim() } : null;
      } catch (error) { return null; }
    }

    const card = id => doc.querySelector(`[data-today="${id}"]`);
    const body = id => card(id)?.querySelector('.home-today__body');
    const skeleton = rows => `<ul class="home-today__rows" aria-hidden="true">${'<li class="home-today__row is-skeleton"><span class="es-skeleton"></span><span class="es-skeleton"></span></li>'.repeat(rows)}</ul>`;
    const empty = (title, copy, action = '') => `<div class="home-today__empty"><p><strong>${esc(title)}</strong>${esc(copy)}</p>${action}</div>`;
    const failed = (what, retry) => `<div class="home-today__empty is-error" role="status"><p><strong>Couldn’t load ${esc(what)}</strong>Check your connection, then try again.</p><button type="button" class="es-btn es-btn--sm" data-today-retry="${esc(retry)}">Try again</button></div>`;
    function setBusy(id, busy) { body(id)?.setAttribute('aria-busy', String(busy)); }

    // Trends (free, cached on the server too)
    async function loadTrends() {
      return cached('trends', async () => {
        try {
          const response = await win.fetch('/api/trend-design', { headers: { Accept: 'application/json' } });
          if (!response.ok) return { ok: false };
          const data = await response.json();
          return { ok: true, items: (data.items || []).slice(0, 60).map(item => ({ id: item.id, title: item.title, category: item.category, image: item.image || '' })), categories: data.categories || [] };
        } catch (error) { return { ok: false }; }
      });
    }
    function sportLabel(id) {
      return trendData?.categories?.find(c => c.id === id)?.label || win.LeagueLogos?.logoFor?.(id)?.label || '';
    }
    function renderTrends() {
      const target = body('trends');
      if (!target) return;
      if (!trendData?.ok) { target.innerHTML = failed('trends', 'trends'); return; }
      let sport = 'all';
      try { sport = win.localStorage.getItem(SPORT_KEY) || 'all'; } catch (error) { /* ignore */ }
      const cats = (trendData.categories || []).filter(c => trendData.items.some(item => item.category === c.id));
      if (sport !== 'all' && !cats.some(c => c.id === sport)) sport = 'all';
      const picks = pickTrends(trendData.items, sport, 4);
      const chips = `<div class="home-today__chips" role="group" aria-label="Sport">${[{ id: 'all', label: 'All sports' }, ...cats].map(c => `<button type="button" class="es-chip es-chip--sm" data-today-sport="${esc(c.id)}" aria-pressed="${c.id === sport}">${esc(c.label)}</button>`).join('')}</div>`;
      const rows = picks.length
        ? `<ul class="home-today__rows">${picks.map(item => {
          const label = sportLabel(item.category);
          return `<li class="home-today__row"><span class="home-today__row-text"><small>${esc(label || 'Sports')}</small><span title="${esc(item.title)}">${esc(item.title)}</span></span><a class="es-btn es-btn--tertiary es-btn--sm" href="${esc(trendHref(item, label))}" aria-label="Design this: ${esc(item.title)}">Design this</a></li>`;
        }).join('')}</ul>`
        : empty('Quiet right now', 'No fresh stories for this sport. Try All sports.');
      target.innerHTML = chips + rows;
    }

    // My open requests (as requester or designer)
    async function loadRequests(user) {
      return cached('requests', async () => {
        const sb = client();
        if (!sb || !user) return { ok: true, rows: [], signedOut: !user };
        const { data, error } = await sb.from('es_designer_tasks')
          .select('id,source_id,title,status,assigned_to,requester_email,creator_email,design_due_at,updated_at')
          .eq('task_type', 'design_request')
          .in('status', OPEN)
          .or(`requester_email.eq.${user.email},creator_email.eq.${user.email},assigned_to.eq.${user.email}`)
          .order('updated_at', { ascending: false })
          .limit(12);
        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true, rows: data || [] };
      });
    }
    function renderRequests(result, user) {
      const target = body('requests');
      if (!target) return;
      if (!result?.ok) { target.innerHTML = failed('your requests', 'requests'); return; }
      const rows = sortRequests(result.rows).slice(0, 4);
      if (!rows.length) {
        target.innerHTML = empty('Nothing open', 'Need a design from the team? Send one clear brief.', '<a class="es-btn es-btn--sm" href="design-request.html">Request a design</a>');
        return;
      }
      target.innerHTML = `<ul class="home-today__rows">${rows.map(row => {
        const due = dueLabel(row.design_due_at);
        const mineToDo = user && String(row.assigned_to || '').toLowerCase() === user.email;
        const id = row.source_id || String(row.id || '').replace(/^task-request-/, '');
        return `<li class="home-today__row"><a class="home-today__row-link" href="requests.html?id=${encodeURIComponent(id)}"><span class="home-today__row-text"><small>${esc(mineToDo ? 'Assigned to you' : 'You asked')}${due ? ` · <span class="${due === 'Overdue' ? 'is-overdue' : ''}">${esc(due)}</span>` : ''}</small><span title="${esc(row.title)}">${esc(row.title || 'Design request')}</span></span><span class="es-badge">${esc(STATUS_LABELS[row.status] || row.status)}</span></a></li>`;
      }).join('')}</ul>`;
    }

    // Newest team exports (Gallery)
    async function loadExports() {
      return cached('exports', async () => {
        const data = win.ESDashboardData;
        if (!data?.fetchGalleryExports) return { ok: true, items: [] };
        try {
          const { items } = await data.fetchGalleryExports({ limit: 6 });
          // A small inline preview is the fallback when a post has no Storage thumbnail.
          const list = (items || []).slice(0, 6).map(item => ({ id: item.id, title: item.title, creator: item.creator, variant: item.variant, exportedAt: item.exportedAt, preview: String(item.previewDataUrl || '').length < 60000 ? item.previewDataUrl || '' : '' }));
          let thumbs = {};
          try { thumbs = (await data.fetchGalleryThumbs?.(list.map(item => item.id))) || {}; } catch (error) { thumbs = {}; }
          // Signed thumbnail links last far longer than this cache.
          return { ok: true, items: list, thumbs };
        } catch (error) { return { ok: false }; }
      });
    }
    function renderExports(result) {
      const target = body('exports');
      if (!target) return;
      if (!result?.ok) { target.innerHTML = failed('team exports', 'exports'); return; }
      if (!result.items.length) {
        target.innerHTML = empty('No exports yet', 'Posts the team exports show up here and in the Gallery.', '<a class="es-btn es-btn--sm" href="index.html#instagram">Create a post</a>');
        return;
      }
      const thumbs = result.thumbs || {};
      target.innerHTML = `<ul class="home-today__shots">${result.items.map(item => `<li><a class="home-today__shot" href="gallery.html?q=${encodeURIComponent(item.title || '')}" title="${esc([item.title, item.creator, timeAgo(item.exportedAt)].filter(Boolean).join(' · '))}">${thumbs[item.id] || item.preview ? `<img src="${esc(thumbs[item.id] || item.preview)}" alt="" loading="lazy" decoding="async">` : `<span class="home-today__shot-name">${esc(item.variant || item.title || 'Post')}</span>`}<span class="es-sr-only">${esc(item.title)}${item.creator ? `, by ${esc(item.creator)}` : ''}</span></a></li>`).join('')}</ul>`;
      target.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
        const tile = doc.createElement('span');
        tile.className = 'home-today__shot-name';
        tile.textContent = 'Post';
        img.replaceWith(tile);
      }, { once: true }));
    }

    // Drafts saved to my account (frameup-cloud-drafts.js writes them)
    async function loadDrafts(user) {
      return cached('drafts', async () => {
        const sb = client();
        if (!sb || !user) return { ok: true, rows: [] };
        let query = sb.from('frameup_drafts').select('draft_key,kind,workspace,title,updated_at');
        if (user.id) query = query.eq('owner_id', user.id);
        const { data, error } = await query
          .order('updated_at', { ascending: false })
          .limit(4);
        // Table not created yet: same as no drafts.
        if (error) return /does not exist|could not find|schema cache/i.test(String(error.message || '')) ? { ok: true, rows: [], missing: true } : { ok: false };
        return { ok: true, rows: data || [] };
      });
    }
    function renderDrafts(result) {
      const target = body('drafts');
      if (!target) return;
      if (!result?.ok) { target.innerHTML = failed('your drafts', 'drafts'); return; }
      const rows = (result.rows || []).slice(0, 3);
      if (!rows.length) {
        target.innerHTML = empty('No drafts on your account', 'Editor work saves here as you go, so it follows you to any browser.');
        return;
      }
      const labels = { instagram: 'Social Media', youtube: 'YouTube', newsletter: 'Newsletter' };
      target.innerHTML = `<ul class="home-today__rows">${rows.map(row => {
        const title = row.draft_key === 'editor' ? 'Work in progress' : (row.title || 'Untitled design');
        return `<li class="home-today__row"><span class="home-today__row-text"><small>${esc([labels[row.workspace] || row.workspace || 'Editor', timeAgo(row.updated_at)].filter(Boolean).join(' · '))}</small><span title="${esc(title)}">${esc(title)}</span></span></li>`;
      }).join('')}</ul><button type="button" class="es-btn es-btn--sm home-today__drafts-open" data-today-drafts>Open my drafts</button>`;
    }

    async function run(which) {
      const user = await me();
      const jobs = {
        trends: async () => { setBusy('trends', true); trendData = await loadTrends(); renderTrends(); setBusy('trends', false); },
        requests: async () => { setBusy('requests', true); renderRequests(await loadRequests(user), user); setBusy('requests', false); },
        exports: async () => { setBusy('exports', true); renderExports(await loadExports()); setBusy('exports', false); },
        drafts: async () => { setBusy('drafts', true); renderDrafts(await loadDrafts(user)); setBusy('drafts', false); },
      };
      const names = which ? [which] : Object.keys(jobs);
      await Promise.all(names.map(name => jobs[name]().catch(() => {
        const target = body(name);
        if (target) target.innerHTML = failed(name, name);
        setBusy(name, false);
      })));
    }

    function start() {
      const section = doc.getElementById('home-today');
      if (!section || !isHome()) return;
      const title = doc.getElementById('home-today-title');
      if (title) title.textContent = greeting();
      if (started) { run(); return; } // cached: no network unless stale
      started = true;
      ['trends', 'requests', 'exports', 'drafts'].forEach(id => { const target = body(id); if (target && !target.innerHTML.trim()) target.innerHTML = skeleton(id === 'exports' ? 1 : 3); });
      section.addEventListener('click', event => {
        const sport = event.target.closest('[data-today-sport]');
        if (sport) {
          try { win.localStorage.setItem(SPORT_KEY, sport.dataset.todaySport); } catch (error) { /* per browser */ }
          renderTrends();
          section.querySelector(`[data-today-sport="${CSS.escape(sport.dataset.todaySport)}"]`)?.focus();
          return;
        }
        const retry = event.target.closest('[data-today-retry]');
        if (retry) {
          try { win.sessionStorage.removeItem(CACHE_PREFIX + retry.dataset.todayRetry); } catch (error) { /* ignore */ }
          body(retry.dataset.todayRetry).innerHTML = skeleton(2);
          run(retry.dataset.todayRetry);
          return;
        }
        if (event.target.closest('[data-today-drafts]')) win.FrameUpDesigns?.showRecentDesigns?.();
      });
      run();
    }

    const later = fn => (win.requestIdleCallback ? win.requestIdleCallback(fn, { timeout: 1500 }) : win.setTimeout(fn, 300));
    const boot = () => later(start);
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
    win.addEventListener('hashchange', () => { if (isHome()) later(start); });
    win.FrameUpHomeToday = Object.freeze({ refresh: () => run() });
  }

  return { greeting, pickTrends, trendHref, dueLabel, sortRequests, timeAgo, install };
}));
