// FrameUp "Design from a brief": the brief box in the Social Media, Newsletter
// and YouTube editors (and ⌘K "Design from brief").
//
//   Brief   "Describe what you need…": words, an ES article link, X post
//           links, or the person's own photo (attach, drop or paste).
//   Match   /api/brief-design: the rules shortlist, then one Haiku call picks
//           the template (one-line reason) and fills three options.
//   Fill    every field within its limits, facts only from the brief, the link
//           or ES data; the photo is theirs, else a checked ES photo.
//   Check   ES brand nudges, text fit, safe zone, pill contrast (in the
//           editor, frameup-brief-apply.js); one automatic repair, the rest
//           become small notes.
//   Ready   the best option opens in the editor as ONE undo step; the three
//           options show as live thumbnails (best first); a small bar offers
//           Try another template, Rewrite (shorter / punchier / formal), Swap
//           photo and Export.
//   Learn   a usage row when a brief design opens ('brief-design') and when it
//           is exported ('brief-export', kept or changed); the server folds
//           the team's acceptance per template into the matcher.
//
// Feature flag: on by default; ?brief=off|on or localStorage
// 'frameup.brief.v1' = 'off'|'on' overrides it for one browser. Off = nothing
// is added to the page. This file loads frameup-brief-core.js and
// frameup-brief-apply.js itself, with its own ?v= cache key.
(() => {
  'use strict';

  const SCRIPT = document.currentScript;
  const SRC = SCRIPT?.src || '';
  const VERSION = (SRC.match(/[?&]v=([^&#]+)/) || [])[1] || 'dev';
  const BASE = SRC ? SRC.replace(/frameup-brief\.js(?:[?#].*)?$/, '') : '';
  const IN_FRAME = window.top !== window;

  function load(name) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = `${BASE}${name}?v=${VERSION}`;
      tag.async = false;
      tag.onload = () => resolve();
      tag.onerror = () => reject(new Error(`${name} did not load`));
      document.head.appendChild(tag);
    });
  }

  // ─── Feature flag ─────────────────────────────────────────────────────────
  const FLAG_KEY = 'frameup.brief.v1';
  const DEFAULT_ON = true;
  function enabled() {
    try {
      const param = new URLSearchParams(location.search).get('brief');
      if (param === 'off' || param === 'on') return param === 'on';
      const saved = localStorage.getItem(FLAG_KEY);
      if (saved === 'off' || saved === 'on') return saved === 'on';
    } catch (error) { /* storage blocked: the default */ }
    return DEFAULT_ON;
  }

  // Flag off: nothing loads. The renderer frame only needs the appliers.
  if (!IN_FRAME && !enabled()) return;
  const libs = Promise.all([load('frameup-brief-core.js'), load('frameup-brief-apply.js')]);
  if (IN_FRAME) return;

  const API = '/api/brief-design';
  const TOOLS = { instagram: 'social', newsletter: 'newsletter', youtube: 'youtube' };
  const EDITORS = new Set(Object.keys(TOOLS));
  const Core = () => window.FrameUpBriefCore;
  const Apply = () => window.FrameUpBriefApply;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const page = () => document.body?.dataset.currentPage || '';

  const ICON = {
    spark: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    swap: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h13l-3-3M20 17H7l3 3"/></svg>',
    pen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    grid: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    code: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  };

  // ─── Pure helpers (also used by tests through window.FrameUpBrief) ───────
  // The steps shown while the request runs (the server does them in one go).
  const STEPS = ['Reading your brief', 'Picking a template', 'Writing it', 'Checking the design'];
  const STEP_AT_MS = [0, 1200, 2600];
  function noteList({ notes = [], warnings = [], fixed = [], left = [], notice = '' } = {}) {
    const out = [];
    if (notice) out.push({ tone: 'info', text: notice });
    if (fixed.length) {
      const names = { 'text-fit': 'text size', contrast: 'colour contrast', 'safe-zone': 'safe zone', 'banned-words': 'wording' };
      out.push({ tone: 'good', text: `Fixed automatically: ${[...new Set(fixed.map(rule => names[rule] || rule))].join(', ')}.` });
    }
    left.forEach(issue => out.push({ tone: 'warn', text: issue.text }));
    warnings.forEach(text => out.push({ tone: 'info', text }));
    notes.forEach(text => out.push({ tone: 'info', text }));
    const seen = new Set();
    return out.filter(item => item.text && !seen.has(item.text) && seen.add(item.text)).slice(0, 3);
  }
  // A colour option per option: a template repeated in a later option gets the
  // brand's next pair, so the three thumbnails differ.
  function paletteFor(options, index) {
    const template = options[index]?.template;
    const before = options.slice(0, index).filter(option => option.template === template).length;
    return before % 3;
  }

  // ─── Own photo: read, downscale (max 1600 px), keep as a data URL ────────
  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('That file is not an image.')); return; }
      if (file.size > 25 * 1024 * 1024) { reject(new Error('That image is too large (25 MB max).')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ url: canvas.toDataURL('image/jpeg', 0.9), title: file.name ? file.name.replace(/\.[a-z0-9]+$/i, '') : 'Your photo', own: true });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  }

  // ─── Network ──────────────────────────────────────────────────────────────
  // Server text is shown only when it is a plain sentence meant for people
  // (limits, switched off, nothing to design); never an internal error.
  const FRIENDLY = 'The design service had a problem. Try again in a moment.';
  const RAW = /\b(?:error|exception|undefined|null|stack|TypeError|ReferenceError|SyntaxError|at\s+\S+\s*\(|ECONN|fetch failed|Internal)\b/i;
  function friendlyMessage(status, data) {
    const text = String((data && (data.notice && data.skipped ? data.notice : data.error)) || '').trim();
    if (status === 429) return text && !RAW.test(text) ? text : 'Too many designs this hour. Take a short break and try again.';
    if (text && !RAW.test(text) && text.length <= 200 && (status < 500 || data?.reason === 'feature-off' || data?.skipped)) return text;
    return FRIENDLY;
  }
  async function post(body, signal) {
    const doFetch = window.ESAuth?.fetchWithAuth || fetch;
    let response;
    try {
      response = await doFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), signal });
    } catch (cause) {
      if (cause?.name === 'AbortError') throw cause;
      // Offline / network failure: the page can still design without AI.
      throw Object.assign(new Error(FRIENDLY), { status: 0, fallback: true });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.skipped) {
      const error = new Error(friendlyMessage(response.status, data));
      error.status = response.status;
      error.reason = data.reason || (data.skipped ? 'free' : '');
      // A server failure (not a limit, not a switch, not "nothing to design")
      // falls back to designing from the brief's own words.
      error.fallback = (response.status >= 500 && !['feature-off', 'off', 'limit-unknown'].includes(error.reason) && !data.skipped) || response.status === 0;
      throw error;
    }
    return data;
  }

  // ─── The renderer: the editor in a hidden frame, for thumbnails ──────────
  let rendererFor = '';
  let rendererPromise = null;
  function renderer(workspace) {
    if (rendererPromise && rendererFor === workspace) return rendererPromise;
    document.querySelector('iframe.fu-brief-renderer')?.remove();
    rendererFor = workspace;
    rendererPromise = new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.className = 'fu-brief-renderer';
      frame.title = 'Design preview renderer';
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;left:-12000px;top:0;width:1280px;height:900px;border:0;visibility:hidden;pointer-events:none;';
      frame.src = `index.html?embed=brief#${workspace}`;
      const timer = setTimeout(() => reject(new Error('The preview renderer took too long to load.')), 45000);
      frame.addEventListener('load', async () => {
        try {
          for (let i = 0; i < 150 && !(frame.contentWindow.FrameUpBriefApply && frame.contentWindow.FrameUpSpec); i += 1) await new Promise(r => setTimeout(r, 100));
          const api = frame.contentWindow.FrameUpBriefApply;
          if (!api) throw new Error('The preview renderer is unavailable.');
          // Ready without switching editors (Social's own ready opens Social).
          await api.editorReady();
          clearTimeout(timer);
          resolve(api);
        } catch (error) {
          clearTimeout(timer);
          reject(error);
        }
      }, { once: true });
      document.body.appendChild(frame);
    });
    rendererPromise.catch(() => { rendererPromise = null; rendererFor = ''; });
    return rendererPromise;
  }

  // ─── One undo step ────────────────────────────────────────────────────────
  // History records a snapshot after edits settle; while a brief design opens
  // it is paused, then one snapshot is taken, so Undo returns to what was there.
  async function asOneStep(task) {
    try { flushPendingTextChange(); } catch (error) { /* nothing pending */ }
    try { recordDesignHistoryNow(); } catch (error) { /* history unavailable */ }
    let paused = false;
    try { clearTimeout(historySettleTimer); isApplyingHistory = true; paused = true; } catch (error) { paused = false; }
    try {
      return await task();
    } finally {
      if (paused) { try { clearTimeout(historySettleTimer); isApplyingHistory = false; } catch (error) { /* ignore */ } }
      try { recordDesignHistoryNow(); } catch (error) { /* history unavailable */ }
    }
  }

  // ─── Learning loop ────────────────────────────────────────────────────────
  let applied = null; // { ws, place, template, rank, baseline, at, brief, engine, viaSpec }
  let lastExportLog = 0;
  function track(action, meta, label) {
    try { window.FrameUpTrack?.track?.('generate', { tool: TOOLS[meta.ws] || 'other', action, label, meta }); } catch (error) { /* tracking never blocks */ }
  }
  function originNow() {
    if (!applied) return null;
    const A = Apply();
    if (!A) return null;
    let place = '';
    try { place = A.placeKey(); } catch (error) { return null; }
    if (place !== applied.place || Date.now() - applied.at > 3 * 60 * 60 * 1000) {
      // Not the brief design: never let it pass for a Generate design either.
      return applied.viaSpec ? { value: null } : null;
    }
    const now = A.currentText();
    const result = Core().outcome(applied.baseline, now, { template: applied.template, nowTemplate: A.currentTemplate() });
    // dashboard-data asks twice per export: log once.
    if (Date.now() - lastExportLog > 4000) {
      lastExportLog = Date.now();
      track('brief-export', { from: 'brief', ws: applied.ws, template: applied.template, rank: applied.rank, kept: result.kept, changed: result.changed, switched: result.switched, engine: applied.engine }, applied.label);
    }
    return {
      value: {
        source: 'brief',
        brief: applied.brief.slice(0, 600),
        postType: applied.ws === 'instagram' ? applied.template : '',
        workspace: applied.ws,
        template: applied.template,
        rank: applied.rank,
        aiText: applied.baseline.slice(0, 6).map(line => line.slice(0, 120)),
        kept: result.kept,
        changed: result.changed,
      },
    };
  }

  // ─── UI ───────────────────────────────────────────────────────────────────
  let root = null;
  let els = {};
  let ownPhoto = null;
  let session = null;
  let running = null; // AbortController
  let stepTimers = [];

  function build() {
    const section = document.createElement('section');
    section.className = 'fu-brief';
    section.setAttribute('aria-label', 'Design from a brief');
    section.innerHTML = `
      <form class="fu-brief__bar" novalidate>
        <span class="fu-brief__spark" aria-hidden="true">${ICON.spark}</span>
        <textarea id="fu-brief-input" class="fu-brief__input" rows="1" maxlength="1500" placeholder="Describe what you need…" aria-label="Describe what you need" aria-describedby="fu-brief-hint" autocomplete="off" spellcheck="true"></textarea>
        <span id="fu-brief-hint" hidden>Type a headline or story, paste an article or X post link, or add your own photo. Press Enter to design.</span>
        <button type="button" class="fu-brief__icon" data-brief="attach" aria-label="Add your own photo" title="Add your own photo">${ICON.image}</button>
        <input type="file" accept="image/*" class="fu-brief__file" tabindex="-1" aria-hidden="true" hidden>
        <button type="submit" class="fu-brief__go" data-brief="go" aria-label="Design it">${ICON.arrow}<span class="fu-brief__go-text">Design</span></button>
      </form>
      <div class="fu-brief__chip" hidden>
        <img alt="" class="fu-brief__chip-img">
        <span class="fu-brief__chip-text">Your photo</span>
        <button type="button" class="fu-brief__chip-x" data-brief="unattach" aria-label="Remove your photo">${ICON.close}</button>
      </div>
      <div class="fu-brief__panel" hidden>
        <div class="fu-brief__progress" hidden>
          <span class="fu-brief__spinner" aria-hidden="true"></span>
          <span class="fu-brief__step"></span>
          <button type="button" class="fu-brief__link" data-brief="cancel">Cancel</button>
        </div>
        <div class="fu-brief__error" role="alert" hidden>
          <span class="fu-brief__error-text"></span>
          <button type="button" class="fu-brief__link" data-brief="retry">Try again</button>
        </div>
        <div class="fu-brief__result" hidden>
          <div class="fu-brief__head">
            <p class="fu-brief__why"></p>
            <button type="button" class="fu-brief__x" data-brief="close" aria-label="Close the brief results">${ICON.close}</button>
          </div>
          <div class="fu-brief__opts" role="radiogroup" aria-label="Design options, best first"></div>
          <div class="fu-brief__actions" role="toolbar" aria-label="Brief design actions">
            <button type="button" class="fu-brief__act" data-brief="another" aria-label="Try another template" title="Try another template">${ICON.grid}<span class="fu-brief__act-text">Try another</span></button>
            <div class="fu-brief__menu-wrap">
              <button type="button" class="fu-brief__act" data-brief="rewrite" aria-haspopup="menu" aria-expanded="false" aria-label="Rewrite text" title="Rewrite text">${ICON.pen}<span class="fu-brief__act-text">Rewrite</span>${ICON.chevron}</button>
              <div class="fu-brief__menu" role="menu" hidden>
                <button type="button" role="menuitem" data-how="shorter">Shorter</button>
                <button type="button" role="menuitem" data-how="punchier">Punchier</button>
                <button type="button" role="menuitem" data-how="formal">More formal</button>
              </div>
            </div>
            <button type="button" class="fu-brief__act" data-brief="swap" aria-label="Swap photo">${ICON.swap}<span class="fu-brief__act-text">Swap photo</span></button>
            <button type="button" class="fu-brief__act" data-brief="export" aria-label="Export" title="Export">${ICON.download}<span class="fu-brief__act-text">Export</span></button>
            <button type="button" class="fu-brief__act" data-brief="restore" aria-label="Restore what was there" title="Undo doesn't cover HTML widgets: this puts back what was there" hidden>${ICON.undo}<span class="fu-brief__act-text">Restore</span></button>
          </div>
          <ul class="fu-brief__notes"></ul>
        </div>
      </div>
      <p class="fu-brief__sr" role="status" aria-live="polite"></p>`;
    const q = selector => section.querySelector(selector);
    els = {
      form: q('.fu-brief__bar'), input: q('.fu-brief__input'), file: q('.fu-brief__file'), go: q('[data-brief="go"]'),
      chip: q('.fu-brief__chip'), chipImg: q('.fu-brief__chip-img'), chipText: q('.fu-brief__chip-text'),
      panel: q('.fu-brief__panel'), progress: q('.fu-brief__progress'), step: q('.fu-brief__step'),
      error: q('.fu-brief__error'), errorText: q('.fu-brief__error-text'), retry: q('[data-brief="retry"]'),
      result: q('.fu-brief__result'), why: q('.fu-brief__why'), opts: q('.fu-brief__opts'), notes: q('.fu-brief__notes'),
      rewrite: q('[data-brief="rewrite"]'), menu: q('.fu-brief__menu'), swap: q('[data-brief="swap"]'), another: q('[data-brief="another"]'),
      exportBtn: q('[data-brief="export"]'), restoreBtn: q('[data-brief="restore"]'), live: q('[role="status"]'),
    };
    wire(section);
    return section;
  }

  function announce(text) {
    if (!els.live) return;
    els.live.textContent = '';
    clearTimeout(announce.timer);
    setTimeout(() => { els.live.textContent = text; }, 30);
    // Read once, then cleared (no stale text left in the page).
    announce.timer = setTimeout(() => { if (els.live.textContent === text) els.live.textContent = ''; }, 6000);
  }
  function refit() {
    // The editor sizes the canvas to the free space (resize listener).
    window.dispatchEvent(new Event('resize'));
  }
  function autoGrow() {
    const input = els.input;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }
  function showPanel(part) {
    els.panel.hidden = !part;
    ['progress', 'error', 'result'].forEach(name => { els[name].hidden = name !== part; });
    root.classList.toggle('is-open', Boolean(part));
    refit();
  }

  function setOwnPhoto(photo) {
    ownPhoto = photo;
    els.chip.hidden = !photo;
    if (photo) {
      els.chipImg.src = photo.url;
      els.chipText.textContent = 'Your photo';
    } else {
      els.chipImg.removeAttribute('src');
    }
    refit();
  }
  async function takeFile(file) {
    try {
      setOwnPhoto(await readPhoto(file));
      announce('Your photo is attached. It will be used on the design.');
    } catch (error) {
      window.showToast?.(error.message, 'error');
    }
  }

  function wire(section) {
    els.form.addEventListener('submit', event => { event.preventDefault(); run(); });
    els.input.addEventListener('input', autoGrow);
    // One line when you're not typing in it, so the canvas keeps its room.
    els.input.addEventListener('blur', () => { els.input.style.height = ''; els.input.scrollTop = 0; refit(); });
    els.input.addEventListener('focus', () => { autoGrow(); refit(); });
    els.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); run(); }
      else if (event.key === 'Escape') { event.preventDefault(); if (!els.panel.hidden && !running) closePanel(); else els.input.blur(); }
    });
    els.input.addEventListener('focus', () => { const ws = page(); if (EDITORS.has(ws)) renderer(ws).catch(() => {}); }, { once: false });
    els.input.addEventListener('paste', event => {
      const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith('image/'));
      if (file) { event.preventDefault(); takeFile(file); }
    });
    section.addEventListener('dragover', event => { if ([...(event.dataTransfer?.items || [])].some(i => i.kind === 'file')) { event.preventDefault(); root.classList.add('is-drop'); } });
    section.addEventListener('dragleave', () => root.classList.remove('is-drop'));
    section.addEventListener('drop', event => {
      const file = [...(event.dataTransfer?.files || [])].find(item => item.type.startsWith('image/'));
      root.classList.remove('is-drop');
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      takeFile(file);
    });
    els.file.addEventListener('change', () => { const file = els.file.files?.[0]; els.file.value = ''; if (file) takeFile(file); });
    section.addEventListener('click', event => {
      const button = event.target.closest('[data-brief], [data-how], [data-option]');
      if (!button || !section.contains(button)) return;
      if (button.dataset.how) { closeMenu(); rewrite(button.dataset.how); return; }
      if (button.dataset.option != null) { pick(Number(button.dataset.option)); return; }
      switch (button.dataset.brief) {
        case 'attach': els.file.click(); break;
        case 'unattach': setOwnPhoto(null); els.input.focus(); break;
        case 'cancel': cancel(); break;
        case 'retry': run(); break;
        case 'close': closePanel(); break;
        case 'another': another(); break;
        case 'rewrite': toggleMenu(); break;
        case 'swap': swapPhoto(); break;
        case 'export': exportNow(); break;
        case 'restore': restoreWidget(); break;
        default: break;
      }
    });
    els.opts.addEventListener('keydown', event => {
      const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (!(event.key in keys) || !session) return;
      event.preventDefault();
      const next = (session.current + keys[event.key] + session.options.length) % session.options.length;
      pick(next).then(() => els.opts.querySelector(`[data-option="${next}"]`)?.focus());
    });
    document.addEventListener('click', event => { if (!event.target.closest?.('.fu-brief__menu-wrap')) closeMenu(); });
    els.menu.addEventListener('keydown', event => {
      const items = [...els.menu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length].focus(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
      else if (event.key === 'Escape') { event.preventDefault(); closeMenu(); els.rewrite.focus(); }
    });
  }

  function toggleMenu() {
    const open = els.menu.hidden;
    els.menu.hidden = !open;
    els.rewrite.setAttribute('aria-expanded', String(open));
    if (open) els.menu.querySelector('[role="menuitem"]')?.focus();
  }
  function closeMenu() {
    if (!els.menu || els.menu.hidden) return;
    els.menu.hidden = true;
    els.rewrite.setAttribute('aria-expanded', 'false');
  }

  function setSteps(on) {
    stepTimers.forEach(clearTimeout);
    stepTimers = [];
    if (!on) return;
    STEP_AT_MS.forEach((ms, i) => stepTimers.push(setTimeout(() => { els.step.textContent = `${STEPS[i]}…`; }, ms)));
  }
  function setBusy(busy) {
    root.classList.toggle('is-busy', busy);
    els.go.disabled = busy;
    els.input.setAttribute('aria-busy', String(busy));
    root.querySelectorAll('.fu-brief__act, .fu-brief__opt').forEach(button => { button.disabled = busy || button.dataset.off === 'true'; });
  }

  function cancel() {
    running?.abort();
    running = null;
    setSteps(false);
    setBusy(false);
    showPanel(session ? 'result' : null);
    announce('Stopped.');
  }
  function closePanel() {
    closeMenu();
    showPanel(null);
    els.input.focus();
  }
  function fail(error) {
    setSteps(false);
    setBusy(false);
    els.errorText.textContent = error.message || 'Something went wrong. Try again.';
    els.retry.hidden = error.reason === 'free' || error.reason === 'feature-off';
    showPanel('error');
  }

  // ─── Run ──────────────────────────────────────────────────────────────────
  async function run() {
    const ws = page();
    const brief = els.input.value.trim();
    if (!EDITORS.has(ws)) return;
    if (brief.length < 3) {
      fail(new Error('Describe what you need in a few words, or paste a link.'));
      els.input.focus();
      return;
    }
    if (running) running.abort();
    const controller = new AbortController();
    running = controller;
    const started = performance.now();
    await libs;
    renderer(ws).catch(() => {});
    setBusy(true);
    els.step.textContent = `${STEPS[0]}…`;
    showPanel('progress');
    setSteps(true);
    announce('Designing from your brief.');
    const timeout = setTimeout(() => controller.abort(), 30000);
    let data;
    try {
      data = await post({ mode: 'design', workspace: ws, brief, ownPhoto: Boolean(ownPhoto) }, controller.signal);
    } catch (error) {
      clearTimeout(timeout);
      if (running !== controller) return;
      // The service failed or timed out: design from the brief's own words.
      const local = (error.fallback || error.name === 'AbortError') ? Core().localOptions(ws, brief) : [];
      if (!local.length) {
        running = null;
        fail(error.name === 'AbortError' ? new Error('That took too long. Try again, or shorten the brief.') : error);
        return;
      }
      data = { options: local.map((option, rank) => ({ ...option, id: `brief-local-${rank}`, rank })), photos: [], tweets: [], cutouts: [], subject: '', engine: 'local', notes: ['Filled without AI: the design service didn’t answer, so this uses your own words.'] };
    }
    clearTimeout(timeout);
    if (running !== controller) return;
    setSteps(false);
    els.step.textContent = `${STEPS[3]}…`;
    const options = (data.options || []).filter(option => option && option.template);
    if (!options.length) { running = null; fail(new Error('Nothing in that brief could fill a template. Add a name, a headline or a link.')); return; }
    const photos = [...(ownPhoto ? [ownPhoto] : []), ...(data.photos || []).map(p => ({ url: p.url, title: p.title, sourceUrl: p.sourceUrl || '' }))];
    session = {
      ws, brief, options, photos, photoIndex: 0, current: -1, thumbs: [], startedAt: started,
      tweets: data.tweets || [], cutouts: data.cutouts || [], subject: data.subject || '', article: data.article || null,
      engine: data.mode === 'free' ? 'free' : (data.engine || 'ai'), notice: data.mode === 'free' ? (data.notice || 'AI is in free mode, so this was designed from your words.') : '',
      notes: data.notes || [], fixed: [], left: [], serverMs: data.ms || 0, costUsd: data.costUsd || 0,
    };
    renderOptions();
    try {
      await openOption(0);
    } catch (error) {
      running = null;
      fail(new Error(error.message || 'The design could not be opened in the editor.'));
      return;
    }
    running = null;
    setBusy(false);
    session.readyMs = Math.round(performance.now() - started);
    root.dataset.readyMs = String(session.readyMs);
    showPanel('result');
    paintResult();
    announce(`Ready: ${options[0].label}. ${options.length} options. Undo returns to your previous design.`);
    renderThumbs(controller);
  }

  function ctxFor(index) {
    const photo = session.photos[session.photoIndex] || null;
    return {
      workspace: session.ws,
      brief: session.brief,
      subject: session.subject,
      tweets: session.tweets,
      cutouts: session.cutouts,
      photo: photo ? { url: photo.url, title: photo.title, sourceUrl: photo.sourceUrl || '' } : null,
      palette: paletteFor(session.options, index),
      factsText: session.article?.title || '',
    };
  }

  async function openOption(index, { reason = 'open' } = {}) {
    const A = Apply();
    const option = session.options[index];
    let ctx = ctxFor(index);
    let fromVariation = '';
    try { fromVariation = session.ws === 'youtube' ? activeYoutubeVariation : ''; } catch (error) { fromVariation = ''; }
    // A YouTube layout keeps its own design and history: give the layout the
    // brief opens in a starting point, so Undo is there and returns to it.
    try {
      const target = session.ws === 'youtube' && option.template !== 'quote' ? option.template : '';
      if (target && target !== fromVariation && youtubeVariationStates[target]) {
        const history = getDesignHistory(youtubeVariationStates[target]);
        if (history && !history.current) {
          const snapshot = cloneDesignValue(youtubeVariationStates[target]);
          history.current = { snapshot, signature: designSignature(snapshot) };
        }
      }
    } catch (error) { /* history is optional */ }
    // Undo covers canvas designs, not the HTML widget forms: keep what was
    // there so Restore can put it back.
    if (A.isHtml(session.ws, option.template) && !session.restore?.[option.template]) {
      session.restore = { ...(session.restore || {}), [option.template]: A.widgetSnapshot(option.template) };
    }
    await asOneStep(async () => {
      await A.apply(option, ctx);
      let left = A.checks(session.ws, option);
      let fixed = [];
      if (left.length) {
        const repaired = await A.repair(session.ws, option, left, ctx);
        session.options[index] = repaired.option;
        ctx = repaired.ctx;
        fixed = repaired.fixed;
        left = repaired.left;
      }
      session.fixed = fixed;
      session.left = left;
    });
    session.current = index;
    session.paletteUsed = ctx.palette;
    const opened = session.options[index];
    applied = {
      ws: session.ws, place: A.placeKey(), template: opened.template, label: opened.label, rank: index,
      baseline: A.currentText(), at: Date.now(), brief: session.brief, engine: session.engine,
      fromVariation, variation: (() => { try { return session.ws === 'youtube' ? activeYoutubeVariation : ''; } catch (error) { return ''; } })(),
      viaSpec: session.ws === 'instagram' && Boolean(window.FrameUpSpec?.SUPPORTED?.includes(opened.template)),
    };
    track('brief-design', { from: 'brief', ws: session.ws, template: opened.template, rank: index, engine: session.engine, reason, photo: session.photos[session.photoIndex]?.own ? 'own' : (session.photos.length ? 'es' : 'none'), fixed: session.fixed.length, left: session.left.length, ms: Math.round(performance.now() - (reason === 'open' ? session.startedAt : performance.now())) }, opened.label);
    // This option's thumbnail from the real canvas.
    const canvas = A.isHtml(session.ws, opened.template) ? null : document.getElementById('preview');
    if (canvas) {
      try {
        const out = document.createElement('canvas');
        out.width = 240;
        out.height = Math.round(240 * canvas.height / canvas.width);
        out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
        session.thumbs[index] = out.toDataURL('image/jpeg', 0.82);
      } catch (error) { /* a cross-origin photo taints the canvas: no thumb */ }
    }
  }

  async function renderThumbs(controller) {
    const mine = session;
    const todo = mine.options.map((_, i) => i).filter(i => !mine.thumbs[i]);
    if (!todo.length) return;
    let api;
    try { api = await renderer(mine.ws); } catch (error) { return; }
    for (const i of todo) {
      if (session !== mine || controller.signal.aborted) return;
      try {
        const shot = await api.thumb(mine.options[i], ctxFor(i), 240);
        if (session !== mine) return;
        if (!shot) { els.opts.querySelector(`[data-option="${i}"]`)?.classList.remove('is-loading'); continue; }
        mine.thumbs[i] = shot.dataUrl;
        const img = els.opts.querySelector(`[data-option="${i}"] .fu-brief__thumb`);
        if (img) { img.src = shot.dataUrl; img.closest('.fu-brief__opt')?.classList.remove('is-loading'); }
      } catch (error) { /* the card keeps its label */ }
    }
  }

  function renderOptions() {
    els.opts.innerHTML = session.options.map((option, i) => `
      <button type="button" class="fu-brief__opt${Apply().isHtml(session.ws, option.template) ? ' is-html' : ' is-loading'}" role="radio" aria-checked="false" data-option="${i}" aria-label="${esc(`${option.label}${i === 0 ? ', best match' : ''}: ${option.why}`)}" title="${esc(`${option.label}: ${option.why}`)}">
        <span class="fu-brief__thumb-box">${Apply().isHtml(session.ws, option.template) ? `<span class="fu-brief__thumb-html" aria-hidden="true">${ICON.code}</span>` : '<img class="fu-brief__thumb" alt="">'}</span>
        <span class="fu-brief__opt-text">
          <span class="fu-brief__opt-label">${esc(option.label)}</span>
          <span class="fu-brief__opt-meta">${i === 0 ? 'Best match' : `Option ${i + 1}`}</span>
        </span>
      </button>`).join('');
  }

  function paintResult() {
    if (!session) return;
    const option = session.options[session.current] || session.options[0];
    els.why.innerHTML = `<strong>${esc(option.label)}</strong><span aria-hidden="true"> · </span>${esc(option.why)}`;
    els.opts.querySelectorAll('.fu-brief__opt').forEach(button => {
      const i = Number(button.dataset.option);
      const on = i === session.current;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
      const img = button.querySelector('.fu-brief__thumb');
      if (session.thumbs[i] && img && img.src !== session.thumbs[i]) { img.src = session.thumbs[i]; button.classList.remove('is-loading'); }
    });
    const html = Apply().isHtml(session.ws, option.template);
    const hasPhoto = Boolean(Core()?.templateOf(session.ws, option.template)?.photo) || (html && ['ticker', 'trivia'].includes(option.template) && session.photos.some(p => p.sourceUrl));
    const swapOff = !hasPhoto || session.photos.length < 2;
    els.swap.dataset.off = String(swapOff);
    els.swap.disabled = swapOff;
    els.swap.title = !hasPhoto ? 'This template has no photo' : session.photos.length < 2 ? 'No other checked photos for this brief' : 'Use the next checked photo';
    const exportLabel = html ? 'Copy HTML' : 'Export';
    els.exportBtn.setAttribute('aria-label', exportLabel);
    els.exportBtn.title = exportLabel;
    els.exportBtn.querySelector('.fu-brief__act-text').textContent = exportLabel;
    els.restoreBtn.hidden = !(html && session.restore?.[option.template]);
    els.another.dataset.off = String(session.options.length < 2);
    els.another.disabled = session.options.length < 2;
    const notes = noteList({ notes: session.notes, warnings: option.warnings || [], fixed: session.fixed, left: session.left, notice: session.notice });
    els.notes.innerHTML = notes.map(note => `<li class="fu-brief__note" data-tone="${note.tone}">${esc(note.text)}</li>`).join('');
    els.notes.hidden = !notes.length;
    refit();
  }

  async function pick(index) {
    if (!session || running || index === session.current || !session.options[index]) return;
    setBusy(true);
    try {
      await openOption(index, { reason: 'pick' });
      announce(`Opened ${session.options[index].label}.`);
    } catch (error) {
      window.showToast?.(error.message || 'That option could not be opened.', 'error');
    }
    setBusy(false);
    paintResult();
  }
  function another() {
    if (!session) return;
    pick((session.current + 1) % session.options.length);
  }

  async function rewrite(how) {
    if (!session || running) return;
    const option = session.options[session.current];
    setBusy(true);
    const label = { shorter: 'Making it shorter', punchier: 'Making it punchier', formal: 'Making it more formal' }[how] || 'Rewriting';
    announce(`${label}…`);
    els.why.textContent = `${label}…`;
    try {
      const data = await post({ mode: 'rewrite', workspace: session.ws, brief: session.brief, how, option: { ...option, tweets: session.tweets.map(t => ({ text: t.text })) } });
      session.options[session.current] = { ...data.option, label: option.label, why: option.why };
      delete session.thumbs[session.current];
      await openOption(session.current, { reason: `rewrite-${how}` });
      announce('Rewritten. Undo brings back the previous text.');
    } catch (error) {
      window.showToast?.(error.message || 'The rewrite failed. Try again.', 'error');
    }
    setBusy(false);
    paintResult();
  }

  async function swapPhoto() {
    if (!session || running || session.photos.length < 2) return;
    session.photoIndex = (session.photoIndex + 1) % session.photos.length;
    const photo = session.photos[session.photoIndex];
    setBusy(true);
    try {
      await asOneStep(() => Apply().serial(async () => {
        await Apply().swapPhoto(session.ws, session.options[session.current], photo);
        render();
        try { flushPendingRender(); } catch (error) { /* ignore */ }
      }));
      announce(photo.own ? 'Using your photo.' : `Photo ${session.photoIndex + 1} of ${session.photos.length}.`);
    } catch (error) {
      window.showToast?.('That photo could not be loaded.', 'error');
    }
    setBusy(false);
    paintResult();
  }

  function exportNow() {
    const option = session?.options[session.current];
    if (session && option && Apply().isHtml(session.ws, option.template)) {
      // HTML widgets are copied, not exported as images: log the export here.
      document.getElementById('widget-copy-btn')?.click();
      const value = originNow()?.value;
      if (!value) track('brief-export', { from: 'brief', ws: session.ws, template: option.template, rank: session.current, kept: true, changed: 0, engine: session.engine, dest: 'clipboard' }, option.label);
      return;
    }
    if (typeof window.downloadImage === 'function') window.downloadImage();
    else document.getElementById('studio-export-btn')?.click();
  }

  function restoreWidget() {
    const option = session?.options[session.current];
    const saved = option ? session.restore?.[option.template] : null;
    if (!saved) return;
    const target = { list: () => listBuilderState, list2: () => list2BuilderState, ticker: () => tickerBuilderState, trivia: () => triviaBuilderState }[option.template]?.();
    if (!target) return;
    Object.assign(target, JSON.parse(JSON.stringify(saved)));
    try { window.FrameUpAutosave?.applyBuilders?.({ [option.template]: target }); } catch (error) { /* forms only */ }
    try { renderWidgetPreview(); } catch (error) { /* preview only */ }
    delete session.restore[option.template];
    applied = null;
    paintResult();
    announce('Restored what was there before.');
  }

  // ─── Mount / unmount with the page ───────────────────────────────────────
  function available(ws) {
    const core = Core();
    // Before the core loads (first paint) every editor has brief templates.
    return EDITORS.has(ws) && (!core || Object.keys(core.templatesFor(ws)).length > 0);
  }
  function mount() {
    const ws = page();
    // HTML widgets hide the canvas stage: sit above their preview instead.
    const pane = document.getElementById('widget-preview-pane');
    const widgetMode = ws === 'newsletter' && pane && getComputedStyle(pane).display !== 'none' && document.querySelector('.canvas-stage') && getComputedStyle(document.querySelector('.canvas-stage')).display === 'none';
    const stack = widgetMode ? pane.parentElement : document.querySelector('.canvas-stack');
    const want = available(ws) && stack;
    if (!want) {
      if (root?.isConnected) { root.remove(); refit(); }
      return;
    }
    if (!root) root = build();
    const before = widgetMode ? pane : stack.firstElementChild;
    if (root.parentElement !== stack || (widgetMode && root.nextElementSibling !== pane)) {
      stack.insertBefore(root, before);
      refit();
    }
    root.classList.toggle('is-widget', Boolean(widgetMode));
    root.dataset.workspace = ws;
    if (session && session.ws !== ws) { session = null; showPanel(null); }
  }

  function focusBrief() {
    if (!EDITORS.has(page())) {
      const go = () => { mount(); els.input?.focus(); };
      window.addEventListener('hashchange', () => setTimeout(go, 120), { once: true });
      location.hash = 'instagram';
      return;
    }
    mount();
    els.input?.focus();
    els.input?.select();
  }

  // Newsletter: the asset is an editor global that Undo / Redo don't move, so
  // undoing a brief design that switched assets left the old asset's state
  // under the new asset's canvas. After Undo / Redo of a brief design, the
  // asset follows the restored state. (Only while a Newsletter brief design is
  // in play; the general fix belongs in index.html applyDesignHistoryEntry.)
  // YouTube: each layout (variation) keeps its own design and history, so a
  // brief design that moved to another layout is undone by moving back.
  function followYoutube(redo) {
    try {
      if (applied?.ws !== 'youtube' || activeWorkspace !== 'youtube' || !applied.fromVariation || applied.fromVariation === applied.variation) return false;
      if (redo) return false; // Redo stays in the layout you are on.
      const history = getDesignHistory();
      const [from, to] = [applied.variation, applied.fromVariation];
      // Only the Undo that takes the brief design off this layout moves back.
      if (activeYoutubeVariation !== from || (history?.past?.length || 0) !== 1) return false;
      setTimeout(() => {
        const select = document.getElementById('youtube-variation-select');
        if (select) select.value = to;
        switchYoutubeVariation(to);
        syncAllCustomSelects();
      }, 0);
      return true;
    } catch (error) { return false; }
  }
  function historyIntent(event) {
    if (event.type === 'click') return event.target.closest?.('[data-history]')?.dataset.history || '';
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return '';
    const key = (event.key || '').toLowerCase();
    return key === 'y' || (key === 'z' && event.shiftKey) ? 'redo' : key === 'z' ? 'undo' : '';
  }
  // Capture phase: decide before the editor's own Undo / Redo runs.
  ['click', 'keydown'].forEach(type => document.addEventListener(type, event => {
    const intent = historyIntent(event);
    if (intent) followYoutube(intent === 'redo');
  }, true));

  function followHistory() {
    if (applied?.ws !== 'newsletter') return;
    setTimeout(() => {
      try {
        const want = state.newsletterAsset;
        if (activeWorkspace !== 'newsletter' || !want || want === activeNewsletterAsset || !NEWSLETTER_ASSET_TYPES[want]) return;
        const select = document.getElementById('newsletter-asset-select');
        if (select) select.value = want;
        switchNewsletterAsset(want);
        syncAllCustomSelects();
      } catch (error) { /* the editor keeps its own state */ }
    }, 0);
  }
  document.addEventListener('click', event => { if (event.target.closest?.('[data-history]')) followHistory(); });
  document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && /^[zy]$/i.test(event.key || '')) followHistory(); });

  // Mount now, in the same task as the page's first layout (this script runs
  // after the editor markup and its router), so the canvas never moves down
  // when the box appears.
  try { mount(); } catch (error) { /* mounted again once the core loads */ }
  new MutationObserver(mount).observe(document.body, { attributes: true, attributeFilter: ['data-current-page', 'data-newsletter-asset'] });
  window.addEventListener('hashchange', () => setTimeout(mount, 60));

  libs.then(() => {
    mount();
    try { window.FrameUpSpec?.setOrigin?.(originNow); } catch (error) { /* export origin is optional */ }
    window.FrameUpShell?.addPaletteSource?.(() => [{
      label: 'AI',
      items: [{
        label: 'Design from brief',
        hint: 'Describe it, get a design',
        icon: ICON.spark,
        keywords: 'brief ai design describe write make generate prompt',
        run: focusBrief,
      }],
    }]);
  }).catch(error => console.warn('[brief] could not start:', error));

  window.FrameUpBrief = Object.freeze({
    VERSION, STEPS, noteList, paletteFor, focus: focusBrief,
    session: () => session, applied: () => applied, origin: originNow, enabled,
  });
})();
