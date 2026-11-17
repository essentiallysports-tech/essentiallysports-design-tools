'use strict';
// Video Ads rating: a vision model reads sampled frames of a newsletter-signup
// video ad and rates it on eight factors (1-10) with factual evidence, flags
// and fixes. The server validates that JSON and computes the score itself:
// the model never decides the overall score, the weights, the caps or the
// verdict.
//
// Ported from the "Frameup Ads creative rating engine" pack (types.ts,
// scoring.ts, AI_REVIEW_PROMPT.md). Same weights, caps, verdict thresholds,
// rounding and rubric version. Change WEIGHTS or the caps only together with
// a new RUBRIC_VERSION, so stored ratings stay comparable.
//
// Cost: the main tier (Claude Haiku, vision) with about 3 JPEG frames at
// 540px wide is roughly $0.001 per rating (about $0.002 if the one retry runs).

const { aiText } = require('./_ai-gateway.js');
const { AD_BRANDS, SIZES, STYLES } = require('../../video-ads-brands.js');

const RUBRIC_VERSION = 'frameup-newsletter-v1.0.0';
// v1.1.0: the reviewer knows the no-footage styles (Stat Card, Today's 3, Us vs
// Them, Quote Card), the animated / photo backgrounds and the timed reveals,
// so an ad without a clip is not marked down for "missing footage". The
// rubric (factors, weights, caps, verdicts) is unchanged, so RUBRIC_VERSION
// stays and scores remain comparable with v1.0.0 ratings.
const PROMPT_VERSION = 'frameup-video-ads-review-v1.1.0';
const PERFORMANCE_CLAIM = 'Hypothesis only; no CTR, conversion rate, or CAC is predicted.';

const FACTORS = Object.freeze([
  'headlineOffer',
  'cta',
  'readability55Plus',
  'trust',
  'stopScroll',
  'audienceFit',
  'simplicity',
  'placementFit',
]);

// Score contributions sum to 100.
const WEIGHTS = Object.freeze({
  headlineOffer: 20,
  cta: 20,
  readability55Plus: 15,
  trust: 15,
  stopScroll: 10,
  audienceFit: 10,
  simplicity: 5,
  placementFit: 5,
});

const FACTOR_LABELS = Object.freeze({
  headlineOffer: 'Headline / offer clarity',
  cta: 'CTA alignment / visibility',
  readability55Plus: '55+ readability',
  trust: 'Trust & credibility',
  stopScroll: 'Stop-scroll hook',
  audienceFit: 'Audience relevance',
  simplicity: 'Simplicity / cognitive load',
  placementFit: 'Placement fit',
});

const FLAG_ENUMS = Object.freeze({
  offerType: ['explicitFreeNewsletter', 'newsletterFreeUnclear', 'unclearOffer', 'notNewsletter'],
  ctaAlignment: ['subscriptionAligned', 'genericButAligned', 'articleClickMismatch', 'missing'],
  landingPageMatch: ['match', 'mismatch', 'unknown'],
  policyRisk: ['noneDetected', 'potentialIssue', 'needsReview'],
});
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const EFFORTS = ['low', 'medium', 'high'];
const VERDICTS = ['Launch a test', 'Revise first', 'Redesign', 'Policy review required'];

const round1 = x => Math.round((x + Number.EPSILON) * 10) / 10;

// ─── Scoring (port of scoring.ts) ──────────────────────────────────────────

function assertReview(r) {
  if (!r || !r.factors || !r.flags) throw new Error('Invalid review: factors and flags are required');
  for (const key of FACTORS) {
    const item = r.factors[key];
    if (!item || typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 1 || item.score > 10) {
      throw new Error(`Invalid score for ${key}: expected a finite number from 1 to 10`);
    }
    if (!Array.isArray(item.evidence) || item.evidence.length < 1 || item.evidence.some(v => typeof v !== 'string' || !v.trim())) {
      throw new Error(`Missing observable evidence for ${key}`);
    }
  }
  for (const [key, allowed] of Object.entries(FLAG_ENUMS)) {
    if (!allowed.includes(String(r.flags[key]))) throw new Error(`Invalid flag: ${key}`);
  }
  if (![true, false, null].includes(r.flags.coreMessageLegible)) throw new Error('Invalid coreMessageLegible');
  if (!Array.isArray(r.strengths) || !Array.isArray(r.weaknesses) || !Array.isArray(r.topFixes) || !Array.isArray(r.missingInputs)) {
    throw new Error('Review narratives must be arrays');
  }
}

// Accepts the pack's ReviewContext ({ objective: 'newsletterSubscriptions',
// placement: 'feed' | 'storiesReels' | 'mixed', creativeProvided, ... }) or a
// FrameUp Video Ads context ({ objective: 'newsletter_signup', placement:
// '9x16' | '4x5' | '1x1', ... }).
function normalizeScoringContext(context = {}) {
  const objective = context.objective === 'newsletter_signup' ? 'newsletterSubscriptions' : context.objective;
  const placementMap = { '9x16': 'storiesReels', '4x5': 'feed', '1x1': 'feed' };
  return {
    ...context,
    objective,
    placement: placementMap[context.placement] || context.placement,
  };
}

/**
 * Deterministic score. The AI describes and scores factors, but cannot decide
 * the final overall result, weights, thresholds, or hard caps. Caps are not
 * point deductions (the factor scores already reflect the weakness).
 */
function scoreCreative(review, rawContext) {
  assertReview(review);
  const context = normalizeScoringContext(rawContext);
  if (!context.creativeProvided) throw new Error('Creative media is required for a creative rating');
  const weightValues = Object.values(WEIGHTS);
  if (!weightValues.length || weightValues.reduce((a, b) => a + b, 0) !== 100) {
    throw new Error('Rubric weights must total exactly 100');
  }

  const factors = FACTORS.map(factor => {
    const assessment = review.factors[factor];
    const weight = WEIGHTS[factor];
    return {
      factor,
      weight,
      score: assessment.score,
      weightedContribution: round1((assessment.score * weight) / 100),
      evidence: assessment.evidence,
      ...(assessment.weakness ? { weakness: assessment.weakness } : {}),
    };
  });

  // Do not sum rounded contributions: use the raw input scores for precision.
  const raw = FACTORS.reduce((sum, factor) => sum + (review.factors[factor].score * WEIGHTS[factor]) / 100, 0);
  const caps = [];
  const directSubscription = context.objective === 'newsletterSubscriptions';

  if (directSubscription) {
    if (review.flags.offerType === 'notNewsletter') caps.push({ cap: 5.9, reason: 'The creative does not communicate a newsletter offer' });
    if (review.flags.offerType === 'unclearOffer') caps.push({ cap: 7.0, reason: 'The actual offer is unclear' });
    if (review.flags.ctaAlignment === 'articleClickMismatch') caps.push({ cap: 7.5, reason: 'Article-click CTA conflicts with the subscription objective' });
    if (review.flags.ctaAlignment === 'missing') caps.push({ cap: 7.5, reason: 'No clear action to subscribe' });
    // Having no exact phrase "Subscribe for Free" is NOT an automatic failure.
  }
  if (review.flags.coreMessageLegible === false) caps.push({ cap: 6.5, reason: 'Core message is not readable at realistic mobile size' });
  if (context.landingPageInspected && review.flags.landingPageMatch === 'mismatch') {
    caps.push({ cap: 6.5, reason: 'Ad promise and inspected landing page are materially inconsistent' });
  }

  const capLimit = Math.min(10, ...caps.map(c => c.cap));
  const overallScore = round1(Math.min(raw, capLimit));

  let verdict;
  if (review.flags.policyRisk === 'needsReview' || review.flags.policyRisk === 'potentialIssue') verdict = 'Policy review required';
  else if (overallScore >= 8.5) verdict = 'Launch a test';
  else if (overallScore >= 7.2) verdict = 'Revise first';
  else verdict = 'Redesign';

  let confidence = 'low';
  if (context.mediaInspectionConfidence !== 'low' && context.objective && context.creativeProvided) confidence = 'medium';
  if (context.mediaInspectionConfidence === 'high' && context.placement && context.landingPageInspected) confidence = 'high';

  return {
    rubricVersion: RUBRIC_VERSION,
    rawScore: round1(raw),
    overallScore,
    appliedCaps: caps,
    factors,
    verdict,
    confidence,
    performanceClaim: PERFORMANCE_CLAIM,
    strengths: review.strengths,
    weaknesses: review.weaknesses,
    topFixes: review.topFixes.slice(0, 3),
    missingInputs: review.missingInputs,
  };
}

function compareCreativeScores(a, b) {
  const delta = round1(a.overallScore - b.overallScore);
  const assessment = Math.abs(delta) <= 0.3
    ? 'The scores are too close to justify a confident creative winner; A/B test.'
    : delta > 0
      ? 'A has a stronger pre-launch creative assessment; validate with an A/B test.'
      : 'B has a stronger pre-launch creative assessment; validate with an A/B test.';
  return { delta, assessment, neverTreatAsMeasuredLift: true };
}

// ─── Runtime validation of the model's JSON ────────────────────────────────
// Strict on what matters (all eight factors with a numeric score and at least
// one evidence string, valid flag values), forgiving on form: numeric strings,
// out-of-range scores (clamped to 1-10), a single evidence string, enum case,
// missing narrative arrays. Anything the model adds beyond the schema
// (overallScore, verdict, weighted sums, CTR forecasts) is dropped.

const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function parseModelJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'The reply was empty.' };
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const candidates = [unfenced];
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(unfenced.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value };
    } catch { /* try the next candidate */ }
  }
  return { ok: false, error: 'The reply was not a single valid JSON object.' };
}

function matchEnum(value, allowed) {
  const wanted = String(value ?? '').replace(/[\s_-]/g, '').toLowerCase();
  return allowed.find(option => option.toLowerCase() === wanted) || null;
}

function toScore(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value.trim()))) return Number(value.trim());
  return NaN;
}

function stringList(value, { maxItems, maxLength }) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
  return list.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

// Returns { ok, review, errors, repairs, ignored }. `review` is set only when ok.
function validateReview(input) {
  const errors = [];
  const repairs = [];
  let data = input;
  if (typeof input === 'string') {
    const parsed = parseModelJson(input);
    if (!parsed.ok) return { ok: false, errors: [parsed.error], repairs, ignored: [] };
    data = parsed.value;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['The reply must be a JSON object.'], repairs, ignored: [] };
  }
  const known = ['factors', 'flags', 'strengths', 'weaknesses', 'topFixes', 'missingInputs'];
  const ignored = Object.keys(data).filter(key => !known.includes(key));

  const factors = {};
  const rawFactors = data.factors && typeof data.factors === 'object' ? data.factors : null;
  if (!rawFactors) errors.push('"factors" is missing; it must be an object with all eight factor keys.');
  for (const key of FACTORS) {
    const item = rawFactors ? rawFactors[key] : null;
    if (!rawFactors) break;
    if (!item || typeof item !== 'object') {
      errors.push(`factors.${key} is missing.`);
      continue;
    }
    let score = toScore(item.score);
    if (!Number.isFinite(score)) {
      errors.push(`factors.${key}.score must be a number from 1 to 10.`);
      continue;
    }
    if (typeof item.score !== 'number') repairs.push(`factors.${key}.score was text; read as a number`);
    if (score < 1 || score > 10) {
      repairs.push(`factors.${key}.score ${score} clamped to 1-10`);
      score = Math.min(10, Math.max(1, score));
    }
    const evidence = stringList(item.evidence, { maxItems: 3, maxLength: 280 });
    if (!evidence.length) {
      errors.push(`factors.${key}.evidence needs at least one string describing what is visible.`);
      continue;
    }
    const weakness = cleanText(item.weakness, 280);
    factors[key] = { score, evidence, ...(weakness ? { weakness } : {}) };
  }

  const flags = {};
  const rawFlags = data.flags && typeof data.flags === 'object' ? data.flags : null;
  if (!rawFlags) errors.push('"flags" is missing.');
  else {
    for (const [key, allowed] of Object.entries(FLAG_ENUMS)) {
      const value = matchEnum(rawFlags[key], allowed);
      if (!value) errors.push(`flags.${key} must be one of: ${allowed.join(', ')}.`);
      else {
        if (value !== rawFlags[key]) repairs.push(`flags.${key} normalized to ${value}`);
        flags[key] = value;
      }
    }
    const legible = rawFlags.coreMessageLegible;
    if (legible === true || legible === false || legible === null) flags.coreMessageLegible = legible;
    else if (['true', 'false', 'null'].includes(String(legible).trim().toLowerCase())) {
      flags.coreMessageLegible = JSON.parse(String(legible).trim().toLowerCase());
      repairs.push('flags.coreMessageLegible was text; read as a value');
    } else errors.push('flags.coreMessageLegible must be true, false or null.');
  }

  const narrative = key => {
    if (!Array.isArray(data[key])) repairs.push(`${key} was not a list; treated as empty`);
    return stringList(Array.isArray(data[key]) ? data[key] : [], { maxItems: 5, maxLength: 280 });
  };
  const strengths = narrative('strengths');
  const weaknesses = narrative('weaknesses');
  const missingInputs = narrative('missingInputs');
  if (!Array.isArray(data.topFixes)) repairs.push('topFixes was not a list; treated as empty');
  const topFixes = (Array.isArray(data.topFixes) ? data.topFixes : [])
    .filter(fix => fix && typeof fix === 'object' && cleanText(fix.change, 280))
    .slice(0, 5)
    .map(fix => ({
      change: cleanText(fix.change, 280),
      performanceHypothesis: cleanText(fix.performanceHypothesis, 280),
      priority: matchEnum(fix.priority, PRIORITIES) || 'medium',
      effort: matchEnum(fix.effort, EFFORTS) || 'medium',
    }));

  if (errors.length) return { ok: false, errors, repairs, ignored };
  return { ok: true, review: { factors, flags, strengths, weaknesses, topFixes, missingInputs }, errors: [], repairs, ignored };
}

// ─── Prompt (AI_REVIEW_PROMPT.md adapted for FrameUp video ads) ─────────────

const SYSTEM_PROMPT = `You are a senior Meta performance creative reviewer for free US sports newsletter acquisition, especially audiences aged 55+. The goal is qualified newsletter subscriptions at efficient CAC, not vanity CTR, aesthetic prestige or curiosity clicks. Apply this rubric to the ad's actual visible content. Treat previously observed audience preferences as hypotheses, not rules.

## What you are reviewing
EssentiallySports newsletter-signup VIDEO ads made in FrameUp for NFL, college football or MLB newsletters. Every ad has the newsletter's logo, copy, a white CTA button such as "SIGN UP ES CFB" and the line "Unsubscribe anytime". The objective is direct newsletter subscription.
The background is one of: a sports clip, an animated gradient in team or brand colours, or a still photo with a slow zoom. The context's "background" says which. An animated or photo background is a deliberate choice (paid ads avoid league footage): never penalise an ad, or list a weakness or fix, for having no clip, no game footage or no action shot; judge whether the copy and the layout carry the message on their own.
The context's "style" says which layout it is:
- simple / condensed / highlight: a centred block of copy (a headline plus short body paragraphs; condensed = bold condensed headline; highlight = one phrase on a coloured box).
- stat (Stat Card): one big number with a line saying what it counts and an offer line. The number comes from the editor's brief.
- today3 (Today's 3): a title and three real headlines that appear one after another, then the offer.
- versus (Us vs Them): a "Your feed" card with struck-through lines vs a card in the newsletter's colour with ticked claims (claims come from an approved list).
- quote (Quote Card): a verbatim, attributed quote, then the offer.
These styles reveal their parts over time: early frames may show only the hook (the number, the title, the quote, the two cards) while later frames add the rows, ticks, offer and CTA; the CTA is up by 40% of the duration and holds to the end. Judge the hook on the first frame and the full message on the last frame; do not mark the CTA as missing because an early frame does not show it yet.
You receive a few still frames sampled from the exported video (in time order, labeled with their time), downscaled to about 540px wide. A phone shows the full-width ad at roughly 390pt wide, so these frames are close to real phone size: judge legibility as you see it. You also receive the campaign context as JSON: brand, sport, audience, placement with its safe zones, the style and background, the copy the designer typed (styleCopy for the no-footage styles), and any verified claims.
Do NOT claim to have seen anything not supplied: no audio, no landing page, no metrics. Rate only what is visible in the frames. If the typed copy is not visible in the frames, say so as evidence. For video, judge the first-frame hook, sound-off comprehension (the copy must work with no audio), whether the background reads at a glance, and whether the copy stays readable over it.

## Output contract: JSON only, no Markdown, no code fences
Return exactly this shape:
{"factors":{"headlineOffer":{"score":0,"evidence":["..."],"weakness":"..."},"cta":{...},"readability55Plus":{...},"trust":{...},"stopScroll":{...},"audienceFit":{...},"simplicity":{...},"placementFit":{...}},"flags":{"offerType":"...","ctaAlignment":"...","coreMessageLegible":true,"landingPageMatch":"unknown","policyRisk":"..."},"strengths":["..."],"weaknesses":["..."],"topFixes":[{"change":"...","performanceHypothesis":"...","priority":"high","effort":"low"}],"missingInputs":["..."]}
NEVER output an overall score, weighted sums, a verdict, or CTR/CPC/CAC numbers: the server calculates the result.

"factors" must contain all eight keys:
- headlineOffer (20%): Is the newsletter and its specific benefit apparent within a quick glance? Does the hook match what the newsletter delivers?
- cta (20%): Is the requested action prominent, clear, newsletter-aligned, ideally explicit that signup is free? "Subscribe for Free" is useful but not mandatory verbatim; "SIGN UP <NEWSLETTER>" is a clear signup action.
- readability55Plus (15%): Real mobile-size visibility, type weight, contrast against the background (footage, gradient or photo) and its tint, hierarchy and legibility for 55+ readers. Do not require all caps.
- trust (15%): Is the brand identifiable (logo, name)? Is the offer credible? "Unsubscribe anytime" lowers risk. Only reward social proof, free-forever claims or reading-time promises if they appear in verifiedClaims.
- stopScroll (10%): Does the first frame give an immediate, relevant visual or copy hook without clickbait? Never fabricate color-based performance gains.
- audienceFit (10%): Is the creative right for this specific sport and audience? For an MLB newsletter do not penalize the absence of NFL.
- simplicity (5%): One focal message, little clutter, manageable cognitive load across the frames.
- placementFit (5%): Is essential content (logo, headline, CTA) inside the placement's safe zones and clear of platform UI? If you cannot tell, give a qualified judgment and add it to missingInputs.

Score each from 1 to 10, ideally in 0.5 steps. Each factor needs at least one evidence string (under 25 words) stating what is actually visible, and may include a weakness. No generic praise. Calibrate to these anchors:
1-3 severely broken; 4-5 fundamental offer, legibility or CTA weakness; 6-6.9 adequate with substantial barriers; 7-7.9 workable but meaningful flaws; 8-8.9 strong with concrete refinements; 9-9.4 unusually clear, compelling, trustworthy; 9.5-10 exceptional, rare, near-flawless for this objective. Do not imply any CTR/CPC/CAC for a score.

## Flags (strict meanings)
offerType:
- explicitFreeNewsletter: the creative explicitly states newsletter and free (or an obvious equivalent).
- newsletterFreeUnclear: clearly a newsletter, but price / free is not clear.
- unclearOffer: a viewer cannot tell what is being offered.
- notNewsletter: the creative visibly promotes something other than a newsletter signup.
ctaAlignment:
- subscriptionAligned: clearly directs the viewer to subscribe or sign up; exact words not required.
- genericButAligned: a generic but plausible signup action (e.g. "Get Updates") with a clear newsletter offer.
- articleClickMismatch: promises "Read Full Story", "Watch Now" or similar instead of a subscription.
- missing: no discernible action in any frame.
coreMessageLegible: true; false only if the headline/offer is visibly illegible at phone size; null if frame quality or crop prevents judging.
landingPageMatch: always "unknown" (no landing page content is supplied). Never infer from a URL.
policyRisk: noneDetected / potentialIssue / needsReview. Never say an ad is approved or rejected by Meta; note potential risks only (for example league or team marks used as an endorsement, misleading claims).

## Improvements
Give 2-3 strengths, 2-3 weaknesses and 3-5 topFixes, each with the exact change, a testable performanceHypothesis, priority (critical, high, medium, low) and effort (low, medium, high). Order fixes by likely impact on qualified signup CAC: offer, CTA, readability, trust, audience, hook, cosmetic. No numerical lift estimates. missingInputs lists key unknowns (inspected landing page, audio, past results) only if relevant.

## Constraints
- Never assume subscriber counts, a "5-minute read" or "free forever"; use only claims visible on the creative or in verifiedClaims, and flag unsupported claims.
- Do not automatically prefer red over blue, faces over no faces, footage over no footage, a set number of headline blocks, icon pills, phone mockups, black buttons or all caps.
- No blind color rules.
- This is not Meta's Quality, Engagement or Conversion Ranking.
- Every negative observation must reference a specific element (e.g. "Body paragraph 2 sits on the bright crowd and loses contrast").`;

const STYLE_IDS = Object.keys(STYLES);
const BACKGROUNDS = ['clip', 'animated', 'photo'];
// The no-footage styles' typed copy, sanitised; only fields that are set.
function styleCopyOf(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out = {};
  ['offer', 'stat', 'statLabel', 'statSource', 'listTitle', 'quote', 'speaker', 'quoteContext'].forEach(k => { const v = sanitizeText(input[k], 300); if (v) out[k] = v; });
  ['items', 'them', 'us'].forEach(k => { const v = (Array.isArray(input[k]) ? input[k] : []).map(x => sanitizeText(x, 200)).filter(Boolean).slice(0, 3); if (v.length) out[k] = v; });
  return out;
}

function sanitizeText(value, max) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// The context object the model sees (and that is returned/stored).
function buildContext(context = {}, frameCount = 0) {
  const brand = AD_BRANDS.find(b => b.id === context.brandId) || null;
  const placement = SIZES[context.placement] ? context.placement : '9x16';
  const size = SIZES[placement];
  const frameTimes = Array.isArray(context.frameTimes)
    ? context.frameTimes.slice(0, frameCount).map(t => Math.max(0, Math.round(Number(t) * 10) / 10 || 0))
    : [];
  return {
    brandId: brand ? brand.id : sanitizeText(context.brandId, 60),
    brandLabel: sanitizeText(context.brandLabel, 80) || (brand ? brand.label : ''),
    sport: sanitizeText(context.sport, 20).toLowerCase() || (brand ? brand.sport : ''),
    league: brand ? brand.league : '',
    audience: brand ? brand.audience : '',
    objective: 'newsletter_signup',
    placement,
    placementLabel: size.label,
    canvas: { width: size.width, height: size.height, safeZones: size.safe },
    headline: sanitizeText(context.headline, 300),
    body: (Array.isArray(context.body) ? context.body : []).map(p => sanitizeText(p, 600)).filter(Boolean).slice(0, 6),
    cta: sanitizeText(context.cta, 60),
    style: STYLE_IDS.includes(context.style) ? context.style : '',
    styleLabel: STYLE_IDS.includes(context.style) ? STYLES[context.style].label : '',
    background: BACKGROUNDS.includes(context.background) ? context.background : 'clip',
    styleCopy: styleCopyOf(context.styleCopy),
    verifiedClaims: (Array.isArray(context.verifiedClaims) ? context.verifiedClaims : []).map(c => sanitizeText(c, 200)).filter(Boolean).slice(0, 5),
    frameTimes,
    landingPageInspected: false,
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  return match ? { mediaType: match[1], data: match[2] } : null;
}

function buildUserContent(frames, ctx) {
  const content = [];
  frames.forEach((frame, index) => {
    const parsed = parseDataUrl(frame);
    if (!parsed) throw Object.assign(new Error(`Frame ${index + 1} is not a JPEG, PNG or WebP data URL.`), { code: 'bad_frame' });
    const time = ctx.frameTimes[index];
    content.push({ type: 'text', text: `Frame ${index + 1} of ${frames.length}${Number.isFinite(time) ? ` (${time.toFixed(1)}s)` : ''}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data } });
  });
  const { frameTimes, landingPageInspected, ...shown } = ctx;
  content.push({
    type: 'text',
    text: `Campaign context (JSON):\n${JSON.stringify(shown)}\n\nNo landing page content is supplied, so landingPageMatch must be "unknown". Return only the JSON object.`,
  });
  return content;
}

// Shape returned to the browser.
function toPublicResult(scored, review, ctx, meta) {
  const factors = {};
  scored.factors.forEach(item => {
    factors[item.factor] = {
      label: FACTOR_LABELS[item.factor],
      weight: item.weight,
      rating: item.score,
      contribution: item.weightedContribution,
      evidence: item.evidence,
      ...(item.weakness ? { weakness: item.weakness } : {}),
    };
  });
  return {
    ok: true,
    rubricVersion: scored.rubricVersion,
    promptVersion: PROMPT_VERSION,
    score: scored.overallScore,
    rawScore: scored.rawScore,
    verdict: scored.verdict,
    caps: scored.appliedCaps,
    factors,
    flags: review.flags,
    strengths: scored.strengths,
    weaknesses: scored.weaknesses,
    fixes: scored.topFixes,
    missingInputs: scored.missingInputs,
    confidence: scored.confidence,
    performanceClaim: scored.performanceClaim,
    context: ctx,
    assessment: review,
    model: meta.model,
    cost: Number(meta.cost.toFixed(6)),
    attempts: meta.attempts,
    ratedAt: new Date().toISOString(),
  };
}

const MAX_TOKENS = 2500;

/**
 * Rates one video ad from its frames. Throws on gateway errors (callers check
 * isBudgetError) and, after one retry, on a reply that still fails validation
 * (error.code === 'invalid_review', error.cost = spend so far).
 */
async function rateCreative({ frames, context, track, tier = 'main', timeoutMs = 25000 } = {}) {
  const list = Array.isArray(frames) ? frames.filter(Boolean) : [];
  if (!list.length) throw Object.assign(new Error('At least one frame is needed to rate an ad.'), { code: 'bad_frame' });
  const ctx = buildContext(context, list.length);
  const firstTurn = { role: 'user', content: buildUserContent(list, ctx) };
  const trackInfo = track ? { ...track, feature: track.feature || 'video-ads-rating' } : undefined;

  let cost = 0;
  let model = '';
  let messages = [firstTurn];
  let lastErrors = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let text = '';
    try {
      const reply = await aiText({ tier, system: SYSTEM_PROMPT, cacheSystem: true, messages, effort: 'low', maxTokens: MAX_TOKENS, timeoutMs, track: trackInfo });
      text = reply.text;
      cost += reply.cost || 0;
      model = reply.model;
    } catch (error) {
      // A cut-off reply is retried once with a request to be brief; anything
      // else (budget, network) goes straight to the caller.
      if (attempt === 1 && /cut off/i.test(String(error.message))) {
        lastErrors = ['The reply was too long and was cut off.'];
        messages = [{ role: 'user', content: [...firstTurn.content, { type: 'text', text: 'A previous reply was too long and was cut off: keep every evidence string under 20 words and give at most 3 topFixes.' }] }];
        continue;
      }
      throw error;
    }
    const checked = validateReview(text);
    if (checked.ok) {
      // No landing page is ever inspected here.
      const review = { ...checked.review, flags: { ...checked.review.flags, landingPageMatch: 'unknown' } };
      const scored = scoreCreative(review, {
        objective: ctx.objective,
        placement: ctx.placement,
        creativeProvided: true,
        landingPageInspected: false,
        mediaInspectionConfidence: list.length >= 3 ? 'high' : 'medium',
      });
      return toPublicResult(scored, review, ctx, { model, cost, attempts: attempt });
    }
    lastErrors = checked.errors;
    messages = [
      firstTurn,
      { role: 'assistant', content: String(text).slice(0, 6000) || '(empty reply)' },
      { role: 'user', content: `That reply did not match the required JSON:\n- ${checked.errors.slice(0, 12).join('\n- ')}\nReturn the corrected, complete JSON object only.` },
    ];
  }
  throw Object.assign(new Error('The rating came back in the wrong format twice. Try again in a moment.'), {
    code: 'invalid_review',
    errors: lastErrors,
    cost: Number(cost.toFixed(6)),
  });
}

module.exports = {
  RUBRIC_VERSION,
  PROMPT_VERSION,
  PERFORMANCE_CLAIM,
  FACTORS,
  WEIGHTS,
  FACTOR_LABELS,
  FLAG_ENUMS,
  VERDICTS,
  SYSTEM_PROMPT,
  scoreCreative,
  compareCreativeScores,
  validateReview,
  parseModelJson,
  parseDataUrl,
  buildContext,
  rateCreative,
};
