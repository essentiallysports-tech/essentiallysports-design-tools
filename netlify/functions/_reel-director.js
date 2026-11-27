'use strict';
// Reels Studio director: decides what a reel says, beat by beat
// (project-docs/ai-reels-research.md §4.1, §6). Modelled on Generate's
// creative director (_creative-director.js): code reads the brief, one AI
// call writes the beats, and code validates everything the model returns.
//
//   readReelBrief   code only: sources corpus, sport, team, routed format
//   runReelDirector Haiku first; Sonnet only when the plan comes back weak
//                   and the tier allows it (research B1). Never throws: with no
//                   AI, over a cap, or on failure it returns a grounded draft
//                   built from the brief (ReelFormats.fallbackPlan).
//   validatePlan    never trusts the model: beats with unsourced numbers or
//                   quotes drop, kinds are coerced to the format, the hook
//                   and the end card are guaranteed, lengths are capped.
//   revisePlan      one Haiku call for "shorter / punchier / …" edits, same checks.
//   factCheck       capped web research (2 searches, $0.03 cap) whose text
//                   joins the sources, so its numbers can be used.
const crypto = require('node:crypto');
const F = require('../../reel-formats.js');
const STYLES = require('../../reel-styles.js');
const ES = require('../../reel-es.js');
const RULES = require('../../frameup-rules.js');
const TEAMS = require('../../video-ads-teams.js');
const BRAND_KIT = require('../../brand-kit.js');
const { teamInText } = require('./_creative-director.js');
// Required when called (not at load), so tests can swap the Gateway module.
const gateway = () => require('./_ai-gateway.js');

const KIT_SPORT = { nfl: 'NFL', cfb: 'CFB', mlb: 'MLB', golf: 'Golf' };
const SPORT_FROM_KIT = { NFL: 'nfl', CFB: 'cfb', MLB: 'mlb', Golf: 'golf' };

const clean = (value, max = 400) => String(value == null ? '' : value)
  .replace(/<[^>]*>/g, ' ')
  .replace(/https?:\/\/\S+|www\.\S+/gi, '')
  .replace(/#[A-Za-z0-9_]+/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/[‐-―−]/g, '-')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()} `;

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    if (raw[end - 1] !== '}') continue;
    try { return JSON.parse(raw.slice(start, end)); } catch { /* keep shrinking */ }
  }
  return null;
}

// Team name -> { name, colors, logo } from Video Ads' team list (logos and
// official colours), else the brand kit's colours. Golf has no team.
function teamInfo(name, sport) {
  const wanted = clean(name, 80);
  if (!wanted) return null;
  const hit = TEAMS.findTeam(wanted, sport) || TEAMS.TEAMS.find(team => team.sport === sport && (wanted.toLowerCase().includes(team.short.toLowerCase()) || team.name.toLowerCase().includes(wanted.toLowerCase())));
  if (hit) return { name: hit.name, short: hit.short, colors: hit.colors.slice(0, 2), logo: TEAMS.logoFor(hit) };
  const kit = BRAND_KIT.find(entry => (entry.variation || entry.team) === wanted);
  if (kit) return { name: wanted, short: wanted.split(' ').pop(), colors: [kit.primary?.background, kit.primary?.foreground].filter(Boolean), logo: '' };
  return null;
}

// ─── Brief (code only) ───────────────────────────────────────────────────
// trend: { title, related: [{ title }], why, sport, team } from Trends.
// facts: extra source text (the capped fact check, ES article excerpts).
function readReelBrief({ brief = '', trend = null, facts = '', sport = '', format = 'auto' } = {}) {
  const parts = [
    clean(brief, 2400),
    trend ? clean(trend.title, 300) : '',
    ...(trend && Array.isArray(trend.related) ? trend.related.slice(0, 4).map(r => clean(r && r.title, 300)) : []),
    trend ? clean(trend.why, 300) : '',
  ].filter(Boolean);
  const text = parts.join('\n');
  const corpus = [text, clean(facts, 4000)].filter(Boolean).join('\n');
  let sportId = F.SPORTS.some(s => s.id === sport) ? sport : (trend && F.SPORTS.some(s => s.id === trend.sport) ? trend.sport : '');
  const teamHint = clean(trend && trend.team, 80);
  let teamHit = teamHint ? { team: teamHint, sport: KIT_SPORT[sportId] || '' } : teamInText(text, KIT_SPORT[sportId] || '');
  if (!teamHit && !sportId) teamHit = teamInText(text, '');
  if (!sportId && teamHit && SPORT_FROM_KIT[teamHit.sport]) sportId = SPORT_FROM_KIT[teamHit.sport];
  const route = F.routeFormat(text);
  const chosen = F.FORMATS[format] ? format : route.format;
  return {
    text, corpus, sport: sportId,
    team: teamHit ? teamInfo(teamHit.team, sportId) : null,
    route, format: chosen, auto: !F.FORMATS[format],
    numbers: [...F.numberSet(corpus)].slice(0, 40),
  };
}

// ─── Prompt ──────────────────────────────────────────────────────────────
const DIRECTOR_SYSTEM = [
  'You are the EssentiallySports (ES) reels director. You plan 9:16 sports reels of 20-45 seconds for Instagram Reels, TikTok and YouTube Shorts: original explainers on top of the news, voiced by the ES house voice, with word-level captions burned in.',
  'There is no game footage. Each beat shows an ES photo, a stat card drawn by the renderer, or a team logo. You choose the words, the order and the photos.',
  '',
  'Return JSON only, no prose:',
  '{"format":"explainer|stat|top5|quote","title":"...","angle":"one line","team":"team name or empty","beats":[...],"hooks":["alt hook","alt hook"]}',
  'Beat fields:',
  '- kind: hook | context | point | stat | rank | quote | payoff | cta',
  '- text: the on-screen line, 2-9 words, punchy, no full stop',
  '- vo: what the voice says, 6-26 words, a natural spoken sentence; numbers as digits',
  '- emphasis: one word from text to highlight',
  '- visual: what the beat shows: clip (game or team video), photo, headshot (one person), logo-tile (a team), scene (a place or object, no people), chart (the data itself)',
  '- photo: a specific ES photo/clip search for this beat: a person\'s full name, a team name, or "Team Name scene words"; "" for none',
  '- scene: for visual "scene" only, one of stadium, crowd, field, ball, trophy, skyline, locker, scoreboard',
  '- stat: {"value":"5,477","label":"pass yds"} (stat beats only)',
  '- rank: 1-5, name: the entry, detail: one short line (rank beats only)',
  '- quote: {"text":"exact words","by":"Full Name"} (quote beats only)',
  '',
  'Format structures:',
  '- explainer: hook, context, 2-4 point (or stat / quote), payoff, cta. 5-8 beats.',
  '- stat: hook that leads with the number, stat (the number as a card), context, 0-2 point or stat, payoff, cta.',
  '- top5: hook, rank 5, rank 4, rank 3, rank 2, rank 1, cta. Exactly five entries, all from SOURCES. If SOURCES cannot support five, write an explainer and set format to "explainer".',
  '- quote: hook (the punchiest few words of the quote), quote, context, payoff, cta.',
  '',
  'Rules:',
  '1. Facts: every number, score, stat, date and record must appear in SOURCES. Never invent, round or estimate. If a number is not there, leave it out.',
  '2. Quotes: only exact words from SOURCES, attributed. Never put words in a real person\'s mouth; the ES voice reads context, not the quote as the speaker.',
  '3. Hook: beat 1 carries the claim or the number in 5-7 words. No greetings, no "In this video", no logo intro.',
  '4. 55-110 voiceover words in total. One idea per beat. A new beat every 2-5 seconds.',
  '5. ES voice: punchy, confident, plain American sports English, written for the ear (contractions, short sentences). No emojis, hashtags, links, "Breaking", hype words (shocking, insane, unbelievable, you won\'t believe), no repeated !! or ??.',
  '6. The last beat is a cta that asks fans one specific question about this story (text up to 7 words, no numbers).',
  '7. Vary the opening: a number, a claim or a question, whichever is strongest for this story.',
].join('\n');

// The style's extra beat kinds, with their exact fields (only the ones the
// chosen style supports are offered to the model).
const COMPONENT_SPEC = {
  bars: 'bars: comparison bars. "bars":[{"label":"Mahomes","value":"1×","note":""}] 2-4 rows, the subject first; values from SOURCES. "detail": what is measured.',
  versus: 'versus: 2-3 cards. "versus":[{"name":"Burrow","value":"+50%","note":"short line","photo":"Joe Burrow"}]; name "?" makes a mystery card.',
  dotrank: 'dotrank: a dot ranking of a whole field. "dotrank":{"total":"714","rank":"234","label":"2018 Mahomes","note":"what closer to the centre means"}. Both numbers from SOURCES.',
  chips: 'chips: "1 in 5" squares. "chips":{"filled":"1","total":"5","label":"pre-designed throws"} (total up to 12). Numbers from SOURCES.',
  steps: 'steps: a step tracker for a multi-part story. "steps":{"current":"2","total":"3","label":"Moneyball rebuild"}.',
  tiles: 'tiles: 2-4 team tiles. "tiles":[{"team":"Baltimore Ravens","label":"short line","chip":"REBUILT"}].',
  roles: 'roles: 2-4 position cards. "roles":[{"role":"WR","value":"#31","note":"short","tone":"bad|good"}]. Values from SOURCES.',
  mystery: 'mystery: a "?" card for the open question. text + "detail".',
};
// ES Reels (the ES video team's system, reel-es.js): the model picks one of
// the seven blocks for every beat, with exactly its fields.
const ES_SPEC = [
  'STYLE: ES Reels, the ES video team\'s system. Every beat ALSO carries "block", exactly one of these (only these fields):',
  '- hook (beat 1 only, kind "hook"): {"type":"hook","pills":[{"text":"THE CUBS LOST.","color":"ink"},{"text":"THIS BAR GOT PAID.","color":"red"}],"stamp":{"text":"PAID"}}. 2-3 pills of up to 14 characters that state the tension, readable at frame one. Optional one-word stamp: the payoff word, said in the vo.',
  '- statement (kind "point", "context" or "payoff"): {"type":"statement","lines":[{"text":"IT WASN\'T","color":"ink"},{"text":"INSURANCE.","color":"blue"}]}. 1-3 lines, each under 14 characters.',
  '- number (kind "stat"): {"type":"number","kicker":"KALSHI TRADES","value":274000,"prefix":"","suffix":"","label":"CONTRACTS","color":"blue"}. One number from SOURCES, up to 6 digits; prefix "$", suffix "%" or "M". Also set "stat":{"value":"274,000","label":"contracts"}.',
  '- dots (kind "dotrank"): {"type":"dots","label":"EVERY BET ON GAMES","count":2521,"highlight":1,"note":"1 WAS INSURANCE"}. Scale ("1 in 2,500"): count up to 2600, both numbers from SOURCES. Also set "dotrank":{"total":"2521","rank":"1","label":"..."}.',
  '- compare (kind "bars"): {"type":"compare","kicker":"HOW THEY BET","items":[{"label":"ON THE GAMES","value":692,"display":"$692M","color":"red"},{"label":"AS INSURANCE","value":0.3,"display":"$0.3M","color":"green"}]}. 2-4 items, values from SOURCES. Also set "bars":[{"label":"...","value":"$692M"}].',
  '- quote (kind "quote"): {"type":"quote","text":"exact words, under 70 characters","who":"ANDY REID"}. Also set "quote":{"text":"...","by":"Andy Reid"}.',
  '- endcard (the last beat, kind "cta"): {"type":"endcard"}. It shows "WE BRING / THE RECEIPTS.", the ES logotype and the source line; its vo is not read.',
  'Colours: ink and blue carry structure. green (money won, the good side) and red (loss, wrong) only for meaning, at most two per beat. Never yellow on screen (captions use it).',
  'On-screen words are a headline, not the sentence. Numbers on screen exactly as the vo says them. One idea per beat. In each vo, wrap the one word that carries the meaning in *asterisks* (it turns yellow in the captions).',
  // Reels 2.0: looks (reel-es-themes.js). One line per layout preset; the
  // reel's own look is named under LOOK (lookRequest), else write for Standard.
  'LOOKS: the reel is drawn in one look. Its layout preset shapes the beats you choose (colours and fonts are not yours to set):',
  ...Object.values(ES.LOOK_LAYOUTS).map(l => `- ${l.director}`),
].join('\n');
// The line for the reel's own look ("LOOK: Data-led (Data-led: at least two of…)").
function lookRequest(look) {
  if (!look || !ES.LOOKS[look]) return '';
  const l = ES.LOOKS[look];
  return `LOOK: ${l.label}. Follow the ${ES.LOOK_LAYOUTS[l.layout].director.split(':')[0]} line above.`;
}
// ─── Reels v3: the four styles (Game Tape, Stat Card, Receipts, Hype Cut) ──
// ENGINE's ReelES.STYLES decides the blocks when it is loaded; this local
// table is the same contract (reels3-contract.md) so the director works
// before and after the engine lands.
const CLIPS = require('../../reel-clips.js');
const V3_STYLES = {
  gametape: { label: 'Game Tape', blocks: ['hook', 'clipLabel', 'statement', 'statTiles', 'tagPill', 'endcard'], brief: 'Video-first highlight reel: 80-100% of scenes are verified game clips with short type over them. Hook pills over a clip, clip scenes with a lower-third label (clipLabel), a statement or one statTiles strip at most, the end card.' },
  statcard: { label: 'Stat Card', blocks: ['hook', 'photoCard', 'statTiles', 'streak', 'rankTile', 'tagPill', 'statement', 'compare', 'endcard'], brief: 'Player cards with infographic motion: verified photos in photoCard blocks (a label pill like "2011 · GB"), paired statTiles, a W/L streak, a rankTile with a grade chip. Data first: every card is built on numbers from SOURCES.' },
  receipts: { label: 'Receipts', blocks: ['hook', 'statTiles', 'dotGrid', 'compare', 'streak', 'rankTile', 'tagPill', 'statement', 'quote', 'endcard'], brief: 'Pure motion infographics, no footage and no photos: a headline with one word in blue, statTiles, a dotGrid (blue / ink / grey), compare bars, a streak row, tag pills. Data first: at least two data blocks, every number from SOURCES.' },
  hypecut: { label: 'Hype Cut', blocks: ['hook', 'statement', 'tagPill', 'statTiles', 'clipLabel', 'endcard'], brief: 'Fast kinetic type over clips: short punchy statement words (1-2 per line), a stamp-like tagPill, quick statTiles pops, clip scenes. Faster pacing: 2-3 seconds a scene.' },
};
const V3_IDS = Object.keys(V3_STYLES);
const V3_TYPES = ['photoCard', 'statTiles', 'dotGrid', 'streak', 'rankTile', 'tagPill', 'clipLabel'];
// The beat kind each new block rides on (formats, provenance and lint keep working).
const V3_KIND = { photoCard: 'point', statTiles: 'stat', dotGrid: 'stat', streak: 'point', rankTile: 'stat', tagPill: 'point', clipLabel: 'point' };
const DATA_BLOCKS = ['statTiles', 'dotGrid', 'compare', 'streak', 'rankTile', 'number', 'dots'];
function v3Blocks(id) {
  const fromEngine = ES.STYLES && ES.STYLES[id] && Array.isArray(ES.STYLES[id].blocks) ? ES.STYLES[id].blocks : null;
  return fromEngine || (V3_STYLES[id] ? V3_STYLES[id].blocks : []);
}
const V3_SPEC = [
  'REELS v3 BLOCKS (in addition to hook, statement, quote, compare, endcard above; use only the ones your STYLE allows):',
  '- photoCard (kind "point"): {"type":"photoCard","photo":"Aaron Rodgers","label":"2011 · GB","scan":true}. A verified photo of the subject with a label pill (<= 14 characters). photo = the subject\'s full name.',
  '- statTiles (kind "stat"): {"type":"statTiles","tiles":[{"value":"45","label":"TD","tone":"blue"},{"value":"6","label":"INT","tone":"ink"}]}. 1-3 tiles, value up to 6 characters, label <= 12, optional "chip" ("Grade 92.6"). Also set "stat" to the first tile.',
  '- dotGrid (kind "stat"): {"type":"dotGrid","total":67,"title":"ACHILLES TEARS","groups":[{"n":26,"tone":"blue","label":"BACK TO 90%"},{"n":26,"tone":"ink","label":"RETURNED"},{"n":15,"tone":"grey","label":"DID NOT"}]}. total <= 300, groups add up to total. Also set "stat":{"value":"67","label":"..."}.',
  '- streak (kind "point"): {"type":"streak","items":"WWWLWWWW","label":"2011 · 15-1"}. W / L / T only, up to 20.',
  '- rankTile (kind "stat"): {"type":"rankTile","kicker":"2024","rank":"#1","pos":"TE","chip":"Grade 92.6"}. Also set "stat":{"value":"#1","label":"TE"}.',
  '- tagPill (kind "point"): {"type":"tagPill","text":"TORE ACHILLES · JAN. 11","tone":"red|blue|ink"}. <= 28 characters, an event tag.',
  '- clipLabel (kind "point"): {"type":"clipLabel","text":"GEORGE KITTLE"}. A game clip with a lower-third label pill (<= 22 characters).',
  'Every number in every block comes from SOURCES exactly. Do not use the old "number" and "dots" blocks: use statTiles and dotGrid.',
  'Every beat ALSO carries "subject": who or what the picture must show: {"type":"player|team|moment|game","name":"Aaron Rodgers","team":"Green Bay Packers","date":"2011","moment":"45 TD season"}. name: a full name, team or game exactly as in SOURCES; moment: <= 8 words, what should be on screen (the play, the season, the injury); "" when the scene is about the whole story.',
].join('\n');
function v3Request(esStyle) {
  const st = V3_STYLES[esStyle];
  if (!st) return '';
  return [V3_SPEC, `STYLE v3: ${st.label}. ${st.brief}`, `Allowed blocks in this style: ${v3Blocks(esStyle).join(', ')}.`, 'Ignore the LOOKS lines above: the style decides the layout.'].join('\n');
}
// The v3 style a request names: an exact v3 id, else the legacy map.
function v3StyleOf({ esStyle = '', style = '', look = '', recipe = '' } = {}) {
  if (V3_IDS.includes(esStyle)) return esStyle;
  if (V3_IDS.includes(style)) return style;
  return CLIPS.legacyStyle(look, recipe, null);
}

function styleRequest(style, look = '', esStyle = '') {
  if (style && style.engine === 'es') return [ES_SPEC, V3_IDS.includes(esStyle) ? v3Request(esStyle) : lookRequest(look)].filter(Boolean).join('\n');
  if (!style || !style.components.length) return '';
  const long = style.seconds.max > 90;
  return [
    `STYLE: ${style.label}. ${style.blurb}`,
    long ? `LENGTH: this style runs long-form: ${style.seconds.target[0]}-${style.seconds.target[1]} seconds, ${Math.round(style.beats.max * 0.5)}-${style.beats.max} beats, ${style.voWords[0]}-${style.voWords[1]} voiceover words in total. Build an argument: setup, evidence beats, the turn, the payoff.` : '',
    'Extra beat kinds this style draws (use them where SOURCES have the numbers; never invent one):',
    ...style.components.map(k => `- ${COMPONENT_SPEC[k]}`),
    style.chrome.eyebrow ? 'Also return "eyebrow": a short grey label over every scene, e.g. "PATRICK MAHOMES · 714 QB SEASONS" (numbers from SOURCES only).' : '',
    style.chrome.seriesTag ? 'Also return "series":{"tag":"ES MONEYBALL"} (a short series name) and "strip":{"label":"2027 cap space","value":"-$12.3M","of":"","note":"","tone":"bad|good"} - one number from SOURCES that stays on screen the whole reel; omit "strip" if SOURCES have none.' : '',
  ].filter(Boolean).join('\n');
}

function directorRequest({ read, format, steer = '', style = null, look = '', esStyle = '', today = new Date() }) {
  const fmt = F.FORMATS[format];
  return [
    `FORMAT: ${read.auto ? `auto (the router suggests ${fmt.id}; candidates: ${read.route.candidates.join(', ')})` : fmt.id}`,
    styleRequest(style, look, esStyle),
    `SPORT: ${(F.SPORTS.find(s => s.id === read.sport) || {}).label || 'unknown'}`,
    read.team ? `TEAM: ${read.team.name}` : '',
    steer ? `EDITOR NOTE: ${clean(steer, 300)}` : '',
    `TODAY: ${today.toISOString().slice(0, 10)}`,
    'SOURCES (the only facts you may use):',
    '<<<',
    read.corpus || '(none)',
    '>>>',
  ].filter(Boolean).join('\n');
}

// ─── Validation ──────────────────────────────────────────────────────────
// Component values keep a leading # (a pick or a rank, "#31"), unlike clean().
const str = (v, n) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().slice(0, n);
// The data fields of a component beat, shaped and capped (numbers are then
// checked by F.unsourcedNumbers, which walks every one of these fields).
function componentFields(kind, b, read) {
  const out = {};
  const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  if (kind === 'bars') out.bars = list(b.bars, 4).map(x => ({ label: str(x && x.label, 24), value: str(x && x.value, 16), note: str(x && x.note, 60) })).filter(x => x.label && /\d/.test(x.value));
  if (kind === 'versus') out.versus = list(b.versus, 3).map(x => ({ name: str(x && x.name, 28), value: str(x && x.value, 14), note: str(x && x.note, 60), photo: str(x && x.photo, 60).replace(/[^\p{L}\p{N} .'-]/gu, '') })).filter(x => x.name);
  if (kind === 'dotrank' && b.dotrank) out.dotrank = { total: str(b.dotrank.total, 8), rank: str(b.dotrank.rank, 8), label: str(b.dotrank.label, 32), note: str(b.dotrank.note, 60) };
  if ((kind === 'chips' || kind === 'stat') && b.chips) out.chips = { filled: str(b.chips.filled, 6), total: str(b.chips.total, 6), label: str(b.chips.label, 40) };
  if (kind === 'steps' && b.steps) out.steps = { current: str(b.steps.current, 2), total: str(b.steps.total, 2), label: str(b.steps.label, 32) };
  if (kind === 'tiles') {
    out.tiles = list(b.tiles, 4).map(x => {
      const name = str(x && (x.team || x.name), 60);
      const info = name ? teamInfo(name, read.sport) : null;
      return { team: info ? info.short || info.name : name.split(' ').pop(), name: info ? info.name : name, label: str(x && x.label, 36), chip: str(x && x.chip, 18), colors: info ? info.colors : [], logo: info ? info.logo : '' };
    }).filter(x => x.team);
  }
  if (kind === 'roles') out.roles = list(b.roles, 4).map(x => ({ role: str(x && x.role, 8), value: str(x && x.value, 10), note: str(x && x.note, 40), tone: x && x.tone === 'good' ? 'good' : 'bad' })).filter(x => x.role && x.value);
  return out;
}
const COMPONENT_OK = {
  bars: b => b.bars && b.bars.length >= 2,
  versus: b => b.versus && b.versus.length >= 2,
  dotrank: b => b.dotrank && /\d/.test(b.dotrank.total) && /\d/.test(b.dotrank.rank) && Number(String(b.dotrank.rank).replace(/,/g, '')) <= Number(String(b.dotrank.total).replace(/,/g, '')),
  chips: b => b.chips && /^\d+$/.test(b.chips.filled) && /^\d+$/.test(b.chips.total) && Number(b.chips.filled) <= Number(b.chips.total),
  steps: b => b.steps && /^\d$/.test(b.steps.current) && /^\d$/.test(b.steps.total) && Number(b.steps.current) <= Number(b.steps.total),
  tiles: b => b.tiles && b.tiles.length >= 2,
  roles: b => b.roles && b.roles.length >= 2,
  mystery: () => true,
};

// ─── Reels v3 blocks: shaped to exactly their fields ──────────────────────
const TONES2 = ['blue', 'ink'];
const TONES3 = ['blue', 'ink', 'grey'];
const TAG_TONES = ['red', 'blue', 'ink'];
const nInt = (v, lo, hi) => { const n = Math.round(Number(String(v == null ? '' : v).replace(/[,\s]/g, ''))); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : NaN; };
function cleanV3Block(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const type = V3_TYPES.includes(b.type) ? b.type : '';
  if (!type) return null;
  if (type === 'photoCard') {
    const out = { type, photo: str(b.photo, 60).replace(/[^\p{L}\p{N} .'-]/gu, ''), label: str(b.label, 22) };
    if (b.scan === true) out.scan = true;
    if (b.focus && typeof b.focus === 'object' && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(b.focus[k])))) out.focus = Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, Math.max(0, Math.min(1, Number(b.focus[k])))]));
    return out;
  }
  if (type === 'statTiles') {
    const tiles = (Array.isArray(b.tiles) ? b.tiles : []).slice(0, 3).map((t, i) => ({ value: str(t && t.value, 8), label: str(t && t.label, 18), ...(t && str(t.chip, 16) ? { chip: str(t.chip, 16) } : {}), tone: TONES2.includes(t && t.tone) ? t.tone : (i === 0 ? 'blue' : 'ink') })).filter(t => t.value && /\d/.test(t.value));
    return tiles.length ? { type, tiles } : null;
  }
  if (type === 'dotGrid') {
    const total = nInt(b.total, 1, 300);
    if (!Number.isFinite(total)) return null;
    let left = total;
    const groups = (Array.isArray(b.groups) ? b.groups : []).slice(0, 3).map((g, i) => {
      const n = nInt(g && g.n, 0, left);
      if (!Number.isFinite(n)) return null;
      left -= n;
      return { n, tone: TONES3.includes(g && g.tone) ? g.tone : TONES3[i], label: str(g && g.label, 22) };
    }).filter(Boolean);
    return groups.length ? { type, total, groups, title: str(b.title, 28) } : null;
  }
  if (type === 'streak') {
    const src = Array.isArray(b.items) ? b.items.map(x => (x && typeof x === 'object' ? x.r : x)).join('') : String(b.items || '');
    const items = src.toUpperCase().replace(/[^WLT]/g, '').slice(0, 20);
    return items ? { type, items, label: str(b.label, 28) } : null;
  }
  if (type === 'rankTile') {
    const rank = str(b.rank, 6);
    return /\d/.test(rank) ? { type, kicker: str(b.kicker, 16), rank: rank.startsWith('#') ? rank : `#${rank}`, pos: str(b.pos, 12), chip: str(b.chip, 16) } : null;
  }
  if (type === 'tagPill') { const text = str(b.text, 28); return text ? { type, text, tone: TAG_TONES.includes(b.tone) ? b.tone : 'red' } : null; }
  if (type === 'clipLabel') { const text = str(b.text, 22); return text ? { type, text } : null; }
  return null;
}
// The legacy fields a v3 block implies (kind, text, stat) so the rest of
// Reels Studio sees a normal beat.
function v3Legacy(block) {
  const out = { kind: V3_KIND[block.type] };
  if (block.type === 'statTiles') out.stat = { value: block.tiles[0].value, label: block.tiles[0].label };
  if (block.type === 'dotGrid') out.stat = { value: String(block.total), label: block.title };
  if (block.type === 'rankTile') out.stat = { value: block.rank, label: block.pos };
  return out;
}
function v3Text(block) {
  if (block.type === 'photoCard') return block.label || block.photo;
  if (block.type === 'statTiles') return block.tiles.map(t => `${t.value} ${t.label}`).join(' · ');
  if (block.type === 'dotGrid') return block.title || String(block.total);
  if (block.type === 'streak') return block.label || block.items;
  if (block.type === 'rankTile') return [block.kicker, block.rank, block.pos].filter(Boolean).join(' ');
  return block.text || '';
}
// The old "number" / "dots" blocks become statTiles / dotGrid in a v3 style.
function upgradeBlock(raw) {
  const b = raw && typeof raw === 'object' ? raw : null;
  if (!b) return b;
  if (b.type === 'number') {
    const value = str(b.display || `${b.prefix || ''}${b.value}${b.suffix || ''}`, 8);
    return { type: 'statTiles', tiles: [{ value, label: str(b.label || b.kicker, 18), tone: b.color === 'ink' ? 'ink' : 'blue' }] };
  }
  if (b.type === 'dots') return { type: 'dotGrid', total: b.count, title: str(b.label, 28), groups: [{ n: b.highlight, tone: 'blue', label: str(b.note, 22) }] };
  return b;
}
// A scene's subject: the model's, if its name is in the sources (or is the
// reel's team); else derived by code from the beat (reel-clips subjectOfBeat).
function validSubject(raw, beat, read, teamName) {
  const r = raw && typeof raw === 'object' ? raw : null;
  const corpus = squash(read.corpus);
  if (r) {
    const name = clean(r.name, 60);
    const ok = name && (corpus.includes(squash(name)) || (teamName && squash(teamName) === squash(name)));
    if (ok) {
      const team = clean(r.team, 60);
      const sub = CLIPS.subjectOfBeat({ subject: { type: r.type, name, team: team && (corpus.includes(squash(team)) || squash(team) === squash(teamName)) ? team : teamName, date: clean(r.date, 20), moment: clean(r.moment, 60) } }, { team: teamName ? { name: teamName } : null });
      if (sub.date && !corpus.includes(squash(sub.date))) delete sub.date;
      return sub;
    }
  }
  return CLIPS.subjectOfBeat({ ...beat, subject: null }, { team: teamName ? { name: teamName } : null });
}

function validatePlan(parsed, { read, format, steer = '', style: styleId = '', look = '', esStyle = '' } = {}) {
  const v3 = V3_IDS.includes(esStyle) ? esStyle : '';
  const v3Allowed = v3 ? v3Blocks(v3) : [];
  const SRC = require('./_reel-sourcing.js');
  const teamHint = clean(parsed && parsed.team, 80) || (read.team && read.team.name) || '';
  const issues = [];
  const style = STYLES.get(styleId);
  let fmt = F.FORMATS[format] ? format : 'explainer';
  // The model may only move to an explainer (Top-5 without five entries) or,
  // on Auto, to any format.
  const said = String(parsed && parsed.format || '');
  if (F.FORMATS[said] && said !== fmt && (read.auto || said === 'explainer')) fmt = said;
  const spec = F.FORMATS[fmt];
  const allowed = fmt === 'top5' ? spec.kinds : STYLES.kindsFor(style.id, spec.kinds);
  const longForm = style.seconds.max > 90;
  const maxBeats = longForm ? style.beats.max : spec.beats.max;
  const sourceSet = F.numberSet(read.corpus);
  const corpusSquash = squash(read.corpus);
  const raw = Array.isArray(parsed && parsed.beats) ? parsed.beats.slice(0, 14) : [];
  let dropped = 0;
  const beats = [];
  raw.forEach((b0, index) => {
    if (!b0 || typeof b0 !== 'object') { dropped += 1; return; }
    // Reels v3: old number / dots blocks are upgraded, the new blocks are
    // shaped here, and a block the style does not allow becomes a statement.
    let rawBlock = v3 && b0.block ? upgradeBlock(b0.block) : b0.block;
    if (v3 && rawBlock && rawBlock.type && !v3Allowed.includes(rawBlock.type) && !(index === 0 && rawBlock.type === 'hook')) {
      issues.push(`A ${clean(rawBlock.type, 20)} block is not part of ${V3_STYLES[v3].label}, so it became a statement.`);
      rawBlock = CLIPS.fallbackBlock({ text: b0.text || clean(rawBlock.text || rawBlock.label || rawBlock.title, 90), stat: b0.stat });
      if (rawBlock.type !== 'statement' && !v3Allowed.includes(rawBlock.type)) rawBlock = CLIPS.fallbackBlock({ text: b0.text });
    }
    const v3Block = v3 && rawBlock && V3_TYPES.includes(rawBlock.type) ? cleanV3Block(rawBlock) : null;
    if (v3 && rawBlock && V3_TYPES.includes(rawBlock.type) && !v3Block) { dropped += 1; issues.push(`A ${rawBlock.type} block without its data was dropped.`); return; }
    // ES Reels: the block decides the kind and fills the fields the checks
    // below read (stat, bars, dotrank, quote), so its numbers and quotes are
    // held to the same rules.
    const esBlock = !v3Block && style.engine === 'es' && rawBlock && ES.BLOCK_TYPES.includes(rawBlock.type) ? ES.cleanBlock(rawBlock) : null;
    const b = v3Block ? { ...b0, ...v3Legacy(v3Block), text: b0.text || v3Text(v3Block), vo: b0.vo }
      : esBlock ? { ...b0, ...ES.legacyFields(esBlock), text: b0.text || ES.blockText(esBlock), vo: b0.vo } : b0;
    let kind = F.KINDS.includes(b.kind) ? b.kind : 'point';
    if (!allowed.includes(kind)) kind = index === 0 ? 'hook' : (spec.kinds.includes('point') ? 'point' : 'context');
    if (fmt === 'top5' && !['hook', 'rank', 'cta'].includes(kind)) { dropped += 1; issues.push('A non-ranked beat was dropped from the Top 5.'); return; }
    const beat = {
      kind,
      text: F.trimWords(clean(b.text, 90), 12),
      vo: F.trimWords(clean(b.vo, 260), 40),
      emphasis: clean(b.emphasis, 30).split(' ')[0] || '',
      photo: clean(b.photo || b.photoQuery, 60).replace(/[^\p{L}\p{N} .'-]/gu, ''),
      visual: F.VISUALS.includes(b.visual) ? b.visual : '',
    };
    if (beat.visual === 'scene') beat.scene = F.SCENES.includes(b.scene) ? b.scene : 'stadium';
    if (F.COMPONENT_KINDS.includes(kind) || (kind === 'stat' && b.chips)) {
      Object.assign(beat, componentFields(kind, b, read));
      if (b.detail) beat.detail = clean(b.detail, 110);
      if (F.COMPONENT_KINDS.includes(kind) && !COMPONENT_OK[kind](beat)) { dropped += 1; issues.push(`A ${kind} beat without its data was dropped.`); return; }
      if (['bars', 'dotrank', 'chips', 'roles'].includes(kind)) beat.visual = beat.visual || 'chart';
    }
    if (kind === 'stat') {
      const value = clean(b.stat && b.stat.value, 16);
      if (!value || !/\d/.test(value)) { dropped += 1; issues.push('A stat card without a number was dropped.'); return; }
      beat.stat = { value, label: clean(b.stat.label, 24) };
    }
    if (kind === 'rank') {
      beat.rank = Math.round(Number(b.rank));
      beat.name = clean(b.name || b.text, 60);
      beat.detail = clean(b.detail, 110);
      if (!(beat.rank >= 1 && beat.rank <= 5) || !beat.name) { dropped += 1; issues.push('A rank without a place or a name was dropped.'); return; }
    }
    if (kind === 'quote') {
      const q = clean(b.quote && b.quote.text, 220).replace(/^[“"]|[”"]$/g, '');
      if (!q || !corpusSquash.includes(squash(q))) { dropped += 1; issues.push('A quote that is not word for word in the sources was dropped.'); return; }
      beat.quote = { text: q, by: clean(b.quote.by, 60) };
    }
    if (!beat.text && !beat.vo) { dropped += 1; return; }
    if (!beat.text) beat.text = F.trimWords(beat.vo.replace(/[.!?]$/, ''), 7);
    const bad = F.unsourcedNumbers(beat, sourceSet, fmt);
    if (bad.length) { dropped += 1; issues.push(`A beat with ${bad.join(', ')} (not in the sources) was dropped.`); return; }
    if (beat.emphasis && !squash(beat.text).includes(squash(beat.emphasis))) beat.emphasis = '';
    if (v3Block && V3_KIND[v3Block.type] === beat.kind) {
      const bad3 = SRC.unsourcedIn({ block: v3Block }, sourceSet, fmt);
      if (bad3.length) { dropped += 1; issues.push(`A beat with ${bad3.join(', ')} (not in the sources) was dropped.`); return; }
      beat.block = v3Block;
    } else if (v3Block && index === 0) {
      // The hook stays a hook; the block's words lead it.
      beat.block = { type: 'hook', pills: ES.cleanBlock({ type: 'hook', pills: ES.splitLines(beat.text.toUpperCase(), 14).slice(0, 3).map((t, k) => ({ text: t, color: k === 0 ? 'ink' : 'blue' })) }).pills };
    }
    if (v3) {
      beat.subject = validSubject(b0.subject, beat, read, teamHint);
      if (beat.block && beat.block.type === 'photoCard') beat.block.photo = beat.subject.type === 'team' ? beat.subject.name : (beat.subject.name || beat.block.photo);
    }
    if (esBlock && ES.KIND_FOR[esBlock.type] === beat.kind) {
      beat.block = esBlock;
      if (esBlock.type === 'quote' && beat.quote) beat.block = { ...esBlock, text: beat.quote.text, who: esBlock.who || beat.quote.by.toUpperCase() };
      const bad2 = F.unsourcedNumbers({ block: beat.block }, sourceSet, fmt);
      if (bad2.length) { dropped += 1; issues.push(`A beat with ${bad2.join(', ')} (not in the sources) was dropped.`); return; }
    }
    beats.push(beat);
  });

  // Top 5: exactly the five ranks, counting down.
  let weak = false;
  if (fmt === 'top5') {
    const ranks = beats.filter(b => b.kind === 'rank');
    const places = new Set(ranks.map(b => b.rank));
    if (ranks.length !== 5 || places.size !== 5) {
      weak = true;
      issues.push('The Top 5 did not have five sourced entries.');
    } else {
      const sorted = ranks.sort((a, b) => b.rank - a.rank);
      const hook = beats.find(b => b.kind === 'hook');
      const cta = beats.find(b => b.kind === 'cta');
      beats.splice(0, beats.length, ...[hook, ...sorted, cta].filter(Boolean));
    }
  }

  // The hook leads; the end card closes.
  if (beats.length) {
    if (beats[0].kind !== 'hook') {
      const at = beats.findIndex(b => b.kind === 'hook');
      if (at > 0) beats.unshift(beats.splice(at, 1)[0]); else beats[0].kind = 'hook';
    }
    const ctaAt = beats.findIndex(b => b.kind === 'cta');
    if (ctaAt >= 0 && ctaAt !== beats.length - 1) beats.push(beats.splice(ctaAt, 1)[0]);
    if (beats[beats.length - 1].kind !== 'cta') beats.push({ kind: 'cta', text: 'What do you make of it?', vo: 'What do you make of it? Tell us in the comments.', emphasis: '', photo: '' });
    // Numbers never belong on the end card.
    const cta = beats[beats.length - 1];
    if (F.numbersIn(`${cta.text} ${cta.vo}`).length) { cta.text = 'What do you make of it?'; cta.vo = 'What do you make of it? Tell us in the comments.'; }
  }
  // Too many beats: keep the first ones and the end card.
  const final = beats.length > maxBeats ? [...beats.slice(0, maxBeats - 1), beats[beats.length - 1]] : beats;
  if (final.length < spec.beats.min) weak = true;
  if (dropped >= (longForm ? 3 : 2)) weak = true;
  const voWords = final.reduce((n, b) => n + F.wordCount(b.vo), 0);
  if (voWords < (longForm ? 70 : 35)) weak = true;
  // Reels v3, data first: Receipts needs two data blocks; Stat Card a photo
  // card and stat tiles. Short of that the plan is weak (Sonnet is asked).
  if (v3) {
    const types = final.map(b => b.block && b.block.type).filter(Boolean);
    const data = types.filter(t => DATA_BLOCKS.includes(t)).length;
    if (v3 === 'receipts' && data < 2) { weak = true; issues.push('Receipts needs at least two data blocks from the sources.'); }
    if (v3 === 'statcard' && !(types.includes('photoCard') && types.includes('statTiles'))) { if (!types.includes('photoCard') && !types.includes('statTiles')) weak = true; issues.push('Stat Card works best with a photo card and stat tiles.'); }
    if ((v3 === 'gametape' || v3 === 'hypecut') && !types.includes('clipLabel') && types.filter(t => ['hook', 'statement'].includes(t)).length < 2) issues.push(`${V3_STYLES[v3].label} has few scenes that can carry a clip.`);
  }

  // Banned style (frameup-rules): kept as issues so the UI can show them.
  final.forEach((b, i) => RULES.BANNED.forEach(rule => { if (rule.re.test(`${b.text} ${b.vo}`)) issues.push(`Beat ${i + 1}: ${rule.why}.`); }));

  const teamName = clean(parsed && parsed.team, 80);
  const team = (teamName && teamInfo(teamName, read.sport)) || read.team || null;
  const plan = {
    format: fmt,
    title: clean(parsed && parsed.title, 120) || final[0]?.text || '',
    angle: clean(parsed && parsed.angle, 160),
    sport: read.sport,
    team,
    hooks: (Array.isArray(parsed && parsed.hooks) ? parsed.hooks : []).map(h => clean(h, 60)).filter(h => h && !F.unsourcedNumbers({ text: h }, sourceSet, fmt).length).slice(0, 3),
    beats: final,
    steer: clean(steer, 200),
    style: style.id,
    // The ES look (only a real look id is kept; the page defaults to Paper).
    ...(style.engine === 'es' && look && ES.LOOKS[look] ? { look } : {}),
    // Reels v3: the style (Game Tape, Stat Card, Receipts, Hype Cut).
    ...(v3 ? { esStyle: v3 } : {}),
  };
  // Plan-level chrome: eyebrow, series tag, the data strip (numbers sourced).
  const eyebrow = clean(parsed && parsed.eyebrow, 48);
  if (eyebrow && style.chrome.eyebrow) {
    if (F.unsourcedPlanNumbers({ eyebrow }, sourceSet).length) issues.push('The eyebrow had a number not in the sources, so it was left out.'); else plan.eyebrow = eyebrow;
  }
  if (style.chrome.seriesTag) {
    const tag = clean(parsed && parsed.series && parsed.series.tag, 28);
    if (tag && !F.unsourcedPlanNumbers({ series: { tag } }, sourceSet).length) plan.series = { tag };
    const st = parsed && parsed.strip;
    if (st && st.value) {
      const strip = { label: clean(st.label, 32), value: clean(st.value, 14), of: clean(st.of, 14), note: clean(st.note, 48), tone: st.tone === 'good' ? 'good' : 'bad' };
      if (!/\d/.test(strip.value) || F.unsourcedPlanNumbers({ strip }, sourceSet).length) issues.push('The data strip had a number not in the sources, so it was left out.');
      else plan.strip = strip;
    }
  }
  return { plan, issues, dropped, weak, voWords };
}

// ─── Director ────────────────────────────────────────────────────────────
// tier: 'economy' = Haiku only; 'standard' = Haiku, then Sonnet when weak.
async function runReelDirector({ brief = '', trend = null, facts = '', format = 'auto', sport = '', tier = 'standard', steer = '', style: styleId = 'es', look = '', esStyle = '', track = null, timeoutMs = 22000, startedAt = Date.now(), budgetMs = 45000, now = () => Date.now() } = {}) {
  const read = readReelBrief({ brief, trend, facts, sport, format });
  // Reels 2.0: the older styles are retired; a request for one is written in ES.
  const style = STYLES.get(STYLES.currentStyle(styleId));
  const lookId = look && ES.LOOKS[look] ? look : '';
  const v3 = V3_IDS.includes(esStyle) ? esStyle : '';
  const longForm = style.seconds.max > 90;
  const result = { plan: null, read, model: '', cost: 0, source: 'draft', issues: [], escalated: false };
  const draft = () => {
    const plan = F.fallbackPlan({ brief: read.text, title: trend ? trend.title : '', format: read.format, sport: read.sport });
    plan.team = read.team;
    plan.style = style.id;
    if (lookId) plan.look = lookId;
    if (v3) plan.esStyle = v3;
    return plan;
  };
  let api;
  try { api = gateway(); } catch { api = null; }
  if (!api || !api.gatewayConfigured()) return { ...result, plan: draft(), source: 'draft', reason: 'off' };
  const ask = askTier => api.aiText({
    tier: askTier,
    system: DIRECTOR_SYSTEM,
    cacheSystem: true,
    json: true,
    messages: [{ role: 'user', content: directorRequest({ read, format: read.format, steer, style, look: lookId, esStyle: v3 }) }],
    effort: 'low',
    maxTokens: longForm ? 5200 : (v3 ? 3200 : 2600),
    timeoutMs,
    track: track ? { ...track, feature: askTier === 'best' ? 'reels-director-sonnet' : 'reels-director' } : undefined,
  });
  let best = null;
  const attempt = async askTier => {
    const reply = await ask(askTier);
    result.cost += Number(reply.cost) || 0;
    const checked = validatePlan(extractJson(reply.text), { read, format: read.format, steer, style: style.id, look: lookId, esStyle: v3 });
    checked.model = reply.model;
    if (!best || (best.weak && !checked.weak) || (best.weak === checked.weak && checked.plan.beats.length > best.plan.beats.length)) best = checked;
    return checked;
  };
  try {
    const first = await attempt('main');
    if (first.weak && tier !== 'economy' && now() - startedAt < budgetMs - timeoutMs) {
      result.escalated = true;
      await attempt('best').catch(error => { if (api.isBudgetError(error)) result.reason = 'budget'; });
    }
  } catch (error) {
    if (api.isBudgetError(error)) return { ...result, plan: draft(), source: 'draft', reason: 'budget' };
    if (!best) return { ...result, plan: draft(), source: 'draft', reason: 'error' };
  }
  if (!best || !best.plan.beats.length || (best.weak && best.plan.beats.length < 3)) {
    return { ...result, plan: draft(), source: 'draft', reason: 'weak', issues: best ? best.issues : [] };
  }
  // A Top 5 that still lacks five entries becomes an explainer of what it has.
  if (best.plan.format === 'top5' && best.weak) {
    best.plan.format = 'explainer';
    best.plan.beats = best.plan.beats.map(b => (b.kind === 'rank' ? { kind: 'point', text: b.name || b.text, vo: b.vo, emphasis: '', photo: b.photo } : b));
  }
  return { ...result, plan: best.plan, model: best.model, source: result.escalated && best.model && /sonnet/.test(best.model) ? 'director-sonnet' : 'director', issues: best.issues, weak: best.weak };
}

// ─── Revise ("shorter", "punchier", "more stats", or free text) ─────────
const REVISE_PRESETS = {
  shorter: 'Make it about 25% shorter: cut the weakest beat and trim every voiceover line.',
  punchier: 'Make every on-screen line punchier (fewer words, stronger verbs) and sharpen the hook.',
  hook: 'Write a stronger hook for beat 1: lead with the most surprising sourced fact in 5-7 words.',
  calmer: 'Make the tone calmer and more analytical, like a studio analyst.',
};
async function revisePlan({ plan, instruction = '', corpus = '', track = null, timeoutMs = 20000 } = {}) {
  const api = gateway();
  const read = { corpus: clean(corpus, 8000), auto: false, route: F.routeFormat(''), sport: plan && plan.sport || '', team: plan && plan.team || null };
  const ask = REVISE_PRESETS[instruction] || clean(instruction, 300);
  if (!ask) throw new Error('Say what to change.');
  const style = STYLES.get(STYLES.currentStyle(plan && plan.style));
  const lookId = plan && ES.LOOKS[plan.look] ? plan.look : '';
  const v3 = plan && V3_IDS.includes(plan.esStyle) ? plan.esStyle : '';
  const current = { format: plan.format, title: plan.title, team: plan.team ? plan.team.name : '', eyebrow: plan.eyebrow, series: plan.series, strip: plan.strip, beats: (plan.beats || []).slice(0, style.beats.max) };
  const reply = await api.aiText({
    tier: 'main',
    system: DIRECTOR_SYSTEM,
    cacheSystem: true,
    json: true,
    messages: [{ role: 'user', content: `${directorRequest({ read, format: F.FORMATS[plan.format] ? plan.format : 'explainer', style, look: lookId, esStyle: v3 })}\n\nCURRENT REEL:\n${JSON.stringify(current)}\n\nCHANGE: ${ask}\nReturn the whole revised reel as JSON in the same shape. Keep the format.` }],
    effort: 'low',
    maxTokens: style.seconds.max > 90 ? 5200 : 2600,
    timeoutMs,
    track: track ? { ...track, feature: 'reels-revise' } : undefined,
  });
  const checked = validatePlan(extractJson(reply.text), { read, format: F.FORMATS[plan.format] ? plan.format : 'explainer', style: style.id, look: lookId, esStyle: v3 });
  return { ...checked, model: reply.model, cost: Number(reply.cost) || 0 };
}

// ─── Fact check (capped web research) ────────────────────────────────────
const FACT_CHECK = { maxUses: 2, maxCostUsd: 0.03, timeoutMs: 30000 };
async function factCheck({ topic = '', sport = '', track = null } = {}) {
  const api = gateway();
  const subject = clean(topic, 400);
  if (subject.length < 6) return { text: '', urls: [], cost: 0 };
  const research = await api.aiWebResearch({
    tier: 'main',
    system: 'You check facts for a sports reel. Answer in plain lines: the key facts and every number (stats, scores, records, dates) about the story, each with its source site. Only facts you found in search results. No opinions.',
    prompt: `Story${sport ? ` (${sport.toUpperCase()})` : ''}: ${subject}\nList the verified facts and numbers.`,
    maxUses: FACT_CHECK.maxUses,
    maxCostUsd: FACT_CHECK.maxCostUsd,
    maxTokens: 900,
    timeoutMs: FACT_CHECK.timeoutMs,
    track: track ? { ...track, feature: 'reels-factcheck' } : undefined,
  });
  return { text: clean(research.text, 4000), urls: (research.urls || []).slice(0, 8), cost: Number(research.cost) || 0, capped: Boolean(research.capped) };
}

// ─── Data formats: Game Swing, Moment Replay, Archive ───────────────────
// Contract §3, §6. Code plans the reel (reel-data.js): which plays, which
// moments, which frames, and every beat's refs into timeline.data. The
// model only rewrites the words (one Haiku call, optional): it never adds,
// drops or reorders a beat, never touches refs, and a line with a number
// that FACTS do not contain keeps the code's own line. With AI off, over a
// cap or on any failure the code plan ships as it is (free).
const T = require('../../reel-timeline.js');
const DATA = require('../../reel-data.js');

const DATA_SYSTEM = [
  'You write the on-screen lines for an EssentiallySports (ES) data reel: a 9:16 sports reel built from real game data, ES coverage or a clip.',
  'The beats are fixed. Return one entry per beat id given, in the same order. Do not add, remove or reorder beats.',
  'Return JSON only: {"title":"...","beats":[{"id":"b1","text":"...","vo":"..."}],"hooks":["alt hook","alt hook"]}',
  '- text: the on-screen line, 2-9 words, punchy, no full stop. It must describe the beat\'s DATA (the play, the moment, the frames).',
  '- vo: what the ES voice says over the beat, 6-22 words, or "" when VOICE is off.',
  'Rules:',
  '1. Every number (score, yards, year, percent, stat) must appear in FACTS exactly. Never invent, round or estimate. If unsure, leave numbers out.',
  '2. Name only people named in FACTS. No quotes. No emojis, hashtags, links, "Breaking" or hype words (shocking, insane, unbelievable).',
  '3. The hook (first beat) carries the story in 5-7 words. The last beat is a question to fans with no numbers.',
  '4. A win-probability beat must not restate the attribution; the renderer draws "Win probability: ESPN Analytics" itself.',
].join('\n');

const DATA_CACHE = new Map();
const DATA_TTL_MS = 45 * 60 * 1000;

// The facts text for a data plan: what the lint and the model may use.
function dataFacts({ format, digest, athlete, archive, captions }) {
  const parts = [];
  if (digest) parts.push(T.digestFacts(digest));
  if (format === 'archive') parts.push(DATA.archiveFacts(archive, athlete));
  if (captions && typeof captions === 'object') parts.push(['setup', 'play', 'reaction'].map(r => clean(captions[r], 60)).filter(Boolean).join('. '));
  return parts.filter(Boolean).join('\n');
}

// What a beat shows, in words, for the prompt (resolved from its refs).
function beatBrief(beat, tl) {
  const lines = (beat.refs || []).map(ref => {
    const hit = T.resolveRef(tl, ref);
    if (!hit) return '';
    if (ref.startsWith('play:')) return `play: ${hit.text} (score after: ${tl.data.game.teams.away.abbr} ${hit.score.away}, ${tl.data.game.teams.home.abbr} ${hit.score.home})`;
    if (ref.startsWith('wp:')) return '';
    if (ref.startsWith('src:')) return `ES article: ${hit.title} (${String(hit.date || '').slice(0, 4)})`;
    if (ref.startsWith('stat:')) return `stat row ${ref.slice(5)}`;
    if (ref.startsWith('frame:')) return `frame: ${ref.slice(6)}`;
    return '';
  }).filter(Boolean);
  return { id: beat.id, kind: beat.kind, current: beat.text, shows: lines.join(' | ') || (beat.kind === 'wpline' ? 'the win-probability line of the whole game' : '') };
}

// Request body -> trusted data inputs. Digests are re-validated (or taken
// from this server's cache for the same game); archive moments are
// re-verified against the articles and stat rows they cite.
function readDataInput(body, { cachedDigest = null } = {}) {
  const b = body || {};
  const format = F.isDataFormat(b.format) ? b.format : '';
  let digest = null;
  const sent = b.digest && typeof b.digest === 'object' ? b.digest : null;
  if (sent && cachedDigest) digest = cachedDigest(sent.sport, sent.eventId) || null;
  if (!digest && sent && T.validateDigest(sent).ok) digest = sent;
  let athlete = null;
  const sentAthlete = b.athlete && typeof b.athlete === 'object' ? b.athlete : (b.archive && typeof b.archive.athlete === 'object' ? b.archive.athlete : null);
  if (sentAthlete && T.validateTimeline({ v: 2, beats: [], data: { athlete: sentAthlete } }).ok) athlete = sentAthlete;
  let archive = null;
  if (format === 'archive' && b.archive && typeof b.archive === 'object') {
    const ARCH = require('./_reel-archive.js');
    const sources = (Array.isArray(b.archive.articles) ? b.archive.articles : (Array.isArray(b.archive.sources) ? b.archive.sources : []))
      .filter(s => s && /^a\d{1,3}$/.test(String(s.id)) && /^https:\/\/(?:www\.)?essentiallysports\.com\//.test(String(s.url)) && T.validateTimeline({ v: 2, beats: [], data: { archive: { sources: [s] } } }).ok)
      .slice(0, T.LIMITS.sources);
    const photos = (Array.isArray(b.archive.photos) ? b.archive.photos : []).filter(p => p && /^p\d{1,3}$/.test(String(p.id)) && ARCH.isEsPhoto(p.url)).slice(0, T.LIMITS.photos);
    const pool = (Array.isArray(b.archive.candidates) ? b.archive.candidates : (Array.isArray(b.archive.moments) ? b.archive.moments : [])).slice(0, T.LIMITS.moments);
    const { kept } = ARCH.verifyCandidates(pool, { articles: sources, stats: athlete && athlete.stats });
    archive = {
      athleteId: clean(b.archive.athleteId || (athlete && athlete.athleteId), 32), angle: clean(b.angle || b.archive.angle, 120),
      sources, photos, candidates: kept.map(m => ({ ...m, photoId: photos.some(p => p.id === m.photoId) ? m.photoId : null })),
      thin: Boolean(b.archive.thin || (b.archive.coverage && b.archive.coverage.thin)),
    };
  }
  let replay = null;
  if (format === 'replay' && b.replay && typeof b.replay === 'object' && T.validateTimeline({ v: 2, beats: [], replay: b.replay }).ok) replay = b.replay;
  const captions = b.captions && typeof b.captions === 'object' ? Object.fromEntries(['setup', 'play', 'reaction'].map(r => [r, clean(b.captions[r], 60)])) : null;
  // Clip post URLs are kept as they are (clean() strips URLs): https, no spaces or quotes.
  const clipUrl = u => (/^https:\/\/[^\s"'<>]{1,400}$/.test(String(u || '')) ? String(u) : '');
  const clips = (Array.isArray(b.clips) ? b.clips : []).slice(0, 40).filter(c => c && clipUrl(c.url)).map(c => ({ url: clipUrl(c.url), handle: clean(c.handle, 40), text: clean(c.text, 280), postedAt: clean(c.postedAt, 40) }));
  // Game Swing: the editor's ticked key plays, kept only when the digest has them.
  const playIdsSent = Array.isArray(b.playIds);
  const known = new Set(digest ? digest.plays.map(p => String(p.id)) : []);
  const playIds = playIdsSent ? [...new Set(b.playIds.slice(0, 60).map(id => clean(id, 40)).filter(id => known.has(id)))] : [];
  return { format, digest, athlete, archive, replay, captions, clips, playIds, playIdsSent, angle: clean(b.angle, 120), name: clean(b.name, 80), playId: clean(b.playId, 40), title: clean(b.title, 90) };
}
function hasDataInput(input) {
  if (!input || !input.format) return false;
  if (input.format === 'gameswing') return Boolean(input.digest);
  if (input.format === 'archive') return Boolean(input.archive && input.archive.candidates.length);
  if (input.format === 'replay') return Boolean(input.replay);
  return false;
}

function codeDataPlan(input, { style = '' } = {}) {
  const S = style || F.FORMATS[input.format].defaultStyle;
  if (input.format === 'gameswing') {
    const handles = input.digest ? require('./_reel-games.js').teamHandles(input.digest) : {};
    return DATA.planFromGame(input.digest, { style: S, clips: input.clips, playIds: input.playIds, ...handles, title: input.title });
  }
  if (input.format === 'archive') return DATA.planFromArchive(input.archive, input.athlete, { style: S, angle: input.angle, name: input.name, sport: input.athlete && input.athlete.sport });
  if (input.format === 'replay') return DATA.planFromReplay(input.replay, { style: S, captions: input.captions, title: input.title, game: input.digest, playId: input.playId });
  return null;
}
// A plan as a timeline, to resolve refs (the same check the page runs).
const planTimeline = plan => ({ v: 2, canvas: { w: 1080, h: 1920 }, outputs: plan.outputs, format: plan.format, beats: plan.beats, data: plan.data, replay: plan.replay, slides: plan.slides });

function validateDataCopy(parsed, plan, facts, { voice = false } = {}) {
  const sourceSet = F.numberSet(facts);
  const issues = [];
  const byId = new Map((Array.isArray(parsed && parsed.beats) ? parsed.beats : []).filter(b => b && b.id).map(b => [String(b.id), b]));
  let changed = 0;
  const beats = plan.beats.map((beat, i) => {
    const got = byId.get(beat.id);
    if (!got) return beat;
    const text = F.trimWords(clean(got.text, 90), 12).replace(/[.]$/, '');
    const vo = voice ? F.trimWords(clean(got.vo, 220), 30) : '';
    const next = { ...beat, text: text || beat.text, vo: vo || beat.vo };
    const last = i === plan.beats.length - 1;
    const bad = F.unsourcedNumbers({ text: next.text, vo: next.vo }, sourceSet, plan.format);
    if (bad.length || (last && F.numbersIn(`${next.text} ${next.vo}`).length)) { issues.push(`Beat ${i + 1}: kept the data line (the rewrite had ${bad.join(', ') || 'a number'}).`); return beat; }
    if (RULES.BANNED.some(rule => rule.re.test(`${next.text} ${next.vo}`))) { issues.push(`Beat ${i + 1}: kept the data line (banned wording).`); return beat; }
    if (next.text !== beat.text || next.vo !== beat.vo) changed += 1;
    return next;
  });
  const title = clean(parsed && parsed.title, 120);
  const hooks = (Array.isArray(parsed && parsed.hooks) ? parsed.hooks : []).map(h => clean(h, 60)).filter(h => h && !F.unsourcedNumbers({ text: h }, sourceSet).length).slice(0, 3);
  return { beats, title: title && !F.unsourcedNumbers({ text: title }, sourceSet).length ? title : plan.title, hooks, issues, changed };
}

// The data-format director. input = readDataInput(body). Never throws.
async function runDataDirector(input, { style = '', look = '', tier = 'standard', steer = '', voice = false, blocked = '', track = null, timeoutMs = 18000 } = {}) {
  const plan = codeDataPlan(input, { style: style ? STYLES.currentStyle(style) : '' });
  if (plan && look && ES.LOOKS[look]) plan.look = look;
  if (!plan) return { plan: null, source: 'draft', reason: 'no-data', cost: 0, model: '', issues: ['No usable data for this format.'], corpus: '' };
  const facts = dataFacts({ format: input.format, digest: plan.data.game, athlete: plan.data.athlete, archive: input.archive, captions: input.captions });
  const tl = planTimeline(plan);
  const check = T.validateTimeline(tl);
  const base = { plan, source: 'data', reason: blocked || '', cost: 0, model: '', issues: check.errors.map(e => `${e.path}: ${e.msg}`).slice(0, 8), corpus: facts, refsOk: check.ok };
  if (blocked || tier === 'off') return base;
  let api;
  try { api = gateway(); } catch { api = null; }
  if (!api || !api.gatewayConfigured()) return { ...base, reason: 'off' };
  const key = crypto.createHash('sha256').update(JSON.stringify([input.format, plan.beats.map(b => [b.id, b.kind, b.text, b.refs]), facts, steer, voice])).digest('hex');
  const hit = DATA_CACHE.get(key);
  if (hit && Date.now() - hit.at < DATA_TTL_MS) return { ...base, ...hit.value, plan: { ...plan, ...hit.value.planPatch }, cost: 0, cached: true };
  const request = [
    `FORMAT: ${F.FORMATS[input.format].label}`,
    `VOICE: ${voice ? 'on' : 'off'}`,
    steer ? `EDITOR NOTE: ${clean(steer, 300)}` : '',
    'BEATS (id, kind, what it shows, the current line):',
    ...plan.beats.map(b => { const x = beatBrief(b, tl); return `- ${x.id} ${x.kind}: ${x.shows || '-'} | current: "${x.current}"`; }),
    'FACTS (the only facts you may use):',
    '<<<', facts || '(none)', '>>>',
  ].filter(Boolean).join('\n');
  try {
    const reply = await api.aiText({
      tier: 'main', system: DATA_SYSTEM, cacheSystem: true, json: true,
      messages: [{ role: 'user', content: request }], effort: 'low', maxTokens: 1400, timeoutMs,
      track: track ? { ...track, feature: 'reels-director' } : undefined,
    });
    const copy = validateDataCopy(extractJson(reply.text), plan, facts, { voice });
    const planPatch = { beats: copy.beats, title: copy.title, hooks: copy.hooks };
    const value = { source: copy.changed ? 'director' : 'data', model: reply.model || '', issues: [...base.issues, ...copy.issues].slice(0, 8), planPatch };
    DATA_CACHE.set(key, { at: Date.now(), value });
    if (DATA_CACHE.size > 200) DATA_CACHE.delete(DATA_CACHE.keys().next().value);
    return { ...base, ...value, plan: { ...plan, ...planPatch }, cost: Number(reply.cost) || 0 };
  } catch (error) {
    return { ...base, reason: api.isBudgetError && api.isBudgetError(error) ? 'budget' : 'error' };
  }
}

module.exports = {
  V3_STYLES, V3_IDS, V3_TYPES, V3_KIND, V3_SPEC, v3Request, v3StyleOf, v3Blocks, cleanV3Block, upgradeBlock, validSubject,
  readReelBrief, directorRequest, styleRequest, lookRequest, ES_SPEC, validatePlan, runReelDirector, COMPONENT_SPEC, revisePlan, factCheck, teamInfo,
  DIRECTOR_SYSTEM, REVISE_PRESETS, FACT_CHECK, KIT_SPORT,
  DATA_SYSTEM, runDataDirector, readDataInput, hasDataInput, codeDataPlan, dataFacts, validateDataCopy, planTimeline, DATA_CACHE,
  _test: { extractJson, clean, squash, beatBrief },
};

// Reels v4 (the ES breakdown reels): the script-first director, the critic
// and the "Need a script?" helper live in _reel-director4.js; re-exported
// here so callers keep one director module.
Object.assign(module.exports, require('./_reel-director4.js'));
