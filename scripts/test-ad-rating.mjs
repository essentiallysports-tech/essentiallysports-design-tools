#!/usr/bin/env node
// Video Ads rating (netlify/functions/_ad-rating.js + ad-rating.js +
// video-ads-rating.js), every network call mocked:
//   1. scoring: port of the rating pack's scoring.test.ts (weights, caps, verdicts)
//   2. validator: bad JSON, out-of-range, missing fields, enums, AI overall score ignored
//   3. handler: 401, 429, bad frames 400, happy path with cost, invalid-then-valid
//      retry, invalid twice, budget 503
//   4. client: panel HTML escaping and states, frame times
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const ratingPath = path.join(fnDir, '_ad-rating.js');
const handlerPath = path.join(fnDir, 'ad-rating.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

// ── Mocks ──────────────────────────────────────────────────────────────────
let signedIn = true;
let callsLastHour = 0;
let gatewayReplies = [];
let gatewayRequests = [];
let usageRows = [];
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    gatewayRequests.push(JSON.parse(options.body));
    const next = gatewayReplies.shift();
    if (!next) throw new Error('no gateway reply queued');
    if (next.status) return reply(next.status, next.body);
    return reply(200, { content: [{ type: 'text', text: next.text }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 1000 } });
  }
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsLastHour);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: 0, by_feature: {}, calls: 0 }]);
  if (href.includes('/rest/v1/frameup_ai_usage')) { usageRows.push(JSON.parse(options.body)); return reply(201, {}); }
  throw new Error(`unexpected fetch ${href}`);
};

process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GENERATE_AI;
[ratingPath, handlerPath, gwPath, authPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
  verifyEsUser: async () => (signedIn ? { ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };
const rating = require(ratingPath);
const { handler } = require(handlerPath);
const client = require(path.resolve('video-ads-rating.js'));
const { scoreCreative, compareCreativeScores, validateReview, WEIGHTS, RUBRIC_VERSION } = rating;

// ── 1. Scoring (port of scoring.test.ts) ───────────────────────────────────
const ctx = { objective: 'newsletterSubscriptions', creativeProvided: true, mediaInspectionConfidence: 'high' };
function makeReview(score) {
  const x = { score, evidence: ['Observed in the supplied creative'] };
  return {
    factors: { headlineOffer: { ...x }, cta: { ...x }, readability55Plus: { ...x }, trust: { ...x }, stopScroll: { ...x }, audienceFit: { ...x }, simplicity: { ...x }, placementFit: { ...x } },
    flags: { offerType: 'explicitFreeNewsletter', ctaAlignment: 'subscriptionAligned', coreMessageLegible: true, landingPageMatch: 'unknown', policyRisk: 'noneDetected' },
    strengths: [], weaknesses: [], topFixes: [], missingInputs: [],
  };
}
assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100, 'weights sum to 100');
assert.equal(RUBRIC_VERSION, 'frameup-newsletter-v1.0.0');
assert.equal(scoreCreative(makeReview(8.5), ctx).overallScore, 8.5, 'identical factor scores produce identical overall score');
{
  const r = makeReview(10); r.flags.ctaAlignment = 'articleClickMismatch';
  assert.equal(scoreCreative(r, ctx).overallScore, 7.5, 'wrong CTA caps direct-sub score at 7.5');
}
assert.equal(scoreCreative(makeReview(10), ctx).overallScore, 10, 'equivalent sign-up CTA does not trigger a cap');
{
  const r = makeReview(10); r.flags.landingPageMatch = 'mismatch';
  assert.equal(scoreCreative(r, ctx).overallScore, 10, 'missing LP never triggers mismatch cap');
  assert.equal(scoreCreative(r, { ...ctx, landingPageInspected: true }).overallScore, 6.5, 'inspected landing page mismatch caps score at 6.5');
}
{
  const r = makeReview(10); r.flags.coreMessageLegible = false;
  assert.equal(scoreCreative(r, ctx).overallScore, 6.5, 'unreadable core message caps score at 6.5');
}
{
  const r = makeReview(10); r.flags.offerType = 'notNewsletter';
  assert.equal(scoreCreative(r, ctx).overallScore, 5.9, 'no newsletter offer caps score at 5.9');
}
{
  const r = makeReview(10); r.flags.offerType = 'unclearOffer';
  assert.equal(scoreCreative(r, ctx).overallScore, 7.0, 'unclear offer caps score at 7.0');
}
{
  const r = makeReview(10); r.flags.ctaAlignment = 'missing';
  assert.equal(scoreCreative(r, ctx).overallScore, 7.5, 'no CTA caps direct-sub score at 7.5');
  assert.equal(scoreCreative(r, { ...ctx, objective: 'articleTraffic' }).overallScore, 10, 'CTA caps apply to direct subscription only');
}
{
  const r = makeReview(9); r.flags.policyRisk = 'potentialIssue';
  assert.equal(scoreCreative(r, ctx).verdict, 'Policy review required', 'a potential policy issue triggers manual review');
}
assert.match(compareCreativeScores(scoreCreative(makeReview(9), ctx), scoreCreative(makeReview(8.8), ctx)).assessment, /too close/, '<=0.3 is a tie');
assert.throws(() => scoreCreative(makeReview(11), ctx), 'rejects scores outside 1..10');
assert.throws(() => scoreCreative(makeReview(8), { ...ctx, creativeProvided: false }), 'creative media is required');
// Verdict thresholds and rounding.
assert.equal(scoreCreative(makeReview(8.5), ctx).verdict, 'Launch a test');
assert.equal(scoreCreative(makeReview(8.4), ctx).verdict, 'Revise first');
assert.equal(scoreCreative(makeReview(7.2), ctx).verdict, 'Revise first');
assert.equal(scoreCreative(makeReview(7.1), ctx).verdict, 'Redesign');
const SAMPLE = {
  factors: {
    headlineOffer: { score: 9.0, evidence: ['Headline names the free CFB newsletter'] },
    cta: { score: 9.5, evidence: ["White 'SIGN UP ES CFB' button sits under the copy"] },
    readability55Plus: { score: 9.0, evidence: ['Bold white headline on a dark scrim'] },
    trust: { score: 8.5, evidence: ["Essentially CFB logo and 'Unsubscribe anytime' visible"] },
    stopScroll: { score: 8.0, evidence: ['Frame 1 shows a diving touchdown catch'] },
    audienceFit: { score: 9.0, evidence: ['College football clip for a CFB newsletter'] },
    simplicity: { score: 8.5, evidence: ['One headline, two short paragraphs, one button'] },
    placementFit: { score: 8.5, evidence: ['Logo and CTA sit inside the 9:16 safe zone'] },
  },
  flags: { offerType: 'explicitFreeNewsletter', ctaAlignment: 'subscriptionAligned', coreMessageLegible: true, landingPageMatch: 'unknown', policyRisk: 'noneDetected' },
  strengths: ['Explicit free newsletter offer', 'Strong CTA hierarchy'],
  weaknesses: ['Body paragraph 2 is long'],
  topFixes: [
    { change: 'Cut body paragraph 2 to one line', performanceHypothesis: 'Faster read before the scroll', priority: 'high', effort: 'low' },
    { change: "Add 'free' to the CTA", performanceHypothesis: 'Removes price doubt', priority: 'high', effort: 'low' },
    { change: 'Open on the catch, not the huddle', performanceHypothesis: 'Stronger first-second hook', priority: 'medium', effort: 'medium' },
    { change: 'Fourth fix is dropped from the top three', performanceHypothesis: 'n/a', priority: 'low', effort: 'low' },
  ],
  missingInputs: ['Inspected landing page'],
};
{
  const result = scoreCreative(SAMPLE, ctx);
  assert.equal(result.overallScore, 8.9, 'sample review scores 8.9');
  assert.equal(result.topFixes.length, 3);
  assert.deepEqual(scoreCreative(SAMPLE, ctx), scoreCreative(SAMPLE, ctx), 'same inputs, same result');
  // FrameUp context shape works too.
  const frameup = scoreCreative(SAMPLE, { objective: 'newsletter_signup', placement: '9x16', creativeProvided: true, mediaInspectionConfidence: 'high' });
  assert.equal(frameup.overallScore, 8.9);
  assert.equal(frameup.confidence, 'medium', 'no inspected landing page: confidence stays medium');
  const capped = scoreCreative({ ...SAMPLE, flags: { ...SAMPLE.flags, ctaAlignment: 'articleClickMismatch' } }, { objective: 'newsletter_signup', creativeProvided: true });
  assert.equal(capped.overallScore, 7.5, 'newsletter_signup is a direct-subscription objective');
}

// ── 2. Validator ───────────────────────────────────────────────────────────
{
  let v = validateReview('Here you go: not json at all');
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /JSON/);
  v = validateReview('```json\n' + JSON.stringify(SAMPLE) + '\n```');
  assert.equal(v.ok, true, 'code-fenced JSON is accepted');
  v = validateReview(`Sure! ${JSON.stringify(SAMPLE)} Hope that helps.`);
  assert.equal(v.ok, true, 'JSON wrapped in prose is accepted');

  const outOfRange = structuredClone(SAMPLE);
  outOfRange.factors.cta.score = 11;
  outOfRange.factors.trust.score = 0;
  outOfRange.factors.simplicity.score = '7.5';
  v = validateReview(outOfRange);
  assert.equal(v.ok, true);
  assert.equal(v.review.factors.cta.score, 10, 'clamped down to 10');
  assert.equal(v.review.factors.trust.score, 1, 'clamped up to 1');
  assert.equal(v.review.factors.simplicity.score, 7.5, 'numeric string read as a number');
  assert.ok(v.repairs.some(r => /clamped/.test(r)));

  const missing = structuredClone(SAMPLE);
  delete missing.factors.placementFit;
  missing.factors.cta.evidence = [];
  missing.factors.trust.score = 'great';
  v = validateReview(missing);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /placementFit is missing/.test(e)));
  assert.ok(v.errors.some(e => /cta\.evidence/.test(e)));
  assert.ok(v.errors.some(e => /trust\.score/.test(e)));
  assert.equal(validateReview({ flags: SAMPLE.flags }).ok, false, 'factors required');
  assert.equal(validateReview({ factors: SAMPLE.factors }).ok, false, 'flags required');

  const enums = structuredClone(SAMPLE);
  enums.flags.ctaAlignment = 'SubscriptionAligned';
  enums.flags.coreMessageLegible = 'true';
  enums.factors.cta.evidence = 'A single evidence string';
  delete enums.missingInputs;
  enums.topFixes = [{ change: 'Do X', performanceHypothesis: 'Y', priority: 'urgent', effort: 'LOW' }, { nope: true }];
  v = validateReview(enums);
  assert.equal(v.ok, true);
  assert.equal(v.review.flags.ctaAlignment, 'subscriptionAligned');
  assert.equal(v.review.flags.coreMessageLegible, true);
  assert.deepEqual(v.review.factors.cta.evidence, ['A single evidence string']);
  assert.deepEqual(v.review.missingInputs, []);
  assert.deepEqual(v.review.topFixes, [{ change: 'Do X', performanceHypothesis: 'Y', priority: 'medium', effort: 'low' }]);
  const badEnum = structuredClone(SAMPLE);
  badEnum.flags.offerType = 'freeStuff';
  badEnum.flags.coreMessageLegible = 'maybe';
  v = validateReview(badEnum);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /offerType/.test(e)) && v.errors.some(e => /coreMessageLegible/.test(e)));

  const sneaky = { ...structuredClone(SAMPLE), overallScore: 2.1, verdict: 'Redesign', predictedCtr: '4.2%' };
  v = validateReview(sneaky);
  assert.equal(v.ok, true);
  assert.deepEqual(v.ignored.sort(), ['overallScore', 'predictedCtr', 'verdict']);
  assert.equal('overallScore' in v.review, false, 'AI overall score is dropped');
  assert.equal(scoreCreative(v.review, ctx).overallScore, 8.9, 'the AI-provided overall score is ignored');
}

// ── 3. Handler ─────────────────────────────────────────────────────────────
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ' + 'A'.repeat(200);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(200);
const CONTEXT = { brandId: 'essentially-cfb', brandLabel: 'Essentially CFB', sport: 'cfb', objective: 'newsletter_signup', placement: '9x16', headline: 'Never miss a <b>CFB</b> upset', body: ['Daily college football, free.'], cta: 'SIGN UP ES CFB', frameTimes: [0.5, 4, 7.5] };
const post = (body, { raw } = {}) => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: raw ?? JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const reset = () => { gatewayReplies = []; gatewayRequests = []; usageRows = []; callsLastHour = 0; signedIn = true; };

// 401: signed out, nothing reaches the model.
reset();
signedIn = false;
let res = await post({ frames: [JPEG], context: CONTEXT });
assert.equal(res.status, 401);
assert.equal(gatewayRequests.length, 0);

// 400: bad frames and context.
reset();
for (const [frames, pattern] of [
  [undefined, /at least one frame/],
  [[], /at least one frame/],
  [[JPEG, JPEG, JPEG, JPEG, JPEG], /at most 4/],
  [['https://example.com/frame.jpg'], /JPEG, PNG or WebP/],
  [['data:image/gif;base64,R0lGODlh'], /JPEG, PNG or WebP/],
  [['data:image/png;base64,/9j/4AAQ'], /not a valid PNG/],
  [[`data:image/jpeg;base64,/9j/${'A'.repeat(900 * 1024)}`], /too large/],
]) {
  res = await post({ frames, context: CONTEXT });
  assert.equal(res.status, 400, `frames ${JSON.stringify(frames)?.slice(0, 40)} refused`);
  assert.match(res.body.error, pattern);
}
assert.equal((await post({ frames: [JPEG], context: { ...CONTEXT, placement: '16x9' } })).status, 400);
assert.equal((await post({ frames: [JPEG], context: { ...CONTEXT, objective: 'article_traffic' } })).status, 400);
assert.equal((await post(null, { raw: '{not json' })).status, 400);
assert.equal((await post(null, { raw: 'x'.repeat(3.6 * 1024 * 1024) })).status, 413);
assert.equal(gatewayRequests.length, 0, 'bad input never reaches the model');

// 429: over the hourly AI limit.
reset();
callsLastHour = 500;
res = await post({ frames: [JPEG], context: CONTEXT });
assert.equal(res.status, 429);
assert.equal(res.body.reason, 'limit');
assert.equal(gatewayRequests.length, 0);

// 200: happy path. Haiku vision, cached rubric, base64 frames, server-side score, cost.
reset();
gatewayReplies.push({ text: JSON.stringify({ ...SAMPLE, overallScore: 3.0, verdict: 'Redesign' }) });
res = await post({ frames: [JPEG, PNG, JPEG], context: CONTEXT });
assert.equal(res.status, 200);
assert.equal(res.body.ok, true);
assert.equal(res.body.score, 8.9, 'score computed on the server, AI overall ignored');
assert.equal(res.body.verdict, 'Launch a test');
assert.deepEqual(res.body.caps, []);
assert.equal(res.body.factors.cta.rating, 9.5);
assert.equal(res.body.factors.cta.weight, 20);
assert.match(res.body.factors.cta.evidence[0], /SIGN UP ES CFB/);
assert.equal(res.body.fixes.length, 3);
assert.equal(res.body.confidence, 'medium');
assert.equal(res.body.flags.landingPageMatch, 'unknown');
assert.equal(res.body.model, 'anthropic/claude-haiku-5.5');
assert.equal(res.body.cost, 0.0009, '4000 in + 1000 out on Haiku');
assert.ok(res.body.cost < 0.01);
assert.equal(res.body.attempts, 1);
assert.equal(res.body.rubricVersion, RUBRIC_VERSION);
assert.equal(res.body.context.headline, 'Never miss a CFB upset', 'tags stripped from context');
assert.equal(res.body.context.league, 'College Football');
{
  assert.equal(gatewayRequests.length, 1);
  const sent = gatewayRequests[0];
  assert.equal(sent.model, 'anthropic/claude-haiku-5.5');
  assert.equal(sent.max_tokens, 2500);
  assert.ok(Array.isArray(sent.system) && sent.system[0].cache_control?.type === 'ephemeral', 'rubric prompt is cacheable');
  assert.match(sent.system[0].text, /never output an overall score/i);
  const content = sent.messages[0].content;
  const images = content.filter(block => block.type === 'image');
  assert.equal(images.length, 3);
  assert.deepEqual(images.map(b => b.source.media_type), ['image/jpeg', 'image/png', 'image/jpeg']);
  assert.ok(images.every(b => b.source.type === 'base64' && !b.source.data.startsWith('data:')));
  assert.ok(content.some(b => b.type === 'text' && /Frame 2 of 3 \(4\.0s\)/.test(b.text)));
  assert.ok(content.some(b => b.type === 'text' && /SIGN UP ES CFB/.test(b.text)));
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0].feature, 'video-ads-rating');
  assert.equal(usageRows[0].ok, true);
}

// A cap from the model's flags is applied on the server.
reset();
gatewayReplies.push({ text: JSON.stringify({ ...SAMPLE, flags: { ...SAMPLE.flags, coreMessageLegible: false } }) });
res = await post({ frames: [JPEG], context: CONTEXT });
assert.equal(res.body.score, 6.5);
assert.equal(res.body.verdict, 'Redesign');
assert.equal(res.body.caps[0].cap, 6.5);

// Invalid, then valid: one retry carrying the validation errors; cost adds up.
reset();
const broken = structuredClone(SAMPLE);
delete broken.factors.trust;
gatewayReplies.push({ text: JSON.stringify(broken) }, { text: JSON.stringify(SAMPLE) });
res = await post({ frames: [JPEG, JPEG], context: CONTEXT });
assert.equal(res.status, 200);
assert.equal(res.body.attempts, 2);
assert.equal(res.body.score, 8.9);
assert.equal(res.body.cost, 0.0018);
{
  const retry = gatewayRequests[1].messages;
  assert.equal(retry.length, 3);
  assert.equal(retry[1].role, 'assistant');
  assert.match(retry[2].content, /factors\.trust is missing/);
}

// Invalid twice: a clear error, no score.
reset();
gatewayReplies.push({ text: 'I think this ad is great, 9/10!' }, { text: '{"factors": {}}' });
const logError = console.error;
console.error = () => {};
res = await post({ frames: [JPEG], context: CONTEXT });
console.error = logError;
assert.equal(res.status, 502);
assert.equal(res.body.reason, 'invalid');
assert.match(res.body.error, /wrong format/);
assert.equal(res.body.score, undefined);
assert.equal(gatewayRequests.length, 2, 'only one retry');

// Gateway budget used up: free mode (ai-free-mode), never a raw error.
reset();
gatewayReplies.push({ status: 402, body: { error: { message: 'Spend limit reached for this API key' } } });
res = await post({ frames: [JPEG], context: CONTEXT });
assert.equal(res.status, 200);
assert.equal(res.body.mode, 'free');
assert.equal(res.body.reason, 'gateway-budget');
assert.equal(res.body.skipped, true);

// Cut-off reply: retried once asking for brevity.
reset();
gatewayReplies.push({ status: 200, body: { content: [{ type: 'text', text: '{"factors":' }], stop_reason: 'max_tokens', usage: {} } }, { text: JSON.stringify(SAMPLE) });
res = await post({ frames: [JPEG], context: CONTEXT });
assert.equal(res.status, 200);
assert.equal(res.body.attempts, 2);

// ── 4. Client helpers ──────────────────────────────────────────────────────
{
  const result = { ...res.body };
  result.factors = { ...result.factors, cta: { ...result.factors.cta, evidence: ['<img src=x onerror=alert(1)> CTA'] } };
  result.fixes = [{ change: '<script>alert(1)</script>', performanceHypothesis: 'a & b', priority: 'high' }];
  result.caps = [{ cap: 7.5, reason: 'No clear action to subscribe' }];
  const html = client.ratingPanelHtml(result);
  assert.ok(!/<script>|<img/.test(html), 'all text escaped');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; CTA/);
  assert.match(html, /a &amp; b/);
  assert.match(html, /8\.9/);
  assert.match(html, /Launch a test/);
  assert.match(html, /va-rate-verdict--good/);
  assert.match(html, /max 7\.5/);
  assert.match(html, /not a performance forecast/);
  assert.match(html, /Cost \$0\.0009/, 'the cut-off attempt is not billed by the gateway helper');
  assert.equal((html.match(/class="va-rate-factor"/g) || []).length, 8, 'all eight factors');
  assert.match(html, /role="meter"[^>]*aria-valuenow="9.5"/);
  assert.match(client.ratingPanelHtml({ loading: true }), /Rating the ad/);
  assert.match(client.ratingPanelHtml({ ok: false, error: 'Budget <used>' }), /role="alert">Budget &lt;used&gt;/);
  assert.deepEqual(client.pickFrameTimes(8), [0.5, 4, 7.5]);
  assert.deepEqual(client.pickFrameTimes(1, 2), [0.3, 0.8]);
  assert.deepEqual(client.pickFrameTimes(0), [0]);
  assert.equal(client.pickFrameTimes(30, 9).length, 4, 'never more than 4 frames');
  assert.equal(client.formatCost(0.00093), '$0.0009');

  // requestRating surfaces the server's plain-English error and reason.
  const fakeFetch = async () => reply(503, { ok: false, error: "This week's AI budget is used up.", reason: 'budget' });
  await assert.rejects(client.requestRating({ frames: [JPEG], context: CONTEXT, fetchImpl: fakeFetch }), err => err.status === 503 && err.reason === 'budget' && /budget/.test(err.message));
  const okFetch = async (url, options) => {
    assert.equal(url, '/api/ad-rating');
    assert.equal(JSON.parse(options.body).frames.length, 1);
    return reply(200, { ok: true, score: 8 });
  };
  assert.equal((await client.requestRating({ frames: [JPEG], context: CONTEXT, fetchImpl: okFetch })).score, 8);
}

// ── No-footage styles: the reviewer is told, the context carries the style ──
{
  assert.equal(rating.PROMPT_VERSION, 'frameup-video-ads-review-v1.2.0', 'prompt version bumped');
  assert.equal(rating.RUBRIC_VERSION, 'frameup-newsletter-v1.0.0', 'rubric unchanged: scores stay comparable');
  assert.deepEqual(rating.WEIGHTS, { headlineOffer: 20, cta: 20, readability55Plus: 15, trust: 15, stopScroll: 10, audienceFit: 10, simplicity: 5, placementFit: 5 }, 'weights unchanged');
  const p = rating.SYSTEM_PROMPT;
  assert.match(p, /never penalise an ad, or list a weakness or fix, for having no clip/);
  ['Today\'s 3', 'Us vs Them', 'animated gradient', 'slow zoom'].forEach(t => assert.ok(p.includes(t), `prompt mentions ${t}`));
  ['Stat Card', 'Quote Card', 'paid ads avoid league footage'].forEach(t => assert.ok(!p.includes(t), `prompt no longer mentions ${t}`));
  assert.match(p, /do not mark the CTA as missing because an early frame does not show it yet/);
  assert.doesNotMatch(p, /a trending sports clip \(NFL, college football or MLB\) under a dark scrim/, 'no longer assumes a clip');
  const ctx = rating.buildContext({ brandId: 'the-huddle', placement: '9x16', style: 'today3', background: 'animated', styleCopy: { listTitle: '<b>What fans</b> need', stat: '.412', items: ['a', '', 'b'], junk: 'x' } }, 2);
  assert.equal(ctx.style, 'today3');
  assert.equal(ctx.styleLabel, 'Today’s 3');
  assert.equal(ctx.background, 'animated');
  assert.deepEqual(ctx.styleCopy, { listTitle: 'What fans need', items: ['a', 'b'] }, 'removed-style fields are dropped');
  assert.equal(rating.buildContext({ style: 'stat' }, 1).style, '', 'a removed style is not a style');
  const old = rating.buildContext({ brandId: 'the-huddle', headline: 'x' }, 1);
  assert.equal(old.background, 'clip', 'older callers: a clip ad');
  assert.equal(old.style, '');
  assert.equal((await post({ frames: [JPEG], context: { ...CONTEXT, background: 'cartoon' } })).status, 400);
  assert.equal((await post({ frames: [JPEG], context: { ...CONTEXT, styleCopy: ['x'] } })).status, 400);
}

console.log('Ad rating tests passed.');
