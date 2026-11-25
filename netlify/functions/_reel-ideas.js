'use strict';
// Reels Studio ideas room (Reels 2.0, lane B): a topic or a trend -> 4-5 reel
// angles in the EssentiallySports voice, each with a storyboard that is ready
// to become a reel with no second AI call.
//
//   gather      in parallel, each step with its own timeout, every failure soft:
//                 ES most-read articles (ES MCP query_articles) and tagged ES
//                 coverage with the article body (es-generate.js esData);
//                 the trend's own headlines (trend-design.js getTrends) and its
//                 cached AI angle (ideas only, never facts);
//                 recent finals and a player's season stats when a team or a
//                 player is named (_reel-games.js, ESPN, free);
//                 an optional capped web fact check (_reel-director.js, $0.03).
//   ideas       ONE AI call (Haiku / `main`; Sonnet / `best` on request) with a
//               cached system prompt returns the angles as JSON.
//   grounding   code, never the model: every number must be in the gathered
//               sources and every quote an exact substring of them. A failing
//               beat becomes a plain statement when its headline is clean, else
//               it is dropped; an angle that loses its hook or its substance is
//               dropped. Each storyboard then goes through the director's
//               validatePlan (the same rules a normal reel plan gets). Poll
//               options carry no numbers.
//   free mode   with AI off, over a cap or on any failure: template angles per
//               lens, filled from ES article titles and the facts found,
//               labelled as free drafts, run through the same checks.
//
// 30-minute in-memory cache per (topic, trend, sport, tier, fact check). The AI
// call is logged as `reels-ideas` (`reels-ideas-sonnet` on the best tier).
const crypto = require('node:crypto');
const F = require('../../reel-formats.js');
const STYLES = require('../../reel-styles.js');
const ES = require('../../reel-es.js');
const RULES = require('../../frameup-rules.js');
const DATA = require('../../reel-data.js');
const director = require('./_reel-director.js');
// Required when called (not at load), so tests can swap the modules.
const gateway = () => require('./_ai-gateway.js');
const esData = () => require('./es-generate.js').esData;
const trendDesign = () => require('./trend-design.js');
const gamesApi = () => require('./_reel-games.js');

const FEATURE = 'reels-ideas';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;
const CACHE = new Map();
const BUDGET_MS = 45000; // inside the 60 s function limit
const STEP_MS = { es: 13000, trend: 5000, games: 6000, player: 7000, factCheck: 24000 };
const AI_MS = { min: 9000, max: 22000 };
// Shown in the UI before a run (measured on the prompt sizes below; the reply
// carries the real cost). Haiku 5.5: ~4.5k tokens in, ~3k out. Sonnet 5.5: same.
const PRICES = Object.freeze({ main: 0.002, best: 0.04, factCheckCap: director.FACT_CHECK.maxCostUsd });
const LIMITS = Object.freeze({ topic: 600, steer: 300, articles: 8, news: 5, angles: 5, minAngles: 1, beats: 8, promptChars: 9500, corpusChars: 60000 });

const LENSES = ['fan-first', 'quote-led', 'verdict', 'money', 'fan-reaction', 'behind-the-moment'];
const LENS_LABEL = { 'fan-first': 'Fan first', 'quote-led': 'Quote led', verdict: 'Verdict', money: 'Money', 'fan-reaction': 'Fan reaction', 'behind-the-moment': 'Behind the moment' };
const RECIPES = ['stat-drop', 'quote-reaction', 'explainer', 'countdown', 'versus', 'fan-pulse', 'verdict', 'money-story'];
const RECIPE_FOR_LENS = { 'fan-first': 'fan-pulse', 'quote-led': 'quote-reaction', verdict: 'verdict', money: 'money-story', 'fan-reaction': 'fan-pulse', 'behind-the-moment': 'explainer' };
const IDEA_SPORTS = ['nfl', 'cfb', 'mlb', 'golf', 'tennis', 'nba', 'wnba', 'nascar'];
const SPORT_LABEL = { nfl: 'NFL', cfb: 'College Football', mlb: 'MLB', golf: 'Golf', tennis: 'Tennis', nba: 'NBA', wnba: 'WNBA', nascar: 'NASCAR' };
// ES verticals map to newsletters (MLB has ES Dugout, the Video Ads brand).
const NEWSLETTERS = { nfl: 'The Huddle', cfb: 'Essentially CFB', nba: 'Essentially Dunk', wnba: 'Essentially Dunk', golf: 'Essentially Golf', tennis: 'Break Point', nascar: 'Lucky Dog', mlb: 'ES Dugout' };
const GAME_SPORTS = ['nfl', 'cfb', 'mlb'];
const PLAYER_SPORTS = ['nfl', 'cfb', 'mlb', 'golf'];

const { clean, squash, extractJson } = director._test;
const money = usd => Number((Number(usd) || 0).toFixed(6));
const arr = v => (Array.isArray(v) ? v : []);
const short = (text, max) => { const t = String(text || '').trim(); if (t.length <= max) return t; const cut = t.slice(0, max); const at = cut.lastIndexOf(' '); return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, ''); };

// ─── Prompt ──────────────────────────────────────────────────────────────
const IDEAS_SYSTEM = [
  'You are the ideas editor for EssentiallySports (ES) reels. An editor gives you a topic and the SOURCES ES has on it. You pitch 5 different reel angles, each with a storyboard a producer could shoot today.',
  '',
  'The ES angle (this is what makes a reel ES, use it):',
  '- Fan-first. ES tells "the moments behind the moment": what the story means to the people who watch, not a wire recap.',
  '- Quote-led: a real quote up front, then who said it about whom ("Absolutely a bad decision": X blasts Y). Only quotes that are word for word in SOURCES.',
  '- Verdict: a legend or an insider judges a named star. Name both.',
  '- Money: when SOURCES give a money figure, it leads.',
  '- Fan reaction: "fans turn against…", "cameras catch…". Only when SOURCES say how fans reacted.',
  '- Every reel ends by asking fans one question (the fan-pulse poll).',
  'ES verticals and their newsletters: NFL = The Huddle, college football = Essentially CFB, NBA and WNBA = Essentially Dunk, golf = Essentially Golf, tennis = Break Point, NASCAR = Lucky Dog.',
  '',
  'Return JSON only, no prose:',
  '{"angles":[{"lens":"fan-first|quote-led|verdict|money|fan-reaction|behind-the-moment","angle":"the pitch in one line, at most 18 words","title":"a short working title","recipe":"stat-drop|quote-reaction|explainer|countdown|versus|fan-pulse|verdict|money-story","beats":[{"text":"the on-screen headline of this beat, 2-7 words","vo":"what the ES voice says, 6-24 words","block":{...}}],"poll":{"question":"one question for fans, at most 12 words","options":["2-4 short answers"]},"sources":["a1","t1"]}]}',
  '',
  'Recipes (the beat order): stat-drop = hook, number, statement, statement, endcard. quote-reaction = hook, quote, statement, statement, endcard. explainer = hook, statement, number or compare, statement, endcard. countdown = hook, 3 statements counting down, endcard. versus = hook, compare, statement, statement, endcard. fan-pulse = hook, statement, statement, statement (the question fans are split on), endcard. verdict = hook, quote or statement (the verdict), statement, statement, endcard. money-story = hook, number (the figure), compare or statement, statement, endcard.',
  '',
  director.styleRequest(STYLES.get('es')),
  '',
  'Rules:',
  '1. Facts: every number, score, stat, date, record and money figure must appear in SOURCES exactly. Never invent, round or estimate. No number in SOURCES for a number block? Use a statement.',
  '2. Quotes: only exact words from SOURCES, in quote marks, attributed to the person SOURCES attribute them to. Never put words in a real person\'s mouth. No quote in SOURCES? No quote-led angle.',
  '3. Each angle uses a different lens. Skip a lens SOURCES cannot support (no quote, no money figure, no fan reaction) rather than stretching. 4 good angles beat 5 weak ones.',
  '4. beats: 5-7 per angle. Beat 1 is a hook block; the last is {"type":"endcard"} with "vo":"". 45-95 voiceover words per angle.',
  '5. "sources": the ids of the SOURCES this angle uses (at least one).',
  '6. Poll: a question fans would actually argue about, 2-4 options of 1-3 words. No numbers in the options.',
  '7. ES voice: punchy, confident, plain American sports English, written for the ear. The name fans know comes first. No emojis, hashtags, links, "Breaking", hype words (shocking, insane, unbelievable, you won\'t believe), no repeated !! or ??.',
  '8. TREND IDEAS, when given, are another editor\'s guesses: use them for direction only, never as facts.',
].join('\n');

// ─── Inputs ──────────────────────────────────────────────────────────────
function readTrend(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = clean(raw.title, 300);
  if (!title) return null;
  const url = v => (/^https?:\/\/[^\s"'<>]{4,400}$/.test(String(v || '')) ? String(v) : '');
  return {
    id: String(raw.id || '').replace(/[^\w-]/g, '').slice(0, 80), title,
    sport: IDEA_SPORTS.includes(raw.sport) ? raw.sport : '', team: clean(raw.team, 80), why: clean(raw.why, 300), url: url(raw.url),
    related: arr(raw.related).slice(0, 4).map(r => ({ title: clean(r && r.title, 300), url: url(r && r.url), source: clean(r && r.source, 80) })).filter(r => r.title),
  };
}
function readInput(body = {}) {
  const trend = readTrend(body.trend);
  const topic = clean(body.topic, LIMITS.topic) || (trend ? trend.title : '');
  const sport = IDEA_SPORTS.includes(body.sport) ? body.sport : (trend ? trend.sport : '');
  return { topic, trend, sport, steer: clean(body.steer, LIMITS.steer), tier: body.tier === 'best' ? 'best' : 'main', factCheck: body.factCheck === true };
}
const cacheKey = input => crypto.createHash('sha256').update(JSON.stringify([input.topic.toLowerCase(), input.trend ? input.trend.id || input.trend.title : '', input.sport, input.tier, input.factCheck, input.steer])).digest('hex');

// ─── Gathering ───────────────────────────────────────────────────────────
// One step: never throws, never outlives its budget. -> { value, meta }
async function step(name, ms, run, fallback) {
  const started = Date.now();
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  try {
    const out = await Promise.race([Promise.resolve().then(run).then(value => ({ value })), timeout]);
    if (out.timedOut) return { value: fallback, meta: { ok: false, reason: 'timeout', ms: Date.now() - started } };
    return { value: out.value, meta: { ok: true, ms: Date.now() - started } };
  } catch (error) {
    return { value: fallback, meta: { ok: false, reason: gateway().isBudgetError(error) ? 'budget' : 'error', ms: Date.now() - started, error: String(error && error.message || error).slice(0, 120) } };
  } finally { clearTimeout(timer); }
}

// ES most-read articles (ES MCP, ranked by page views) and tagged coverage
// (with the article body, which backs numbers and quotes deep in a story).
async function esArticles(topic, deps = {}) {
  const es = deps.es || esData();
  const name = String(es.keyTerms(topic) || '').split(' ').slice(0, 2).join(' ');
  const notes = [];
  const mostRead = (async () => {
    const { mcp, tools } = await es.discover(notes);
    if (!mcp || !tools.articles || tools.articles.name !== 'query_articles' || !name) return [];
    return es.queryEsArticles(mcp, tools.articles, name);
  })().catch(() => []);
  const coverage = Promise.resolve().then(() => es.esCoverage(topic)).then(c => arr(c && c.articles)).catch(() => []);
  const [top, tagged] = await Promise.all([mostRead, coverage]);
  const byUrl = new Map();
  top.forEach(a => { if (a && a.url && !byUrl.has(a.url)) byUrl.set(a.url, { ...a, mostRead: true }); });
  tagged.forEach(a => {
    if (!a || !a.url) return;
    const have = byUrl.get(a.url);
    if (have) byUrl.set(a.url, { ...have, date: have.date || a.date, excerpt: a.excerpt || have.excerpt, body: a.body || '', image: a.image || have.image });
    else byUrl.set(a.url, { ...a, mostRead: false });
  });
  return [...byUrl.values()].filter(a => a.title && es.isEsUrl(a.url)).slice(0, LIMITS.articles);
}

const tokens = text => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3));
// The trend on the server's own board (so its headlines are what the feed
// said), plus its cached AI enrichment (why / hook / angle: ideas, not facts).
async function trendContext(input, deps = {}) {
  const td = deps.trendDesign || trendDesign();
  const data = await td.getTrends(false, { window: '2d' });
  const items = arr(data && data.items);
  let hit = input.trend && input.trend.id ? items.find(i => i.id === input.trend.id) : null;
  if (!hit) {
    const want = tokens(input.topic);
    let best = 0;
    items.forEach(item => {
      const have = tokens(item.title);
      let n = 0;
      want.forEach(w => { if (have.has(w)) n += 1; });
      if (n >= 2 && n > best) { best = n; hit = item; }
    });
  }
  if (!hit) return null;
  const ai = typeof td.cachedEnrichment === 'function' ? td.cachedEnrichment(hit.id) : null;
  return {
    id: hit.id, title: clean(hit.title, 300), sport: hit.category || '', url: hit.url || '', source: hit.source || '', publishedAt: hit.publishedAt || '',
    team: hit.team && hit.team.name || '', fit: hit.fit ? Number(hit.fit.score) || 0 : null,
    related: arr(hit.related).slice(0, 4).map(r => ({ title: clean(r.title, 300), url: r.url || '', source: r.source || '' })).filter(r => r.title),
    ideas: ai ? { why: ai.why || '', hook: ai.hook || '', angle: ai.angle || null } : null,
  };
}

// Recent finals of the named team (ESPN scoreboard, free).
async function teamGames({ sport, team }, ctx, deps = {}) {
  const games = deps.games || gamesApi();
  const out = await games.listGames({ sport, when: 'recent' }, ctx);
  if (!out || !out.ok) return [];
  const want = String(team.name || '').toLowerCase();
  const wantShort = String(team.short || '').toLowerCase();
  const is = side => { const n = String(side.name || '').toLowerCase(); return n === want || (wantShort && n.endsWith(` ${wantShort}`)); };
  return arr(out.games).filter(g => g.status && g.status.final && (is(g.teams.home) || is(g.teams.away))).slice(0, 2).map(g => ({
    id: g.id, date: String(g.startsAt || '').slice(0, 10),
    line: `Final${g.startsAt ? ` (${String(g.startsAt).slice(0, 10)})` : ''}: ${g.teams.away.name} ${g.teams.away.score}, ${g.teams.home.name} ${g.teams.home.score}.`,
  }));
}

// A named player's season lines (ESPN, free): the last three seasons and the career row.
async function playerStats({ sport, names }, ctx, deps = {}) {
  const games = deps.games || gamesApi();
  for (const name of names.slice(0, 2)) {
    const found = await games.athlete({ sport, query: name }, ctx);
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
    const pick = arr(found && found.candidates).find(c => norm(c.name) === norm(name));
    if (!pick) continue;
    const full = await games.athlete({ sport, athleteId: pick.athleteId, name: pick.name }, ctx);
    const athlete = full && full.ok ? full.athlete : null;
    if (!athlete || !athlete.stats) continue;
    const lines = DATA.archiveFacts(null, athlete).split('\n').filter(Boolean);
    const seasons = lines.filter(l => /season/.test(l)).slice(-3);
    const career = lines.filter(l => /^Career:/.test(l));
    if (!seasons.length && !career.length) continue;
    return { name: athlete.name || pick.name, url: athlete.source && athlete.source.url || '', text: `${athlete.name || pick.name} (${String(athlete.stats.category || 'stats')}, ESPN). ${[...seasons, ...career].join(' ')}` };
  }
  return null;
}

// Everything the ideas may use. Never throws; every step reports itself.
async function gather(input, { track = null, auth = null, blocked = '', deps = {}, startedAt = Date.now() } = {}) {
  const read = director.readReelBrief({ brief: input.topic, trend: input.trend, sport: input.sport });
  const ctx = { auth };
  const es = deps.es || (() => { try { return esData(); } catch { return null; } })();
  const names = es && typeof es.nameCandidates === 'function'
    ? arr(es.nameCandidates(input.topic)).filter(n => /\s/.test(n) && !(read.team && read.team.name.toLowerCase().includes(n.toLowerCase())))
    : [];
  const sport = input.sport || read.sport;
  const wantGames = Boolean(read.team) && GAME_SPORTS.includes(sport);
  const wantPlayer = names.length > 0 && PLAYER_SPORTS.includes(sport);
  const wantFacts = input.factCheck && !blocked;
  const [articles, trend, games, player, facts] = await Promise.all([
    step('es', STEP_MS.es, () => esArticles(input.topic, { es }), []),
    step('trend', STEP_MS.trend, () => trendContext(input, deps), null),
    wantGames ? step('games', STEP_MS.games, () => teamGames({ sport, team: read.team }, ctx, deps), []) : { value: [], meta: { ok: true, skipped: true } },
    wantPlayer ? step('player', STEP_MS.player, () => playerStats({ sport, names }, ctx, deps), null) : { value: null, meta: { ok: true, skipped: true } },
    wantFacts ? step('factCheck', STEP_MS.factCheck, () => (deps.director || director).factCheck({ topic: input.topic, sport, track }), null) : { value: null, meta: { ok: true, skipped: true } },
  ]);

  // Sources, each with an id the model cites and the text it may use.
  const sources = [];
  const add = (prefix, record) => { const n = sources.filter(s => s.id.startsWith(prefix)).length + 1; sources.push({ id: `${prefix}${n}`, ...record }); };
  const trendTitle = trend.value ? trend.value.title : (input.trend ? input.trend.title : '');
  if (input.topic && squash(input.topic) !== squash(trendTitle)) add('b', { type: 'brief', title: 'Your topic', text: input.topic });
  if (trendTitle) add('t', { type: 'trend', title: trendTitle, url: (trend.value && trend.value.url) || (input.trend && input.trend.url) || '', source: trend.value ? trend.value.source : '', date: trend.value ? String(trend.value.publishedAt).slice(0, 10) : '', text: trendTitle });
  const related = trend.value && trend.value.related.length ? trend.value.related : (input.trend ? input.trend.related : []);
  related.slice(0, LIMITS.news).forEach(r => add('n', { type: 'news', title: r.title, url: r.url, source: r.source, text: r.title }));
  arr(articles.value).forEach(a => add('a', {
    type: 'es', title: clean(a.title, 200), url: a.url, date: a.date || '', mostRead: Boolean(a.mostRead), excerpt: clean(a.excerpt, 300),
    text: [a.title, a.excerpt, a.body].filter(Boolean).join('. '),
  }));
  arr(games.value).forEach(g => add('g', { type: 'game', title: g.line, date: g.date, source: 'ESPN', text: g.line }));
  if (player.value) add('p', { type: 'player', title: `${player.value.name}: season stats`, url: player.value.url, source: 'ESPN', text: player.value.text });
  if (facts.value && facts.value.text) add('f', { type: 'fact-check', title: 'Web fact check', text: facts.value.text, links: arr(facts.value.urls).slice(0, 6).map(u => ({ title: clean(u.title || u.url, 120), url: u.url })) });

  const corpus = sources.map(s => s.text).filter(Boolean).join('\n').slice(0, LIMITS.corpusChars);
  articles.meta.count = arr(articles.value).length;
  trend.meta.count = trend.value ? 1 + trend.value.related.length : 0;
  games.meta.count = arr(games.value).length;
  player.meta.count = player.value ? 1 : 0;
  facts.meta.count = facts.value && facts.value.text ? 1 : 0;
  return {
    read: { ...read, corpus, auto: false, sport: F.SPORTS.some(s => s.id === sport) ? sport : read.sport },
    sport, sources, corpus,
    trendIdeas: trend.value ? trend.value.ideas : null,
    fit: trend.value ? trend.value.fit : null,
    factCost: facts.value ? Number(facts.value.cost) || 0 : 0,
    factCheck: facts.value ? { capped: Boolean(facts.value.capped), urls: arr(facts.value.urls).length } : null,
    steps: { es: articles.meta, trend: trend.meta, games: games.meta, player: player.meta, factCheck: facts.meta },
    ms: Date.now() - startedAt,
  };
}

// What the model sees: every source by id, the top ES stories with their opening.
function ideasRequest(input, g, today = new Date()) {
  const lines = [];
  let room = LIMITS.promptChars;
  let leads = 0;
  g.sources.forEach(s => {
    let body = '';
    if (s.type === 'es') {
      const max = leads < 3 ? 1100 : 320;
      leads += 1;
      body = `ES article${s.mostRead ? ', most read' : ''}${s.date ? ` (${s.date})` : ''}: ${s.text.slice(0, max)}`;
    } else if (s.type === 'news') body = `news${s.source ? ` (${s.source})` : ''}: ${s.text}`;
    else if (s.type === 'trend') body = `trending story: ${s.text}`;
    else if (s.type === 'brief') body = `the editor's topic: ${s.text}`;
    else if (s.type === 'game') body = `game result (ESPN): ${s.text}`;
    else if (s.type === 'player') body = `player stats: ${s.text.slice(0, 900)}`;
    else if (s.type === 'fact-check') body = `web fact check: ${s.text.slice(0, 2200)}`;
    const line = `[${s.id}] ${body}`.slice(0, Math.max(0, room));
    room -= line.length;
    if (line.length > 12) lines.push(line);
  });
  const ideas = g.trendIdeas;
  return [
    `TOPIC: ${input.topic}`,
    `SPORT: ${SPORT_LABEL[g.sport] || 'unknown'}${NEWSLETTERS[g.sport] ? ` (newsletter: ${NEWSLETTERS[g.sport]})` : ''}`,
    g.read.team ? `TEAM: ${g.read.team.name}` : '',
    input.steer ? `EDITOR NOTE: ${input.steer}` : '',
    `TODAY: ${today.toISOString().slice(0, 10)}`,
    ideas && (ideas.why || ideas.hook || ideas.angle) ? `TREND IDEAS (direction only, not facts): ${[ideas.why, ideas.hook, ideas.angle ? `${ideas.angle.lens}: ${ideas.angle.line}` : ''].filter(Boolean).join(' | ')}` : '',
    'SOURCES (the only facts you may use; cite the ids):',
    '<<<',
    lines.join('\n') || '(none)',
    '>>>',
  ].filter(Boolean).join('\n');
}

// ─── Grounding (code) ────────────────────────────────────────────────────
// Words inside quote marks ("…" or “…”) of two words or more.
function quotedSpans(text) {
  const out = [];
  String(text || '').replace(/["“]([^"“”]{6,220})["”]/g, (m, inner) => { if (inner.trim().split(/\s+/).length >= 2) out.push(inner.trim()); return m; });
  return out;
}
function makeChecker(corpus) {
  const sourceSet = F.numberSet(corpus);
  const corpusSq = squash(corpus);
  const inCorpus = text => { const sq = squash(text).trim(); return Boolean(sq) && corpusSq.includes(` ${sq} `); };
  return {
    sourceSet,
    inCorpus,
    badNumbers: beat => F.unsourcedNumbers(beat, sourceSet, 'explainer'),
    badQuotes: texts => texts.flatMap(quotedSpans).filter(q => !inCorpus(q)),
  };
}

// One raw beat -> { beat } | { beat, downgraded } | { dropped }. `beat` is in
// the shape validatePlan reads (kind, text, vo, block).
function groundBeat(raw, check, index) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const type = b.block && ES.BLOCK_TYPES.includes(b.block.type) ? b.block.type : '';
  const block = type ? ES.cleanBlock(b.block) : null;
  const vo = clean(b.vo, 260);
  const text = clean(b.text, 90) || (block ? clean(ES.blockText(block), 90) : '');
  if (block && block.type === 'endcard') return { beat: { kind: 'cta', text: 'What do you make of it?', vo: '', block } };
  if (!block && !text && !vo) return { dropped: true, why: '' };
  const strings = block ? ES.blockStrings(block) : [];
  const why = [];
  if (block && block.type === 'quote') {
    if (!block.text || !check.inCorpus(block.text)) why.push('a quote that is not word for word in the sources');
  }
  const loose = block && block.type === 'quote' ? [text === block.text ? '' : text, vo] : [...strings, text, vo];
  if (check.badQuotes(loose).length) why.push('quoted words that are not in the sources');
  const shaped = block ? { ...ES.legacyFields(block), text, vo, block } : { kind: index === 0 ? 'hook' : 'point', text, vo };
  const bad = check.badNumbers(shaped);
  if (bad.length) why.push(`${bad.join(', ')} (not in the sources)`);
  if (block && block.type === 'number' && !(Number(block.value) > 0)) why.push('a number card with no number');
  if (block && block.type === 'compare' && (block.items || []).length < ES.LIMITS.compareMin) why.push('a comparison with one side');
  if (!why.length) return { beat: block ? { text, vo, block } : { kind: shaped.kind, text, vo } };
  // Downgrade: a plain statement from the beat's own headline, when both the
  // headline and the voiceover are clean on their own.
  const failedQuote = block && block.type === 'quote' ? squash(block.text).trim() : '';
  const lineOk = text && !/["“”]/.test(text) && !check.badNumbers({ text }).length && !(failedQuote && squash(text).includes(failedQuote));
  const voOk = !check.badNumbers({ vo }).length && !check.badQuotes([vo]).length && !(failedQuote && failedQuote.length > 3 && squash(vo).includes(failedQuote)) && !(block && block.type === 'quote' && /["“”]/.test(vo));
  if (lineOk && voOk && vo) {
    const kind = index === 0 ? 'hook' : 'point';
    return { beat: { kind, text, vo, block: ES.blockOf({ kind, text }) }, downgraded: true, why: why[0] };
  }
  return { dropped: true, why: why[0] };
}

// One line that says what a block shows (the storyboard preview on the card).
function previewText(k) {
  if (k.type === 'number') return [k.kicker, k.display || ES.numberDisplay(k), k.label].filter(Boolean).join(' · ').slice(0, 120);
  if (k.type === 'compare') return [k.kicker, (k.items || []).map(it => `${it.label} ${it.display}`).join(' vs ')].filter(Boolean).join(': ').slice(0, 120);
  if (k.type === 'quote') return `“${k.text}”${k.who ? `, ${k.who}` : ''}`.slice(0, 140);
  if (k.type === 'dots') return [k.label, k.note].filter(Boolean).join(' · ').slice(0, 120);
  if (k.type === 'endcard') return 'ES end card';
  return String(ES.blockText(k) || '').slice(0, 120);
}

function cleanPoll(raw, check) {
  const question = clean(raw && raw.question, 110).replace(/["“”]/g, '');
  if (!question || check.badNumbers({ text: question }).length) return null;
  const seen = new Set();
  const options = arr(raw && raw.options).map(o => clean(o, 28)).filter(o => o && !/\d/.test(o) && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase())).slice(0, 4);
  return options.length >= 2 ? { question: /\?$/.test(question) ? question : `${question}?`, options } : null;
}

// One raw angle -> a grounded angle with its ready plan, or null (dropped).
function groundAngle(raw, g, { free = false, index = 0 } = {}) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const lens = LENSES.includes(a.lens) ? a.lens : '';
  if (!lens) return { angle: null, why: 'An angle without an ES lens was dropped.' };
  const check = makeChecker(g.corpus);
  const issues = [];
  let downgraded = 0;
  let droppedBeats = 0;
  const beats = [];
  const rawBeats = arr(a.beats).slice(0, LIMITS.beats);
  for (let i = 0; i < rawBeats.length; i += 1) {
    const out = groundBeat(rawBeats[i], check, beats.length);
    if (out.dropped) {
      droppedBeats += 1;
      if (out.why) issues.push(`A beat with ${out.why} was dropped.`);
      if (!beats.length) return { angle: null, why: `"${LENS_LABEL[lens]}" was dropped: its hook used ${out.why || 'nothing usable'}.` };
      continue;
    }
    if (out.downgraded) { downgraded += 1; issues.push(`A beat with ${out.why} became a plain statement.`); }
    beats.push(out.beat);
  }
  // The hook leads, as a hook block.
  if (beats.length && !(beats[0].block && beats[0].block.type === 'hook')) {
    beats[0] = { ...beats[0], kind: 'hook', block: ES.blockOf({ kind: 'hook', text: beats[0].text }) };
  }
  const content = beats.filter((b, i) => i > 0 && b.kind !== 'cta');
  if (!beats.length || content.length < 2) return { angle: null, why: `"${LENS_LABEL[lens]}" was dropped: too little of it was backed by the sources.` };
  if (droppedBeats + downgraded > Math.max(1, Math.floor(rawBeats.length / 2))) return { angle: null, why: `"${LENS_LABEL[lens]}" was dropped: most of it was not backed by the sources.` };
  // A lens has to be earned: a quote-led angle needs a verified quote, a money
  // angle a sourced figure on screen.
  const onScreen = beats.flatMap(b => (b.block ? ES.blockStrings(b.block) : [b.text]));
  const hasQuote = beats.some(b => b.block && b.block.type === 'quote') || onScreen.concat(beats.map(b => b.vo)).some(t => quotedSpans(t).length);
  if (lens === 'quote-led' && !hasQuote) return { angle: null, why: '"Quote led" was dropped: no quote in the sources backed it.' };
  if (lens === 'money' && !onScreen.some(t => /\d/.test(t))) return { angle: null, why: '"Money" was dropped: no figure in the sources backed it.' };

  const hookText = clean(ES.blockText(beats[0].block), 90);
  let line = clean(a.angle, 160);
  if (!line || check.badNumbers({ text: line }).length || check.badQuotes([line]).length) line = hookText;
  let title = clean(a.title, 90);
  if (!title || check.badNumbers({ text: title }).length || check.badQuotes([title]).length) title = hookText;
  const known = new Set(g.sources.map(s => s.id));
  const cited = [...new Set(arr(a.sources).map(String).filter(id => known.has(id)))].slice(0, 8);
  const recipe = RECIPES.includes(a.recipe) ? a.recipe : RECIPE_FOR_LENS[lens];
  const checked = director.validatePlan({ format: 'explainer', title, angle: line, team: g.read.team ? g.read.team.name : '', beats }, { read: g.read, format: 'explainer', style: 'es' });
  const plan = checked.plan;
  const body = plan.beats.filter(b => b.kind !== 'cta');
  if (body.length < 3 || !plan.beats[0].block || plan.beats[0].block.type !== 'hook') return { angle: null, why: `"${LENS_LABEL[lens]}" was dropped: too little of it was backed by the sources.` };
  const poll = cleanPoll(a.poll, check);
  plan.format = 'explainer';
  plan.style = 'es';
  plan.lens = lens;
  plan.recipe = recipe;
  if (poll) plan.poll = poll;
  const all = [...issues, ...checked.issues];
  return {
    angle: {
      id: `i${index + 1}`, lens, lensLabel: LENS_LABEL[lens], angle: line, title: plan.title, recipe,
      hook: { pills: plan.beats[0].block.pills, stamp: plan.beats[0].block.stamp || null },
      storyboard: plan.beats.map(b => { const k = ES.blockOf(b); return { type: k.type, text: previewText(k) || b.text, vo: b.vo || '' }; }),
      poll, sources: cited.length || free ? cited : g.sources.filter(s => s.type !== 'brief').slice(0, 1).map(s => s.id),
      plan, issues: [...new Set(all)].slice(0, 6), downgraded, free, voWords: checked.voWords,
    },
  };
}

function groundAll(rawAngles, g, opts = {}) {
  const angles = [];
  const dropped = [];
  const lensSeen = new Set();
  arr(rawAngles).slice(0, 8).forEach(raw => {
    if (angles.length >= LIMITS.angles) return;
    const out = groundAngle(raw, g, { ...opts, index: angles.length });
    if (!out.angle) { if (out.why) dropped.push(out.why); return; }
    // One angle per lens (the first that holds up).
    if (lensSeen.has(out.angle.lens)) return;
    lensSeen.add(out.angle.lens);
    angles.push(out.angle);
  });
  // Banned style words are surfaced, never silently shipped.
  angles.forEach(angle => angle.plan.beats.forEach(b => RULES.BANNED.forEach(rule => { if (rule.re.test(`${b.text} ${b.vo}`) && !angle.issues.includes(`${rule.why}.`)) angle.issues.push(`${rule.why}.`); })));
  return { angles, dropped };
}

// ─── Free mode: template angles from titles and facts (no AI) ────────────
const sentence = text => { const t = clean(text, 200).replace(/[.!?]+$/, ''); return t ? `${t}.` : ''; };
const MONEY_RE = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(million|billion|thousand|m|bn|b|k)?\b/i;
function moneyIn(text) {
  const m = String(text || '').match(MONEY_RE);
  if (!m) return null;
  const unit = String(m[2] || '').toLowerCase();
  const suffix = /^(million|m)$/.test(unit) ? 'M' : /^(billion|bn|b)$/.test(unit) ? 'B' : /^(thousand|k)$/.test(unit) ? 'K' : '';
  const value = Number(m[1].replace(/,/g, ''));
  if (!(value > 0) || String(Math.round(value)).length > ES.LIMITS.digits) return null;
  return { value, suffix, display: `$${m[1]}${suffix}` };
}
const FREE_POLLS = {
  'fan-first': { question: 'Where do you stand on this one?', options: ['All in', 'Not sold'] },
  'quote-led': { question: 'Fair call, or out of line?', options: ['Fair call', 'Out of line'] },
  verdict: { question: 'Is the verdict right?', options: ['Spot on', 'Way off'] },
  money: { question: 'Worth the money?', options: ['Worth it', 'Overpaid'] },
  'fan-reaction': { question: 'Are the fans right about this?', options: ['Fans are right', 'Too harsh'] },
  'behind-the-moment': { question: 'What did you notice first?', options: ['The moment', 'The reaction'] },
};
const FREE_LEAD = {
  'fan-first': 'What this means for fans',
  'quote-led': 'The line everyone is repeating',
  verdict: 'The verdict on',
  money: 'Follow the money',
  'fan-reaction': 'How fans are taking it',
  'behind-the-moment': 'The moment behind the moment',
};
function freeAngles(input, g) {
  const titled = g.sources.filter(s => ['trend', 'es', 'news'].includes(s.type) && s.title);
  const es = titled.filter(s => s.type === 'es');
  const lead = titled[0] || { id: '', title: input.topic };
  const facts = g.sources.filter(s => s.type === 'game' || s.type === 'player');
  const statement = (source, kind = 'point') => ({ text: short(source.title, 60), vo: sentence(source.title), block: ES.blockOf({ kind, text: short(source.title.replace(/["“”]/g, ''), 60) }), _src: source.id });
  const hookFor = source => ({ text: short(source.title.replace(/["“”]/g, ''), 44), vo: sentence(source.title), block: ES.blockOf({ kind: 'hook', text: short(source.title.replace(/["“”]/g, ''), 44) }), _src: source.id });
  const end = { block: { type: 'endcard' }, vo: '' };
  const others = (skip, n) => titled.filter(s => !skip.includes(s.id)).slice(0, n);
  const build = (lens, beats, extra = {}) => ({
    lens, angle: `${FREE_LEAD[lens]}: ${short(lead.title.replace(/["“”]/g, ''), 90)}`, title: short(lead.title.replace(/["“”]/g, ''), 80), recipe: RECIPE_FOR_LENS[lens],
    beats: [...beats.map(({ _src, ...b }) => b), end], poll: FREE_POLLS[lens], sources: [...new Set(beats.map(b => b._src).filter(Boolean))], ...extra,
  });
  const out = [];
  const factBeats = facts.slice(0, 1).map(s => ({ text: short(s.title, 60), vo: sentence(s.title), block: ES.blockOf({ kind: 'point', text: short(s.title, 60) }), _src: s.id }));

  // Fan first: the story, then what ES has written on it.
  out.push(build('fan-first', [hookFor(lead), ...others([lead.id], 3).map(s => statement(s)), ...factBeats]));

  // Quote led: an exact quote found in the sources (attributed to the coverage, not to a guess).
  const quoteSource = g.sources.find(s => quotedSpans(s.text).some(q => q.length <= ES.LIMITS.quoteChars && q.split(/\s+/).length >= 3));
  if (quoteSource) {
    const quote = quotedSpans(quoteSource.text).find(q => q.length <= ES.LIMITS.quoteChars && q.split(/\s+/).length >= 3);
    out.push(build('quote-led', [
      hookFor(lead),
      { text: short(quote, 60), vo: 'Here is the line, word for word, from the coverage.', block: { type: 'quote', text: quote, who: quoteSource.type === 'es' ? 'VIA ESSENTIALLYSPORTS' : 'VIA THE COVERAGE' }, _src: quoteSource.id },
      ...others([lead.id], 2).map(s => statement(s)),
    ]));
  }

  // Money: a figure found in the sources leads.
  const moneySource = g.sources.find(s => moneyIn(s.text));
  if (moneySource) {
    const m = moneyIn(moneySource.text);
    out.push(build('money', [
      hookFor(lead),
      { text: 'The money', vo: sentence(moneySource.title), block: { type: 'number', kicker: 'THE MONEY', value: m.value, prefix: '$', suffix: m.suffix, label: '', color: 'green', display: m.display }, _src: moneySource.id },
      ...others([lead.id, moneySource.id], 2).map(s => statement(s)),
      ...(others([lead.id, moneySource.id], 2).length < 2 ? [statement(moneySource)] : []),
    ]));
  }

  // Verdict and fan reaction: only when a headline itself carries one.
  const verdict = titled.find(s => /\b(says?|blasts?|slams?|calls?|claims?|admits?|warns?|believes?|verdict|rips?|defends?|backs?)\b/i.test(s.title));
  if (verdict) out.push(build('verdict', [hookFor(verdict), ...others([verdict.id], 3).map(s => statement(s))]));
  const reaction = titled.find(s => /\b(fans?|reacts?|reaction|crowd|cameras?|social media|boo(?:s|ed)?|cheers?)\b/i.test(s.title));
  if (reaction) out.push(build('fan-reaction', [hookFor(reaction), ...others([reaction.id], 3).map(s => statement(s))]));

  // Behind the moment: ES's own coverage first.
  const behind = es[1] || es[0] || titled[1];
  if (behind && behind.id !== lead.id) out.push(build('behind-the-moment', [hookFor(behind), statement(lead), ...others([behind.id, lead.id], 2).map(s => statement(s)), ...factBeats]));
  return out;
}

// ─── Run ─────────────────────────────────────────────────────────────────
const publicSource = ({ text, ...s }) => s;
const NOTICES = {
  free: '',
  off: 'AI is off, so these are free drafts built from the headlines and facts found.',
  'weekly-limit': 'The weekly AI budget is used up, so these are free drafts built from the headlines and facts found.',
  limit: "You've used a lot of AI this hour, so these are free drafts built from the headlines and facts found.",
  budget: 'The AI budget is used up, so these are free drafts built from the headlines and facts found.',
  error: 'The AI did not answer, so these are free drafts built from the headlines and facts found.',
  weak: 'The AI ideas did not hold up against the sources, so these are free drafts built from the headlines and facts found.',
};

// body: { topic, trend?, sport?, tier?: 'best', factCheck?, steer? }
// opts: { track, auth, blocked: '' | 'free' | 'off' | 'weekly-limit' | 'limit', deps }
async function run(body, { track = null, auth = null, blocked = '', deps = {}, now = () => Date.now() } = {}) {
  const startedAt = now();
  const input = readInput(body);
  if (input.topic.length < 3) return { ok: false, status: 400, reason: 'input', error: 'Type a topic or pick a trend first.' };
  const key = cacheKey(input);
  const hit = CACHE.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS && !blocked) return { ...hit.value, cached: true, cost: 0, costs: { ideas: 0, factCheck: 0 } };

  const g = await gather(input, { track, auth, blocked, deps, startedAt });
  const base = {
    ok: true, topic: input.topic, sport: g.sport, newsletter: NEWSLETTERS[g.sport] || '', tier: input.tier,
    sources: g.sources.map(publicSource), steps: g.steps, fit: g.fit, factCheck: g.factCheck,
    corpus: g.corpus.slice(0, 12000), cached: false, prices: PRICES,
  };
  const free = reason => {
    const made = groundAll(freeAngles(input, g), g, { free: true });
    return {
      ...base, source: 'free', free: true, reason, notice: NOTICES[reason] || '', model: '',
      angles: made.angles, dropped: [], issues: [],
      costs: { ideas: 0, factCheck: money(g.factCost) }, cost: money(g.factCost),
    };
  };
  if (blocked) return free(blocked);
  let api;
  try { api = deps.gateway || gateway(); } catch { api = null; }
  if (!api || !api.gatewayConfigured()) return free('off');

  const timeoutMs = Math.max(AI_MS.min, Math.min(AI_MS.max, BUDGET_MS - (now() - startedAt)));
  let reply;
  try {
    reply = await api.aiText({
      tier: input.tier, system: IDEAS_SYSTEM, cacheSystem: true, json: true,
      messages: [{ role: 'user', content: ideasRequest(input, g) }],
      effort: 'low', maxTokens: 4600, timeoutMs,
      track: track ? { ...track, feature: input.tier === 'best' ? `${FEATURE}-sonnet` : FEATURE } : undefined,
    });
  } catch (error) {
    return free(api.isBudgetError && api.isBudgetError(error) ? 'budget' : 'error');
  }
  const cost = Number(reply.cost) || 0;
  const parsed = extractJson(reply.text) || {};
  const made = groundAll(parsed.angles, g);
  if (made.angles.length < LIMITS.minAngles) {
    const fallback = free('weak');
    return { ...fallback, dropped: made.dropped.slice(0, 6), costs: { ideas: money(cost), factCheck: money(g.factCost) }, cost: money(cost + g.factCost), model: reply.model || '' };
  }
  const value = {
    ...base, source: 'ai', free: false, reason: '', notice: '', model: reply.model || '',
    angles: made.angles, dropped: made.dropped.slice(0, 6), issues: [],
    costs: { ideas: money(cost), factCheck: money(g.factCost) }, cost: money(cost + g.factCost),
  };
  CACHE.set(key, { at: now(), value });
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return value;
}

// ─── ES coverage for a normal reel plan (reel-maker.js plan()) ───────────
// Soft-fail inside its budget: { text, sources } (empty on a miss). The text
// joins the director's SOURCES, so news reels can use ES's own reporting.
async function esSources(topic, { budgetMs = 6000, maxChars = 3600, deps = {} } = {}) {
  const subject = clean(topic, 600);
  if (subject.length < 6 || maxChars < 400) return { text: '', sources: [] };
  const out = await step('es', budgetMs, async () => {
    const es = deps.es || esData();
    const found = await es.esCoverage(subject);
    return arr(found && found.articles).filter(a => a && a.title && es.isEsUrl(a.url)).slice(0, 4);
  }, []);
  const articles = arr(out.value);
  if (!articles.length) return { text: '', sources: [], reason: out.meta.reason || 'none' };
  const each = Math.floor(maxChars / articles.length);
  const text = articles.map(a => clean(`ES article${a.date ? ` (${a.date})` : ''}: ${a.title}. ${a.excerpt || ''} ${a.body || ''}`, each)).join('\n').slice(0, maxChars);
  return { text, sources: articles.map(a => ({ type: 'es', title: clean(a.title, 200), url: a.url, date: a.date || '', source: 'EssentiallySports' })) };
}

module.exports = {
  run, gather, esSources, groundAngle, groundAll, groundBeat, freeAngles, ideasRequest, readInput, cleanPoll, previewText, quotedSpans, moneyIn,
  IDEAS_SYSTEM, FEATURE, PRICES, LIMITS, LENSES, LENS_LABEL, RECIPES, RECIPE_FOR_LENS, IDEA_SPORTS, NEWSLETTERS, CACHE, CACHE_TTL_MS, BUDGET_MS, STEP_MS,
  _test: { step, esArticles, trendContext, teamGames, playerStats, makeChecker, cacheKey },
};
