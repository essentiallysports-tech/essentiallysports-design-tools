// ES guidelines (es-guidelines.js), the Guideline check that gates every
// Generate design, and "Bring it on-brand" (netlify/functions/_onbrand.js +
// es-generate mode 'onbrand'): the vision critique (mocked), its validation,
// the slide -> ES template mapping and the remake. Unexpected fetches throw.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const authPath = path.join(fnDir, '_supabase-auth.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const GUIDE = require('../es-guidelines.js');
const BRAND_KIT = require('../brand-kit.js');
const onbrand = require('../netlify/functions/_onbrand.js');
const { findTeam } = require('../netlify/functions/_lint-spec.js');

// ─── 1. The spec itself ───────────────────────────────────────────────────
assert.ok(GUIDE.RULES.length >= 25);
GUIDE.RULES.forEach(rule => {
  assert.match(rule.id, /^[a-z-]+$/, rule.id);
  assert.ok(['must', 'should'].includes(rule.level), `${rule.id} level`);
  assert.ok(rule.source && rule.rule, `${rule.id} cites a source`);
  assert.ok(['template', 'check', 'review'].includes(rule.enforced), `${rule.id} enforced`);
});
assert.equal(new Set(GUIDE.RULES.map(r => r.id)).size, GUIDE.RULES.length, 'rule ids are unique');
assert.equal(GUIDE.SAFE_AREA.px, 50);
assert.equal(GUIDE.MIST.opacity, 0.9);
assert.equal(GUIDE.SWIPE.size, '200×56px');
assert.equal(GUIDE.LOGO.placement.withSwipe, 'top-left');
assert.match(GUIDE.FONTS.headline.family, /Acumin Pro Condensed/);
assert.ok(GUIDE.UNCLEAR.length >= 5, 'what the images do not say is listed for Suhail');
assert.match(GUIDE.critiqueRulesText(), /- no-outlined-type \[must\]/);
assert.ok(GUIDE.directorLines().some(line => /no outlined or stroked type/.test(line)));

// ─── 2. The Guideline check (hard gate) ───────────────────────────────────
const TEMPLATES = Object.fromEntries(GUIDE.TEMPLATES.map(t => [t, { label: t }]));
const ctx = extra => ({ brandKit: BRAND_KIT, templates: TEMPLATES, resolveTeam: findTeam, ...extra });
let spec = { postType: 'carousel-slide', fields: {} };
assert.equal(GUIDE.checkDesign(spec, ctx()).ok, false, 'a non-ES template never passes');
assert.equal(GUIDE.checkDesign(spec, ctx()).errors[0].rule, 'es-template');

spec = { postType: 'cover', sport: 'NFL', team: 'Kansas City Chiefs', fields: { pills: ['Can Anyone', 'Stop Him?'], font: 'Druk Wide', stroke: '#FFD100' }, alts: [{ fields: { pills: ['x'], color: 'red' } }], paletteIdx: 9 };
let check = GUIDE.checkDesign(spec, ctx({ lint: { errors: [], warnings: [{ code: 'auto-split' }] } }));
assert.equal(check.ok, true);
assert.equal(spec.fields.font, undefined, 'font overrides are stripped');
assert.equal(spec.fields.stroke, undefined, 'outlines are stripped');
assert.equal(spec.alts[0].fields.color, undefined);
assert.equal(spec.team, 'Kansas City Chiefs', 'a kit team (any spelling the checker knows) stays');
assert.equal(spec.paletteIdx, undefined, 'an off-palette index is reset');
assert.deepEqual(check.fixes.map(f => f.rule), ['font-family', 'team-palette', 'text-fit']);

spec = { postType: 'stats-single-ent', sport: 'NFL', team: 'Gotham Rogues', fields: { headline: 'X', stats: [] } };
check = GUIDE.checkDesign(spec, ctx());
assert.equal(spec.team, '', 'an off-kit team falls back to the neutral ES look');
assert.ok(check.fixes.some(f => f.rule === 'mist-team-colour'), 'stats without a team say the mist needs one');

check = GUIDE.checkDesign({ postType: 'cover', fields: {} }, ctx({ lint: { errors: [{ code: 'banned', msg: 'no hashtags' }, { code: 'unsourced-number', msg: 'invented 41' }], warnings: [] } }));
assert.equal(check.ok, false);
assert.deepEqual(check.errors.map(e => e.rule), ['banned-words', 'real-facts'], 'brand-checker errors map to guideline rules');

// ─── 3. Critique validation and the slide mapping ─────────────────────────
const RAW = {
  read: { subject: 'Caitlin Clark', team: 'Indiana Fever', sport: 'WNBA', story: 'Clark moved TV, arenas and sneakers' },
  headline: 'The Caitlin Clark Effect',
  slides: [
    { role: 'cover', text: ['CAITLIN CLARK', 'One player. Every number moved.', 'THE CAITLIN CLARK EFFECT', 'SWIPE'], numbers: [], entities: [] },
    { role: 'stats', text: ['FEVER VS DREAM', '2.6M AVERAGE', '4M PEAK', '+178% VS ESPN AVG'], numbers: [{ value: '2.6M', label: 'AVERAGE' }, { value: '4M', label: 'PEAK' }, { value: '+178%', label: 'VS ESPN AVG' }, { value: '9.9M', label: 'INVENTED' }] },
    { role: 'stats', text: ['CLARK SEASON', '30 PTS', '9 AST', '6 REB'], numbers: [{ value: '30', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '6', label: 'REB' }] },
  ],
  issues: [
    { rule: 'font-family', slide: 1, what: 'Wide grotesque display font on the name', why: 'ES headlines are Acumin Pro Condensed Black' },
    { rule: 'no-outlined-type', slide: 1, what: 'Outlined "CLARK"', why: 'pill text is solid' },
    { rule: 'team-palette', slide: 1, what: 'Red accent word "EFFECT"', why: 'red is not in the Fever brand kit' },
    { rule: 'logo-placement', slide: 1, what: 'Logo top-right with a swipe button', why: 'with a swipe button it goes top-left' },
    { rule: 'make-it-pop', slide: 1, what: 'Not a real rule', why: 'x' },
    { rule: 'font-family', slide: 1, what: 'Wide grotesque display font on the name', why: 'dup' },
  ],
  keep: ['A strong viewership story', '2.6M average is a real hook'],
};
const critique = onbrand.validateCritique(RAW, { imageCount: 3 });
assert.deepEqual(critique.issues.map(i => i.rule), ['font-family', 'no-outlined-type', 'team-palette', 'logo-placement'], 'unknown rules and duplicates are dropped');
assert.equal(critique.issues[0].source, 'SM-07', 'each issue cites the guide image');
assert.equal(critique.onBrand, false);
assert.deepEqual(critique.slides[1].numbers.map(n => n.value), ['2.6M', '4M', '+178%'], 'a number not read off the slide is dropped');
assert.equal(onbrand.validateCritique(null), null);
assert.equal(onbrand.validateCritique({ slides: [], issues: [] }), null);

const mapping = GUIDE.mapSlides(critique.slides);
assert.deepEqual(mapping.map(m => m.template), ['cover', 'cover', 'stats-single-ent'], 'viewership numbers become a Cover hook; real stat labels become Player Stats');
assert.deepEqual(GUIDE.mapSlides([{ role: 'list', text: [], entities: ['A', 'B', 'C'] }, { quote: 'We are building something special' }]).map(m => m.template), ['listicle-type-2', 'quote']);

const concepts = onbrand.conceptsFrom(critique, mapping);
assert.deepEqual(concepts.map(c => c.ref), ['s1', 's2', 's3']);
assert.equal(concepts[0].name, 'Slide 1 · Cover');
assert.equal(concepts[0].angle, 'The Caitlin Clark Effect');
assert.deepEqual(concepts[2].factsUsed, ['30 PTS', '9 AST', '6 REB']);
const brief = onbrand.briefFrom(critique, 'Fever vs Dream, Aug 16');
assert.match(brief, /Headline: The Caitlin Clark Effect/);
assert.match(brief, /Slide 2: 2\.6M AVERAGE, 4M PEAK, \+178% VS ESPN AVG/);
assert.match(brief, /Editor's note: Fever vs Dream, Aug 16/);
assert.doesNotMatch(brief, /9\.9M/);

assert.equal(onbrand.readImages([]).error, 'Add an image of the design.');
assert.equal(onbrand.readImages(['data:text/html;base64,AAAA']).error, 'Use a JPG, PNG or WebP image.');
assert.equal(onbrand.readImages(Array(7).fill('data:image/png;base64,AAAA')).error, 'Up to 6 slides at a time.');
assert.equal(onbrand.readImages(['data:image/jpeg;base64,AAAA']).images[0].mediaType, 'image/jpeg');

// ─── 4. mode 'onbrand' end to end (vision + writer + review mocked) ───────
let visionMode = 'ok';
let overWeek = false;
let seen;
const reset = () => { seen = { vision: [], writer: [], usage: [] }; };
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const STATS = [{ value: '30', label: 'PTS' }, { value: '9', label: 'AST' }, { value: '6', label: 'REB' }];
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/wp-json/wp/v2/')) return reply(200, []);
  if (href.includes('/rest/v1/frameup_ai_usage')) { seen.usage.push(JSON.parse(options.body)); return reply(201, {}); }
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: overWeek ? 30 : 0 }]);
  if (href.includes('/rest/v1/')) return reply(404, { code: 'PGRST202' });
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/chat/completions')) {
    const prompt = JSON.parse(options.body).messages[0].content;
    const cards = (prompt.match(/^card \d+/gm) || []).map((_, i) => ({ card: i + 1, best: 0, score: 4.6, strong: 'Real numbers', note: '' }));
    return reply(200, { choices: [{ message: { content: JSON.stringify({ cards }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 50 } });
  }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    if (Array.isArray(content) && content.some(block => block.type === 'image' && block.source?.type === 'base64')) {
      seen.vision.push(body);
      if (visionMode === 'budget') return reply(402, { error: { message: 'Spend limit reached for this API key' } });
      if (visionMode === 'garbage') return reply(200, { content: [{ type: 'text', text: 'Looks nice!' }], usage: { input_tokens: 3000, output_tokens: 20 } });
      return reply(200, { content: [{ type: 'text', text: JSON.stringify(RAW) }], usage: { input_tokens: 4200, output_tokens: 700 } });
    }
    if (Array.isArray(content)) return reply(200, { content: [{ type: 'text', text: '{"best": 1}' }], usage: { input_tokens: 100, output_tokens: 5 } });
    seen.writer.push(`${JSON.stringify(body.system || '')}\n${content}`);
    const designs = [
      { conceptId: 'c1', postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: ['The Caitlin', 'Clark Effect'], font: 'Druk Wide' }, photoQuery: 'Caitlin Clark Fever' },
      { conceptId: 'c2', postType: 'cover', sport: 'WNBA', team: 'Indiana Fever', fields: { pills: ['2.6M Watched', 'Fever Vs Dream'] }, photoQuery: 'Caitlin Clark Fever' },
      { conceptId: 'c3', postType: 'stats-single-ent', sport: 'WNBA', team: 'Indiana Fever', fields: { headline: 'Clark Season', stats: STATS }, photoQuery: 'Caitlin Clark Fever' },
    ];
    return reply(200, { content: [{ type: 'text', text: JSON.stringify({ designs }) }], usage: { input_tokens: 5000, output_tokens: 900 } });
  }
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete process.env.GROQ_API_KEY;
[genPath, authPath, mcpPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
const gen = require(genPath);
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const IMG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';

reset();
let res = await post({ mode: 'onbrand', images: [IMG, IMG, IMG], note: 'Fever vs Dream, Aug 16' });
assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 200));
assert.equal(seen.vision.length, 1, 'one vision call for the whole carousel');
const vision = seen.vision[0];
assert.equal(vision.model, 'anthropic/claude-haiku-5.5', 'the vision read runs on the main tier');
assert.equal(vision.messages[0].content.filter(b => b.type === 'image').length, 3);
assert.match(JSON.stringify(vision.system), /no-outlined-type \[must\]/, 'the critique is asked against the ES rule ids');
assert.ok(seen.usage.some(row => row.feature === 'generate-onbrand'), 'vision cost is logged under its own feature');
assert.equal(res.body.mode, 'onbrand');
assert.equal(res.body.critique.issues.length, 4);
assert.deepEqual(res.body.carousel.map(m => m.template), ['cover', 'cover', 'stats-single-ent']);
assert.equal(seen.writer.length, 1);
assert.match(seen.writer[0], /Creative direction from the ES creative director/, 'the slides become directions for the writer');
assert.match(seen.writer[0], /ES design rules \(fixed by the templates/, 'the writer plans inside the guidelines');
assert.match(seen.writer[0], /Slide 2: 2\.6M AVERAGE/, 'the image numbers are the facts');
assert.deepEqual(res.body.designs.map(d => d.direction?.ref), ['s1', 's2', 's3']);
assert.ok(res.body.designs.every(d => d.guideline?.ok), 'every design passed the Guideline check');
const first = res.body.designs[0];
assert.equal(first.fields.font, undefined, 'an off-guide font from the writer is stripped');
assert.ok(first.guideline.fixes.some(f => f.rule === 'font-family'), '...and listed as a fix on the card');
assert.deepEqual(res.body.designs[2].guideline.fixes, [], 'a clean design shows On-brand');
assert.ok(res.body.meta.costUsd > 0);
assert.ok(res.body.meta.ms.vision >= 0);

reset();
res = await post({ mode: 'onbrand', images: ['data:text/plain;base64,AAAA'] });
assert.equal(res.status, 400);
assert.equal(seen.vision.length, 0);

visionMode = 'garbage';
reset();
res = await post({ mode: 'onbrand', images: [IMG] });
assert.equal(res.status, 422);
assert.equal(seen.writer.length, 0, 'nothing is written from an unread design');

visionMode = 'budget';
res = await post({ mode: 'onbrand', images: [IMG] });
assert.equal(res.status, 503);
assert.equal(res.body.reason, 'budget');

visionMode = 'ok';
overWeek = true;
reset();
res = await post({ mode: 'onbrand', images: [IMG] });
assert.equal(res.status, 429);
assert.equal(seen.vision.length, 0, 'the weekly cap holds');

console.log('es guidelines checks passed');
