// FrameUp editor assist: small helpers that make the editor easier to trust.
//
//   1. Save chip: one quiet status next to Undo / Redo that says where your
//      work is ("Saved", "Saving…", "Synced to your account", "Offline · saved
//      in this browser", "Couldn't save"). It joins the browser autosave
//      (frameup-autosave.js, `frameup:autosave-state`) and cloud drafts
//      (frameup-cloud-drafts.js, `frameup:cloud-status`). Click it for your
//      drafts. Ctrl/⌘ + S saves now (instead of the browser's "Save page").
//   2. Brand check: before export, ES guideline nudges join the existing
//      "Before you export" list (index.html getExportIssues): the ES headline
//      font failed to load, a Cover line had to shrink below a readable size
//      (frameup-rules.js FIT), or the copy uses something ES posts never do
//      (hashtags, links, emojis, hype words; frameup-rules.js BANNED). Rule
//      ids and sources come from es-guidelines.js. Nudges never block: the
//      dialog keeps "Export anyway".
//   3. Template matching for the picker (frameup-templates.js): "best for"
//      lines, search keywords and suggestTemplates(text), which reads a
//      headline or story and names the templates that fit it.
//
// The logic is pure and exported for Node tests; install() wires the browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document && window.top === window) {
    window.FrameUpEditorAssist = api;
    api.install(window);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // ─── Templates: what each one is best for ────────────────────────────────
  // `best` is shown on the picker card; `keywords` only feed search.
  const TEMPLATE_INFO = {
    instagram: {
      cover: { best: 'A headline over a big photo', keywords: 'headline news hook cover story photo pills breaking update' },
      quote: { best: 'A short, punchy quote', keywords: 'quote said says quotation words speaker' },
      'long-quote': { best: 'A longer quote with a byline', keywords: 'quote said statement paragraph long speech interview' },
      'double-entity-quote': { best: 'Two people, two quotes', keywords: 'quote two players versus reaction exchange back and forth both' },
      'stats-single-ent': { best: 'One player, a few big numbers', keywords: 'stats numbers points player season game numbers performance' },
      'stats-double-ent': { best: 'Two players or teams compared', keywords: 'stats versus vs head to head h2h compare comparison matchup rivalry' },
      'player-stat-line': { best: 'A player’s game line, with team logos', keywords: 'stat line box score game points rebounds assists yards touchdowns performance logo' },
      'team-record': { best: 'A score, result or season record', keywords: 'score final result record wins losses standings streak team logo game' },
      'listicle-type-1': { best: 'A ranked table with stats', keywords: 'rankings table top list standings leaders ranked stats' },
      'listicle-type-2': { best: 'A ranked list of names', keywords: 'ranked list top 5 top 10 best worst power rankings countdown' },
      'asap-template-1': { best: 'Moments in order', keywords: 'timeline history career journey years dates moments chronology' },
      'twitter-quote': { best: 'One tweet or X post', keywords: 'tweet x post twitter social reaction screenshot' },
      'twitter-multi': { best: 'Several reactions', keywords: 'tweets x posts twitter reactions fans react social multiple' },
    },
    newsletter: {
      'feature-image': { best: 'The issue’s lead image', keywords: 'feature image lead hero' },
      'youtube-fi': { best: 'Link to a video', keywords: 'video youtube play button' },
      'tag-fi': { best: 'A feature image with a label', keywords: 'tag label corner category' },
      'section-header': { best: 'Start a section', keywords: 'section header divider title strip' },
      'section-header-2': { best: 'Start a section, centred', keywords: 'section header divider title strip centered' },
      widgets: { best: 'Desktop news layout', keywords: 'html widget news layout' },
      trivia: { best: 'A quiz question', keywords: 'trivia quiz question answer html widget' },
      ticker: { best: 'Market or score ticker', keywords: 'ticker financial stocks scores html widget' },
      list: { best: 'Headlines with big numbers', keywords: 'list headlines numbers html widget' },
      list2: { best: 'A simple headline list', keywords: 'list headlines simple html widget' },
    },
  };

  function templateInfo(workspace, value) {
    return (TEMPLATE_INFO[workspace] && TEMPLATE_INFO[workspace][value]) || null;
  }

  // ─── Best for this story ─────────────────────────────────────────────────
  // Reads a headline or a pasted story and scores the Social templates.
  // Only patterns in the text count; nothing is guessed about the facts.
  const STAT_WORDS = '(?:points?|pts|rebounds?|rebs?|reb|assists?|asts?|ast|steals?|blocks?|yards?|yds|touchdowns?|tds?|td|interceptions?|ints?|sacks?|tackles?|goals?|saves?|hits?|home runs?|hrs?|rbis?|strikeouts?|ks|birdies|eagles|aces|receptions?|catches|carries|threes|3-pointers|3pm|shots?|runs?|wickets?|laps?|strokes?)';
  const STAT_RE = new RegExp(`\\b\\d{1,4}(?:\\.\\d+)?\\s*${STAT_WORDS}\\b`, 'gi');
  const RECORD_RE = /\b\d{1,3}\s?[-–]\s?\d{1,3}(?:\s?[-–]\s?\d{1,2})?\b/;
  const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

  function suggestTemplates(text, { available = null, limit = 3 } = {}) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (raw.length < 6) return [];
    const t = raw.toLowerCase();
    const scores = new Map();
    const add = (value, points, why) => {
      const current = scores.get(value) || { value, score: 0, why: '' };
      current.score += points;
      if (!current.why || points >= 2) current.why = why;
      scores.set(value, current);
    };

    const quoteMatch = raw.match(/["“”]([^"“”]{4,})["“”]/);
    const saidVerb = /\b(?:said|says|told|admits?|admitted|claims?|claimed|insists?|explained|revealed|blasts?|slams?|fires back)\b/.test(t);
    const quoteText = quoteMatch ? quoteMatch[1] : '';
    if (quoteMatch || saidVerb) {
      if (quoteText.length > 90) add('long-quote', 3, 'It has a long quote');
      else add('quote', quoteMatch ? 3 : 2, quoteMatch ? 'It has a short quote' : 'Someone is quoted');
      const quoteCount = (raw.match(/["“”][^"“”]{4,}["“”]/g) || []).length;
      if (quoteCount >= 2 || /\b(?:responds?|responded|fires back|hits back|reacts?)\b/.test(t)) add('double-entity-quote', 2, 'Two people are quoted');
    }
    if (/(?:^|\s)@\w{2,}|\b(?:tweet(?:ed|s)?|x post|posted on x|on twitter)\b/.test(t)) {
      add('twitter-quote', 3, 'It’s about a post on X');
      if (/\b(?:fans|reactions?|react|twitter erupts|social media)\b/.test(t)) add('twitter-multi', 3, 'It rounds up reactions');
    } else if (/\b(?:fans react|reactions?|social media reacts|twitter erupts|internet reacts)\b/.test(t)) {
      add('twitter-multi', 3, 'It rounds up reactions');
    }
    const stats = (raw.match(STAT_RE) || []).length;
    const versus = /\b(?:vs\.?|versus|v\.|against|head[- ]to[- ]head|h2h|compared|comparison|better than|or)\b/.test(t) && /\b(?:vs\.?|versus|head[- ]to[- ]head|h2h|compared|comparison|better than)\b/.test(t);
    if (stats >= 2) add('player-stat-line', 3, `It has ${stats} stats`);
    if (stats >= 1) add('stats-single-ent', stats >= 2 ? 2 : 3, stats >= 2 ? 'Big numbers for one player' : 'It has a big number');
    if (versus) add('stats-double-ent', stats ? 3 : 2, 'It compares two sides');
    if (RECORD_RE.test(raw) && !/\b\d{1,2}[-–]\d{1,2}[-–](?:19|20)\d{2}\b/.test(raw)) add('team-record', 3, 'It has a score or record');
    else if (/\b(?:record|win streak|winning streak|losing streak|undefeated|unbeaten|final score|beat|beats|defeat|defeats|routs?|clinch(?:es|ed)?)\b/.test(t)) add('team-record', 2, 'It’s about a result');
    if (/\b(?:top|best|worst|biggest)\s+\d{1,2}\b|\bpower rankings?\b|\branked\b|\brankings?\b|\bcountdown\b/.test(t)) {
      add('listicle-type-2', 3, 'It’s a ranked list');
      add('listicle-type-1', /\b(?:table|standings|leaders|stats)\b/.test(t) ? 3 : 1, 'A ranked table with stats');
    }
    const years = new Set((raw.match(YEAR_RE) || []));
    if (years.size >= 2 || /\b(?:timeline|journey|through the years|career|history of|from \w+ to)\b/.test(t)) add('asap-template-1', years.size >= 2 ? 3 : 2, 'It moves through time');
    // A plain headline is a Cover.
    add('cover', scores.size ? 1 : 2, 'A headline over a photo');

    return [...scores.values()]
      .filter(item => !available || available.includes(item.value))
      .sort((a, b) => b.score - a.score || (a.value === 'cover' ? 1 : b.value === 'cover' ? -1 : 0))
      .slice(0, limit);
  }

  // ─── Recent templates ─────────────────────────────────────────────────────
  function pushRecent(list, value, max = 4) {
    const items = (Array.isArray(list) ? list : []).filter(item => typeof item === 'string' && item && item !== value);
    if (value) items.unshift(value);
    return items.slice(0, max);
  }

  // ─── Brand check (ES guideline nudges) ────────────────────────────────────
  // input:
  //   template:   Social post type ('cover', 'quote', …) or '' elsewhere
  //   lines:      the headline / quote lines on the design
  //   fontStatus: 'loaded' | 'loading' | 'error' | 'unknown'
  //   measure(text, sizePx): width of `text` in the ES headline font (Cover only)
  //   rules:      frameup-rules.js (FIT, BANNED); guidelines: es-guidelines.js
  // returns [{ rule, text, source }]
  const QUOTE_TEMPLATES = new Set(['quote', 'long-quote', 'double-entity-quote']);
  const TWEET_TEMPLATES = new Set(['twitter-quote', 'twitter-multi']);
  const FORMAT_WHY = /hashtag|link|emoji/;

  // The whole word a match sits in ("#GOAT", not "#G"), kept short.
  function wordAround(line, match) {
    if (!match) return '';
    let start = match.index || 0;
    let end = start + match[0].length;
    while (start > 0 && !/\s/.test(line[start - 1])) start -= 1;
    while (end < line.length && !/\s/.test(line[end])) end += 1;
    const word = line.slice(start, end);
    return word.length > 24 ? `${word.slice(0, 23)}…` : word;
  }

  function brandCheck({ template = '', lines = [], fontStatus = 'unknown', measure = null, rules = null, guidelines = null } = {}) {
    const issues = [];
    const source = id => guidelines?.RULES_BY_ID?.[id]?.source || '';
    const text = (Array.isArray(lines) ? lines : []).map(line => String(line || '').trim()).filter(Boolean);

    if (fontStatus === 'error') {
      issues.push({ rule: 'font-family', text: 'Brand check: the ES headline font didn’t load, so the text would export in a fallback font.', source: source('font-family'), fix: 'reload-font' });
    } else if (fontStatus === 'loading') {
      issues.push({ rule: 'font-family', text: 'Brand check: the ES headline font is still loading. Wait a second so the text exports in Acumin.', source: source('font-family'), fix: 'reload-font' });
    }

    if (!text.length || TWEET_TEMPLATES.has(template)) return issues;

    // Copy: what ES posts never carry. Quotes are verbatim, so only the
    // format rules apply to them (no hashtags, links or emojis on the design).
    const banned = Array.isArray(rules?.BANNED) ? rules.BANNED : [];
    const flagged = new Set();
    for (const { re, why } of banned) {
      if (QUOTE_TEMPLATES.has(template) && !FORMAT_WHY.test(why)) continue;
      const hit = text.find(line => re.test(line));
      if (!hit || flagged.has(why)) continue;
      flagged.add(why);
      const match = wordAround(hit, hit.match(re));
      issues.push({ rule: 'banned-words', text: `Brand check: ${match ? `“${match.trim()}”: ` : ''}${why}.`, source: source('banned-words') });
      if (flagged.size >= 2) break;
    }

    // Size: a Cover line drawn below the smallest size that still reads as an ES post.
    const fit = rules?.FIT?.cover?.pill;
    if (template === 'cover' && fit && typeof measure === 'function') {
      const tooSmall = text
        .map(line => {
          const upper = fit.upper ? line.toUpperCase() : line;
          const width = measure(upper, fit.size);
          const size = width > fit.maxWidth ? Math.floor(fit.size * fit.maxWidth / width) : fit.size;
          return { line, size };
        })
        .filter(item => item.size < fit.minSize)
        .sort((a, b) => a.size - b.size);
      if (tooSmall.length) {
        const worst = tooSmall[0];
        const short = worst.line.length > 28 ? `${worst.line.slice(0, 26)}…` : worst.line;
        issues.push({
          rule: 'text-fit',
          text: `Brand check: “${short}” shrinks to ${worst.size}px to fit (ES Covers read best at ${fit.minSize}px or more). Split it or shorten it: 10–16 characters per line looks best.`,
          source: source('text-fit'),
        });
      }
    }
    return issues;
  }

  // ─── Save chip text ───────────────────────────────────────────────────────
  // local: 'idle' | 'ready' | 'pending' | 'saving' | 'saved' | 'failed'
  // cloud: the cloud-drafts status ('', 'pending', 'saving', 'synced', 'offline', 'error', …)
  function timeAgo(savedAt, now) {
    const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return 'over a day ago';
  }

  function saveChipState({ local = 'idle', cloud = '', savedAt = 0, online = true, now = Date.now() } = {}) {
    if (local === 'failed') return { tone: 'error', label: 'Couldn’t save', detail: 'Your latest changes couldn’t be saved in this browser. Export or copy a link to keep them.' };
    if (local === 'pending' || local === 'saving') return { tone: 'busy', label: 'Saving…', detail: 'Saving your changes in this browser.' };
    // Nothing changed yet: stay out of the way.
    if (local === 'idle' || local === 'ready') return { tone: 'quiet', label: '', detail: '' };
    const when = savedAt ? timeAgo(savedAt, now) : '';
    if (!online || cloud === 'offline') return { tone: 'warn', label: 'Offline', detail: `Saved in this browser${when ? ` ${when}` : ''}. It syncs to your account when you’re back online.` };
    if (cloud === 'synced') return { tone: 'ok', label: 'Synced', detail: `Saved${when ? ` ${when}` : ''} and synced to your account, so it opens on any device.` };
    if (cloud === 'saving') return { tone: 'busy', label: 'Syncing…', detail: 'Saved in this browser. Copying it to your account.' };
    if (cloud === 'error') return { tone: 'warn', label: 'Saved here', detail: 'Saved in this browser. Your account can’t be reached right now; it will retry.' };
    if (cloud === 'too-large') return { tone: 'warn', label: 'Saved here', detail: 'Saved in this browser. It’s too large to sync to your account.' };
    if (cloud === 'signed-out') return { tone: 'warn', label: 'Saved here', detail: 'Saved in this browser. Sign in to sync it to your account.' };
    return { tone: 'ok', label: 'Saved', detail: `Saved in this browser${when ? ` ${when}` : ''}.${cloud === 'pending' ? ' Syncing to your account soon.' : ''}` };
  }

  // ─── Browser wiring ───────────────────────────────────────────────────────
  function install(win) {
    const doc = win.document;
    const IS_MAC = /Mac|iPhone|iPad/.test(win.navigator.platform || win.navigator.userAgent || '');
    const MOD = IS_MAC ? '⌘' : 'Ctrl';
    const EDITOR_PAGES = new Set(['instagram', 'youtube', 'newsletter']);
    const inEditor = () => EDITOR_PAGES.has(doc.body?.dataset.currentPage || '');

    // ── Save chip ──
    const chip = { local: 'idle', cloud: '', savedAt: 0, el: null, label: null, timer: null };

    function paintChip() {
      if (!chip.el) return;
      const view = saveChipState({ local: chip.local, cloud: chip.cloud, savedAt: chip.savedAt, online: win.navigator.onLine !== false });
      chip.el.hidden = !view.label;
      chip.el.dataset.tone = view.tone;
      chip.label.textContent = view.label;
      chip.el.title = `${view.detail}${view.detail ? ' ' : ''}Click to see your drafts. ${MOD}+S saves now.`;
      chip.el.setAttribute('aria-label', `${view.label}. ${view.detail} Open your drafts.`);
    }

    function mountChip() {
      if (chip.el) return true;
      const group = doc.querySelector('.studio-history-group');
      if (!group) return false;
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'editor-save-chip';
      button.hidden = true;
      button.innerHTML = '<span class="editor-save-chip__dot" aria-hidden="true"></span><span class="editor-save-chip__label"></span>';
      button.addEventListener('click', () => win.FrameUpDesigns?.showRecentDesigns?.());
      // Inside the group, so it moves with it (the studio shell relocates the
      // group into the top bar on wide screens).
      group.appendChild(button);
      // A live region (separate, so hovering the chip isn't read twice).
      chip.el = button;
      chip.label = button.querySelector('.editor-save-chip__label');
      paintChip();
      return true;
    }

    let announcer = null;
    function announce(message) {
      if (!announcer) {
        announcer = doc.createElement('p');
        announcer.className = 'editor-assist-sr';
        announcer.setAttribute('role', 'status');
        doc.body.appendChild(announcer);
      }
      announcer.textContent = '';
      win.setTimeout(() => { announcer.textContent = message; }, 30);
    }

    win.addEventListener('frameup:autosave-state', event => {
      const detail = event.detail || {};
      const was = chip.local;
      chip.local = detail.state === 'ready' ? (detail.savedAt ? 'saved' : 'ready') : detail.state;
      if (detail.savedAt) chip.savedAt = detail.savedAt;
      paintChip();
      if (detail.state === 'failed' && was !== 'failed') {
        announce('Your latest changes could not be saved in this browser.');
        win.showToast?.(detail.message || 'Your latest changes couldn’t be saved in this browser. Export or copy a link to keep them.', 'error');
      }
    });
    win.addEventListener('frameup:cloud-status', event => { chip.cloud = event.detail?.status || ''; paintChip(); });
    win.addEventListener('online', paintChip);
    win.addEventListener('offline', paintChip);
    // Keep "2 min ago" honest.
    chip.timer = win.setInterval(paintChip, 30000);

    async function saveNowFromKeyboard() {
      const A = win.FrameUpAutosave;
      if (!A?.saveNow) { win.showToast?.('Autosave isn’t available in this browser. Export to keep your design.', 'error'); return; }
      await A.saveNow();
      const status = A.status?.() || {};
      if (status.failed) return; // the chip and the toast already say so
      try { await win.FrameUpCloudDrafts?.flush?.(); } catch (error) { /* the chip shows sync problems */ }
      const cloud = win.FrameUpCloudDrafts?.status?.()?.status || '';
      const message = cloud === 'synced' ? 'Saved and synced to your account' : 'Saved in this browser';
      win.showToast?.(message, 'success');
      announce(message);
    }

    // ── Keyboard: Ctrl/⌘+S saves, T opens templates ──
    const isTyping = target => Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
    doc.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || !inEditor()) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = (event.key || '').toLowerCase();
      if (mod && !event.altKey && !event.shiftKey && key === 's') {
        event.preventDefault();
        saveNowFromKeyboard();
        return;
      }
      if (!mod && !event.altKey && !event.shiftKey && key === 't' && !isTyping(event.target) && !doc.querySelector('dialog[open]')) {
        if (win.FrameUpTemplates?.openForPage?.()) event.preventDefault();
      }
    });

    // ── Brand check (called from index.html getExportIssues) ──
    let measureCtx = null;
    function measure(text, size) {
      if (!measureCtx) measureCtx = doc.createElement('canvas').getContext('2d');
      measureCtx.font = `900 ${size}px "Acumin Post", "Roboto Condensed", sans-serif`;
      return measureCtx.measureText(text).width;
    }

    function headlineFontStatus() {
      const set = doc.fonts;
      if (!set || typeof set.forEach !== 'function') return 'unknown';
      const faces = [];
      set.forEach(face => { if (String(face.family).replace(/["']/g, '') === 'Acumin Post') faces.push(face.status); });
      if (!faces.length) return 'unknown';
      if (faces.includes('loaded')) return 'loaded';
      if (faces.every(status => status === 'error')) return 'error';
      // 'unloaded' faces load on first use; only call it loading once asked for.
      return faces.includes('loading') ? 'loading' : 'loaded';
    }

    // index.html passes its own activeWorkspace and state (they aren't on window).
    function exportIssues({ workspace, state } = {}) {
      try {
        if (!state || !EDITOR_PAGES.has(workspace)) return [];
        const template = workspace === 'instagram' ? (state.postType || 'cover') : '';
        // Only designs that draw the ES headline font and the pill lines.
        const usesPills = typeof win.contextUsesPillLayout === 'function' ? win.contextUsesPillLayout() : false;
        const usesHeadline = workspace === 'instagram' || usesPills;
        const lines = usesPills || QUOTE_TEMPLATES.has(template) ? (state.lines || []) : [];
        const issues = brandCheck({
          template,
          lines,
          fontStatus: usesHeadline ? headlineFontStatus() : 'unknown',
          measure,
          rules: win.FrameUpRules,
          guidelines: win.ESGuidelines,
        });
        return issues.map(issue => ({
          text: issue.text,
          rule: issue.rule,
          fix: issue.fix === 'reload-font' ? {
            label: 'Load the font',
            run: async () => {
              try { await win.loadFont?.(); } catch (error) { /* loadFont shows its own status */ }
              win.showToast?.(headlineFontStatus() === 'loaded' ? 'ES headline font loaded' : 'The font still didn’t load. Check your connection and reload the page.', headlineFontStatus() === 'loaded' ? 'success' : 'error');
            },
          } : null,
        })).map(issue => (issue.fix ? issue : { text: issue.text, rule: issue.rule }));
      } catch (error) {
        return [];
      }
    }

    function init() {
      if (!mountChip()) {
        // The studio shell builds its top bar after load; try again then.
        let tries = 0;
        const retry = win.setInterval(() => { tries += 1; if (mountChip() || tries > 40) win.clearInterval(retry); }, 250);
      }
      // If autosave already started before this file ran.
      const status = win.FrameUpAutosave?.status?.();
      if (status?.enabled) { chip.local = status.failed ? 'failed' : status.savedAt ? 'saved' : 'ready'; chip.savedAt = status.savedAt || 0; paintChip(); }
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
    else init();

    Object.assign(api, { exportIssues, saveNow: saveNowFromKeyboard, fontStatus: headlineFontStatus });
  }

  const api = { TEMPLATE_INFO, templateInfo, suggestTemplates, pushRecent, brandCheck, saveChipState, timeAgo, install };
  return api;
}));
