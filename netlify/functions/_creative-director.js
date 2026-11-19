'use strict';
// Generate's creative director: decides WHAT each design says before the
// writer fills the templates (project-docs/generate-creative-brain-research.md, D).
//
//   readBrief        code only: who, team, sport, what the brief gives (quote,
//                    stats, table, headline) and which templates fit.
//   runDirector      one AI call (Sonnet by default) that returns up to 4
//                    distinct concepts: template, angle, hook, emotion, facts,
//                    photo direction and team.
//   validateConcepts code: never trusts the model. Disallowed or unfitting
//                    templates, invented facts and look-alike concepts drop.
//   conceptsBlock    the concepts as a block for the writer prompt.
//
// Everything fails soft: runDirector never throws, and no concepts means the
// writer runs exactly as it did before the director existed.
// TEMPLATES and the brief helpers (nameCandidates, parseTableBrief,
// sportFromUrl) are passed in from es-generate.js, so there is no circular require.
const RULES = require('../../frameup-rules.js');
const BRAND_KIT = require('../../brand-kit.js');
const { findTeam, findSport } = require('./_lint-spec.js');
const GUIDE = require('../../es-guidelines.js');
// Required when called (not at load), so tests that swap the Gateway module see the new one.
const gateway = () => require('./_ai-gateway.js');

const HOOKS = ['question', 'claim', 'reaction', 'quote', 'numbers', 'ranking'];
const EMOTIONS = ['hype', 'awe', 'tension', 'debate', 'celebration', 'heartbreak', 'respect', 'humor'];
const SHOTS = ['action', 'celebration', 'portrait', 'dejection', 'duo', 'any'];
const PALETTES = ['auto', 'primary', 'inverted'];
const STEERS = ['claim', 'question', 'stats', 'emotion', 'debate'];
const POST_TYPES = ['cover', 'quote', 'long-quote', 'double-entity-quote', 'stats-single-ent', 'stats-double-ent', 'listicle-type-1', 'listicle-type-2', 'player-stat-line', 'team-record'];
const STATS_TYPES = new Set(['stats-single-ent', 'stats-double-ent', 'player-stat-line']);

// Which model directs. GENERATE_DIRECTOR_MODEL (GENERATE_DIRECTOR_TIER is read
// too, the name used in the research doc):
//   unset / best / sonnet  Sonnet always. The default again since 2026-11-20:
//                          in live runs Haiku's reply was cut off on every
//                          brief, so "auto" paid for a wasted Haiku call plus
//                          Sonnet and added ~7s (owner now: spend where it helps).
//   auto                   Haiku first; Sonnet once when Haiku fails or its
//                          concepts fail validation (fewer than 2 survive).
//   main / haiku           Haiku only (economy).
function directorTier(value = process.env.GENERATE_DIRECTOR_MODEL || process.env.GENERATE_DIRECTOR_TIER || '') {
  const wanted = String(value).trim().toLowerCase();
  if (!wanted) return 'best';
  if (wanted === 'auto') return 'auto';
  return /^(?:main|haiku)$|haiku/.test(wanted) ? 'main' : 'best';
}

// ─── Editor steering (tone, audience, more / less like this) ───────────────
const TONES = ['hype', 'analytical', 'emotional', 'witty'];
const AUDIENCES = ['casual', 'diehard'];
const TONE_TEXT = {
  hype: 'hype: big energy, bold verbs, celebration',
  analytical: 'analytical: lead with what the numbers or the matchup say',
  emotional: 'emotional: the human story, what it means to the player and fans',
  witty: 'witty: a clever, playful line fans will share (never mocking injuries or personal lives)',
};
const AUDIENCE_TEXT = {
  casual: 'casual fans: plain words, the big picture, no jargon or deep stats',
  diehard: 'die-hard fans: insider detail, real stat labels, rivalries and history',
};
const steerList = value => (Array.isArray(value) ? value : [])
  .map(item => cut(typeof item === 'string' ? item : item?.angle, 120))
  .filter(item => item.length >= 4)
  .slice(0, 3);

// Accepts the old string steer ('question') or an object
// { hook, tone, audience, more: [angle], less: [angle] }. Unknown values drop.
function normalizeSteer(input) {
  const raw = typeof input === 'string' ? { hook: input } : (input && typeof input === 'object' && !Array.isArray(input) ? input : {});
  const pick = (value, list) => (list.includes(String(value || '').trim().toLowerCase()) ? String(value).trim().toLowerCase() : '');
  return {
    hook: pick(raw.hook, STEERS),
    tone: pick(raw.tone, TONES),
    audience: pick(String(raw.audience || '').replace(/[^a-z]/gi, ''), AUDIENCES),
    more: steerList(raw.more),
    less: steerList(raw.less),
  };
}
const steerIsEmpty = steer => !steer || (!steer.hook && !steer.tone && !steer.audience && !steer.more?.length && !steer.less?.length);

// Lines for the writer (tone and audience only; hooks are the director's job).
function steerLines(steer = {}) {
  const lines = [];
  if (steer.tone) lines.push(`Tone from the editor: ${TONE_TEXT[steer.tone]}.`);
  if (steer.audience) lines.push(`Audience: ${AUDIENCE_TEXT[steer.audience]}.`);
  return lines;
}

// ─── Small text helpers (same behaviour as es-generate.js) ─────────────────
const clean = value => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/[‐-―−]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();
const cut = (value, max) => {
  const text = clean(value);
  return text.length > max ? text.slice(0, max).trim() : text;
};
const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()} `;
const STOP = new Set('the and for with this that from have has was were are his her their they about after before into over just what when who will your you our not but out all can its been more most than then them did does how why one'.split(' '));
const tokens = text => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(word => word.length > 2 && !STOP.has(word)));
function jaccard(a, b) {
  const x = a instanceof Set ? a : tokens(a);
  const y = b instanceof Set ? b : tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  x.forEach(word => { if (y.has(word)) shared += 1; });
  return shared / (x.size + y.size - shared);
}

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    const ch = raw[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try {
      return JSON.parse(raw.slice(start, end));
    } catch (error) {
      // keep shrinking
    }
  }
  return null;
}

// ─── D1. Brief understanding (code only) ───────────────────────────────────
const INSTRUCTION = /^(?:make|create|do|design|give|need|want|can you|please|post)\b/i;
// Words people write instead of stat labels.
const STAT_WORDS = {
  points: 'PTS', point: 'PTS', rebounds: 'REB', rebound: 'REB', assists: 'AST', assist: 'AST',
  yards: 'YDS', touchdowns: 'TD', touchdown: 'TD', interceptions: 'INT', interception: 'INT',
  'home runs': 'HR', 'home run': 'HR', rbis: 'RBI', goals: 'G', goal: 'G', steals: 'STL', blocks: 'BLK',
};
const isStatLabel = label => RULES.STAT_LABELS.test(label) || RULES.STAT_LABELS.test(label.replace(/S$/i, ''));

function readStatsFrom(text) {
  const out = [];
  const re = /(\d[\d,.]*%?)\s*(home runs?|[A-Za-z%]{1,13})\b/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const value = match[1].replace(/[.,]$/, '');
    const word = match[2];
    const mapped = STAT_WORDS[word.toLowerCase()];
    // Single letters (A, G, K, W, L) count only when written as labels (caps).
    const label = mapped || (isStatLabel(word) && (word.length > 1 || word === word.toUpperCase()) ? word.toUpperCase() : '');
    if (!label || value.length > 7 || out.some(stat => stat.label === label)) continue;
    out.push({ value, label });
    if (out.length >= 8) break;
  }
  return out;
}

const quotesIn = text => [...String(text || '').matchAll(/[“"]([^”"]{3,300})[”"]/g)]
  .map(match => clean(match[1]))
  .filter(quote => quote.split(' ').length >= 2);

const SPORTS = [...new Set(BRAND_KIT.map(entry => entry.sport))];
const kitEntry = team => BRAND_KIT.find(entry => (entry.variation || entry.team) === team) || null;

// A real brand-kit team named in a text, first mention wins. Capitalised names
// ("Chiefs", "Indiana Fever") always count; lower-case words only when they
// are a plural nickname ("chiefs"). A name that fits teams in several sports
// counts only when the sport is known. A team right after "against", "vs",
// "beat"... is the opponent, never the subject's team.
const OPPONENT_BEFORE = /\b(?:against|vs\.?|versus|over|beat|beats|beating|beaten|past|facing|faces|face|defeat|defeats|defeated|top|tops|topped|edge|edges|edged|stun|stuns|stunned|host|hosts|hosting|at)\s+(?:the\s+)?$/i;
function teamInText(text, sport = '') {
  const source = String(text || '');
  const candidates = [];
  for (const match of source.matchAll(/[A-Z][A-Za-z'.&-]+(?:\s+[A-Z][A-Za-z'.&-]+){0,2}/g)) {
    candidates.push({ word: match[0], at: match.index });
    const parts = match[0].split(/\s+/);
    if (parts.length > 1) {
      let offset = 0;
      parts.forEach(part => {
        const at = match[0].indexOf(part, offset);
        offset = at + part.length;
        candidates.push({ word: part, at: match.index + at });
      });
    }
  }
  for (const match of source.matchAll(/\b[a-z]{4,}s\b/g)) candidates.push({ word: match[0], at: match.index });
  candidates.sort((a, b) => a.at - b.at);
  for (const { word: raw, at } of candidates) {
    const word = raw.replace(/['’]s$/i, '');
    if (word.length < 3 || STOP.has(word.toLowerCase())) continue;
    if (OPPONENT_BEFORE.test(source.slice(Math.max(0, at - 24), at))) continue;
    if (sport) {
      const team = findTeam(sport, word);
      if (team) return { team, sport };
      continue;
    }
    const hits = SPORTS.map(s => ({ sport: s, team: findTeam(s, word) })).filter(hit => hit.team);
    const sports = new Set(hits.map(hit => hit.sport));
    if (sports.size === 1) return hits[0];
  }
  return null;
}

// tools: { nameCandidates, parseTableBrief, sportFromUrl } from es-generate.js.
function readBrief(brief, found = {}, allowedTypes = [], tools = {}) {
  const text = String(brief || '');
  const lines = text.split('\n');
  const names = typeof tools.nameCandidates === 'function' ? tools.nameCandidates(text) : [];
  const subjects = [...new Set([...(found.tags || []).map(tag => clean(tag?.name)), ...names].filter(Boolean))].slice(0, 3);
  const surname = (subjects[0] || '').split(' ').filter(Boolean).pop()?.toLowerCase() || '';

  // Sport: a "Sport:" label, else the team's kit sport, else the ES stories' league.
  const sportLine = lines.find(line => /^\s*sport\s*:/i.test(line));
  let sport = sportLine ? findSport(sportLine.replace(/^\s*sport\s*:\s*/i, '')) : '';
  // Team: one named in the brief (it beats research, players move), else the
  // newest ES story about the subject that names a team.
  let teamHit = teamInText(text, sport);
  if (!teamHit && surname) {
    const about = [...(found.articles || [])]
      .filter(article => `${article.title} ${article.excerpt}`.toLowerCase().includes(surname))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    for (const article of about) {
      teamHit = teamInText(`${article.title}. ${article.excerpt}`, sport);
      if (teamHit) break;
    }
  }
  const team = teamHit?.team || '';
  if (!sport && team) sport = kitEntry(team)?.sport || teamHit.sport || '';
  if (!sport) {
    const leagues = (found.articles || []).map(article => article.sport || (typeof tools.sportFromUrl === 'function' ? tools.sportFromUrl(article.url) : '')).filter(Boolean);
    sport = leagues.sort((a, b) => leagues.filter(s => s === b).length - leagues.filter(s => s === a).length)[0] || '';
  }

  const table = Boolean(typeof tools.parseTableBrief === 'function' && tools.parseTableBrief(text));
  const headlineLine = lines.find(line => /^\s*headline\s*:/i.test(line));
  const trendHeadline = headlineLine ? clean(headlineLine.replace(/^\s*headline\s*:\s*/i, '')) || null : null;
  const instruction = INSTRUCTION.test(text.trim());
  const quotes = quotesIn(text).slice(0, 4);
  const briefStats = readStatsFrom(text);
  let stats = briefStats;
  if (stats.length < 3 && instruction) {
    const more = readStatsFrom(found.digest || '');
    if (more.length > stats.length) stats = more;
  }
  // Quotes the research gives (4+ words, near the subject's name).
  const corpus = String(found.corpus || found.digest || '');
  const corpusQuotes = [];
  if (surname) {
    for (const match of corpus.matchAll(/[“"]([^”"]{12,300})[”"]/g)) {
      const quote = clean(match[1]);
      if (quote.split(' ').length < 4) continue;
      const near = corpus.slice(Math.max(0, match.index - 300), match.index + match[0].length + 300).toLowerCase();
      if (near.includes(surname)) corpusQuotes.push(quote);
      if (corpusQuotes.length >= 4) break;
    }
  }
  const ranking = table || /\btop\s+\d+\b|\branked\b|\brankings?\b/i.test(text);
  // A record or final score stated in the brief (10-0, 31-28), not a date or a range of years.
  const record = (text.replace(/[–—]/g, '-').match(/(?:^|[^\d/.-])(\d{1,3}-\d{1,3})(?![\d/.-])/) || [])[1] || '';
  const kind = ranking ? 'ranking'
    : quotes.length ? 'quote'
      : briefStats.length >= 3 ? 'stats'
        : trendHeadline ? 'headline'
          : instruction ? 'instruction'
            : 'topic';
  const has = {
    quote: Boolean(quotes.length || corpusQuotes.length),
    stats: stats.length >= 3,
    statsCount: stats.length,
    list: ranking,
    headline: Boolean(trendHeadline),
    record: Boolean(record),
  };
  const allow = type => !allowedTypes.length || allowedTypes.includes(type);
  const fits = {
    cover: true,
    quote: has.quote,
    'long-quote': has.quote,
    'double-entity-quote': subjects.length >= 2 && quotes.length + corpusQuotes.length >= 2,
    'stats-single-ent': stats.length >= 3,
    'stats-double-ent': subjects.length >= 2 && stats.length >= 8,
    'listicle-type-1': ranking,
    'listicle-type-2': ranking,
    // One player's game line (3-7 numbers); a team's record or score.
    'player-stat-line': subjects.length >= 1 && stats.length >= 3,
    'team-record': Boolean(record && (team || subjects.length)),
  };
  Object.keys(fits).forEach(type => { fits[type] = Boolean(fits[type] && allow(type)); });
  return {
    subjects,
    team,
    sport,
    kind,
    quote: quotes[0] || null,
    quotes,
    stats,
    table,
    record,
    trendHeadline,
    instruction,
    has,
    fits,
    teamHint: null,
  };
}

// ─── D3. Direction (one AI call) ───────────────────────────────────────────
function DIRECTOR_SYSTEM(templates = {}) {
  const catalog = Object.entries(templates)
    .map(([type, t]) => `- ${type} (${t.label}): ${t.use} photo: ${t.photo ? 'yes' : 'no'}`)
    .join('\n');
  return [
    'You are the creative director of EssentiallySports (ES), a US sports media brand with a bold, editorial Instagram voice.',
    'You do not write the final post. You decide the creative direction for Instagram designs that a writer then fills into fixed ES templates.',
    'Per design you choose only: the template (postType), the angle (the one idea the post sells), the hook type, the emotion, a headline idea, the true facts it uses, the photo direction and the colour treatment. Layout, fonts and logo are fixed by the template.',
    '',
    'Templates:',
    catalog,
    '',
    ...GUIDE.directorLines(),
    '',
    'Rules:',
    '- Every concept is about the brief\'s own story. Use only facts that appear in the brief or the ES research, and copy them into factsUsed exactly as written there.',
    '- Concepts must be clearly different: a different template or a different hook type, and a different angle. Never two concepts that say the same thing in other words.',
    '- Covers are hooks: a bold claim or a curious question in 2-8 words, never a summary of facts.',
    '- Quote and Long Quote only for words the main person said. Words said about them need the Two-Person Quote, or no quote.',
    '- Player Stats needs 3 real game or season numbers with standard labels; Head-to-Head needs 4 per player. Never ages, years, money or rankings as stats.',
    '- Player Stat Line is one player\'s full game line (3-7 numbers, each with its own label); prefer it to Player Stats when there are 4 or more. Team Record / Score shows a record or final score the brief states (10-0, 31-28), under the team badge.',
    '- A ranking or table in the brief is ONE Rankings Table (number columns) or Ranked List concept with all rows, plus at most one Cover.',
    '- Use only templates listed under "Allowed" and marked true under "Fits".',
    '- team is the person\'s CURRENT team (newest coverage wins; a team named in the brief wins), full brand name. Empty if unsure. It sets the brand colours.',
    ...RULES.VOICE.map(line => `- ${line}`),
    '- Match the ES house style and the editors\' lessons when given.',
    '- name: a 2-4 word name for the direction an editor can say out loud (e.g. "The Unguardable Case", "Her Own Words"). rationale: one line on why it works for ES\'s Instagram audience.',
    '- inspiredBy: the ids (P1, P2...) of the past ES posts that shaped this concept\'s template or hook; empty if none did. Never invent ids.',
    '- confidence: 0-100, how sure you are this concept performs for ES (real facts, a strong hook, a template that fits).',
    '- Follow the editor\'s tone, audience and "more like / less like" steers when given.',
    '',
    `Enums: hook = ${HOOKS.join(' | ')}. emotion = ${EMOTIONS.join(' | ')}.`,
    `photo.shot = ${SHOTS.join(' | ')}. palette = ${PALETTES.join(' | ')}.`,
    '',
    'Reply with JSON only:',
    '{"read":{"subject":"","team":"","sport":"","moment":"one line: what happened"},',
    ' "concepts":[{"name":"","postType":"","angle":"","hook":"","emotion":"","headlineIdea":"","layout":"","factsUsed":[""],',
    '   "photo":{"query":"2-5 words: person + current team","shot":""},"team":"","palette":"auto","rationale":"","inspiredBy":["P1"],"confidence":80}]}',
  ].join('\n');
}

const STEER_TEXT = {
  claim: 'bold claim hooks',
  question: 'question hooks',
  stats: 'stats-led concepts (numbers first)',
  emotion: 'emotion-led concepts',
  debate: 'debate hooks (a take fans will argue about)',
};

function compactRead(read = {}) {
  return JSON.stringify({
    subjects: read.subjects || [], team: read.team || '', sport: read.sport || '', kind: read.kind || '',
    has: read.has || {}, stats: (read.stats || []).map(stat => `${stat.value} ${stat.label}`), quote: read.quote || null, ...(read.record ? { record: read.record } : {}),
  });
}

function directorRequest({ brief, read = {}, allowedTypes = [], steer = '', pastPosts = '', houseStyle = [], lessons = [], teamHints = [], memory = [], digest = '', want = 4 } = {}) {
  const parts = [
    `Brief: ${String(brief || '').slice(0, 1500)}`,
    `What the brief gives you (code-checked): ${compactRead(read)}`,
    `Allowed: ${JSON.stringify(allowedTypes.length ? allowedTypes : POST_TYPES)} Fits: ${JSON.stringify(read.fits || {})}`,
  ];
  const s = normalizeSteer(steer);
  if (s.hook) parts.push(`Steer from the editor: ${s.hook}. At least 2 concepts use ${STEER_TEXT[s.hook]} when it fits.`);
  if (s.tone) parts.push(`Tone from the editor: ${TONE_TEXT[s.tone]}. Every concept follows it.`);
  if (s.audience) parts.push(`Audience from the editor: ${AUDIENCE_TEXT[s.audience]}.`);
  if (s.more.length) parts.push(`The editor wants more like: ${s.more.map(a => JSON.stringify(a)).join('; ')}. Keep that direction's spirit, with fresh angles.`);
  if (s.less.length) parts.push(`The editor wants less like (avoid these angles and their hooks): ${s.less.map(a => JSON.stringify(a)).join('; ')}.`);
  if (pastPosts) parts.push(`Past ES posts the team shipped (style and template choice only, never their facts):\n${pastPosts}`);
  if (memory.length) parts.push(`What ES editors picked and exported lately:\n${memory.slice(0, 5).map(line => `- ${line}`).join('\n')}`);
  if (houseStyle.length) parts.push(`ES house style:\n${houseStyle.map(line => `- ${line}`).join('\n')}`);
  if (lessons.length) parts.push(`Editors' lessons:\n${lessons.slice(0, 6).map(line => `- ${line}`).join('\n')}`);
  if (teamHints.length) parts.push(`Team hints: ${teamHints.slice(0, 8).map(hint => `editors set ${hint.person} -> ${hint.team}`).join('; ')}`);
  parts.push(`ES research:\n${String(digest || '').slice(0, 2500) || '(no ES coverage found)'}`);
  parts.push(`Return ${want} concepts (fewer only if fewer genuinely fit).`);
  return parts.join('\n\n');
}

const HOOK_NAMES = { question: 'The Question', claim: 'The Bold Claim', reaction: 'The Reaction', quote: 'In Their Words', numbers: 'By The Numbers', ranking: 'The Ranking' };

// A direction's name: the model's (2-40 chars, no quotes), else one from its hook.
function directionName(raw, hook) {
  const name = cut(String(raw ?? '').replace(/["“”]/g, ''), 40);
  return name.length >= 2 && name.split(' ').length <= 6 ? name : HOOK_NAMES[hook] || 'Direction';
}

// Confidence 0-100: the model's own number, tempered by what code can check
// (verified facts, a past ES post behind it). Never above 98 or below 15.
function confidenceFor(raw, { factsUsed = [], inspiredBy = [], postType = '' } = {}) {
  let model = Number(raw);
  if (!Number.isFinite(model)) model = 70;
  if (model > 0 && model <= 1) model *= 100;
  model = Math.max(0, Math.min(100, model));
  const code = 50 + 10 * Math.min(factsUsed.length, 3) + (inspiredBy.length ? 10 : 0) - (postType === 'cover' && !factsUsed.length ? 10 : 0);
  return Math.max(15, Math.min(98, Math.round(0.6 * model + 0.4 * code)));
}

// Never trusts the model: returns only concepts the code can stand behind.
// [] means the writer runs as before (no direction).
// pastIds: the P1..Pn ids the director saw (inspiredBy must name one of them).
// chosen: directions an editor picked (and maybe edited) on the page. Their
// angle may be a little longer, their ids (ref) are kept for the page, and the
// look-alike checks are skipped (the editor chose them on purpose).
function validateConcepts(parsed, { read = {}, allowedTypes = [], want = 4, brief = '', corpus = '', templates = {}, pastIds = [], chosen = false } = {}) {
  const list = Array.isArray(parsed?.concepts) ? parsed.concepts.slice(0, 12) : [];
  const source = squash(`${brief} ${corpus}`);
  const fits = read.fits || {};
  const onlyCover = Object.entries(fits).every(([type, ok]) => type === 'cover' || !ok);
  const kept = [];
  for (const raw of list) {
    if (kept.length >= want) break;
    const postType = String(raw?.postType || '').trim();
    if (!templates[postType] || (allowedTypes.length && !allowedTypes.includes(postType)) || fits[postType] !== true) continue;
    const angle = clean(raw.angle);
    if (angle.length < 6 || angle.length > (chosen ? 120 : 90)) continue;
    const hook = HOOKS.includes(raw.hook) ? raw.hook : 'claim';
    const emotion = EMOTIONS.includes(raw.emotion) ? raw.emotion : '';
    const shot = SHOTS.includes(raw.photo?.shot) ? raw.photo.shot : 'any';
    const palette = PALETTES.includes(raw.palette) ? raw.palette : 'auto';
    const query = clean(raw.photo?.query);
    const sport = findSport(read.sport);
    const wantedTeam = clean(raw.team);
    const team = (wantedTeam && (findTeam(sport, wantedTeam) || findTeam('', wantedTeam))) || read.team || '';
    const factsUsed = (Array.isArray(raw.factsUsed) ? raw.factsUsed : [])
      .map(fact => clean(fact).slice(0, 160))
      .filter(fact => squash(fact).trim().length >= 2 && source.includes(squash(fact)))
      .slice(0, 6);
    if (STATS_TYPES.has(postType) && factsUsed.filter(fact => /\d/.test(fact)).length < 3) continue;
    // A record or score card stands on the stated record (10-0, 31-28).
    if (postType === 'team-record' && !factsUsed.some(fact => /\d{1,3}\s?[-–]\s?\d{1,3}/.test(fact))) continue;
    if (!chosen) {
      // Distinct: never the same template + hook twice, never a look-alike angle.
      if (kept.some(other => other.postType === postType && other.hook === hook)) continue;
      if (kept.some(other => jaccard(other.angle, angle) >= 0.6)) continue;
      if (postType === 'cover' && onlyCover && kept.filter(other => other.postType === 'cover').length >= 3) continue;
    }
    const inspiredBy = [...new Set((Array.isArray(raw.inspiredBy) ? raw.inspiredBy : [])
      .map(ref => String(ref || '').trim().toUpperCase())
      .filter(ref => pastIds.includes(ref)))].slice(0, 3);
    const ref = chosen ? cut(raw.ref || raw.id, 24).replace(/[^\w-]/g, '') : '';
    kept.push({
      id: '',
      ...(ref ? { ref } : {}),
      name: directionName(raw.name, hook),
      postType,
      angle,
      hook,
      emotion,
      headlineIdea: cut(raw.headlineIdea, 60),
      layout: cut(raw.layout, 140),
      factsUsed,
      photo: { query: templates[postType].photo && query.length >= 2 && query.length <= 80 ? query : '', shot },
      team,
      palette,
      rationale: cut(raw.rationale || raw.why, 160),
      inspiredBy,
      confidence: chosen && Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(raw.confidence)))) : confidenceFor(raw.confidence, { factsUsed, inspiredBy, postType }),
      ...(chosen && raw.edited ? { edited: true } : {}),
    });
  }
  kept.forEach((concept, index) => { concept.id = `c${index + 1}`; });
  return kept;
}

// One AI call (two in auto mode when Haiku falls short). Never throws.
// source: 'director' | 'haiku-fallback' | 'sonnet-escalated' | 'budget' | 'none'.
// startedAt: when the Generate run began; a second call only runs while the
// run is young (retryByMs), so a slow failure never stacks a second wait.
// tier: 'best' (Sonnet, default), 'main' (Haiku) or 'auto' (Haiku, then Sonnet
// once when Haiku fails or fewer than min(want, 2) concepts pass validation).
async function runDirector({
  brief, read, allowedTypes = [], steer = '', pastPosts = '', pastIds = [], houseStyle = [], lessons = [], teamHints = [], memory = [],
  digest = '', corpus = '', want = 4, templates = {}, tier = directorTier(), track = null,
  timeoutMs = 12000, startedAt = Date.now(), retryByMs = 12000, now = () => Date.now(),
} = {}) {
  const result = { concepts: [], read: null, model: '', cost: 0, source: 'none', calls: 0, escalated: false };
  try {
    const system = DIRECTOR_SYSTEM(templates);
    const request = directorRequest({ brief, read, allowedTypes, steer, pastPosts, houseStyle, lessons, teamHints, memory, digest, want });
    const { aiText, isBudgetError } = gateway();
    const ask = async askTier => {
      result.calls += 1;
      const reply = await aiText({
        tier: askTier,
        system,
        cacheSystem: true,
        messages: [{ role: 'user', content: request }],
        effort: 'low',
        // 1400 cut Haiku off on every live brief (4 concepts of JSON); room
        // so a full answer always fits.
        maxTokens: 2600,
        timeoutMs,
        track: track ? { ...track, feature: 'generate-director' } : undefined,
      });
      result.cost += Number(reply.cost) || 0;
      result.model = reply.model || '';
      return reply;
    };
    const judge = reply => {
      const parsed = extractJson(reply?.text);
      return { parsed, concepts: validateConcepts(parsed, { read, allowedTypes, want, brief, corpus, templates, pastIds }) };
    };
    const young = () => now() - startedAt < retryByMs;
    const first = tier === 'auto' ? 'main' : tier;
    let reply = null;
    let judged = { parsed: null, concepts: [] };
    try {
      reply = await ask(first);
      judged = judge(reply);
      result.source = 'director';
    } catch (error) {
      if (isBudgetError(error)) return { ...result, source: 'budget' };
      if (tier === 'best') {
        // Sonnet failed fast: one Haiku try (today's behaviour).
        if (!young()) return { ...result, source: 'none' };
        try {
          reply = await ask('main');
          judged = judge(reply);
          result.source = 'haiku-fallback';
        } catch (retryError) {
          return isBudgetError(retryError) ? { ...result, source: 'budget' } : { ...result, source: 'none' };
        }
      } else if (tier !== 'auto') {
        return { ...result, source: 'none' };
      }
    }
    // Auto: Haiku failed, or too few of its concepts survived validation.
    if (tier === 'auto' && judged.concepts.length < Math.min(want, 2) && young()) {
      try {
        const better = judge(await ask('best'));
        if (better.concepts.length >= judged.concepts.length) {
          judged = better;
          result.source = 'sonnet-escalated';
          result.escalated = true;
        }
      } catch (error) {
        if (isBudgetError(error) && !judged.concepts.length) return { ...result, source: 'budget' };
      }
    }
    if (!judged.concepts.length) return { ...result, source: 'none' };
    const said = judged.parsed?.read || {};
    result.read = {
      subject: cut(said.subject, 60), team: cut(said.team, 40), sport: cut(said.sport, 20), moment: cut(said.moment, 160),
    };
    result.concepts = judged.concepts;
    return result;
  } catch (error) {
    return { ...result, concepts: [], source: 'none' };
  }
}

// ─── D4. The concepts as a block for the writer ────────────────────────────
// options.perConcept: designs per concept (2 when the editor picked one or two
// directions). options.steer: the editor's tone and audience for the copy.
function conceptsBlock(concepts = [], count = 4, houseStyleLines = [], { perConcept = 1, steer = null } = {}) {
  if (!concepts.length) return '';
  const lines = [
    perConcept > 1
      ? `Creative direction from the ES creative director. Write exactly ${perConcept} designs per concept, in this order, using its postType: same angle, clearly different wording.`
      : 'Creative direction from the ES creative director. Write exactly one design per concept, in this order, using its postType.',
    'Keep its angle and hook type; sharpen the headline idea if you can, within the limits. Use its team and photo query.',
    'Put the concept id in "conceptId". Put the angle in "why".',
    ...concepts.map(c => {
      const bits = [`- ${c.id} [${c.postType} · ${c.hook}${c.emotion ? ` · ${c.emotion}` : ''}] angle: ${JSON.stringify(c.angle)}`];
      if (c.headlineIdea) bits.push(`headline idea: ${JSON.stringify(c.headlineIdea)}`);
      if (c.factsUsed.length) bits.push(`facts: ${c.factsUsed.join(', ')}`);
      const extra = [c.photo?.query ? `photo: ${c.photo.query}` : '', c.team ? `team: ${c.team}` : ''].filter(Boolean).join(' | ');
      return `${bits.join(' ')}${extra ? ` | ${extra}` : ''}`;
    }),
  ];
  if (concepts.length * perConcept < count) lines.push(`Then add up to ${count - concepts.length * perConcept} more designs with clearly different angles.`);
  if (houseStyleLines.length) lines.push(`ES house style: ${houseStyleLines.join(' ')}`);
  lines.push(...steerLines(normalizeSteer(steer || {})));
  return lines.join('\n');
}

module.exports = {
  readBrief,
  DIRECTOR_SYSTEM,
  directorRequest,
  runDirector,
  validateConcepts,
  conceptsBlock,
  directorTier,
  normalizeSteer,
  steerIsEmpty,
  steerLines,
  confidenceFor,
  teamInText,
  TONES,
  AUDIENCES,
  HOOKS,
  EMOTIONS,
  SHOTS,
  PALETTES,
  STEERS,
  _test: { readStatsFrom, quotesIn, jaccard, extractJson },
};
