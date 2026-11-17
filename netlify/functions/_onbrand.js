'use strict';
// "Bring it on-brand": the creative director reads any design (an image, or
// the slides of a carousel made elsewhere), critiques it against the ES
// guidelines (es-guidelines.js), and plans its ES version.
//
//   critique({ images, note, track })  one vision call (Gateway "main" tier,
//     Haiku), logged as feature 'generate-onbrand'. Never throws: returns
//     { critique: null } on any failure.
//   validateCritique(parsed)  never trusts the model: issues must cite a real
//     guideline id; numbers must appear in the text read off that slide.
//   briefFrom(critique, note)  the facts the ES version may use (the image's
//     own words and numbers, plus the editor's note), as a Generate brief.
//   conceptsFrom(critique, mapping)  one ES direction per slide that maps to
//     an ES template (es-guidelines.js mapSlides), for the chosen-directions
//     path in es-generate.js (no extra director call).
const GUIDE = require('../../es-guidelines.js');
const gateway = () => require('./_ai-gateway.js');

const MAX_IMAGES = 6;
const MAX_IMAGE_CHARS = 1_600_000; // ~1.2 MB of JPEG per slide after base64
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const ROLES = ['cover', 'stats', 'quote', 'list', 'story', 'other'];

const clean = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();
const cut = (value, max) => clean(value).slice(0, max).trim();
const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9.%+]+/g, ' ').trim()} `;

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    const ch = raw[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(raw.slice(start, end)); } catch (error) { /* keep shrinking */ }
  }
  return null;
}

// Data-URL images from the page -> { images: [{ mediaType, data }] } or { error }.
function readImages(list) {
  const items = (Array.isArray(list) ? list : [list]).filter(Boolean);
  if (!items.length) return { error: 'Add an image of the design.' };
  if (items.length > MAX_IMAGES) return { error: `Up to ${MAX_IMAGES} slides at a time.` };
  const images = [];
  for (const item of items) {
    const url = typeof item === 'string' ? item : item?.dataUrl;
    if (typeof url !== 'string' || url.length > MAX_IMAGE_CHARS) return { error: 'That image is too large. Try a smaller screenshot.' };
    const match = url.match(IMAGE_RE);
    if (!match) return { error: 'Use a JPG, PNG or WebP image.' };
    images.push({ mediaType: match[1], data: match[2] });
  }
  return { images };
}

function SYSTEM() {
  return [
    'You are the creative director of EssentiallySports (ES), a US sports media brand. Editors show you a social design made outside ES\'s tools (often by another AI) and you judge it against the ES design guidelines, then plan how ES would post the same story.',
    'Read the design exactly. Copy every visible word and number as written (no guessing; skip what you cannot read). Never add facts.',
    'Judge it only against these ES rules, citing their ids:',
    GUIDE.critiqueRulesText(),
    '',
    'For each slide give: role (cover | stats | quote | list | story | other), the text lines as written, the numbers with their label as written (e.g. {"value":"2.6M","label":"AVERAGE"}), a quote only if it is words someone said, and the names of a ranked list.',
    'issues: what breaks the rules, most important first, each { "rule": "<id>", "slide": n, "what": "what you see, in under 14 words", "why": "why ES does not do it, in under 16 words" }. Max 8.',
    'keep: up to 3 things worth keeping (the story, a strong number, a hook), under 12 words each.',
    'read: who it is about, their team (full name as written or obvious from the design), the sport/league, and the story in one line.',
    'Reply with JSON only:',
    '{"read":{"subject":"","team":"","sport":"","story":""},"headline":"","slides":[{"role":"","text":[""],"numbers":[{"value":"","label":""}],"quote":"","entities":[""]}],"issues":[{"rule":"","slide":1,"what":"","why":""}],"keep":[""]}',
  ].join('\n');
}

// Never trusts the model. Returns null when nothing usable came back.
function validateCritique(parsed, { imageCount = 1 } = {}) {
  if (!parsed || typeof parsed !== 'object') return null;
  const slides = (Array.isArray(parsed.slides) ? parsed.slides : []).slice(0, Math.max(1, imageCount) * 2).map((slide, index) => {
    const text = (Array.isArray(slide?.text) ? slide.text : [slide?.text]).map(line => cut(line, 140)).filter(Boolean).slice(0, 14);
    const seen = squash(text.join(' '));
    const numbers = (Array.isArray(slide?.numbers) ? slide.numbers : [])
      .map(n => ({ value: cut(n?.value, 12), label: cut(n?.label, 24) }))
      // A number counts only when it is in the words read off this slide.
      .filter(n => /\d/.test(n.value) && seen.includes(` ${n.value.toLowerCase().replace(/[^a-z0-9.%+]+/g, ' ').trim()} `))
      .slice(0, 8);
    const quote = cut(slide?.quote, 300);
    return {
      index: index + 1,
      role: ROLES.includes(String(slide?.role || '').toLowerCase()) ? String(slide.role).toLowerCase() : 'other',
      text,
      numbers,
      quote: quote && seen.includes(squash(quote).trim().split(' ').slice(0, 3).join(' ')) ? quote : '',
      entities: (Array.isArray(slide?.entities) ? slide.entities : []).map(e => cut(e, 40)).filter(Boolean).slice(0, 10),
    };
  }).filter(slide => slide.text.length || slide.numbers.length);
  const seenIssue = new Set();
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).map(issue => {
    const rule = String(issue?.rule || '').trim().toLowerCase();
    const known = GUIDE.RULES_BY_ID[rule];
    if (!known) return null;
    const what = cut(issue.what, 140);
    if (what.length < 4) return null;
    const key = `${rule}|${what.toLowerCase()}`;
    if (seenIssue.has(key)) return null;
    seenIssue.add(key);
    const slide = Number(issue.slide);
    return {
      rule, level: known.level, area: known.area, title: known.rule, source: known.source,
      ...(Number.isInteger(slide) && slide >= 1 && slide <= Math.max(imageCount, slides.length) ? { slide } : {}),
      what, why: cut(issue.why, 160) || known.rule,
    };
  }).filter(Boolean).slice(0, 8);
  if (!slides.length && !issues.length) return null;
  const read = parsed.read && typeof parsed.read === 'object' ? parsed.read : {};
  return {
    read: { subject: cut(read.subject, 60), team: cut(read.team, 40), sport: cut(read.sport, 20), story: cut(read.story, 220) },
    headline: cut(parsed.headline, 120),
    slides,
    issues,
    keep: (Array.isArray(parsed.keep) ? parsed.keep : []).map(item => cut(item, 100)).filter(Boolean).slice(0, 3),
    onBrand: !issues.some(issue => issue.level === 'must'),
  };
}

// The Generate brief: the story and only what the image (or the editor) says.
function briefFrom(critique, note = '') {
  const lines = [];
  const who = [critique.read.subject, critique.read.team].filter(Boolean).join(', ');
  if (critique.headline) lines.push(`Headline: ${critique.headline}`);
  lines.push(`Story: ${critique.read.story || critique.headline || who}`);
  if (critique.read.sport) lines.push(`Sport: ${critique.read.sport}`);
  if (who) lines.push(`Who: ${who}`);
  critique.slides.forEach(slide => {
    const bits = [];
    if (slide.numbers.length) bits.push(slide.numbers.map(n => `${n.value} ${n.label}`.trim()).join(', '));
    if (slide.quote) bits.push(`"${slide.quote}"`);
    if (slide.entities.length >= 3) bits.push(slide.entities.map((entity, i) => `${i + 1}. ${entity}`).join(' '));
    const words = slide.text.filter(line => !slide.numbers.some(n => line.includes(n.value))).slice(0, 4).join(' / ');
    if (words) bits.push(words);
    if (bits.length) lines.push(`Slide ${slide.index}: ${bits.join(' | ')}`);
  });
  const extra = clean(note).slice(0, 400);
  if (extra) lines.push(`Editor's note: ${extra}`);
  return lines.join('\n').slice(0, 1500);
}

const HOOK_FOR = { cover: 'claim', quote: 'quote', 'long-quote': 'quote', 'stats-single-ent': 'numbers', 'stats-double-ent': 'numbers', 'listicle-type-1': 'ranking', 'listicle-type-2': 'ranking', 'double-entity-quote': 'quote' };
const NAME_FOR = { cover: 'Cover', quote: 'Quote', 'long-quote': 'Long Quote', 'stats-single-ent': 'Player Stats', 'stats-double-ent': 'Head-to-Head', 'listicle-type-1': 'Rankings Table', 'listicle-type-2': 'Ranked List', 'double-entity-quote': 'Two-Person Quote' };

// One ES direction per mapped slide (cover first, then the other templates),
// at most 4 and never the same template twice for covers beyond 2.
function conceptsFrom(critique, mapping = []) {
  const out = [];
  const used = {};
  const ordered = [...mapping].sort((a, b) => (a.template === 'cover' ? 0 : 1) - (b.template === 'cover' ? 0 : 1) || a.slide - b.slide);
  for (const map of ordered) {
    if (out.length >= 4) break;
    const limit = map.template === 'cover' ? 2 : 1;
    if ((used[map.template] || 0) >= limit) continue;
    const slide = critique.slides.find(s => s.index === map.slide) || critique.slides[map.slide - 1];
    if (!slide) continue;
    const headline = map.slide === 1 && critique.headline ? critique.headline : slide.text[0] || critique.headline;
    const angle = cut(`${headline || critique.read.story}`, 110);
    if (angle.length < 6) continue;
    used[map.template] = (used[map.template] || 0) + 1;
    out.push({
      ref: `s${map.slide}`,
      name: `Slide ${map.slide} · ${NAME_FOR[map.template]}`,
      postType: map.template,
      angle,
      hook: map.template === 'cover' && /\?\s*$/.test(angle) ? 'question' : HOOK_FOR[map.template] || 'claim',
      emotion: '',
      headlineIdea: map.template === 'cover' ? cut(headline, 60) : '',
      factsUsed: [...slide.numbers.map(n => `${n.value} ${n.label}`.trim()), ...(slide.quote ? [slide.quote] : [])].slice(0, 6),
      photo: { query: cut([critique.read.subject, critique.read.team].filter(Boolean).join(' '), 60), shot: 'any' },
      team: critique.read.team,
      palette: 'auto',
      why: map.why,
      confidence: 80,
    });
  }
  return out;
}

async function critique({ images, note = '', track = null, timeoutMs = 25000 } = {}) {
  const result = { critique: null, cost: 0, model: '' };
  try {
    const { aiText } = gateway();
    const content = [{ type: 'text', text: `${images.length > 1 ? `A ${images.length}-slide carousel, in order.` : 'One design.'}${note ? ` The editor adds: ${clean(note).slice(0, 400)}` : ''}` }];
    images.forEach((image, index) => content.push(
      { type: 'text', text: `Slide ${index + 1}:` },
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
    ));
    const reply = await aiText({
      tier: 'main', system: SYSTEM(), cacheSystem: true, messages: [{ role: 'user', content }], effort: 'low', maxTokens: 2600, timeoutMs,
      track: track ? { ...track, feature: 'generate-onbrand' } : undefined,
    });
    result.cost = Number(reply.cost) || 0;
    result.model = reply.model || '';
    result.critique = validateCritique(extractJson(reply.text), { imageCount: images.length });
    return result;
  } catch (error) {
    return { ...result, error: gateway().isBudgetError?.(error) ? 'budget' : 'failed' };
  }
}

module.exports = { readImages, SYSTEM, validateCritique, briefFrom, conceptsFrom, critique, MAX_IMAGES, _test: { extractJson } };
