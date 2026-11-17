// Generate "hero" round (2026-11-19): the Player Stat Line and Team Record
// formats end to end (template limits, brand checker, director fit, guideline
// gate, on-brand mapping), stat-pair accuracy, the ES photo search mode, the
// photo-pick cache, and the page / editor wiring. Every network call is mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const genPath = path.join(fnDir, 'es-generate.js');
const mcpPath = path.join(fnDir, '_es-mcp.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

const IMG = n => `https://image-cdn.essentiallysports.com/wp-content/uploads/luka-${n}.jpg`;
const POSTS = [1, 2, 3].map(n => ({
  id: n, date: `2026-11-1${n}T10:00:00`, link: `https://www.essentiallysports.com/nba-news-luka-${n}/`,
  title: { rendered: `Luka Doncic story ${n} with the Los Angeles Lakers` }, excerpt: { rendered: '<p>Doncic and the Lakers.</p>' },
  yoast_head_json: { og_image: [{ url: IMG(n) }] },
}));
const STAT_LINE = { designs: [{
  postType: 'player-stat-line', sport: 'NBA', team: 'Los Angeles Lakers', photoQuery: 'Luka Doncic Lakers', why: 'The full line.',
  fields: { firstName: 'Luka', lastName: 'Doncic', opponent: 'V/S The Suns', stats: [{ value: '36', label: 'MIN' }, { value: '43', label: 'POINTS' }, { value: '11', label: 'REB' }, { value: '9', label: 'AST' }, { value: '4', label: 'STL' }] },
}] };

let visionCalls = 0;
let writerReply = STAT_LINE;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  if (href.includes('/wp-json/wp/v2/tags')) {
    const q = new URL(href).searchParams.get('search');
    return reply(200, /doncic/i.test(q) ? [{ id: 77, name: 'Luka Doncic', count: 900 }] : []);
  }
  if (href.includes('/wp-json/wp/v2/posts')) return reply(200, new URL(href).searchParams.get('tags') ? POSTS : []);
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    const content = body.messages[0].content;
    if (Array.isArray(content)) {
      visionCalls += 1;
      return reply(200, { content: [{ type: 'text', text: '{"best": 2}' }], usage: { input_tokens: 4000, output_tokens: 20 } });
    }
    return reply(200, { content: [{ type: 'text', text: JSON.stringify(writerReply) }], usage: { input_tokens: 5000, output_tokens: 900 } });
  }
  if (href.includes('/rest/v1/')) return reply(200, []);
  if (href.startsWith('https://api.groq.com/')) return reply(200, { choices: [{ message: { content: JSON.stringify(writerReply) } }] });
  throw new Error(`unexpected fetch ${href}`);
};
process.env.AI_GATEWAY_API_KEY = 'gw-test';

require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }), verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }) } };
require.cache[mcpPath] = { id: mcpPath, filename: mcpPath, loaded: true, exports: { isMcpConfigured: () => false, createSession: () => null } };
const gen = require(genPath);
const t = gen._test;
const { lintSpec, statCode, briefStatPairs } = require(path.join(fnDir, '_lint-spec.js'));
const director = require(path.join(fnDir, '_creative-director.js'));
const GUIDE = require(path.resolve('es-guidelines.js'));
const post = body => gen.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) }).then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));

// ── 1. Template limits ─────────────────────────────────────────────────────
const line = t.checkFields('player-stat-line', STAT_LINE.designs[0].fields);
assert.ok(!line.error, 'a full stat line passes');
assert.deepEqual(line.fields.stats.map(s => s.label), ['MIN', 'POINTS', 'REB', 'AST', 'STL'], 'labels are stored upper case');
assert.equal(line.lines[0], 'Luka Doncic');
assert.match(t.checkFields('player-stat-line', { firstName: 'Luka', lastName: 'Doncic', stats: [{ value: '1', label: 'PTS' }, { value: '2', label: 'REB' }] }).error, /3-7 stats/);
assert.match(t.checkFields('player-stat-line', { firstName: 'Luka', lastName: 'Doncic', stats: Array.from({ length: 8 }, () => ({ value: '1', label: 'PTS' })) }).error, /3-7 stats/);
assert.equal(t.checkFields('team-record', { record: '10 – 0', subline: 'Undefeated Season' }).fields.record, '10-0', 'the record is tidied');
assert.ok(t.checkFields('team-record', { record: '31-28' }).fields, 'a score passes with no subline');
assert.ok(t.checkFields('team-record', { record: 'Ten and oh' }).error, 'words are not a record');
assert.ok(t.TEMPLATES['player-stat-line'].photo && t.TEMPLATES['team-record'].photo, 'both templates take a photo');

// ── 2. Brand checker: labels, stat pairs, the record ───────────────────────
assert.equal(statCode('MINUTES PLAYED'), 'MIN');
assert.equal(statCode('POINTS'), 'PTS');
assert.equal(statCode('VIBES'), '');
assert.deepEqual([...briefStatPairs('30 PTS, 9 AST and 6 rebounds').PTS], ['30']);
assert.equal(briefStatPairs('averaging 30 a game').A, undefined, 'one-letter labels never pair with words');
const brief = 'Luka Doncic drops 43 PTS 11 REB 9 AST 4 STL in 36 MIN against the Suns';
const ctx = { brief, corpus: '', leads: new Set() };
const specOf = (postType, fields) => ({ postType, sport: 'NBA', team: 'Los Angeles Lakers', fields, lines: [] });
assert.equal(lintSpec(specOf('player-stat-line', line.fields), ctx).ok, true, 'the real line passes');
const swapped = lintSpec(specOf('player-stat-line', { ...line.fields, stats: [{ value: '9', label: 'PTS' }, { value: '43', label: 'AST' }, { value: '11', label: 'REB' }] }), ctx);
assert.deepEqual([...new Set(swapped.errors.map(e => e.code))], ['stat-mismatch'], 'a number moved to another label is caught');
assert.equal(lintSpec(specOf('stats-single-ent', { headline: 'Luka Delivers', stats: [{ value: '9', label: 'PTS' }, { value: '43', label: 'AST' }, { value: '11', label: 'REB' }] }), ctx).ok, false, 'Player Stats gets the same pair check');
assert.equal(lintSpec(specOf('player-stat-line', { ...line.fields, stats: [{ value: '43', label: 'VIBES' }, ...line.fields.stats.slice(1)] }), ctx).errors[0].code, 'bad-stat-label');
const recordCtx = { brief: 'The Lions improve to 10-0 after beating the Bears 31-28', corpus: '', leads: new Set() };
assert.equal(lintSpec(specOf('team-record', { record: '10-0', subline: 'Undefeated' }), recordCtx).ok, true, 'a stated record passes');
assert.equal(lintSpec(specOf('team-record', { record: '11-0', subline: '' }), recordCtx).ok, false, 'an invented record is dropped');

// ── 3. Director fit and the guideline gate ─────────────────────────────────
const tools = { nameCandidates: t.nameCandidates, parseTableBrief: t.parseTableBrief, sportFromUrl: t.sportFromUrl };
const read = director.readBrief(brief, {}, [], tools);
assert.equal(read.fits['player-stat-line'], true, 'a stat line fits Player Stat Line');
assert.equal(read.fits['team-record'], false, 'no record, no Team Record');
const recordRead = director.readBrief('The Detroit Lions improve to 10-0', {}, [], tools);
assert.equal(recordRead.record, '10-0');
assert.equal(recordRead.fits['team-record'], true, 'a stated record with a team fits Team Record');
assert.equal(director.readBrief('Season 2025-26 preview for the Lions', {}, [], tools).record, '', 'a season is not a record');
const concepts = director.validateConcepts({ concepts: [
  { postType: 'team-record', angle: 'Perfect season so far', hook: 'numbers', factsUsed: ['Lions'] },
  { postType: 'team-record', angle: 'Still unbeaten, still hungry', hook: 'claim', factsUsed: ['10-0'] },
] }, { read: recordRead, templates: t.TEMPLATES, brief: 'The Detroit Lions improve to 10-0' });
assert.equal(concepts.length, 1, 'a Team Record concept needs the record among its facts');
['player-stat-line', 'team-record'].forEach(type => {
  assert.ok(GUIDE.TEMPLATES.includes(type), `${type} is an ES template for the gate`);
  assert.equal(GUIDE.checkDesign({ postType: type, team: '', fields: {} }, { templates: t.TEMPLATES }).ok, true);
});
const mapped = GUIDE.mapSlides([
  { role: 'score', numbers: [{ value: '31-28', label: 'FINAL' }], entities: ['Lions'] },
  { role: 'stats', numbers: [{ value: '43', label: 'PTS' }, { value: '11', label: 'REB' }, { value: '9', label: 'AST' }, { value: '4', label: 'STL' }], entities: ['Luka Doncic'] },
  { role: 'stats', numbers: [{ value: '43', label: 'PTS' }, { value: '11', label: 'REB' }, { value: '9', label: 'AST' }], entities: ['Luka Doncic'] },
]);
assert.deepEqual(mapped.map(m => m.template), ['team-record', 'player-stat-line', 'stats-single-ent'], 'on-brand maps scores and long lines to the new templates');

// ── 4. End to end: a Player Stat Line from the writer reaches the page ─────
let res = await post({ brief, formats: ['player-stat-line'], count: 2, directions: false });
assert.equal(res.status, 200);
const design = res.body.designs[0];
assert.equal(design?.postType, 'player-stat-line', 'the design passes every check');
assert.equal(design.guideline.ok, true, 'and the guideline gate');
assert.equal(design.label, 'Player Stat Line');
assert.ok(design.photos.length, 'it gets ES photo candidates');
writerReply = { designs: [{ ...STAT_LINE.designs[0], fields: { ...STAT_LINE.designs[0].fields, stats: [{ value: '9', label: 'PTS' }, { value: '43', label: 'AST' }, { value: '11', label: 'REB' }] } }] };
res = await post({ brief, formats: ['player-stat-line'], count: 1, directions: false });
assert.ok(!res.body.designs.some(d => d.postType === 'player-stat-line' && d.fields.stats[0].value === '9'), 'a swapped stat line never reaches the page');
writerReply = STAT_LINE;

// ── 5. Photo pick cache: one vision call per story ─────────────────────────
t.PHOTO_PICK_CACHE.clear();
visionCalls = 0;
const candidates = [1, 2, 3].map(n => ({ title: 'Luka', sourceUrl: IMG(n), url: `/api/es-image-search?image=${encodeURIComponent(IMG(n))}` }));
const first = await t.pickPhoto('Luka Doncic', candidates, {});
const again = await t.pickPhoto('Luka Doncic', candidates, {});
assert.equal(first.index, 1);
assert.equal(again.index, 1, 'the cached pick is the same pick');
assert.equal(again.cost, 0, 'and costs nothing');
assert.equal(visionCalls, 1, 'one vision call for two asks');
await t.pickPhoto('Luka Doncic', candidates.slice(1), {});
assert.equal(visionCalls, 2, 'different photos are a new question');

// ── 6. Photo search mode (no AI) ───────────────────────────────────────────
visionCalls = 0;
res = await post({ mode: 'photos', query: 'Luka Doncic' });
assert.equal(res.status, 200);
assert.equal(res.body.query, 'Luka Doncic');
assert.ok(res.body.photos.length >= 1, 'ES story photos come back');
assert.ok(res.body.photos.every(p => /^\/api\/es-image-search\?image=/.test(p.url)), 'only through the ES image proxy');
assert.equal(visionCalls, 0, 'photo search never calls the AI');
assert.equal((await post({ mode: 'photos', query: 'x' })).status, 400, 'a one-letter search is refused');

// ── 7. Page and editor wiring ──────────────────────────────────────────────
const page = fs.readFileSync('generate.html', 'utf8');
const spec = fs.readFileSync('frameup-spec.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
['player-stat-line', 'team-record'].forEach(type => {
  assert.ok(page.includes(`['${type}', `), `${type} has a format card`);
  assert.ok(spec.includes(`'${type}'`), `${type} is SUPPORTED by the editor bridge`);
});
assert.match(spec, /renderWithInfo/, 'the renderer says what filled the photo slot');
assert.match(spec, /teamGraphic\(/, 'an empty photo slot gets the team graphic');
assert.match(spec, /exportSet/, 'sets export as one ZIP');
assert.match(spec, /PENDING_SET_KEY = 'frameup\.openSpecSet\.v1'/);
assert.ok(page.includes("sessionStorage.setItem('frameup.openSpecSet.v1'"), 'Open as carousel hands the set to the editor');
assert.match(page, /id="gen-setbar"/);
assert.match(page, /data-photo-search/, 'the photo panel has an ES photo search');
assert.match(page, /data-act="swap"/, 'Refine offers the same idea in another template');
assert.match(page, /event\.key === '\/'/, '"/" focuses the brief');
assert.match(index, /frameup-spec\.js\?v=[\w-]+/, 'the editor bridge cache key is bumped');

console.log('generate hero checks passed');
