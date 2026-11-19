'use strict';
// Generate "Creative": the learning model. It learns from signals, not from
// model training. Every run teaches it something:
//
//   signals      picks, downloads / exports, rejects, text edits, thumbs, the
//                design assistant's requests, applied improvements, and the
//                judge's critique ("photo too dark behind the headline").
//   observations each signal becomes 0-3 observations: a topic ("photo-dark"),
//                a scope (global / archetype / sport / brand) and a weight.
//   lessons      recurring observations are distilled into lessons: one per
//                topic and scope (deduped), with evidence that DECAYS over time
//                (half-life 21 days), so old habits fade and new ones count.
//                A lesson is active once its decayed evidence reaches 1.75
//                (about two sightings within a week).
//   injection    the top active lessons for a run (its sport, archetypes,
//                brand) go into the art director's and the judge's prompts.
//   hit rate     "doesn't repeat mistakes" is measured: after a lesson was in
//                a run's prompt, the judge's critique either repeats its topic
//                (a recurrence) or not (a hit). hitRate = hits / (hits + recurrences).
//
// Storage: frameup_creative_lessons (migration 20261118130000), written only
// through the security-definer RPC frameup_creative_lessons_bump (deltas,
// capped per call), team-readable. Signals that fit go to the existing
// frameup_generate_direction_events log too. Before the migration runs (or
// with Supabase down) lessons live in this server instance's memory, so the
// feature works, just without sharing across instances. Never throws.
const { authConfig } = require('./_supabase-auth.js');

const TABLE = 'frameup_creative_lessons';
const RPC = 'frameup_creative_lessons_bump';
const HALF_LIFE_DAYS = 21;
const ACTIVE_WEIGHT = 1.75; // about two sightings within a week
const CACHE_MS = 10 * 60 * 1000;
const MISSING_MS = 10 * 60 * 1000;
const MAX_LESSONS = 400;
const DAY = 24 * 60 * 60 * 1000;
const SCOPES = ['global', 'archetype', 'sport', 'brand'];
const SIGNALS = ['pick', 'export', 'reject', 'edit', 'thumb', 'assistant', 'improvement', 'judge'];

const clean = (value, max = 240) => String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/[{}`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const squash = text => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = text => squash(text).replace(/ /g, '-').slice(0, 40);

// ─── Topics: what a critique is about, and the lesson it teaches ──────────
// Ordered: the first match wins (specific before general). `fix` is the
// composer's one-click fix for it (FrameUpCompose.FIXES or an assistant macro).
const TOPICS = [
  // gen-director (2026-11-20): the content and set failures a senior designer
  // catches first. Specific, so they sit before the visual topics.
  { id: 'stat-meaning', re: /\bcoverage counts?\b|\bnot a (?:real |meaningful )?stat\b|\bmeaningless (?:stat|number|numbers)\b|\b(?:year|date|season)\b[^.]{0,25}\b(?:as|is) (?:a |the )?(?:stat|hero number|number)\b|\b\d+\s+stories\b|\b\d+\s+outlets\b|\bour own (?:coverage|counts)\b/i, lesson: 'Numbers are real story stats (scores, records, money, rankings), never our coverage counts, years or dates.', fix: '' },
  { id: 'label-sense', re: /\bgarbled\b|\blabel\b[^.]{0,30}\b(?:doesn'?t read|does not read|nonsense|broken|confusing|unclear|makes no sense|cut off)\b|\bdoesn'?t read as a (?:stat )?label\b|\bstat labels?\b[^.]{0,20}\b(?:wrong|bad)\b/i, lesson: 'Every stat label is a short noun phrase from the facts (PASSING YARDS), never words cut from the next sentence.', fix: '' },
  { id: 'duplicate', re: /\brepeat(?:s|ed|ing)? the (?:hero )?(?:number|headline|label|year)\b|\bduplicat(?:e|ed|es|ion)\b|\bsaid twice\b|\bredundant\b|\bsays? it twice\b/i, lesson: 'Say each fact once: the headline never repeats the hero number or its label.', fix: '' },
  { id: 'tone-monotone', re: /\bsame (?:dark |colou?r )?tones?\b|\ball (?:dark|the same tone|navy|green)\b|\bmonoton(?:e|ous)\b|\btone variety\b|\bno light (?:design|tone|version)\b|\bsamey\b|\bflip it for variety\b/i, lesson: 'Mix tones across a set: a light paper or white design beside dark and vivid team colour.', fix: 'swap-palette' },
  { id: 'no-cutout', re: /\bno (?:player |star )?(?:photo|cut-?out|image) of\b|\bnamed but no\b|\bneeds? (?:a |the )?(?:player )?cut-?out\b|\bno cut-?out\b|\blead(?:s)? with (?:a |the |their |his |her )?(?:photo|cut-?out)\b|\bwithout (?:a |any )?(?:player )?(?:photo|cut-?out)\b/i, lesson: 'When a star is named, lead at least one design with their cut-out, big and in front.', fix: '' },
  { id: 'image-weak', re: /\b(?:photo|image|picture)\b[^.]{0,30}\b(?:tiny|too small|adds nothing|lost in|faded|barely visible|postage stamp)\b|\btiny (?:photo|image)\b/i, lesson: 'Use photography big and bright; a tiny or faded photo adds nothing.', fix: 'brighten-photo' },
  { id: 'photo-dark', re: /\b(?:photo|image|picture|background)\b[^.]{0,30}\b(?:too dark|dark|dim|murky|muddy|underexposed|gloomy)\b|\b(?:too dark|dim|murky|muddy|underexposed)\b[^.]{0,20}\b(?:photo|image|picture)\b|\bbright(?:en|er)\b/i, lesson: 'Keep the hero photo bright; darken only the strip behind the text.', fix: 'brighten-photo' },
  { id: 'text-over-busy', re: /\b(?:headline|text|type|copy|words?)\b[^.]{0,40}\b(?:over|on|across|behind)\b[^.]{0,20}\b(?:busy|face|crowd|detail|clutter)|\b(?:busy|cluttered)\b[^.]{0,20}\b(?:behind|under)\b[^.]{0,15}\b(?:headline|text|type)\b/i, lesson: 'Never set type over a busy area or a face; give it a mist or a colour band.', fix: 'darker-mist' },
  { id: 'low-contrast', re: /\bcontrast\b|\bhard to read\b|\billegible\b|\blegib|\bwashed[- ]out\b|\bblends? into\b|\bunreadable\b/i, lesson: 'Check text contrast: light type on a dark field or the reverse, never mid-tones.', fix: 'more-contrast' },
  { id: 'number-unit', re: /\b(?:number|figure|stat|value)\b[^.]{0,30}\b(?:no|lacks?|missing|without)\b[^.]{0,12}\b(?:unit|label|context)\b|\blacks? (?:a |its )?(?:unit|label)\b|\bwhat the (?:number|figure) (?:means|is)\b|\bneeds? (?:a |its )?(?:unit|label)\b/i, lesson: 'Every hero number needs its unit or label right under it.', fix: '' },
  { id: 'number-small', re: /\b(?:number|figure|stat)\b[^.]{0,25}\b(?:small|weak|lost|timid|undersized|could be bigger)\b|\bbigger number\b|\bnumber bigger\b/i, lesson: 'Make the hero number the biggest thing on the canvas.', fix: 'bigger-number' },
  { id: 'headline-long', re: /\bheadline\b[^.]{0,25}\b(?:long|wordy|too many words|cramped|wraps|crowded)\b|\bshorter headline\b|\b(?:shorten|trim) (?:the )?headline\b|\bshorter\b/i, lesson: 'Keep headlines to 2-6 words so they set big.', fix: 'shorter-headline' },
  { id: 'headline-small', re: /\bheadline\b[^.]{0,25}\b(?:small|tiny|timid|undersized)\b|\bbigger headline\b|\bheadline bigger\b/i, lesson: 'Set the headline big enough to read at phone size.', fix: 'bigger-headline' },
  { id: 'headline-weak', re: /\bheadline\b[^.]{0,25}\b(?:flat|weak|generic|bland|dull|label)\b|\bpunch(?:y|ier)?\b|\bhook\b|\bsharper (?:copy|headline)\b/i, lesson: 'Lead with a hook: a claim or question with a strong verb, not a label.', fix: '' },
  { id: 'cutout-edge', re: /\bcut-?out\b[^.]{0,30}\b(?:edge|edges|halo|rough|jagged|fringe|outline)\b/i, lesson: 'Check cut-out edges; use a duotone photo when the cut-out is rough.', fix: '' },
  { id: 'crop', re: /\bcrop(?:ped|ping)?\b|\bcut off\b|\bheadroom\b|\bface (?:is )?cut\b/i, lesson: 'Crop photos on the face and upper body; never cut off heads.', fix: '' },
  { id: 'hierarchy', re: /\bhierarchy\b|\breading order\b|\bcompet(?:e|es|ing)\b|\btwo focal\b|\bfight(?:s|ing)? for attention\b|\bno clear focal\b/i, lesson: 'One focal point per design; everything else steps back.', fix: '' },
  { id: 'empty-space', re: /\b(?:dead|empty|unused|wasted) (?:space|area)\b|\btoo much (?:space|air)\b|\bsparse\b|\bfeels empty\b/i, lesson: 'Fill the canvas: no large dead areas; scale the focal element up.', fix: 'bigger-number' },
  { id: 'clutter', re: /\bclutter(?:ed)?\b|\btoo much (?:going on|text)\b|\bbusy\b|\bcrowded\b|\bnoisy\b|\bcleaner\b|\bsimplif/i, lesson: 'Cut clutter: drop pills and body copy that repeat the headline.', fix: 'less-clutter' },
  { id: 'logo', re: /\blogo\b/i, lesson: 'Show the team or league logo when the story is about a team.', fix: 'add-logo' },
  { id: 'palette', re: /\bcolou?rs?\b|\bpalette\b|\bclash(?:es|ing)?\b|\bhue\b/i, lesson: 'Use the team colours (or ES navy and blue) with one accent; no clashing hues.', fix: 'swap-palette' },
  { id: 'safe-area', re: /\bsafe area\b|\btoo close to the edge\b|\bmargins?\b|\btight to the edge\b/i, lesson: 'Keep text 50px from every edge and clear of the ES mark.', fix: '' },
  { id: 'generic', re: /\btemplate\b|\bgeneric\b|\bstock\b|\bplain\b|\bpredictable\b|\bmore drama\b|\bdrama(?:tic)?\b|\bboring\b|\bflat\b/i, lesson: 'Push past the template look: one bold idea (cut-out, giant number, duotone, light).', fix: 'more-drama' },
];
const TOPIC_BY_ID = Object.fromEntries(TOPICS.map(t => [t.id, t]));

// ─── House lessons (seeded from real failures, always on) ─────────────────
// The 2026-11-20 review of a live Generate set (a golf brief about a named
// star) found every one of these. They go into the art director's and the
// judge's prompts on every run, after the learned lessons, in the free slots
// (a learned lesson on the same topic replaces its seed). They are not stored
// rows, so they never decay and never crowd the team's own lessons out.
const SEED_LESSONS = [
  { topic: 'stat-meaning', text: TOPICS.find(t => t.id === 'stat-meaning').lesson, why: 'shipped "4 STORIES · 6 OUTLETS" as stats' },
  { topic: 'stat-meaning-year', text: 'A year or date is never the hero number ("2027 SEASON"); lead with a score, record, money or ranking, or with type and photo.', why: 'shipped "2027" as the big number' },
  { topic: 'duplicate', text: TOPICS.find(t => t.id === 'duplicate').lesson, why: '"2027 SEASON" over "THE 2027 SEASON STARTS..."' },
  { topic: 'label-sense', text: TOPICS.find(t => t.id === 'label-sense').lesson, why: 'shipped "2027 SEASON WHY FANS"' },
  { topic: 'tone-monotone', text: TOPICS.find(t => t.id === 'tone-monotone').lesson, why: 'three designs in the same dark green / navy' },
  { topic: 'no-cutout', text: TOPICS.find(t => t.id === 'no-cutout').lesson, why: 'a famous golfer named, no cut-out, a murky golf-ball photo instead' },
  { topic: 'empty-space', text: 'Fill the canvas: no empty quadrant; a 3-number grid in a 2x2 leaves a hole.', why: 'by-the-numbers with an empty quadrant' },
].map((seed, i) => ({ id: `H${i + 1}`, key: `seed:global:${seed.topic}`, kind: 'avoid', scope: 'global', scopeValue: '', seed: true, ...seed }));
// The run's lessons plus the house lessons whose topic is not already there.
function withSeeds(selected = [], { limit = 6 } = {}) {
  const topics = new Set((selected || []).map(l => l.topic).filter(Boolean));
  const seeds = SEED_LESSONS.filter(seed => !topics.has(seed.topic) && !topics.has(seed.topic.replace(/-year$/, ''))).slice(0, Math.max(0, limit));
  return [...(selected || []), ...seeds];
}

// Assistant requests say what the design lacked ("use a darker photo" means
// the type was hard to read; "move the number left" is taste, no lesson).
const INTENT_TOPICS = [
  [/\b(?:darker|moodier) (?:photo|image|background)\b/i, 'low-contrast'],
  [/\bmore drama\b|\bdramatic\b/i, 'generic'],
];

function topicOf(text) {
  const value = String(text || '');
  if (!value.trim()) return null;
  return TOPICS.find(t => t.re.test(value)) || null;
}
function intentTopic(text) {
  const hit = INTENT_TOPICS.find(([re]) => re.test(String(text || '')));
  if (hit) return TOPIC_BY_ID[hit[1]];
  return topicOf(text);
}

// Free text with no topic: the lesson is the critique itself, normalised.
function freeLesson(text) {
  const value = clean(text, 160).replace(/^(?:the|a|an)\s+/i, '');
  if (value.length < 8) return '';
  return `Avoid: ${value.charAt(0).toLowerCase()}${value.slice(1)}`.replace(/[.\s]+$/, '.');
}

// Lesson key: one row per topic (or free-text fingerprint) and scope.
function keyFor({ kind = 'avoid', topic, text, scope = 'global', scopeValue = '' }) {
  const what = topic || `t-${squash(text).split(' ').filter(w => w.length > 3).sort().slice(0, 6).join('-')}`.slice(0, 80);
  return `${kind}:${scope}${scopeValue ? `=${slug(scopeValue)}` : ''}:${what}`.slice(0, 200);
}

// ─── Signals -> observations ──────────────────────────────────────────────
// signal: { type, text?, archetype?, archetypeName?, sport?, brand?, value?,
//           before?, after?, source? }
// Weights: an editor's own act counts more than the judge's opinion.
const WEIGHT = { judge: 1, improvement: 1.5, assistant: 1.5, edit: 1, reject: 2, thumb: 1.5, pick: 1, export: 2 };

function scopesFor(signal) {
  const out = [{ scope: 'global', scopeValue: '' }];
  if (signal.archetype) out.push({ scope: 'archetype', scopeValue: signal.archetype });
  if (signal.sport) out.push({ scope: 'sport', scopeValue: signal.sport });
  if (signal.brand) out.push({ scope: 'brand', scopeValue: signal.brand });
  return out;
}

function observationsFrom(signal = {}) {
  const type = SIGNALS.includes(signal.type) ? signal.type : '';
  if (!type) return [];
  const weight = WEIGHT[type];
  const out = [];
  const name = clean(signal.archetypeName || signal.archetype, 40);
  const sport = clean(signal.sport, 20);
  const push = (base, scopes = scopesFor(signal)) => scopes.forEach(s => out.push({ ...base, ...s, weight: base.weight ?? weight, key: keyFor({ ...base, ...s }) }));
  const avoidFrom = (text, topic) => {
    const t = topic || topicOf(text);
    if (t) push({ kind: 'avoid', topic: t.id, text: t.lesson, source: type });
    else if (freeLesson(text)) push({ kind: 'avoid', topic: '', text: freeLesson(text), source: type }, scopesFor(signal).filter(s => s.scope !== 'global'));
  };
  if (type === 'judge' || type === 'improvement') {
    avoidFrom(signal.text);
  } else if (type === 'assistant') {
    const t = intentTopic(signal.text);
    if (t) push({ kind: 'avoid', topic: t.id, text: t.lesson, source: type });
  } else if (type === 'edit') {
    const before = clean(signal.before, 200);
    const after = clean(signal.after, 200);
    if (before && after && before !== after) {
      const shorter = after.split(' ').length < before.split(' ').length;
      const t = TOPIC_BY_ID[shorter ? 'headline-long' : 'headline-weak'];
      push({ kind: 'avoid', topic: t.id, text: t.lesson, source: type });
    }
  } else if ((type === 'pick' || type === 'export' || (type === 'thumb' && Number(signal.value) > 0)) && signal.archetype) {
    // Taste: which compositions editors ship, per sport (or overall).
    const scope = sport ? { scope: 'sport', scopeValue: sport } : { scope: 'global', scopeValue: '' };
    push({ kind: 'prefer', topic: `prefer-${slug(signal.archetype)}`, text: `Editors ship the ${name || signal.archetype} composition${sport ? ` for ${sport}` : ''}; offer it when the brief fits.`, source: type }, [scope]);
  } else if ((type === 'reject' || (type === 'thumb' && Number(signal.value) < 0))) {
    if (signal.text) avoidFrom(signal.text);
    if (signal.archetype) {
      const scope = sport ? { scope: 'sport', scopeValue: sport } : { scope: 'global', scopeValue: '' };
      push({ kind: 'avoid', topic: `reject-${slug(signal.archetype)}`, text: `Editors often reject the ${name || signal.archetype} composition${sport ? ` for ${sport}` : ''}; use it only when the brief clearly fits.`, source: type }, [scope]);
    }
  }
  return out;
}

// ─── Lessons: distil, decay, select ───────────────────────────────────────
const toTime = value => {
  const t = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(t) ? t : 0;
};
function decayed(lesson, now = Date.now()) {
  const age = Math.max(0, now - toTime(lesson.lastSeen)) / DAY;
  return Number((Number(lesson.evidence || 0) * 0.5 ** (age / HALF_LIFE_DAYS)).toFixed(3));
}
const hitRate = lesson => {
  const total = Number(lesson.hits || 0) + Number(lesson.recurrences || 0);
  return total ? Number((Number(lesson.hits || 0) / total).toFixed(2)) : null;
};
const isActive = (lesson, now) => decayed(lesson, now) >= ACTIVE_WEIGHT;

// distil(lessons, observations, { now, injected }) -> { lessons, deltas }
//   lessons:  the current list (not changed; a new list is returned)
//   injected: keys of the lessons that were in this run's prompts. Their topic
//             observed again = a recurrence; not observed = a hit.
// deltas are what the RPC adds (so parallel servers never overwrite each other).
function distil(lessons = [], observations = [], { now = Date.now(), injected = [] } = {}) {
  const byKey = new Map(lessons.map(l => [l.key, { ...l }]));
  const deltas = new Map();
  const delta = (lesson, change) => {
    const d = deltas.get(lesson.key) || { key: lesson.key, text: lesson.text, topic: lesson.topic, kind: lesson.kind, scope: lesson.scope, scopeValue: lesson.scopeValue, evidence: 0, hits: 0, recurrences: 0, recurred: false };
    d.evidence += change.evidence || 0;
    d.hits += change.hits || 0;
    d.recurrences += change.recurrences || 0;
    d.recurred = d.recurred || Boolean(change.recurrences);
    deltas.set(lesson.key, d);
  };
  const seenKeys = new Set();
  observations.forEach(obs => {
    if (!obs?.key || !SCOPES.includes(obs.scope)) return;
    let lesson = byKey.get(obs.key);
    const wasActive = lesson && isActive(lesson, now);
    if (!lesson) {
      lesson = { key: obs.key, text: clean(obs.text), topic: obs.topic || '', kind: obs.kind || 'avoid', scope: obs.scope, scopeValue: clean(obs.scopeValue, 60), evidence: 0, hits: 0, recurrences: 0, firstSeen: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), sources: {} };
      byKey.set(obs.key, lesson);
    }
    // Decay first, then add: evidence is stored already decayed to "now".
    lesson.evidence = Number((decayed(lesson, now) + obs.weight).toFixed(3));
    lesson.lastSeen = new Date(now).toISOString();
    lesson.sources = { ...(lesson.sources || {}), [obs.source]: Number(lesson.sources?.[obs.source] || 0) + 1 };
    const recurred = Boolean(wasActive && injected.includes(obs.key) && lesson.kind === 'avoid' && !seenKeys.has(obs.key));
    if (recurred) {
      lesson.recurrences = Number(lesson.recurrences || 0) + 1;
      lesson.lastRecurredAt = lesson.lastSeen;
    }
    seenKeys.add(obs.key);
    delta(lesson, { evidence: obs.weight, recurrences: recurred ? 1 : 0 });
  });
  // Injected avoid-lessons whose mistake did not come back: hits.
  injected.forEach(key => {
    const lesson = byKey.get(key);
    if (!lesson || lesson.kind !== 'avoid' || seenKeys.has(key)) return;
    lesson.hits = Number(lesson.hits || 0) + 1;
    delta(lesson, { hits: 1 });
  });
  const list = [...byKey.values()].sort((a, b) => decayed(b, now) - decayed(a, now)).slice(0, MAX_LESSONS);
  return { lessons: list, deltas: [...deltas.values()] };
}

// The lessons for one run: active, in scope (global, its sport, its
// archetypes, its brand), the strongest first. Avoid-lessons first (the
// mistakes), then up to 2 taste lessons.
function selectLessons(lessons = [], { sport = '', archetypes = [], brand = '', limit = 6, now = Date.now() } = {}) {
  const wantArch = new Set((archetypes || []).map(slug));
  const inScope = l => l.scope === 'global'
    || (l.scope === 'sport' && sport && slug(l.scopeValue) === slug(sport))
    || (l.scope === 'archetype' && wantArch.has(slug(l.scopeValue)))
    || (l.scope === 'brand' && brand && slug(l.scopeValue) === slug(brand));
  const boost = { archetype: 1.3, sport: 1.2, brand: 1.2, global: 1 };
  const ranked = lessons.filter(l => inScope(l) && isActive(l, now))
    .map(l => ({ ...l, weight: decayed(l, now), score: decayed(l, now) * boost[l.scope] }))
    .sort((a, b) => b.score - a.score);
  // One lesson per topic (the most specific scope wins its slot).
  const seen = new Set();
  const unique = ranked.filter(l => {
    const id = l.topic || l.key;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const avoid = unique.filter(l => l.kind === 'avoid').slice(0, Math.max(1, limit - 2));
  const prefer = unique.filter(l => l.kind === 'prefer').slice(0, 2);
  return [...avoid, ...prefer].slice(0, limit).map((l, i) => ({ id: `L${i + 1}`, key: l.key, text: l.text, kind: l.kind, scope: l.scope, scopeValue: l.scopeValue, topic: l.topic, weight: l.weight, hitRate: hitRate(l) }));
}

// Prompt lines (for the director and the judge).
function promptLines(selected = [], { who = 'director' } = {}) {
  if (!selected.length) return [];
  // House lessons (seeds) get their own heading: they are ES rules, not what this team taught.
  const seeds = selected.filter(l => l.seed);
  const house = seeds.length ? [
    who === 'judge' ? 'ES house lessons (real failures). A design that repeats one scores 1-2 on the matching rubric line and says so:' : 'ES house lessons (real failures, never repeat them):',
    ...seeds.map(l => `- [${l.id}] ${l.text}`),
  ] : [];
  const learned = selected.filter(l => !l.seed);
  if (!learned.length) return house;
  const avoid = learned.filter(l => l.kind === 'avoid');
  const prefer = learned.filter(l => l.kind === 'prefer');
  return [...house,
    who === 'judge'
      ? 'Team lessons (learned from past runs). If a design repeats one of these mistakes, say so in its improvements and score it down:'
      : 'Team lessons (learned from what editors fixed, rejected and shipped). Do not repeat these mistakes:',
    ...avoid.map(l => `- [${l.id}] ${l.text}`),
    ...(prefer.length ? ['Taste (what editors ship):', ...prefer.map(l => `- [${l.id}] ${l.text}`)] : []),
  ];
}

// Admin view data: the top lessons, and mistakes that came back after a
// lesson existed (the ones the prompts are not fixing yet).
function adminView(lessons = [], { now = Date.now(), limit = 20 } = {}) {
  const rows = lessons.map(l => ({ key: l.key, text: l.text, kind: l.kind, scope: l.scope, scopeValue: l.scopeValue, topic: l.topic, evidence: Number(l.evidence || 0), weight: decayed(l, now), active: isActive(l, now), hits: Number(l.hits || 0), recurrences: Number(l.recurrences || 0), hitRate: hitRate(l), lastSeen: l.lastSeen, lastRecurredAt: l.lastRecurredAt || null }));
  const top = rows.filter(r => r.active).sort((a, b) => b.weight - a.weight).slice(0, limit);
  const recurring = rows.filter(r => r.recurrences > 0).sort((a, b) => b.recurrences - a.recurrences || (toTime(b.lastRecurredAt) - toTime(a.lastRecurredAt))).slice(0, limit);
  const measured = rows.filter(r => r.hitRate != null);
  const hits = measured.reduce((n, r) => n + r.hits, 0);
  const misses = measured.reduce((n, r) => n + r.recurrences, 0);
  return {
    top,
    recurring,
    totals: { lessons: rows.length, active: rows.filter(r => r.active).length, hits, recurrences: misses, hitRate: hits + misses ? Number((hits / (hits + misses)).toFixed(2)) : null },
  };
}

// ─── Storage (never throws) ───────────────────────────────────────────────
let memory = new Map(); // key -> lesson (this instance; the fallback store)
let cache = { at: 0, rows: null };
let tableMissingUntil = 0;
let fetchImpl = (...args) => fetch(...args);

const fromRow = row => ({
  key: row.key, text: row.text, topic: row.topic || '', kind: row.kind || 'avoid', scope: row.scope, scopeValue: row.scope_value || '',
  evidence: Number(row.evidence || 0), hits: Number(row.hits || 0), recurrences: Number(row.recurrences || 0),
  firstSeen: row.first_seen, lastSeen: row.last_seen, lastRecurredAt: row.last_recurred_at || null, sources: row.sources || {},
});
function headers(token, extra = {}) {
  const config = authConfig();
  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const key = service || config.publishableKey;
  return { apikey: key, Authorization: `Bearer ${service || token}`, Accept: 'application/json', ...extra };
}
const missing = status => status === 404;

async function loadLessons({ token } = {}) {
  const local = [...memory.values()];
  if (cache.rows && Date.now() - cache.at < CACHE_MS) return mergeLists(cache.rows, local);
  if (!token || Date.now() < tableMissingUntil) return local;
  try {
    const query = 'select=key,text,topic,kind,scope,scope_value,evidence,hits,recurrences,sources,first_seen,last_seen,last_recurred_at&order=last_seen.desc&limit=400';
    const response = await fetchImpl(`${authConfig().url}/rest/v1/${TABLE}?${query}`, { headers: headers(token), signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      if (missing(response.status)) tableMissingUntil = Date.now() + MISSING_MS;
      return local;
    }
    const rows = await response.json();
    cache = { at: Date.now(), rows: Array.isArray(rows) ? rows.map(fromRow) : [] };
    return mergeLists(cache.rows, local);
  } catch (error) {
    return local;
  }
}
// Shared rows win, except where this instance has seen more since.
function mergeLists(shared = [], local = []) {
  const map = new Map(shared.map(l => [l.key, l]));
  local.forEach(l => {
    const other = map.get(l.key);
    if (!other || toTime(l.lastSeen) > toTime(other.lastSeen)) map.set(l.key, l);
  });
  return [...map.values()];
}

async function saveDeltas({ token, deltas = [] } = {}) {
  if (!deltas.length || !token || Date.now() < tableMissingUntil) return false;
  try {
    const rows = deltas.slice(0, 40).map(d => ({ key: d.key, text: clean(d.text), topic: clean(d.topic, 60), kind: d.kind, scope: d.scope, scope_value: clean(d.scopeValue, 60), d_evidence: Number(Math.min(5, d.evidence).toFixed(3)), d_hits: Math.min(5, d.hits), d_recurrences: Math.min(5, d.recurrences), recurred: Boolean(d.recurred) }));
    const response = await fetchImpl(`${authConfig().url}/rest/v1/rpc/${RPC}`, {
      method: 'POST',
      headers: headers(token, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_rows: rows, p_half_life_days: HALF_LIFE_DAYS }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok && missing(response.status)) tableMissingUntil = Date.now() + MISSING_MS;
    if (response.ok) cache = { at: 0, rows: null };
    return response.ok;
  } catch (error) {
    return false;
  }
}

// The lessons for a run's prompts. Never throws; [] without memory.
async function lessonsFor({ token, sport = '', archetypes = [], brand = '', limit = 6 } = {}) {
  try {
    return selectLessons(await loadLessons({ token }), { sport, archetypes, brand, limit });
  } catch (error) {
    return [];
  }
}

// Learn from signals. injected: lesson keys that were in this run's prompts.
// Returns { observed, lessons: changed lesson keys, saved }.
async function learn({ token, signals = [], injected = [] } = {}) {
  try {
    const observations = signals.flatMap(observationsFrom);
    if (!observations.length && !injected.length) return { observed: 0, changed: [], saved: false };
    const current = await loadLessons({ token });
    const { lessons, deltas } = distil(current, observations, { injected });
    const changed = new Set(deltas.map(d => d.key));
    lessons.filter(l => changed.has(l.key)).forEach(l => memory.set(l.key, l));
    if (memory.size > MAX_LESSONS) memory = new Map([...memory.entries()].sort((a, b) => decayed(b[1]) - decayed(a[1])).slice(0, MAX_LESSONS));
    const saved = await saveDeltas({ token, deltas });
    return { observed: observations.length, changed: [...changed], saved };
  } catch (error) {
    return { observed: 0, changed: [], saved: false };
  }
}

// A judge's critiques -> signals (one per improvement, plus nextTime).
function judgeSignals(directions = [], { sport = '', archetypeOf = {} } = {}) {
  const out = [];
  directions.forEach(d => {
    const archetype = archetypeOf[d.id] || d.archetype || '';
    (d.critique?.improvements || []).forEach(item => out.push({ type: 'judge', text: item.text, archetype, sport }));
    if (d.critique?.nextTime) out.push({ type: 'judge', text: d.critique.nextTime, archetype, sport });
  });
  return out;
}

// Normalises a page signal (mode 'creative-signal'). Returns { signal } or { error }.
function normalizeSignal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Invalid signal.' };
  const type = String(raw.type || '');
  if (!SIGNALS.includes(type) || type === 'judge') return { error: 'Unknown signal.' };
  const archetype = clean(raw.archetype, 40).replace(/[^\w-]/g, '');
  return {
    signal: {
      type,
      archetype,
      archetypeName: clean(raw.archetypeName, 40),
      sport: clean(raw.sport, 20),
      brand: clean(raw.brand, 40),
      text: clean(raw.text, 240),
      before: clean(raw.before, 200),
      after: clean(raw.after, 200),
      value: Math.max(-1, Math.min(1, Number(raw.value) || 0)),
      runId: /^[\w-]{1,64}$/.test(String(raw.runId || '')) ? String(raw.runId) : '',
      designId: clean(raw.designId, 40).replace(/[^\w:.-]/g, ''),
    },
  };
}

// The direction-events log row for a signal, where one fits (the table's
// type list is fixed): pick -> direction_chosen, export -> design_exported,
// thumbs / reject -> more / less_like_this, edits -> direction_edited,
// improvement and assistant -> fix_applied.
const EVENT_FOR = { pick: 'direction_chosen', export: 'design_exported', reject: 'less_like_this', edit: 'direction_edited', improvement: 'fix_applied', assistant: 'fix_applied' };
function eventFor(signal) {
  const type = signal.type === 'thumb' ? (signal.value < 0 ? 'less_like_this' : 'more_like_this') : EVENT_FOR[signal.type];
  if (!type) return null;
  const directionId = (signal.designId.split(':').pop() || '').replace(/[^\w-]/g, '').slice(0, 24) || undefined;
  return { type, runId: signal.runId || undefined, directionId, sport: signal.sport || undefined, angle: signal.text ? signal.text.slice(0, 160) : undefined, payload: { look: 'creative', signal: signal.type, archetype: signal.archetype, value: signal.value || undefined, ...(signal.before ? { before: { angle: signal.before }, after: { angle: signal.after } } : {}) } };
}

module.exports = {
  TOPICS, SIGNALS, SCOPES, HALF_LIFE_DAYS, ACTIVE_WEIGHT, SEED_LESSONS, withSeeds,
  topicOf, intentTopic, keyFor, observationsFrom, distil, decayed, hitRate, selectLessons, promptLines, adminView,
  loadLessons, lessonsFor, learn, judgeSignals, normalizeSignal, eventFor,
  _test: {
    reset: () => { memory = new Map(); cache = { at: 0, rows: null }; tableMissingUntil = 0; },
    setFetch: fn => { fetchImpl = fn; },
    memory: () => memory,
  },
};
