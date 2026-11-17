#!/usr/bin/env node
// Video Ads learning loop (netlify/functions/_ad-learning.js + ad-learning.js),
// every network call mocked:
//   1. recordEvent: row shape, user token, never throws, no-op on missing table
//   2. lessonsFor: examples (latest exports, de-duplicated), rules from check
//      failures and edits, team-wide RPC + per-user fallback, team cache,
//      empties on 404 / no table / network error
//   3. endpoint: 401, 413, bad type, 429, ok, ok:false without details
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const learningPath = path.join(fnDir, '_ad-learning.js');
const handlerPath = path.join(fnDir, 'ad-learning.js');
const gwPath = path.join(fnDir, '_ai-gateway.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

// ── Mocks ──────────────────────────────────────────────────────────────────
let signedIn = true;
let callsLastHour = 0;
let insertStatus = 201;
let readStatus = 200;
let readThrows = false;
let rowsRecent = [];
let rowsExports = [];
let inserts = [];
let reads = [];
let rpcStatus = 404; // the RPC is "not deployed" unless a test says so
let rpcRows = [];
let rpcCalls = [];
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.endsWith('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, callsLastHour);
  if (href === 'https://db.example.supabase.co/rest/v1/rpc/frameup_video_ad_lessons') {
    rpcCalls.push({ body: JSON.parse(options.body), headers: options.headers, method: options.method });
    return rpcStatus === 200 ? reply(200, rpcRows) : reply(rpcStatus, { code: 'PGRST202' });
  }
  if (href.startsWith('https://db.example.supabase.co/rest/v1/frameup_video_ad_events')) {
    if ((options.method || 'GET') === 'POST') {
      inserts.push({ body: JSON.parse(options.body), headers: options.headers });
      return reply(insertStatus, insertStatus === 404 ? { code: 'PGRST205', message: 'Could not find the table' } : {});
    }
    reads.push({ href, headers: options.headers });
    if (readThrows) throw new Error('network down');
    if (readStatus !== 200) return reply(readStatus, { code: 'PGRST205' });
    return reply(200, href.includes('type=eq.export') ? rowsExports : rowsRecent);
  }
  throw new Error(`unexpected fetch ${href}`);
};

[learningPath, handlerPath, gwPath, authPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: headers => String(headers?.authorization || '').replace(/^Bearer\s+/i, ''),
  verifyEsUser: async () => (signedIn ? { ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } } : { ok: false, statusCode: 401, error: 'Authentication required.' }),
} };
const learning = require(learningPath);
const { handler } = require(handlerPath);

const reset = () => {
  signedIn = true; callsLastHour = 0; insertStatus = 201; readStatus = 200; readThrows = false;
  rowsRecent = []; rowsExports = []; inserts = []; reads = [];
  rpcStatus = 404; rpcRows = []; rpcCalls = [];
  learning.resetLearningCache();
};
const jwt = sub => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;
let passed = 0;
async function test(name, fn) {
  reset();
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── 1. recordEvent ─────────────────────────────────────────────────────────
console.log('recordEvent');
await test('inserts with the user token and the row shape', async () => {
  const ok = await learning.recordEvent({ token: 'tok', email: 'Designer@EssentiallySports.com', event: { type: 'export', brandId: 'es-dugout', sport: 'MLB', payload: { copy: { headline: 'Hi' } } } });
  assert.equal(ok, true);
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].body, { user_email: 'designer@essentiallysports.com', type: 'export', brand_id: 'es-dugout', sport: 'mlb', payload: { copy: { headline: 'Hi' } } });
  assert.equal(inserts[0].headers.Authorization, 'Bearer tok');
  assert.equal(inserts[0].headers.apikey, 'pk');
  assert.equal(inserts[0].headers.Prefer, 'return=minimal');
});
await test('refuses bad events and missing auth without a request', async () => {
  assert.equal(await learning.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'rating' } }), false);
  assert.equal(await learning.recordEvent({ token: '', email: 'a@essentiallysports.com', event: { type: 'export' } }), false);
  assert.equal(await learning.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'export', sport: 'nba' } }), false);
  assert.equal(await learning.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'export', payload: [1] } }), false);
  assert.equal(await learning.recordEvent(), false);
  assert.equal(inserts.length, 0);
});
await test('quietly no-ops when the table is missing, then skips the network', async () => {
  insertStatus = 404;
  assert.equal(await learning.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'export' } }), false);
  assert.equal(await learning.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'export' } }), false);
  assert.equal(inserts.length, 1);
});
await test('never throws when fetch throws', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('boom'); };
  try {
    assert.equal(await learning.recordEvent({ token: 'tok', email: 'a@essentiallysports.com', event: { type: 'export' } }), false);
  } finally { globalThis.fetch = saved; }
});

// ── 2. lessonsFor ──────────────────────────────────────────────────────────
console.log('lessonsFor');
const exportRow = (headline, extra = {}) => ({ type: 'export', payload: { copy: { style: 'condensed', headline, body: ['Get the daily read.'], cta: 'SIGN UP', ...extra }, sizes: ['9x16'] } });
await test('examples: latest exports, mapped and de-duplicated, max 5', async () => {
  rowsExports = [
    exportRow('Ohio State fans, this one is for you'),
    exportRow('Ohio  State fans, this one is for YOU!'),
    exportRow('The Dawgs are rolling', { style: 'highlight', highlight: 'ROLLING' }),
    exportRow('Three'), exportRow('Four'), exportRow('Five'), exportRow('Six'),
    { type: 'export', payload: {} },
  ];
  const lessons = await learning.lessonsFor({ brandId: 'essentially-cfb', sport: 'cfb', token: jwt('u1') });
  assert.equal(lessons.examples.length, 5);
  assert.deepEqual(lessons.examples[0], { style: 'condensed', headline: 'Ohio State fans, this one is for you', highlight: '', body: ['Get the daily read.'], cta: 'SIGN UP' });
  assert.equal(lessons.examples[1].highlight, 'ROLLING');
  assert.equal(lessons.examples[4].headline, 'Five');
  assert.ok(reads.every(r => r.href.includes('brand_id=eq.essentially-cfb') && r.headers.Authorization === `Bearer ${jwt('u1')}`));
  assert.ok(reads.some(r => r.href.includes('limit=200')));
});
await test('rules: recurring check failures become plain rules', async () => {
  rowsRecent = [
    { type: 'check_failed', payload: { issues: ['headline has 25 words (max 22)', '"This is shocking stuff" breaks the ES style (hype word; make the claim specific instead)'] } },
    { type: 'check_failed', payload: { issues: ['headline has 24 words (max 22)', 'headline has 23 words (max 22)', '"A shocking night" breaks the ES style (hype word; make the claim specific instead)'] } },
    { type: 'copy_generated', payload: { issues: ['the number 42 is not in the research or your notes'], autoFixed: [] } },
    { type: 'check_failed', payload: { issues: ['the number 7 is not in the research or your notes', 'paragraph 1 has 50 words (max 45)'] } },
  ];
  const lessons = await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  assert.deepEqual(lessons.rules, [
    'Keep headlines under 12 words.',
    'Never use the word "shocking".',
    'Use no numbers or stats unless they appear in the moment or the notes.',
  ]);
  assert.ok(!lessons.rules.some(r => /paragraph/.test(r)), 'a one-off issue is not a rule');
});
await test('rules: headline target follows shipped headlines; structured issues work', async () => {
  rowsExports = [exportRow('one two three four five six'), exportRow('one two three four five six seven eight')];
  rowsRecent = [
    { type: 'check_failed', payload: { issues: [{ kind: 'headline_length' }, { kind: 'banned', word: 'Insane' }] } },
    { type: 'check_failed', payload: { issues: [{ kind: 'headline_length' }, { kind: 'banned', word: 'insane' }] } },
  ];
  const { rules } = await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  assert.deepEqual(rules, ['Keep headlines under 9 words.', 'Never use the word "insane".']);
});
await test('rules: consistent edits (shorter headlines, removed phrases, CTA)', async () => {
  const edit = (beforeHeadline, afterHeadline, beforeBody, afterBody, cta = 'JOIN THE HUDDLE') => ({ type: 'copy_edited', payload: {
    before: { headline: beforeHeadline, body: [beforeBody], cta: 'SIGN UP' },
    after: { headline: afterHeadline, body: [afterBody], cta },
  } });
  rowsRecent = [
    edit('The Chiefs pulled off an incredible comeback that every fan is still talking about today', 'Chiefs pull off the comeback', 'Get the daily read. Seriously unmissable coverage.', 'Get the daily read.'),
    edit('Mahomes did it again in a wild finish that nobody saw coming at all tonight', 'Mahomes did it again', 'Free every morning. Seriously unmissable coverage.', 'Free every morning.'),
    edit('Bills fans should look away now because this one hurt a lot today', 'Bills fans, look away', 'Your NFL fix, daily. Seriously unmissable coverage.', 'Your NFL fix, daily.'),
  ];
  const { rules } = await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  assert.ok(rules.includes('Editors keep shortening headlines: aim for about 4 words.'), rules.join(' | '));
  assert.ok(rules.includes('Editors keep cutting the body: keep it to about 10 words.'), rules.join(' | '));
  assert.ok(rules.includes('Avoid "seriously unmissable coverage": editors keep removing it.'), rules.join(' | '));
  assert.ok(rules.includes('Use the button text "JOIN THE HUDDLE".'), rules.join(' | '));
  assert.ok(rules.length <= 6 && rules.every(r => r.length < 120));
  assert.ok(!rules.some(r => r === 'Avoid "seriously": editors keep removing it.'), 'a word inside a chosen phrase is not repeated');
});
await test('rules: deterministic, capped at 6, each under 120 chars', async () => {
  const issues = ['headline is missing', 'headline has 30 words (max 22)', 'paragraph 2 has 60 words (max 45)', '120 words in all (max 95)',
    'highlight must be words copied exactly from the headline', 'the number 9 is not in the research or your notes',
    '"OMG what a play" breaks the ES style (slang abbreviation)', '"#GoDawgs" breaks the ES style (no hashtags on the design)'];
  rowsRecent = [1, 2, 3].map(() => ({ type: 'check_failed', payload: { issues } }));
  const first = await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  learning.resetLearningCache();
  const second = await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  assert.equal(first.rules.length, 6);
  assert.deepEqual(first.rules, second.rules);
  assert.ok(first.rules.every(r => r.length < 120));
  assert.equal(learning.deriveRules([]).length, 0);
});
await test('team-wide: the RPC is called with the user token, brand, sport and limit', async () => {
  rpcStatus = 200;
  rpcRows = [
    { type: 'export', sport: 'nfl', payload: { copy: { style: 'condensed', headline: 'Team ad one', body: ['Free daily.'], cta: 'SIGN UP' } } },
    { type: 'check_failed', sport: 'nfl', payload: { issues: [{ kind: 'invented_number' }] } },
    { type: 'check_failed', sport: 'nfl', payload: { issues: [{ kind: 'invented_number' }] } },
    { type: 'export', sport: 'nfl', payload: { copy: { style: 'simple', headline: 'Team ad two', body: ['Every morning.'] } } },
  ];
  const lessons = await learning.lessonsFor({ brandId: 'the-huddle', sport: 'NFL', token: jwt('u1') });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].method, 'POST');
  assert.deepEqual(rpcCalls[0].body, { p_brand_id: 'the-huddle', p_sport: 'nfl', p_limit: 200 });
  assert.equal(rpcCalls[0].headers.Authorization, `Bearer ${jwt('u1')}`);
  assert.equal(reads.length, 0, 'no per-user select when the RPC works');
  assert.deepEqual(lessons.examples.map(e => e.headline), ['Team ad one', 'Team ad two']);
  assert.deepEqual(lessons.rules, ['Use no numbers or stats unless they appear in the moment or the notes.']);
  await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  assert.equal(rpcCalls[1].body.p_sport, null, 'no sport -> null');
});
await test('RPC 404 (not deployed) or error falls back to the per-user select', async () => {
  rpcStatus = 404;
  rowsExports = [exportRow('Mine')];
  const lessons = await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') });
  assert.equal(rpcCalls.length, 1);
  assert.equal(reads.length, 2);
  assert.equal(lessons.examples[0].headline, 'Mine');
  learning.resetLearningCache();
  rpcStatus = 500;
  assert.equal((await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') })).examples[0].headline, 'Mine');
  learning.resetLearningCache();
  rpcStatus = 404; readStatus = 404;
  assert.deepEqual(await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') }), { examples: [], rules: [] });
});
await test('cache: team-wide per brand + sport for 10 minutes', async () => {
  rpcStatus = 200;
  rpcRows = [{ type: 'export', payload: { copy: { headline: 'Cached' } } }];
  await learning.lessonsFor({ brandId: 'the-huddle', sport: 'nfl', token: jwt('u1') });
  rpcRows = [{ type: 'export', payload: { copy: { headline: 'Fresh' } } }];
  const again = await learning.lessonsFor({ brandId: 'the-huddle', sport: 'nfl', token: jwt('u2') });
  assert.equal(rpcCalls.length, 1, 'another person shares the team cache');
  assert.equal(again.examples[0].headline, 'Cached');
  again.examples.push('mutation');
  assert.equal((await learning.lessonsFor({ brandId: 'the-huddle', sport: 'nfl', token: jwt('u1') })).examples.length, 1);
  await learning.lessonsFor({ brandId: 'the-huddle', sport: 'cfb', token: jwt('u1') });
  await learning.lessonsFor({ brandId: 'es-dugout', sport: 'nfl', token: jwt('u1') });
  assert.equal(rpcCalls.length, 3, 'a new sport or brand is a new key');
});
await test('empties on 404 (no table yet), and skips the network after', async () => {
  readStatus = 404;
  assert.deepEqual(await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') }), { examples: [], rules: [] });
  const count = reads.length;
  assert.deepEqual(await learning.lessonsFor({ brandId: 'es-dugout', token: jwt('u1') }), { examples: [], rules: [] });
  assert.equal(reads.length, count);
});
await test('empties on 500, network errors, bad input', async () => {
  readStatus = 500;
  assert.deepEqual(await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') }), { examples: [], rules: [] });
  learning.resetLearningCache();
  readThrows = true;
  assert.deepEqual(await learning.lessonsFor({ brandId: 'the-huddle', token: jwt('u1') }), { examples: [], rules: [] });
  assert.deepEqual(await learning.lessonsFor({ brandId: 'the-huddle' }), { examples: [], rules: [] });
  assert.deepEqual(await learning.lessonsFor({ brandId: 'x;drop', token: 'tok' }), { examples: [], rules: [] });
  assert.deepEqual(await learning.lessonsFor(), { examples: [], rules: [] });
});

// ── 3. endpoint ────────────────────────────────────────────────────────────
console.log('endpoint');
const post = (body, extra = {}) => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...extra });
const parse = result => ({ status: result.statusCode, body: JSON.parse(result.body) });
await test('401 when not signed in', async () => {
  signedIn = false;
  const { status, body } = parse(await post({ event: { type: 'export' } }));
  assert.equal(status, 401);
  assert.equal(body.ok, false);
  assert.equal(inserts.length, 0);
});
await test('405 for GET', async () => {
  assert.equal((await handler({ httpMethod: 'GET', headers: {} })).statusCode, 405);
});
await test('413 over 20KB', async () => {
  const { status } = parse(await post({ event: { type: 'export', payload: { blob: 'x'.repeat(21 * 1024) } } }));
  assert.equal(status, 413);
  assert.equal(inserts.length, 0);
});
await test('400 for a bad type, bad JSON, big payload', async () => {
  assert.equal(parse(await post({ event: { type: 'rated' } })).status, 400);
  assert.equal(parse(await post('{nope')).status, 400);
  assert.equal(parse(await post({})).status, 400);
  assert.equal(parse(await post({ event: { type: 'export', payload: { blob: 'x'.repeat(17 * 1024) } } })).status, 400);
  assert.equal(inserts.length, 0);
});
await test('429 over the hourly limit', async () => {
  callsLastHour = 999;
  assert.equal(parse(await post({ event: { type: 'export' } })).status, 429);
  assert.equal(inserts.length, 0);
});
await test('ok: saves the event with the verified email', async () => {
  const { status, body } = parse(await post({ event: { type: 'clip_failed', brandId: 'es-dugout', sport: 'mlb', payload: { height: 720, status: 403 } } }));
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(inserts[0].body.user_email, 'designer@essentiallysports.com');
  assert.deepEqual(inserts[0].body.payload, { height: 720, status: 403 });
});
await test('ok:false without details when the save fails', async () => {
  insertStatus = 500;
  const { status, body } = parse(await post({ event: { type: 'export' } }));
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: false });
});

console.log(`\n${passed} ad-learning tests passed`);
