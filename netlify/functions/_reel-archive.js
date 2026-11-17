'use strict';
// Reels Studio Hall-of-Fame Archive research (contract §2.1 archive-research,
// research §C). $0 AI: ES MCP calls and ESPN career stats only.
//
//   archiveResearch(body, ctx) -> { ok, athleteId, angle, cost: 0, articles,
//                                   photos, candidates, coverage }
//
//   1. facts    ESPN career stats by season (_reel-games.js athlete, cached 24 h)
//   2. stories  ES MCP query_articles, one call per career year in the ES era
//               (2016 on; newest first, at most 8 calls, 4 at a time), ranked
//               by total pageviews. The publish year is known from the window,
//               so every article carries a date.
//   3. photos   ES licensed pool only (MCP search_images, else the ES media
//               library), image-cdn.essentiallysports.com URLs only.
//   4. moments  code, not a model: the most-read stories (year from the
//               title when it names one, else the publish year) and the best
//               stat seasons. Each moment cites src:a<n> and/or stat:s<year>.
//   5. verify   every number and the year of a moment must appear in the text
//               of a source it cites; anything else is dropped.
//
// With MCP down or not configured: stat rows only, coverage.thin = true.
// Cached 6 h per (sport, athlete, angle).
const games = require('./_reel-games.js');
const F = require('../../reel-formats.js');

const ES_ERA_START = 2016; // ES coverage before this is thin (research §C)
const MAX_YEAR_CALLS = 8;
const PER_YEAR = 6;
const CONCURRENCY = 4;
const MAX_ARTICLES = 30;
const MAX_PHOTOS = 30;
const MAX_CANDIDATES = 12;
const TTL_MS = 6 * 3600e3;
const CACHE = new Map();
const PHOTO_HOST = 'image-cdn.essentiallysports.com';

const clean = (v, n = 300) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'").replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, n);
const isEsArticle = url => /^https:\/\/(?:www\.)?essentiallysports\.com\/[^\s]+$/.test(String(url || ''));
const isEsPhoto = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === PHOTO_HOST; } catch { return false; } };

// ─── ES MCP query_articles records ──────────────────────────────────────
//   **[Title](https://www.essentiallysports.com/...)**
//   Sport: NFL | Writer: ... | Published: 2021-02-07 17:30 | Entity: Tom Brady,Buccaneers | ...
// (the same record format es-generate.js parseEsArticles reads; this one
// also keeps the publish date when the record has one).
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function publishedDate(text) {
  const s = String(text || '');
  let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return '';
}
function parseArticles(text) {
  const out = [];
  const re = /\*\*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\*\*\s*\n([^\n]*)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const meta = m[3];
    const field = name => (meta.match(new RegExp(`${name}:\\s*([^|]+)`)) || [])[1]?.trim() || '';
    out.push({
      title: clean(m[1], 200),
      url: m[2],
      date: publishedDate(field('Published') || field('Date')),
      entities: field('Entity').split(',').map(e => clean(e, 60)).filter(Boolean).slice(0, 6),
    });
  }
  return out.filter(a => a.title && isEsArticle(a.url));
}
function resultText(result) {
  if (!result) return '';
  const parts = [];
  (Array.isArray(result.content) ? result.content : []).forEach(item => { if (item && item.type === 'text' && item.text) parts.push(item.text); });
  if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n');
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next; next += 1; out[i] = await fn(items[i], i).catch(() => null); }
  }));
  return out;
}

// One query_articles call per year (newest first).
async function yearArticles({ name, years, mcp }) {
  const tools = await mcp.listTools();
  const tool = tools.find(t => t && (t.name === 'query_articles' || String(t.name).endsWith('__query_articles')));
  if (!tool) return { articles: [], calls: 0 };
  const picked = years.slice(0, MAX_YEAR_CALLS);
  let failed = 0;
  let lastError = null;
  const lists = await pool(picked, CONCURRENCY, year => askYear(year).catch(error => { failed += 1; lastError = error; return null; }));
  if (picked.length && failed === picked.length) throw lastError || new Error('ES MCP query_articles failed');
  // Interleave by rank (the most-read story of each year first), dedupe by URL.
  const seen = new Set();
  const flat = [];
  for (let rank = 0; rank < PER_YEAR; rank += 1) {
    lists.forEach(list => { const a = list && list[rank]; if (a && !seen.has(a.url)) { seen.add(a.url); flat.push(a); } });
  }
  return { articles: flat.slice(0, MAX_ARTICLES), calls: picked.length, failed };

  async function askYear(year) {
    const result = await mcp.callTool(tool.name, {
      keyword: name, limit: PER_YEAR, order_by: 'total_pageviews', order_dir: 'desc',
      publish_date_start: `${year}-01-01`, publish_date_end: `${year}-12-31`,
    }, { timeoutMs: 12000 });
    return parseArticles(resultText(result)).map((a, rank) => {
      // The window bounds the publish year; a record's own date must agree.
      const ownYear = a.date ? Number(a.date.slice(0, 4)) : null;
      return { ...a, year, rank, date: ownYear === year ? a.date : `${year}-01-01`, datePrecision: ownYear === year ? 'day' : 'year' };
    });
  }
}

// ES photos (licensed pool only).
async function findPhotos({ queries, search }) {
  const out = [];
  const seen = new Set();
  for (const query of queries) {
    if (out.length >= MAX_PHOTOS) break;
    let rows = [];
    try { rows = await search(query, 8); } catch { rows = []; }
    (Array.isArray(rows) ? rows : []).forEach(r => {
      const url = r && (r.sourceUrl || r.url);
      if (!isEsPhoto(url) || seen.has(url) || out.length >= MAX_PHOTOS) return;
      seen.add(url);
      out.push({ url, caption: clean(r.caption || r.title, 200), credit: clean(r.credit, 80), width: Number(r.width) || null, query });
    });
  }
  return out.map((p, i) => ({ id: `p${i + 1}`, url: p.url, caption: p.caption, credit: p.credit, ...(p.width ? { width: p.width } : {}), query: p.query }));
}
function defaultPhotoSearch() {
  const internals = require('./es-image-search.js')._internals || {};
  return async (query, n) => {
    const mcpRows = internals.callMcpSearchImages ? await internals.callMcpSearchImages(query, n).catch(() => []) : [];
    if (mcpRows.some(r => isEsPhoto(r && r.sourceUrl))) return mcpRows;
    const wp = internals.searchWordPressMedia ? await internals.searchWordPressMedia(query, n).catch(() => []) : [];
    return [...mcpRows, ...wp];
  };
}

// ─── Moments ────────────────────────────────────────────────────────────
const STAT_LINES = {
  passing: [['YDS', 'yards'], ['TD', 'TD'], ['INT', 'INT']],
  rushing: [['YDS', 'rush yards'], ['TD', 'TD'], ['AVG', 'avg']],
  receiving: [['REC', 'rec'], ['YDS', 'yards'], ['TD', 'TD']],
  batting: [['HR', 'HR'], ['RBI', 'RBI'], ['AVG', 'AVG']],
  pitching: [['W', 'W'], ['ERA', 'ERA'], ['SO', 'SO']],
};
const PRIMARY = { passing: 'YDS', rushing: 'YDS', receiving: 'YDS', batting: 'HR', pitching: 'SO' };
const numeric = v => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
function statLine(stats, row) {
  const spec = STAT_LINES[stats.category] || stats.labels.filter(l => l !== 'GP').slice(0, 3).map(l => [l, l]);
  return spec.map(([label, word]) => {
    const i = stats.labels.indexOf(label);
    const v = i >= 0 ? row.stats[i] : null;
    return v != null && /\d/.test(String(v)) ? `${v} ${word}` : '';
  }).filter(Boolean).join(', ');
}
function primaryStat(stats, row) {
  const label = PRIMARY[stats.category] || stats.labels.find(l => l !== 'GP');
  const i = stats.labels.indexOf(label);
  return i >= 0 && /\d/.test(String(row.stats[i])) ? { value: String(row.stats[i]), label } : null;
}
const YEAR_RE = /\b(19[5-9]\d|20[0-4]\d)\b/g;

// The text a citation stands for (what the verifier checks numbers against).
function citeText(ref, { articles, stats }) {
  const [type, id] = String(ref).split(':');
  if (type === 'src') {
    const a = articles.find(x => x.id === id);
    return a ? `${a.title} ${String(a.date || '').slice(0, 4)}` : null;
  }
  if (type === 'stat' && stats) {
    if (id === 'totals') return Array.isArray(stats.totals) ? stats.totals.join(' ') : null;
    const row = stats.seasons.find(r => r.id === id);
    return row ? `${row.year} ${row.stats.join(' ')}` : null;
  }
  return null;
}
// Drops every candidate that does not cite, cites something unknown, or
// shows a number (the year included) that its cited sources do not contain.
function verifyCandidates(candidates, ctx) {
  const kept = [];
  const dropped = [];
  (Array.isArray(candidates) ? candidates : []).forEach(c => {
    const cite = Array.isArray(c && c.cite) ? c.cite : [];
    const texts = cite.map(ref => citeText(ref, ctx));
    if (!cite.length || texts.some(t => t == null)) { dropped.push({ id: c && c.id, why: 'uncited' }); return; }
    const sourceSet = F.numberSet(texts.join(' '));
    const shown = [c.title, c.line, c.stat && c.stat.value, c.stat && c.stat.label].filter(Boolean).join(' ');
    const bad = F.numbersIn(shown).filter(n => !sourceSet.has(n));
    if (!Number.isInteger(c.year) || !sourceSet.has(String(c.year))) bad.push(`year ${c.year}`);
    if (bad.length) { dropped.push({ id: c.id, why: `unsourced ${bad.join(', ')}` }); return; }
    kept.push(c);
  });
  return { kept, dropped };
}

function buildCandidates({ articles, photos, stats, now = Date.now }) {
  const thisYear = new Date(now()).getUTCFullYear();
  const rows = stats && Array.isArray(stats.seasons) ? stats.seasons : [];
  const rowFor = year => rows.find(r => r.year === year) || null;
  const out = [];
  const years = new Set();
  const photoFor = year => {
    const p = photos.find(x => String(x.query || '').endsWith(` ${year}`)) || photos.find(x => String(x.caption).includes(String(year)));
    return p ? p.id : null;
  };
  // Stories first (most read), one per year.
  articles.forEach(a => {
    const named = [...String(a.title).matchAll(YEAR_RE)].map(m => Number(m[1])).filter(y => y <= thisYear);
    const year = named.length ? named[0] : Number(String(a.date).slice(0, 4));
    if (!Number.isInteger(year) || years.has(year)) return;
    const row = rowFor(year);
    const cite = [`src:${a.id}`];
    const c = { id: '', year, title: a.title, line: '', cite, photoId: photoFor(year) };
    if (a.datePrecision === 'day') c.date = a.date;
    if (row && stats) { c.line = statLine(stats, row); c.stat = primaryStat(stats, row) || undefined; cite.push(`stat:${row.id}`); }
    if (!c.stat) delete c.stat;
    years.add(year);
    out.push(c);
  });
  // Then the best seasons by the primary stat, plus the first and the last.
  if (stats && rows.length) {
    const label = PRIMARY[stats.category] || stats.labels.find(l => l !== 'GP');
    const i = stats.labels.indexOf(label);
    const best = rows.filter(r => i >= 0 && numeric(r.stats[i]) != null).sort((a, b) => numeric(b.stats[i]) - numeric(a.stats[i])).slice(0, 4);
    [...best, rows[0], rows[rows.length - 1]].forEach(row => {
      if (!row || years.has(row.year)) return;
      years.add(row.year);
      const c = { id: '', year: row.year, title: `${row.year} season`, line: statLine(stats, row), stat: primaryStat(stats, row) || undefined, cite: [`stat:${row.id}`], photoId: photoFor(row.year) };
      if (!c.stat) delete c.stat;
      out.push(c);
    });
  }
  return out.slice(0, MAX_CANDIDATES).map((c, k) => ({ ...c, id: `m${k + 1}` }));
}

// ─── Mode: archive-research ─────────────────────────────────────────────
// ctx: { auth, token, track, fetchImpl?, now?, mcp?, photoSearch?, mcpConfigured? }
async function archiveResearch(body, ctx = {}) {
  const now = ctx.now || Date.now;
  const sport = String(body && body.sport || '');
  if (!['nfl', 'cfb', 'mlb', 'golf'].includes(sport)) return { ok: false, status: 400, error: 'Pick a sport.' };
  const athleteId = /^[0-9]{1,12}$/.test(String(body.athleteId || '')) ? String(body.athleteId) : '';
  const name = clean(body.name, 80);
  if (!athleteId && !name) return { ok: false, status: 400, error: 'Pick a player first.' };
  const angle = clean(body.angle, 120) || '5 best moments';
  const key = `${sport}:${athleteId || name.toLowerCase()}:${angle.toLowerCase()}`;
  const hit = CACHE.get(key);
  if (hit && now() - hit.at < TTL_MS) return { ...hit.value, cached: true };

  // 1. Career stats (free, cached by the games module).
  let athlete = null;
  if (athleteId) {
    const got = await games.athlete({ sport, athleteId, name }, ctx).catch(() => null);
    athlete = got && got.ok ? got.athlete : null;
  }
  const playerName = name || (athlete && athlete.name) || '';
  const stats = athlete && athlete.stats && Array.isArray(athlete.stats.seasons) ? athlete.stats : null;
  const thisYear = new Date(now()).getUTCFullYear();
  const career = stats && stats.seasons.length ? stats.seasons.map(r => r.year) : [];
  let years = (career.length ? [...new Set(career)] : Array.from({ length: 10 }, (_, k) => thisYear - k))
    .filter(y => y >= ES_ERA_START && y <= thisYear).sort((a, b) => b - a);
  if (career.length && Math.max(...career) < ES_ERA_START) years = []; // retired before ES: stat rows only

  // 2. ES articles (MCP), 3. ES photos.
  let found = { articles: [], calls: 0 };
  let mcpError = '';
  const mcpReady = ctx.mcpConfigured != null ? ctx.mcpConfigured : require('./_es-mcp.js').isMcpConfigured();
  if (playerName && years.length && mcpReady) {
    try {
      const mcp = ctx.mcp || require('./_es-mcp.js').createSession();
      found = await yearArticles({ name: playerName, years, mcp });
    } catch (error) {
      mcpError = String(error && error.message || error).slice(0, 160);
    }
  }
  const articles = found.articles.map((a, i) => ({ id: `a${i + 1}`, type: 'es-article', title: a.title, url: a.url, date: a.date, datePrecision: a.datePrecision, entities: a.entities, year: a.year }));
  const topYears = [...new Set(articles.map(a => a.year))].slice(0, 3);
  let photos = [];
  if (playerName && (mcpReady || ctx.photoSearch)) {
    photos = await findPhotos({ queries: [playerName, ...topYears.map(y => `${playerName} ${y}`)], search: ctx.photoSearch || defaultPhotoSearch() }).catch(() => []);
  }
  if (!stats && !articles.length) {
    return { ok: false, status: 502, reason: 'data-unavailable', error: 'There is not enough ES coverage or stats for this player yet; use the brief.' };
  }

  // 4. Moments, 5. citation check.
  const raw = buildCandidates({ articles, photos, stats, now });
  const { kept, dropped } = verifyCandidates(raw, { articles, stats });
  const value = {
    ok: true,
    athleteId: athleteId || '',
    angle,
    cost: 0,
    articles: articles.map(({ year, ...a }) => a),
    photos,
    candidates: kept,
    coverage: { articles: articles.length, photos: photos.length, thin: articles.length < 3, mcp: mcpReady ? (mcpError ? 'error' : 'ok') : 'off', calls: found.calls },
    athlete: athlete || null,
    dropped: dropped.length,
  };
  CACHE.set(key, { at: now(), value });
  if (CACHE.size > 200) CACHE.delete(CACHE.keys().next().value);
  return value;
}

module.exports = { archiveResearch, parseArticles, publishedDate, verifyCandidates, buildCandidates, statLine, primaryStat, findPhotos, isEsPhoto, ES_ERA_START, MAX_YEAR_CALLS, CACHE };
