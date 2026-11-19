// FrameUp AI mode: one client helper for the weekly AI budget ("free mode").
//
// Policy (owner, 2026-11-20, testing phase): $20 per person and $45 for the
// team each week (the Vercel AI Gateway stops at $50). Over a budget FrameUp
// runs in free mode: every tool keeps working on its no-AI path and the
// server's replies say { ok: true, mode: 'free', reason, notice }.
//
// What this file does, on every page that loads it:
//   * FrameUpAI.status()   reads /api/ai-status once (cached 60 s in memory and
//                          sessionStorage) -> { mode, reason, userLimitUsd, ... }
//   * FrameUpAI.mode       'ai' | 'free' | 'unknown'; FrameUpAI.onChange(fn)
//   * <html data-ai-mode="free"> so pages and CSS can badge AI buttons
//     (elements marked [data-ai-only] get a "Free mode" look and a tooltip).
//   * One friendly note (role="status") at the top of the page in free mode,
//     the same words everywhere, dismissible for the session.
//   * Watches FrameUp's own /api/* replies: a reply with mode 'free' switches
//     the page to free mode. A reply that was skipped because it needs the AI
//     ({ mode: 'free', skipped: true }) reaches the page's code as a 503 with
//     the friendly note as its error, so older code paths show the note
//     instead of a raw error and keep their existing fallbacks.
// Never blocks a request; if /api/ai-status can't be read the mode stays
// 'unknown' and nothing changes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) {
    window.FrameUpAI = api;
    api.install(window);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const STATUS_URL = '/api/ai-status';
  const CACHE_KEY = 'frameup.aiStatus.v1';
  const CACHE_MS = 60 * 1000;
  const DISMISS_KEY = 'frameup.aiFreeNote.dismissed.v1';
  const NOTES = {
    user: "You've used this week's AI budget, so FrameUp is in free mode. AI features come back Monday.",
    team: "The team's AI budget for this week is used up, so FrameUp is in free mode. AI features come back Monday.",
  };
  const FREE_REASONS = ['user-limit', 'team-limit', 'gateway-budget'];
  const noteFor = reason => (reason === 'user-limit' ? NOTES.user : NOTES.team);

  let win = null;
  let state = { mode: 'unknown', reason: null, status: null };
  let cache = null; // { at, data }
  let inflight = null;
  const listeners = new Set();
  let clock = () => Date.now();

  function emit() {
    if (win?.document?.documentElement) {
      win.document.documentElement.dataset.aiMode = state.mode;
      if (state.reason) win.document.documentElement.dataset.aiFreeReason = state.reason;
      else delete win.document.documentElement.dataset.aiFreeReason;
    }
    listeners.forEach(fn => { try { fn({ ...state }); } catch (error) { /* a listener must not break the others */ } });
    renderNote();
  }

  function setState(next) {
    const changed = next.mode !== state.mode || next.reason !== state.reason;
    state = { ...state, ...next };
    if (changed) emit();
  }

  function readStored() {
    try {
      const stored = JSON.parse(win?.sessionStorage?.getItem(CACHE_KEY) || 'null');
      if (stored && clock() - stored.at < CACHE_MS) return stored;
    } catch (error) { /* storage blocked */ }
    return null;
  }

  function writeStored(entry) {
    try { win?.sessionStorage?.setItem(CACHE_KEY, JSON.stringify(entry)); } catch (error) { /* storage blocked */ }
  }

  function applyStatus(data) {
    if (!data || data.ok === false) return;
    const free = data.mode === 'free' && FREE_REASONS.includes(data.reason);
    setState({ mode: free ? 'free' : 'ai', reason: free ? data.reason : null, status: data });
  }

  // GET /api/ai-status, at most once a minute per tab (force skips the cache).
  async function status({ force = false } = {}) {
    if (!force) {
      if (cache && clock() - cache.at < CACHE_MS) return cache.data;
      const stored = readStored();
      if (stored) { cache = stored; applyStatus(stored.data); return stored.data; }
    }
    if (inflight) return inflight;
    const fetcher = win?.ESAuth?.fetchWithAuth ? (url, init) => win.ESAuth.fetchWithAuth(url, init) : null;
    if (!fetcher) return cache?.data || null; // not signed in yet
    inflight = (async () => {
      try {
        const response = await fetcher(STATUS_URL, { headers: { Accept: 'application/json' } });
        if (!response.ok) return cache?.data || null;
        const data = await response.json();
        cache = { at: clock(), data };
        writeStored(cache);
        applyStatus(data);
        return data;
      } catch (error) {
        return cache?.data || null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  // A reply said free mode (or a page knows it): switch now, no extra request.
  function markFree(reason) {
    const why = FREE_REASONS.includes(reason) ? reason : 'team-limit';
    if (cache?.data) {
      cache = { at: cache.at, data: { ...cache.data, mode: 'free', reason: why } };
      writeStored(cache);
    }
    setState({ mode: 'free', reason: why });
  }

  // ─── The note ────────────────────────────────────────────────────────────
  const STYLE_ID = 'frameup-ai-mode-style';
  const NOTE_ID = 'frameup-ai-free-note';
  const CSS = `
.fu-ai-note{box-sizing:border-box;display:flex;align-items:flex-start;gap:var(--es-space-3,12px);margin:0 0 var(--es-space-4,16px);padding:var(--es-space-3,12px) var(--es-space-4,16px);border:1px solid var(--es-brand-tint,#b5d8fd);border-radius:var(--es-radius-control,12px);background:var(--es-brand-soft,#e8f2ff);color:var(--es-ink,#0e1014);font:400 14px/20px var(--es-font-ui,Roboto,sans-serif)}
.fu-ai-note[hidden]{display:none}
.fu-ai-note__icon{flex:0 0 auto;width:20px;height:20px;color:var(--es-brand-text,#0a62c7)}
.fu-ai-note__text{flex:1 1 auto;min-width:0;margin:0}
.fu-ai-note__text strong{font-weight:600}
.fu-ai-note__close{flex:0 0 auto;display:inline-grid;place-items:center;width:32px;height:32px;margin:-6px -8px -6px 0;border:0;border-radius:var(--es-radius-chip,10px);background:transparent;color:var(--es-ink-2,#3b414b);cursor:pointer}
.fu-ai-note__close:hover{background:rgb(var(--es-brand-rgb,10 125 250) / .12)}
.fu-ai-note__close:focus-visible{outline:var(--es-focus-outline,2px solid #0a6fde);outline-offset:var(--es-focus-offset,2px)}
.fu-ai-note--inset{margin:var(--es-space-4,16px) var(--es-page-gutter,32px) 0}
@media (max-width:767px){.fu-ai-note--inset{margin:var(--es-space-3,12px) var(--es-page-gutter-phone,16px) 0}}
.fu-ai-note--floating{position:fixed;left:50%;bottom:var(--es-space-4,16px);z-index:60;width:min(640px,calc(100vw - 32px));margin:0;transform:translateX(-50%);box-shadow:var(--es-shadow-float,0 12px 32px -12px rgb(14 16 20 / .22))}
html[data-theme="dark"] .fu-ai-note{border-color:rgb(10 125 250 / .45);background:#16263d;color:#fff}
html[data-theme="dark"] .fu-ai-note__icon{color:#7cb8ff}
html[data-theme="dark"] .fu-ai-note__close{color:#bfc8d9}
html[data-ai-mode="free"] [data-ai-only]{position:relative;opacity:.55;cursor:not-allowed}
html[data-ai-mode="free"] [data-ai-badge]::after{content:"Free mode";display:inline-block;margin-left:var(--es-space-2,8px);padding:1px 6px;border-radius:var(--es-radius-pill,999px);background:var(--es-sunk,#f0f2f5);color:var(--es-ink-2,#3b414b);font:600 11px/16px var(--es-font-ui,Roboto,sans-serif);vertical-align:middle}
html[data-theme="dark"][data-ai-mode="free"] [data-ai-badge]::after{background:#2a2d34;color:#bfc8d9}
.es-usage[data-free="true"] .es-usage__fill{background:var(--es-brand-fill,#0a6fde)}
.es-usage__team{color:var(--es-ink-3,#5d6470);font-size:12px;line-height:14px;font-variant-numeric:tabular-nums}
@media (max-width:599px){.fu-ai-note{font-size:13px;line-height:18px}}
@media (prefers-reduced-motion:reduce){.fu-ai-note__close{transition:none}}
`;

  function dismissedReason() {
    try { return win?.sessionStorage?.getItem(DISMISS_KEY) || ''; } catch (error) { return ''; }
  }

  function noteHost(doc) {
    return doc.querySelector('[data-ai-note-slot]')
      || doc.querySelector('main')
      || doc.querySelector('.es-main, .app-main, #app, .page');
  }

  function renderNote() {
    const doc = win?.document;
    if (!doc?.body) return;
    let note = doc.getElementById(NOTE_ID);
    const show = state.mode === 'free' && dismissedReason() !== state.reason;
    if (!show) {
      if (note) note.hidden = true;
      if (state.mode !== 'free') restoreAiOnly();
      return;
    }
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
    if (!note) {
      note = doc.createElement('div');
      note.id = NOTE_ID;
      note.className = 'fu-ai-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.innerHTML = `<svg class="fu-ai-note__icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5M10 6.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><p class="fu-ai-note__text"></p><button type="button" class="fu-ai-note__close" aria-label="Hide this note"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`;
      note.querySelector('.fu-ai-note__close').addEventListener('click', () => {
        try { win.sessionStorage.setItem(DISMISS_KEY, state.reason || ''); } catch (error) { /* storage blocked */ }
        note.hidden = true;
      });
      const host = noteHost(doc);
      if (host) {
        host.insertBefore(note, host.firstChild);
        // A host with no side padding (full-bleed main): keep the page gutter.
        try { if (parseFloat(win.getComputedStyle(host).paddingLeft) < 8) note.classList.add('fu-ai-note--inset'); } catch (error) { /* no layout */ }
      }
      else { note.classList.add('fu-ai-note--floating'); doc.body.appendChild(note); }
    }
    note.querySelector('.fu-ai-note__text').textContent = noteFor(state.reason);
    note.hidden = false;
    // AI-only controls: a plain-English tooltip on why they rest this week.
    doc.querySelectorAll('[data-ai-only]').forEach(el => {
      if (!el.dataset.aiTitle) el.dataset.aiTitle = el.getAttribute('title') || '';
      el.setAttribute('title', noteFor(state.reason));
      el.setAttribute('aria-disabled', 'true');
    });
  }

  function restoreAiOnly() {
    win?.document?.querySelectorAll?.('[data-ai-only][aria-disabled="true"]').forEach(el => {
      el.removeAttribute('aria-disabled');
      if (el.dataset.aiTitle) el.setAttribute('title', el.dataset.aiTitle); else el.removeAttribute('title');
    });
  }

  // ─── Reply watcher ───────────────────────────────────────────────────────
  function isOwnApi(input, base) {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url || String(input), base);
      return url.origin === new URL(base).origin && url.pathname.startsWith('/api/') && url.pathname !== STATUS_URL;
    } catch (error) {
      return false;
    }
  }

  // Reads a reply (a clone) and returns what the page should get.
  async function adaptResponse(response, Res = (typeof Response !== 'undefined' ? Response : null)) {
    if (!response || !/json/i.test(response.headers?.get?.('content-type') || '')) return response;
    let data;
    try { data = await response.clone().json(); } catch (error) { return response; }
    if (!data || data.mode !== 'free') return response;
    markFree(data.reason);
    if (!data.skipped || !Res) return response;
    const notice = data.notice || noteFor(data.reason);
    const body = JSON.stringify({ ...data, ok: false, error: notice, title: 'Free mode this week' });
    return new Res(body, { status: 503, statusText: 'Free mode', headers: { 'Content-Type': 'application/json', 'X-FrameUp-AI-Mode': 'free' } });
  }

  function install(w) {
    if (!w || w.__frameupAiMode) return;
    w.__frameupAiMode = true;
    win = w;
    const native = typeof w.fetch === 'function' ? w.fetch.bind(w) : null;
    if (native) {
      w.fetch = async function frameupAiFetch(input, init) {
        const response = await native(input, init);
        if (!isOwnApi(input, w.location?.href || 'http://localhost/')) return response;
        try { return await adaptResponse(response); } catch (error) { return response; }
      };
    }
    const start = () => { status().catch(() => {}); };
    w.addEventListener?.('es:auth-ready', start);
    w.document?.addEventListener?.('visibilitychange', () => { if (w.document.visibilityState === 'visible') start(); });
    if (w.document?.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', () => { renderNote(); start(); });
    else { renderNote(); start(); }
  }

  return {
    install,
    status,
    markFree,
    noteFor,
    adaptResponse,
    isOwnApi,
    NOTES,
    FREE_REASONS,
    CACHE_MS,
    get mode() { return state.mode; },
    get reason() { return state.reason; },
    get notice() { return state.mode === 'free' ? noteFor(state.reason) : ''; },
    get isFree() { return state.mode === 'free'; },
    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // Tests: a fake window/clock and a clean slate.
    _test: {
      reset(w = null, now = null) {
        win = w; state = { mode: 'unknown', reason: null, status: null }; cache = null; inflight = null; listeners.clear();
        clock = typeof now === 'function' ? now : () => Date.now();
      },
      restoreAiOnly,
    },
  };
}));
