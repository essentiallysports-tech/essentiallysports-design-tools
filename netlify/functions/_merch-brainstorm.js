'use strict';
// Merch Designs: the Brainstorm room (POST /api/merch, modes brainstorm-*).
// A shared board of shirt lines per trend (or per person's line): the team
// asks the AI for lines, adds their own, stars the best and sends them to the
// studio. API shapes: see the merch.js header and the brainstorm API notes.
//
//   brainstorm-open  { trend?, content?, designMode } -> { session, context, created, cost }
//   brainstorm-get   { sessionId, withContext? }      -> { session, context? }          ($0, for polling)
//   brainstorm-turn  { sessionId, prompt? | action?, designMode } -> { lines, note, session, designMode, fellBack?, dropped, cost }
//   brainstorm-line  { sessionId, lineId, op: star|unstar|edit|remove, text? } -> { session }
//   brainstorm-add   { sessionId, text }               -> { line, session }
//   brainstorm-list  {}                                -> { sessions: [...], storage }
//
// Context (gathered once per board, kept 6 h): the trend headline + related
// headlines (the feed), ES's own articles (es-generate esData.esCoverage, 6 s,
// soft-fail) and a live web fact check (one search, ~$0.011, 12 s, soft-fail,
// feature 'merch-brainstorm-context'). Their text is the only place numbers
// and quotes on a line may come from.
//
// Turns: Basic = main tier (Haiku), Pro = best tier (Sonnet), feature
// 'merch-brainstorm'. aiText with allowCutoff + partialItems, so a reply cut
// off at the token limit keeps its complete lines. Every line is checked in
// code: <= 32 characters, <= 6 words, numbers only from the sources, quote
// marks only around exact source words, no league marks / "official" /
// banned words, no repeat of a board line. Free mode / weekly cap: no AI
// turn; up to 4 lines from the headlines' own words, with a note.
//
// createBrainstorm(deps) takes merch.js's helpers so the rules stay in one place.

const crypto = require('node:crypto');
const defaultStore = require('./_merch-brainstorm-store.js');

const FEATURES = Object.freeze({ turns: 'merch-brainstorm', context: 'merch-brainstorm-context' });
const LIMITS = Object.freeze({
  prompt: 300, aiText: 32, aiWords: 6, personText: 60, why: 140, note: 200, lines: 150, turns: 40, newLines: 6,
  boardForAi: 80, chatForAi: 6, headlines: 7, esArticles: 6, facts: 8, factUrls: 6, nicknames: 6, corpus: 14000, list: 20, rights: 6,
  moreLike: 3, audience: 60,
});
const CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const ES_TIMEOUT_MS = 6000;
const WEB_TIMEOUT_MS = 12000;
// One web search (the Gateway bills $0.01 each) + Haiku reading the results.
const WEB_CHECK = Object.freeze({ maxUses: 1, maxCostUsd: 0.01, maxTokens: 700 });
const TURN_TOKENS = Object.freeze({ basic: 1500, pro: 2000 });
const TURN_TIMEOUT = Object.freeze({ basic: 30000, pro: 45000 });
const ANGLES = ['quote', 'nickname', 'chant', 'callback', 'pun', 'stat', 'rivalry', 'era', 'city', 'player', 'troll'];
const ANGLE_ALIASES = { wordplay: 'pun', 'city-pride': 'city', citypride: 'city', 'city pride': 'city', trolling: 'troll', numbers: 'stat', history: 'era' };
const ANGLE_ASK = {
  quote: 'exact words from SOURCES (in quote marks), short enough for a shirt',
  nickname: 'nicknames fans really use (from SOURCES or plainly known)',
  chant: 'chants fans would shout in the stands',
  callback: 'callbacks to the moment itself',
  pun: 'wordplay and puns on the moment',
  stat: 'a number from SOURCES, worn like a ticket stub',
  rivalry: 'the rivalry: pick a side',
  era: 'the era: callbacks to the team\'s history',
  city: 'city and home-town pride',
  player: 'a player fans love (a nickname or surname, never the full name alone)',
  troll: 'playful trolling of the rival, in good taste',
};
const TONES = {
  funnier: 'Make them funnier.', emotional: 'More emotional: for the fans who lived it.', shorter: 'Shorter: 1-3 words each.',
  bolder: 'Bolder and louder.', classier: 'Classier and understated.',
};
const TONE_ALIASES = { funny: 'funnier', 'more emotional': 'emotional', emotive: 'emotional', short: 'shorter', bold: 'bolder', classy: 'classier' };
const RIGHTS_KINDS = ['name', 'nickname', 'quote', 'team'];
const FREE_NOTES = {
  free: 'AI is paused right now, so these lines come from the headlines\' own words (no AI). Add your own below, or try again later.',
  cap: 'You\'ve used this week\'s AI budget, so the AI can\'t brainstorm for you until it resets. These lines come from the headlines (no AI); add your own below.',
};

function createBrainstorm(deps) {
  const {
    json, clip, fold, aiGate, isAdmin, fellBackFor, LEAGUE_MARKS, OFFICIAL_RE, BANNED = [], quoteInSource,
    headlineLine, partialItems, parseJson, usd, SPORT_LABEL, designModeOf, contentOf, trendOf, fullTrend,
    G, AI_TIER, PRO_TIER, teamPalette, hash,
  } = deps;
  const gateway = () => require('./_ai-gateway.js');
  let store = deps.store || defaultStore;
  let sources = {
    es: topic => require('./es-generate.js').esData.esCoverage(topic),
    web: args => gateway().aiWebResearch(args),
  };
  const INFLIGHT = new Map(); // board key -> context promise (one gather per instance at a time)

  const now = () => new Date().toISOString();
  const lower = v => String(v || '').trim().toLowerCase();
  const lineId = () => `bl-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const turnId = () => `bt-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
  // Letters and digits only: "Frozen-Tundra!" and "FROZEN TUNDRA" are the same line.
  const key = s => fold(s).replace(/[^a-z0-9]+/g, '');
  const straight = s => String(s || '').replace(/[“”«»„]/g, '"').replace(/[‘’‛]/g, "'").replace(/\s+/g, ' ').trim();
  const words = s => String(s || '').split(/\s+/).filter(Boolean);
  const numbersIn = s => String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
  const cleanText = (v, n) => { const t = clip(straight(v), n); return t && !OFFICIAL_RE.test(t) && !BANNED.some(b => b.re.test(t)) ? t : ''; };

  // ─── The rules ────────────────────────────────────────────────────────────
  // The first rule a text breaks (a sentence for the person), or ''.
  function ruleProblem(text) {
    const mark = LEAGUE_MARKS.find(m => new RegExp(`(^|[^A-Za-z])${m}($|[^A-Za-z])`, 'i').test(text));
    if (mark) return `"${mark}" is a league or event trademark. ES merch can't print it.`;
    const off = String(text).match(OFFICIAL_RE);
    if (off) return `"${off[0]}" suggests a licence ES doesn't have. Leave it out.`;
    const banned = BANNED.find(b => b.re.test(text));
    if (banned) return `Not ES style: ${banned.why}.`;
    return '';
  }
  // An AI (or code) line. -> { text } or { why: 'long'|'number'|'quote'|'rules'|'empty', error }
  function checkAiLine(raw, corpus) {
    const text = straight(typeof raw === 'string' ? raw : raw?.text);
    if (!text) return { why: 'empty', error: 'Type a line.' };
    if (text.length > LIMITS.aiText || words(text).length > LIMITS.aiWords) return { why: 'long', error: `Keep it to ${LIMITS.aiWords} words and ${LIMITS.aiText} characters.` };
    const src = String(corpus || '');
    const have = new Set(numbersIn(src));
    const invented = numbersIn(text).filter(n => !have.has(n));
    if (invented.length) return { why: 'number', error: `${invented.join(', ')} isn't in the sources. Numbers on merch must come from the story.` };
    if (/"/.test(text)) {
      const quoted = [...text.matchAll(/"([^"]+)"/g)].map(m => m[1]);
      const unbalanced = (text.match(/"/g) || []).length % 2 === 1;
      if (unbalanced || !quoted.length || quoted.some(q => !quoteInSource(q, src))) return { why: 'quote', error: 'Quote marks only go around words copied exactly from the sources.' };
    }
    const problem = ruleProblem(text);
    if (problem) return { why: 'rules', error: problem };
    return { text: text.toUpperCase() };
  }
  // A person's own words: only league marks / official / banned words are checked.
  function checkPersonLine(raw) {
    const text = straight(raw).slice(0, LIMITS.personText + 1);
    if (!text) return { why: 'empty', error: 'Type a line.' };
    if (text.length > LIMITS.personText) return { why: 'long', error: `Keep it under ${LIMITS.personText} characters.` };
    const problem = ruleProblem(text);
    if (problem) return { why: 'rules', error: problem };
    return { text };
  }
  // Rights flags: what the AI listed (known kinds) + quotes, nicknames and the team found in code.
  function rightsFor(text, ctx = {}, listed = []) {
    const out = [];
    const add = (kind, t) => {
      const v = clip(straight(t), 120);
      if (RIGHTS_KINDS.includes(kind) && v && !out.some(r => r.kind === kind && key(r.text) === key(v))) out.push({ kind, text: v });
    };
    (Array.isArray(listed) ? listed : []).forEach(r => add(r?.kind, r?.text));
    [...straight(text).matchAll(/"([^"]+)"/g)].forEach(m => add('quote', m[1]));
    const plain = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
    const t = ` ${plain(text)} `;
    (ctx.nicknames || []).forEach(n => { const f = plain(n); if (f && t.includes(` ${f} `)) add('nickname', n); });
    const team = ctx.team || null;
    if (team) {
      const names = [team.name, team.short].map(plain).filter(n => n && n.length >= 3);
      if (names.some(n => t.includes(` ${n} `))) add('team', team.name);
    }
    return out.slice(0, LIMITS.rights);
  }

  // ─── Context ──────────────────────────────────────────────────────────────
  async function step(ms, run) {
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
    try {
      const out = await Promise.race([Promise.resolve().then(run).then(value => ({ value })), timeout]);
      return out.timedOut ? { error: 'timeout' } : out;
    } catch (error) {
      return { error: gateway().isBudgetError(error) ? 'budget' : clip(error?.message || error, 120) || 'error' };
    } finally { clearTimeout(timer); }
  }
  function nicknamesFrom(texts) {
    const out = [];
    const add = n => {
      const v = clip(straight(n).replace(/^the\s+/i, ''), 40).replace(/[.,;:!?]+$/, '');
      if (v.length >= 3 && words(v).length <= 4 && !ruleProblem(v) && !out.some(x => key(x) === key(v))) out.push(v);
    };
    texts.forEach(t => {
      const s = straight(t);
      [...s.matchAll(/"([^"]{3,40})"/g)].forEach(m => add(m[1]));
      [...s.matchAll(/\b(?:nicknamed|dubbed|known as|nickname)\s+(?:the\s+)?"?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/g)].forEach(m => add(m[1]));
    });
    return out.slice(0, LIMITS.nicknames);
  }
  function factsFrom(text) {
    return String(text || '').split(/\n+/)
      .map(l => clip(l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*|__|`|#+\s*/g, ''), 220))
      .filter(l => l.length >= 12 && !/^(here are|sources?:|verified facts|key facts)/i.test(l))
      .slice(0, LIMITS.facts);
  }
  // -> context (stored on the board). Never throws.
  async function gatherContext({ trend, text, sport, track, web = true }) {
    const notes = [];
    const title = trend ? trend.title : clip(text, 120);
    const team = trend?.team ? { name: clip(trend.team.name, 60), short: clip(trend.team.short, 20) } : null;
    const sp = (trend?.category || sport || '').toLowerCase();
    const headlines = trend ? [{ title: trend.title, source: trend.source || '', url: trend.url || '' }, ...(trend.related || []).map(r => ({ title: r.title, source: r.source || '', url: r.url || '' }))].slice(0, LIMITS.headlines) : [];
    const topic = trend ? [trend.title, trend.related?.[0]?.title].filter(Boolean).join('. ') : clip(text, 300);
    const esRun = step(ES_TIMEOUT_MS, () => sources.es(topic));
    let webRun = Promise.resolve(null);
    let webCost = 0;
    if (web) {
      const gate = await aiGate(FEATURES.context, track);
      if (gate?.free) notes.push(gate.free === 'feature-off' ? 'Web check: switched off' : gate.budget === 'user-limit' ? 'Web check: your weekly AI budget is used' : 'Web check: AI is paused');
      else if (gate?.reply) notes.push(gate.hourly ? 'Web check: hourly AI limit' : 'Web check: AI budget reached');
      else {
        webRun = step(WEB_TIMEOUT_MS, () => sources.web({
          tier: AI_TIER,
          system: 'You check facts for a sports merch brainstorm. Answer in short plain lines, one fact per line: the key facts, nicknames and every number (scores, stats, records, dates) about the story, each with its source site in brackets. Only facts you found in search results. No opinions, no intro line.',
          prompt: `Story${sp ? ` (${(SPORT_LABEL[sp] || sp).toUpperCase()})` : ''}: ${topic}\nList the verified facts, numbers and nicknames fans use.`,
          maxUses: WEB_CHECK.maxUses, maxCostUsd: WEB_CHECK.maxCostUsd, maxTokens: WEB_CHECK.maxTokens, timeoutMs: WEB_TIMEOUT_MS,
          track: { ...track, feature: FEATURES.context },
        }));
      }
    } else notes.push('Web check: not run');
    const [es, wr] = await Promise.all([esRun, webRun]);
    const articles = (Array.isArray(es?.value?.articles) ? es.value.articles : [])
      .filter(a => a && clip(a.title, 300) && /^https:\/\/([\w-]+\.)*essentiallysports\.com\//i.test(String(a.url || '')))
      .slice(0, LIMITS.esArticles);
    if (es?.error) notes.push(`ES articles: ${es.error === 'timeout' ? 'timeout' : 'unavailable'}`);
    else if (!articles.length) notes.push('ES articles: none found');
    let facts = []; let factUrls = []; let factText = '';
    if (wr) {
      if (wr.error) notes.push(`Web check: ${wr.error === 'timeout' ? 'timeout' : wr.error === 'budget' ? 'AI budget reached' : 'unavailable'}`);
      else {
        webCost = Number(wr.value?.cost) || 0;
        factText = clip(wr.value?.text, 4000);
        facts = factsFrom(wr.value?.text);
        factUrls = (Array.isArray(wr.value?.urls) ? wr.value.urls : []).filter(u => /^https:\/\//.test(String(u?.url || ''))).slice(0, LIMITS.factUrls).map(u => ({ title: clip(u.title, 160), url: clip(u.url, 600) }));
        if (!facts.length) notes.push('Web check: nothing verified');
      }
    }
    const esText = articles.map(a => [clip(a.title, 300), clip(a.excerpt, 400), clip(a.body, 1500)].filter(Boolean).join('\n')).join('\n');
    const corpus = clip([text, ...headlines.map(h => h.title), esText, factText].filter(Boolean).join('\n'), LIMITS.corpus);
    let palette = null;
    try { palette = teamPalette ? teamPalette(team?.name || '') : null; } catch { palette = null; }
    return {
      title, sport: sp, sportLabel: SPORT_LABEL[sp] || '', team,
      colours: palette ? [palette.a, palette.b].filter(Boolean) : [], palette,
      headlines, esArticles: articles.map(a => ({ title: clip(a.title, 300), url: clip(a.url, 600), date: clip(a.date, 20), excerpt: clip(a.excerpt, 300) })),
      facts, factUrls, nicknames: nicknamesFrom([...headlines.map(h => h.title), ...articles.map(a => `${a.title} ${a.excerpt || ''}`), factText, trend ? '' : text]),
      corpus, gatheredAt: now(), sources: { trend: Boolean(trend), es: articles.length > 0, web: facts.length > 0 }, notes, cost: usd(webCost),
    };
  }
  const contextFresh = ctx => Boolean(ctx?.gatheredAt) && Date.now() - Date.parse(ctx.gatheredAt) < CONTEXT_TTL_MS;
  function publicContext(ctx) {
    if (!ctx || !ctx.gatheredAt) return null;
    const { corpus, cost, ...rest } = ctx;
    return { ...rest, esArticles: (ctx.esArticles || []).map(a => ({ title: a.title, url: a.url, date: a.date || '' })) };
  }

  // ─── Boards ───────────────────────────────────────────────────────────────
  function peopleOf(b) {
    const out = [];
    const add = e => { const v = lower(e); if (v && !out.includes(v)) out.push(v); };
    add(b.createdBy);
    (b.lines || []).forEach(l => { add(l.by); (l.starred || []).forEach(add); });
    (b.turns || []).forEach(t => add(t.by));
    return out;
  }
  function publicSession(b) {
    return {
      id: b.id, key: b.key, trendId: b.trendId || null, title: b.title || '', sport: b.sport || '', team: b.team || null,
      createdBy: b.createdBy || '', createdAt: b.createdAt, updatedAt: b.updatedAt, contextAt: b.context?.gatheredAt || null,
      lines: b.lines || [], turns: b.turns || [], people: peopleOf(b), storage: b.storage || store.mode(),
    };
  }
  const fail = (status, reason, error) => json(status, { ok: false, reason, error });
  const notFound = () => fail(404, 'not-found', 'That brainstorm board is gone. Open it again from the moment.');
  const storeFail = error => {
    if (error?.code === 'busy') return fail(409, 'busy', 'Someone else just changed this board. Try again.');
    if (error?.code === 'not-found') return notFound();
    if (error?.code === 'forbidden') return fail(403, 'forbidden', error.message);
    if (error?.code === 'input') return fail(400, error.reason || 'input', error.message);
    console.error('merch brainstorm store failed:', error?.message || error);
    return fail(503, 'store', 'The brainstorm board is unavailable right now. Try again in a moment.');
  };
  const userError = (message, reason = 'input') => Object.assign(new Error(message), { code: 'input', reason });

  async function openMode(body, track) {
    const trend = trendOf(body);
    const text = contentOf(body);
    if (!trend && text.length < 3) return fail(400, 'input', 'Type a line first, or open a moment to brainstorm on.');
    const boardKey = trend?.id || `line:${hash(fold(trend ? trend.title : text))}`;
    const sport = String(body.sport || '').toLowerCase();
    let board;
    let created = false;
    try {
      board = await store.getByKey(boardKey);
      if (!board) {
        const r = await store.create({
          key: boardKey, trendId: trend?.id || null, title: clip(trend ? trend.title : text, 300), sport: trend?.category || (SPORT_LABEL[sport] ? sport : ''),
          team: trend?.team ? { name: clip(trend.team.name, 60), short: clip(trend.team.short, 20) } : null, context: {}, lines: [], turns: [], createdBy: lower(track.email),
        });
        board = r.board; created = r.created;
      }
    } catch (error) { return storeFail(error); }
    let cost = 0; let cached = true;
    if (!contextFresh(board.context)) {
      cached = false;
      let pending = INFLIGHT.get(boardKey);
      if (!pending) {
        pending = (async () => {
          const full = trend ? await fullTrend(trend) : null;
          return gatherContext({ trend: full, text: trend ? '' : text, sport: board.sport, track });
        })();
        INFLIGHT.set(boardKey, pending);
        pending.finally(() => INFLIGHT.delete(boardKey)).catch(() => {});
        const ctx = await pending;
        cost = ctx.cost || 0;
        try {
          board = await store.mutate(board.id, b => {
            if (contextFresh(b.context)) return null; // a teammate's open saved one first
            b.context = ctx;
            if (!b.team && ctx.team) b.team = ctx.team;
            return b;
          });
        } catch (error) { return storeFail(error); }
      } else {
        await pending.catch(() => null);
        try { board = (await store.get(board.id)) || board; } catch { /* keep */ }
      }
    }
    return json(200, { ok: true, created, session: publicSession(board), context: publicContext(board.context), cost: { usd: usd(cost), cached } });
  }

  async function getMode(body) {
    let board;
    try { board = await store.get(body.sessionId); } catch (error) { return storeFail(error); }
    if (!board) return notFound();
    return json(200, { ok: true, session: publicSession(board), ...(body.withContext ? { context: publicContext(board.context) } : {}) });
  }

  // The chip / button behind a turn. -> { action } | { error } | {}
  function shapeAction(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const kind = String(raw.kind || '');
    const ids = (Array.isArray(raw.lineIds) ? raw.lineIds : []).map(id => String(id || '')).filter(id => /^bl-[0-9a-f]{8}$/.test(id));
    if (kind === 'more-like') return ids.length >= 1 ? { action: { kind, lineIds: [...new Set(ids)].slice(0, LIMITS.moreLike) } } : { error: 'Pick a line to get more like it.' };
    if (kind === 'mix') return new Set(ids).size === 2 ? { action: { kind, lineIds: [...new Set(ids)] } } : { error: 'Pick exactly two lines to mix.' };
    if (kind === 'angle') {
      const a = lower(raw.angle);
      const angle = ANGLES.includes(a) ? a : ANGLE_ALIASES[a] || '';
      return angle ? { action: { kind, angle } } : { error: 'Pick an angle from the chips.' };
    }
    if (kind === 'tone') {
      const t = lower(raw.tone);
      const tone = TONES[t] ? t : TONE_ALIASES[t] || '';
      return tone ? { action: { kind, tone } } : { error: 'Pick a tone from the chips.' };
    }
    if (kind === 'audience') {
      const a = lower(raw.audience).replace(/^for\s+/, '');
      if (/^neutral( fans)?$/.test(a)) return { action: { kind, audience: 'neutral' } };
      const audience = cleanText(raw.audience, LIMITS.audience);
      return audience && !ruleProblem(audience) ? { action: { kind, audience } } : { error: 'Say who the lines are for.' };
    }
    return kind ? { error: 'That brainstorm action is not known.' } : {};
  }
  function describeAction(action, byId) {
    const said = id => `"${byId.get(id)?.text || ''}"`;
    if (!action) return '';
    if (action.kind === 'more-like') return `More like ${action.lineIds.map(said).join(' / ')}: same feel, new words.`;
    if (action.kind === 'mix') return `Mix ${said(action.lineIds[0])} and ${said(action.lineIds[1])} into new lines.`;
    if (action.kind === 'angle') return `Angle: ${ANGLE_ASK[action.angle]}.`;
    if (action.kind === 'tone') return TONES[action.tone];
    if (action.kind === 'audience') return action.audience === 'neutral' ? 'For neutral fans who love the sport (no team-only jokes).' : `For: ${action.audience}.`;
    return '';
  }
  function turnRequest({ ctx, board, prompt, action }) {
    const byId = new Map((board.lines || []).map(l => [l.id, l]));
    const src = [
      `Story: ${ctx.title}`,
      ctx.sportLabel ? `Sport: ${ctx.sportLabel}` : '',
      ctx.team ? `Team: ${ctx.team.name}` : '',
      ctx.headlines?.length ? `Headlines:\n${ctx.headlines.map(h => `- ${h.title}${h.source ? ` (${h.source})` : ''}`).join('\n')}` : '',
      ctx.esArticles?.length ? `ES articles:\n${ctx.esArticles.map(a => `- ${a.title}${a.excerpt ? `: ${a.excerpt}` : ''}`).join('\n')}` : '',
      ctx.facts?.length ? `Web fact check:\n${ctx.facts.map(f => `- ${f}`).join('\n')}` : '',
      ctx.nicknames?.length ? `Nicknames / phrases in the sources: ${ctx.nicknames.join(', ')}` : '',
      !ctx.sources?.trend && board.title ? `The person's own line: ${board.title}` : '',
    ].filter(Boolean).join('\n');
    const lines = (board.lines || []).slice(-LIMITS.boardForAi).map(l => `- ${l.text}`).join('\n');
    const chat = (board.turns || []).slice(-LIMITS.chatForAi).map(t => {
      const asked = t.prompt || describeAction(t.action, byId) || '(lines)';
      const made = (t.lineIds || []).map(id => byId.get(id)?.text).filter(Boolean);
      return `Person: ${asked}\nYou: ${t.note || ''}${made.length ? ` (${made.join(' / ')})` : ''}`;
    }).join('\n');
    const ask = [describeAction(action, byId), prompt ? `They typed: ${prompt}` : ''].filter(Boolean).join('\n') || 'Give fresh lines.';
    return [
      `SOURCES (the only facts, numbers and quotes you may use):\n"""\n${src}\n"""`,
      `BOARD (already there: never repeat or reword these):\n${lines || '(empty)'}`,
      chat ? `RECENT CHAT:\n${chat}` : '',
      `REQUEST:\n${ask}`,
      `Return ${LIMITS.newLines} new lines.`,
    ].filter(Boolean).join('\n\n');
  }
  const noteFrom = text => {
    const m = String(text || '').match(/"note"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!m) return '';
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  };
  // One AI turn. -> { items, note, cost, model, truncated } | { error: 'free'|'ai'|'garbled', cost }
  async function runTurn(designMode, request, track) {
    const pro = designMode === 'pro';
    let result;
    try {
      result = await gateway().aiText({
        tier: pro ? PRO_TIER : AI_TIER, system: G.BRAINSTORM_SYSTEM, messages: [{ role: 'user', content: request }], json: true,
        maxTokens: pro ? TURN_TOKENS.pro : TURN_TOKENS.basic, timeoutMs: pro ? TURN_TIMEOUT.pro : TURN_TIMEOUT.basic, cacheSystem: true, allowCutoff: true,
        track: { ...track, feature: FEATURES.turns, task: pro ? 'merch-brainstorm-pro' : 'merch-brainstorm-basic' },
      });
    } catch (error) {
      const gw = gateway();
      if (gw.inFreeMode() || gw.isBudgetError(error)) return { error: 'free', cost: 0 };
      console.error(`merch brainstorm turn (${designMode}) failed:`, error.message);
      return { error: 'ai', cost: 0 };
    }
    const cost = Number(result.cost || 0);
    const parsed = parseJson(result.text);
    const items = Array.isArray(parsed?.items) ? parsed.items : partialItems(result.text);
    if (result.truncated) console.warn(`merch brainstorm: reply cut off; kept ${items.length} complete lines`);
    if (!items.length && !parsed) return { error: 'garbled', cost };
    return { items, note: cleanText(parsed?.note || noteFrom(result.text), LIMITS.note), cost, model: result.model, truncated: Boolean(result.truncated) };
  }
  // Validated, deduped new lines from AI items. -> { lines, dropped }
  function linesFromItems(items, { ctx, board, by, designMode }) {
    const seen = new Set((board.lines || []).map(l => key(l.text)));
    const out = [];
    let dropped = 0;
    const at = now();
    for (const item of items) {
      if (out.length >= LIMITS.newLines) break;
      const check = checkAiLine(item, ctx.corpus);
      if (!check.text || seen.has(key(check.text))) { dropped += 1; continue; }
      seen.add(key(check.text));
      const a = lower(item?.angle);
      out.push({
        id: lineId(), text: check.text, angle: ANGLES.includes(a) ? a : ANGLE_ALIASES[a] || 'callback', why: cleanText(item?.why, LIMITS.why),
        by, at, starred: [], source: 'ai', rights: rightsFor(check.text, ctx, item?.rights), designMode,
      });
    }
    return { lines: out, dropped };
  }
  // Free mode: lines from the headlines' own words (no AI). Up to 4.
  function codeLines({ ctx, board, by }) {
    const seen = new Set((board.lines || []).map(l => key(l.text)));
    const cands = [
      ...(ctx.nicknames || []).map(n => ({ text: n, angle: 'nickname' })),
      ...(ctx.headlines || []).map(h => ({ text: headlineLine(h.title), angle: /["“]/.test(h.title) ? 'quote' : 'callback' })),
    ];
    const out = [];
    const at = now();
    for (const c of cands) {
      if (out.length >= 4) break;
      const check = c.text ? checkAiLine(c.text.replace(/"/g, ''), ctx.corpus) : {};
      if (!check.text || seen.has(key(check.text))) continue;
      seen.add(key(check.text));
      out.push({ id: lineId(), text: check.text, angle: c.angle, why: 'Straight from the headlines (made without AI).', by, at, starred: [], source: 'code', rights: rightsFor(check.text, ctx) });
    }
    return out;
  }

  async function turnMode(body, track) {
    // The prompt goes to the AI as typed (clipped); the lines it makes are what get checked.
    const prompt = clip(straight(body.prompt), LIMITS.prompt);
    const shaped = shapeAction(body.action);
    if (shaped.error) return fail(400, 'input', shaped.error);
    const { action } = shaped;
    if (!prompt && !action) return fail(400, 'input', 'Ask for lines, or pick a chip.');
    let board;
    try { board = await store.get(body.sessionId); } catch (error) { return storeFail(error); }
    if (!board) return notFound();
    if ((board.lines || []).length >= LIMITS.lines) return fail(400, 'full', `This board has ${LIMITS.lines} lines. Remove some, or start from another moment.`);
    if (action?.lineIds && !action.lineIds.every(id => board.lines.some(l => l.id === id))) return fail(400, 'input', 'That line is no longer on the board.');
    let ctx = board.context;
    if (!ctx?.gatheredAt) ctx = await gatherContext({ trend: null, text: board.title, sport: board.sport, track, web: false });
    const by = lower(track.email);
    const want = designModeOf(body);
    const gate = await aiGate(FEATURES.turns, track);
    if (gate?.reply) return gate.reply;
    let lines = []; let note = ''; let used = want; let fellBack = ''; let spent = 0; let dropped = 0; let truncated = false; let ai = true;
    const free = reason => {
      ai = false; used = 'basic'; fellBack = reason;
      lines = codeLines({ ctx, board, by });
      note = FREE_NOTES[reason] + (lines.length ? '' : ' No usable lines in the headlines this time.');
    };
    if (gate?.free) free(fellBackFor(gate));
    else {
      const request = turnRequest({ ctx, board, prompt, action });
      let run = await runTurn(want, request, track);
      spent += run.cost || 0;
      if (run.error && run.error !== 'free' && want === 'pro') {
        fellBack = 'ai'; used = 'basic';
        run = await runTurn('basic', request, track);
        spent += run.cost || 0;
      }
      if (run.error === 'free') free('free');
      else if (run.error === 'ai') return fail(502, 'ai', "The AI couldn't brainstorm right now. Try again in a moment, or add your own line.");
      else if (run.error === 'garbled') return fail(502, 'ai', "The AI's answer came back garbled. Try again in a moment.");
      else {
        const made = linesFromItems(run.items, { ctx, board, by, designMode: used });
        lines = made.lines; dropped = made.dropped; truncated = run.truncated;
        note = run.note || (lines.length ? 'Here are some fresh lines.' : '');
        if (!lines.length) note = `None of the AI's lines passed the ES rules this time (made-up numbers, unsourced quotes, league marks or repeats). Try again or ask another way.`;
      }
    }
    const turn = {
      id: turnId(), by, at: now(), ...(prompt ? { prompt } : {}), ...(action ? { action } : {}),
      note, lineIds: [], designMode: used, ai, ...(fellBack ? { fellBack } : {}), cost: usd(spent),
    };
    let saved;
    try {
      saved = await store.mutate(board.id, b => {
        // Teammates may have added lines while the AI was thinking: dedupe again.
        const have = new Set((b.lines || []).map(l => key(l.text)));
        const fresh = lines.filter(l => !have.has(key(l.text))).slice(0, Math.max(0, LIMITS.lines - (b.lines || []).length));
        b.lines = [...(b.lines || []), ...fresh];
        b.turns = [...(b.turns || []), { ...turn, lineIds: fresh.map(l => l.id) }].slice(-LIMITS.turns);
        if (!b.context?.gatheredAt && ctx?.gatheredAt) b.context = ctx;
        return b;
      });
    } catch (error) { return storeFail(error); }
    const savedTurn = saved.turns[saved.turns.length - 1];
    const ids = new Set(savedTurn?.id === turn.id ? savedTurn.lineIds : []);
    return json(200, {
      ok: true, lines: saved.lines.filter(l => ids.has(l.id)), note, session: publicSession(saved), designMode: used,
      ...(ai ? {} : { free: true }), ...(fellBack ? { fellBack } : {}), ...(dropped ? { dropped } : { dropped: 0 }), ...(truncated ? { truncated: true } : {}),
      cost: { usd: usd(spent), cached: false },
    });
  }

  async function lineMode(body, track) {
    const op = String(body.op || '');
    if (!['star', 'unstar', 'edit', 'remove'].includes(op)) return fail(400, 'input', 'Unknown line action.');
    const id = String(body.lineId || '');
    const me = lower(track.email);
    let admin = null;
    const canChange = async line => {
      if (lower(line.by) === me) return true;
      if (admin === null) admin = await isAdmin(track.token);
      return admin;
    };
    // Checked before the write so an admin lookup never runs inside the retry.
    let pre;
    try { pre = await store.get(body.sessionId); } catch (error) { return storeFail(error); }
    if (!pre) return notFound();
    const target = (pre.lines || []).find(l => l.id === id);
    if (!target) return fail(404, 'not-found', 'That line is no longer on the board.');
    if ((op === 'edit' || op === 'remove') && !(await canChange(target))) return fail(403, 'forbidden', 'Only the person who added this line (or an admin) can change it.');
    let next = '';
    if (op === 'edit') {
      const check = target.source === 'person' ? checkPersonLine(body.text) : checkAiLine(body.text, pre.context?.corpus || pre.title);
      if (!check.text) return fail(400, check.why === 'rules' ? 'rules' : 'input', check.error);
      next = check.text;
    }
    try {
      const saved = await store.mutate(pre.id, b => {
        const line = (b.lines || []).find(l => l.id === id);
        if (!line) throw Object.assign(new Error('That line is no longer on the board.'), { code: 'not-found' });
        line.starred = Array.isArray(line.starred) ? line.starred : [];
        if (op === 'star') { if (line.starred.includes(me)) return null; line.starred = [...line.starred, me]; }
        if (op === 'unstar') { if (!line.starred.includes(me)) return null; line.starred = line.starred.filter(e => e !== me); }
        if (op === 'remove') b.lines = b.lines.filter(l => l.id !== id);
        if (op === 'edit') {
          if (line.text === next) return null;
          if (b.lines.some(l => l.id !== id && key(l.text) === key(next))) throw userError('That line is already on the board.', 'duplicate');
          line.text = next; line.edited = true; line.rights = rightsFor(next, b.context || {}, (line.rights || []).filter(r => r.kind === 'name'));
        }
        return b;
      });
      return json(200, { ok: true, session: publicSession(saved) });
    } catch (error) { return storeFail(error); }
  }

  async function addMode(body, track) {
    const check = checkPersonLine(body.text);
    if (!check.text) return fail(400, check.why === 'rules' ? 'rules' : 'input', check.error);
    const line = { id: lineId(), text: check.text, angle: 'callback', why: '', by: lower(track.email), at: now(), starred: [], source: 'person', rights: [] };
    try {
      const saved = await store.mutate(body.sessionId, b => {
        if ((b.lines || []).length >= LIMITS.lines) throw userError(`This board has ${LIMITS.lines} lines. Remove some first.`, 'full');
        if ((b.lines || []).some(l => key(l.text) === key(line.text))) throw userError('That line is already on the board.', 'duplicate');
        b.lines = [...(b.lines || []), { ...line, rights: rightsFor(line.text, b.context || {}) }];
        return b;
      });
      return json(200, { ok: true, line: saved.lines.find(l => l.id === line.id) || line, session: publicSession(saved) });
    } catch (error) { return storeFail(error); }
  }

  async function listMode() {
    let rows;
    try { rows = await store.recent(LIMITS.list); } catch (error) { return storeFail(error); }
    const sessions = rows.map(b => ({
      id: b.id, key: b.key, trendId: b.trendId || null, title: b.title || '', sport: b.sport || '',
      lines: (b.lines || []).length, starred: (b.lines || []).filter(l => (l.starred || []).length).length, updatedAt: b.updatedAt, people: peopleOf(b).length,
    }));
    return json(200, { ok: true, sessions, storage: store.mode() });
  }

  async function handle(mode, body, track) {
    if (mode === 'brainstorm-open') return openMode(body, track);
    if (mode === 'brainstorm-get') return getMode(body, track);
    if (mode === 'brainstorm-turn') return turnMode(body, track);
    if (mode === 'brainstorm-line') return lineMode(body, track);
    if (mode === 'brainstorm-add') return addMode(body, track);
    if (mode === 'brainstorm-list') return listMode(body, track);
    return null;
  }

  return {
    handle, FEATURES, LIMITS, WEB_CHECK, TURN_TOKENS, CONTEXT_TTL_MS,
    checkAiLine, checkPersonLine, rightsFor, gatherContext, shapeAction, turnRequest, nicknamesFrom, factsFrom, publicSession,
    setSources(next) { sources = { ...sources, ...next }; },
    setStore(next) { store = next; },
    reset() { INFLIGHT.clear(); },
  };
}

module.exports = { createBrainstorm, FEATURES, LIMITS, WEB_CHECK };
