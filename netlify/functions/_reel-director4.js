'use strict';
// Reels Studio v4 director: the ES "breakdown" reels (reels4-contract.md).
//
// Owner decision: the person writes the script (the voiceover) and the AI
// never writes or rewrites it. The script is cut into numbered segments by
// code; the model only says where each beat STARTS (a segment index) and
// what the beat SHOWS. Every beat's vo is then rebuilt by code from the
// script's own segments, so the voiceover is the script, word for word, by
// construction (asserted in scripts/test-reel-director-v4.mjs).
//
//   segmentScript   code: sentences, long ones cut at a clause; join(' ') === script
//   scriptToV4      code only ($0): the script as v4 chapters (AI off, free mode, fallback)
//   runDirectorV4   Haiku; Sonnet only when the plan comes back weak (tier allowing).
//                   Writes chapters, headlines, media kind + subject, modules
//                   (numbers from the script + sources only), stamps, tags,
//                   the yourCall close. Never throws; falls back to scriptToV4.
//   validateV4      never trusts the model: starts repaired, modules shaped and
//                   number-checked, quotes verbatim, motion rule, ≥1 clip asked.
//   critiqueV4      code checks + one Haiku call: scores, safe auto-fixes on
//                   visuals / structure / on-screen text only; script edits are
//                   optional notes. Never touches vo.
//   reviseV4        "punchier headlines" etc.: the director again with a note; vo unchanged.
//   draftScript     the small "Need a script?" helper (one Haiku call, optional).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../../reel-formats.js');
const CLIPS = require('../../reel-clips.js');
const RULES = require('../../frameup-rules.js');
// Required when called, so tests can swap modules (and no load-time cycle).
const gateway = () => require('./_ai-gateway.js');
const D = () => require('./_reel-director.js');
// The v3 engine's whole-phrase logic (phraseFor, DANGLE): headlines are
// complete phrases that never end on a word that leads into the next.
const ES = () => require('../../reel-es.js');

// ─── Styles, lengths, pacing ─────────────────────────────────────────────
const V4_STYLES = {
  breakdown: { label: 'Breakdown', skin: 'clean', marker: 'numbered', brief: 'Hook contradiction, then 2-4 chapters that each prove one part, a payoff stat, then the fans\' call. Clips carry the story; each chapter has a data module that builds (scoreboard, numberLine, compare, reveal, bars).', prefer: ['scoreboard', 'numberLine', 'compare', 'reveal', 'bars', 'statTiles', 'wl'] },
  casefile: { label: 'Case File', skin: 'scrapbook', marker: 'countdown', brief: 'An argument with evidence on a scrapbook: a 3·2·1 countdown of reasons, cut-out players, taped quotes, rank lists, tallies, calendars, play diagrams; the last chapter closes on a checklist.', prefer: ['rankList', 'checklist', 'tally', 'calendar', 'playDiagram', 'quote', 'flow', 'statTiles'] },
  outlier: { label: 'The Outlier', skin: 'clean', marker: 'numbered', brief: 'One player or team against the data: a dotGrid or scatter that shows the field and the one dot that should not exist, line charts and rank lists that prove it, a "SHOULDN\'T EXIST" style stamp.', prefer: ['dotGrid', 'scatter', 'lineChart', 'rankList', 'bars', 'statTiles'] },
  hotseat: { label: 'Hot Seat', skin: 'clean', marker: 'progress', brief: 'A person under pressure: press-conference windows (media kind presser), a timeline of empty boxes filling in, the record that is on the line, red stamps, and a fan vote close.', prefer: ['timeline', 'compare', 'statTiles', 'quote', 'wl', 'scoreboard'] },
};
const V4_IDS = Object.keys(V4_STYLES);
// Old styles open in the closest new one (contract legacy map).
function v4StyleOf(id = '', plan = null) {
  const s = String(id || '').trim().toLowerCase();
  if (V4_IDS.includes(s)) return s;
  if (s === 'receipts' || s === 'statcard') {
    const types = JSON.stringify(plan || {});
    return /"type":"(?:dotGrid|scatter|dots)"/.test(types) ? 'outlier' : 'breakdown';
  }
  return 'breakdown';
}
// Full ~90 s, Short ~40 s, at the ES house voice's pace.
const WPM = 160;
const LENGTHS = {
  full: { id: 'full', label: 'Full', sec: 90, range: [80, 100], chapters: [3, 4], beatsPerChapter: [2, 4] },
  short: { id: 'short', label: 'Short', sec: 40, range: [30, 45], chapters: [2, 3], beatsPerChapter: [1, 3] },
};
const lengthOf = id => LENGTHS[id] || LENGTHS.full;
const MAX_SCRIPT_CHARS = 3600; // ~600 words, far past a 100 s reel
const MAX_SEGMENTS = 48;

// ─── Text helpers ────────────────────────────────────────────────────────
const str = (v, n) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/gi, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim().slice(0, n);
const up = (v, n) => str(v, n).toUpperCase();
const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()} `;
const words = text => String(text || '').trim().split(/\s+/).filter(Boolean);
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const normScript = s => String(s == null ? '' : s).replace(/\r/g, '').replace(/\s+/g, ' ').trim();
const plain = s => String(s || '').replace(/\*/g, '');

// Spelled numbers a script writes for the voice ("twenty-one point lead")
// count as sources for the digits on screen.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function spelledNumbers(text) {
  const out = new Set();
  const t = String(text || '').toLowerCase().replace(/[^a-z\s-]/g, ' ');
  const re = /\b(?:(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\s-](one|two|three|four|five|six|seven|eight|nine))?|(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))(?:\s+(hundred))?\b/g;
  let m;
  while ((m = re.exec(t))) {
    let n = m[1] ? TENS.indexOf(m[1]) * 10 + (m[2] ? ONES.indexOf(m[2]) : 0) : ONES.indexOf(m[3]);
    if (m[4]) n *= 100;
    out.add(String(n));
  }
  return out;
}
function sourceNumbers(corpus) {
  const set = F.numberSet(corpus);
  spelledNumbers(corpus).forEach(n => set.add(n));
  return set;
}
const unsourced = (fields, set, allowed = new Set()) => {
  const out = [];
  fields.filter(v => v != null && v !== '').forEach(f => F.numbersIn(String(f)).forEach(n => { if (!set.has(n) && !allowed.has(n) && !out.includes(n)) out.push(n); }));
  return out;
};

// ─── Credits: "Source: …", "Via …", URLs are not spoken and never a chapter ─
const CREDIT_START = /^(?:sources?|via|credits?|data|stats?|photos?|h\/t|hat tip)\s*[:\-–—]\s*/i;
const URL_RE = /\(?\bhttps?:\/\/[^\s)]+\)?|\bwww\.[^\s)]+/gi;
// script -> { spoken, credits: ['Pro Football Reference'], links: [url] }.
// A credit runs from "Source(s):", "Credit(s):", "Data:", "Via:" (at a line or
// sentence start) to the end of its line; a bare "Via X" (<= 6 words) only at the end.
function splitCredits(script) {
  const links = [];
  const credits = [];
  // Metadata lines ("Sport: Golf", "Tags: …") are neither spoken nor credits.
  const kept = String(script == null ? '' : script).replace(/\r/g, '').split('\n').filter(line => !/^\s*(?:sport|league|team|tags?|topic|format|style|length)\s*:/i.test(line)).map(line => {
    let text = line.replace(URL_RE, m => { links.push(m.replace(/^\(|\)$/g, '')); return ' '; });
    const at = text.search(/(?:^|(?<=[.!?]["”’)]*)\s+)(?:(?:sources?|credits?|data|stats?|photos?)\s*:|via\s*[:\-–—])\s*\S/i);
    if (at >= 0) { credits.push(text.slice(at).trim().replace(CREDIT_START, '').replace(/[.\s]+$/, '')); text = text.slice(0, at); }
    const bareVia = text.match(/(?:^|(?<=[.!?]["”’)]*)\s+)[Vv]ia\s+([A-Z@][^.!?,]{1,60})[.]?\s*$/);
    if (bareVia && words(bareVia[1]).length <= 6) { credits.push(bareVia[1].trim()); text = text.slice(0, bareVia.index); }
    return text;
  });
  return { spoken: normScript(kept.join('\n')), credits: credits.filter(Boolean).map(c => str(c, 80)), links: [...new Set(links)].slice(0, 6) };
}
const isCreditText = t => CREDIT_START.test(String(t || '').trim());
const sourceLineOf = credits => (credits.length ? up(`SOURCE: ${credits.join(' · ')}`, 90) : '');

// ─── Script → segments (code) ────────────────────────────────────────────
function splitLong(sentence, max = 24) {
  const w = words(sentence);
  if (w.length <= max) return [sentence];
  const mid = w.length / 2;
  let best = -1;
  w.forEach((x, i) => { if (i > 2 && i < w.length - 3 && /[,;:—–]$/.test(x) && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i; });
  if (best < 0) best = Math.floor(mid) - 1;
  return [w.slice(0, best + 1).join(' '), ...splitLong(w.slice(best + 1).join(' '), max)];
}
// Segments joined with single spaces equal the normalised script exactly.
// mergeTiny: very short pieces ride with the next one (the AI path's
// segments); the code path keeps one scene per sentence (mergeTiny false).
function segmentScript(script, { mergeTiny = true } = {}) {
  const text = normScript(script);
  if (!text) return [];
  const sentences = text.split(/(?<=[.!?…]["”’)*]*)\s+(?=["“(*]?[A-Z0-9$])/).map(s => s.trim()).filter(Boolean);
  // A claim then its proof ("…has no twin: 45 touchdowns, …") splits at the
  // colon, so the claim and the proof can be separate beats.
  const atColon = s0 => { const m = s0.match(/^(.{12,}?[^\d\s]):\s+(.+)$/); return m && words(m[1]).length >= 4 && words(m[2]).length >= 4 ? [`${m[1]}:`, m[2]] : [s0]; };
  let segs = sentences.flatMap(atColon).flatMap(s => splitLong(s));
  // Very short pieces ride with the next one ("Wait." + the sentence).
  const merged = [];
  segs.forEach(s => {
    const last = merged[merged.length - 1];
    if (mergeTiny && last != null && words(last).length < 3) merged[merged.length - 1] = `${last} ${s}`;
    else merged.push(s);
  });
  segs = merged;
  // A spoken credit ("Source: …") never stands alone: it rides with the line before.
  for (let i = segs.length - 1; i > 0; i -= 1) if (isCreditText(segs[i])) segs.splice(i - 1, 2, `${segs[i - 1]} ${segs[i]}`);
  // Too many: neighbours merge (shortest pair first) until under the cap.
  while (segs.length > MAX_SEGMENTS) {
    let at = 0;
    let bestLen = Infinity;
    for (let i = 0; i < segs.length - 1; i += 1) { const n = words(segs[i]).length + words(segs[i + 1]).length; if (n < bestLen) { bestLen = n; at = i; } }
    segs.splice(at, 2, `${segs[at]} ${segs[at + 1]}`);
  }
  return segs;
}
const scriptWords = script => words(plain(normScript(script))).length;
function pacingOf(script, length = 'full') {
  const L = lengthOf(length);
  const n = scriptWords(script);
  const estSec = Math.round((n / WPM) * 60);
  const lo = Math.round((L.range[0] / 60) * WPM);
  const hi = Math.round((L.range[1] / 60) * WPM);
  const fit = estSec < L.range[0] ? 'short' : estSec > L.range[1] ? 'long' : 'ok';
  return { words: n, estSec, targetSec: L.sec, range: L.range, wordsRange: [lo, hi], wpm: WPM, fit };
}

// ─── Modules (ENGINE draws; numbers must be sourced) ─────────────────────
const TONES = ['blue', 'red', 'ink', 'grey'];
const tone = (v, d = 'blue', allowed = TONES) => (allowed.includes(v) ? v : d);
const numOf = v => { const n = Number(String(v == null ? '' : v).replace(/[,\s%$+]/g, '')); return Number.isFinite(n) ? n : NaN; };
const disp = (v, n = 10) => str(v, n);
const unit = v => Math.max(0, Math.min(1, Number(v) || 0));
const pt = p => (Array.isArray(p) && p.length >= 2 && p.every(x => Number.isFinite(Number(x))) ? [unit(p[0]), unit(p[1])] : null);

const MODULE_SPEC = {
  scoreboard: '{"type":"scoreboard","rows":[{"team":"Cowboys","value":"21"},{"team":"Eagles","value":"0"}],"tag":"59-YD FG · 0:02 LEFT"} 2-4 rows',
  bars: '{"type":"bars","title":"PASS RATE","rows":[{"label":"VS ARI","value":44,"tone":"blue"},{"label":"VS GB","value":47}],"unit":"%"} 2-5 rows',
  numberLine: '{"type":"numberLine","min":-10,"max":10,"marks":[{"label":"DALLAS","value":10,"tone":"red"}],"caption":"LEAD WHEN IT FLIPPED"}',
  dotGrid: '{"type":"dotGrid","total":67,"groups":[{"n":26,"tone":"blue","label":"BACK TO 90%"},{"n":26,"tone":"ink","label":"RETURNED"}],"avatar":"George Kittle"} total <= 1200',
  scatter: '{"type":"scatter","points":1000,"highlight":{"label":"RAMS","x":0.9,"y":0.2},"diagonal":true,"axes":{"x":"RUN RATE","y":"SUCCESS"}} x,y in 0-1',
  wl: '{"type":"wl","items":"WWLWWWWWWL","title":"49ERS · 9-1"} W/L/T, up to 20',
  rankList: '{"type":"rankList","title":"SHORTEST THROWS","rows":[{"rank":1,"label":"CHIEFS","value":"5.1 YDS","chip":"KC"}]} up to 5 rows',
  statTiles: '{"type":"statTiles","tiles":[{"value":"82-38","label":"SINCE 2019","tone":"blue"}]} 1-3 tiles',
  reveal: '{"type":"reveal","from":"?","to":"35","label":"2ND-HALF RUNS"}',
  compare: '{"type":"compare","from":{"value":"47%","label":"BEFORE"},"to":{"value":"57%","label":"AFTER"}}',
  tally: '{"type":"tally","n":4,"label":"TD PASSES"} n 1-40',
  calendar: '{"type":"calendar","month":"NOVEMBER","year":"1960","stamp":"LAST TIME"}',
  timeline: '{"type":"timeline","slots":[{"label":"2019","filled":true},{"label":"2020","filled":false}]} up to 12 slots',
  playDiagram: '{"type":"playDiagram","offense":[[0.5,0.6]],"defense":[[0.5,0.4]],"route":[[0.5,0.6],[0.7,0.3]],"label":"4TH & 1 · DROPBACK"} coordinates 0-1',
  flow: '{"type":"flow","nodes":[{"id":"a","text":"WAIVED","tone":"red"},{"id":"b","text":"CLAIMED","tone":"blue"}],"edges":[["a","b"]]} up to 6 nodes',
  checklist: '{"type":"checklist","rows":[{"rank":3,"text":"ACCURACY","checked":true}]} up to 5 rows',
  quote: '{"type":"quote","text":"exact words from SOURCES","who":"ANDY REID"}',
  lineChart: '{"type":"lineChart","points":[[1,90],[2,70],[3,40]],"label":"THE WORSE YOUR ODDS","stamp":"WORSE ODDS"} up to 12 points',
};
const MODULE_TYPES = Object.keys(MODULE_SPEC);

// Shape a module to exactly its fields. Returns null when it has no data.
function shapeModule(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const type = MODULE_TYPES.includes(m.type) ? m.type : '';
  if (!type) return null;
  if (type === 'scoreboard') {
    const rows = list(m.rows, 4).map(x => ({ team: up(x && x.team, 24), value: disp(x && x.value, 8), ...(x && x.logo && /^https:\/\//.test(String(x.logo)) ? { logo: String(x.logo).slice(0, 300) } : {}) })).filter(x => x.team && /\d/.test(x.value));
    return rows.length >= 2 ? { type, rows, ...(up(m.tag, 28) ? { tag: up(m.tag, 28) } : {}) } : null;
  }
  if (type === 'bars') {
    const rows = list(m.rows, 5).map(x => ({ label: up(x && x.label, 18), value: numOf(x && x.value), tone: tone(x && x.tone, 'blue') })).filter(x => x.label && Number.isFinite(x.value));
    if (rows.length < 2) return null;
    const out = { type, rows };
    if (up(m.title, 28)) out.title = up(m.title, 28);
    if (str(m.unit, 6)) out.unit = str(m.unit, 6);
    if (Number.isFinite(numOf(m.max)) && numOf(m.max) >= Math.max(...rows.map(r => r.value))) out.max = numOf(m.max);
    return out;
  }
  if (type === 'numberLine') {
    const min = numOf(m.min); const max = numOf(m.max);
    if (!(Number.isFinite(min) && Number.isFinite(max) && min < max)) return null;
    const marks = list(m.marks, 4).map(x => ({ label: up(x && x.label, 16), value: numOf(x && x.value), tone: tone(x && x.tone, 'blue') })).filter(x => x.label && Number.isFinite(x.value) && x.value >= min && x.value <= max);
    return marks.length ? { type, min, max, marks, ...(up(m.caption, 32) ? { caption: up(m.caption, 32) } : {}) } : null;
  }
  if (type === 'dotGrid') {
    const total = Math.round(numOf(m.total));
    if (!(total >= 2 && total <= 1200)) return null;
    let left = total;
    const groups = list(m.groups, 3).map((g, i) => {
      const n = Math.round(numOf(g && g.n));
      if (!(n >= 0) || n > left) return null;
      left -= n;
      return { n, tone: tone(g && g.tone, ['blue', 'ink', 'grey'][i], ['blue', 'ink', 'grey', 'red']), label: up(g && g.label, 20) };
    }).filter(Boolean);
    return groups.length ? { type, total, groups, ...(str(m.avatar, 60) ? { avatar: str(m.avatar, 60) } : {}) } : null;
  }
  if (type === 'scatter') {
    const h = m.highlight && typeof m.highlight === 'object' ? m.highlight : null;
    if (!h || !up(h.label, 16)) return null;
    const points = Array.isArray(m.points) ? m.points.slice(0, 300).map(p => (p && typeof p === 'object' && !Array.isArray(p) ? pt([p.x, p.y]) : pt(p))).filter(Boolean).map(([x, y]) => ({ x, y }))
      : Math.max(10, Math.min(1500, Math.round(numOf(m.points)) || 200));
    return { type, points, highlight: { label: up(h.label, 16), x: unit(h.x), y: unit(h.y) }, diagonal: m.diagonal === true, axes: { x: up(m.axes && m.axes.x, 18), y: up(m.axes && m.axes.y, 18) } };
  }
  if (type === 'wl') {
    const items = String(Array.isArray(m.items) ? m.items.join('') : m.items || '').toUpperCase().replace(/[^WLT]/g, '').slice(0, 20);
    return items ? { type, items, ...(up(m.title, 24) ? { title: up(m.title, 24) } : {}) } : null;
  }
  if (type === 'rankList') {
    const rows = list(m.rows, 5).map((x, i) => ({ rank: Math.max(1, Math.min(32, Math.round(numOf(x && x.rank)) || i + 1)), label: up(x && x.label, 20), value: disp(x && x.value, 12), ...(up(x && x.chip, 6) ? { chip: up(x.chip, 6) } : {}) })).filter(x => x.label);
    return rows.length >= 2 ? { type, title: up(m.title, 28), rows } : null;
  }
  if (type === 'statTiles') {
    const tiles = list(m.tiles, 3).map((t, i) => ({ value: disp(t && t.value, 8), label: up(t && t.label, 16), tone: tone(t && t.tone, i === 0 ? 'blue' : 'ink', ['blue', 'ink', 'red']) })).filter(t => /\d/.test(t.value));
    return tiles.length ? { type, tiles } : null;
  }
  if (type === 'reveal') {
    const to = disp(m.to, 10);
    return to ? { type, from: '?', to, label: up(m.label, 24) } : null;
  }
  if (type === 'compare') {
    const side = x => ({ value: disp(x && x.value, 10), label: up(x && x.label, 16) });
    const from = side(m.from); const to = side(m.to);
    return from.value && to.value ? { type, from, to } : null;
  }
  if (type === 'tally') { const n = Math.round(numOf(m.n)); return n >= 1 && n <= 40 ? { type, n, label: up(m.label, 24) } : null; }
  if (type === 'calendar') {
    const month = up(m.month, 10);
    const year = disp(m.year, 4); const day = disp(m.day, 2);
    return month && (/^\d{4}$/.test(year) || /^\d{1,2}$/.test(day)) ? { type, month, ...(/^\d{4}$/.test(year) ? { year } : { day }), ...(up(m.stamp, 18) ? { stamp: up(m.stamp, 18) } : {}) } : null;
  }
  if (type === 'timeline') {
    const slots = list(m.slots, 12).map(s => ({ label: up(s && s.label, 10), filled: Boolean(s && s.filled) })).filter(s => s.label);
    return slots.length >= 2 ? { type, slots } : null;
  }
  if (type === 'playDiagram') {
    const pts = (v, n) => list(v, n).map(pt).filter(Boolean);
    const offense = pts(m.offense, 11); const defense = pts(m.defense, 11); const route = pts(m.route, 8);
    return offense.length && route.length >= 2 ? { type, offense, defense, route, label: up(m.label, 28) } : null;
  }
  if (type === 'flow') {
    const nodes = list(m.nodes, 6).map((x, i) => ({ id: str(x && x.id, 8) || `n${i}`, text: up(x && x.text, 18), tone: tone(x && x.tone, 'ink', ['blue', 'red', 'ink']) })).filter(x => x.text);
    const ids = new Set(nodes.map(x => x.id));
    const edges = list(m.edges, 8).filter(e => Array.isArray(e) && ids.has(String(e[0])) && ids.has(String(e[1]))).map(e => [String(e[0]), String(e[1])]);
    return nodes.length >= 2 ? { type, nodes, edges } : null;
  }
  if (type === 'checklist') {
    const rows = list(m.rows, 5).map(x => ({ ...(Number.isFinite(numOf(x && x.rank)) ? { rank: Math.max(1, Math.min(9, Math.round(numOf(x.rank)))) } : {}), text: up(x && x.text, 24), checked: Boolean(x && x.checked) })).filter(x => x.text);
    return rows.length >= 2 ? { type, rows } : null;
  }
  if (type === 'quote') {
    const text = str(m.text, 140).replace(/^[“"]|[”"]$/g, '');
    return text ? { type, text, who: up(m.who, 28) } : null;
  }
  if (type === 'lineChart') {
    const points = list(m.points, 12).map(p => (Array.isArray(p) && p.length >= 2 && Number.isFinite(numOf(p[0])) && Number.isFinite(numOf(p[1])) ? [numOf(p[0]), numOf(p[1])] : null)).filter(Boolean);
    return points.length >= 2 ? { type, points, label: up(m.label, 28), ...(up(m.stamp, 18) ? { stamp: up(m.stamp, 18) } : {}) } : null;
  }
  return null;
}
// The fields of a module that state a claim (the number check walks these;
// coordinates, ranks, axis bounds and dot counts of a scatter are layout).
function moduleClaims(m) {
  if (!m) return [];
  const out = [];
  const t = m.type;
  if (t === 'scoreboard') { m.rows.forEach(r => out.push(r.team, r.value)); out.push(m.tag); }
  if (t === 'bars') { m.rows.forEach(r => out.push(r.label, String(r.value))); out.push(m.title); }
  if (t === 'numberLine') { m.marks.forEach(x => out.push(x.label, String(x.value))); out.push(m.caption); }
  if (t === 'dotGrid') { out.push(String(m.total)); m.groups.forEach(g => out.push(String(g.n), g.label)); }
  if (t === 'scatter') out.push(m.highlight.label, m.axes.x, m.axes.y);
  if (t === 'wl') out.push(m.title);
  if (t === 'rankList') { out.push(m.title); m.rows.forEach(r => out.push(r.label, r.value)); }
  if (t === 'statTiles') m.tiles.forEach(x => out.push(x.value, x.label));
  if (t === 'reveal') out.push(m.to, m.label);
  if (t === 'compare') out.push(m.from.value, m.from.label, m.to.value, m.to.label);
  if (t === 'tally') out.push(String(m.n), m.label);
  if (t === 'calendar') out.push(m.year, m.day, m.stamp);
  if (t === 'timeline') m.slots.forEach(s => out.push(s.label));
  if (t === 'playDiagram') out.push(m.label);
  if (t === 'flow') m.nodes.forEach(x => out.push(x.text));
  if (t === 'checklist') m.rows.forEach(x => out.push(x.text));
  if (t === 'quote') out.push(m.text, m.who);
  if (t === 'lineChart') { m.points.forEach(p => out.push(String(p[1]))); out.push(m.label, m.stamp); }
  return out.filter(v => v != null && v !== '');
}

// ─── Media, stamps, tags, headline, close ────────────────────────────────
const MEDIA_KINDS = ['clip', 'presser', 'photo', 'cards', 'cutout', 'none'];
function shapeMedia(raw, { read, team, vo }) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let kind = MEDIA_KINDS.includes(r.kind) ? r.kind : 'clip';
  const corpus = squash(read.corpus);
  const out = { kind };
  if (kind !== 'none') {
    out.subject = D().validSubject(r.subject, { text: plain(vo), vo: plain(vo) }, read, team);
    delete out.subject.key;
    if (up(r.label, 22)) out.label = up(r.label, 22);
  }
  if (kind === 'cards') {
    const cards = list(r.cards, 2).map(c => ({ name: str(c && c.name, 40), ...(up(c && c.tag, 14) ? { tag: up(c.tag, 14) } : {}), ...(up(c && c.sticker, 8) ? { sticker: up(c.sticker, 8) } : {}) })).filter(c => c.name && corpus.includes(squash(c.name)));
    if (cards.length) out.cards = cards; else { out.kind = 'photo'; }
  }
  return out;
}
const shapeStamp = raw => {
  const r = raw && typeof raw === 'object' ? raw : (typeof raw === 'string' ? { text: raw } : null);
  const text = r ? up(r.text, 24) : '';
  return text ? { text, tone: tone(r.tone, 'red', ['red', 'blue']), ...(['media', 'module'].includes(r.at) ? { at: r.at } : {}) } : null;
};
const shapeTag = raw => {
  const r = raw && typeof raw === 'object' ? raw : (typeof raw === 'string' ? { text: raw } : null);
  const text = r ? up(r.text, 28) : '';
  return text ? { text, tone: tone(r.tone, 'red', ['red', 'blue', 'ink']) } : null;
};
// One *marked* word per headline; with none, code marks a figure that is not
// a year, else the payoff word (the last key word). A headline never ends on
// a word that leads into the next ("…STILL HAS NO").
const YEAR = /^(?:19|20)\d\d$/;
const WEAK = new Set(['still', 'even', 'also', 'just', 'only', 'ever', 'never', 'again', 'more', 'most', 'much', 'many', 'every', 'there', 'here', 'they', 'them', 'some', 'same', 'does', 'did', 'done', 'gets', 'got', 'made', 'make', 'said', 'says']);
const bareLow = w => String(w || '').toLowerCase().replace(/^[^a-z0-9$#]+|[^a-z0-9%]+$/g, '');
const END_BAD = new Set(['he', 'she', 'it', 'they', 'we', 'i', 'you', 'whether', 'whose', 'not', 'no', 'also', 'still', 'just']);
const isDangle = w => ES().DANGLE.has(bareLow(plain(w))) || END_BAD.has(bareLow(plain(w)));
function trimDangleWords(list) {
  const out = list.slice();
  while (out.length > 1 && isDangle(out[out.length - 1])) out.pop();
  while (out.length > 1 && /^(?:and|but|so|then|or)$/.test(bareLow(plain(out[0])))) out.shift();
  return out;
}
function markIndex(w) {
  const fig = w.findIndex(x => /\d/.test(x) && !YEAR.test(bareLow(x)));
  if (fig >= 0) return fig;
  let best = -1;
  w.forEach((x, i) => { const b = bareLow(x); if (b.length >= 4 && !isDangle(x) && !WEAK.has(b) && !STOP.has(b)) best = i; });
  if (best >= 0) return best;
  return w.reduce((b, x, i) => (bareLow(x).length > bareLow(w[b]).length ? i : b), 0);
}
function shapeHeadline(raw, fallbackWords = '') {
  let text = up(raw, 60).replace(/\*{2,}/g, '*');
  if (isCreditText(plain(text))) text = '';
  if (!plain(text).trim()) text = up(fallbackWords, 60);
  if ((text.match(/\*/g) || []).length % 2) text = text.replace(/\*/g, '');
  text = trimDangleWords(words(text).map(x => x.replace(/[,;:]+$/, ''))).join(' ').replace(/[,;:.!?—–-]+$/, '');
  const marks = text.match(/\*[^*]+\*/g) || [];
  if (marks.length > 1) { let seen = false; text = text.replace(/\*([^*]+)\*/g, (all, inner) => { if (seen) return inner; seen = true; return all; }); }
  if (!marks.length) {
    const list = words(text);
    if (!list.length) return '';
    const at = markIndex(list);
    list[at] = `*${list[at].replace(/[.,!?:;]+$/, '')}*${(list[at].match(/[.,!?:;]+$/) || [''])[0]}`;
    text = list.join(' ');
  }
  return text.replace(/\*\s*\*/g, '').trim();
}
function shapeClose(raw, { team = '', sourceSet, question = '' } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const fans = team ? `${up(String(team).split(' ').pop(), 14)} FANS: YOUR CALL` : 'FANS: YOUR CALL';
  let prompt = up(r.prompt, 34) || fans;
  const opts = list(r.options, 2).map((o, i) => ({ text: up(o && (o.text || o), 22), tone: i === 0 ? 'red' : 'blue' })).filter(o => o.text);
  const options = opts.length === 2 ? opts : [{ text: 'AGREE', tone: 'red' }, { text: 'DISAGREE', tone: 'blue' }];
  let comment = up(r.comment, 64) || (question ? `COMMENT: ${up(question, 54)}` : 'COMMENT: WHO\'S RIGHT?');
  // Numbers on the close only when sourced.
  if (unsourced([prompt], sourceSet).length) prompt = fans;
  options.forEach(o => { if (unsourced([o.text], sourceSet).length) o.text = o.tone === 'red' ? 'AGREE' : 'DISAGREE'; });
  if (unsourced([comment], sourceSet).length) comment = 'COMMENT: WHO\'S RIGHT?';
  return { kind: 'yourCall', prompt, options, comment };
}
function markerFor(styleId, i, of, label = '') {
  const kind = (V4_STYLES[styleId] || V4_STYLES.breakdown).marker;
  if (i === 0) return undefined; // the hook chapter has no marker
  const n = i; const total = of - 1;
  if (kind === 'countdown') return { kind: 'countdown', n: total - n + 1, of: total };
  if (kind === 'progress') return { kind: 'progress', i: n, of: total };
  const name = up(label, 16).replace(/^\d+\s*·\s*/, '');
  return name ? `${n} · ${name}` : `${n}`;
}

// ─── Code-only path ($0): the script as v4 chapters ──────────────────────
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'to', 'and', 'for', 'with', 'at', 'by', 'as', 'is', 'was', 'are', 'were', 'that', 'than']);
// Words that never name a figure (pronouns, helpers, wh-words, modals).
const FUNCTION = new Set(['he', 'she', 'it', 'they', 'we', 'i', 'you', 'him', 'her', 'them', 'us', 'his', 'their', 'whether', 'will', 'would', 'not', 'no', 'yes', 'here', 'there', 'who', 'what', 'which', 'why', 'how', 'did', 'does', 'do', 'had', 'has', 'have', 'been', 'being', 'went', 'lost', 'won', 'got', 'had', 'each', 'every', 'such', 'those', 'these', 'this', 'that']);
const NOT_LABEL = new Set(['up', 'down', 'off', 'out', 'just', 'only', 'about', 'nearly', 'almost', 'over', 'under', 'more', 'less', 'still', 'even', 'also', 'then', 'now', 'all', 'straight', 'total', 'career', 'minus', 'plus']);
// A script's own chapter cues ("Chapter one: the run", "Number three: …").
const CUE = /^(?:chapter|part|number|no\.|reason)\s+(one|two|three|four|five|six|1|2|3|4|5|6)\s*[:.,–—-]\s*(.*)$/i;
const FIG = /^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:%|[KMB])?\+?$|^\d+-\d+(?:-\d+)?$/i;
const SEASON = /^(?:19|20)\d\d(?:-\d\d(?:\d\d)?)?$/;
const punctEnd = w => /[,;:.!?)”"']$/.test(w);
const bareFig = w => String(w || '').replace(/^[(“"'‘]+/, '').replace(/[,;:.!?)”"'’]+$/, '');
const labelWord = w => { const b = bareLow(w); return b && /^[a-z’'-]+$/.test(b) && !isDangle(b) && !STOP.has(b) && !NOT_LABEL.has(b) && !FUNCTION.has(b) && !/^(?:and|but|or|so|while|because|whether)$/.test(b); };
const verbish = w => /(?:ing|ed)$/i.test(bareLow(w));
const BREAK_BEFORE = /^(?:after|before|while|since|when|whose|who|which|whether|because|for|with|in|on|at|by|from|to|about|as|and|but|or|so|than|like|into|over|under|during|against)$/;
// The phrase cut to maxChars at a natural break (before a lead-in word or
// after punctuation), never ending on a lead-in word.
function fitPhrase(list, maxChars = 48) {
  const clean = list.map(x => x.replace(/[,;:]+$/, ''));
  if (clean.join(' ').length <= maxChars) return trimDangleWords(clean);
  let best = 0;
  for (let k = 2; k < list.length; k += 1) {
    if (clean.slice(0, k).join(' ').length > maxChars) break;
    if (BREAK_BEFORE.test(bareLow(list[k])) || punctEnd(list[k - 1])) best = k;
  }
  if (!best) { best = 1; while (best < clean.length && clean.slice(0, best + 1).join(' ').length <= maxChars) best += 1; }
  return trimDangleWords(clean.slice(0, best));
}
// A framing label at the start ("Press conference:", "Rumour:") becomes a tag.
function leadLabel(text) {
  const m = plain(text).match(/^([A-Z][A-Za-z’' -]{2,22}):\s+(\S.*)$/);
  return m && words(m[1]).length <= 2 ? { label: up(m[1], 20), rest: m[2] } : null;
}
// The chapter's headline in code: its strongest complete phrase (the v3
// engine's phraseFor: the whole sentence when it fits, else its best clause);
// the hook's is its first sentence (the claim), cut at a natural break.
function headlineFromWords(vo, maxWords = 9, { hook = false } = {}) {
  let text = plain(vo).replace(/[“”"]/g, '');
  const lead = leadLabel(text);
  if (lead) text = lead.rest;
  const cue = text.match(CUE);
  if (cue && words(cue[2]).length >= 2) text = cue[2];
  const sentences = text.split(/(?<=[.!?])\s+/).filter(x => !isCreditText(x));
  if (hook) return fitPhrase(words((sentences[0] || text).replace(/[.!?:]+$/, '')), 56).join(' ');
  const body = sentences.join(' ') || text;
  let list = [];
  try { list = ES().phraseFor(body, { maxWords, maxChars: 48 }); } catch { list = []; }
  if (!list.length) list = words(body);
  return fitPhrase(list, 48).join(' ').replace(/[,;:.!?—–]+$/, '');
}
// Figures in a beat's words, each with the noun phrase that names it:
// "45 touchdowns" -> 45 / TOUCHDOWNS, "a 122.5 passer rating" -> 122.5 /
// PASSER RATING, "a 15-1 record" -> 15-1 / RECORD, "win probability was 97%"
// -> 97% / WIN PROBABILITY, "11 under par" -> 11 / UNDER PAR, "minus nine
// yards" -> -9 / YARDS. Years and seasons are never stats; nor a chapter cue's
// number. A figure with no clean label is left out (no filler labels).
function figuresOf(vo) {
  const w = words(plain(vo).replace(/[“”"]/g, ''));
  const out = [];
  const skipNext = new Set();
  w.forEach((x, i) => {
    if (skipNext.has(i)) return;
    let value = bareFig(x);
    let spelled = false;
    if (!FIG.test(value)) {
      const sp = ES().spelledNumber ? ES().spelledNumber(x) : null;
      if (!sp || sp.ordinal) return;
      value = String(sp.value); spelled = true;
    }
    if (SEASON.test(value)) return;
    if (i > 0 && /^(?:chapter|part|number|no\.|reason)$/i.test(bareLow(w[i - 1]))) return;
    if (w[i + 1] && /^-/.test(w[i + 1])) return;
    if (/-(?:yard|point|game|man|year)/i.test(x)) return; // "59-yard": an adjective, said with its noun
    if (i > 0 && bareLow(w[i - 1]) === 'minus') value = `-${value}`;
    // A qualifier stays with its figure: "under 20 points" -> <20, "more than 4" -> >4.
    const q1 = bareLow(w[i - 1]); const q2 = `${bareLow(w[i - 2])} ${q1}`;
    if (!/^(?:under|over)$/.test(bareLow(w[i + 1]))) {
      if (q1 === 'under' || q2 === 'fewer than' || q2 === 'less than') value = `<${value}`;
      else if (q1 === 'over' || q2 === 'more than') value = `>${value}`;
    }
    // A share of a total: "7 of 10 games" -> 7/10 GAMES (the total is no tile of its own).
    if (/^of$/i.test(bareLow(w[i + 1])) && FIG.test(bareFig(w[i + 2] || '')) && !punctEnd(x)) { value = `${value}/${bareFig(w[i + 2])}`; skipNext.add(i + 2); x = w[i + 2]; i += 2; }
    if (skipNext.has(i) && !value.includes('/')) return;
    let j0 = i + 1;
    if (w[j0] && /^percent[,.;:!?]*$/i.test(w[j0])) { value = `${value}%`; j0 += 1; }
    const after = [];
    if (!punctEnd(x) && !(j0 > i + 1 && punctEnd(w[j0 - 1]))) {
      if (w[j0] && /^(?:under|over)$/i.test(w[j0]) && /^par\b/i.test(w[j0 + 1] || '')) { after.push(w[j0], 'par'); }
      else {
        for (let j = j0; j < w.length && after.length < 2; j += 1) {
          const y = w[j];
          if (!after.length && /^(?:straight|consecutive|such|more|total|career|other)$/i.test(bareLow(y)) && !punctEnd(y)) continue;
          if (FIG.test(bareFig(y)) || !labelWord(y)) break;
          after.push(bareFig(y));
          if (punctEnd(y)) break;
        }
      }
    }
    let label = after;
    let from = false;
    if (!label.length) {
      // The noun phrase before it ("win probability was 97%", "pass rate went
      // from 47"): skip helper words back, never across punctuation; no verbs.
      let j = i - 1;
      let skipped = 0;
      while (j >= 0 && skipped < 2 && !punctEnd(w[j]) && !labelWord(w[j]) && !FIG.test(bareFig(w[j]))) { if (/^from$/i.test(bareLow(w[j]))) from = true; j -= 1; skipped += 1; }
      if (j >= 0 && (punctEnd(w[j]) || !labelWord(w[j]))) j = -1; // never across a sentence or clause end
      const before = [];
      while (j >= 0 && before.length < 2 && labelWord(w[j]) && !verbish(w[j])) { before.unshift(bareFig(w[j])); if (j > 0 && punctEnd(w[j - 1])) break; j -= 1; }
      label = before;
    }
    const text = up(label.join(' '), 16);
    const fromTo = i > 0 && /^from$/i.test(bareLow(w[i - 1]));
    if (!label.length || words(text).length !== label.length) { if (!fromTo && !(i > 1 && /^to$/i.test(bareLow(w[i - 1])))) return; }
    const kind = /%$/.test(value) ? 'pct' : /^\d+-\d+/.test(value) ? 'record' : /\.\d/.test(value) ? 'rate' : 'count';
    out.push({ value: value.toUpperCase(), label: label.length ? text : '', kind, index: i, spelled, from: fromTo || from, to: i > 0 && /^to$/i.test(bareLow(w[i - 1])) });
  });
  // "from 13 wins to 20": the second figure takes the first one's label.
  out.forEach((f, k) => { if (!f.label && f.to && out[k - 1] && out[k - 1].label) f.label = out[k - 1].label; });
  return out.filter(f => f.label);
}
// The module a beat's claim needs (code): a change ("from 47 to 57 percent",
// "from 13 wins to 20") or two percentages -> compare; otherwise up to 3 stat
// tiles, the strongest (a record, a rate, the first count), in spoken order.
function moduleFor(vo, set) {
  const figs = figuresOf(vo).filter(f => f.spelled || !unsourced([f.value.replace(/^[-<>]/, '')], set).length);
  if (!figs.length) return null;
  const k = figs.findIndex((f, i) => f.to && i > 0);
  if (k > 0) {
    const a = figs[k - 1]; const b = figs[k];
    const unit = /%$/.test(b.value) && !/%$/.test(a.value) ? '%' : '';
    return { type: 'compare', from: { value: `${a.value}${unit}`, label: a.label }, to: { value: b.value, label: b.label } };
  }
  const pcts = figs.filter(f => f.kind === 'pct');
  if (pcts.length >= 2) return { type: 'compare', from: { value: pcts[0].value, label: pcts[0].label }, to: { value: pcts[1].value, label: pcts[1].label } };
  const score = (f, i) => (f.kind === 'record' ? 3 : 0) + (f.kind === 'rate' || f.kind === 'pct' ? 2 : 0) + (i === 0 ? 1.5 : 1);
  const best = figs.map((f, i) => ({ f, s: score(f, i), i })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i).map(x => x.f);
  return { type: 'statTiles', tiles: best.map((f, i) => ({ value: f.value, label: f.label, tone: i === 0 ? 'blue' : 'ink' })) };
}
// The close, from the script's own argument (code only, no new facts):
// "Cowboys fans, your call" -> the prompt; the hook's claim from its key word
// ("still has no twin") -> option one, against "NOT BUYING IT".
const CLAIM_KEY = /^(?:still|no|never|nobody|only|most|best|worst|first|last|longest|shortest|biggest|record|every|again)$/i;
function claimOption(hook) {
  const w = words(plain(hook).replace(/[“”"]/g, '').replace(/[.!?:;,]+$/, ''));
  const at = w.findIndex(x => CLAIM_KEY.test(bareLow(x)));
  if (at < 0) return 'AGREE';
  const list = fitPhrase(w.slice(at), 22);
  const out = up(list.join(' '), 22);
  return words(out).length >= 2 && out.length <= 22 && !/\d/.test(out) && !isDangle(list[list.length - 1]) ? out : 'AGREE';
}
function fansPrompt(text) {
  const m = plain(text).match(/\b((?:[A-Z][A-Za-z.'’-]+\s){0,2}[A-Z][A-Za-z.'’-]+)\s+fans,?\s+(?:it'?s\s+)?your\s+call\b/);
  return m ? up(`${m[1]} FANS: YOUR CALL`, 34) : '';
}
// The longest run of capitalised words (a name), possessives dropped.
function properName(text) {
  // A spoken credit ("Source: Pro Football Reference") names no subject.
  const w = words(plain(text).replace(/\b(?:sources?|credits?|data|photos?|via)\s*:.*$/i, '').replace(/[“”"()]/g, ' '));
  const capWord = y => { const b = String(y || '').replace(/[,.!?;:]+$/, '').replace(/[’']s?$/, ''); return /^[A-Z][A-Za-z’'.-]+$/.test(b) && /[a-z]/.test(b); };
  let best = [];
  let run = [];
  const close = () => { if (run.length > best.length) best = run; run = []; };
  w.forEach((x, i) => {
    const bare = x.replace(/[,.!?;:]+$/, '').replace(/[’']s?$/, '');
    const sentenceStart = i === 0 || /[.!?:]$/.test(w[i - 1]);
    // A sentence's first word counts when a capitalised word follows ("Aaron Rodgers'"), never "The".
    const cap = capWord(x) && (!sentenceStart || capWord(w[i + 1])) && !(run.length === 0 && /^(?:the|a|an|number|chapter|part|rumour|rumor|press)$/i.test(bare));
    if (cap) run.push(bare); else close();
    if (cap && /[,.!?;:]$/.test(x)) close();
  });
  close();
  return best.length >= 2 ? best.join(' ') : '';
}
function scriptToV4(script, { esStyle = 'breakdown', length = 'full', read = null, team = null, title = '', sport = '', speakSources = false } = {}) {
  const styleId = v4StyleOf(esStyle);
  const L = lengthOf(length);
  const cut = splitCredits(script);
  const text = speakSources ? normScript(String(script || '').replace(URL_RE, ' ')) : cut.spoken;
  // One beat per sentence (a long one split at a clause), so the page's
  // per-scene voice and media flows line up with the script's sentences.
  const segs = segmentScript(text, { mergeTiny: false });
  const r = read || { corpus: text, sport, team };
  let teamName = (team && team.name) || (r.team && r.team.name) || '';
  // No team from the brief: a team nickname in the words ("Jets") names it.
  if (!teamName) {
    for (const x of words(plain(text))) {
      const b = x.replace(/[^A-Za-z]/g, '');
      if (!/^[A-Z][a-z]{2,}s$/.test(b)) continue;
      const hit = D().teamInfo(b, r.sport || sport);
      if (hit && hit.name && hit.name.toLowerCase().endsWith(` ${b.toLowerCase()}`)) { teamName = hit.name; team = team || hit; break; }
    }
  }
  const set = sourceNumbers(r.corpus || text);
  const reelSubject = properName(text) || teamName;
  const hookMoment = headlineFromWords(segs[0] || '', 6, { hook: true });
  // The script's own chapter cues ("Chapter one: the run") decide the
  // chapters when there are two or more; else the hook is the first sentence
  // alone and the rest split evenly.
  const cues = segs.map((s, i) => (CUE.test(plain(s)) ? i : -1)).filter(i => i > 0);
  let chapterGroups;
  if (cues.length >= 2) {
    const starts = [0, ...cues];
    chapterGroups = starts.map((st, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : segs.length;
      const idx = Array.from({ length: end - st }, (_, j) => st + j);
      return idx.map(i => [i]);
    });
  } else {
    const groups = segs.map((_, i) => [i]);
    const rest = groups.slice(1);
    const nCh = Math.max(1, Math.min(L.chapters[1], Math.max(L.chapters[0] - 1, Math.ceil(rest.length / L.beatsPerChapter[1]))));
    const perCh = Math.ceil(rest.length / nCh) || 1;
    chapterGroups = [groups.slice(0, 1)];
    for (let i = 0; i < rest.length; i += perCh) chapterGroups.push(rest.slice(i, i + perCh));
    // A closing line alone in its chapter rides with the chapter before.
    if (chapterGroups.length > 2 && chapterGroups[chapterGroups.length - 1].length === 1) chapterGroups[chapterGroups.length - 2].push(...chapterGroups.pop());
  }
  let bn = 0;
  chapterGroups = chapterGroups.filter(g => g.length);
  const of = chapterGroups.length;
  const chapters = chapterGroups.map((g, ci) => {
    const allVo = g.map(idx => idx.map(i => segs[i]).join(' ')).join(' ');
    const cue = plain(segs[g[0][0]]).match(CUE);
    let phrase = headlineFromWords(allVo, ci === 0 ? 9 : 7, { hook: ci === 0 });
    const beats = g.map((idx, bi) => {
      bn += 1;
      const vo = idx.map(i => segs[i]).join(' ');
      const beat = { id: `b${bn}`, vo };
      let mod = shapeModule(moduleFor(vo, set));
      if (mod && unsourced(moduleClaims(mod), set).length) mod = null;
      if (mod) beat.module = mod;
      const lead = bi === 0 ? leadLabel(vo) : null;
      if (lead) beat.tag = { text: lead.label, tone: /rumou?r|unconfirmed|report/i.test(lead.label) ? 'red' : 'ink' };
      const name = properName(vo);
      const subjectRaw = name ? { type: 'player', name } : (reelSubject ? { type: reelSubject === teamName ? 'team' : 'player', name: reelSubject, team: teamName } : { type: 'moment', name: hookMoment, team: teamName });
      // A data beat keeps the subject on screen (a verified photo, Ken Burns)
      // beside its module; with no subject the module carries it alone.
      let kind = beat.module ? (name ? 'clip' : (reelSubject ? 'photo' : 'none')) : 'clip';
      if (lead && /press|presser|interview|media day/i.test(lead.label)) kind = 'presser';
      beat.media = shapeMedia({ kind, subject: subjectRaw }, { read: r, team: teamName, vo });
      // The window's label tag names who is on screen (never the vo's first words).
      const who = beat.media.subject && ['player', 'team'].includes(beat.media.subject.type) ? beat.media.subject.name : '';
      if (who && beat.media.kind !== 'none' && !beat.media.label) beat.media.label = up(who, 22);
      return beat;
    });
    // A headline that only repeats the chapter's own tiles says nothing new:
    // the reel's subject "IN NUMBERS" instead (a summary, no new facts).
    const shown = new Set(beats.flatMap(b => (b.module ? moduleClaims(b.module) : [])).flatMap(f => F.numbersIn(f)));
    const said = F.numbersIn(phrase);
    if (ci > 0 && said.length && said.every(n => shown.has(n))) phrase = reelSubject ? `${String(reelSubject).split(' ').pop()} IN NUMBERS` : 'THE NUMBERS';
    else {
      // A tile the headline already shows is not said twice; a beat left
      // with no module and no media asks for a clip (ensureMotion).
      const inHead = sourceNumbers(phrase);
      beats.forEach(b => {
        if (!b.module || b.module.type !== 'statTiles') return;
        const tiles = b.module.tiles.filter(t => !F.numbersIn(t.value).every(n => inHead.has(n)));
        if (tiles.length) b.module = { ...b.module, tiles: tiles.map((t, k) => ({ ...t, tone: k === 0 ? 'blue' : 'ink' })) };
        else { delete b.module; if (b.media.kind === 'none' || b.media.kind === 'photo') b.media = { ...b.media, kind: 'clip' }; }
      });
    }
    const ch = { id: `c${ci + 1}`, headline: shapeHeadline('', phrase), tone: 'blue', beats };
    const mk = of <= 2 && !cue && V4_STYLES[styleId].marker === 'numbered' ? undefined : markerFor(styleId, ci, of, cue ? words(cue[2]).slice(0, 2).join(' ').replace(/[,.;:]+$/, '') : '');
    if (mk !== undefined) ch.marker = mk;
    return ch;
  });
  const last = segs[segs.length - 1] || '';
  const prompt = fansPrompt(text);
  const question = /\?["”’]*$/.test(last) ? plain(last) : '';
  const optionA = claimOption(segs[0] || '');
  const plan = {
    v: 4, style: 'es', esStyle: styleId, skin: V4_STYLES[styleId].skin, length: L.id,
    title: str(title, 120) || plain(headlineFromWords(segs[0] || '', 9, { hook: true })),
    sport: sport || r.sport || '', team: team || r.team || null,
    chapters,
    close: shapeClose({ prompt: prompt || (teamName ? '' : 'YOUR CALL'), options: optionA === 'AGREE' ? ['AGREE', 'DISAGREE'] : [optionA, 'NOT BUYING IT'], comment: question ? '' : 'COMMENT: AGREE OR NOT?' }, { team: teamName, sourceSet: set, question }),
    script: { text, locked: true, ...(cut.credits.length ? { credits: cut.credits } : {}), ...(cut.links.length ? { links: cut.links } : {}) },
    pacing: pacingOf(text, L.id),
  };
  if (cut.credits.length) plan.sourceLine = sourceLineOf(cut.credits);
  ensureMotion(plan, []);
  return plan;
}

// Motion rule: every beat moves (media that is not 'none', or a module), and
// a reel asks for at least one clip or press conference.
function ensureMotion(plan, issues) {
  const all = plan.chapters.flatMap(c => c.beats);
  all.forEach(b => {
    if ((!b.media || b.media.kind === 'none') && !b.module) {
      b.media = { kind: 'clip', subject: (b.media && b.media.subject) || subjectFor(plan, b) };
      issues.push(`Beat ${b.id} had nothing moving, so it asks for a clip.`);
    }
  });
  if (all.length && !all.some(b => b.media && ['clip', 'presser'].includes(b.media.kind))) {
    const b = all.find(x => x.media && x.media.kind !== 'none') || all[0];
    b.media = { ...(b.media || {}), kind: 'clip', subject: (b.media && b.media.subject) || subjectFor(plan, b) };
    issues.push('A reel needs at least one clip, so the hook asks for one.');
  }
}
function subjectFor(plan, beat) {
  const s = CLIPS.subjectOfBeat({ text: plain(beat.vo), subject: null }, { team: plan.team, title: plan.title });
  delete s.key;
  return s;
}

// ─── Reference reels: structure-only few-shot ────────────────────────────
// QA writes scripts/fixtures/reels4/reference-plans.json; only the SHAPE of
// each plan reaches the prompt (media kinds, module types, stamps, markers),
// never its words. These built-in shapes stand in until that file exists.
const BUILTIN_SHAPES = [
  { name: 'Rams "1 in 100 teams"', esStyle: 'outlier', chapters: [['clip+scatter'], ['cards+tag', 'clip+bars'], ['clip+reveal+tag', 'none+scoreboard'], ['photo+compare+stamp']], close: 'yourCall' },
  { name: 'Dallas "blew a 21-point lead"', esStyle: 'breakdown', chapters: [['clip+scoreboard+tag'], ['clip+statTiles+stamp', 'clip+numberLine'], ['clip+playDiagram+stamp', 'clip+compare'], ['clip+reveal', 'none+rankList+stamp']], close: 'yourCall' },
  { name: 'Kittle "shouldn\'t be this good"', esStyle: 'outlier', chapters: [['clip+quote'], ['none+dotGrid', 'none+lineChart+stamp'], ['photo+statTiles+tag', 'clip+bars+stamp'], ['clip+wl', 'none+dotGrid+stamp']], close: 'yourCall' },
  { name: 'Rodgers "who should call"', esStyle: 'casefile', chapters: [['cutout+quote'], ['cards+statTiles+stamp'], ['photo+tally', 'cutout+rankList'], ['none+flow', 'none+checklist']], close: 'yourCall' },
  { name: 'Chiefs "shortest throw"', esStyle: 'casefile', chapters: [['clip+rankList'], ['cutout+playDiagram'], ['clip+calendar+stamp', 'none+dotGrid'], ['photo+checklist']], close: 'yourCall' },
  { name: 'Ravens "the perfect cover"', esStyle: 'hotseat', chapters: [['presser+tag'], ['presser+stamp', 'none+timeline'], ['clip+statTiles', 'presser+stamp'], ['clip+compare']], close: 'yourCall' },
];
let referencePlans = null;
function setReferencePlans(plans) { referencePlans = plans; cachedSystem = null; }
function loadReferencePlans() {
  if (referencePlans) return referencePlans;
  try {
    const file = path.join(__dirname, '../../scripts/fixtures/reels4/reference-plans.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    referencePlans = Array.isArray(data) ? data : (Array.isArray(data.plans) ? data.plans : Object.values(data || {}));
  } catch { referencePlans = []; }
  return referencePlans;
}
// A plan v4 -> its shape: no words survive (structure only).
function structureOf(plan) {
  const p = plan && typeof plan === 'object' ? (plan.plan && plan.plan.chapters ? plan.plan : plan) : {};
  const chapters = list(p.chapters, 6).map(c => list(c && c.beats, 5).map(b => [
    b && b.media && MEDIA_KINDS.includes(b.media.kind) ? b.media.kind : 'none',
    b && b.module && MODULE_TYPES.includes(b.module.type) ? b.module.type : '',
    b && b.stamp ? 'stamp' : '', b && b.tag ? 'tag' : '',
  ].filter(Boolean).join('+')));
  return { name: str(p.name || p.id || '', 40).replace(/[^A-Za-z0-9 "'-]/g, '') || 'reference', esStyle: v4StyleOf(p.esStyle), chapters, close: p.close && p.close.kind === 'endcard' ? 'endcard' : 'yourCall' };
}
function referenceShapes() {
  const fromQa = loadReferencePlans().map(structureOf).filter(s => s.chapters.length >= 2);
  return fromQa.length ? fromQa : BUILTIN_SHAPES;
}
const shapeLine = s => `- ${s.esStyle}: ${s.chapters.map((c, i) => `ch${i}[${c.join(', ')}]`).join(' ')} close:${s.close}`;

// ─── Prompt ──────────────────────────────────────────────────────────────
let cachedSystem = null;
function v4System() {
  if (cachedSystem) return cachedSystem;
  cachedSystem = [
    'You are the EssentiallySports (ES) reels director for 9:16 "breakdown" reels (Instagram Reels, TikTok, Shorts). The editor has written the voiceover SCRIPT. You never write, rewrite, shorten or reorder the script: it is read word for word.',
    'The script is given as numbered SEGMENTS (s0, s1, ...). Your job is everything the viewer SEES:',
    '- cut the script into chapters and beats: each beat starts at a segment ("start": index); beats run in order and together cover every segment;',
    '- a headline per chapter: 2-7 words, an excerpt of or a tight summary of that chapter\'s words, in CAPS, with exactly ONE word wrapped in *asterisks* (it is coloured);',
    '- per beat, the media: kind clip (game footage), presser (press conference / interview), photo, cards (two photo name cards), cutout (a cut-out player), or none (the module carries the beat), and the subject it must show;',
    '- per beat, at most one data module that proves the beat\'s claim; numbers only from the SCRIPT or SOURCES;',
    '- stamps (rotated rubber stamps for punchlines, 1-3 words) and tags (event tags, "59-YD FG · 0:02 LEFT");',
    '- the close: "TEAM FANS: YOUR CALL" with two options drawn from the script\'s argument (red first, blue second) and a comment prompt.',
    '',
    'Return JSON only:',
    '{"title":"...","team":"team name or empty","chapters":[{"label":"THE RUN","headline":"DALLAS BLEW A *21-POINT* LEAD","tone":"blue|red","beats":[{"start":0,"media":{"kind":"clip","subject":{"type":"player|team|moment|game","name":"Dak Prescott","team":"Dallas Cowboys","date":"","moment":"the 4th-down sack"},"label":"COWBOYS BALL","cards":[{"name":"","tag":"","sticker":"OUT"}]},"module":{...},"stamp":{"text":"BAD CALL","tone":"red","at":"media|module"},"tag":{"text":"...","tone":"red|blue|ink"}}]}],"close":{"prompt":"COWBOYS FANS: YOUR CALL","options":[{"text":"FIRE HIM"},{"text":"ONE MORE YEAR"}],"comment":"COMMENT: WHO\'S TO BLAME?"},"scriptNotes":["optional: a script edit you would suggest; never applied"]}',
    '',
    'Modules (exact fields; omit "module" when no module fits):',
    ...Object.values(MODULE_SPEC).map(s => `- ${s}`),
    '',
    'Rules:',
    '1. Facts: every number on screen (modules, headlines, stamps, tags, labels, the close) must appear in the SCRIPT or SOURCES. Never invent, round or estimate. Quotes only word for word from SOURCES or the SCRIPT.',
    '2. One idea per chapter. The first chapter is the hook: one beat, the claim or the contradiction; it has no label. Later chapters get a 1-2 word label (THE RUN, THE THROW, THE CHOICE).',
    '3. Media matches the words: the subject is the person, team or moment the beat\'s words are about, named exactly as in the script or sources. At least one beat is a clip or presser. A beat with media "none" must have a module.',
    '4. Modules build within a chapter: reuse the same module type across a chapter\'s beats where the data continues (a bar grows, a dot slides, "?" flips).',
    '5. Colour: blue = neutral or good, red = bad. Never yellow. At most one stamp per chapter.',
    '6. ES voice on screen: punchy, plain, no emojis, hashtags, links, "Breaking" or hype words.',
    '',
    'STYLES:',
    ...V4_IDS.map(id => `- ${id} (${V4_STYLES[id].label}, ${V4_STYLES[id].skin}): ${V4_STYLES[id].brief} Favoured modules: ${V4_STYLES[id].prefer.join(', ')}.`),
    '',
    'REFERENCE SHAPES (structure of reels the ES team posted; media+module+stamp/tag per beat; copy the rhythm, never the topic or words):',
    ...referenceShapes().map(shapeLine),
  ].join('\n');
  return cachedSystem;
}
function lessonsLines(lessons) {
  const items = list(lessons, 6).map(l => str(l && (l.lesson || l.text || l), 180)).filter(Boolean);
  return items.length ? ['HOUSE LESSONS (learned from what ES editors kept and changed; follow them):', ...items.map(l => `- ${l}`)].join('\n') : '';
}
function directorRequestV4({ segs, read, styleId, length, steer = '', lessons = [], current = null }) {
  const L = lengthOf(length);
  const pace = pacingOf(segs.join(' '), L.id);
  return [
    `STYLE: ${styleId} (${V4_STYLES[styleId].label})`,
    `LENGTH: ${L.label}, about ${L.sec} s. Use ${L.chapters[0]}-${L.chapters[1]} chapters after the hook, ${L.beatsPerChapter[0]}-${L.beatsPerChapter[1]} beats each. The script is ${pace.words} words (~${pace.estSec} s at ${WPM} wpm).`,
    read.team ? `TEAM: ${read.team.name}` : '',
    steer ? `EDITOR NOTE: ${str(steer, 400)}` : '',
    lessonsLines(lessons),
    current ? `CURRENT PLAN (keep what works, change what the note asks):\n${JSON.stringify(current).slice(0, 5000)}` : '',
    'SCRIPT SEGMENTS (read word for word; you only choose where beats start):',
    ...segs.map((s, i) => `s${i}: ${s}`),
    'SOURCES (facts you may put on screen, besides the script):',
    '<<<', str(read.sources || '', 6000) || '(none)', '>>>',
  ].filter(Boolean).join('\n');
}

// ─── Validation ──────────────────────────────────────────────────────────
function extractJson(text) { return D()._test.extractJson(text); }
function validateV4(parsed, { script, read, esStyle = 'breakdown', length = 'full' } = {}) {
  const styleId = v4StyleOf(esStyle);
  const L = lengthOf(length);
  const text = normScript(script);
  const segs = segmentScript(text);
  const issues = [];
  let dropped = 0;
  const set = sourceNumbers(read.corpus);
  const corpusSq = squash(read.corpus);
  const teamName = str(parsed && parsed.team, 80) || (read.team && read.team.name) || '';
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  // 1. Flatten the model's beats, keeping their chapter, then repair the
  // starts: strictly increasing, the first at 0. The vo is rebuilt from the
  // script, so it is the script word for word whatever the model said.
  const flat = [];
  list(p.chapters, 8).forEach((c, ci) => list(c && c.beats, 6).forEach(b => flat.push({ ci, c, b, start: Math.round(Number(b && b.start)) })));
  const kept = [];
  flat.forEach(x => {
    if (!Number.isFinite(x.start) || x.start < 0 || x.start >= segs.length) { dropped += 1; return; }
    const prev = kept[kept.length - 1];
    if (prev && x.start <= prev.start) { dropped += 1; issues.push(`A beat starting at s${x.start} overlapped the one before, so it was merged.`); return; }
    kept.push(x);
  });
  if (!kept.length || kept[0].start !== 0) {
    if (kept.length) kept[0].start = 0; else issues.push('The model\'s beats did not fit the script.');
  }
  const chaptersOut = [];
  let bn = 0;
  let modules = 0;
  kept.forEach((x, k) => {
    const end = k + 1 < kept.length ? kept[k + 1].start : segs.length;
    const vo = segs.slice(x.start, end).join(' ');
    bn += 1;
    const beat = { id: `b${bn}`, vo };
    const b = x.b || {};
    let mod = shapeModule(b.module);
    if (b.module && b.module.type && !mod) { issues.push(`A ${str(b.module.type, 16)} module without its data was dropped.`); dropped += 1; }
    if (mod) {
      const bad = unsourced(moduleClaims(mod), set);
      if (bad.length) { issues.push(`A ${mod.type} with ${bad.join(', ')} (not in the script or sources) was dropped.`); dropped += 1; mod = null; }
      else if (mod.type === 'quote' && !corpusSq.includes(squash(mod.text))) { issues.push('A quote that is not word for word in the sources was dropped.'); dropped += 1; mod = null; }
      else if (mod.type === 'dotGrid' && mod.avatar && !corpusSq.includes(squash(mod.avatar))) delete mod.avatar;
    }
    if (mod) { beat.module = mod; modules += 1; }
    beat.media = shapeMedia(b.media, { read, team: teamName, vo });
    if (beat.media.kind === 'none' && !beat.module) beat.media.kind = 'clip';
    if (beat.media.label && unsourced([beat.media.label], set).length) delete beat.media.label;
    const stamp = shapeStamp(b.stamp);
    if (stamp && !unsourced([stamp.text], set).length) beat.stamp = stamp;
    const tag = shapeTag(b.tag);
    if (tag && !unsourced([tag.text], set).length) beat.tag = tag;
    // Chapter: a new one when the model's chapter changes (the hook always alone first).
    const last = chaptersOut[chaptersOut.length - 1];
    if (!last || last.src !== x.ci) {
      chaptersOut.push({ src: x.ci, raw: x.c || {}, beats: [beat] });
    } else last.beats.push(beat);
  });
  // A beat that runs long (> 45 words) splits at a segment so the picture keeps moving.
  chaptersOut.forEach(ch => {
    const out = [];
    ch.beats.forEach(b => {
      const parts = segmentScript(b.vo);
      if (words(b.vo).length <= 45 || parts.length < 2) { out.push(b); return; }
      const half = Math.ceil(parts.length / 2);
      out.push({ ...b, vo: parts.slice(0, half).join(' ') });
      out.push({ id: `${b.id}x`, vo: parts.slice(half).join(' '), media: { ...b.media } });
    });
    ch.beats = out;
  });
  // Too many chapters for the length: the extras join their neighbour.
  const maxCh = L.chapters[1] + 1;
  while (chaptersOut.length > maxCh) {
    const a = chaptersOut.pop();
    chaptersOut[chaptersOut.length - 1].beats.push(...a.beats);
    issues.push('Merged a chapter to fit the length.');
  }
  // Ids in order; at most one stamp per chapter.
  let id = 0;
  chaptersOut.forEach(ch => { let stamped = false; ch.beats.forEach(b => { id += 1; b.id = `b${id}`; if (b.stamp) { if (stamped) delete b.stamp; stamped = true; } }); });
  const of = chaptersOut.length;
  const chapters = chaptersOut.map((ch, ci) => {
    const allVo = ch.beats.map(b => b.vo).join(' ');
    let headline = shapeHeadline(ch.raw.headline, headlineFromWords(allVo, ci === 0 ? 7 : 5));
    if (unsourced([headline], set).length) { issues.push(`Chapter ${ci + 1}'s headline had a number not in the script or sources, so it was rebuilt from the words.`); headline = shapeHeadline('', headlineFromWords(allVo, 5)); }
    if (RULES.BANNED.some(rule => rule.re.test(plain(headline)))) { issues.push(`Chapter ${ci + 1}'s headline used banned wording.`); headline = shapeHeadline('', headlineFromWords(allVo, 5)); }
    const out = { id: `c${ci + 1}`, headline, tone: ch.raw.tone === 'red' ? 'red' : 'blue', beats: ch.beats };
    const mk = markerFor(styleId, ci, of, ch.raw.label);
    if (mk !== undefined) out.marker = mk;
    return out;
  });
  const lastSeg = segs[segs.length - 1] || '';
  const team = (teamName && D().teamInfo(teamName, read.sport)) || read.team || null;
  const plan = {
    v: 4, style: 'es', esStyle: styleId, skin: V4_STYLES[styleId].skin, length: L.id,
    title: str(p.title, 120) || plain(chapters[0] ? chapters[0].headline : ''),
    sport: read.sport || '', team, chapters,
    close: shapeClose(p.close, { team: team ? team.name : '', sourceSet: set, question: /\?["”’]*$/.test(lastSeg) ? plain(lastSeg) : '' }),
    script: { text, locked: true },
    pacing: pacingOf(text, L.id),
  };
  if (unsourced([plan.title], set).length) plan.title = plain(chapters[0] ? chapters[0].headline : '');
  ensureMotion(plan, issues);
  const scriptNotes = list(p.scriptNotes, 4).map(n => str(n, 200)).filter(Boolean);
  // Weak: the model's structure did not hold, so Sonnet is asked (tier allowing).
  const nBeats = plan.chapters.reduce((n, c) => n + c.beats.length, 0);
  let weak = false;
  if (!kept.length || plan.chapters.length < Math.min(2, segs.length)) weak = true;
  if (modules === 0 && nBeats >= 3) { weak = true; issues.push('No chapter had a data module.'); }
  if (dropped >= 3) weak = true;
  if (styleId === 'outlier' && !plan.chapters.some(c => c.beats.some(b => b.module && ['dotGrid', 'scatter'].includes(b.module.type)))) issues.push('The Outlier works best with a dot grid or a scatter.');
  if (plan.pacing.fit !== 'ok') issues.push(`Your script reads in about ${plan.pacing.estSec} s; ${L.label} is ${L.range[0]}-${L.range[1]} s.`);
  return { plan, issues, dropped, weak, scriptNotes };
}
// Assert: the beats read the script word for word, in order.
function voMatchesScript(plan) {
  const want = plan && plan.script && plan.script.text;
  if (!want) return true;
  const got = (plan.chapters || []).flatMap(c => c.beats || []).map(b => String(b.vo || '').trim()).filter(Boolean).join(' ');
  return normScript(got) === normScript(want);
}
// The flat beats a v3 consumer (lint, captions) can read.
function flattenV4(plan) {
  const beats = (plan.chapters || []).flatMap(c => c.beats.map((b, i) => ({ id: b.id, kind: i === 0 && c === plan.chapters[0] ? 'hook' : 'point', text: plain(c.headline), vo: b.vo, emphasis: '', photo: b.media && b.media.subject ? b.media.subject.name : '' })));
  return { ...plan, chapters: undefined, beats: [...beats, { id: 'end', kind: 'cta', text: plan.close ? plan.close.prompt : '', vo: '', emphasis: '', photo: '' }] };
}

// ─── Director ────────────────────────────────────────────────────────────
// sources: topic / trend / links text; facts: the capped fact check.
function readV4({ script, topic = '', trend = null, facts = '', sport = '' }) {
  const read = D().readReelBrief({ brief: [normScript(script), str(topic, 1200)].filter(Boolean).join('\n'), trend, facts, sport });
  read.sources = [str(topic, 1200), trend ? [trend.title, ...(trend.related || []).map(r => r.title), trend.why].filter(Boolean).join('\n') : '', str(facts, 4000)].filter(Boolean).join('\n');
  return read;
}
async function runDirectorV4({ script = '', topic = '', trend = null, facts = '', sport = '', esStyle = 'breakdown', length = 'full', tier = 'standard', steer = '', lessons = [], current = null, track = null, speakSources = false, timeoutMs = 24000, startedAt = Date.now(), budgetMs = 50000, now = () => Date.now() } = {}) {
  // Credits ("Source: …", "Via …", URLs) are not spoken: they become the source line.
  const cut = splitCredits(script);
  const text = speakSources ? normScript(String(script || '').replace(URL_RE, ' ')) : cut.spoken;
  const credit = plan => {
    if (cut.credits.length) { plan.sourceLine = sourceLineOf(cut.credits); plan.script.credits = cut.credits; }
    if (cut.links.length) plan.script.links = cut.links;
    return plan;
  };
  topic = [str(topic, 2400), cut.credits.length ? `Source: ${cut.credits.join('; ')}` : ''].filter(Boolean).join('\n');
  const styleId = v4StyleOf(esStyle);
  const L = lengthOf(length);
  const read = readV4({ script: text, topic, trend, facts, sport });
  const segs = segmentScript(text);
  const result = { plan: null, read, model: '', cost: 0, source: 'code', issues: [], escalated: false, scriptNotes: [] };
  const code = () => scriptToV4(script, { esStyle: styleId, length: L.id, read, team: read.team, title: trend ? trend.title : '', sport: read.sport, speakSources });
  let api;
  try { api = gateway(); } catch { api = null; }
  if (!api || !api.gatewayConfigured() || segs.length < 2) return { ...result, plan: code(), reason: segs.length < 2 ? 'short' : 'off' };
  const ask = askTier => api.aiText({
    tier: askTier, system: v4System(), cacheSystem: true, json: true,
    messages: [{ role: 'user', content: directorRequestV4({ segs, read, styleId, length: L.id, steer, lessons, current }) }],
    effort: 'low', maxTokens: 4200, timeoutMs,
    track: track ? { ...track, feature: askTier === 'best' ? 'reels-director-sonnet' : 'reels-director' } : undefined,
  });
  let best = null;
  const attempt = async askTier => {
    const reply = await ask(askTier);
    result.cost += Number(reply.cost) || 0;
    const checked = validateV4(extractJson(reply.text), { script: text, read, esStyle: styleId, length: L.id });
    checked.model = reply.model || '';
    if (!best || (best.weak && !checked.weak)) best = checked;
    return checked;
  };
  try {
    const first = await attempt('main');
    if (first.weak && tier !== 'economy' && now() - startedAt < budgetMs - timeoutMs) {
      result.escalated = true;
      await attempt('best').catch(error => { if (api.isBudgetError(error)) result.reason = 'budget'; });
    }
  } catch (error) {
    if (!best) return { ...result, plan: code(), reason: api.isBudgetError(error) ? 'budget' : 'error' };
  }
  if (!best || !best.plan.chapters.length || !voMatchesScript(best.plan)) return { ...result, plan: code(), reason: 'weak', issues: best ? best.issues : [] };
  return { ...result, plan: credit(best.plan), model: best.model, source: result.escalated && /sonnet/.test(best.model) ? 'director-sonnet' : 'director', issues: best.issues, weak: best.weak, scriptNotes: best.scriptNotes };
}

// Revise: the director again with the editor's note and the current plan.
// The vo never changes (it is rebuilt from the script).
const REVISE_PRESETS_V4 = {
  punchier: 'Make every headline, stamp and tag punchier: fewer words, stronger verbs.',
  hook: 'Make the hook chapter land harder: a sharper headline and a module or stamp that shows the contradiction.',
  visual: 'More motion: more modules that build, and clips where the words name a play.',
  calmer: 'Calmer on-screen words, fewer stamps, like a studio analyst.',
};
async function reviseV4({ plan, instruction = '', corpus = '', lessons = [], track = null } = {}) {
  const note = REVISE_PRESETS_V4[instruction] || str(instruction, 300);
  if (!note) throw new Error('Say what to change.');
  const script = plan && plan.script && plan.script.text;
  if (!script) throw new Error('This reel has no script to keep.');
  const current = { chapters: (plan.chapters || []).map(c => ({ headline: c.headline, beats: c.beats.map(b => ({ media: b.media && b.media.kind, subject: b.media && b.media.subject && b.media.subject.name, module: b.module && b.module.type, stamp: b.stamp && b.stamp.text })) })), close: plan.close };
  const out = await runDirectorV4({ script, topic: str(corpus, 8000), esStyle: plan.esStyle, length: plan.length, tier: 'economy', steer: note, lessons, current, track: track ? { ...track } : null, sport: plan.sport || '' });
  if (out.plan && plan.team && !out.plan.team) out.plan.team = plan.team;
  return out;
}

// ─── Critic ──────────────────────────────────────────────────────────────
const CRITIC_KEYS = ['hook', 'oneIdea', 'mediaWords', 'moduleClaim', 'pacing', 'close'];
const CRITIC_SYSTEM = [
  'You are the ES reels critic. You score a planned 9:16 breakdown reel before it is shown. The voiceover is the editor\'s own script: never rewrite it. Judge only what is on screen and the structure.',
  'Score 1-5 each: hook (the first chapter lands the claim in its headline + picture), oneIdea (each chapter is one idea), mediaWords (each beat\'s media subject is what its words are about), moduleClaim (each module proves its beat\'s claim), pacing (beats change every 3-8 s, chapters balanced), close (the two options are the real argument).',
  'Return JSON only: {"scores":{"hook":4,"oneIdea":4,"mediaWords":3,"moduleClaim":4,"pacing":4,"close":3},"fixes":[{"op":"headline|stamp|tag|mediaKind|mediaSubject|dropModule|closePrompt|closeOptions","chapter":"c1","beat":"b2","value":"...","why":"short"}],"scriptNotes":["optional suggestion for the editor\'s script; never applied"]}',
  'Fixes: at most 6, only the ones that raise a score. headline: a CAPS line with one *marked* word. stamp/tag: {"text","tone"} or null to remove. mediaKind: clip|presser|photo|cards|cutout|none. mediaSubject: a name exactly as in the script. closeOptions: ["RED OPTION","BLUE OPTION"]. Never add a number that is not in the script or sources. Never touch the voiceover.',
].join('\n');
const CRITIQUE_CACHE = new Map();
const CRITIQUE_TTL_MS = 30 * 60 * 1000;
// Code checks: free, always run.
function codeCritique(plan) {
  const issues = [];
  const chapters = plan.chapters || [];
  const all = chapters.flatMap(c => c.beats || []);
  if (!voMatchesScript(plan)) issues.push({ key: 'script', blocker: true, text: 'The voiceover no longer matches the script.' });
  if (!chapters[0] || !plain(chapters[0].headline).trim()) issues.push({ key: 'hook', blocker: true, text: 'The hook chapter has no headline.' });
  all.forEach(b => { if ((!b.media || b.media.kind === 'none') && !b.module) issues.push({ key: 'motion', blocker: true, beat: b.id, text: `Beat ${b.id} has nothing moving.` }); });
  if (!all.some(b => b.media && ['clip', 'presser'].includes(b.media.kind))) issues.push({ key: 'clips', blocker: true, text: 'No beat asks for a clip.' });
  chapters.forEach(c => { if ((c.beats || []).length > 5) issues.push({ key: 'oneIdea', text: `Chapter ${c.id} has ${c.beats.length} beats; split it.` }); });
  all.forEach(b => { if (words(b.vo).length > 45) issues.push({ key: 'pacing', beat: b.id, text: `Beat ${b.id} runs long on one picture.` }); });
  if (!plan.close || !Array.isArray(plan.close.options) || plan.close.options.length !== 2) issues.push({ key: 'close', blocker: true, text: 'The close needs two options.' });
  if (plan.pacing && plan.pacing.fit !== 'ok') issues.push({ key: 'pacing', text: `The script reads in ~${plan.pacing.estSec} s (target ${plan.pacing.range[0]}-${plan.pacing.range[1]} s).` });
  const modules = all.filter(b => b.module).length;
  const score = key => Math.max(1, 5 - issues.filter(i => i.key === key).length - (issues.some(i => i.key === key && i.blocker) ? 2 : 0));
  const scores = { hook: score('hook'), oneIdea: score('oneIdea'), mediaWords: score('motion'), moduleClaim: modules ? 4 : 2, pacing: score('pacing'), close: score('close') };
  return { issues, scores };
}
// Apply one fix when it is safe (never the vo; numbers sourced; names in the script).
function applyFix(plan, fix, { set, corpusSq }) {
  const f = fix && typeof fix === 'object' ? fix : {};
  const ch = plan.chapters.find(c => c.id === f.chapter) || plan.chapters.find(c => c.beats.some(b => b.id === f.beat));
  const beat = ch && ch.beats.find(b => b.id === f.beat);
  const ok = v => !unsourced([JSON.stringify(v == null ? '' : v)], set).length;
  switch (f.op) {
    case 'headline': {
      if (!ch) return false;
      const h = shapeHeadline(f.value);
      if (!h || !ok(h) || RULES.BANNED.some(r => r.re.test(plain(h)))) return false;
      ch.headline = h; return true;
    }
    case 'stamp': case 'tag': {
      if (!beat) return false;
      if (f.value == null || f.value === '') { delete beat[f.op]; return true; }
      const v = f.op === 'stamp' ? shapeStamp(f.value) : shapeTag(f.value);
      if (!v || !ok(v.text)) return false;
      if (f.op === 'stamp' && ch.beats.some(b => b !== beat && b.stamp)) return false;
      beat[f.op] = v; return true;
    }
    case 'mediaKind': {
      if (!beat || !MEDIA_KINDS.includes(f.value)) return false;
      if (f.value === 'none' && !beat.module) return false;
      beat.media = { ...(beat.media || {}), kind: f.value };
      if (f.value === 'none') { delete beat.media.subject; delete beat.media.label; }
      else if (!beat.media.subject) beat.media.subject = subjectFor(plan, beat);
      return true;
    }
    case 'mediaSubject': {
      const name = str(f.value && typeof f.value === 'object' ? f.value.name : f.value, 60);
      if (!beat || !name || !corpusSq.includes(squash(name)) || !beat.media || beat.media.kind === 'none') return false;
      const team = plan.team ? plan.team.name : '';
      beat.media.subject = { type: team && squash(team) === squash(name) ? 'team' : 'player', name, team: team || '' };
      return true;
    }
    case 'dropModule': {
      if (!beat || !beat.module || !beat.media || beat.media.kind === 'none') return false;
      delete beat.module; return true;
    }
    case 'closePrompt': {
      const p = up(f.value, 34);
      if (!p || !ok(p)) return false;
      plan.close.prompt = p; return true;
    }
    case 'closeOptions': {
      const o = list(f.value, 2).map(x => up(x && (x.text || x), 22)).filter(Boolean);
      if (o.length !== 2 || !ok(o)) return false;
      plan.close.options = [{ text: o[0], tone: 'red' }, { text: o[1], tone: 'blue' }]; return true;
    }
    default: return false;
  }
}
function critiqueSummary(plan) {
  return {
    style: plan.esStyle, length: plan.length, pacing: plan.pacing,
    chapters: plan.chapters.map(c => ({ id: c.id, marker: c.marker, headline: c.headline, beats: c.beats.map(b => ({ id: b.id, vo: b.vo, media: b.media ? [b.media.kind, b.media.subject && b.media.subject.name, b.media.label].filter(Boolean).join(' · ') : 'none', module: b.module ? JSON.stringify(b.module).slice(0, 220) : '', stamp: b.stamp && b.stamp.text, tag: b.tag && b.tag.text })) })),
    close: plan.close,
  };
}
async function critiqueV4({ plan, corpus = '', lessons = [], aiAllowed = true, track = null, timeoutMs = 18000 } = {}) {
  if (!plan || plan.v !== 4 || !Array.isArray(plan.chapters)) return { ok: false, status: 400, error: 'There is no v4 reel to check.' };
  const fixed = JSON.parse(JSON.stringify(plan));
  const scriptBefore = fixed.script && fixed.script.text;
  const code = codeCritique(fixed);
  const out = { ok: true, plan: fixed, scores: code.scores, issues: code.issues, applied: [], suggestions: [], scriptNotes: [], aiChecked: false, cost: 0, model: '' };
  let api = null;
  try { api = gateway(); } catch { api = null; }
  if (aiAllowed && api && api.gatewayConfigured()) {
    const summary = critiqueSummary(fixed);
    const lessonText = lessonsLines(lessons);
    const key = crypto.createHash('sha256').update(JSON.stringify([summary, lessonText])).digest('hex');
    const hit = CRITIQUE_CACHE.get(key);
    let parsed = null;
    if (hit && Date.now() - hit.at < CRITIQUE_TTL_MS) { parsed = hit.parsed; out.cached = true; out.model = hit.model; }
    else {
      try {
        const reply = await api.aiText({
          tier: 'main', system: CRITIC_SYSTEM, cacheSystem: true, json: true, effort: 'low', maxTokens: 1200, timeoutMs,
          messages: [{ role: 'user', content: [lessonText, `SOURCES:\n<<<\n${str(corpus, 4000) || '(none)'}\n>>>`, `REEL:\n${JSON.stringify(summary)}`].filter(Boolean).join('\n\n') }],
          track: track ? { ...track, feature: 'reels-critique' } : undefined,
        });
        out.cost = Number(reply.cost) || 0;
        out.model = reply.model || '';
        parsed = extractJson(reply.text);
        if (parsed) { CRITIQUE_CACHE.set(key, { at: Date.now(), parsed, model: out.model }); if (CRITIQUE_CACHE.size > 200) CRITIQUE_CACHE.delete(CRITIQUE_CACHE.keys().next().value); }
      } catch (error) { out.aiError = api.isBudgetError && api.isBudgetError(error) ? 'budget' : 'error'; }
    }
    if (parsed) {
      out.aiChecked = true;
      const s = parsed.scores || {};
      CRITIC_KEYS.forEach(k => { const n = Math.round(Number(s[k])); if (n >= 1 && n <= 5) out.scores[k] = Math.min(out.scores[k] ?? 5, n); });
      const set = sourceNumbers([scriptBefore, corpus].join('\n'));
      const corpusSq = squash([scriptBefore, corpus].join('\n'));
      list(parsed.fixes, 6).forEach(f => {
        const fix = { op: str(f && f.op, 16), chapter: str(f && f.chapter, 8), beat: str(f && f.beat, 8), value: f && f.value, why: str(f && f.why, 140) };
        if (applyFix(fixed, fix, { set, corpusSq })) out.applied.push(fix); else out.suggestions.push(fix);
      });
      out.scriptNotes = list(parsed.scriptNotes, 4).map(n => str(n, 200)).filter(Boolean);
    }
  }
  // The critic never touches the voiceover.
  if (!voMatchesScript(fixed) || (fixed.script && fixed.script.text) !== scriptBefore) { out.plan = plan; out.applied = []; out.issues.push({ key: 'script', text: 'A fix touched the script and was undone.' }); }
  const after = codeCritique(out.plan);
  out.issues = after.issues;
  const vals = CRITIC_KEYS.map(k => out.scores[k]);
  out.score = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
  out.pass = !after.issues.some(i => i.blocker) && Math.min(...vals) >= 3 && out.score >= 3.5;
  return out;
}

// ─── "Need a script?" helper ─────────────────────────────────────────────
// One Haiku call writes a first draft of a voiceover from the sources. It is
// shown to the person to edit; the director only ever reads what they keep.
const SCRIPT_SYSTEM = 'You write first-draft voiceover scripts for EssentiallySports breakdown reels. Plain spoken American sports English, short sentences, a hook that states the contradiction, 2-4 parts that each prove one point, a payoff, and a question to fans at the end. Every number must appear in SOURCES; never invent one. No emojis, hashtags, links or hype words. Return JSON only: {"script":"..."}';
async function draftScript({ topic = '', trend = null, facts = '', length = 'full', track = null, timeoutMs = 20000 } = {}) {
  const L = lengthOf(length);
  const read = D().readReelBrief({ brief: str(topic, 2400), trend, facts });
  if (!read.corpus) return { ok: false, status: 400, error: 'Say what the reel is about first.' };
  const target = pacingOf('', L.id).wordsRange;
  const reply = await gateway().aiText({
    tier: 'main', system: SCRIPT_SYSTEM, cacheSystem: false, json: true, effort: 'low', maxTokens: 900, timeoutMs,
    messages: [{ role: 'user', content: `LENGTH: ${target[0]}-${target[1]} words (${L.label}, ~${L.sec} s).\nSOURCES:\n<<<\n${read.corpus}\n>>>` }],
    track: track ? { ...track, feature: 'reels-script-draft' } : undefined,
  });
  const set = sourceNumbers(read.corpus);
  const raw = normScript(str((extractJson(reply.text) || {}).script, 4000));
  const issues = [];
  const kept = segmentScript(raw).filter(s => { const bad = unsourced([s], set); if (bad.length) issues.push(`Left out a line with ${bad.join(', ')} (not in the sources).`); return !bad.length && !RULES.BANNED.some(r => r.re.test(s)); });
  return { ok: true, script: kept.join(' '), issues, pacing: pacingOf(kept.join(' '), L.id), cost: Number(reply.cost) || 0, model: reply.model || '' };
}

module.exports = {
  V4_STYLES, V4_IDS, v4StyleOf, LENGTHS, WPM, MAX_SCRIPT_CHARS, MODULE_SPEC, MODULE_TYPES, MEDIA_KINDS, BUILTIN_SHAPES, CRITIC_KEYS, REVISE_PRESETS_V4,
  splitCredits, figuresOf, moduleFor, claimOption, headlineFromWords, isCreditText,
  segmentScript, normScript, pacingOf, spelledNumbers, sourceNumbers, shapeModule, moduleClaims, shapeMedia, shapeHeadline, shapeClose, markerFor,
  scriptToV4, ensureMotion, structureOf, referenceShapes, setReferencePlans, v4System, directorRequestV4, lessonsLines, validateV4, voMatchesScript, flattenV4,
  readV4, runDirectorV4, reviseV4, codeCritique, applyFix, critiqueV4, CRITIQUE_CACHE, CRITIC_SYSTEM, draftScript, SCRIPT_SYSTEM,
};
