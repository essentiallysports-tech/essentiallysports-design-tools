'use strict';
// Generate "Creative": the composer's server half (frameup-compose.js is the
// composition library, the guideline gate and the renderer).
//
//   readCreative(brief, found)   code: the brief's stories (LPGA vs PGA), the
//                                facts in each (money, counts, scores, records,
//                                compares, quotes), people and teams.
//   planDeterministic(read, ...) code: 2-4 varied directions with no AI (the
//                                fallback, and the floor every run starts from).
//   runArtDirector(...)          one AI call (Sonnet): per direction the story,
//                                the composition archetype, copy, the number,
//                                the photo, the concept art and a specific note.
//   validateDirections(...)      never trusts the model: archetype must fit,
//                                numbers only from facts, headline grounded in
//                                its story (or a cited ES story), variety.
//   resolveAssets / inputsFor    photos (different per design), cut-outs, concept
//                                art, logos, palette -> composer inputs.
//   plan(...)                    the whole server step -> directions with 2-3
//                                candidate scenes each (checked by the ES gate).
//   judge(...)                   the art director's vision pass over small JPEGs
//                                the page rendered: rubric scores, the pick, one
//                                whitelisted fix and a specific note.
//
// Asset service (feature/gen-assets) is optional: required defensively; without
// it photos come from ES search (es-generate.js) and concept art is ES vector
// art (no AI, no cost).
const COMPOSE = require('../../frameup-compose.js');
const RULES = require('../../frameup-rules.js');
const BRAND_KIT = require('../../brand-kit.js');
const LOGOS = require('../../logo-library.js');
const GUIDE = require('../../es-guidelines.js');
const { findTeam, findSport } = require('./_lint-spec.js');
const MEMORY = require('./_creative-memory.js');

let ASSETS = null;
try { ASSETS = require('./_asset-service.js'); } catch (error) { ASSETS = null; }
const gateway = () => require('./_ai-gateway.js');
const assetService = () => ASSETS;
function setAssetService(service) { ASSETS = service; }

// ─── Text helpers ─────────────────────────────────────────────────────────
const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[‐-―−]/g, '-').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const cut = (value, max) => clean(value).slice(0, max).trim();
const squash = text => ` ${String(text || '').toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim()} `;
const STOP = new Set('a an the and or but of in on at to for with from by as is are was were be been it its his her their this that these those into over after before about than then them they he she we you our your up out off all just so very also'.split(' '));
const keyTerms = text => [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w)))];
const digitsIn = text => (String(text || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || []);

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    const ch = raw[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(raw.slice(start, end)); } catch (error) { /* shrink */ }
  }
  return null;
}

// ─── 1. Stories and facts (code only) ─────────────────────────────────────
const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|billion|thousand|mil|bn|m|b|k)?\b/gi;
const PAIR = /(?:^|[^\d/.$-])(\d{1,3}(?:,\d{3})?)\s?[-–]\s?(\d{1,3}(?:,\d{3})?)(?![\d/.%-])/g;
const COUNT = /(?:^|[^\d$.,/-])(\d[\d,]*(?:\.\d+)?)(%|\+)?\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})/g;
const NOUN_STOP = /^(?:and|or|but|on|in|at|to|for|with|the|a|an|as|of|from|by|after|before|since|while|when|this|that|his|her|their|its)$/i;
const SUFFIX = { million: 'M', mil: 'M', m: 'M', billion: 'B', bn: 'B', b: 'B', thousand: 'K', k: 'K' };
const RECORD_CUE = /\b(?:start|starts|started|record|at|to|improve|improves|improved|fall|falls|fell|move|moves|moved|sit|sits|season|now)\s*(?:the\s+season\s+)?(?:at\s+|to\s+)?$/i;
const HYPHEN_SPAN = /(?:^|[^\d$.,/-])(\d{1,3})-(year|game|match|week|day|month|time|point|run|yard|hole|man|team|win|loss|stroke|shot)s?\b/gi;
const RATIO = /(?:^|[^\d$.,/-])(\d{1,3})\s+of\s+(?:(?:his|her|their|its|the)\s+)?(?:(last|first|past)\s+)?(\d{1,3})\s*([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})?/g;
const ORDINAL = /(?:^|[^\d$.,/-])(\d{1,3})(st|nd|rd|th)\b\s*([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})?/gi;
const RANK = /\b(?:No\.|#)\s?(\d{1,3})\b/g;
const IDENT_BEFORE = /\b(?:Game|Week|Round|Race|Stage|Hole|Day|Match|Episode|Chapter|Leg|Set|Heat|Matchday|Gameweek|Lap)\s*$/i;
const COMPARE_CUE = /\b(?:outgain(?:ed|s)?|outscor(?:ed|es)|out-?rebound(?:ed|s)?|outshot|yards?|edge|advantage)\b/i;

// A short label from the words after a number ("100 players earning cards" -> "PLAYERS EARNING CARDS").
function labelAfter(rest) {
  const list = clean(rest).split(' ');
  const out = [];
  for (const word of list) {
    if (NOUN_STOP.test(word) && out.length) break;
    if (/[.,;:!?]$/.test(word)) { out.push(word.replace(/[.,;:!?]+$/, '')); break; }
    out.push(word);
    if (out.length >= 3) break;
  }
  return out.filter(w => !NOUN_STOP.test(w)).join(' ');
}

// ─── 1a. Content sense (code): what a number means, whether a label reads ──
// gen-director (2026-11-20). A senior designer never ships our own coverage
// counts ("4 STORIES · 6 OUTLETS") as stats, a year as the hero number, a label
// that runs into the next sentence ("2027 SEASON WHY FANS"), or the number
// repeated in the headline. These rules hold for every brief and sport.
//
// Coverage words: how much WE (or the web) wrote about a story, never a fact
// about the story itself.
const COVERAGE_WORDS = 'stories|story|outlets?|articles?|sources?|reports?|publications?|searches|mentions|posts|links|headlines|tweets|clicks|shares';
const COVERAGE_LABEL = new RegExp(`^(?:${COVERAGE_WORDS})\\b`, 'i');
// "4 stories on this · 6 outlets · fits The Spun", "50K+ searches", "Hot".
const COVERAGE_PHRASE = new RegExp(`\\b\\d[\\d,.]*\\s*[KkMm]?\\+?\\s+(?:${COVERAGE_WORDS})(?:\\s+(?:on|about)\\s+(?:this|it|the story))?(?:\\s+(?:across|from|in|on|at|and)\\s+\\d[\\d,.]*\\s*[KkMm]?\\+?\\s+(?:${COVERAGE_WORDS}))?\\b`, 'gi');
// Sentences about the coverage, not the story ("Everyone is covering X's move").
const META_SENTENCE = /\b(?:everyone|everybody|the internet|social media|the media|fans|outlets|reporters)\s+(?:is|are|keeps?|has been|have been)\s+(?:covering|talking about|buzzing about|reacting to|writing about|discussing)\b|\b(?:is|are)\s+(?:trending|going viral)\b|\bstories on this\b/i;
const MONTHS = /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?$/i;
const DURATION = /^(?:seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|yrs?|decades?|nights?)$/i;
const AGE_CUE = /^(?:years?\s+old|year-old|-year-old)/i;
// Words that never belong in a stat label: questions, verbs-to-be, pronouns.
const LABEL_BREAK = new Set('why how what who whom whose when where which whether will would could should can cannot might must may is are was were be been being am has have had do does did he she they it we you i me him them us his her their its our your my this that these those there here if because so yet but or nor and then than'.split(' '));
const LABEL_TAIL = /^(?:a|an|the|of|to|for|with|from|by|in|on|at|as|after|before|since|while|during|into|over|under|about|more|less|most|very|just|only|also|all|some|any)$/i;
// Labels that make a count a real sports stat (score 4-5).
const STRONG_LABEL = /\b(?:yards?|yds|points?|pts|ppg|rpg|apg|touchdowns?|tds?|goals?|assists?|ast|rebounds?|reb|wins?|losses|titles?|majors?|championships?|rings?|home\s+runs?|hrs?|rbis?|strikeouts?|ks|saves?|sacks?|interceptions?|ints?|birdies|eagles|bogeys|under\s+par|over\s+par|shots?|strokes?|aces?|grand\s+slams?|slams?|laps?|podiums?|poles?|caps?|games?|starts?|appearances?|seasons?|picks?|catches|receptions?|carries|hits|runs|steals?|blocks?|threes|3-pointers|three-pointers|triple-doubles?|double-doubles?|mph|tournaments?|events?|records?|all-stars?|mvps?|seeds?|rank(?:ing)?|place|finishes|top-\d+|cuts?|victories|trophies|medals?|golds?|caps|clean\s+sheets|innings|era|batting|hitters?|no-hitters?|shutouts?|fumbles?|completions?|passes|passing|rushing|receiving|players|teams|contracts?|years\s+deal|consecutive|straight|in\s+a\s+row|career|all-time|franchise|nfl|nba|mlb|pga|lpga|atp|wta|tour)\b/i;

// A stat label that reads: a short noun phrase from the facts. Cuts the label
// where the sentence moves on ("season Why fans" -> "season"): at a question
// word, a pronoun, a verb-to-be, or a capitalised word after a lower-case one.
function senseLabel(raw) {
  const list = clean(raw).replace(/[·|•]+/g, ' ').split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < list.length && out.length < 4; i += 1) {
    const word = list[i].replace(/[.,;:!?)"”]+$/, '');
    if (!word || LABEL_BREAK.has(word.toLowerCase())) break;
    if (out.length && /^[A-Z]/.test(word) && /^[a-z]/.test(out[out.length - 1])) break;
    out.push(word);
    if (/[.,;:!?]$/.test(list[i])) break;
  }
  while (out.length && LABEL_TAIL.test(out[out.length - 1])) out.pop();
  return out.join(' ');
}
const labelReads = label => {
  const value = clean(label);
  if (!value) return true;
  return senseLabel(value).toLowerCase() === value.toLowerCase() && value.split(' ').length <= 4 && !/\d{4}/.test(value);
};
const isYear = value => /^(?:19|20)\d{2}$/.test(String(value || '').replace(/,/g, ''));

// How meaningful a fact is as a stat on a design (0-5). 0: never shown as a
// number (coverage counts, years, dates, ages). The hero number needs 3+.
function statWeight(fact = {}) {
  const label = clean(fact.label);
  if (fact.kind === 'meta' || fact.kind === 'date') return 0;
  if (fact.kind === 'money') return 5;
  if (fact.kind === 'score' || fact.kind === 'record') return 5;
  if (fact.kind === 'compare') return 4;
  if (fact.kind === 'ratio') return 4;
  if (fact.kind === 'rank') return 3;
  if (fact.kind === 'ordinal') return STRONG_LABEL.test(label) || /\b(?:mvp|title|major|trophy|win|career|straight|ring|cup|slam|pole|gold)\b/i.test(label) ? 4 : 1;
  if (COVERAGE_LABEL.test(label)) return 0;
  if (isYear(fact.value) && !fact.prefix && !fact.suffix) return 0;
  if (MONTHS.test(label.split(' ')[0] || '') || AGE_CUE.test(label)) return 0;
  if (fact.kind === 'pct') return label ? 4 : 2;
  if (!label) return 1;
  if (DURATION.test(label.split(' ')[0]) && !STRONG_LABEL.test(label)) return 1;
  if (STRONG_LABEL.test(label)) return /^(?:players|teams|tour|nfl|nba|mlb|pga|lpga|atp|wta)$/i.test(label) ? 3 : 5;
  return 2;
}
// Marks a fact list in place: kind 'meta' / 'date' where the number is not a
// stat, a label that reads, and its weight.
function senseFacts(facts = []) {
  facts.forEach(f => {
    if (f.kind === 'count' || f.kind === 'pct') {
      const label = senseLabel(f.label);
      if (label !== f.label) { f.rawLabel = f.label; f.label = label; f.text = clean(`${f.value}${f.suffix || ''} ${label}`); }
      if (COVERAGE_LABEL.test(f.label)) f.kind = 'meta';
      else if (!f.suffix && isYear(f.value)) f.kind = 'date';
      else if (MONTHS.test(f.label.split(' ')[0] || '') || AGE_CUE.test(f.label)) f.kind = 'date';
    }
    if (f.kind === 'money' && f.label) f.label = senseLabel(f.label);
    f.weight = statWeight(f);
  });
  return facts;
}
const isStat = (fact, min = 2) => Boolean(fact) && (fact.weight ?? statWeight(fact)) >= min;
// The brief minus our own coverage meta: "4 stories on this · 6 outlets".
function stripCoverage(text) {
  return String(text || '')
    .split('\n')
    .map(line => line
      .replace(COVERAGE_PHRASE, ' ')
      .replace(/\bfits\s+[A-Z][\w'&. ]{1,40}?(?=\s*(?:[·|•]|$))/g, ' ')
      .replace(/(?:\s*[·|•]\s*)+/g, ' · ')
      .replace(/^\s*[·|•]\s*|\s*[·|•]\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(line => !/^\s*(?:why fans care|why now)\s*:\s*$/i.test(line))
    .join('\n');
}

function factsIn(text, storyId, start = 1) {
  const facts = [];
  const taken = [];
  const add = (fact, at, len) => {
    if (taken.some(([a, b]) => at < b && at + len > a)) return;
    taken.push([at, at + len]);
    facts.push({ id: `f${start + facts.length}`, story: storyId, ...fact });
  };
  for (const m of String(text).matchAll(MONEY)) {
    const unit = (m[2] || '').toLowerCase();
    const label = labelAfter(text.slice(m.index + m[0].length));
    add({ kind: 'money', text: clean(m[0]), prefix: '$', value: m[1], suffix: SUFFIX[unit] || '', label, display: `$${m[1]}${SUFFIX[unit] || ''}` }, m.index, m[0].length);
  }
  for (const m of String(text).matchAll(PAIR)) {
    const at = m.index + m[0].indexOf(m[1]);
    const before = text.slice(Math.max(0, at - 40), at);
    const after = text.slice(at + m[0].length - (m[0].length - m[0].indexOf(m[1])), at + 60);
    const a = Number(m[1].replace(/,/g, ''));
    const b = Number(m[2].replace(/,/g, ''));
    let kind = 'score';
    if (a >= 100 && b >= 100) kind = 'compare';
    else if (COMPARE_CUE.test(before.slice(-24))) kind = 'compare';
    else if (RECORD_CUE.test(before) || /^\s*(?:record|start|season|\))/i.test(after.replace(/^[\d,]+\s?[-–]\s?[\d,]+/, ''))) kind = 'record';
    else if (/\(\s*$/.test(before)) kind = 'record';
    add({ kind, text: `${m[1]}-${m[2]}`, a: m[1], b: m[2], value: `${m[1]}-${m[2]}`, display: `${m[1]}-${m[2]}`, label: '' }, at, `${m[1]}-${m[2]}`.length + 2);
  }
  // "10-year", "15-game": a span, kept so the words around it stay grounded.
  for (const m of String(text).matchAll(HYPHEN_SPAN)) {
    const at = m.index + m[0].indexOf(m[1]);
    add({ kind: 'count', text: `${m[1]}-${m[2]}`, prefix: '', value: m[1], suffix: '', label: m[2].toLowerCase(), display: m[1], span: true }, at, m[1].length + 1 + m[2].length);
  }
  // "14 of her last 15 matches": a run, one fact (never "15 MATCHES" alone).
  for (const m of String(text).matchAll(RATIO)) {
    const at = m.index + m[0].indexOf(m[1]);
    const noun = labelAfter(m[4] || '');
    add({ kind: 'ratio', text: clean(m[0].slice(m[0].indexOf(m[1]))), prefix: '', value: m[1], suffix: '', label: clean(`of ${m[2] ? `${m[2].toLowerCase()} ` : ''}${m[3]} ${noun}`), display: `${m[1]}/${m[3]}` }, at, m[0].length - m[0].indexOf(m[1]));
  }
  // "4th MVP", "70th career win", "3rd major title": an ordinal milestone.
  for (const m of String(text).matchAll(ORDINAL)) {
    const at = m.index + m[0].indexOf(m[1]);
    const label = senseLabel(labelAfter(m[3] || ''));
    add({ kind: 'ordinal', text: clean(`${m[1]}${m[2]} ${label}`), prefix: '', value: m[1], suffix: m[2].toUpperCase(), label, display: `${m[1]}${m[2].toUpperCase()}` }, at, m[0].length - m[0].indexOf(m[1]));
  }
  // "No. 1", "#3": a ranking.
  for (const m of String(text).matchAll(RANK)) {
    add({ kind: 'rank', text: clean(m[0]), prefix: '#', value: m[1], suffix: '', label: '', display: `#${m[1]}` }, m.index, m[0].length);
  }
  for (const m of String(text).matchAll(COUNT)) {
    const at = m.index + m[0].indexOf(m[1]);
    const num = m[1].replace(/[.,]$/, '');
    // "Game 5", "Week 12", "Round 3": an identifier, not a count.
    const ident = IDENT_BEFORE.test(text.slice(Math.max(0, at - 12), at));
    // A label starts with a noun ("5 to win" has none).
    const label = NOUN_STOP.test(clean(m[3]).split(' ')[0] || '') || /^(?:to|is|was|are|were|will|has|had)$/i.test(clean(m[3]).split(' ')[0] || '') ? '' : labelAfter(m[3]);
    if (ident) { add({ kind: 'date', text: clean(text.slice(Math.max(0, at - 12), at).match(/[A-Za-z.#]+\s*$/)?.[0] + num), prefix: '', value: num, suffix: '', label: '', display: num }, at, num.length); continue; }
    if (!label || /^(?:am|pm|th|st|nd|rd)$/i.test(label)) continue;
    // "1000+ rushing yards": the plus stays with the number (a count, not a %).
    const unit = m[2] || '';
    add({ kind: unit === '%' ? 'pct' : 'count', text: clean(`${num}${unit} ${label}`), prefix: '', value: num, suffix: unit, label, display: `${num}${unit}` }, at, num.length + unit.length + 1 + label.length);
  }
  return facts;
}

const quotesIn = text => [...String(text || '').matchAll(/[“"]([^”"]{8,300})[”"]/g)].map(m => clean(m[1]));

// Capitalised names in a text ("LPGA Tour", "Joe Burrow", "Ja'Marr Chase").
function properNames(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\b([A-Z][A-Za-z'.&-]*[A-Za-z](?:\s+(?:[A-Z][A-Za-z'.&-]*[A-Za-z]|of|the))*)/g)) {
    let name = m[1].replace(/\s+(?:of|the)$/i, '').replace(/^(?:The|A|An)\s+(?=[A-Z])/, '').replace(/['’]s$/, '');
    // "ESPN's Ramona Shelburne" -> "Ramona Shelburne" (the owner is a separate name).
    if (/['’]s\s+[A-Z]/.test(name)) {
      const [owner, rest] = name.split(/['’]s\s+/);
      if (owner && !STOP.has(owner.toLowerCase())) out.push(owner);
      name = rest;
    }
    if (name.length < 2 || STOP.has(name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}
const SENTENCE_START = new Set(['The', 'A', 'An', 'He', 'She', 'They', 'It', 'His', 'Her', 'Their', 'After', 'Before', 'Next', 'Sport', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'ESPN', 'Story', 'Summary', 'Angle', 'Context', 'Trend']);

// The stories in a brief: sentences, and "X ... and Y ..." halves when each
// half has its own subject and its own fact. Sentences about the same subject merge.
// Labels a trend brief carries in front of its text ("Story: Story: Bryson…",
// "Summary: …"): never part of the story, never a subject.
const BRIEF_LABEL = /(^|[.;|]\s*)(?:story|summary|angle|context|trend|why fans care|why now|why it matters|notes?)\s*:\s*/gi;
const stripLabels = text => {
  let out = String(text || '');
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(BRIEF_LABEL, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
};
function splitStories(brief) {
  // Each line ends its sentence (a trend brief's lines have no full stops), so a
  // number on one line never takes its label from the next ("2027 season" + "Why fans care").
  const body = stripCoverage(brief).split('\n').filter(line => !/^\s*(?:sport|headline|team)\s*:/i.test(line)).map(stripLabels)
    .map(line => line.trim()).filter(Boolean).map(line => (/[.!?;:"”]$/.test(line) ? line : `${line}.`)).join(' ');
  let sentences = clean(body).split(/(?<=[.!?]["”]?)\s+(?=[A-Z“"])/).map(s => s.trim()).filter(Boolean);
  // Talk about the coverage is not a story (kept only when it is all there is).
  const onStory = sentences.filter(sentence => !META_SENTENCE.test(sentence));
  if (onStory.length) sentences = onStory;
  const parts = [];
  sentences.forEach(sentence => {
    const halves = sentence.split(/\s+(?:and|while|as|;)\s+(?=(?:the\s+)?[A-Z])/);
    const good = halves.length > 1 && halves.every(half => /\d/.test(half) && properNames(half).length);
    (good ? halves : [sentence]).forEach(part => parts.push(part.replace(/[.\s]+$/, '')));
  });
  const stories = [];
  parts.forEach(text => {
    const names = properNames(text).filter(n => !SENTENCE_START.has(n));
    const subject = names[0] || '';
    const prev = stories[stories.length - 1];
    if (prev && subject && prev.subject && (prev.subject === subject || prev.names.includes(subject)) && !/\d/.test(text)) {
      prev.text += `. ${text}`;
      prev.names = [...new Set([...prev.names, ...names])];
      return;
    }
    stories.push({ id: `s${stories.length + 1}`, text, subject, names });
  });
  return stories.slice(0, 6);
}

// readCreative: everything the composer may say, with ids the director cites.
// tools: { nameCandidates } from es-generate.js (optional).
function readCreative(brief, found = {}, tools = {}) {
  const text = String(brief || '');
  const sportLine = text.split('\n').find(line => /^\s*sport\s*:/i.test(line));
  let sport = sportLine ? findSport(sportLine.replace(/^\s*sport\s*:\s*/i, '')) : '';
  const stories = splitStories(text);
  const facts = [];
  stories.forEach(story => {
    const list = senseFacts(factsIn(story.text, story.id, facts.length + 1));
    story.facts = list.map(f => f.id);
    facts.push(...list);
  });
  const quotes = [];
  stories.forEach(story => quotesIn(story.text).forEach(q => {
    // The speaker: a name before the quote in the same story ("ESPN's Ramona Shelburne: ...").
    const before = story.text.slice(0, story.text.indexOf(q));
    const by = properNames(before).filter(n => !SENTENCE_START.has(n)).pop() || '';
    quotes.push({ id: `q${quotes.length + 1}`, story: story.id, text: q, by });
  }));
  // Teams (brand kit / logo library) and people (two capitalised words, not a team).
  const teams = [];
  const people = [];
  const allNames = [...new Set(stories.flatMap(s => s.names))];
  allNames.forEach(name => {
    const leagueMark = [name, name.replace(/\s+Tour$/i, '')].map(n => LOGOS.search(n, { limit: 3 }).find(e => e.kind === 'league' && e._name === n.toLowerCase())).find(Boolean);
    if (leagueMark) {
      if (!teams.some(t => t.id === leagueMark.id)) teams.push({ name, kind: 'league', logo: leagueMark.file || leagueMark.url || '', colors: leagueMark.colors || [], id: leagueMark.id });
      return;
    }
    const kit = sport ? findTeam(sport, name) : '';
    const entry = LOGOS.findTeam(name, sport || undefined);
    if (entry && (kit || name.split(' ').length <= 3)) {
      if (!sport) sport = findSport(entry.league) || sport;
      if (!teams.some(t => t.id === entry.id)) teams.push({ name: entry.short || name, full: entry.name, kind: 'team', logo: entry.file || entry.url || '', colors: entry.colors || [], id: entry.id, kit: kit || '' });
      return;
    }
    if (/^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,2}$/.test(name) && !/^[A-Z]{2,}\b/.test(name) && !/\b(?:Tour|League|Night|Football|Conference|North|South|East|West|Thanksgiving|Championships?|School|Academy|Arena|Stadium|Park|Center|Centre|Cup|Open|Series|Prix|Bowl|Classic|Masters|Games|Finals?|Playoffs?|Institute|University|College|Club|Award|Trophy|Week|Day)\b/.test(name)) people.push(name);
  });
  (typeof tools.nameCandidates === 'function' ? tools.nameCandidates(text) : []).forEach(n => { if (!people.includes(n) && !teams.some(t => t.name === n || t.full === n)) people.push(n); });
  const mentions = (text, name) => Boolean(name) && new RegExp(`(?:^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(text);
  stories.forEach(story => {
    story.people = people.filter(p => mentions(story.text, p) || mentions(story.text, p.split(' ').pop()));
    story.teams = teams.filter(t => mentions(story.text, t.name) || mentions(story.text, t.full)).map(t => t.id);
    const lead = teams.find(t => story.teams.includes(t.id) && mentions(story.text.slice(0, 40), t.name));
    if (lead) story.subject = lead.name;
  });
  // An editor's (or Trends') "Headline:" line: the first cover-family design may use it.
  const headLine = text.split('\n').find(line => /^\s*headline\s*:/i.test(line));
  const headline = headLine ? clean(stripCoverage(headLine.replace(/^\s*headline\s*:\s*/i, ''))).replace(/[“”"]/g, '') : '';
  return { brief: text, sport, headline: headline.split(' ').length <= 9 ? headline : '', stories, facts, quotes, teams, people, research: (found.articles || []).slice(0, 8).map((a, i) => ({ id: `A${i + 1}`, title: clean(a.title), url: a.url, excerpt: cut(a.excerpt, 260), image: a.image || '' })) };
}

// ─── 2. Palette ───────────────────────────────────────────────────────────
const GOLF_KIT = BRAND_KIT.filter(e => e.sport === 'Golf');
function paletteFor(read, story, { team = null } = {}) {
  const t = team || read.teams.find(x => story?.teams?.includes(x.id) && x.kind === 'team') || read.teams.find(x => x.kind === 'team');
  if (t) {
    const kit = BRAND_KIT.find(e => (e.variation || e.team) === t.kit);
    const colors = [...new Set([...(kit ? [kit.primary.background, kit.primary.foreground] : []), ...(t.colors || [])])];
    return { key: `team:${t.name}`, colors, name: t.name };
  }
  if (read.sport === 'Golf') {
    const gg = GOLF_KIT.find(e => e.variation === 'Green & Gold') || GOLF_KIT[0];
    return { key: 'golf:Green & Gold', colors: [gg.primary.background, gg.primary.foreground, gg.primary.mist], name: 'Golf · Green & Gold' };
  }
  return { key: 'es', colors: ['#033162', '#0A7DFA', '#FFFFFF'], name: 'ES' };
}
const paletteChoices = read => {
  const list = read.teams.filter(t => t.kind === 'team').map(t => `team:${t.name}`);
  if (read.sport === 'Golf') GOLF_KIT.forEach(e => list.push(`golf:${e.variation}`));
  list.push('es');
  return list;
};
function paletteByKey(read, key, story) {
  if (key && key.startsWith('team:')) {
    const team = read.teams.find(t => `team:${t.name}` === key);
    if (team) return paletteFor(read, story, { team });
  }
  if (key && key.startsWith('golf:')) {
    const kit = GOLF_KIT.find(e => `golf:${e.variation}` === key);
    if (kit) return { key, colors: [kit.primary.background, kit.primary.foreground, kit.primary.mist, ...kit.palette.map(p => p.background)].slice(0, 4), name: `Golf · ${kit.variation}` };
  }
  if (key === 'es') return { key: 'es', colors: ['#033162', '#0A7DFA', '#FFFFFF'], name: 'ES' };
  return paletteFor(read, story);
}

// ─── 3. Assets ────────────────────────────────────────────────────────────
// Concept art: what the asset service may generate, never people / logos / text.
const ART_FOR = [
  [/\b(?:prize|purse|trophy|title|champion|championship|cup|win|winner)\b/i, 'trophy'],
  [/\$|\b(?:money|contract|deal|salary|million|billion)\b/i, 'money'],
  [/\b(?:cards?|membership|status)\b/i, 'cards'],
];
const SPORT_ART = { Golf: 'golf-ball', NFL: 'football', CFB: 'football', NBA: 'basketball', WNBA: 'basketball', 'CBB Men': 'basketball', 'CBB Women': 'basketball' };
function procArtFor(text, sport) {
  const hit = ART_FOR.find(([re]) => re.test(text));
  return hit ? hit[1] : SPORT_ART[sport] || 'lights';
}
// One URL per real image (drops size / crop suffixes: -1200x768, -scaled, -e1794...).
function photoKey(url) {
  return String(url || '').toLowerCase().split('?')[0].replace(/^.*\//, '')
    .replace(/-e\d{6,}/g, '').replace(/-\d{2,4}x\d{2,4}/g, '').replace(/-scaled/g, '').replace(/\.(?:jpe?g|png|webp)(?:\.(?:jpe?g|png|webp))?$/, '');
}
function dedupePhotos(list = []) {
  const seen = new Set();
  return list.filter(photo => {
    const key = photoKey(photo?.src || photo?.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Time budget for one subject's imagery (ms). Override: GENERATE_PHOTO_BUDGET_MS.
const PHOTO_BUDGET_MS = Math.max(4000, Number(process.env.GENERATE_PHOTO_BUDGET_MS) || 20000);
const BUDGET_HIT = Symbol('budget');
function withBudget(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(BUDGET_HIT), ms); }),
  ]);
}

// Photos per person (asset service findPhotos, else the local ES search).
// localFind(person) -> [{ url, sourceUrl, title }] (es-generate.js photoCandidates).
// Stories with no named person get photos of their team / league (event
// imagery for backgrounds and split screens; never cut out as a person).
// extras (optional, filled in place): cut-outs, headshots and logos the asset
// service (gen-imagery) returned with the photos, in the shared input shape.
async function resolvePhotos(read, { localFind = null, track = null, extras = null } = {}) {
  const out = {};
  const service = assetService();
  const subjects = [...read.people.slice(0, 4)];
  read.stories.forEach(story => {
    if (story.people?.length) return;
    read.teams.filter(t => story.teams?.includes(t.id)).forEach(t => { if (!subjects.includes(t.name) && subjects.length < 6) subjects.push(t.name); });
  });
  const lists = await Promise.all(subjects.map(async person => {
    let list = [];
    const isTeam = read.teams.some(t => t.name === person);
    try {
      if (service?.findPhotos) {
        // Each subject's imagery has a hard time budget: a slow ES image server or
        // vision call must never push the whole Creative run past the function
        // limit (live: es-generate 504s after imagery v3). On timeout the quick
        // local ES search below serves that subject instead.
        const res = await withBudget(service.findPhotos({ ...(isTeam ? { team: person, query: person } : { person }), sport: read.sport, count: 6, track }), PHOTO_BUDGET_MS);
        if (res === BUDGET_HIT) throw Object.assign(new Error('imagery over budget'), { budget: true });
        // Ranked by the service (score); kind / size / focus kept for the director and the renderer.
        const raw = (res?.photos || res?.candidates || (Array.isArray(res) ? res : [])).filter(p => p && (p.url || p.src));
        raw.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
        list = raw.map(p => ({ src: p.url || p.src, title: p.title || '', person, source: p.source || 'es', ...photoMeta({ ...p, person }), ...(p.cutout || p.cutoutUrl ? { cutoutSrc: p.cutout?.url || p.cutout || p.cutoutUrl } : {}) }));
        if (extras && !Array.isArray(res)) {
          (res?.cutouts || []).forEach(c => { if (c?.url && c.fromPhoto) extras.cutouts[c.fromPhoto] = c.url; });
          (res?.headshots || []).forEach(h => { if (h?.url && !extras.headshots.some(x => x.url === h.url)) extras.headshots.push({ url: h.url, person: h.person || person, ...(h.team ? { team: h.team } : {}) }); });
          (res?.logos || []).forEach(l => { if (l?.url && !extras.logos.some(x => x.url === l.url)) extras.logos.push({ url: l.url, team: l.team || '', league: l.league || '' }); });
        }
        list.forEach(p => { if (extras && p.cutoutSrc) extras.cutouts[p.src] = p.cutoutSrc; });
      } else if (localFind) {
        list = (await localFind(person)).map(p => ({ src: p.url || p.src, title: p.title || '', person, source: 'es' }));
      }
    } catch (error) {
      list = [];
      if (error?.budget && localFind) {
        try { list = ((await withBudget(localFind(person), 8000)) || []).filter?.(Boolean).map(p => ({ src: p.url || p.src, title: p.title || '', person, source: 'es' })) || []; } catch (e) { list = []; }
      }
    }
    return dedupePhotos(list.filter(p => p.src)).slice(0, 5).map(p => ({ ...p, team: isTeam }));
  }));
  subjects.forEach((person, i) => { out[person] = lists[i]; });
  // The same image never serves two subjects.
  const seen = new Set();
  Object.keys(out).forEach(key => { out[key] = out[key].filter(p => { const k = photoKey(p.src); if (seen.has(k)) return false; seen.add(k); return true; }); });
  return out;
}

// A side of a split screen: its story's number, logo and (unused) team photo.
function sideFor(read, story, assets, used) {
  const f = read.facts.find(x => x.story === story.id && ['money', 'count', 'pct'].includes(x.kind) && isStat(x, 3));
  const team = read.teams.find(t => story.teams?.includes(t.id));
  const pool = assets.photos?.[team?.name] || assets.photos?.[story.people?.[0]] || [];
  const photo = pool.find(p => !used.has(photoKey(p.src))) || null;
  if (photo) used.add(photoKey(photo.src));
  return { title: team?.name || story.subject, number: { prefix: f.prefix, value: f.value, suffix: f.suffix, label: f.label, factId: f.id }, logo: team?.logo ? { src: team.logo } : null, photo: photo ? { src: photo.src } : null };
}

// ─── 4. Directions ────────────────────────────────────────────────────────
// What an archetype needs from the brief (shown to the director).
const NEEDS = {
  'hero-number': 'a person with an ES photo (cut out) + one number',
  'prize-poster': 'a money / prize number (+ concept art)',
  'big-number': 'one number',
  'split-versus': 'two stories, teams or players, each with a number',
  'magazine-cover': 'an ES photo of the subject',
  scoreboard: 'a final score between two teams',
  'by-the-numbers': '3+ numbers from the brief',
  'stat-bars': 'two comparable numbers (e.g. 484-222 yards)',
  'quote-portrait': 'a quote (+ the speaker\'s photo)',
  typographic: 'a strong headline',
  'collage-strip': 'a person with 2+ different ES photos',
  'duotone-hero': 'an ES photo',
  'record-badge': 'a team record (12-2) + the team',
  'unit-grid': 'a count of 8-200 things (100 players, 40 wins)',
};

// The headline when a number is the hero: the words before the number
// ("LPGA Tour season ends with $2 million prize" -> "LPGA Tour season ends").
const stripNumber = (text, fact) => {
  if (!fact) return text;
  const at = text.indexOf(fact.text);
  if (at < 0) return text;
  const before = clean(text.slice(0, at)).replace(/(?:\s+(?:with|of|for|to|and|by|at|in|the|a|an|on))+$/i, '');
  return before.split(' ').length >= 2 ? before : clean(`${text.slice(0, at)} ${text.slice(at + fact.text.length)}`);
};
const WEAK_TAIL = /^(?:with|of|for|to|and|or|but|by|at|in|on|from|as|after|before|into|than|the|a|an|his|her|their|its|starting|including|while|who|which|that|is|are|was|were|be|been|will|would|can|could|should|says|said|do|does|did|my|your|our|this|these)$/i;
const shortHeadline = text => {
  const list = clean(text).replace(/[“”"]/g, '').replace(/[.;:,]+$/, '').split(' ').slice(0, 8);
  while (list.length > 2 && WEAK_TAIL.test(list[list.length - 1].replace(/[.,;:]+$/, ''))) list.pop();
  return list.join(' ').replace(/[,;:]+$/, '');
};
// A story's words before its first number ("Burrow threw for 409 yards and 4
// touchdowns" -> "Burrow threw"): the headline beside a grid of those numbers.
function beforeNumbers(text, facts = []) {
  const value = String(text || '');
  const at = Math.min(value.length, ...facts.map(f => (f?.text ? value.indexOf(f.text) : -1)).filter(i => i >= 0));
  return clean(value.slice(0, at));
}

// Photo metadata from the asset service (gen-imagery), when it gave any.
const photoMeta = p => Object.fromEntries(['width', 'height', 'person', 'kind', 'score', 'source', 'rights'].filter(k => p?.[k] != null && p[k] !== '').map(k => [k, k === 'person' && typeof p[k] !== 'string' ? '' : p[k]]).concat(p?.focus || p?.focal ? [['focus', p.focus || p.focal]] : []));
// input.cutouts: the hero cut-out first, then this design's other people (named in the brief).
function cutoutsFor(direction, assets = {}) {
  const list = [];
  const add = (src, person, from) => { if (src && !list.some(c => c.url === src)) list.push({ url: src, src, person: person || '', fromPhoto: from || '' }); };
  if (direction.cutout?.src) add(direction.cutout.src, direction.photo?.person || direction.person, direction.photo?.src);
  (direction.photos || []).forEach(p => add(assets.cutouts?.[p.src], p.person, p.src));
  return list.slice(0, 4);
}

// Composer input for one direction (the archetype's parameters).
function inputsFor(direction, read, assets = {}) {
  const story = read.stories.find(s => s.id === direction.story) || read.stories[0] || { id: 's1', text: read.brief, facts: [], people: [], teams: [] };
  const factById = id => read.facts.find(f => f.id === id);
  const num = factById(direction.numberFact);
  const pal = paletteByKey(read, direction.palette, story);
  const tone = TONES.includes(direction.tone) ? direction.tone : '';
  const person = direction.person || story.people?.[0] || '';
  const photo = direction.photo || null;
  const cutout = direction.cutout || null;
  const storyTeams = read.teams.filter(t => story.teams?.includes(t.id));
  // Numbers from several people's stories carry the person ("BURROW", "CHASE").
  // Grids and stacks show real stats only (weight 2+): never coverage counts, years or dates.
  const numberFacts = (direction.factIds || story.facts || []).map(factById).filter(Boolean)
    .filter(f => f.kind !== 'score' && f.kind !== 'record' && f.kind !== 'compare' && isStat(f, 2));
  const owners = new Set(numberFacts.map(f => read.stories.find(st => st.id === f.story)?.people?.[0] || ''));
  const numbers = numberFacts.map(f => {
    const owner = read.stories.find(st => st.id === f.story)?.people?.[0] || '';
    const who = owner && (owners.size > 1 || f.story !== story.id) ? owner.split(' ').pop() : '';
    const label = direction.labels?.[f.id] || f.label;
    return { prefix: f.prefix, value: f.value, suffix: f.suffix, display: f.display, label, who: direction.labels?.[f.id] ? '' : who, factId: f.id };
  });
  const scoreFact = (direction.factIds || []).map(factById).find(f => f?.kind === 'score') || read.facts.find(f => f.story === story.id && f.kind === 'score');
  const recordFact = (direction.factIds || []).map(factById).find(f => f?.kind === 'record') || read.facts.find(f => f.story === story.id && f.kind === 'record');
  const compareFact = (direction.factIds || []).map(factById).find(f => f?.kind === 'compare') || read.facts.find(f => f.story === story.id && f.kind === 'compare');
  const quote = read.quotes.find(q => q.id === direction.quote) || read.quotes.find(q => q.story === story.id) || null;
  const input = {
    size: direction.size || 'portrait',
    sport: read.sport,
    palette: tone ? paletteForTone(pal, tone) : COMPOSE.makePalette(pal.colors, { name: pal.name }),
    ...(tone ? { tone } : {}),
    kicker: direction.kicker,
    headline: direction.headline,
    highlight: direction.highlight || [],
    body: direction.body || '',
    name: direction.name || person,
    number: num && num.kind !== 'score' && num.kind !== 'compare' && isStat(num, 3) ? { prefix: num.prefix, value: num.kind === 'record' ? num.value : num.value, suffix: num.suffix, label: direction.label || num.label, factId: num.id } : null,
    numbers,
    photo: photo ? { src: photo.src, focus: photo.focus } : null,
    // Shared input shape (gen-v3 contract): every item carries src and url;
    // photos are the extra moments (the main photo is input.photo).
    photos: (direction.photos || []).map(p => ({ src: p.src, url: p.src, label: p.label || '', ...photoMeta(p) })),
    cutout: cutout ? { src: cutout.src } : null,
    cutouts: cutoutsFor(direction, assets),
    headshots: (assets.headshots || []).filter(h => h?.url).slice(0, 9).map(h => ({ url: h.url, src: h.url, person: h.person || '', ...(h.team ? { team: h.team } : {}) })),
    art: direction.art ? { src: direction.art.src } : null,
    logos: storyTeams.filter(t => t.logo).map(t => ({ src: t.logo, url: t.logo, name: t.name, team: t.name, league: t.kind === 'league' ? t.name : read.sport || '' })),
    quote: quote ? { text: quote.text, by: quote.by } : null,
    unit: /card/i.test(num?.label || '') ? 'card' : 'dot',
    facts: read.facts.filter(f => f.id === direction.numberFact || (direction.factIds || []).includes(f.id) || f.story === story.id)
      .concat(read.quotes.filter(q => q.story === story.id).map(q => ({ id: q.id, text: q.text })))
      .concat((direction.cited || []).map(c => ({ id: c.id, text: c.text, source: c.url })))
      .concat(read.headline ? [{ id: 'headline', text: read.headline }] : []),
  };
  if (scoreFact && storyTeams.length >= 2) {
    const [ta, tb] = storyTeams;
    // The winner is named first in "Bengals beat Steelers 38-18" / "Steelers lost 38-18 to the Bengals".
    const aFirst = story.text.indexOf(ta.name) < story.text.indexOf(tb.name);
    const loserFirst = /\b(?:lost|lose|loses|fell|falls)\b/i.test(story.text.slice(0, story.text.indexOf(scoreFact.a)));
    const hi = Math.max(Number(scoreFact.a), Number(scoreFact.b));
    const lo = Math.min(Number(scoreFact.a), Number(scoreFact.b));
    const winner = (aFirst !== loserFirst) ? ta : tb;
    const loser = winner === ta ? tb : ta;
    input.score = { a: { name: winner.name, value: String(hi), logo: winner.logo }, b: { name: loser.name, value: String(lo), logo: loser.logo }, tag: direction.kicker || 'FINAL', factId: scoreFact.id };
    const winTeam = winner;
    if (!direction.palette) input.palette = tone ? paletteForTone(paletteFor(read, story, { team: winTeam }), tone) : COMPOSE.makePalette(paletteFor(read, story, { team: winTeam }).colors, { name: winTeam.name });
  }
  if (recordFact) {
    const t = storyTeams.find(x => x.kind === 'team') || read.teams.find(x => x.kind === 'team');
    input.record = { value: recordFact.value, label: direction.label || 'RECORD', logo: t?.logo || '', factId: recordFact.id };
  }
  if (compareFact) {
    const at = story.text.indexOf(compareFact.a);
    const words = story.text.slice(Math.max(0, at - 80), at).match(/([A-Z][A-Za-z]+)\s+(?:outgain|outscor|out-?rebound)\w*\s+([A-Z][A-Za-z]+)/);
    const [left, right] = words ? [words[1], words[2]] : storyTeams.map(t => t.name);
    const unit = /yard|outgain/i.test(story.text) ? 'YARDS' : /outscor/i.test(story.text) ? 'POINTS' : '';
    input.compare = { title: direction.compareTitle || direction.headline, a: { label: `${left || 'A'} ${unit}`.trim(), value: compareFact.a, display: compareFact.a, factId: compareFact.id }, b: { label: `${right || 'B'} ${unit}`.trim(), value: compareFact.b, display: compareFact.b, factId: compareFact.id }, factId: compareFact.id };
  }
  if (direction.sides) input.sides = direction.sides;
  return input;
}

// Deterministic plan (no AI): per story, the archetypes that fit, then a set
// with different archetypes, focal elements and photos, covering every story.
const PRIORITY = {
  money: ['prize-poster', 'big-number', 'typographic'],
  count: ['unit-grid', 'big-number', 'hero-number', 'typographic'],
  pct: ['big-number', 'typographic'],
  score: ['scoreboard', 'duotone-hero', 'magazine-cover'],
  record: ['record-badge', 'big-number'],
  compare: ['stat-bars', 'by-the-numbers'],
  quote: ['quote-portrait', 'typographic'],
  person: ['hero-number', 'magazine-cover', 'collage-strip', 'duotone-hero', 'by-the-numbers'],
  ratio: ['big-number', 'hero-number', 'typographic'],
  ordinal: ['hero-number', 'big-number', 'typographic'],
  rank: ['big-number', 'hero-number', 'typographic'],
  none: ['typographic', 'magazine-cover', 'duotone-hero'],
};
// gen-styles: every archetype lists the story kinds it serves; append the new
// ones so code plans vary too (the hand-picked order above stays first).
Object.keys(PRIORITY).forEach(kind => (COMPOSE.ARCHETYPES || []).forEach(a => {
  if ((a.kinds || []).includes(kind) && !PRIORITY[kind].includes(a.id)) PRIORITY[kind].push(a.id);
}));

// A headline the code can stand behind (the no-AI plan): the story's own
// words, cut at a clause break, every digit a fact, never chopped before its
// object ("Joe Burrow threw" when "for 409 yards" was cut); else the subject.
const NUM_VERBS = /^(?:stays|stay|remains|remain|becomes|become|holds|hold|climbs|rises|falls|drops|jumps|threw|throws|throw|scored|scores|score|had|has|have|caught|catches|drove|drives|hit|hits|ran|runs|rushed|rushes|posted|posts|recorded|records|signs|signed|sign|agrees|agreed|earned|earns|won|wins|made|makes|shot|shoots|averaged|averages|totaled|totals|added|adds|grabbed|grabs|dished|collected|finished|finishes|improve|improves|improved|sits|sit|stands|moves|move|is|are|was|were|leads|led|reach|reaches|reached|hits|tallied|logged|notched|racked)$/i;
const CLAUSE_BREAK = /\s*[,;:]\s+|\s+(?=(?:and|with|as|after|behind|from|by|for|while|who|which|following|despite|before|since|during|than|on|in|at)\s)/i;
function codeHeadline(text, story, read, { fallback = '', all = false } = {}) {
  const source = clean(story?.text || read.brief);
  const grounded = new Set(read.facts.flatMap(f => digitsIn(f.text)).concat(digitsIn(read.headline)));
  const chopped = h => {
    const at = source.toLowerCase().indexOf(h.toLowerCase());
    const after = at >= 0 ? source.slice(at + h.length, at + h.length + 16) : '';
    // Chopped: the number was the object ("threw | for 409", "agrees | to a 15-year",
    // "signs | a $450M"), not an adjunct ("the DP World Tour | in the 2027 season").
    const last = (h.split(' ').pop() || '').toLowerCase();
    const num = '(?:\\$|No\\.\\s?\\d|#\\d|\\d[\\d,.]*(?![\\d,.]|st\\b|nd\\b|rd\\b|th\\b))';
    // Cut mid-phrase: the next word carries on the clause ("1,500 | students").
    const carriesOn = /^\s+[a-z]/.test(after) && !/^\s+(?:and|or|but|with|as|after|before|behind|from|by|for|while|who|which|following|despite|since|during|than|on|in|at|to|into|over|against|vs\.?|says|said)\b/.test(after);
    return carriesOn || /^\d+-[a-z]+,?$/i.test(h.split(' ').pop() || '')
      || new RegExp(`^[,;]?\\s*(?:(?:for|of|to)\\s+(?:(?:a|an|the|his|her|their)\\s+)?|in\\s+)${num}`, 'i').test(after)
      || ((NUM_VERBS.test(last) || /^[a-z]+(?:ing|ed)$/.test(h.split(' ').pop() || '')) && new RegExp(`^\\s*(?:(?:a|an|the|his|her|their)\\s+)?${num}`, 'i').test(after))
      || WEAK_TAIL.test(last)
      // "Josh Allen goes over | 1000+ yards": the number was what the last word pointed at.
      || (/^(?:over|past|beyond|under|nearly|almost|about|around|top|tops|hit|hits|reach|reaches|passes|surpasses|eclipses)$/.test(last) && new RegExp(`^\\s*${num}`, 'i').test(after));
  };
  const tidy = h => {
    let words = clean(h).replace(/[“”"]/g, '').replace(/[.;:,]+$/, '').split(' ').filter(Boolean);
    // Cut before a number that is not a fact (the ES gate would drop the design).
    const stray = words.findIndex(w => digitsIn(w).some(d => !grounded.has(d)));
    if (stray >= 0) words = words.slice(0, stray);
    words = words.slice(0, 10);
    while (words.length > 1 && WEAK_TAIL.test(words[words.length - 1].replace(/[.,;:]+$/, ''))) words.pop();
    return words.join(' ').replace(/[,;:]+$/, '');
  };
  const options = [];
  const whole = tidy(text);
  if (clean(text).split(' ').length <= 10) options.push(whole);
  const parts = clean(text).split(CLAUSE_BREAK).filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc} ${part}` : part;
    if (acc.split(' ').length >= 3) { options.push(tidy(acc)); break; }
  }
  options.push(whole);
  const good = options.filter(h => h && h.split(' ').length >= 2 && !chopped(h));
  if (all) return [...new Set([...good, fallback, story?.people?.[0], story?.subject].filter(Boolean))];
  if (good.length) return good[0];
  return fallback || story?.people?.[0] || story?.subject || tidy(text);
}

// The kicker: team (or subject) and sport, never the headline again (a
// headline that fell back to the name gets the team or sport alone).
function kickerFor(read, story, team, headline = '') {
  const list = [team?.name || story.subject, read.sport].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  const kept = list.filter(v => squash(v) !== squash(headline));
  return kept.join(' · ').toUpperCase();
}

function directionSkeleton(read, story, archetype, assets, used) {
  const facts = read.facts.filter(f => f.story === story.id);
  const hero = heroFact(facts, archetype);
  const team = read.teams.find(t => story.teams?.includes(t.id));
  const person = story.people?.[0] || '';
  const photos = (assets.photos?.[person] || (!person && team ? assets.photos?.[team.name] : null) || []).filter(p => !used.photos.has(photoKey(p.src)));
  const art = assets.art?.[story.id] || null;
  const scoreFact = facts.find(f => f.kind === 'score');
  let text = archetype === 'scoreboard' && scoreFact ? clean(story.text.replace(scoreFact.text, '').replace(/\s+(?:at|to)\s+\d{1,2}-\d{1,2}$/, ''))
    : stripNumber(story.text, ['prize-poster', 'big-number', 'unit-grid', 'hero-number', 'record-badge'].includes(archetype) ? hero : null);
  // The brief's own headline, once per set, on a cover-family design about its first story.
  const useHeadline = Boolean(read.headline && !used.headline && story.id === (read.stories[0]?.id || 's1') && ['cover', 'lifestyle'].includes(familyOf(archetype)));
  if (useHeadline) text = read.headline;
  const headline = useHeadline ? text : codeHeadline(text, story, read, { fallback: story.people?.[0] || team?.name || '' });
  return {
    usedHeadline: useHeadline,
    story: story.id,
    archetype,
    name: '',
    kicker: kickerFor(read, story, team, headline),
    headline,
    highlight: [],
    numberFact: hero?.id || '',
    label: hero?.label || '',
    factIds: facts.map(f => f.id),
    person,
    photo: photos[0] || null,
    photos: photos.slice(1, 4),
    cutout: person && assets.cutouts?.[photos[0]?.src] && !['crowd', 'venue', 'object'].includes(String(photos[0]?.kind || '')) ? { src: assets.cutouts[photos[0].src] } : null,
    art,
    palette: '',
    note: '',
  };
}

// The hero number: the most meaningful stat of a story (weight 3+), never a
// year, a date or a coverage count. Unit grids want a countable 8-200.
function heroFact(facts = [], archetype = '') {
  const order = { money: 0, record: 1, ratio: 2, ordinal: 3, count: 4, pct: 5, rank: 6 };
  const list = facts.filter(f => isStat(f, 3) && f.kind in order)
    .sort((a, b) => (b.weight - a.weight) || (order[a.kind] - order[b.kind]));
  if (archetype === 'unit-grid') {
    const unit = list.find(f => f.kind === 'count' && Number(f.value.replace(/,/g, '')) >= 8 && Number(f.value.replace(/,/g, '')) <= 200);
    if (unit) return unit;
  }
  return list[0] || null;
}

function storyKinds(read, story) {
  const kinds = read.facts.filter(f => f.story === story.id && isStat(f, 2)).map(f => f.kind);
  if (read.quotes.some(q => q.story === story.id)) kinds.push('quote');
  if (story.people?.length) kinds.push('person');
  if (!kinds.length) kinds.push('none');
  return [...new Set(kinds)];
}

function planDeterministic(read, assets = {}, { want = 4 } = {}) {
  const stories = read.stories.length ? read.stories : [{ id: 's1', text: read.brief, facts: [], people: [], teams: [] }];
  // Two stories with numbers: one split screen that holds both.
  const withNumbers = stories.filter(s => read.facts.some(f => f.story === s.id && ['money', 'count', 'pct'].includes(f.kind) && isStat(f, 3)));
  let used;
  let out;
  // Pass 1: one design per ES family (stats, cover, quote, grid...); pass 2
  // allows a second of a family only when the brief cannot fill the set otherwise.
  const run = (cap, keep = []) => {
    used = { archetypes: new Set(keep.map(d => d.archetype)), focal: new Map(), photos: new Set(keep.filter(d => d.photo).map(d => photoKey(d.photo.src))), families: new Map(), headline: keep.some(d => d.usedHeadline) };
    keep.forEach(d => {
      const focal = COMPOSE.BY_ID[d.archetype]?.focal;
      used.focal.set(focal, (used.focal.get(focal) || 0) + 1);
      used.families.set(familyOf(d.archetype), (used.families.get(familyOf(d.archetype)) || 0) + 1);
    });
    out = [...keep];
    const tryAdd = (story, archetype, extra = {}) => {
      if (out.length >= want || used.archetypes.has(archetype) || !COMPOSE.BY_ID[archetype]) return false;
      const family = familyOf(archetype);
      if ((used.families.get(family) || 0) >= cap) return false;
      const dir = { ...directionSkeleton(read, story, archetype, assets, used), ...extra };
      const input = inputsFor(dir, read, assets);
      if (!COMPOSE.fits(archetype, input)) return false;
      if (repeatsNumber(dir, read, input)) {
        // Say it once: the numbers carry the stats, the headline the story.
        const story2 = read.stories.find(st => st.id === dir.story) || story;
        const words = codeHeadline(beforeNumbers(story2.text, read.facts.filter(f => f.story === story2.id)), story2, read, { fallback: story2.people?.[0] || story2.subject || '' });
        if (words.split(' ').length < 2) return false;
        dir.headline = words;
        if (repeatsNumber(dir, read, input)) return false;
      }
      const focal = COMPOSE.BY_ID[archetype].focal;
      if ((used.focal.get(focal) || 0) >= 2) return false;
      used.archetypes.add(archetype);
      used.focal.set(focal, (used.focal.get(focal) || 0) + 1);
      used.families.set(family, (used.families.get(family) || 0) + 1);
      if (dir.photo) used.photos.add(photoKey(dir.photo.src));
      if (dir.usedHeadline) used.headline = true;
      out.push(dir);
      return true;
    };
    // Round-robin over stories so every story gets a design.
    const queues = stories.map(story => storyKinds(read, story).flatMap(kind => PRIORITY[kind] || []).concat(['typographic', 'duotone-hero', 'big-number']));
    for (let round = 0; round < 6 && out.length < want; round += 1) {
      stories.forEach((story, i) => {
        if (out.length >= want) return;
        const queue = queues[i];
        while (queue.length) {
          if (tryAdd(story, queue.shift())) break;
        }
      });
      if (round === 0 && withNumbers.length >= 2 && out.length < want) {
        const sides = withNumbers.slice(0, 2).map(s => sideFor(read, s, assets, used.photos));
        // Words both stories share ("season ends") join the two names.
        const shared = keyTerms(withNumbers[0].text).filter(t => keyTerms(withNumbers[1].text).includes(t) && !sides.some(sd => squash(sd.title).includes(` ${t} `)));
        const tail = withNumbers[0].text.split(' ').filter(w => shared.includes(w.toLowerCase())).join(' ');
        tryAdd(stories[0], 'split-versus', { sides, kicker: read.sport ? read.sport.toUpperCase() : '', headline: shortHeadline(`${sides[0].title} and ${sides[1].title}${tail ? `: ${tail}` : ''}`), factIds: read.facts.map(f => f.id) });
      }
    }
  };
  run(1);
  if (out.length < want) run(2, out);
  return out.map((d, i) => ({ ...d, id: `d${i + 1}`, source: 'code' }));
}

// ─── 4b. Set design: families, tones, cut-outs, fill (gen-director) ───────
// The ES Figma board's categories (file ZtArAy8Oa52pOF92FPl7Zo, node 2335:229):
//   stats     STATS POST: cut-out on team colour, a big stat stack ("25-2", "13/9/4")
//   cover     COVER IMAGE: full-bleed action photo or cut-out, giant headline + highlight box
//   quote     QUOTES: portrait + big quote, dual portrait, white quote card
//   grid      GRID: headshot grids, photo mosaics, strips
//   listicle  LISTICLE: ranked rows on a light paper table, logos
//   bar-graph BAR GRAPH: bars beside player cut-outs
//   lifestyle LIFESTYLE: editorial portrait, magazine feel
//   extra     EXTRA POSTS: tweet cards, carousel data slides, versus, scoreboards
// An archetype's own `family` (or `category`) and `tones` (gen-looks) win;
// these maps cover today's archetypes so this branch works alone.
const FAMILIES = ['stats', 'cover', 'quote', 'grid', 'listicle', 'bar-graph', 'lifestyle', 'extra'];
const FAMILY_OF = {
  'hero-number': 'stats', 'big-number': 'stats', 'prize-poster': 'stats', 'record-badge': 'stats', 'stat-tower': 'stats', 'trading-card': 'stats', 'sticker-collage': 'stats', 'swiss-grid': 'stats',
  'magazine-cover': 'cover', 'duotone-hero': 'cover', 'pill-stack': 'cover', 'lower-third': 'cover', 'type-knockout': 'cover', 'neon-night': 'cover', typographic: 'cover', 'front-page': 'lifestyle',
  'quote-portrait': 'quote', 'quote-marks': 'quote',
  'collage-strip': 'grid', 'photo-mosaic': 'grid', 'film-strip': 'grid',
  'by-the-numbers': 'listicle',
  'stat-bars': 'bar-graph', 'record-gauge': 'bar-graph', 'unit-grid': 'bar-graph',
  scoreboard: 'extra', 'versus-split': 'extra', 'split-versus': 'extra', 'ticket-stub': 'extra',
};
const familyOf = id => {
  const a = COMPOSE.BY_ID?.[id];
  const own = String(a?.family || a?.category || '').toLowerCase();
  return FAMILIES.includes(own) ? own : FAMILY_OF[id] || 'extra';
};
// Tones (shared with gen-looks: input.tone). light / paper / editorial are the
// light family; the rest are dark fields.
const TONES = ['light', 'paper', 'vivid', 'dark', 'duotone', 'editorial', 'esblue'];
const LIGHT_TONES = new Set(['light', 'paper', 'editorial']);
const isLightTone = tone => LIGHT_TONES.has(tone);
// Without gen-looks' per-archetype `tones`, light fields only go on data and
// type-led archetypes (they draw every colour from the palette's roles).
const LIGHT_OK = new Set(['by-the-numbers', 'typographic', 'big-number', 'swiss-grid', 'front-page', 'quote-marks', 'quote-portrait', 'stat-tower', 'stat-bars', 'unit-grid', 'record-gauge', 'scoreboard', 'record-badge', 'prize-poster']);
const PHOTO_FIELD = new Set(['magazine-cover', 'duotone-hero', 'lower-third', 'type-knockout', 'neon-night', 'film-strip', 'photo-mosaic', 'pill-stack']);
function tonesOf(id) {
  const own = COMPOSE.BY_ID?.[id]?.tones;
  if (Array.isArray(own) && own.length) return own.filter(t => TONES.includes(t));
  if (id === 'front-page') return ['paper', 'editorial', 'light'];
  if (PHOTO_FIELD.has(id)) return ['dark', 'duotone', 'vivid'];
  if (LIGHT_OK.has(id)) return ['light', 'paper', 'editorial', 'vivid', 'dark', 'esblue'];
  return ['dark', 'vivid', 'esblue', 'duotone'];
}
// What each ES category reaches for first (the board: stat posts vivid team
// colour, data and lists on light paper, quotes dark or white card).
const TONE_PREF = {
  stats: ['vivid', 'dark', 'esblue', 'duotone'],
  cover: ['dark', 'duotone', 'vivid'],
  quote: ['dark', 'editorial', 'light', 'esblue'],
  grid: ['light', 'paper', 'dark'],
  listicle: ['paper', 'light', 'editorial', 'esblue'],
  'bar-graph': ['light', 'paper', 'esblue', 'dark'],
  lifestyle: ['editorial', 'paper', 'light'],
  extra: ['esblue', 'light', 'dark', 'vivid'],
};
// Tones for a set: each design a tone its archetype supports, different from
// the others where it can be, and light and dark mixed (2+ designs).
function assignTones(directions = []) {
  const used = new Map();
  directions.forEach(d => {
    const support = tonesOf(d.archetype);
    const pref = [...(TONES.includes(d.tone) ? [d.tone] : []), ...(TONE_PREF[familyOf(d.archetype)] || []), ...support].filter(t => support.includes(t));
    d.tone = pref.find(t => !used.has(t)) || pref[0] || support[0] || 'dark';
    used.set(d.tone, (used.get(d.tone) || 0) + 1);
  });
  if (directions.length < 2) return directions;
  const flipOne = wantLight => {
    // The design that wants the other side most (its family's preference), last first.
    const options = directions.map((d, i) => {
      const support = tonesOf(d.archetype).filter(t => isLightTone(t) === wantLight);
      const pref = (TONE_PREF[familyOf(d.archetype)] || []).filter(t => support.includes(t));
      const pick = pref[0] || support[0];
      const rank = pref.length ? (TONE_PREF[familyOf(d.archetype)] || []).indexOf(pick) : 9;
      return pick ? { d, pick, rank, i } : null;
    }).filter(Boolean).sort((a, b) => a.rank - b.rank || b.i - a.i);
    // Keep the cut-out-led design dark when another can flip.
    const choice = options.find(o => !o.d.cutoutLed) || options[0];
    if (choice) choice.d.tone = choice.pick;
  };
  if (!directions.some(d => isLightTone(d.tone))) flipOne(true);
  if (directions.every(d => isLightTone(d.tone))) flipOne(false);
  return directions;
}
// The palette for a tone: team colours (or ES navy / blue for esblue), on a
// light or dark field. gen-looks renders the finer tone (vivid, duotone...)
// from input.tone.
function paletteForTone(pal, tone) {
  const colors = tone === 'esblue' ? ['#033162', '#0A7DFA', '#FFFFFF'] : pal.colors;
  const name = tone === 'esblue' ? 'ES' : pal.name;
  return COMPOSE.makePalette(colors, { name, mode: isLightTone(tone) ? 'light' : 'dark' });
}

// A scene's image use: a cut-out layer (the board's stat posts and covers), a photo.
const usesCutout = scene => (scene?.layers || []).some(l => l.type === 'cutout' && l.src);
const usesPhoto = scene => (scene?.layers || []).some(l => (l.type === 'photo' && l.role !== 'art' && !String(l.src || '').startsWith('proc:') && (l.fx?.opacity ?? 1) >= 0.45) || l.type === 'cutout' || Boolean(l.knockout?.src));

// Empty areas: the share of each canvas quadrant that carries a non-background
// layer. A quadrant under 6% reads as a hole (a 3-tile grid in a 2x2, a
// headline that stops halfway). Background, texture and grain do not count.
function emptyQuadrants(scene) {
  const W = scene?.size?.w || 1080;
  const H = scene?.size?.h || 1350;
  const boxes = (scene?.layers || []).filter(l => l.type !== 'background' && !(l.type === 'shape' && ['grain', 'texture'].includes(l.shape)) && (l.fx?.opacity ?? 1) >= 0.3 && (l.w || 0) > 0 && (l.h || 0) > 0)
    .filter(l => !((l.w >= W * 0.95) && (l.h >= H * 0.95) && l.type === 'shape'))
    .map(l => ({ x: l.x || 0, y: l.y || 0, w: l.w, h: l.h }));
  const out = [];
  const N = 3;
  const names = [['top-left', 'top', 'top-right'], ['left', 'centre', 'right'], ['bottom-left', 'bottom', 'bottom-right']];
  for (let qy = 0; qy < N; qy += 1) {
    for (let qx = 0; qx < N; qx += 1) {
      let hit = 0;
      let total = 0;
      for (let i = 0; i < 10; i += 1) {
        for (let j = 0; j < 10; j += 1) {
          const x = (qx + (i + 0.5) / 10) * W / N;
          const y = (qy + (j + 0.5) / 10) * H / N;
          total += 1;
          if (boxes.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) hit += 1;
        }
      }
      // The top-right cell holds the ES mark: never a hole.
      if (hit / total < 0.06 && !(qy === 0 && qx === N - 1)) out.push(names[qy][qx]);
    }
  }
  return out;
}

// Duplication: the hero number restated in the headline ("2027" over "THE
// 2027 SEASON..."), the number's label spelled out again, or the kicker
// repeating the headline.
function repeatsNumber(dir, read, input = null) {
  const inp = input || inputsFor(dir, read, {});
  const head = squash(dir.headline).replace(/[$%]/g, ' ');
  let scene = null;
  try { scene = COMPOSE.BY_ID[dir.archetype] ? COMPOSE.build(dir.archetype, inp, 0) : null; } catch (error) { scene = null; }
  // What the design actually shows as numbers: number layers and number labels.
  const shown = (scene?.layers || []).filter(l => l.type === 'number' && l.value).map(l => ({ value: l.value, text: `${l.prefix || ''}${l.value}${l.suffix || ''}`, label: l.label || '' }))
    .concat((scene?.layers || []).filter(l => l.role === 'label' && l.factId).map(l => ({ value: digitsIn(l.text)[0] || '', text: l.text, label: '' })));
  for (const n of shown) {
    const digits = digitsIn(`${n.value}`);
    if (digits.some(d => (d.length >= 2 || shown.length === 1) && head.includes(` ${d} `))) return `the headline repeats ${n.text}`;
  }
  const hero = shown.find(n => n.label) || (inp.number?.label ? { label: inp.number.label } : null);
  if (hero?.label) {
    const words = keyTerms(hero.label).filter(w => w.length > 3);
    if (words.length && words.every(w => head.includes(` ${w} `)) && digitsIn(dir.headline).length) return 'the headline repeats the number\'s label';
  }
  if (dir.kicker && squash(dir.kicker) === head) return 'the kicker repeats the headline';
  return '';
}

// ─── Critique: what works, what could be better, the lesson ───────────────
// design.critique = { strengths:[], improvements:[{ id, text, fix:{ op... } }], nextTime }
// fix: a scene-patch op the page applies in one click (generate-assistant.js):
// { op:'fix', name } for the composer's fixes and macros (free, in code), or
// { op:'assist', instruction } for the AI assistant.
const FIX_TEXT = {
  'bigger-number': 'The number could be bigger: make it the loudest thing on the canvas.',
  'bigger-headline': 'The headline reads small at phone size.',
  'shorter-headline': 'The headline is long for the space; fewer words would set bigger.',
  'darker-mist': 'The type sits on a busy part of the photo; a deeper mist would help.',
  'more-contrast': 'Text contrast is low in places.',
  'less-clutter': 'Too many small elements compete with the focal point.',
  'swap-palette': 'The palette could hit harder flipped.',
  'move-headline-up': 'The headline sits low; moving it up tightens the reading order.',
};
const FIX_NAMES = () => [...COMPOSE.FIXES, 'brighten-photo', 'darken-photo', 'more-drama', 'add-logo', 'bigger-logo'];
// A fix for an improvement's text: the model's named fix, else the topic's.
function fixFor(text, named = '') {
  if (named && DIRECTOR_FIXES[named]) return { ...DIRECTOR_FIXES[named] };
  if (named && FIX_NAMES().includes(named) && named !== 'add-logo') return { op: 'fix', name: named };
  const topic = MEMORY.topicOf(text);
  const byTopic = { 'stat-meaning': 'drop-stat', 'label-sense': 'fix-label', duplicate: 'dedupe-headline', 'no-cutout': 'use-cutout', 'tone-monotone': 'flip-tone' }[topic?.id];
  if (byTopic) return { ...DIRECTOR_FIXES[byTopic] };
  if (topic?.fix && topic.fix !== 'add-logo' && FIX_NAMES().includes(topic.fix)) return { op: 'fix', name: topic.fix };
  return { op: 'assist', instruction: cut(text, 160) };
}
function critiqueFromModel(raw = {}, { source = 'director' } = {}) {
  const strengths = (Array.isArray(raw.strengths) ? raw.strengths : []).map(t => cut(t, 120)).filter(t => t.length > 3).slice(0, 3);
  const improvements = (Array.isArray(raw.improvements) ? raw.improvements : []).slice(0, 3).map((item, i) => {
    const text = cut(typeof item === 'string' ? item : item?.text, 160);
    if (text.length < 6) return null;
    return { id: `${source[0]}${i + 1}`, text, fix: fixFor(text, typeof item === 'object' ? String(item?.fix || '') : ''), source };
  }).filter(Boolean);
  return { strengths, improvements, nextTime: cut(raw.nextTime, 160), source };
}
// Free checks on a scene (no AI): what a designer would flag at a glance.
function codeCritique(scene, dir = {}, read = {}, assets = {}) {
  const strengths = [];
  const improvements = [];
  const layers = scene?.layers || [];
  const add = (text, fix) => improvements.push({ id: `c${improvements.length + 1}`, text, fix, source: 'check' });
  const numbers = layers.filter(l => l.type === 'number' && l.value);
  const num = numbers.length === 1 && numbers[0].factId && !['scoreboard', 'record-badge', 'split-versus', 'stat-bars'].includes(scene?.archetype) ? numbers[0] : null;
  if (num && !clean(num.label) && !clean(num.suffix) && !/^\$/.test(num.prefix || '') && !layers.some(l => l.role === 'label' && l.type === 'text')) {
    add('The number has no unit or label; say what it counts.', { op: 'assist', instruction: 'Add a short label under the number, using the brief\'s own words for what it counts.' });
  }
  // gen-director: stat meaningfulness, label sense, duplication, image use.
  // Content problems first: they are the ones a reader notices.
  numbers.forEach((l, k) => {
    const fact = (read.facts || []).find(f => f.id === l.factId);
    if (fact && !isStat(fact, 2)) {
      add(`"${clean(`${l.prefix || ''}${l.value}${l.suffix || ''} ${l.label || ''}`)}" is not a stat about the story (${fact.kind === 'meta' ? 'a coverage count' : fact.kind === 'date' ? 'a year or date' : 'no real label'}).`, { op: 'remove', target: { type: 'number', nth: k } });
    } else if (l.label && !labelReads(l.label)) {
      const better = senseLabel(l.label) || clean(fact?.label);
      add(`The label "${clean(l.label)}" does not read as a stat label.`, better && labelReads(better) ? { op: 'text', target: { type: 'number', nth: k }, text: better } : { op: 'assist', instruction: 'Rewrite the stat label as a short noun phrase from the facts.' });
    }
  });
  if (dir.archetype && read.stories) {
    const repeated = repeatsNumber({ ...dir, archetype: scene?.archetype || dir.archetype }, read, dir.input || null);
    if (repeated) add(`Duplicate: ${repeated}.`, { op: 'assist', instruction: 'Rewrite the headline so it does not repeat the number or its label; keep it about the story.' });
  }
  const person = dir.person || (read.stories || []).find(s => s.id === dir.story)?.people?.[0] || '';
  const hasPhotos = person && (assets.photos?.[person] || []).length;
  if (hasPhotos && !usesPhoto(scene)) {
    add(`${person} is named but this design shows no photo of them.`, { op: 'assist', instruction: `Rebuild this design around ${person}'s photo or cut-out (a cover or stats-post composition).` });
  } else if (person) {
    const W = scene?.size?.w || 1080;
    const H = scene?.size?.h || 1350;
    const photo = layers.find(l => l.type === 'photo' && l.role !== 'art' && !String(l.src || '').startsWith('proc:'));
    if (photo && !layers.some(l => l.type === 'cutout') && ((photo.w * photo.h) / (W * H) < 0.15 || (photo.fx?.opacity ?? 1) < 0.45)) {
      add('The photo is small or faded; it adds nothing at phone size.', { op: 'fix', name: 'brighten-photo' });
    }
  }
  const headline = layers.find(l => l.role === 'headline');
  const words = clean(headline?.text).split(' ').filter(Boolean).length;
  if (words > 7) add(`The headline runs ${words > 9 ? 'long' : `${words} words`}; 2-6 words set bigger.`, { op: 'assist', instruction: 'Make the headline shorter and punchier (2-6 words), same facts.' });
  const storyTeams = (read.teams || []).filter(t => t.logo && (read.stories || []).find(s => s.id === dir.story)?.teams?.includes(t.id));
  if (storyTeams.length && !layers.some(l => l.type === 'logo')) add(`The ${storyTeams[0].name} logo is not on the design.`, { op: 'fix', name: 'add-logo', src: storyTeams[0].logo });
  const wantsPhoto = ['magazine-cover', 'duotone-hero', 'hero-number', 'collage-strip'].includes(scene?.archetype);
  if (wantsPhoto && !layers.some(l => (l.type === 'photo' && l.role !== 'art') || l.type === 'cutout')) add('No ES photo was found for this composition, so it leans on type.', { op: 'assist', instruction: 'Swap to a composition that does not need a photo.' });
  if (layers.some(l => l.type === 'cutout')) strengths.push(`Cut-out of ${dir.person || 'the player'} gives the design depth.`);
  const lead = num || numbers.find(l => l.factId);
  if (lead) strengths.push(`The ${num ? 'hero number' : 'numbers'} (${lead.prefix || ''}${lead.value}${lead.suffix || ''}${num ? '' : ' and more'}) ${num ? 'is a fact' : 'are facts'} from the brief.`);
  if (dir.cited?.length) strengths.push('The angle is backed by a cited ES story.');
  return { strengths: strengths.slice(0, 2), improvements: improvements.slice(0, 3), nextTime: '', source: 'check' };
}
// Director + code critique, deduped (the page merges the judge's in too).
function mergeCritiques(...parts) {
  const list = parts.filter(Boolean);
  const strengths = [...new Set(list.flatMap(p => p.strengths || []))].slice(0, 3);
  const seen = new Set();
  const improvements = [];
  list.flatMap(p => p.improvements || []).forEach(item => {
    const topic = MEMORY.topicOf(item.text)?.id || squash(item.text).trim().split(' ').slice(0, 4).join(' ');
    if (seen.has(topic)) return;
    seen.add(topic);
    improvements.push({ ...item, id: `i${improvements.length + 1}` });
  });
  return { strengths, improvements: improvements.slice(0, 4), nextTime: list.map(p => p.nextTime).find(Boolean) || '' };
}

// How many candidates per design, and the vision-judge budget, by count.
function budgetFor(count) {
  const want = Math.min(Math.max(parseInt(count, 10) || 4, 1), 8);
  const perDesign = want > 4 ? 2 : 3;
  return { want, perDesign, judgeImages: want * perDesign };
}

// ─── 5. The art director (one AI call) ────────────────────────────────────
function DIRECTOR_SYSTEM() {
  const catalog = COMPOSE.ARCHETYPES.map(a => `- ${a.id} (${a.name}, ES ${familyOf(a.id)}, focal: ${a.focal}, tones: ${tonesOf(a.id).join('/')}): ${a.about} Needs: ${a.needs || COMPOSE.NEEDS?.[a.id] || NEEDS[a.id]}.`).join('\n');
  return [
    'You are the senior art director of EssentiallySports (ES), a US sports media brand with a bold, editorial Instagram look.',
    'You plan COMPOSED designs (not template fills): each design is a composition archetype the ES composer draws, filled with your copy and the brief\'s real numbers.',
    '',
    'Composition archetypes:',
    catalog,
    '',
    ...GUIDE.composedLines(),
    '',
    'ES families (the ES Figma board): stats (cut-out on vivid team colour with a big stat stack), cover (full-bleed action photo or cut-out, giant headline with a highlight box), quote (portrait + big quote, or a white quote card), grid (headshots, photo mosaics), listicle (ranked rows on light paper), bar-graph (bars, unit charts), lifestyle (editorial, magazine), extra (scoreboards, versus, data slides).',
    `Tones: ${TONES.join(', ')} (light, paper and editorial are light fields; esblue is ES navy and blue).`,
    '',
    'Rules:',
    '- Each design is about ONE story from the brief (story id). When the brief has several stories, spread the designs across them; a split-versus may hold two.',
    '- A set is a senior designer\'s set: every design from a different ES family where the brief allows, and tones mixed (at least one light design and one dark or vivid one; never the same tone twice when another fits).',
    '- When a person is named and a photo of them has a cut-out (cutout: true), at least one design leads with that cut-out (stats or cover family). When photos exist, at least half the designs show real photography.',
    '- Numbers are real story stats only: facts marked stat:false (our coverage counts like "4 stories" or "6 outlets", years, dates, game numbers) are NEVER a numberFact, never in factIds for a number, never in a label. Prefer scores, records, money, rankings and game or season stats (weight 4-5).',
    '- Say each thing once: the headline never contains the hero number or repeats its label, and the kicker never repeats the headline.',
    '- label: a short noun phrase from the fact ("PASSING YARDS", "CAREER WINS"), never words from the next sentence; "" when the fact\'s own label is right.',
    '- tone: one of the tones the archetype lists.',
    '- Use a different archetype for every design, and a different focal element (athlete / number / data / type / art / logo / contrast) where you can.',
    '- Numbers: only by fact id (numberFact, factIds). Never type a number into the headline unless it is that exact fact. Never invent results, records or prizes.',
    '- Headlines come from the brief\'s story. An angle from ES research must name the research id in "sources"; otherwise stay on the brief.',
    '- headline: 2-8 words, a hook (claim or question), uppercase is applied for you. kicker: 2-5 words (tour, team, event). highlight: 1-2 words of the headline to set in the accent colour. label: 1-4 words under the number.',
    '- photo: a photo id from the list (each design a different photo) or "" (art-led designs need none). Never ask for a photo of a person the brief does not name.',
    '- art: a short concept for an AI background or object (trophy, ball, stadium light, money, cards, weather, motion). Never people, faces, jerseys, logos or text.',
    '- note: the director\'s note, SPECIFIC to this design (what the eye sees first, what is cut out, what colour does what), max 22 words. No generic praise.',
    '- Critique your own plan honestly: strengths (1-2, what works, max 12 words each), improvements (1-2, what could be better given these assets: "no cut-out of X, so the hero is a flat photo", "the number needs its unit"), nextTime (one lesson for future designs, max 16 words).',
    '- If team lessons are listed, follow them: they are mistakes editors already fixed.',
    ...RULES.VOICE.map(line => `- ${line}`),
    '',
    'Reply with JSON only:',
    '{"directions":[{"story":"s1","archetype":"","name":"2-4 word name","headline":"","kicker":"","highlight":[""],"numberFact":"f1","factIds":["f1"],"label":"","tone":"","photo":"p1","art":"","palette":"","note":"","sources":[],"strengths":[""],"improvements":[""],"nextTime":""}]}',
  ].join('\n');
}

function directorRequest(read, assets, { steer = {}, want = 4, lessons = [] } = {}) {
  const photoList = Object.entries(assets.photos || {}).flatMap(([person, list]) => list.map((p, i) => ({ id: p.id || `${person}#${i + 1}`, person, cutout: Boolean(assets.cutouts?.[p.src]), ...(p.kind ? { kind: p.kind } : {}), ...(p.team ? { team: true } : {}) })));
  return [
    `Brief: ${read.brief.slice(0, 1200)}`,
    `Sport: ${read.sport || 'unknown'}`,
    `Stories: ${JSON.stringify(read.stories.map(s => ({ id: s.id, text: s.text, people: s.people, facts: s.facts })))}`,
    `Facts: ${JSON.stringify(read.facts.map(f => ({ id: f.id, story: f.story, kind: f.kind, text: f.text, label: f.label, stat: isStat(f, 2), weight: f.weight ?? statWeight(f) })))}`,
    read.quotes.length ? `Quotes: ${JSON.stringify(read.quotes)}` : '',
    `Photos: ${JSON.stringify(photoList)}`,
    `Logos: ${JSON.stringify(read.teams.map(t => ({ name: t.name, kind: t.kind })))}`,
    `Palettes: ${JSON.stringify(paletteChoices(read))}`,
    steer.tone ? `Tone: ${steer.tone}.` : '',
    steer.audience ? `Audience: ${steer.audience === 'diehard' ? 'die-hard fans (insider detail)' : 'casual fans (big picture)'}.` : '',
    read.research.length ? `ES research (cite by id only if you use it):\n${read.research.map(a => `${a.id}: ${a.title} — ${a.excerpt}`).join('\n')}` : '',
    MEMORY.promptLines(MEMORY.withSeeds ? MEMORY.withSeeds(lessons, { limit: 4 }) : lessons, { who: 'director' }).join('\n'),
    `Return ${want} directions.`,
  ].filter(Boolean).join('\n\n');
}

// Names a headline uses that the brief never mentions: names from the ES
// research ("LIV Golf") and team names from the logo library ("Chiefs").
function offBriefNames(headline, read) {
  const briefText = squash(read.brief);
  const head = squash(headline);
  // Capitalised words inside research sentences (not the first word; titles
  // are title case, so only their ALL-CAPS words count), absent from the brief.
  const research = new Set();
  const addWord = word => {
    const t = word.replace(/['’]s$/i, '').replace(/[^A-Za-z']/g, '');
    if (t.length > 2 && !STOP.has(t.toLowerCase()) && !briefText.includes(` ${t.toLowerCase()} `)) research.add(t.toLowerCase());
  };
  read.research.forEach(a => {
    String(a.title || '').split(/\s+/).filter(w => /^[A-Z]{2,}/.test(w.replace(/[^A-Za-z]/g, '')) && w.replace(/[^A-Za-z]/g, '') === w.replace(/[^A-Za-z]/g, '').toUpperCase()).forEach(addWord);
    String(a.excerpt || '').split(/(?<=[.!?:])\s+/).forEach(sentence => sentence.split(/\s+/).slice(1).filter(w => /^[A-Z]/.test(w)).forEach(addWord));
  });
  const out = [...research].filter(n => head.includes(` ${n} `));
  keyTerms(headline).forEach(term => {
    if (term.length < 4 || briefText.includes(` ${term} `)) return;
    const team = LOGOS.findTeam(term, read.sport || undefined);
    if (team && (team.nickname || '').toLowerCase() === term.replace(/'s$/, '')) out.push(term);
  });
  return [...new Set(out)];
}

// Never trusts the model. Returns { directions, dropped: [{ why }] }.
function validateDirections(parsed, read, assets = {}, { want = 4 } = {}) {
  const list = Array.isArray(parsed?.directions) ? parsed.directions.slice(0, 10) : [];
  const dropped = [];
  const kept = [];
  const used = { archetypes: new Set(), photos: new Set(), focal: new Map(), families: new Map() };
  // One design per ES family (stats, cover, quote...) in a set of 4; two in larger sets.
  const familyCap = want <= 4 ? 1 : 2;
  const photoById = new Map();
  Object.entries(assets.photos || {}).forEach(([person, photos]) => photos.forEach((p, i) => photoById.set(p.id || `${person}#${i + 1}`, { ...p, person })));
  const factDigits = id => digitsIn(read.facts.find(f => f.id === id)?.text);
  // Split screens go last: their sides take whatever photos are left.
  const order = [...list.filter(r => r?.archetype !== 'split-versus'), ...list.filter(r => r?.archetype === 'split-versus')];
  for (const raw of order) {
    if (kept.length >= want) break;
    const story = read.stories.find(s => s.id === raw?.story) || null;
    const archetype = String(raw?.archetype || '').trim();
    const headline = cut(raw?.headline, 80).replace(/[“”"]/g, '');
    const why = text => dropped.push({ archetype, headline, why: text });
    if (!story) { why('no story from the brief'); continue; }
    if (!COMPOSE.BY_ID[archetype]) { why(`"${archetype}" is not a composition archetype`); continue; }
    if (used.archetypes.has(archetype)) { why('same archetype as another design'); continue; }
    const family = familyOf(archetype);
    if ((used.families.get(family) || 0) >= familyCap) { why(`a second ${family} design (the set needs different ES families)`); continue; }
    // The hero number is a real stat: never a year, a date or our coverage counts.
    const wantedNumber = read.facts.find(f => f.id === String(raw.numberFact || ''));
    if (wantedNumber && !isStat(wantedNumber, 3) && (COMPOSE.BY_ID[archetype].focal === 'number' || ['hero-number', 'prize-poster', 'big-number', 'unit-grid', 'record-badge'].includes(archetype))) {
      why(`"${wantedNumber.text}" is not a stat (${wantedNumber.kind === 'meta' ? 'a coverage count' : wantedNumber.kind === 'date' ? 'a year or date' : 'no meaningful label'})`);
      continue;
    }
    if (!headline || headline.split(' ').length > 9) { why('headline missing or longer than 9 words'); continue; }
    if (RULES.BANNED.some(rule => rule.re.test(headline))) { why('headline breaks the ES voice rules'); continue; }
    const factIds = [...new Set([raw.numberFact, ...(Array.isArray(raw.factIds) ? raw.factIds : [])].map(id => String(id || '')).filter(id => read.facts.some(f => f.id === id)))];
    // Digits in the headline must be one of this design's facts.
    const allowedDigits = new Set(factIds.flatMap(factDigits));
    const strayDigit = digitsIn(headline).find(d => !allowedDigits.has(d));
    if (strayDigit) { why(`headline number "${strayDigit}" is not a fact from the brief`); continue; }
    // Grounding: names in the headline that the brief never mentions need a cited ES story.
    const cited = (Array.isArray(raw.sources) ? raw.sources : []).map(id => read.research.find(a => a.id === String(id).toUpperCase())).filter(Boolean);
    const offBrief = offBriefNames(raw?.headline || '', read);
    const unsupported = offBrief.filter(n => !cited.some(a => `${a.title} ${a.excerpt}`.toLowerCase().includes(n.toLowerCase())));
    if (unsupported.length) { why(`"${unsupported.join(', ')}" is not in the brief and no ES story was cited for it`); continue; }
    const onStory = keyTerms(headline).some(term => squash(story.text).includes(` ${term} `)) || factIds.some(id => read.facts.find(f => f.id === id)?.story === story.id) || cited.length;
    if (!onStory) { why('headline is not about its story'); continue; }
    const photo = photoById.get(String(raw.photo || '')) || null;
    if (photo && used.photos.has(photoKey(photo.src))) { why('same photo as another design'); continue; }
    if (photo && !story.people?.includes(photo.person) && !read.people.includes(photo.person) && !read.teams.some(t => t.name === photo.person)) { why('photo of someone the brief does not name'); continue; }
    // Team / league photos are event imagery: never cut out as a person.
    if (photo?.team && ['hero-number', 'collage-strip', 'quote-portrait', 'trading-card', 'sticker-collage', 'stat-tower'].includes(archetype)) { why('a team photo cannot be a player cut-out'); continue; }
    const conceptArt = cut(raw.art, 120);
    const dir = {
      id: `d${kept.length + 1}`,
      source: 'director',
      story: story.id,
      archetype,
      name: cut(raw.name, 40),
      headline,
      kicker: cut(raw.kicker, 40),
      highlight: (Array.isArray(raw.highlight) ? raw.highlight : []).map(w => cut(w, 24)).filter(w => w && squash(headline).includes(squash(w))).slice(0, 2),
      numberFact: wantedNumber && isStat(wantedNumber, 3) ? wantedNumber.id : '',
      // A label that reads as a noun phrase, else the fact's own.
      label: labelReads(raw.label) ? cut(raw.label, 30) : '',
      tone: TONES.includes(raw.tone) ? raw.tone : '',
      factIds,
      person: photo?.person || story.people?.[0] || '',
      photo,
      photos: [],
      cutout: photo && !photo.team && assets.cutouts?.[photo.src] ? { src: assets.cutouts[photo.src] } : null,
      art: assets.art?.[story.id] || null,
      artConcept: conceptArt,
      palette: paletteChoices(read).includes(raw.palette) ? raw.palette : '',
      note: cut(raw.note, 180),
      critique: critiqueFromModel(raw, { source: 'director' }),
      // Per-fact labels ("f5": "Chase catches"): short words, never numbers.
      labels: Object.fromEntries(Object.entries(raw.labels && typeof raw.labels === 'object' ? raw.labels : {})
        .filter(([id, label]) => factIds.includes(id) && typeof label === 'string' && !/\d/.test(label) && label.split(' ').length <= 4 && labelReads(label))
        .map(([id, label]) => [id, cut(label, 28)])),
      cited: cited.map(a => ({ id: a.id, url: a.url, title: a.title, text: `${a.title} ${a.excerpt}` })),
    };
    if (archetype === 'split-versus') {
      const others = read.stories.filter(s => read.facts.some(f => f.story === s.id && ['money', 'count', 'pct'].includes(f.kind) && isStat(f, 3))).slice(0, 2);
      dir.sides = others.map(s => sideFor(read, s, assets, used.photos));
      dir.factIds = [...new Set([...dir.factIds, ...dir.sides.map(s => s.number.factId)])];
    }
    if (['collage-strip', 'film-strip', 'photo-mosaic'].includes(archetype) && photo) {
      dir.photos = (assets.photos?.[photo.person] || []).filter(p => photoKey(p.src) !== photoKey(photo.src) && !used.photos.has(photoKey(p.src))).slice(0, 3);
    }
    const input = inputsFor(dir, read, assets);
    if (!COMPOSE.fits(archetype, input)) { why(`${archetype} does not fit (needs ${COMPOSE.NEEDS?.[archetype] || NEEDS[archetype]})`); continue; }
    const repeated = repeatsNumber(dir, read, input);
    if (repeated) { why(repeated); continue; }
    used.archetypes.add(archetype);
    used.families.set(family, (used.families.get(family) || 0) + 1);
    if (photo) used.photos.add(photoKey(photo.src));
    dir.photos.forEach(p => used.photos.add(photoKey(p.src)));
    dir.at = list.indexOf(raw);
    kept.push(dir);
  }
  kept.sort((a, b) => a.at - b.at).forEach((dir, i) => { dir.id = `d${i + 1}`; delete dir.at; });
  return { directions: kept, dropped };
}

// Which model art-directs. GENERATE_ART_DIRECTOR_MODEL:
//   unset / auto   Haiku first; Sonnet once when Haiku's plan falls short after
//                  validation (fewer than min(want, 2) directions survive). The
//                  code rules (stat sense, labels, families, tones, cut-outs) do
//                  the heavy lifting, so Haiku is enough most runs.
//   best / sonnet  Sonnet always (quality-first override).
//   main / haiku   Haiku only (economy).
function artDirectorTier(value = process.env.GENERATE_ART_DIRECTOR_MODEL || '') {
  const wanted = String(value).trim().toLowerCase();
  if (!wanted || wanted === 'auto') return 'auto';
  return /haiku|^main$/.test(wanted) ? 'main' : 'best';
}

async function runArtDirector({ read, assets, steer = {}, want = 4, lessons = [], track = null, timeoutMs = 20000, tier = artDirectorTier() } = {}) {
  const result = { directions: [], dropped: [], cost: 0, model: '', source: 'none', calls: 0, escalated: false };
  try {
    const { aiText, isBudgetError } = gateway();
    const ask = async askTier => {
      result.calls += 1;
      const reply = await aiText({
        tier: askTier,
        system: DIRECTOR_SYSTEM(),
        cacheSystem: true,
        messages: [{ role: 'user', content: directorRequest(read, assets, { steer, want, lessons }) }],
        effort: 'low',
        maxTokens: 1800 + 380 * Math.max(0, want - 4),
        timeoutMs,
        track: track ? { ...track, feature: 'generate-creative-director' } : undefined,
      });
      result.cost += Number(reply.cost) || 0;
      result.model = reply.model || '';
      return validateDirections(extractJson(reply.text), read, assets, { want });
    };
    let judged = { directions: [], dropped: [] };
    try {
      judged = await ask(tier === 'auto' ? 'main' : tier);
      result.source = 'director';
    } catch (error) {
      if (isBudgetError?.(error)) return { ...result, source: 'budget' };
    }
    // Auto: escalate once when the cheap plan is thin after the code checks.
    if (tier === 'auto' && judged.directions.length < Math.min(want, 2)) {
      try {
        const better = await ask('best');
        if (better.directions.length >= judged.directions.length) {
          judged = { directions: better.directions, dropped: [...judged.dropped, ...better.dropped] };
          result.escalated = true;
          result.source = 'director';
        }
      } catch (error) {
        if (isBudgetError?.(error) && !judged.directions.length) return { ...result, source: 'budget' };
      }
    }
    Object.assign(result, judged, { source: judged.directions.length ? (result.escalated ? 'sonnet-escalated' : 'director') : 'none' });
  } catch (error) {
    result.source = 'none';
  }
  return result;
}

// ─── 5b. The set review (code, free) ──────────────────────────────────────
// A person cut-out comes from an action or portrait shot (the asset service's
// kind), never a crowd, venue or object photo.
const cutoutable = p => !['crowd', 'venue', 'object'].includes(String(p?.kind || ''));
const sceneOf = (d, read, assets) => {
  try { return COMPOSE.build(d.archetype, inputsFor(d, read, assets), 0); } catch (error) { return null; }
};
// A named person with a cut-out: at least one design leads with it (the ES
// board's stat posts and covers). Upgrades a design about them in place, else
// swaps the weakest design for a cut-out archetype from another ES family.
function ensureCutoutLed(directions, read, assets) {
  const named = read.people.filter(person => (assets.photos?.[person] || []).some(p => assets.cutouts?.[p.src] && cutoutable(p)));
  directions.forEach(d => { d.cutoutLed = usesCutout(sceneOf(d, read, assets)); });
  if (!named.length) return named.length ? 'kept' : 'no-cutout';
  if (directions.some(d => d.cutoutLed)) return 'kept';
  const usedPhotos = new Set(directions.filter(d => d.photo && usesPhoto(sceneOf(d, read, assets))).map(d => photoKey(d.photo.src)));
  for (const person of named) {
    // The best cut-out first (the asset service's rank); crowd / venue / object shots never.
    const pool = (assets.photos[person] || []).filter(p => assets.cutouts[p.src] && cutoutable(p))
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    if (!pool.length) continue;
    const photo = pool.find(p => !usedPhotos.has(photoKey(p.src))) || pool[0];
    const withCut = (d, pick = photo) => ({ ...d, person, photo: { ...pick, person }, cutout: { src: assets.cutouts[pick.src] } });
    // 1. In place: a design about this person whose archetype draws a cut-out
    // when it has one; a design already holding the best photo goes first.
    for (const pick of pool) {
      const holders = directions.filter(d => d.photo && photoKey(d.photo.src) === photoKey(pick.src));
      if (usedPhotos.has(photoKey(pick.src)) && !holders.length) continue;
      const order = [...holders, ...(usedPhotos.has(photoKey(pick.src)) ? [] : directions.filter(d => !holders.includes(d)))];
      for (const d of order) {
        const story = read.stories.find(s => s.id === d.story);
        if (!(story?.people || []).includes(person) && d.person !== person) continue;
        const next = withCut(d, pick);
        const input = inputsFor(next, read, assets);
        if (COMPOSE.fits(d.archetype, input) && usesCutout(sceneOf(next, read, assets))) {
          Object.assign(d, { person, photo: next.photo, cutout: next.cutout, cutoutLed: true });
          return `upgraded ${d.id} (${d.archetype}) to lead with ${person}'s cut-out`;
        }
      }
    }
    // 2. Swap: a cut-out archetype from a family the set lacks, replacing the
    // design whose family repeats, else the last code-planned design, else the last.
    const story = read.stories.find(s => (s.people || []).includes(person)) || read.stories[0];
    if (!story) continue;
    const families = directions.map(d => familyOf(d.archetype));
    const target = directions.length < 1 ? null
      : [...directions].reverse().find(d => families.filter(f => f === familyOf(d.archetype)).length > 1)
        || [...directions].reverse().find(d => d.source === 'code' && !(d.photo && !d.cutout))
        || directions[directions.length - 1];
    const order = [...new Set([...PRIORITY.person, ...COMPOSE.ARCHETYPES.map(a => a.id)])];
    const usedArch = new Set(directions.filter(d => d !== target).map(d => d.archetype));
    const otherFamilies = new Set(directions.filter(d => d !== target).map(d => familyOf(d.archetype)));
    const tryArch = strict => order.find(id => {
      if (usedArch.has(id) || (strict && otherFamilies.has(familyOf(id)))) return false;
      const skel = withCut({ ...directionSkeleton(read, story, id, assets, { photos: new Set(), headline: true }), id: target?.id || 'd1', source: 'code' });
      const input = inputsFor(skel, read, assets);
      return COMPOSE.fits(id, input) && !repeatsNumber(skel, read, input) && usesCutout(sceneOf(skel, read, assets));
    });
    const arch = tryArch(true) || tryArch(false);
    if (!arch) continue;
    const fresh = withCut({ ...directionSkeleton(read, story, arch, assets, { photos: new Set(), headline: true }), source: 'code', note: '' });
    fresh.cutoutLed = true;
    if (target) {
      const at = directions.indexOf(target);
      directions[at] = { ...fresh, id: target.id };
      return `swapped ${target.id} (${target.archetype}) for ${arch} with ${person}'s cut-out`;
    }
    directions.push({ ...fresh, id: 'd1' });
    return `added ${arch} with ${person}'s cut-out`;
  }
  return 'no-fit';
}

// Image-led when a person is named and ES has photos of them: at least half
// the set shows real photography (the board: photos on almost every post).
function ensureImageLed(directions, read, assets) {
  const named = read.people.filter(person => (assets.photos?.[person] || []).length);
  if (!named.length || directions.length < 2) return [];
  const done = [];
  const shows = d => usesPhoto(sceneOf(d, read, assets));
  const need = () => Math.ceil(directions.length / 2) - directions.filter(shows).length;
  let guard = directions.length;
  while (need() > 0 && guard > 0) {
    guard -= 1;
    // Photos only count as used where a design actually shows them.
    const usedPhotos = new Set(directions.filter(d => d.photo && shows(d)).map(d => photoKey(d.photo.src)));
    const families = directions.map(d => familyOf(d.archetype));
    // Replace a design with no photo: a repeated family first, then type-only covers, then the last.
    const bare = directions.filter(d => !shows(d));
    const target = [...bare].reverse().find(d => families.filter(f => f === familyOf(d.archetype)).length > 1)
      || [...bare].reverse().find(d => COMPOSE.BY_ID[d.archetype]?.focal === 'type')
      || bare[bare.length - 1];
    if (!target) break;
    const others = directions.filter(d => d !== target);
    const usedArch = new Set(others.map(d => d.archetype));
    const otherFamilies = new Set(others.map(d => familyOf(d.archetype)));
    let swapped = null;
    for (const person of named) {
      const photo = (assets.photos[person] || []).find(p => !usedPhotos.has(photoKey(p.src)));
      if (!photo) continue;
      const story = read.stories.find(st => (st.people || []).includes(person)) || read.stories[0];
      const order = [...new Set([...PRIORITY.person, ...COMPOSE.ARCHETYPES.map(a => a.id)])];
      const build = id => {
        const skel = { ...directionSkeleton(read, story, id, assets, { photos: new Set(), headline: true }), person, photo: { ...photo, person }, cutout: assets.cutouts?.[photo.src] ? { src: assets.cutouts[photo.src] } : null, source: 'code', note: '' };
        const input = inputsFor(skel, read, assets);
        return COMPOSE.fits(id, input) && !repeatsNumber(skel, read, input) && usesPhoto(sceneOf(skel, read, assets)) ? skel : null;
      };
      for (const strict of [true, false]) {
        const id = order.find(a => !usedArch.has(a) && (!strict || !otherFamilies.has(familyOf(a))) && build(a));
        if (id) { swapped = build(id); break; }
      }
      if (swapped) break;
    }
    if (!swapped) break;
    const at = directions.indexOf(target);
    directions[at] = { ...swapped, id: target.id, cutoutLed: usesCutout(sceneOf(swapped, read, assets)) };
    done.push(`swapped ${target.id} (${target.archetype}) for ${swapped.archetype} with ${swapped.person}'s photo`);
  }
  return done;
}

function dedupeHeadlines(directions, read, assets, review) {
  // Each design says something of its own: a code headline used twice takes
  // the next reading of its story (a shorter clause, the words before the
  // numbers, the name). The director's own headlines are left as written.
  const seen = new Set();
  directions.forEach(d => {
    const key = squash(d.headline);
    if (!seen.has(key) || d.source === 'director') { seen.add(key); return; }
    const story = read.stories.find(st => st.id === d.story) || read.stories[0];
    if (!story) return;
    // Story readings first, then the brief's own headline, then the name.
    const names = [story.people?.[0], story.subject].filter(Boolean);
    const options = [
      ...codeHeadline(story.text, story, read, { all: true }),
      ...codeHeadline(beforeNumbers(story.text, read.facts.filter(f => f.story === story.id)), story, read, { all: true }),
    ].filter(h => !names.includes(h)).concat(read.headline && story.id === read.stories[0]?.id ? [read.headline] : [], names);
    const next = options.find(h => !seen.has(squash(h)) && !repeatsNumber({ ...d, headline: h }, read, inputsFor(d, read, assets)));
    if (next) {
      review.fixed.push({ check: 'headline-variety', what: `${d.id}: "${d.headline}" -> "${next}"` });
      d.headline = next;
      d.kicker = kickerFor(read, story, read.teams.find(t => story.teams?.includes(t.id)), next);
    }
    seen.add(squash(d.headline));
  });
}

function designSet(directions, read, assets) {
  const review = { fixed: [], dropped: [] };
  const cut = ensureCutoutLed(directions, read, assets);
  if (/^(?:upgraded|swapped|added)/.test(cut)) review.fixed.push({ check: 'cutout-led', what: cut });
  ensureImageLed(directions, read, assets).forEach(what => review.fixed.push({ check: 'image-led', what }));
  directions.forEach(d => { d.cutoutLed = usesCutout(sceneOf(d, read, assets)); });
  dedupeHeadlines(directions, read, assets, review);
  const before = directions.map(d => d.tone || '');
  assignTones(directions);
  directions.forEach((d, i) => { if (before[i] && before[i] !== d.tone) review.fixed.push({ check: 'tone-variety', what: `${d.id} ${before[i]} -> ${d.tone}` }); });
  return review;
}

// Holes: candidates with an empty quadrant drop when a full one exists; when
// none is full, the composer's fixes (bigger number / headline) get one try.
function fillCheck(d, review) {
  if (!d.candidates?.length) return;
  const holes = d.candidates.map(sc => emptyQuadrants(sc));
  if (holes.some(h => !h.length)) {
    const before = d.candidates.length;
    d.candidates = d.candidates.filter((sc, i) => !holes[i].length);
    if (d.candidates.length < before) review.fixed.push({ check: 'empty-areas', what: `${d.id}: dropped ${before - d.candidates.length} candidate(s) with an empty area` });
    return;
  }
  const fixed = d.candidates.map(sc => {
    for (const name of ['bigger-number', 'bigger-headline']) {
      try {
        const next = COMPOSE.applyFix(JSON.parse(JSON.stringify(sc)), name);
        if (next && !emptyQuadrants(next).length && COMPOSE.checkScene(next, { facts: sc.facts }).ok) return { ...next, fixApplied: name };
      } catch (error) { /* keep */ }
    }
    return null;
  });
  if (fixed.some(Boolean)) {
    d.candidates = fixed.filter(Boolean);
    review.fixed.push({ check: 'empty-areas', what: `${d.id}: ${d.candidates[0].fixApplied} filled an empty area` });
  } else {
    d.holes = holes[0];
  }
}

// Code critique the set needs (no AI): tone monotony, a named star with no
// cut-out-led design, holes. Each improvement carries a one-click fix op the
// design assistant already applies (palette flip, archetype swap, photo swap).
function setCritique(directions, read, assets, review) {
  const add = (d, text, fix) => {
    d.critique = d.critique || { strengths: [], improvements: [], nextTime: '' };
    if (d.critique.improvements.some(i => i.text === text)) return;
    d.critique.improvements = [...(d.critique.improvements || []), { id: `s${d.critique.improvements.length + 1}`, text, fix, source: 'check' }].slice(0, 4);
  };
  const tones = directions.map(d => d.tone);
  directions.forEach((d, i) => {
    if (tones.indexOf(d.tone) !== i && directions.length > 2) add(d, `Same ${d.tone} tone as another design in the set; flip it for variety.`, { op: 'palette', flip: true });
    if (d.holes?.length) add(d, `The ${d.holes.join(' and ')} area is empty; scale the focal element up.`, { op: 'fix', name: 'bigger-number' });
  });
  const named = read.people.filter(person => (assets.photos?.[person] || []).length);
  if (named.length && directions.length && !directions.some(d => d.cutoutLed)) {
    const d = directions.find(x => !usesPhoto(x.candidates?.[0])) || directions[0];
    const swap = (assets.photos[named[0]] || [])[0];
    add(d, `${named[0]} is named but no design leads with their photo or cut-out.`, swap ? { op: 'photo', src: swap.src } : { op: 'assist', instruction: `Lead with a photo of ${named[0]}.` });
  }
  return review;
}

// The set's scorecard (code): what the judge and the tests read.
function setChecks(directions, read, assets) {
  const scenes = directions.map(d => d.candidates?.[0]).filter(Boolean);
  const numberLayers = scenes.flatMap(sc => (sc.layers || []).filter(l => l.type === 'number' && l.value));
  const factOf = id => read.facts.find(f => f.id === id);
  const badStats = numberLayers.filter(l => l.factId && factOf(l.factId) && !isStat(factOf(l.factId), 2)).map(l => `${l.value} ${l.label || ''}`.trim());
  const badLabels = scenes.flatMap(sc => (sc.layers || []).filter(l => l.type === 'number' && l.label).map(l => l.label).filter(label => !labelReads(label)));
  const dupes = directions.map(d => repeatsNumber(d, read, d.input || inputsFor(d, read, assets))).filter(Boolean);
  const tones = directions.map(d => d.tone).filter(Boolean);
  const families = directions.map(d => familyOf(d.archetype));
  const named = read.people.some(person => (assets.photos?.[person] || []).some(p => assets.cutouts?.[p.src]));
  return {
    meaningfulStats: { ok: !badStats.length, bad: badStats },
    labels: { ok: !badLabels.length, bad: badLabels },
    duplicates: { ok: !dupes.length, bad: dupes },
    tones: { ok: tones.length < 2 || (new Set(tones).size >= Math.min(tones.length, 2) && tones.some(isLightTone) && tones.some(t => !isLightTone(t))), list: tones },
    families: { ok: new Set(families).size >= Math.min(directions.length, 3), list: families },
    cutoutLed: { ok: !named || directions.some(d => d.cutoutLed), needed: named },
    imageLed: { ok: !read.people.length || !Object.values(assets.photos || {}).some(l => l.length) || scenes.filter(usesPhoto).length >= Math.ceil(scenes.length / 2), count: scenes.filter(usesPhoto).length },
    emptyAreas: { ok: !directions.some(d => d.holes?.length), bad: directions.filter(d => d.holes?.length).map(d => `${d.id}:${d.holes.join('+')}`) },
  };
}

// ─── 6. The whole plan ────────────────────────────────────────────────────
const PLAN_CACHE = new Map();
const PLAN_TTL_MS = 10 * 60 * 1000;
const now = () => Date.now();

// Concept art per story: asset service (AI, cached by it) or ES vector art.
async function resolveArt(read, directions, { track = null, palette = [] } = {}) {
  const service = assetService();
  const out = {};
  let cost = 0;
  await Promise.all(directions.filter(d => ['prize-poster', 'typographic'].includes(d.archetype) || d.artConcept).map(async dir => {
    const story = read.stories.find(s => s.id === dir.story);
    const proc = procArtFor(`${story?.text || ''} ${dir.artConcept || ''}`, read.sport);
    let art = { src: `proc:${proc}`, ai: false, rights: { source: 'ES vector art', licence: 'internal', aiGenerated: false } };
    if (service?.generateConceptArt) {
      try {
        const res = await service.generateConceptArt({ concept: dir.artConcept || proc.replace('-', ' '), sport: read.sport, palette, avoid: ['people', 'faces', 'logos', 'jerseys', 'text'], track });
        if (res?.ok && (res.url || res.dataUrl)) {
          art = { src: res.url || res.dataUrl, ai: true, rights: res.rights || { aiGenerated: true } };
          cost += Number(res.cost) || 0;
        }
      } catch (error) { /* keep vector art */ }
    }
    out[dir.id] = art;
  }));
  return { art: out, cost };
}

async function resolveCutouts(photos, { track = null, limit = 4, have = {} } = {}) {
  const service = assetService();
  const out = { ...have };
  let cost = 0;
  if (!service?.cutout) return { cutouts: out, cost };
  // Cut-outs the asset service already made (cached) are not made again.
  const firsts = Object.values(photos).flatMap(list => list.filter(p => !p.team && !['crowd', 'venue', 'object'].includes(String(p.kind || ''))).slice(0, 2)).filter(p => !out[p.src]).slice(0, limit);
  await Promise.all(firsts.map(async photo => {
    try {
      const res = await service.cutout({ imageUrl: photo.src, track });
      if (res?.ok && (res.url || res.dataUrl)) {
        out[photo.src] = res.url || res.dataUrl;
        cost += Number(res.cost) || 0;
      }
    } catch (error) { /* no cut-out: archetypes that need one do not fit */ }
  }));
  return { cutouts: out, cost };
}

// The scenes for one direction: 2-3 candidates, each through the ES gate.
function scenesFor(direction, read, assets, perDesign = 3) {
  const input = inputsFor(direction, read, assets);
  const facts = input.facts;
  const out = [];
  COMPOSE.candidates(direction.archetype, input, perDesign).forEach((scene, i) => {
    const checked = COMPOSE.checkScene(scene, { facts });
    if (!checked.ok) return;
    scene.id = `${direction.id}c${i + 1}`;
    if (input.tone) scene.tone = input.tone;
    // What a rebuild needs that the layers do not say (the assistant's
    // "swap layout" / size change): scores, records, compares, split sides.
    const extra = Object.fromEntries(['score', 'record', 'compare', 'sides', 'quote'].filter(k => input[k]).map(k => [k, input[k]]));
    if (Object.keys(extra).length) scene.extra = extra;
    scene.guideline = { ok: true, fixes: checked.fixes.map(({ rule, what }) => ({ rule, what })), version: GUIDE.VERSION };
    out.push(scene);
  });
  return out;
}

// plan: the server step of a Creative run. Returns directions with candidates.
// opts: { brief, found, steer, want (1-8), track, localFind, nameCandidates, director: true,
//         lessons: [] or async ({ sport }) => [] (the learning model, _creative-memory.js) }
async function plan({ brief, found = {}, steer = {}, want: wantRaw = 4, track = null, localFind = null, nameCandidates = null, director = true, cacheKey = '', lessons: lessonSource = null } = {}) {
  const { want, perDesign } = budgetFor(wantRaw);
  const key = cacheKey || `${brief}|${JSON.stringify(steer)}|${want}`;
  const hit = PLAN_CACHE.get(key);
  if (hit && now() - hit.at < PLAN_TTL_MS) return { ...hit.value, cached: true, cost: { ...hit.value.cost, total: 0, cachedFrom: hit.value.cost.total } };
  const started = now();
  const read = readCreative(brief, found, { nameCandidates });
  const extras = { cutouts: {}, headshots: [], logos: [] };
  const photos = await resolvePhotos(read, { localFind, track, extras });
  Object.entries(photos).forEach(([person, list]) => list.forEach((p, i) => { p.id = `p${Object.keys(photos).indexOf(person) + 1}${String.fromCharCode(97 + i)}`; }));
  const { cutouts, cost: cutCost } = await resolveCutouts(photos, { track, have: extras.cutouts });
  const assets = { photos, cutouts, art: {}, headshots: extras.headshots, logos: extras.logos };
  // Vector art first so the director sees what fits; AI art only for the chosen directions.
  read.stories.forEach(story => { assets.art[story.id] = { src: `proc:${procArtFor(story.text, read.sport)}`, ai: false }; });
  // Team lessons for this sport (never blocks the run).
  let lessons = [];
  try {
    lessons = typeof lessonSource === 'function' ? await lessonSource({ sport: read.sport }) : Array.isArray(lessonSource) ? lessonSource : [];
  } catch (error) { lessons = []; }
  lessons = (lessons || []).slice(0, 8);
  let ai = { directions: [], dropped: [], cost: 0, model: '', source: 'none' };
  if (director) ai = await runArtDirector({ read, assets, steer, want, lessons, track });
  let directions = ai.directions;
  // Fill any gap with the code plan (different archetypes and photos).
  if (directions.length < want) {
    const base = planDeterministic(read, assets, { want: want + 4 });
    MEMORY.rankDirections?.(base, { sport: read.sport }); // gen4-learning hook: learned archetype / tone ranking (_creative-memory.js)
    const usedArch = new Set(directions.map(d => d.archetype));
    const usedPhotos = new Set(directions.filter(d => d.photo).map(d => photoKey(d.photo.src)));
    const families = new Map();
    directions.forEach(d => families.set(familyOf(d.archetype), (families.get(familyOf(d.archetype)) || 0) + 1));
    // Different ES families first; a repeat family only when nothing else fits.
    [want <= 4 ? 1 : 2, 2, 9].forEach(cap => base.forEach(d => {
      if (directions.length >= want || usedArch.has(d.archetype) || (d.photo && usedPhotos.has(photoKey(d.photo.src)))) return;
      if ((families.get(familyOf(d.archetype)) || 0) >= cap) return;
      usedArch.add(d.archetype);
      families.set(familyOf(d.archetype), (families.get(familyOf(d.archetype)) || 0) + 1);
      if (d.photo) usedPhotos.add(photoKey(d.photo.src));
      directions.push({ ...d, id: `d${directions.length + 1}` });
    }));
  }
  // The set as a whole: a cut-out-led design for a named star, tones mixed
  // light and dark, then (below) candidates without holes.
  const review = designSet(directions, read, assets);
  const artRes = await resolveArt(read, directions, { track });
  directions.forEach(d => { if (artRes.art[d.id]) d.art = artRes.art[d.id]; });
  const finish = d => {
    if (!d.note) d.note = defaultNote(d, read);
    d.archetypeName = COMPOSE.BY_ID[d.archetype]?.name || d.archetype;
    d.storyText = read.stories.find(s => s.id === d.story)?.text || '';
    d.candidates = scenesFor(d, read, assets, perDesign);
    fillCheck(d, review);
    // The composer input, so the page can rebuild this design at another size.
    d.input = inputsFor(d, read, assets);
    d.critique = mergeCritiques(d.critique, d.candidates[0] ? codeCritique(d.candidates[0], d, read, assets) : null);
    // Swap photo: every ES photo of this design's person (or team), with its cut-out when one was made.
    const owner = d.photo?.person || d.person || read.teams.find(t => read.stories.find(s => s.id === d.story)?.teams?.includes(t.id))?.name || '';
    d.swaps = dedupePhotos([d.photo, ...(d.photos || []), ...(photos[owner] || [])].filter(Boolean)).map(p => ({ src: p.src, person: p.person || owner, cutout: cutouts[p.src] || '' }));
    return d;
  };
  directions.forEach(finish);
  // A design that still has a hole (a 3-number grid in a 2x2) is swapped for
  // the next composition that fits the brief without one.
  directions.forEach((d, i) => {
    if (!d.holes?.length) return;
    const others = directions.filter(x => x !== d);
    const families = new Set(others.map(x => familyOf(x.archetype)));
    // Every composition not in the set, for this design's story first, then the others.
    const storyOrder = [read.stories.find(st => st.id === d.story), ...read.stories.filter(st => st.id !== d.story)].filter(Boolean);
    const pool = storyOrder.flatMap(st => COMPOSE.ARCHETYPES.map(a => a.id)
      .filter(id => id !== d.archetype && id !== 'split-versus' && !others.some(x => x.archetype === id))
      .map(id => ({ ...directionSkeleton(read, st, id, assets, { photos: new Set(), headline: true }), source: 'code' })));
    // The replaced design's photo carries over (same story); photo-led options
    // first when the set still needs photography.
    const carry = b => (b.story === d.story && d.photo ? { ...b, person: d.person, photo: d.photo, photos: d.photos || b.photos, cutout: d.cutout } : b);
    const showsPhoto = b => usesPhoto(sceneOf(carry(b), read, assets));
    const needPhoto = read.people.some(p => (assets.photos?.[p] || []).length) && usesPhoto(d.candidates?.[0]);
    const ranked = needPhoto ? [...pool.filter(showsPhoto), ...pool.filter(b => !showsPhoto(b))] : pool;
    const ordered = [...ranked.filter(b => b.story === d.story && !families.has(familyOf(b.archetype))), ...ranked.filter(b => !families.has(familyOf(b.archetype))), ...ranked].map(carry);
    // The set's only cut-out-led design is replaced by another cut-out-led one when one fits.
    const needCut = d.cutoutLed && !others.some(x => x.cutoutLed);
    const tries = needCut ? [...ordered.map(b => ({ b, cut: true })), ...ordered.map(b => ({ b, cut: false }))] : ordered.map(b => ({ b, cut: false }));
    for (const { b: base, cut: wantCut } of tries) {
      const b = wantCut && d.photo && d.cutout ? { ...base, person: d.person, photo: d.photo, cutout: d.cutout } : base;
      const support = tonesOf(b.archetype);
      const alt = { ...b, id: d.id, tone: support.find(t => isLightTone(t) === isLightTone(d.tone) && !others.some(x => x.tone === t)) || support.find(t => isLightTone(t) === isLightTone(d.tone)) || support[0], note: '' };
      alt.cutoutLed = usesCutout(sceneOf(alt, read, assets));
      if (wantCut && !alt.cutoutLed) continue;
      if (!COMPOSE.fits(alt.archetype, inputsFor(alt, read, assets)) || repeatsNumber(alt, read, inputsFor(alt, read, assets))) continue;
      const probe = { fixed: [] };
      alt.candidates = scenesFor(alt, read, assets, perDesign);
      fillCheck(alt, probe);
      if (!alt.candidates.length || alt.holes?.length) continue;
      review.fixed.push({ check: 'empty-areas', what: `${d.id}: swapped ${d.archetype} (${d.holes.join('+')} empty) for ${alt.archetype}` });
      directions[i] = finish(alt);
      return;
    }
  });
  // Replacements say something of their own too.
  const heads = directions.map(d => d.headline);
  dedupeHeadlines(directions, read, assets, review);
  directions.forEach((d, i) => { if (d.headline !== heads[i]) Object.assign(d, finish(d)); });
  directions = directions.filter(d => d.candidates.length);
  setCritique(directions, read, assets, review);
  review.checks = setChecks(directions, read, assets);
  const cost = { director: ai.cost, assets: cutCost + artRes.cost, judge: 0 };
  cost.total = Number((cost.director + cost.assets).toFixed(5));
  const value = {
    kind: 'creative',
    read: { sport: read.sport, stories: read.stories.map(({ id, text, subject }) => ({ id, text, subject })), facts: read.facts.map(({ id, story, kind, text, display, label }) => ({ id, story, kind, text, display, label })), quotes: read.quotes, people: read.people, teams: read.teams.map(({ name, kind, logo }) => ({ name, kind, logo })) },
    directions: directions.map(publicDirection),
    dropped: ai.dropped,
    director: { source: ai.source, model: ai.model, calls: ai.calls || 0, escalated: Boolean(ai.escalated) },
    review,
    lessons: lessons.map(({ id, key: lessonKey, text, kind, scope, scopeValue }) => ({ id, key: lessonKey, text, kind, scope, scopeValue })),
    budget: { count: want, candidatesPerDesign: perDesign },
    assets: { service: Boolean(assetService()), cutouts: Object.keys(cutouts).length, photos: Object.values(photos).reduce((n, l) => n + l.length, 0) },
    cost,
    ms: now() - started,
  };
  if (PLAN_CACHE.size > 60) PLAN_CACHE.delete(PLAN_CACHE.keys().next().value);
  PLAN_CACHE.set(key, { at: now(), value });
  return value;
}

function publicDirection(d) {
  return {
    id: d.id, source: d.source, story: d.story, storyText: d.storyText, archetype: d.archetype, archetypeName: d.archetypeName,
    family: familyOf(d.archetype), tone: d.tone || '', cutoutLed: Boolean(d.cutoutLed),
    name: d.name || d.archetypeName, headline: d.headline, kicker: d.kicker, note: d.note,
    facts: (d.factIds || []).slice(0, 8), cited: (d.cited || []).map(({ id, url, title }) => ({ id, url, title })),
    photo: d.photo ? { src: d.photo.src, person: d.photo.person || d.person } : null,
    photos: d.swaps || [],
    cutout: d.cutout || null,
    art: d.art ? { src: d.art.src, ai: Boolean(d.art.ai) } : null,
    candidates: d.candidates,
    input: d.input || null,
    critique: d.critique || { strengths: [], improvements: [], nextTime: '' },
  };
}

// A specific note when the director gave none (code plan): what the eye sees first.
function defaultNote(d, read) {
  const fact = read.facts.find(f => f.id === d.numberFact);
  const n = fact ? fact.display : '';
  const who = d.photo?.person || d.person || '';
  switch (d.archetype) {
    case 'prize-poster': return `${n} sits over the ${d.art?.ai ? 'AI' : 'vector'} ${procArtFor(d.storyText || '', read.sport).replace('-', ' ')}; gold glow pulls the eye from art to number.`;
    case 'unit-grid': return `${n} drawn as ${n} ${fact?.label?.split(' ').pop()?.toLowerCase() || 'units'}: the count is felt before it is read.`;
    case 'split-versus': return 'One canvas, two stories: a diagonal split gives each its own number and colour.';
    case 'hero-number': return `${who} cut out in front of a giant ${n}; the number frames the player.`;
    case 'scoreboard': return 'Built like a broadcast scoreboard: the winner\'s row in the team colour, key stats as a ticker.';
    case 'stat-bars': return 'Photo up top, then two bars so the gap reads at a glance.';
    case 'record-badge': return `${fact?.display || 'The record'} set huge over a watermark badge${who ? `, ${who} cut out beside it` : ''}.`;
    case 'quote-portrait': return 'The quote is the image: giant marks, the line set big, the speaker named underneath.';
    case 'magazine-cover': return `${who || 'The photo'} full bleed with a masthead kicker; the headline stacks low like a cover.`;
    case 'by-the-numbers': return 'Every number from the brief in one grid; the first tile in the accent colour leads.';
    case 'duotone-hero': return `${who || 'The photo'} in two team colours, with the headline knocked out low.`;
    case 'collage-strip': return `${who}'s name huge behind the cut-out, a strip of moments, the headline in a colour band.`;
    case 'typographic': return 'No photo needed: the headline is the image, one word in the accent colour.';
    default: return COMPOSE.BY_ID?.[d.archetype]?.about || 'Composed from the brief\'s facts.';
  }
}

// ─── 7. The art director's vision pass ────────────────────────────────────
// candidates: [{ direction, archetype, items: [{ id, image (data URL, JPEG) }] }]
// Rubric (1-5): hierarchy, focal, readability (phone), brand, originality.
// Number accuracy is checked in code (checkScene) and given to the judge.
const JUDGE_CACHE = new Map();
const JUDGE_TTL_MS = 30 * 60 * 1000;
// gen-director adds: image (photo / cut-out quality and use), labels (every
// stat label reads), stats (every number is a real stat about the story).
// Set level: toneVariety (light and dark mixed, not one tone three times).
const RUBRIC = ['hierarchy', 'focal', 'readability', 'brand', 'originality', 'image', 'labels', 'stats'];
const WEIGHTS = { hierarchy: 1.2, focal: 1.1, readability: 1.3, brand: 1, originality: 1, image: 1.2, labels: 1.1, stats: 1.2 };
// Director fixes the judge may name, as one-click ops the design assistant
// (generate-assistant.js) already applies.
const DIRECTOR_FIXES = {
  'flip-tone': { op: 'palette', flip: true },
  'use-cutout': { op: 'assist', instruction: 'Rebuild this design around the named player\'s cut-out, big and in front (a stats-post or cover composition).' },
  'drop-stat': { op: 'assist', instruction: 'Remove every number that is not a real stat about the story (coverage counts, years, dates).' },
  'fix-label': { op: 'assist', instruction: 'Rewrite each stat label as a short noun phrase from the facts (e.g. PASSING YARDS).' },
  'dedupe-headline': { op: 'assist', instruction: 'Rewrite the headline so it does not repeat the number or its label.' },
};
// Judge model: Sonnet vision by default (it buys the most quality per cent);
// GENERATE_JUDGE_MODEL=haiku for economy.
const judgeTier = (value = process.env.GENERATE_JUDGE_MODEL || '') => (/haiku|^main$/i.test(String(value).trim()) ? 'main' : 'best');

function judgePrompt(sets, brief, lessons = []) {
  return [
    'You are the senior art director at EssentiallySports (ES), judging Instagram designs before they post.',
    'For each direction, score every candidate 1-5 on: hierarchy (one clear reading order), focal (one strong focal point), readability (every word readable on a phone, good contrast), brand (feels like ES: bold condensed type, team colours, clean, the ES logo top-right untouched), originality (looks new, not a template),',
    'image (photo and cut-out quality and use: a named star shown big and bright, a clean cut-out in front; a tiny, murky or irrelevant photo scores 1-2; no photo when a star is named scores 2), labels (every stat label is a short noun phrase that reads, e.g. PASSING YARDS; words cut from another sentence like "SEASON WHY FANS" score 1), stats (every number is a real stat about the story: score, record, money, ranking; our own coverage counts like "4 STORIES", or a year shown as a stat, score 1).',
    'Also score the SET once: toneVariety 1-5 (5 = light and dark designs mixed, each its own tone; 1 = every design the same dark tone), and name the design to change if it is under 4.',
    `Then pick the best candidate, write a director's note of max 22 words that is SPECIFIC to what is on that design (what the eye hits first, what is cut out, what the colour does), and choose at most ONE fix from: ${COMPOSE.FIXES.join(', ')}, or "" if none is needed.`,
    'Then say what could have been better on the picked design, as a senior art director would to a designer:',
    '- strengths: 1-2 things that work (max 12 words each, specific).',
    `- improvements: 1-3 SPECIFIC, visible problems on that design ("photo too dark behind the headline", "number lacks its unit", "the label SEASON WHY FANS is garbled", "4 STORIES is a coverage count, not a stat", "headline repeats the 2027"), each with a fix from: ${[...COMPOSE.FIXES, 'brighten-photo', 'darken-photo', 'more-drama', ...Object.keys(DIRECTOR_FIXES)].join(', ')}, or "" when only a rewrite or another photo would fix it. No generic advice.`,
    '- nextTime: ONE lesson for future designs (max 16 words), e.g. "Pick photos with clear sky above the subject for top headlines."',
    ...MEMORY.promptLines(MEMORY.withSeeds ? MEMORY.withSeeds(lessons, { limit: 4 }) : lessons, { who: 'judge' }),
    `Brief: ${String(brief || '').slice(0, 500)}`,
    'Reply with JSON only: {"set":{"toneVariety":4,"change":"","why":""},"directions":[{"id":"d1","best":"d1c2","scores":{"d1c1":{"hierarchy":4,"focal":4,"readability":5,"brand":4,"originality":3,"image":4,"labels":5,"stats":5}},"note":"","fix":"","strengths":[""],"improvements":[{"text":"","fix":""}],"nextTime":""}]}',
    `Directions: ${sets.map(s => `${s.direction} (${s.archetype}${s.tone ? `, ${s.tone} tone` : ''}): ${s.items.map(i => i.id).join(', ')}`).join('; ')}`,
  ].join('\n');
}
// The set's tone variety: the judge's score when it gave one, else code from
// the tones the page sent (2+ tones, light and dark mixed). Under 4 names the
// design to flip (the judge's pick, else the last design repeating a tone).
function setVerdict(raw, sets = [], directions = []) {
  const tones = sets.map(s => s.tone).filter(Boolean);
  let code = null;
  let change = '';
  if (tones.length >= 2) {
    const mixed = tones.some(isLightTone) && tones.some(t => !isLightTone(t));
    const distinct = new Set(tones).size;
    code = Math.max(1, Math.min(5, (mixed ? 3 : 1) + Math.min(2, distinct - 1)));
    const dupe = [...sets].reverse().find((s, i, list) => s.tone && list.some(o => o !== s && o.tone === s.tone));
    change = dupe?.direction || '';
  }
  const model = Number(raw?.toneVariety);
  const toneVariety = Number.isFinite(model) && model >= 1 ? Math.max(1, Math.min(5, Math.round(model))) : code;
  if (toneVariety == null) return null;
  const pick = sets.some(s => s.direction === String(raw?.change || '')) ? String(raw.change) : change;
  return { toneVariety, ...(code != null ? { codeToneVariety: code } : {}), change: toneVariety < 4 ? pick : '', why: cut(raw?.why, 140) };
}
// The tone fix as an improvement on the design to change (one click: palette flip).
function addSetFix(directions = [], set = null) {
  if (!set || set.toneVariety >= 4 || !set.change) return directions;
  const d = directions.find(x => x.id === set.change);
  if (!d) return directions;
  d.critique = d.critique || { strengths: [], improvements: [], nextTime: '', source: 'check' };
  if (!d.critique.improvements.some(i => i.fix?.op === 'palette')) d.critique.improvements = [...d.critique.improvements, { id: `t${d.critique.improvements.length + 1}`, text: 'Same tone as other designs in the set; flip it for variety.', fix: { ...DIRECTOR_FIXES['flip-tone'] }, source: 'check' }].slice(0, 4);
  return directions;
}

const weighted = scores => {
  let total = 0; let w = 0;
  RUBRIC.forEach(k => { const v = Number(scores?.[k]); if (Number.isFinite(v)) { total += Math.max(1, Math.min(5, v)) * WEIGHTS[k]; w += WEIGHTS[k]; } });
  return w ? Number((total / w).toFixed(2)) : 0;
};
const hashOf = text => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 97) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${text.length}:${(h >>> 0).toString(16)}`;
};

// heuristics: { [candidateId]: { score, fix } } from the page's free check.
// lessons: the team lessons for this run (the learning model); the judge is
// told to call out a repeated mistake.
// Each verdict carries critique { strengths, improvements:[{ id, text, fix }], nextTime }.
async function judge({ brief, sets = [], heuristics = {}, lessons = [], track = null, timeoutMs = 20000 } = {}) {
  // Up to 8 designs; the image budget stays at 16 (3 candidates up to 4 designs, then 2).
  const perSet = sets.length > 4 ? 2 : 3;
  const clean = sets.slice(0, 8).map(s => ({
    direction: String(s.direction || '').slice(0, 8), archetype: String(s.archetype || '').slice(0, 30), tone: TONES.includes(s.tone) ? s.tone : '',
    items: (s.items || []).slice(0, perSet).filter(i => /^data:image\/(?:jpeg|png|webp);base64,/.test(String(i.image || '')) && String(i.image).length < 400000).map(i => ({ id: String(i.id).slice(0, 12), image: i.image })),
  })).filter(s => s.items.length);
  const out = { directions: [], cost: 0, model: '', source: 'heuristic' };
  const fallback = () => clean.map(s => {
    const ranked = [...s.items].sort((a, b) => (heuristics[b.id]?.score || 0) - (heuristics[a.id]?.score || 0));
    const best = ranked[0];
    const fix = COMPOSE.FIXES.includes(heuristics[best?.id]?.fix) ? heuristics[best.id].fix : '';
    const critique = { strengths: [], improvements: fix && FIX_TEXT[fix] ? [{ id: 'h1', text: FIX_TEXT[fix], fix: { op: 'fix', name: fix }, source: 'check' }] : [], nextTime: '', source: 'check' };
    return { id: s.direction, best: best?.id || '', scores: Object.fromEntries(s.items.map(i => [i.id, { total: heuristics[i.id]?.score || 0 }])), note: '', fix, critique };
  });
  if (!clean.length) return out;
  out.set = setVerdict(null, clean, []);
  const key = hashOf(clean.map(s => s.items.map(i => i.image).join('|')).join('||'));
  const hit = JUDGE_CACHE.get(key);
  if (hit && now() - hit.at < JUDGE_TTL_MS) return { ...hit.value, cost: 0, cached: true };
  const { aiText, gatewayConfigured } = gateway();
  if (gatewayConfigured && !gatewayConfigured()) return { ...out, directions: addSetFix(fallback(), out.set) };
  const content = [{ type: 'text', text: judgePrompt(clean, brief, lessons) }];
  clean.forEach(s => s.items.forEach(item => {
    const [, mediaType, data] = item.image.match(/^data:(image\/[a-z]+);base64,(.*)$/) || [];
    content.push({ type: 'text', text: `${item.id}:` }, { type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }));
  try {
    const reply = await aiText({ tier: judgeTier(), messages: [{ role: 'user', content }], effort: 'low', maxTokens: 1500 + 300 * clean.length, timeoutMs, track: track ? { ...track, feature: 'generate-creative-judge' } : undefined });
    out.cost = Number(reply.cost) || 0;
    out.model = reply.model || '';
    const parsed = extractJson(reply.text);
    out.directions = clean.map(s => {
      const verdict = (parsed?.directions || []).find(d => String(d?.id) === s.direction) || {};
      const scores = {};
      s.items.forEach(item => {
        const raw = verdict.scores?.[item.id] || {};
        scores[item.id] = { ...Object.fromEntries(RUBRIC.map(k => [k, Math.max(1, Math.min(5, Number(raw[k]) || 3))])), total: weighted(raw) || heuristics[item.id]?.score || 3 };
      });
      const best = s.items.some(i => i.id === verdict.best) ? verdict.best : Object.entries(scores).sort((a, b) => b[1].total - a[1].total)[0][0];
      const critique = critiqueFromModel(verdict, { source: 'judge' });
      critique.improvements = critique.improvements.map((item, i) => ({ ...item, id: `j${i + 1}` }));
      return { id: s.direction, best, scores, note: cut(verdict.note, 180), fix: COMPOSE.FIXES.includes(verdict.fix) ? verdict.fix : '', critique };
    });
    out.set = setVerdict(parsed?.set, clean, out.directions);
    addSetFix(out.directions, out.set);
    out.source = 'vision';
  } catch (error) {
    out.directions = addSetFix(fallback(), out.set);
    out.error = String(error.message || error).slice(0, 120);
  }
  if (out.source === 'vision') {
    if (JUDGE_CACHE.size > 100) JUDGE_CACHE.clear();
    JUDGE_CACHE.set(key, { at: now(), value: out });
  }
  return out;
}

module.exports = {
  readCreative, splitStories, factsIn, properNames, planDeterministic, validateDirections, runArtDirector, DIRECTOR_SYSTEM, directorRequest,
  inputsFor, scenesFor, plan, judge, judgePrompt, dedupePhotos, photoKey, procArtFor, paletteFor, paletteByKey, defaultNote,
  setAssetService, PLAN_CACHE, JUDGE_CACHE, NEEDS, RUBRIC,
  critiqueFromModel, codeCritique, mergeCritiques, fixFor, budgetFor, FIX_TEXT,
  // gen-director: content sense and set design.
  TONES, LIGHT_TONES, FAMILIES, familyOf, tonesOf, assignTones, statWeight, labelReads, senseLabel, stripCoverage,
  heroFact, codeHeadline, repeatsNumber, emptyQuadrants, usesCutout, usesPhoto, setChecks, designSet, ensureCutoutLed, ensureImageLed, directorTier: artDirectorTier,
};
