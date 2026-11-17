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
const COUNT = /(?:^|[^\d$.,/-])(\d[\d,]*(?:\.\d+)?)(%?)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,3})/g;
const NOUN_STOP = /^(?:and|or|but|on|in|at|to|for|with|the|a|an|as|of|from|by|after|before|since|while|when|this|that|his|her|their|its)$/i;
const SUFFIX = { million: 'M', mil: 'M', m: 'M', billion: 'B', bn: 'B', b: 'B', thousand: 'K', k: 'K' };
const RECORD_CUE = /\b(?:start|starts|started|record|at|to|improve|improves|improved|fall|falls|fell|move|moves|moved|sit|sits|season|now)\s*(?:the\s+season\s+)?(?:at\s+|to\s+)?$/i;
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
  for (const m of String(text).matchAll(COUNT)) {
    const at = m.index + m[0].indexOf(m[1]);
    const num = m[1].replace(/[.,]$/, '');
    const label = labelAfter(m[3]);
    if (!label || /^(?:am|pm|th|st|nd|rd)$/i.test(label)) continue;
    add({ kind: m[2] ? 'pct' : 'count', text: clean(`${num}${m[2]} ${label}`), prefix: '', value: num, suffix: m[2] || '', label, display: `${num}${m[2]}` }, at, num.length + (m[2] || '').length + 1 + label.length);
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
const SENTENCE_START = new Set(['The', 'A', 'An', 'He', 'She', 'They', 'It', 'His', 'Her', 'Their', 'After', 'Before', 'Next', 'Sport', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'ESPN']);

// The stories in a brief: sentences, and "X ... and Y ..." halves when each
// half has its own subject and its own fact. Sentences about the same subject merge.
function splitStories(brief) {
  const body = String(brief || '').split('\n').filter(line => !/^\s*(?:sport|headline|team)\s*:/i.test(line)).join(' ');
  const sentences = clean(body).split(/(?<=[.!?]["”]?)\s+(?=[A-Z“"])/).map(s => s.trim()).filter(Boolean);
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
    const list = factsIn(story.text, story.id, facts.length + 1);
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
    if (/^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,2}$/.test(name) && !/^[A-Z]{2,}\b/.test(name) && !/\b(?:Tour|League|Night|Football|Conference|North|South|East|West|Thanksgiving|Championship)\b/.test(name)) people.push(name);
  });
  (typeof tools.nameCandidates === 'function' ? tools.nameCandidates(text) : []).forEach(n => { if (!people.includes(n) && !teams.some(t => t.name === n || t.full === n)) people.push(n); });
  const mentions = (text, name) => Boolean(name) && new RegExp(`(?:^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`).test(text);
  stories.forEach(story => {
    story.people = people.filter(p => mentions(story.text, p) || mentions(story.text, p.split(' ').pop()));
    story.teams = teams.filter(t => mentions(story.text, t.name) || mentions(story.text, t.full)).map(t => t.id);
    const lead = teams.find(t => story.teams.includes(t.id) && mentions(story.text.slice(0, 40), t.name));
    if (lead) story.subject = lead.name;
  });
  return { brief: text, sport, stories, facts, quotes, teams, people, research: (found.articles || []).slice(0, 8).map((a, i) => ({ id: `A${i + 1}`, title: clean(a.title), url: a.url, excerpt: cut(a.excerpt, 260), image: a.image || '' })) };
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

// Photos per person (asset service findPhotos, else the local ES search).
// localFind(person) -> [{ url, sourceUrl, title }] (es-generate.js photoCandidates).
// Stories with no named person get photos of their team / league (event
// imagery for backgrounds and split screens; never cut out as a person).
async function resolvePhotos(read, { localFind = null, track = null } = {}) {
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
        const res = await service.findPhotos({ ...(isTeam ? { team: person, query: person } : { person }), sport: read.sport, count: 5, track });
        list = (res?.photos || res?.candidates || (Array.isArray(res) ? res : [])).map(p => ({ src: p.url || p.src, title: p.title || '', person, source: 'es' }));
      } else if (localFind) {
        list = (await localFind(person)).map(p => ({ src: p.url || p.src, title: p.title || '', person, source: 'es' }));
      }
    } catch (error) { list = []; }
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
  const f = read.facts.find(x => x.story === story.id && ['money', 'count', 'pct'].includes(x.kind));
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
const shortHeadline = text => {
  const list = clean(text).replace(/[“”"]/g, '').split(' ');
  return list.length <= 8 ? list.join(' ') : list.slice(0, 8).join(' ').replace(/\s+(?:with|of|for|to|and|by|at|in|the|a)$/i, '');
};

// Composer input for one direction (the archetype's parameters).
function inputsFor(direction, read, assets = {}) {
  const story = read.stories.find(s => s.id === direction.story) || read.stories[0] || { id: 's1', text: read.brief, facts: [], people: [], teams: [] };
  const factById = id => read.facts.find(f => f.id === id);
  const num = factById(direction.numberFact);
  const pal = paletteByKey(read, direction.palette, story);
  const person = direction.person || story.people?.[0] || '';
  const photo = direction.photo || null;
  const cutout = direction.cutout || null;
  const storyTeams = read.teams.filter(t => story.teams?.includes(t.id));
  // Numbers from several people's stories carry the person ("BURROW", "CHASE").
  const numberFacts = (direction.factIds || story.facts || []).map(factById).filter(Boolean)
    .filter(f => f.kind !== 'score' && f.kind !== 'record' && f.kind !== 'compare');
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
    palette: COMPOSE.makePalette(pal.colors, { name: pal.name }),
    kicker: direction.kicker,
    headline: direction.headline,
    highlight: direction.highlight || [],
    body: direction.body || '',
    name: direction.name || person,
    number: num && num.kind !== 'score' && num.kind !== 'compare' ? { prefix: num.prefix, value: num.kind === 'record' ? num.value : num.value, suffix: num.suffix, label: direction.label || num.label, factId: num.id } : null,
    numbers,
    photo: photo ? { src: photo.src, focus: photo.focus } : null,
    photos: (direction.photos || []).map(p => ({ src: p.src, label: p.label || '' })),
    cutout: cutout ? { src: cutout.src } : null,
    art: direction.art ? { src: direction.art.src } : null,
    logos: storyTeams.filter(t => t.logo).map(t => ({ src: t.logo, name: t.name })),
    quote: quote ? { text: quote.text, by: quote.by } : null,
    unit: /card/i.test(num?.label || '') ? 'card' : 'dot',
    facts: read.facts.filter(f => f.id === direction.numberFact || (direction.factIds || []).includes(f.id) || f.story === story.id)
      .concat(read.quotes.filter(q => q.story === story.id).map(q => ({ id: q.id, text: q.text })))
      .concat((direction.cited || []).map(c => ({ id: c.id, text: c.text, source: c.url }))),
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
    if (!direction.palette) input.palette = COMPOSE.makePalette(paletteFor(read, story, { team: winTeam }).colors, { name: winTeam.name });
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
  none: ['typographic', 'magazine-cover', 'duotone-hero'],
};

function directionSkeleton(read, story, archetype, assets, used) {
  const facts = read.facts.filter(f => f.story === story.id);
  const hero = facts.find(f => f.kind === 'money') || facts.find(f => f.kind === 'count' && Number(f.value.replace(/,/g, '')) >= 8 && Number(f.value.replace(/,/g, '')) <= 200)
    || facts.find(f => f.kind === 'count') || facts.find(f => f.kind === 'record') || facts.find(f => f.kind === 'pct') || null;
  const team = read.teams.find(t => story.teams?.includes(t.id));
  const person = story.people?.[0] || '';
  const photos = (assets.photos?.[person] || (!person && team ? assets.photos?.[team.name] : null) || []).filter(p => !used.photos.has(photoKey(p.src)));
  const art = assets.art?.[story.id] || null;
  const scoreFact = facts.find(f => f.kind === 'score');
  const text = archetype === 'scoreboard' && scoreFact ? clean(story.text.replace(scoreFact.text, '').replace(/\s+(?:at|to)\s+\d{1,2}-\d{1,2}$/, ''))
    : stripNumber(story.text, ['prize-poster', 'big-number', 'unit-grid', 'hero-number', 'record-badge'].includes(archetype) ? hero : null);
  return {
    story: story.id,
    archetype,
    name: '',
    kicker: [team?.name || story.subject, read.sport].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ').toUpperCase(),
    headline: shortHeadline(text),
    highlight: [],
    numberFact: hero?.id || '',
    label: hero?.label || '',
    factIds: facts.map(f => f.id),
    person,
    photo: photos[0] || null,
    photos: photos.slice(1, 4),
    cutout: person && assets.cutouts?.[photos[0]?.src] ? { src: assets.cutouts[photos[0].src] } : null,
    art,
    palette: '',
    note: '',
  };
}

function storyKinds(read, story) {
  const kinds = read.facts.filter(f => f.story === story.id).map(f => f.kind);
  if (read.quotes.some(q => q.story === story.id)) kinds.push('quote');
  if (story.people?.length) kinds.push('person');
  if (!kinds.length) kinds.push('none');
  return [...new Set(kinds)];
}

function planDeterministic(read, assets = {}, { want = 4 } = {}) {
  const used = { archetypes: new Set(), focal: new Map(), photos: new Set() };
  const out = [];
  const stories = read.stories.length ? read.stories : [{ id: 's1', text: read.brief, facts: [], people: [], teams: [] }];
  // Two stories with numbers: one split screen that holds both.
  const withNumbers = stories.filter(s => read.facts.some(f => f.story === s.id && ['money', 'count', 'pct'].includes(f.kind)));
  const tryAdd = (story, archetype, extra = {}) => {
    if (out.length >= want || used.archetypes.has(archetype)) return false;
    const dir = { ...directionSkeleton(read, story, archetype, assets, used), ...extra };
    const input = inputsFor(dir, read, assets);
    if (!COMPOSE.fits(archetype, input)) return false;
    const focal = COMPOSE.BY_ID[archetype].focal;
    if ((used.focal.get(focal) || 0) >= 2) return false;
    used.archetypes.add(archetype);
    used.focal.set(focal, (used.focal.get(focal) || 0) + 1);
    if (dir.photo) used.photos.add(photoKey(dir.photo.src));
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
  return out.map((d, i) => ({ ...d, id: `d${i + 1}`, source: 'code' }));
}

// ─── 5. The art director (one AI call) ────────────────────────────────────
function DIRECTOR_SYSTEM() {
  const catalog = COMPOSE.ARCHETYPES.map(a => `- ${a.id} (${a.name}, focal: ${a.focal}): ${a.about} Needs: ${NEEDS[a.id]}.`).join('\n');
  return [
    'You are the senior art director of EssentiallySports (ES), a US sports media brand with a bold, editorial Instagram look.',
    'You plan COMPOSED designs (not template fills): each design is a composition archetype the ES composer draws, filled with your copy and the brief\'s real numbers.',
    '',
    'Composition archetypes:',
    catalog,
    '',
    ...GUIDE.composedLines(),
    '',
    'Rules:',
    '- Each design is about ONE story from the brief (story id). When the brief has several stories, spread the designs across them; a split-versus may hold two.',
    '- Use a different archetype for every design, and a different focal element (athlete / number / data / type / art / logo / contrast) where you can.',
    '- Numbers: only by fact id (numberFact, factIds). Never type a number into the headline unless it is that exact fact. Never invent results, records or prizes.',
    '- Headlines come from the brief\'s story. An angle from ES research must name the research id in "sources"; otherwise stay on the brief.',
    '- headline: 2-8 words, a hook (claim or question), uppercase is applied for you. kicker: 2-5 words (tour, team, event). highlight: 1-2 words of the headline to set in the accent colour. label: 1-4 words under the number.',
    '- photo: a photo id from the list (each design a different photo) or "" (art-led designs need none). Never ask for a photo of a person the brief does not name.',
    '- art: a short concept for an AI background or object (trophy, ball, stadium light, money, cards, weather, motion). Never people, faces, jerseys, logos or text.',
    '- note: the director\'s note, SPECIFIC to this design (what the eye sees first, what is cut out, what colour does what), max 22 words. No generic praise.',
    ...RULES.VOICE.map(line => `- ${line}`),
    '',
    'Reply with JSON only:',
    '{"directions":[{"story":"s1","archetype":"","name":"2-4 word name","headline":"","kicker":"","highlight":[""],"numberFact":"f1","factIds":["f1"],"label":"","photo":"p1","art":"","palette":"","note":"","sources":[]}]}',
  ].join('\n');
}

function directorRequest(read, assets, { steer = {}, want = 4 } = {}) {
  const photoList = Object.entries(assets.photos || {}).flatMap(([person, list]) => list.map((p, i) => ({ id: p.id || `${person}#${i + 1}`, person, cutout: Boolean(assets.cutouts?.[p.src]) })));
  return [
    `Brief: ${read.brief.slice(0, 1200)}`,
    `Sport: ${read.sport || 'unknown'}`,
    `Stories: ${JSON.stringify(read.stories.map(s => ({ id: s.id, text: s.text, people: s.people, facts: s.facts })))}`,
    `Facts: ${JSON.stringify(read.facts.map(f => ({ id: f.id, story: f.story, kind: f.kind, text: f.text, label: f.label })))}`,
    read.quotes.length ? `Quotes: ${JSON.stringify(read.quotes)}` : '',
    `Photos: ${JSON.stringify(photoList)}`,
    `Logos: ${JSON.stringify(read.teams.map(t => ({ name: t.name, kind: t.kind })))}`,
    `Palettes: ${JSON.stringify(paletteChoices(read))}`,
    steer.tone ? `Tone: ${steer.tone}.` : '',
    steer.audience ? `Audience: ${steer.audience === 'diehard' ? 'die-hard fans (insider detail)' : 'casual fans (big picture)'}.` : '',
    read.research.length ? `ES research (cite by id only if you use it):\n${read.research.map(a => `${a.id}: ${a.title} — ${a.excerpt}`).join('\n')}` : '',
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
  const used = { archetypes: new Set(), photos: new Set(), focal: new Map() };
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
    if (photo?.team && ['hero-number', 'collage-strip', 'quote-portrait'].includes(archetype)) { why('a team photo cannot be a player cut-out'); continue; }
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
      numberFact: read.facts.some(f => f.id === raw.numberFact) ? raw.numberFact : '',
      label: cut(raw.label, 30),
      factIds,
      person: photo?.person || story.people?.[0] || '',
      photo,
      photos: [],
      cutout: photo && !photo.team && assets.cutouts?.[photo.src] ? { src: assets.cutouts[photo.src] } : null,
      art: assets.art?.[story.id] || null,
      artConcept: conceptArt,
      palette: paletteChoices(read).includes(raw.palette) ? raw.palette : '',
      note: cut(raw.note, 180),
      // Per-fact labels ("f5": "Chase catches"): short words, never numbers.
      labels: Object.fromEntries(Object.entries(raw.labels && typeof raw.labels === 'object' ? raw.labels : {})
        .filter(([id, label]) => factIds.includes(id) && typeof label === 'string' && !/\d/.test(label) && label.split(' ').length <= 4)
        .map(([id, label]) => [id, cut(label, 28)])),
      cited: cited.map(a => ({ id: a.id, url: a.url, title: a.title, text: `${a.title} ${a.excerpt}` })),
    };
    if (archetype === 'split-versus') {
      const others = read.stories.filter(s => read.facts.some(f => f.story === s.id && ['money', 'count', 'pct'].includes(f.kind))).slice(0, 2);
      dir.sides = others.map(s => sideFor(read, s, assets, used.photos));
      dir.factIds = [...new Set([...dir.factIds, ...dir.sides.map(s => s.number.factId)])];
    }
    if (archetype === 'collage-strip' && photo) {
      dir.photos = (assets.photos?.[photo.person] || []).filter(p => photoKey(p.src) !== photoKey(photo.src) && !used.photos.has(photoKey(p.src))).slice(0, 3);
    }
    const input = inputsFor(dir, read, assets);
    if (!COMPOSE.fits(archetype, input)) { why(`${archetype} does not fit (needs ${NEEDS[archetype]})`); continue; }
    used.archetypes.add(archetype);
    if (photo) used.photos.add(photoKey(photo.src));
    dir.photos.forEach(p => used.photos.add(photoKey(p.src)));
    dir.at = list.indexOf(raw);
    kept.push(dir);
  }
  kept.sort((a, b) => a.at - b.at).forEach((dir, i) => { dir.id = `d${i + 1}`; delete dir.at; });
  return { directions: kept, dropped };
}

async function runArtDirector({ read, assets, steer = {}, want = 4, track = null, timeoutMs = 20000 } = {}) {
  const result = { directions: [], dropped: [], cost: 0, model: '', source: 'none' };
  try {
    const { aiText, isBudgetError } = gateway();
    try {
      const reply = await aiText({
        tier: 'best',
        system: DIRECTOR_SYSTEM(),
        cacheSystem: true,
        messages: [{ role: 'user', content: directorRequest(read, assets, { steer, want }) }],
        effort: 'low',
        maxTokens: 1800,
        timeoutMs,
        track: track ? { ...track, feature: 'generate-creative-director' } : undefined,
      });
      result.cost = Number(reply.cost) || 0;
      result.model = reply.model || '';
      const judged = validateDirections(extractJson(reply.text), read, assets, { want });
      Object.assign(result, judged, { source: judged.directions.length ? 'director' : 'none' });
    } catch (error) {
      result.source = isBudgetError?.(error) ? 'budget' : 'none';
    }
  } catch (error) {
    result.source = 'none';
  }
  return result;
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

async function resolveCutouts(photos, { track = null, limit = 4 } = {}) {
  const service = assetService();
  const out = {};
  let cost = 0;
  if (!service?.cutout) return { cutouts: out, cost };
  const firsts = Object.values(photos).flatMap(list => list.filter(p => !p.team).slice(0, 2)).slice(0, limit);
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
function scenesFor(direction, read, assets) {
  const input = inputsFor(direction, read, assets);
  const facts = input.facts;
  const out = [];
  COMPOSE.candidates(direction.archetype, input, 3).forEach((scene, i) => {
    const checked = COMPOSE.checkScene(scene, { facts });
    if (!checked.ok) return;
    scene.id = `${direction.id}c${i + 1}`;
    scene.guideline = { ok: true, fixes: checked.fixes.map(({ rule, what }) => ({ rule, what })), version: GUIDE.VERSION };
    out.push(scene);
  });
  return out;
}

// plan: the server step of a Creative run. Returns directions with candidates.
// opts: { brief, found, steer, want, track, localFind, nameCandidates, director: true }
async function plan({ brief, found = {}, steer = {}, want = 4, track = null, localFind = null, nameCandidates = null, director = true, cacheKey = '' } = {}) {
  const key = cacheKey || `${brief}|${JSON.stringify(steer)}|${want}`;
  const hit = PLAN_CACHE.get(key);
  if (hit && now() - hit.at < PLAN_TTL_MS) return { ...hit.value, cached: true, cost: { ...hit.value.cost, total: 0, cachedFrom: hit.value.cost.total } };
  const started = now();
  const read = readCreative(brief, found, { nameCandidates });
  const photos = await resolvePhotos(read, { localFind, track });
  Object.entries(photos).forEach(([person, list]) => list.forEach((p, i) => { p.id = `p${Object.keys(photos).indexOf(person) + 1}${String.fromCharCode(97 + i)}`; }));
  const { cutouts, cost: cutCost } = await resolveCutouts(photos, { track });
  const assets = { photos, cutouts, art: {} };
  // Vector art first so the director sees what fits; AI art only for the chosen directions.
  read.stories.forEach(story => { assets.art[story.id] = { src: `proc:${procArtFor(story.text, read.sport)}`, ai: false }; });
  let ai = { directions: [], dropped: [], cost: 0, model: '', source: 'none' };
  if (director) ai = await runArtDirector({ read, assets, steer, want, track });
  let directions = ai.directions;
  // Fill any gap with the code plan (different archetypes and photos).
  if (directions.length < want) {
    const base = planDeterministic(read, assets, { want: want + 3 });
    const usedArch = new Set(directions.map(d => d.archetype));
    const usedPhotos = new Set(directions.filter(d => d.photo).map(d => photoKey(d.photo.src)));
    base.forEach(d => {
      if (directions.length >= want || usedArch.has(d.archetype) || (d.photo && usedPhotos.has(photoKey(d.photo.src)))) return;
      usedArch.add(d.archetype);
      if (d.photo) usedPhotos.add(photoKey(d.photo.src));
      directions.push({ ...d, id: `d${directions.length + 1}` });
    });
  }
  const artRes = await resolveArt(read, directions, { track });
  directions.forEach(d => { if (artRes.art[d.id]) d.art = artRes.art[d.id]; });
  directions.forEach(d => {
    if (!d.note) d.note = defaultNote(d, read);
    d.archetypeName = COMPOSE.BY_ID[d.archetype]?.name || d.archetype;
    d.storyText = read.stories.find(s => s.id === d.story)?.text || '';
    d.candidates = scenesFor(d, read, assets);
    // Swap photo: every ES photo of this design's person (or team), with its cut-out when one was made.
    const owner = d.photo?.person || d.person || read.teams.find(t => read.stories.find(s => s.id === d.story)?.teams?.includes(t.id))?.name || '';
    d.swaps = dedupePhotos([d.photo, ...(d.photos || []), ...(photos[owner] || [])].filter(Boolean)).map(p => ({ src: p.src, person: p.person || owner, cutout: cutouts[p.src] || '' }));
  });
  directions = directions.filter(d => d.candidates.length);
  const cost = { director: ai.cost, assets: cutCost + artRes.cost, judge: 0 };
  cost.total = Number((cost.director + cost.assets).toFixed(5));
  const value = {
    kind: 'creative',
    read: { sport: read.sport, stories: read.stories.map(({ id, text, subject }) => ({ id, text, subject })), facts: read.facts.map(({ id, story, kind, text, display, label }) => ({ id, story, kind, text, display, label })), quotes: read.quotes, people: read.people, teams: read.teams.map(({ name, kind, logo }) => ({ name, kind, logo })) },
    directions: directions.map(publicDirection),
    dropped: ai.dropped,
    director: { source: ai.source, model: ai.model },
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
    name: d.name || d.archetypeName, headline: d.headline, kicker: d.kicker, note: d.note,
    facts: (d.factIds || []).slice(0, 8), cited: (d.cited || []).map(({ id, url, title }) => ({ id, url, title })),
    photo: d.photo ? { src: d.photo.src, person: d.photo.person || d.person } : null,
    photos: d.swaps || [],
    cutout: d.cutout || null,
    art: d.art ? { src: d.art.src, ai: Boolean(d.art.ai) } : null,
    candidates: d.candidates,
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
    default: return 'Composed from the brief\'s facts.';
  }
}

// ─── 7. The art director's vision pass ────────────────────────────────────
// candidates: [{ direction, archetype, items: [{ id, image (data URL, JPEG) }] }]
// Rubric (1-5): hierarchy, focal, readability (phone), brand, originality.
// Number accuracy is checked in code (checkScene) and given to the judge.
const JUDGE_CACHE = new Map();
const JUDGE_TTL_MS = 30 * 60 * 1000;
const RUBRIC = ['hierarchy', 'focal', 'readability', 'brand', 'originality'];
const WEIGHTS = { hierarchy: 1.2, focal: 1.1, readability: 1.3, brand: 1, originality: 1 };

function judgePrompt(sets, brief) {
  return [
    'You are the senior art director at EssentiallySports (ES), judging Instagram designs before they post.',
    'For each direction, score every candidate 1-5 on: hierarchy (one clear reading order), focal (one strong focal point), readability (every word readable on a phone, good contrast), brand (feels like ES: bold condensed type, team colours, clean, the ES logo top-right untouched), originality (looks new, not a template).',
    `Then pick the best candidate, write a director's note of max 22 words that is SPECIFIC to what is on that design (what the eye hits first, what is cut out, what the colour does), and choose at most ONE fix from: ${COMPOSE.FIXES.join(', ')}, or "" if none is needed.`,
    `Brief: ${String(brief || '').slice(0, 500)}`,
    'Reply with JSON only: {"directions":[{"id":"d1","best":"d1c2","scores":{"d1c1":{"hierarchy":4,"focal":4,"readability":5,"brand":4,"originality":3}},"note":"","fix":""}]}',
    `Directions: ${sets.map(s => `${s.direction} (${s.archetype}): ${s.items.map(i => i.id).join(', ')}`).join('; ')}`,
  ].join('\n');
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
async function judge({ brief, sets = [], heuristics = {}, track = null, timeoutMs = 20000 } = {}) {
  const clean = sets.slice(0, 4).map(s => ({
    direction: String(s.direction || '').slice(0, 8), archetype: String(s.archetype || '').slice(0, 30),
    items: (s.items || []).slice(0, 3).filter(i => /^data:image\/(?:jpeg|png|webp);base64,/.test(String(i.image || '')) && String(i.image).length < 400000).map(i => ({ id: String(i.id).slice(0, 12), image: i.image })),
  })).filter(s => s.items.length);
  const out = { directions: [], cost: 0, model: '', source: 'heuristic' };
  const fallback = () => clean.map(s => {
    const ranked = [...s.items].sort((a, b) => (heuristics[b.id]?.score || 0) - (heuristics[a.id]?.score || 0));
    const best = ranked[0];
    return { id: s.direction, best: best?.id || '', scores: Object.fromEntries(s.items.map(i => [i.id, { total: heuristics[i.id]?.score || 0 }])), note: '', fix: COMPOSE.FIXES.includes(heuristics[best?.id]?.fix) ? heuristics[best.id].fix : '' };
  });
  if (!clean.length) return out;
  const key = hashOf(clean.map(s => s.items.map(i => i.image).join('|')).join('||'));
  const hit = JUDGE_CACHE.get(key);
  if (hit && now() - hit.at < JUDGE_TTL_MS) return { ...hit.value, cost: 0, cached: true };
  const { aiText, gatewayConfigured } = gateway();
  if (gatewayConfigured && !gatewayConfigured()) return { ...out, directions: fallback() };
  const content = [{ type: 'text', text: judgePrompt(clean, brief) }];
  clean.forEach(s => s.items.forEach(item => {
    const [, mediaType, data] = item.image.match(/^data:(image\/[a-z]+);base64,(.*)$/) || [];
    content.push({ type: 'text', text: `${item.id}:` }, { type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }));
  try {
    const reply = await aiText({ tier: 'best', messages: [{ role: 'user', content }], effort: 'low', maxTokens: 1400, timeoutMs, track: track ? { ...track, feature: 'generate-creative-judge' } : undefined });
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
      return { id: s.direction, best, scores, note: cut(verdict.note, 180), fix: COMPOSE.FIXES.includes(verdict.fix) ? verdict.fix : '' };
    });
    out.source = 'vision';
  } catch (error) {
    out.directions = fallback();
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
};
