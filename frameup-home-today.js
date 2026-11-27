// Home → "Today": mission control for the day, answered in one glance.
//   Start here:   the top story right now (Trends' own "Post now" ranking),
//                 with one click to a post, a reel or a video ad; the brief
//                 carries only the story's own words, nothing is spent until
//                 the person presses Generate in the tool.
//   Create:       Generate, Reels Studio, Video Ads and the Editor, each with
//                 a "continue" hint from this browser (last brief, last reel,
//                 last newsletter brand, last editor draft).
//   Trending now: the free Trends feed (GET /api/trend-design, no AI) for the
//                 sport you pick (remembered), full titles, heat and age, and
//                 Post / Reel / Ad on every row (Trends' hand-offs).
//   Continue:     what you were making, across tools: designs exported on this
//                 browser (with thumbnails), drafts on your account
//                 (frameup_drafts) and Reels Studio projects.
//   Team exports: the newest Gallery posts with who and when.
//   This week:    team exports per day, top formats, most active and your own
//                 count and streak, all counted from the same Gallery list.
//   My requests:  only when FrameUpFeatures.requests is on (paused today).
//
// Loads only while Home is on screen, after first paint, once per visit
// (each source is cached in sessionStorage for a few minutes, so going to an
// editor and back costs nothing). Every card has its own loading, empty and
// error state. Pure helpers are exported for the tests.
(function (root, factory) {
  let logic = root && root.TrendsLogic;
  if (!logic && typeof module === 'object' && typeof require === 'function') {
    try { logic = require('./trends-logic.js'); } catch (error) { logic = null; }
  }
  const api = factory(logic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.install(window);
}(typeof globalThis !== 'undefined' ? globalThis : this, (BundledLogic) => {
  'use strict';

  const SPORT_KEY = 'frameup.home.sport';
  const CACHE_PREFIX = 'frameup.home.v2.';
  const CACHE_MS = { trends: 10 * 60 * 1000, requests: 2 * 60 * 1000, exports: 3 * 60 * 1000, drafts: 2 * 60 * 1000 };
  const OPEN = ['Backlog', 'Assigned', 'Doing', 'Review'];
  const STATUS_LABELS = { Backlog: 'New', Assigned: 'Assigned', Doing: 'In progress', Review: 'In review' };
  const WORKSPACE_LABELS = { instagram: 'Social Media', youtube: 'YouTube', newsletter: 'Newsletter', reels: 'Reel Captions' };
  const GALLERY_LIMIT = 48; // one Gallery read feeds both "Team exports" and "This week"
  const SHOTS = 10;
  const KEYS = {
    reels: 'frameup.reels.projects.v1',
    briefs: 'frameup.generate.recent.v1',
    videoDefaults: 'frameup.videoAds.brandDefaults.v1',
  };
  const BRAND_LABELS = { 'the-huddle': 'The Huddle', 'essentially-cfb': 'Essentially CFB', 'es-dugout': 'ES Dugout' };
  const AD_SPORTS = ['nfl', 'cfb', 'mlb'];
  const JOB_CARDS = { trends: ['trends', 'spotlight'], exports: ['exports', 'pulse'], drafts: ['continue'], requests: ['requests'] };

  // ─── Pure helpers ──────────────────────────────────────────────────────
  function greeting(date = new Date()) {
    const hour = date.getHours();
    if (hour < 5) return 'Working late';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  // "Suhail Quraishi" → "Suhail"; "suhail.quraishi" → "Suhail".
  function firstName(name = '', email = '') {
    const raw = String(name || '').trim() || String(email || '').split('@')[0];
    const first = raw.split(/[\s._-]+/).find(Boolean) || '';
    if (!/^[a-z]/i.test(first)) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
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

  // The spotlight story and the list under it. Uses Trends' own ranking
  // (TrendsLogic.topPicks: rank × ES fit × hot/rising, one per storyline);
  // the spotlight is the best story in any sport, the list never repeats it.
  function planTrends(items = [], sport = 'all', { n = 5, logic = BundledLogic } = {}) {
    const list = (Array.isArray(items) ? items : []).filter(item => item && item.title);
    const rank = (pool, count, maxPerSport) => (logic && logic.topPicks ? logic.topPicks(pool, { n: count, maxPerSport }) : pickTrends(pool, 'all', count));
    const spotlight = rank(list, 1, 1)[0] || null;
    const rest = list.filter(item => item !== spotlight);
    const filtered = sport && sport !== 'all';
    const pool = filtered ? rest.filter(item => item.category === sport) : rest;
    return { spotlight, rows: rank(pool, n, filtered ? n : 2) };
  }

  // The brief carries only the trend's own words (no invented facts): a real
  // brief from TrendsLogic.briefFor (who, what happened, the related headlines,
  // why fans care). The league rides beside it (&league=), not as a line.
  function trendHref(item = {}, sportLabel = '', { logic = BundledLogic, why = '' } = {}) {
    const title = String(item.title || '').trim();
    const brief = logic && logic.briefFor
      ? logic.briefFor(item, { sportLabel, why })
      : [/[.!?]$/.test(title) ? title : `${title}.`, why ? `Why fans care: ${why}` : ''].filter(Boolean).join('\n').slice(0, 600);
    // &trend=<id>: Generate picks up the full trend stored for that id (designHandoff).
    return `generate.html?brief=${encodeURIComponent(brief)}${sportLabel ? `&league=${encodeURIComponent(sportLabel)}` : ''}${item.id ? `&trend=${encodeURIComponent(item.id)}` : ''}&autorun=0`;
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

  // ISO string or epoch ms → "19m ago".
  function timeAgo(when, now = Date.now()) {
    const then = typeof when === 'number' ? when : Date.parse(when || '');
    if (!Number.isFinite(then) || then <= 0) return '';
    const mins = Math.round((now - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Is this Gallery creator name me? Matches the display name or the email's
  // local part, ignoring case, spaces and dots.
  function isMe(creator, me) {
    const c = norm(creator);
    if (!c || !me) return false;
    return c === norm(me.name) || c === norm(String(me.email || '').split('@')[0]);
  }

  const dayStart = (ms, offset = 0) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime(); };

  // "This week" from the Gallery list: the last 7 days (today included).
  // atLeast is true when the list was cut by its limit inside the week, so
  // the count is a floor ("48+"), never an invented total.
  function teamPulse(items = [], { now = Date.now(), me = null, limit = GALLERY_LIMIT } = {}) {
    const list = (Array.isArray(items) ? items : []).map(item => ({ ...item, t: Date.parse(item.exportedAt || '') })).filter(item => Number.isFinite(item.t) && item.t <= now + 60000);
    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const start = dayStart(now, -i);
      days.push({ start, end: dayStart(now, -i + 1), count: 0, today: i === 0, label: new Date(start).toLocaleDateString('en-US', { weekday: 'short' }) });
    }
    const weekStart = days[0].start;
    const week = list.filter(item => item.t >= weekStart);
    week.forEach(item => { const day = days.find(d => item.t >= d.start && item.t < d.end); if (day) day.count += 1; });
    const tally = key => [...week.reduce((map, item) => { const k = String(key(item) || '').trim(); if (k) map.set(k, (map.get(k) || 0) + 1); return map; }, new Map())]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const people = tally(item => item.creator);
    const myDays = new Set(list.filter(item => isMe(item.creator, me)).map(item => dayStart(item.t)));
    let cursor = dayStart(now);
    if (!myDays.has(cursor)) cursor = dayStart(now, -1);
    let streak = 0;
    while (myDays.has(cursor)) { streak += 1; cursor = dayStart(cursor, -1); }
    const oldest = list.length ? Math.min(...list.map(item => item.t)) : now;
    return {
      total: week.length,
      atLeast: list.length >= limit && oldest >= weekStart,
      today: days[6].count,
      days,
      formats: tally(item => item.variant).slice(0, 3),
      people: people.slice(0, 3),
      peopleCount: people.length,
      mine: me ? week.filter(item => isMe(item.creator, me)).length : 0,
      streak,
    };
  }

  // "Continue where you left off" across tools, newest first.
  //   local: FrameUpDesigns.listLocal() records (thumbnails, open in place)
  //   cloud: frameup_drafts rows (the 'editor' row is work in progress)
  //   reels: Reels Studio projects in this browser
  function continueItems({ local = [], cloud = [], reels = [], now = Date.now() } = {}, n = 6) {
    const out = [];
    const localIds = new Set();
    (Array.isArray(local) ? local : []).forEach(record => {
      if (!record || !record.id) return;
      localIds.add(String(record.id));
      out.push({ key: `local:${record.id}`, kind: 'local', id: String(record.id), tool: 'editor', workspace: record.workspace || '', title: record.title || 'Untitled design', at: Number(record.savedAt) || 0, thumb: String(record.thumb || ''), meta: WORKSPACE_LABELS[record.workspace] || 'Editor' });
    });
    (Array.isArray(cloud) ? cloud : []).forEach(row => {
      if (!row) return;
      const key = String(row.draft_key || '');
      if (key.startsWith('design:') && localIds.has(key.slice(7))) return;
      const editor = key === 'editor';
      out.push({ key: `cloud:${key}`, kind: editor ? 'cloud-editor' : 'cloud', tool: 'editor', workspace: row.workspace || '', title: editor ? 'Work in progress' : (row.title || 'Untitled design'), at: Date.parse(row.updated_at || '') || 0, thumb: '', meta: `${WORKSPACE_LABELS[row.workspace] || 'Editor'}${editor ? ' · autosaved' : ''}` });
    });
    (Array.isArray(reels) ? reels : []).forEach(project => {
      if (!project || !project.id) return;
      const secs = Math.round((Number(project.timeline && project.timeline.durationMs) || 0) / 1000);
      out.push({ key: `reel:${project.id}`, kind: 'reel', tool: 'reels', workspace: '', title: project.title || 'Untitled reel', at: Number(project.updatedAt) || 0, thumb: '', meta: ['Reels Studio', project.status === 'exported' ? 'Exported' : 'Draft', secs ? `${secs} s` : ''].filter(Boolean).join(' · ') });
    });
    return out.filter(item => item.at > 0 && item.at <= now + 60000).sort((a, b) => b.at - a.at).slice(0, n);
  }

  // One-line "continue" hints for the four tool launchers.
  function toolHints({ briefs = [], reels = [], videoDefaults = null, recent = [], now = Date.now() } = {}) {
    const clip = (text, max = 44) => { const s = String(text || '').replace(/\s+/g, ' ').trim(); return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s; };
    const hints = {};
    const brief = (Array.isArray(briefs) ? briefs : []).find(item => typeof item === 'string' && item.trim());
    if (brief) hints.generate = { text: `Last brief: ${clip(brief)}` };
    const reel = (Array.isArray(reels) ? reels : []).filter(p => p && p.status !== 'exported').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if (reel) hints.reels = { text: `Continue: ${clip(reel.title || 'Untitled reel')}`, meta: timeAgo(reel.updatedAt, now) };
    const brand = BRAND_LABELS[videoDefaults && videoDefaults.last];
    if (brand) hints.video = { text: `Last newsletter: ${brand}` };
    const editor = (Array.isArray(recent) ? recent : []).find(item => item.tool === 'editor');
    if (editor) hints.editor = { text: `Continue: ${clip(editor.title)}`, meta: timeAgo(editor.at, now), workspace: editor.workspace };
    return hints;
  }

  // The line under the greeting, from real counts only.
  function summaryLine({ trends = 0, today = 0, inProgress = 0 } = {}) {
    const parts = [];
    if (trends) parts.push(`${trends} ${trends === 1 ? 'story' : 'stories'} trending`);
    if (today) parts.push(`${today} ${today === 1 ? 'post' : 'posts'} shipped by the team today`);
    if (inProgress) parts.push(`${inProgress} ${inProgress === 1 ? 'thing' : 'things'} to pick up`);
    return parts.length ? parts.join(' · ') : 'What’s hot, what you were making and what the team shipped.';
  }

  // ─── Browser ───────────────────────────────────────────────────────────
  function install(win) {
    const doc = win.document;
    const L = () => win.TrendsLogic || BundledLogic;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const isHome = () => { const hash = win.location.hash.replace('#', ''); return !hash || hash === 'frames'; };
    const svg = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    // Lucide icons (ISC licence).
    const ICON = {
      post: svg('<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>'),
      reel: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'),
      video: svg('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'),
      editor: svg('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>'),
      flame: svg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
      rising: svg('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
      refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
      arrow: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
    };
    const TOOL_TILE = { editor: ['es-tile--blue', ICON.editor], reels: ['es-tile--pink', ICON.reel], video: ['es-tile--cyan', ICON.video], generate: ['es-tile--blue', ICON.post] };
    let started = false;
    let trendData = null;
    let user = null;
    const counts = { trends: 0, today: 0, inProgress: 0 };
    let recentItems = [];
    let localRecords = [];

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
    const readLocal = (key, fallback) => { try { return JSON.parse(win.localStorage.getItem(key) || 'null') ?? fallback; } catch (error) { return fallback; } };
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
    const line = (w = 70) => `<span class="es-skeleton home-today__sk" style="width:${w}%"></span>`;
    const SKELETONS = {
      spotlight: () => `<div class="home-today__spot-grid" aria-hidden="true"><div class="home-today__spot-text">${line(30)}<span class="es-skeleton home-today__sk home-today__sk--title"></span><span class="es-skeleton home-today__sk home-today__sk--title" style="width:72%"></span>${line(45)}<div class="home-today__spot-actions"><span class="es-skeleton home-today__sk home-today__sk--btn"></span><span class="es-skeleton home-today__sk home-today__sk--btn"></span><span class="es-skeleton home-today__sk home-today__sk--btn"></span></div></div><span class="es-skeleton home-today__spot-media"></span></div>`,
      trends: () => `<ul class="home-today__trends" aria-hidden="true">${`<li class="home-today__trend is-skeleton"><span class="home-today__trend-text">${line(28)}${line(92)}${line(64)}</span></li>`.repeat(5)}</ul>`,
      continue: () => `<ul class="home-today__list" aria-hidden="true">${`<li><span class="home-today__item is-skeleton"><span class="es-skeleton home-today__thumb"></span><span class="home-today__item-text">${line(80)}${line(45)}</span></span></li>`.repeat(4)}</ul>`,
      exports: () => `<ul class="home-today__shots" aria-hidden="true">${`<li><span class="home-today__shot-link"><span class="es-skeleton home-today__shot"></span><span class="home-today__shot-cap">${line(80)}${line(50)}</span></span></li>`.repeat(SHOTS)}</ul>`,
      pulse: () => `<div class="home-today__pulse-sk" aria-hidden="true"><span class="es-skeleton home-today__sk home-today__sk--num"></span>${line(70)}<div class="home-today__bars">${'<span class="home-today__bar"><i class="es-skeleton" style="height:60%"></i></span>'.repeat(7)}</div>${line(90)}${line(75)}${line(82)}</div>`,
      requests: () => `<ul class="home-today__list" aria-hidden="true">${`<li><span class="home-today__item is-skeleton"><span class="home-today__item-text">${line(75)}${line(40)}</span></span></li>`.repeat(3)}</ul>`,
    };
    const empty = (title, copy, action = '') => `<div class="home-today__empty"><p><strong>${esc(title)}</strong>${esc(copy)}</p>${action}</div>`;
    const failed = (what, retry) => `<div class="home-today__empty is-error" role="status"><p><strong>Couldn’t load ${esc(what)}</strong>Check your connection, then try again.</p><button type="button" class="es-btn es-btn--sm es-btn--secondary" data-today-retry="${esc(retry)}">${ICON.refresh}<span>Try again</span></button></div>`;
    function setBusy(id, busy) { body(id)?.setAttribute('aria-busy', String(busy)); }
    function paintSummary() {
      const el = doc.querySelector('[data-today-summary]');
      if (el) el.textContent = summaryLine(counts);
    }

    // ── Trends (free, cached on the server too) ──────────────────────────
    async function loadTrends() {
      return cached('trends', async () => {
        try {
          const response = await win.fetch('/api/trend-design', { headers: { Accept: 'application/json' } });
          if (!response.ok) return { ok: false };
          const data = await response.json();
          const items = (data.items || []).slice(0, 80).map(item => ({
            id: item.id, title: item.title, category: item.category, type: item.type, traffic: item.traffic || '', source: item.source || '',
            url: item.url || '', image: item.image || '', publishedAt: item.publishedAt || '', coverage: item.coverage || 1, rank: item.rank || 0,
            signal: item.signal || null, fit: item.fit || null, team: item.team || null, template: item.template ? { id: item.template.id, label: item.template.label } : null,
            storyline: item.storyline ? { id: item.storyline.id, size: item.storyline.size, lead: item.storyline.lead } : null,
            related: (item.related || []).slice(0, 3).map(r => ({ title: r.title, url: r.url, source: r.source })),
          }));
          return { ok: true, items, categories: data.categories || [], brands: data.brands || [], updatedAt: data.updatedAt || '' };
        } catch (error) { return { ok: false }; }
      });
    }
    function sportLabel(id) {
      if (id === 'others') return 'Other sports';
      return trendData?.categories?.find(c => c.id === id)?.label || L()?.SHORT?.[id] || '';
    }
    // What goes INTO a brief: only the story's own reason (the AI 'why' line when
    // the feed has one). whyNow() is our coverage stats ("4 stories · 6 outlets"):
    // fine to show on Home, never material for a design.
    const storyWhy = item => String(item?.ai?.why || item?.why || '').trim();
    const why = item => { try { return L()?.whyNow?.(item, trendData?.brands?.length ? { brands: trendData.brands } : {}) || ''; } catch (error) { return ''; } };
    function signalBadge(item) {
      if (item.signal === 'hot') return `<span class="home-today__signal is-hot" title="Big search volume or many outlets on this story right now">${ICON.flame}Hot</span>`;
      if (item.signal === 'rising') return `<span class="home-today__signal is-rising" title="More outlets or searches than an hour ago">${ICON.rising}Rising</span>`;
      return '';
    }
    const ageLabel = item => (L()?.ago ? L().ago(item.publishedAt) : timeAgo(item.publishedAt));
    // Post / Reel / Ad: the same hand-offs as the Trends board.
    function actions(item, { size = 'sm', primary = false, labels = 'short' } = {}) {
      const label = sportLabel(item.category);
      const logic = L();
      const words = labels === 'long' ? ['Make a post', 'Make a reel', 'Video ad'] : ['Post', 'Reel', 'Ad'];
      const reasons = why(item);
      const reel = logic?.reelHandoff?.(item, { why: reasons });
      const video = AD_SPORTS.includes(item.category) ? logic?.videoHandoff?.(item, { why: reasons }) : null;
      const btn = (kind, href, icon, text, aria, extra = '') => `<a class="es-btn es-btn--${size} ${kind}" href="${esc(href)}" aria-label="${esc(aria)}"${extra}>${icon}<span>${esc(text)}</span></a>`;
      return [
        btn(primary ? 'es-btn--primary' : 'es-btn--secondary', trendHref(item, label, { logic, why: storyWhy(item) }), ICON.post, words[0], `${labels === 'long' ? 'Make a post' : 'Post'} about: ${item.title}`, ` data-today-handoff="post" data-today-trend="${esc(item.id)}"`),
        reel ? btn(primary ? 'es-btn--secondary' : 'es-btn--tertiary', reel.url, ICON.reel, words[1], `Make a reel about: ${item.title}`, ` data-today-handoff="reel" data-today-trend="${esc(item.id)}"`) : '',
        video ? btn(primary ? 'es-btn--secondary' : 'es-btn--tertiary', video.url, ICON.video, words[2], `Make a video ad about: ${item.title}`, ` data-today-handoff="video" data-today-trend="${esc(item.id)}"`) : '',
      ].join('');
    }
    function storeHandoff(link) {
      const item = trendData?.items?.find(i => i.id === link.dataset.todayTrend);
      const logic = L();
      if (!item || !logic) return;
      const kind = link.dataset.todayHandoff;
      // Post: the trend itself rides beside the brief link (Generate reads it for ?trend=<id>).
      if (kind === 'post' && !logic.designHandoff) return;
      const handoff = kind === 'post'
        ? logic.designHandoff(item, { why: storyWhy(item), brief: new URL(link.href, win.location.href).searchParams.get('brief') || '' })
        : kind === 'video' ? logic.videoHandoff(item, { why: storyWhy(item) }) : logic.reelHandoff(item, { why: storyWhy(item) });
      try { win.sessionStorage.setItem(handoff.key, JSON.stringify(handoff.payload)); } catch (error) { /* the URL carries the story too */ }
    }
    const storyLink = (item, cls = '') => (item.url
      ? `<a class="${cls}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" title="${esc(item.title)}">${esc(item.title)}<span class="es-sr-only"> (opens the story in a new tab)</span></a>`
      : `<span class="${cls}">${esc(item.title)}</span>`);

    function renderSpotlight(spot) {
      const target = body('spotlight');
      if (!target) return;
      if (!trendData?.ok) { target.innerHTML = failed('the top story', 'trends'); return; }
      if (!spot) {
        target.innerHTML = empty('Nothing trending yet', 'Google has no fresh US sports stories right now. Start from your own brief instead.', '<a class="es-btn es-btn--sm es-btn--secondary" href="generate.html">Write a brief</a>');
        return;
      }
      const whyText = why(spot);
      const template = spot.template?.label ? `<span class="home-today__hint">Best as a <strong>${esc(spot.template.label)}</strong> post</span>` : '';
      const media = spot.image ? `<span class="home-today__spot-media"><img src="${esc(spot.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>` : '';
      target.innerHTML = `<div class="home-today__spot-grid${media ? '' : ' no-media'}">
        <div class="home-today__spot-text">
          <p class="home-today__meta"><span class="home-today__sport">${esc(sportLabel(spot.category) || 'Sports')}</span>${signalBadge(spot)}<time datetime="${esc(spot.publishedAt)}">${esc(ageLabel(spot))}</time>${spot.source ? `<span>${esc(spot.source)}</span>` : ''}</p>
          <p class="home-today__spot-title">${storyLink(spot)}</p>
          ${whyText || template ? `<p class="home-today__why">${whyText ? `<span>${esc(whyText)}</span>` : ''}${template}</p>` : ''}
          <div class="home-today__spot-actions">${actions(spot, { size: 'md', primary: true, labels: 'long' })}</div>
        </div>${media}</div>`;
      target.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.closest('.home-today__spot-media')?.remove(); target.querySelector('.home-today__spot-grid')?.classList.add('no-media'); }, { once: true }));
    }

    function renderTrends() {
      const target = body('trends');
      if (!target) return;
      // No stories at all (or trends down): the top-story card says it once;
      // the Trending now card steps aside instead of repeating it (UX audit R7).
      const trendsCard = card('trends');
      if (!trendData?.ok) { if (trendsCard) trendsCard.hidden = true; target.innerHTML = ''; renderSpotlight(null); return; }
      let sport = 'all';
      try { sport = win.localStorage.getItem(SPORT_KEY) || 'all'; } catch (error) { /* ignore */ }
      const cats = (trendData.categories || []).filter(c => trendData.items.some(item => item.category === c.id));
      if (sport !== 'all' && !cats.some(c => c.id === sport)) sport = 'all';
      const plan = planTrends(trendData.items, sport, { n: 5, logic: L() });
      renderSpotlight(plan.spotlight);
      if (trendsCard) trendsCard.hidden = !plan.spotlight && !plan.rows.length;
      counts.trends = trendData.items.length;
      paintSummary();
      const chips = cats.length ? `<div class="home-today__chips" role="group" aria-label="Sport">${[{ id: 'all', label: 'All sports' }, ...cats].map(c => `<button type="button" class="es-chip" data-today-sport="${esc(c.id)}" aria-pressed="${c.id === sport}">${esc(c.id === 'others' ? 'Other sports' : c.label)}</button>`).join('')}</div>` : '';
      const rows = plan.rows.length
        ? `<ol class="home-today__trends">${plan.rows.map(item => {
          const reach = (item.coverage || 1) > 1 ? `<span>${item.coverage} outlets</span>` : (item.type === 'search' && item.traffic ? `<span>${esc(item.traffic)} searches</span>` : '');
          return `<li class="home-today__trend">
            <span class="home-today__trend-text">
              <span class="home-today__meta"><span class="home-today__sport">${esc(sportLabel(item.category) || 'Sports')}</span>${signalBadge(item)}<time datetime="${esc(item.publishedAt)}">${esc(ageLabel(item))}</time>${reach}</span>
              ${storyLink(item, 'home-today__trend-title')}
            </span>
            <span class="home-today__trend-actions" role="group" aria-label="Make from this story">${actions(item)}</span>
          </li>`;
        }).join('')}</ol>`
        : !plan.spotlight ? empty('No sports trends right now', 'Google had nothing new for US sports fans. Check back in a few minutes.')
          : empty(sport === 'all' ? 'Nothing else trending' : 'Quiet right now', sport === 'all' ? 'The top story is above. More stories land through the day.' : 'No more fresh stories for this sport. Try All sports.');
      const stamp = `<p class="home-today__foot"><span>${trendData.updatedAt ? `Updated ${esc(timeAgo(trendData.updatedAt))} · ` : ''}Google Trends and News, US</span><a class="home-today__more" href="generate.html?view=trends">All trends${ICON.arrow}</a></p>`;
      target.innerHTML = chips + rows + stamp;
    }

    // ── My open requests (only when requests are switched on) ────────────
    async function loadRequests(person) {
      return cached('requests', async () => {
        const sb = client();
        if (!sb || !person) return { ok: true, rows: [], signedOut: !person };
        const { data, error } = await sb.from('es_designer_tasks')
          .select('id,source_id,title,status,assigned_to,requester_email,creator_email,design_due_at,updated_at')
          .eq('task_type', 'design_request')
          .in('status', OPEN)
          .or(`requester_email.eq.${person.email},creator_email.eq.${person.email},assigned_to.eq.${person.email}`)
          .order('updated_at', { ascending: false })
          .limit(12);
        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true, rows: data || [] };
      });
    }
    function renderRequests(result, person) {
      const target = body('requests');
      if (!target) return;
      if (!result?.ok) { target.innerHTML = failed('your requests', 'requests'); return; }
      const rows = sortRequests(result.rows).slice(0, 4);
      if (!rows.length) { target.innerHTML = empty('Nothing open', 'Need a design from the team? Send one clear brief.', '<a class="es-btn es-btn--sm es-btn--secondary" href="design-request.html">Request a design</a>'); return; }
      target.innerHTML = `<ul class="home-today__list">${rows.map(row => {
        const due = dueLabel(row.design_due_at);
        const mineToDo = person && String(row.assigned_to || '').toLowerCase() === person.email;
        const id = row.source_id || String(row.id || '').replace(/^task-request-/, '');
        return `<li><a class="home-today__item" href="requests.html?id=${encodeURIComponent(id)}"><span class="home-today__item-text"><strong>${esc(row.title || 'Design request')}</strong><small>${esc(mineToDo ? 'Assigned to you' : 'You asked')}${due ? ` · <span class="${due === 'Overdue' ? 'is-overdue' : ''}">${esc(due)}</span>` : ''}</small></span><span class="es-badge">${esc(STATUS_LABELS[row.status] || row.status)}</span></a></li>`;
      }).join('')}</ul>`;
    }

    // ── Gallery: Team exports + This week (one read) ─────────────────────
    async function loadExports() {
      return cached('exports', async () => {
        const data = win.ESDashboardData;
        if (!data?.fetchGalleryExports) return { ok: true, items: [] };
        try {
          const { items } = await data.fetchGalleryExports({ limit: GALLERY_LIMIT });
          // A small inline preview is the fallback when a post has no Storage thumbnail.
          const list = (items || []).slice(0, GALLERY_LIMIT).map((item, index) => ({ id: item.id, title: item.title, creator: item.creator, variant: item.variant, exportedAt: item.exportedAt, preview: index < SHOTS && String(item.previewDataUrl || '').length < 60000 ? item.previewDataUrl || '' : '' }));
          let thumbs = {};
          try { thumbs = (await data.fetchGalleryThumbs?.(list.slice(0, SHOTS).map(item => item.id))) || {}; } catch (error) { thumbs = {}; }
          // Signed thumbnail links last far longer than this cache.
          return { ok: true, items: list, thumbs };
        } catch (error) { return { ok: false }; }
      });
    }
    const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';
    const shortName = name => { const parts = String(name || '').trim().split(/\s+/).filter(Boolean); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || ''; };
    function renderExports(result) {
      const target = body('exports');
      if (!target) return;
      if (!result?.ok) { target.innerHTML = failed('team exports', 'exports'); return; }
      if (!result.items.length) {
        target.innerHTML = empty('No exports yet', 'Posts the team exports show up here and in the Gallery.', '<a class="es-btn es-btn--sm es-btn--secondary" href="index.html#instagram">Create a post</a>');
        return;
      }
      const thumbs = result.thumbs || {};
      target.innerHTML = `<ul class="home-today__shots">${result.items.slice(0, SHOTS).map(item => {
        const src = thumbs[item.id] || item.preview;
        const when = timeAgo(item.exportedAt);
        const who = isMe(item.creator, user) ? 'You' : shortName(item.creator);
        return `<li><a class="home-today__shot-link" href="gallery.html?q=${encodeURIComponent(item.title || '')}" aria-label="${esc([item.title, item.variant, item.creator ? `by ${item.creator}` : '', when].filter(Boolean).join(', '))}">
          <span class="home-today__shot">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : `<span class="home-today__shot-name">${esc(item.variant || 'Post')}</span>`}${item.variant ? `<span class="home-today__shot-tag">${esc(item.variant)}</span>` : ''}</span>
          <span class="home-today__shot-cap"><strong>${esc(item.title || 'Untitled post')}</strong><small>${esc([who, when].filter(Boolean).join(' · '))}</small></span>
        </a></li>`;
      }).join('')}</ul>`;
      target.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
        const tile = doc.createElement('span');
        tile.className = 'home-today__shot-name';
        tile.textContent = 'Post';
        img.replaceWith(tile);
      }, { once: true }));
    }
    function renderPulse(result, person) {
      const target = body('pulse');
      if (!target) return;
      if (!result?.ok) { target.innerHTML = failed('this week', 'exports'); return; }
      const p = teamPulse(result.items, { me: person });
      counts.today = p.today;
      paintSummary();
      if (!p.total) {
        target.innerHTML = empty('A quiet week so far', 'Social posts the team exports are counted here.', '<a class="es-btn es-btn--sm es-btn--secondary" href="generate.html">Make the first one</a>');
        return;
      }
      const max = Math.max(1, ...p.days.map(d => d.count));
      const dayText = d => `${d.today ? 'Today' : d.label}: ${d.count} ${d.count === 1 ? 'post' : 'posts'}`;
      const bars = p.days.map(d => `<span class="home-today__bar${d.today ? ' is-today' : ''}" style="--h:${d.count ? Math.max(8, Math.round((d.count / max) * 100)) : 3}%" data-tip="${esc(dayText(d))}" tabindex="0" role="img" aria-label="${esc(dayText(d))}"><i></i><small aria-hidden="true">${esc(d.today ? 'Today' : d.label.slice(0, 2))}</small></span>`).join('');
      const maxFormat = Math.max(1, ...p.formats.map(f => f.count));
      const formats = p.formats.length ? `<div class="home-today__rank"><h4>Top formats</h4><ul>${p.formats.map(f => `<li><span>${esc(f.label)}</span><span class="home-today__meter" aria-hidden="true"><i style="width:${Math.round((f.count / maxFormat) * 100)}%"></i></span><b>${f.count}</b></li>`).join('')}</ul></div>` : '';
      const people = p.people.length ? `<div class="home-today__rank"><h4>Most active</h4><ul class="home-today__people">${p.people.map(entry => { const mine = isMe(entry.label, person); return `<li${mine ? ' class="is-me"' : ''}><span class="home-today__avatar" aria-hidden="true">${esc(initials(entry.label))}</span><span>${esc(mine ? `${entry.label} (you)` : entry.label)}</span><b>${entry.count}</b></li>`; }).join('')}</ul></div>` : '';
      const mine = person ? `<p class="home-today__mine">${p.mine
        ? `<strong>You: ${p.mine} ${p.mine === 1 ? 'post' : 'posts'}</strong>${p.streak > 1 ? `<span>${p.streak}-day streak</span>` : ''}`
        : '<strong>Nothing from you yet this week</strong><span>The top story is a good start.</span>'}</p>` : '';
      target.innerHTML = `<div class="home-today__stat"><span class="home-today__num">${p.total}${p.atLeast ? '+' : ''}</span><span class="home-today__num-label">${p.total === 1 ? 'post' : 'posts'} exported in the last 7 days<small>by ${p.peopleCount} ${p.peopleCount === 1 ? 'person' : 'people'}${p.today ? ` · ${p.today} today` : ''}</small></span></div>
        <div class="home-today__bars" role="group" aria-label="Exports per day, last 7 days">${bars}</div>
        ${mine}${formats}${people}`;
    }

    // ── Continue where you left off ──────────────────────────────────────
    async function loadDrafts(person) {
      return cached('drafts', async () => {
        const sb = client();
        if (!sb || !person) return { ok: true, rows: [] };
        let query = sb.from('frameup_drafts').select('draft_key,kind,workspace,title,updated_at');
        if (person.id) query = query.eq('owner_id', person.id);
        const { data, error } = await query.order('updated_at', { ascending: false }).limit(6);
        // Table not created yet: same as no drafts.
        if (error) return /does not exist|could not find|schema cache/i.test(String(error.message || '')) ? { ok: true, rows: [], missing: true } : { ok: false };
        return { ok: true, rows: data || [] };
      });
    }
    async function loadLocalDesigns() {
      try { return (await win.FrameUpDesigns?.listLocal?.()) || []; } catch (error) { return []; }
    }
    function renderContinue(result) {
      const target = body('continue');
      if (!target) return;
      const reels = readLocal(KEYS.reels, []);
      recentItems = continueItems({ local: localRecords, cloud: result?.ok ? result.rows : [], reels: Array.isArray(reels) ? reels : [] });
      counts.inProgress = recentItems.length;
      paintSummary();
      renderToolHints();
      if (!result?.ok && !recentItems.length) { target.innerHTML = failed('your drafts', 'drafts'); return; }
      if (!recentItems.length) {
        target.innerHTML = empty('Nothing in progress', 'Designs you export, drafts on your account and reels you start show up here.', '<a class="es-btn es-btn--sm es-btn--secondary" href="index.html#instagram">Open the editor</a>');
        return;
      }
      target.innerHTML = `<ul class="home-today__list">${recentItems.map((item, index) => {
        const [tone, icon] = TOOL_TILE[item.tool] || TOOL_TILE.editor;
        const thumb = item.thumb ? `<span class="home-today__thumb"><img src="${esc(item.thumb)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="home-today__thumb es-tile ${tone}" aria-hidden="true">${icon}</span>`;
        const text = `<span class="home-today__item-text"><strong>${esc(item.title)}</strong><small>${esc([item.meta, timeAgo(item.at)].filter(Boolean).join(' · '))}</small></span>`;
        if (item.kind === 'reel') return `<li><a class="home-today__item" href="reel-maker.html">${thumb}${text}</a></li>`;
        if (item.kind === 'cloud-editor') return `<li><a class="home-today__item" href="index.html#${esc(item.workspace || 'instagram')}">${thumb}${text}</a></li>`;
        return `<li><button type="button" class="home-today__item" data-today-open="${index}">${thumb}${text}</button></li>`;
      }).join('')}</ul>${win.FrameUpDesigns?.showRecentDesigns ? `<p class="home-today__foot"><span>This browser and your account</span><button type="button" class="home-today__more" data-today-drafts>All recent designs${ICON.arrow}</button></p>` : ''}`;
      target.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
    }
    async function openItem(item) {
      if (item.kind === 'local') {
        const record = localRecords.find(r => String(r.id) === item.id);
        const A = win.FrameUpAutosave;
        if (record && win.FrameUpDesigns?.openDesign && A?.dbGet) {
          try { await win.FrameUpDesigns.openDesign(record.payload, imageId => A.dbGet('images', imageId), { title: record.title, source: 'device' }); } catch (error) {
            if (typeof win.showToast === 'function') win.showToast(error?.message || 'This design could not be opened.', 'error');
          }
          return;
        }
      }
      // Account drafts open from the Recent designs dialog (it knows how to load them).
      win.FrameUpDesigns?.showRecentDesigns?.();
    }

    // ── Tool launchers: continue hints from this browser ─────────────────
    function renderToolHints() {
      const hints = toolHints({ briefs: readLocal(KEYS.briefs, []), reels: readLocal(KEYS.reels, []), videoDefaults: readLocal(KEYS.videoDefaults, null), recent: recentItems });
      doc.querySelectorAll('[data-today-tool]').forEach(tool => {
        const hint = hints[tool.dataset.todayTool];
        const small = tool.querySelector('small');
        if (!small) return;
        if (!small.dataset.default) small.dataset.default = small.textContent;
        small.textContent = hint ? [hint.text, hint.meta].filter(Boolean).join(' · ') : small.dataset.default;
        tool.classList.toggle('has-hint', Boolean(hint));
        if (tool.dataset.todayTool === 'editor') tool.setAttribute('href', `index.html#${hint?.workspace || 'instagram'}`);
      });
    }

    async function run(which) {
      user = await me();
      const hello = doc.getElementById('home-today-title');
      if (hello) { const name = firstName(user?.name, user?.email); hello.textContent = name ? `${greeting()}, ${name}` : greeting(); }
      const jobs = {
        trends: async () => { setBusy('trends', true); setBusy('spotlight', true); trendData = await loadTrends(); renderTrends(); setBusy('trends', false); setBusy('spotlight', false); },
        requests: async () => { if (win.FrameUpFeatures?.requests !== true) return; card('requests')?.removeAttribute('hidden'); setBusy('requests', true); renderRequests(await loadRequests(user), user); setBusy('requests', false); },
        exports: async () => { setBusy('exports', true); setBusy('pulse', true); const result = await loadExports(); renderExports(result); renderPulse(result, user); setBusy('exports', false); setBusy('pulse', false); },
        drafts: async () => { setBusy('continue', true); const [result, local] = await Promise.all([loadDrafts(user), loadLocalDesigns()]); localRecords = local; renderContinue(result); setBusy('continue', false); },
      };
      const names = which ? [which] : Object.keys(jobs);
      await Promise.all(names.map(name => jobs[name]().catch(() => {
        (JOB_CARDS[name] || [name]).forEach(id => { const target = body(id); if (target) target.innerHTML = failed(id === 'continue' ? 'your drafts' : id === 'pulse' ? 'this week' : id, name); setBusy(id, false); });
      })));
    }

    function start() {
      const section = doc.getElementById('home-today');
      if (!section || !isHome()) return;
      const title = doc.getElementById('home-today-title');
      if (title && !started) title.textContent = greeting();
      renderToolHints();
      if (started) { run(); return; } // cached: no network unless stale
      started = true;
      Object.keys(SKELETONS).forEach(id => { const target = body(id); if (target && !target.innerHTML.trim()) target.innerHTML = SKELETONS[id](); });
      section.addEventListener('click', event => {
        const sport = event.target.closest('[data-today-sport]');
        if (sport) {
          try { win.localStorage.setItem(SPORT_KEY, sport.dataset.todaySport); } catch (error) { /* per browser */ }
          renderTrends();
          section.querySelector(`[data-today-sport="${CSS.escape(sport.dataset.todaySport)}"]`)?.focus();
          return;
        }
        const handoff = event.target.closest('[data-today-handoff]');
        if (handoff) {
          storeHandoff(handoff);
          const item = trendData?.items?.find(i => i.id === handoff.dataset.todayTrend);
          win.FrameUpTrack?.track?.('open', { tool: 'home', action: `trend-${handoff.dataset.todayHandoff || 'post'}`, label: item?.title || '' });
          return;
        }
        const retry = event.target.closest('[data-today-retry]');
        if (retry) {
          const job = retry.dataset.todayRetry;
          try { win.sessionStorage.removeItem(CACHE_PREFIX + job); } catch (error) { /* ignore */ }
          (JOB_CARDS[job] || [job]).forEach(id => { const target = body(id); if (target && SKELETONS[id]) target.innerHTML = SKELETONS[id](); });
          run(job);
          return;
        }
        const open = event.target.closest('[data-today-open]');
        if (open) { const item = recentItems[Number(open.dataset.todayOpen)]; if (item) openItem(item); return; }
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

  return { greeting, firstName, pickTrends, planTrends, trendHref, dueLabel, sortRequests, timeAgo, isMe, teamPulse, continueItems, toolHints, summaryLine, install };
}));
