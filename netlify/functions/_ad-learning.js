'use strict';
// Video Ads learning loop. Two jobs, no model calls:
//   recordEvent({ token, email, event })   saves one event to
//     frameup_video_ad_events with the user's own session (RLS checks it).
//   lessonsFor({ brandId, sport, token })  -> { examples, rules }
//     examples: the latest exported ads for the brand (up to 5), as few-shot
//       "ads we shipped".
//     rules: plain extra instructions derived, deterministically, from the
//       last 200 events: recurring check failures and consistent edits.
//   styleRankingFor({ brandId, sport, token }) -> [{ style, exports, share,
//       edits, editDistance, score }] best first: which ad styles this brand
//       ships (export share) and how much people rewrite the AI copy in each
//       (word edit distance after copy_applied). Ask AI uses it as a
//       tiebreak between near-equal styles (video-ads-styles.js).
//
// Both never throw. Until the migration has run (table missing) or when
// Supabase is down, recordEvent quietly does nothing and lessonsFor returns
// empties, so the copy writer works exactly as before.
// Lessons are team-wide via the frameup_video_ad_lessons() RPC; if it is not
// there yet, they fall back to the caller's own rows (RLS).
const { authConfig } = require('./_supabase-auth.js');
const RULES = require('../../frameup-rules.js');
const BRANDS = require('../../video-ads-brands.js');

const TABLE = 'frameup_video_ad_events';
const EVENT_TYPES = ['copy_generated', 'copy_applied', 'copy_edited', 'export', 'clip_failed', 'check_failed'];
const SPORTS = ['nfl', 'cfb', 'mlb'];
const MAX_PAYLOAD_CHARS = 16 * 1024;
const MAX_EXAMPLES = 5;
const MAX_RULES = 6;
const MAX_RULE_CHARS = 120;
const RULE_EVENT_WINDOW = 200;
const CACHE_MS = 10 * 60 * 1000;
const FAIL_CACHE_MS = 60 * 1000;
const EMPTY = Object.freeze({ examples: [], rules: [], styles: [] });
const STYLE_IDS = Object.keys(BRANDS.STYLES);
// Fields of the no-footage styles kept in an example (video-ads-styles.js).
const EXTRA_TEXT = ['offer', 'stat', 'statLabel', 'statSource', 'listTitle', 'quote', 'speaker', 'quoteContext'];
const EXTRA_LISTS = ['items', 'them', 'us'];
const MIN_STYLE_EXPORTS = 2;

const cache = new Map();
let tableMissingUntil = 0;

const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
const wordList = text => String(text || '').split(/\s+/).filter(Boolean);
const wordCount = text => wordList(text).length;
const bodyWords = body => (Array.isArray(body) ? body : [body]).reduce((n, p) => n + wordCount(p), 0);
const median = list => {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

function headers(token, extra = {}) {
  const config = authConfig();
  return { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra };
}

// PostgREST answers 404 (PGRST205 / 42P01) while the table does not exist yet.
async function noteMissingTable(response) {
  if (response.status !== 404) return;
  tableMissingUntil = Date.now() + CACHE_MS;
}

// Validates and normalises an event; returns { row } or { error }.
function normalizeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { error: 'Invalid event.' };
  const type = String(event.type || '');
  if (!EVENT_TYPES.includes(type)) return { error: 'Unknown event type.' };
  const payload = event.payload == null ? {} : event.payload;
  if (typeof payload !== 'object' || Array.isArray(payload)) return { error: 'Invalid event payload.' };
  let payloadText;
  try { payloadText = JSON.stringify(payload); } catch { return { error: 'Invalid event payload.' }; }
  if (payloadText.length > MAX_PAYLOAD_CHARS) return { error: 'Event payload is too large.' };
  const brandRaw = event.brandId ?? event.brand_id ?? null;
  const brandId = brandRaw == null || brandRaw === '' ? null : String(brandRaw).trim().toLowerCase();
  if (brandId != null && !/^[a-z0-9-]{1,40}$/.test(brandId)) return { error: 'Invalid brand.' };
  const sportRaw = event.sport == null || event.sport === '' ? null : String(event.sport).trim().toLowerCase();
  if (sportRaw != null && !SPORTS.includes(sportRaw)) return { error: 'Invalid sport.' };
  return { row: { type, brand_id: brandId, sport: sportRaw, payload } };
}

// Saves one event. Resolves true when saved, false otherwise. Never throws.
async function recordEvent({ token, email, event } = {}) {
  try {
    if (!token || !email) return false;
    if (Date.now() < tableMissingUntil) return false;
    const { row } = normalizeEvent(event);
    if (!row) return false;
    const response = await fetch(`${authConfig().url}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ user_email: String(email).trim().toLowerCase(), ...row }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) await noteMissingTable(response);
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Examples: the latest exported ads ────────────────────────────────────
function styleOfRow(payload) {
  const source = payload?.copy && typeof payload.copy === 'object' ? payload.copy : (payload || {});
  return STYLE_IDS.includes(source.style) ? source.style : (STYLE_IDS.includes(payload?.style) ? payload.style : 'condensed');
}

function copyOf(payload) {
  const source = payload?.copy && typeof payload.copy === 'object' ? payload.copy : (payload || {});
  const style = styleOfRow(payload);
  const body = (Array.isArray(source.body) ? source.body : [source.body]).map(p => clean(p, 400)).filter(Boolean).slice(0, 3);
  const ad = {
    style,
    headline: clean(source.headline, 220),
    highlight: style === 'highlight' ? clean(source.highlight, 120) : '',
    body,
    cta: clean(source.cta, 40),
  };
  // A no-footage style keeps its own fields (only those that are set).
  if (BRANDS.STYLES[style] && !BRANDS.STYLES[style].classic) {
    EXTRA_TEXT.forEach(k => { const v = clean(source[k], 220); if (v) ad[k] = v; });
    EXTRA_LISTS.forEach(k => { const v = (Array.isArray(source[k]) ? source[k] : []).map(x => clean(x, 120)).filter(Boolean).slice(0, 3); if (v.length) ad[k] = v; });
  }
  return ad;
}

function deriveExamples(rows) {
  const seen = new Set();
  const examples = [];
  for (const row of rows || []) {
    if (row?.type !== 'export') continue;
    const ad = copyOf(row.payload);
    const text = allText(ad);
    if (!text) continue;
    const key = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(ad);
    if (examples.length >= MAX_EXAMPLES) break;
  }
  return examples;
}

// Every word an ad shows, in reading order (any style).
function allText(ad) {
  if (!ad || typeof ad !== 'object') return '';
  const parts = [ad.headline, ...(Array.isArray(ad.body) ? ad.body : [ad.body]), ad.offer, ad.stat, ad.statLabel, ad.listTitle,
    ...(Array.isArray(ad.items) ? ad.items : []), ...(Array.isArray(ad.them) ? ad.them : []), ...(Array.isArray(ad.us) ? ad.us : []), ad.quote, ad.speaker];
  return parts.map(p => clean(p, 600)).filter(Boolean).join(' ');
}

// Word-level edit distance, 0 (same) .. 1 (rewritten), over the ad's text.
function editDistance(before, after) {
  const a = wordList(String(before || '').toLowerCase());
  const b = wordList(String(after || '').toLowerCase());
  if (!a.length && !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / Math.max(a.length, b.length);
}

// ─── Style ranking: export share and edit distance per style ─────────────
// score = share of exports × (1 − ½ × mean edit distance), scaled so the best
// style is 1. Needs MIN_STYLE_EXPORTS exports for the brand; [] before that
// (too little to learn from). Explainable: every number is returned.
function deriveStyleRanking(rows) {
  const exports = new Map();
  const edits = new Map();
  let total = 0;
  for (const row of rows || []) {
    if (row?.type === 'export') {
      const style = styleOfRow(row.payload);
      exports.set(style, (exports.get(style) || 0) + 1);
      total += 1;
    } else if (row?.type === 'copy_edited') {
      const payload = row.payload || {};
      const style = STYLE_IDS.includes(payload.style) ? payload.style : (STYLE_IDS.includes(payload.after?.style) ? payload.after.style : '');
      if (!style) continue;
      const d = editDistance(allText(payload.before), allText(payload.after));
      const list = edits.get(style) || [];
      list.push(d);
      edits.set(style, list);
    }
  }
  if (total < MIN_STYLE_EXPORTS) return [];
  const raw = [...exports.entries()].map(([style, n]) => {
    const list = edits.get(style) || [];
    const mean = list.length ? list.reduce((x, y) => x + y, 0) / list.length : 0;
    const share = n / total;
    return { style, exports: n, share: Math.round(share * 1000) / 1000, edits: list.length, editDistance: Math.round(mean * 1000) / 1000, raw: share * (1 - 0.5 * mean) };
  });
  const top = Math.max(...raw.map(r => r.raw), 0);
  return raw
    .map(({ raw: value, ...r }) => ({ ...r, score: top > 0 ? Math.round((value / top) * 1000) / 1000 : 0 }))
    .sort((x, y) => y.score - x.score || y.exports - x.exports || x.style.localeCompare(y.style));
}

// ─── Rules: recurring check failures and consistent edits ─────────────────
// Turns one issue (a string from the copy checks, or { kind, word }) into
// { kind, word? }. Unknown issues are ignored.
function classifyIssue(issue) {
  if (issue && typeof issue === 'object') {
    const kind = clean(issue.kind, 40);
    return kind ? { kind, word: clean(issue.word, 40).toLowerCase() } : null;
  }
  const text = String(issue || '');
  if (/^headline is missing/i.test(text)) return { kind: 'headline_missing' };
  if (/^headline has \d+ words/i.test(text)) return { kind: 'headline_length' };
  if (/^paragraph \d+ has \d+ words/i.test(text)) return { kind: 'paragraph_length' };
  if (/^\d+ words in all/i.test(text)) return { kind: 'total_length' };
  if (/highlight/i.test(text)) return { kind: 'highlight' };
  if (/the number .+ is not in/i.test(text)) return { kind: 'invented_number' };
  if (/breaks the ES style/i.test(text)) {
    const quoted = (text.match(/^"(.*)" breaks the ES style/) || [])[1] || '';
    const hit = RULES.BANNED.find(rule => rule.re.test(quoted));
    const match = hit ? quoted.match(hit.re) : null;
    const word = match && /^[\p{L}' -]+$/u.test(match[0]) ? match[0].toLowerCase() : '';
    const why = (text.match(/\(([^)]*)\)\s*$/) || [])[1] || (hit ? hit.why : '');
    return { kind: 'banned', word, why: clean(why, 80) };
  }
  return null;
}

const ISSUE_RULES = {
  headline_missing: () => 'Always write a headline.',
  headline_length: ctx => `Keep headlines under ${ctx.headlineTarget} words.`,
  paragraph_length: () => 'Keep each paragraph under 35 words.',
  total_length: () => 'Keep the whole ad under 80 words.',
  highlight: () => 'In the highlight style, copy the highlight phrase word for word from the headline.',
  invented_number: () => 'Use no numbers or stats unless they appear in the moment or the notes.',
};

function issuesOf(row) {
  const payload = row?.payload || {};
  if (row?.type === 'check_failed') return [...(Array.isArray(payload.issues) ? payload.issues : []), ...(payload.issue ? [payload.issue] : [])];
  if (row?.type === 'copy_generated') return [...(Array.isArray(payload.issues) ? payload.issues : []), ...(Array.isArray(payload.autoFixed) ? payload.autoFixed : [])];
  return [];
}

const STOP = new Set(('a an and are as at be but by for from has have he her his i if in into is it its me my of on or our '
  + 'she so that the their them they this to was we were what when who will with you your').split(' '));
const tokens = text => String(text || '').toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || [];

function textOf(ad) {
  if (!ad || typeof ad !== 'object') return { headline: '', body: [], cta: '' };
  return {
    headline: clean(ad.headline, 300),
    body: (Array.isArray(ad.body) ? ad.body : [ad.body]).map(p => clean(p, 600)).filter(Boolean),
    cta: clean(ad.cta, 40).toUpperCase(),
  };
}

function editPair(payload) {
  const before = payload?.before || payload?.ai || payload?.original;
  const after = payload?.after || payload?.final || payload?.edited;
  if (!before || !after) return null;
  return { before: textOf(before), after: textOf(after) };
}

// Ranked candidates -> up to 6 short rules. Each candidate: { text, support }.
function finalizeRules(candidates) {
  const seen = new Set();
  return candidates
    .filter(c => c.text && c.text.length <= MAX_RULE_CHARS)
    .sort((a, b) => (b.support - a.support) || a.text.localeCompare(b.text))
    .filter(c => (seen.has(c.text) ? false : (seen.add(c.text), true)))
    .slice(0, MAX_RULES)
    .map(c => c.text);
}

function deriveRules(rows, { examples = [] } = {}) {
  const recent = (rows || []).slice(0, RULE_EVENT_WINDOW);
  const candidates = [];

  // The headline target follows what ships: median exported headline + 2,
  // within 8-14 words; 12 when nothing has shipped yet.
  const shipped = examples.map(ad => wordCount(ad.headline)).filter(Boolean);
  const headlineTarget = shipped.length ? Math.min(14, Math.max(8, median(shipped) + 2)) : 12;

  // 1. Check failures: count each kind once per event; a kind must recur (2+).
  const kindCounts = new Map();
  const bannedWords = new Map();
  const bannedWhy = new Map();
  for (const row of recent) {
    const kinds = new Set();
    const words = new Set();
    const whys = new Set();
    issuesOf(row).map(classifyIssue).filter(Boolean).forEach(issue => {
      if (issue.kind === 'banned') {
        if (issue.word) words.add(issue.word);
        else if (issue.why) whys.add(issue.why);
      } else if (ISSUE_RULES[issue.kind]) {
        kinds.add(issue.kind);
      }
    });
    kinds.forEach(kind => kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1));
    words.forEach(word => bannedWords.set(word, (bannedWords.get(word) || 0) + 1));
    whys.forEach(why => bannedWhy.set(why, (bannedWhy.get(why) || 0) + 1));
  }
  kindCounts.forEach((count, kind) => {
    if (count >= 2) candidates.push({ text: ISSUE_RULES[kind]({ headlineTarget }), support: count });
  });
  bannedWords.forEach((count, word) => {
    if (count >= 2) candidates.push({ text: `Never use the word "${word}".`, support: count });
  });
  bannedWhy.forEach((count, why) => {
    if (count >= 2) candidates.push({ text: `Avoid this ES style break: ${why}.`, support: count });
  });

  // 2. Edits: what people consistently do to the AI copy before exporting.
  const edits = recent.filter(row => row?.type === 'copy_edited').map(row => editPair(row.payload)).filter(Boolean);
  if (edits.length >= 2) {
    const consistent = n => n >= 2 && n / edits.length >= 0.6;
    const headlineCut = edits.filter(e => wordCount(e.after.headline) && wordCount(e.after.headline) <= wordCount(e.before.headline) * 0.85);
    if (consistent(headlineCut.length)) {
      const target = Math.max(4, median(headlineCut.map(e => wordCount(e.after.headline))));
      candidates.push({ text: `Editors keep shortening headlines: aim for about ${target} words.`, support: headlineCut.length });
    }
    const bodyCut = edits.filter(e => bodyWords(e.after.body) && bodyWords(e.after.body) <= bodyWords(e.before.body) * 0.85);
    if (consistent(bodyCut.length)) {
      const target = Math.max(10, median(bodyCut.map(e => bodyWords(e.after.body))));
      candidates.push({ text: `Editors keep cutting the body: keep it to about ${target} words.`, support: bodyCut.length });
    }
    // Words (and two-word phrases) removed in at least 2 edits and 40% of them.
    const removed = new Map();
    edits.forEach(e => {
      const beforeTokens = tokens([e.before.headline, ...e.before.body].join(' '));
      const afterText = ` ${tokens([e.after.headline, ...e.after.body].join(' ')).join(' ')} `;
      const kept = token => afterText.includes(` ${token} `);
      const gone = new Set();
      let run = [];
      // A phrase is a run of 2-4 consecutive removed words (no stop words).
      const closeRun = () => { if (run.length >= 2) gone.add(run.slice(0, 4).join(' ')); run = []; };
      beforeTokens.forEach(token => {
        if (STOP.has(token) || kept(token)) { closeRun(); return; }
        if (token.length >= 3) gone.add(token);
        run.push(token);
      });
      closeRun();
      gone.forEach(term => removed.set(term, (removed.get(term) || 0) + 1));
    });
    const removedTerms = [...removed.entries()]
      .filter(([, n]) => n >= 2 && n / edits.length >= 0.4)
      .sort((a, b) => (b[1] - a[1]) || (b[0].split(' ').length - a[0].split(' ').length) || a[0].localeCompare(b[0]));
    // Prefer longer phrases; skip terms that share a word with one already chosen.
    const chosen = [];
    removedTerms.forEach(([term, n]) => {
      if (chosen.length >= 2) return;
      const termWords = term.split(' ');
      if (chosen.some(c => c.term.split(' ').some(w => termWords.includes(w)))) return;
      chosen.push({ term, n });
    });
    chosen.forEach(({ term, n }) => candidates.push({ text: `Avoid "${term}": editors keep removing it.`, support: n }));
    // The same button text chosen over and over.
    const ctas = new Map();
    edits.forEach(e => { if (e.after.cta && e.after.cta !== e.before.cta) ctas.set(e.after.cta, (ctas.get(e.after.cta) || 0) + 1); });
    ctas.forEach((n, cta) => { if (consistent(n)) candidates.push({ text: `Use the button text "${cta}".`, support: n }); });
  }

  return finalizeRules(candidates);
}

// ─── Lessons ──────────────────────────────────────────────────────────────
// Team-wide first: the frameup_video_ad_lessons() RPC (security definer)
// returns the whole team's recent events for the brand, without user ids.
// If it is missing or fails, fall back to the caller's own rows (RLS select),
// cached only briefly because they are one person's view.
const RPC = 'frameup_video_ad_lessons';

async function fetchTeamRows(token, brand, sport) {
  const response = await fetch(`${authConfig().url}/rest/v1/rpc/${RPC}`, {
    method: 'POST',
    headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_brand_id: brand, p_sport: sport || null, p_limit: RULE_EVENT_WINDOW }),
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`lessons rpc failed (${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('lessons rpc returned no rows');
  return rows;
}

async function fetchRows(token, query) {
  const response = await fetch(`${authConfig().url}/rest/v1/${TABLE}?${query}`, {
    headers: headers(token),
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) {
    await noteMissingTable(response);
    throw new Error(`lessons read failed (${response.status})`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchOwnRows(token, brand) {
  const select = 'select=type,sport,payload,created_at&order=created_at.desc';
  const [recent, exports] = await Promise.all([
    fetchRows(token, `${select}&brand_id=eq.${encodeURIComponent(brand)}&limit=${RULE_EVENT_WINDOW}`),
    fetchRows(token, `${select}&brand_id=eq.${encodeURIComponent(brand)}&type=eq.export&limit=25`),
  ]);
  return { recent, exports };
}

// The derived lessons for one brand (and sport), cached. Never throws.
async function loadLessons({ brandId, sport, token } = {}) {
  try {
    const brand = String(brandId || '').trim().toLowerCase();
    if (!token || !/^[a-z0-9-]{1,40}$/.test(brand)) return EMPTY;
    if (Date.now() < tableMissingUntil) return EMPTY;
    const sportId = SPORTS.includes(String(sport || '').toLowerCase()) ? String(sport).toLowerCase() : '';
    const key = `${brand}|${sportId}`; // team-wide: the same lessons for everyone
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    let value = EMPTY;
    let ttl = CACHE_MS;
    try {
      let recent;
      let exports;
      try {
        recent = await fetchTeamRows(token, brand, sportId);
        exports = recent.filter(row => row?.type === 'export');
      } catch {
        ({ recent, exports } = await fetchOwnRows(token, brand));
        ttl = FAIL_CACHE_MS;
      }
      const examples = deriveExamples(exports);
      // Exports for the share: the recent window plus older exports not in it.
      const rowKey = row => `${row?.created_at || ''}|${row?.type || ''}|${JSON.stringify(row?.payload || {})}`;
      const seen = new Set(recent.map(rowKey));
      const styleRows = [...recent, ...exports.filter(row => !seen.has(rowKey(row)))];
      value = { examples, rules: deriveRules(recent, { examples }), styles: deriveStyleRanking(styleRows) };
    } catch {
      ttl = FAIL_CACHE_MS;
    }
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    cache.set(key, { expires: Date.now() + ttl, value });
    return value;
  } catch {
    return EMPTY;
  }
}

async function lessonsFor(args = {}) {
  const value = await loadLessons(args);
  return { examples: [...value.examples], rules: [...value.rules] };
}

// This brand's styles, best first ([] until there are enough exports).
async function styleRankingFor(args = {}) {
  const value = await loadLessons(args);
  return (value.styles || []).map(r => ({ ...r }));
}

function resetLearningCache() {
  cache.clear();
  tableMissingUntil = 0;
}

module.exports = {
  EVENT_TYPES,
  MIN_STYLE_EXPORTS,
  deriveStyleRanking,
  editDistance,
  styleRankingFor,
  MAX_PAYLOAD_CHARS,
  classifyIssue,
  deriveExamples,
  deriveRules,
  lessonsFor,
  normalizeEvent,
  recordEvent,
  resetLearningCache,
};
