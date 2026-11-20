// FrameUp usage tracking: one call for everything people take from FrameUp.
//
//   FrameUpTrack.track(category, { tool, action, label, meta })
//
//   category  export | download | copy | share | open | generate (CATEGORIES)
//   tool      social | youtube | newsletter | generate | video-ads | reels |
//             reels-studio | image-pool | gallery | trends | requests | home |
//             design-system | other (TOOLS; anything else is stored as "other")
//   action    short slug: png, jpg, zip, mp4, srt, link, headline, html...
//   label     short title (design headline or file name), 160 characters max
//   meta      small extras (template, size, count, format...)
//
// Never blocks or breaks the action it records: track() returns at once, never
// throws, and sends rows in batches (1.5 s after the last call, or 20 at once)
// to public.frameup_usage_events with the signed-in user's own session
// (supabase/migrations/20261125120000_frameup_usage_events.sql).
//
// Rows wait in localStorage (200 max, 14 days) while signed out, offline or
// before that migration has run, and go up on a later page load. Each row has
// its own id, so a retried batch is never counted twice.
//
// Privacy: no image data, no form contents, and no emails in labels or meta
// (removed). The table row carries the signed-in person's email, as every
// other dashboard table does.
//
// Pages inside an iframe (Generate's hidden editor) do not log: the page that
// owns the button does, so nothing is counted twice.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document && !window.FrameUpTrack) {
    try { window.FrameUpTrack = api.install(window); } catch (error) { /* tracking is optional */ }
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const TABLE = 'frameup_usage_events';
  const QUEUE_KEY = 'frameup.usage.pending.v1';

  const CATEGORIES = Object.freeze({
    export: 'Exports',
    download: 'Downloads',
    copy: 'Copies',
    share: 'Links shared',
    open: 'Opened in a tool',
    generate: 'Generated',
  });

  const TOOLS = Object.freeze({
    social: 'Social Media',
    youtube: 'YouTube',
    newsletter: 'Newsletter',
    generate: 'Generate',
    'video-ads': 'Video Ads',
    reels: 'Reel Captions',
    'reels-studio': 'Reels Studio',
    'image-pool': 'ES Image Pool',
    gallery: 'Gallery',
    trends: 'Trends',
    requests: 'Design Requests',
    home: 'Home',
    'design-system': 'UI Library',
    other: 'Other',
  });

  // Editor workspace labels (recordDesignExport) to tools.
  const WORKSPACE_TOOLS = {
    'social media': 'social', instagram: 'social', social: 'social',
    youtube: 'youtube',
    newsletter: 'newsletter',
    'reel captions': 'reels', reels: 'reels',
  };

  function toolForWorkspace(workspace) {
    return WORKSPACE_TOOLS[String(workspace || '').trim().toLowerCase()] || 'other';
  }

  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const DATA_URL = /\b(?:data|blob):[^\s"'<>]*/gi;

  function cleanText(value, max) {
    return String(value == null ? '' : value)
      .replace(DATA_URL, '')
      .replace(EMAIL, '[email]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  }

  function slug(value, fallback = '') {
    const out = String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return out || fallback;
  }

  // Small, flat, no emails, no image data; 12 keys, 2 KB at most.
  function cleanMeta(meta) {
    const out = {};
    if (!meta || typeof meta !== 'object') return out;
    for (const [rawKey, value] of Object.entries(meta)) {
      if (Object.keys(out).length >= 12) break;
      const key = String(rawKey).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32);
      if (!key || value == null || value === '') continue;
      if (typeof value === 'number') { if (Number.isFinite(value)) out[key] = Math.round(value * 100) / 100; }
      else if (typeof value === 'boolean') out[key] = value;
      else if (Array.isArray(value)) out[key] = value.slice(0, 6).map(item => cleanText(item, 80)).filter(Boolean);
      else if (typeof value === 'string') { const text = cleanText(value, 120); if (text) out[key] = text; }
    }
    while (JSON.stringify(out).length > 1800) delete out[Object.keys(out).pop()];
    return out;
  }

  function makeId() {
    try { if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID(); } catch (error) { /* fall through */ }
    const hex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
  }

  // One row, or null when the category is not in the taxonomy.
  function normalize(category, details = {}, context = {}) {
    const cat = String(category || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(CATEGORIES, cat)) return null;
    const d = details && typeof details === 'object' ? details : {};
    const toolKey = String(d.tool || context.tool || '').trim().toLowerCase();
    const tool = Object.prototype.hasOwnProperty.call(TOOLS, toolKey) ? toolKey : 'other';
    const now = typeof context.now === 'function' ? context.now() : Date.now();
    return {
      id: makeId(),
      created_at: new Date(now).toISOString(),
      category: cat,
      tool,
      action: slug(d.action, cat),
      label: cleanText(d.label, 160),
      page: cleanText(context.page || '', 60),
      session_id: cleanText(context.sessionId || '', 64),
      device: ['desktop', 'mobile'].includes(context.device) ? context.device : '',
      meta: cleanMeta(d.meta),
    };
  }

  const isMissing = error => /does not exist|could not find|schema cache|PGRST20[25]|42P01|42883/i.test(`${error?.code || ''} ${error?.message || ''}`);
  // A row the database refuses (check / type error): retrying cannot help.
  const isRejected = error => /^(23|22)\d{3}$/.test(String(error?.code || '')) || /violates check constraint|invalid input/i.test(String(error?.message || ''));

  function createTracker(options = {}) {
    const {
      getClient = async () => null,
      storage = null,
      now = () => Date.now(),
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancel = id => clearTimeout(id),
      enabled = true,
      page = '',
      device = '',
      sessionId = '',
      flushDelay = 1500,
      maxBatch = 20,
      maxQueue = 200,
      maxAgeMs = 14 * 86400000,
      warn = () => {},
    } = options;

    const status = { table: 'unknown', sent: 0, dropped: 0, lastError: '' };
    let queue = [];
    let timer = null;
    let inFlight = null;
    let addedDuringFlush = false;
    const warned = new Set();

    function load() {
      if (!storage) return;
      try {
        const saved = JSON.parse(storage.getItem(QUEUE_KEY) || '[]');
        if (Array.isArray(saved)) queue = saved.filter(row => row && row.id && row.category).concat(queue);
      } catch (error) { /* corrupt or blocked storage: start empty */ }
      prune();
    }

    function save() {
      if (!storage) return;
      try {
        if (queue.length) storage.setItem(QUEUE_KEY, JSON.stringify(queue));
        else storage.removeItem(QUEUE_KEY);
      } catch (error) { /* full or private mode: keep in memory */ }
    }

    function prune() {
      const oldest = now() - maxAgeMs;
      const seen = new Set();
      const before = queue.length;
      queue = queue.filter(row => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return Date.parse(row.created_at) >= oldest;
      });
      if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
      status.dropped += before - queue.length;
    }

    function scheduleFlush(ms) {
      if (timer != null) cancel(timer);
      timer = schedule(() => { timer = null; return flush(); }, ms);
    }

    function track(category, details = {}) {
      try {
        if (!enabled) return null;
        const row = normalize(category, details, { now, page, device, sessionId });
        if (!row) {
          const key = String(category);
          if (!warned.has(key)) { warned.add(key); warn(`[track] unknown category "${key}"; use one of ${Object.keys(CATEGORIES).join(', ')}`); }
          return null;
        }
        queue.push(row);
        if (inFlight) addedDuringFlush = true;
        prune();
        save();
        if (status.table !== 'missing') scheduleFlush(queue.length >= maxBatch ? 0 : flushDelay);
        return row;
      } catch (error) {
        return null;
      }
    }

    async function runFlush() {
      if (!queue.length || status.table === 'missing') return 0;
      let ctx = null;
      try { ctx = await getClient(); } catch (error) { ctx = null; }
      if (!ctx?.client || !ctx.email) return 0;
      let sent = 0;
      while (queue.length) {
        const batch = queue.slice(0, maxBatch);
        let error = null;
        try {
          const result = await ctx.client.from(TABLE).upsert(
            batch.map(row => ({ ...row, user_email: ctx.email })),
            { onConflict: 'id', ignoreDuplicates: true },
          );
          error = result?.error || null;
        } catch (thrown) {
          error = thrown || new Error('Network error');
        }
        if (error) {
          status.lastError = String(error.message || error.code || error).slice(0, 200);
          if (isMissing(error)) { status.table = 'missing'; break; }
          if (isRejected(error)) {
            const ids = new Set(batch.map(row => row.id));
            queue = queue.filter(row => !ids.has(row.id));
            status.dropped += batch.length;
            save();
            continue;
          }
          scheduleFlush(30000);
          break;
        }
        status.table = 'ready';
        const ids = new Set(batch.map(row => row.id));
        queue = queue.filter(row => !ids.has(row.id));
        sent += batch.length;
        status.sent += batch.length;
        save();
      }
      return sent;
    }

    function flush() {
      if (inFlight) return inFlight;
      addedDuringFlush = false;
      inFlight = runFlush().catch(() => 0).finally(() => {
        inFlight = null;
        // A take logged while this send was finishing gets its own send.
        if (addedDuringFlush && queue.length && status.table !== 'missing' && timer == null) scheduleFlush(flushDelay);
      });
      return inFlight;
    }

    load();

    return {
      track,
      flush,
      pending: () => queue.slice(),
      status: () => ({ ...status, queued: queue.length }),
    };
  }

  function detectPage(loc) {
    const path = String(loc?.pathname || '').toLowerCase();
    const file = path.split('/').pop() || 'index.html';
    return file.replace(/\.html$/, '') || 'index';
  }

  function install(win) {
    const isTop = (() => { try { return win.top === win; } catch (error) { return false; } })();
    let storage = null;
    try { storage = win.localStorage; } catch (error) { storage = null; }
    const device = (() => {
      try { return win.matchMedia('(max-width: 900px) and (pointer: coarse)').matches ? 'mobile' : 'desktop'; } catch (error) { return ''; }
    })();
    const sessionId = (() => {
      try { return win.crypto.randomUUID().slice(0, 18); } catch (error) { return `s${Date.now().toString(36)}`; }
    })();

    async function getClient() {
      const auth = win.ESAuth;
      if (!auth) return null;
      if (auth.ensureSupabaseReady && !(await auth.ensureSupabaseReady())) return null;
      const client = auth.getSupabaseClient?.();
      if (!client?.auth) return null;
      const session = (await client.auth.getSession())?.data?.session;
      const email = String(session?.user?.email || '').toLowerCase();
      return email ? { client, email } : null;
    }

    const tracker = createTracker({
      getClient,
      storage: isTop ? storage : null,
      enabled: isTop,
      page: detectPage(win.location),
      device,
      sessionId,
      warn: message => { try { win.console?.warn?.(message); } catch (error) { /* ignore */ } },
    });

    if (isTop) {
      win.addEventListener?.('es:auth-ready', () => { tracker.flush(); }, { once: true });
      setTimeout(() => { tracker.flush(); }, 4000);
      win.addEventListener?.('pagehide', () => { tracker.flush(); });
    }

    return Object.freeze({
      CATEGORIES,
      TOOLS,
      toolForWorkspace,
      track: tracker.track,
      flush: tracker.flush,
      pending: tracker.pending,
      status: tracker.status,
    });
  }

  return { CATEGORIES, TOOLS, TABLE, QUEUE_KEY, toolForWorkspace, normalize, cleanMeta, cleanText, createTracker, install };
}));
