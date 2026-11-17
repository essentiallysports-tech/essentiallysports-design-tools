#!/usr/bin/env node
// Video Ads hero pass (2026-11-18), every network call mocked:
//   - Us vs Them claims: file fallback, saved overrides, admin-only saves,
//     validation, "migration not run" (claims / save-claims modes)
//   - copy: the static system prompt is cached, the rubric is in it
//   - chat: static (cached) system prompt, the ad's context in the first turn
//   - the page markup: the daily set, the placement picker, the pre-export
//     check, the rating helper loaded, no removed styles, cache keys
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const fnDir = path.resolve('netlify/functions');
const adsPath = path.join(fnDir, 'video-ads.js');
const authPath = path.join(fnDir, '_supabase-auth.js');

let claimRows = [];
let claimsStatus = 200;
let isAdmin = false;
let upserts = [];
let upsertStatus = 201;
let lastMessages = null;
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  if (href.includes('/rest/v1/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/frameup_ai_usage')) return reply(201, {});
  if (href.includes('/rest/v1/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.includes('/rest/v1/rpc/is_es_designer_admin')) return reply(200, isAdmin);
  if (href.includes('/rest/v1/frameup_video_ad_claims')) {
    if ((options.method || 'GET') === 'GET') return claimsStatus === 200 ? reply(200, claimRows) : reply(claimsStatus, { code: 'PGRST205', message: 'missing' });
    upserts.push({ href, body: JSON.parse(options.body), prefer: options.headers?.Prefer });
    return upsertStatus < 400 ? reply(upsertStatus, '') : reply(upsertStatus, upsertStatus === 404 ? { code: 'PGRST205', message: 'missing' } : { code: '42501', message: 'denied' });
  }
  if (href.startsWith('https://ai-gateway.vercel.sh/v1/messages')) {
    const body = JSON.parse(options.body);
    lastMessages = body;
    const isChat = /Video Ads assistant/.test(JSON.stringify(body.system));
    const text = isChat
      ? JSON.stringify({ reply: 'Done.', patch: null })
      : JSON.stringify({ variants: [{ style: 'condensed', headline: 'Every Chiefs win, in one free email.', body: ['The Huddle, free every morning.'], why: 'The moment' }, { style: 'simple', headline: 'Your team, your inbox.', body: ['Get The Huddle free.'], why: 'Belonging' }] });
    return reply(200, { stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200, cache_read_input_tokens: 600 }, content: [{ type: 'text', text }] });
  }
  if (href.includes('/rest/v1/')) return reply(200, []);
  throw new Error(`unexpected fetch ${href}`);
};
[adsPath, authPath].forEach(p => delete require.cache[p]);
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  bearerToken: () => 'tok',
  verifyEsUser: async () => ({ ok: true, user: { email: 'a@essentiallysports.com' } }),
} };
process.env.AI_GATEWAY_API_KEY = 'gw-test';
delete require.cache[path.join(fnDir, '_ai-gateway.js')];
const { handler, _test } = require(adsPath);
const BRANDS = require(path.resolve('video-ads-brands.js'));
const post = body => handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) })
  .then(r => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const huddle = BRANDS.byId('the-huddle');

// 1. Claims: the file's placeholders until an admin saves a list.
let res = await post({ mode: 'claims' });
assert.equal(res.status, 200);
assert.equal(res.body.canEdit, false);
assert.deepEqual(res.body.claims['the-huddle'].claims, huddle.verifiedClaims);
assert.equal(res.body.claims['the-huddle'].approved, false, 'placeholders stay unapproved');
assert.equal(res.body.claims['the-huddle'].source, 'file');

// Migration not run yet: still the file, never an error.
_test.resetClaims();
claimsStatus = 404;
res = await post({ mode: 'claims' });
assert.equal(res.status, 200);
assert.equal(res.body.claims['es-dugout'].source, 'file');
claimsStatus = 200;

// A saved, approved list wins (cached 5 minutes).
_test.resetClaims();
claimRows = [{ brand_id: 'the-huddle', claims: ['Free to sign up', 'One email each morning'], approved: true, updated_at: '2026-11-18T12:00:00Z' }];
isAdmin = true;
res = await post({ mode: 'claims' });
assert.equal(res.body.canEdit, true);
assert.deepEqual(res.body.claims['the-huddle'], { claims: ['Free to sign up', 'One email each morning'], approved: true, source: 'saved', updatedAt: '2026-11-18T12:00:00Z' });
assert.equal(res.body.claims['essentially-cfb'].source, 'file');
// A one-claim row is ignored (Us vs Them needs 2).
_test.resetClaims();
claimRows = [{ brand_id: 'the-huddle', claims: ['Only one'], approved: true }];
assert.equal((await _test.claimsFor(huddle, 'tok')).source, 'file');

// 2. Saving: admins only, 2-6 short claims, ES style.
assert.match(_test.checkClaims(['One']).error, /Give 2-6 claims/);
assert.match(_test.checkClaims(['a'.repeat(61), 'b']).error, /over 60 characters/);
assert.deepEqual(_test.checkClaims([' Free to sign up ', 'Free to sign up', 'Unsubscribe anytime', '']).claims, ['Free to sign up', 'Unsubscribe anytime'], 'trimmed, deduped');
isAdmin = false;
res = await post({ mode: 'save-claims', brandId: 'the-huddle', claims: ['Free to sign up', 'Unsubscribe anytime'], approved: true });
assert.equal(res.status, 403);
assert.equal(upserts.length, 0, 'a non-admin never writes');
isAdmin = true;
res = await post({ mode: 'save-claims', brandId: 'the-huddle', claims: ['Free to sign up', 'Unsubscribe anytime'], approved: true });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(upserts.length, 1);
assert.match(upserts[0].href, /on_conflict=brand_id/);
assert.match(upserts[0].prefer, /merge-duplicates/);
assert.deepEqual(upserts[0].body, [{ brand_id: 'the-huddle', claims: ['Free to sign up', 'Unsubscribe anytime'], approved: true, updated_by: 'a@essentiallysports.com' }]);
res = await post({ mode: 'save-claims', brandId: 'nope', claims: ['a', 'b'] });
assert.equal(res.status, 400);
upsertStatus = 404;
res = await post({ mode: 'save-claims', brandId: 'the-huddle', claims: ['Free to sign up', 'Unsubscribe anytime'] });
assert.equal(res.status, 503);
assert.match(res.body.error, /migration/);
upsertStatus = 201;

// 3. Copy: Haiku, the rubric in a cached system prompt, the saved claims in the ask.
_test.resetClaims();
claimRows = [{ brand_id: 'the-huddle', claims: ['Free to sign up', 'One email each morning'], approved: true }];
res = await post({ mode: 'copy', brandId: 'the-huddle', sport: 'nfl', notes: 'Chiefs win again.' });
assert.equal(res.status, 200, JSON.stringify(res.body));
assert.equal(lastMessages.model, 'anthropic/claude-haiku-5.5');
assert.ok(Array.isArray(lastMessages.system) && lastMessages.system[0].cache_control?.type === 'ephemeral', 'COPY_SYSTEM is marked cacheable');
assert.ok(_test.COPY_SYSTEM.length >= 1024, 'over the cache minimum');
assert.match(_test.COPY_SYSTEM, /55\+/);
assert.match(_test.COPY_SYSTEM, /free newsletter/);
assert.doesNotMatch(_test.COPY_SYSTEM, /Stat Card|Quote Card|"stat"|"quote"/);
assert.match(lastMessages.messages[0].content, /"One email each morning"/, 'the saved claims reach the model');

// 4. Chat: the same static system prompt every time (cacheable); the ad's context in the first turn.
const layout = { style: 'condensed', headline: 'The offseason moves fast.', highlight: '', body: ['One free email.'], cta: 'SIGN UP THE HUDDLE' };
res = await post({ mode: 'chat', brandId: 'the-huddle', notes: 'Chiefs win.', layout, messages: [{ role: 'user', content: 'Shorter please' }] });
assert.equal(res.status, 200);
const sys1 = JSON.stringify(lastMessages.system);
assert.ok(lastMessages.system[0].cache_control, 'chat system prompt is cacheable');
assert.match(lastMessages.messages[0].content, /^About this ad:/);
assert.match(lastMessages.messages[0].content, /Current ad: .*The offseason moves fast/);
assert.match(lastMessages.messages[0].content, /Shorter please$/);
await post({ mode: 'chat', brandId: 'es-dugout', notes: 'Skubal.', layout: { ...layout, headline: 'Different ad' }, messages: [{ role: 'assistant', content: 'Hi' }, { role: 'user', content: 'Again' }] });
assert.equal(JSON.stringify(lastMessages.system), sys1, 'identical system prompt across ads and brands');
assert.equal(lastMessages.messages[0].role, 'user', 'a thread that starts with the assistant gets a user context turn first');

// 5. The page.
const html = fs.readFileSync('video-ads.html', 'utf8');
['va-set-make', 'va-set-body', 'va-placement', 'va-meta-note', 'va-exmode', 'va-check', 'va-preflight-out'].forEach(id => assert.ok(html.includes(`id="${id}"`), `#${id} is on the page`));
assert.match(html, /video-ads-rating\.js\?v=[\w-]+/);
assert.match(html, /video-ads\.js\?v=[\w-]+/);
assert.match(html, /I have the rights to use this footage/);
assert.doesNotMatch(html, /We can use this footage in a paid ad/);
const js = fs.readFileSync('video-ads.js', 'utf8');
assert.doesNotMatch(js, /if \(!els\.rights\.checked/, 'the rights tick never blocks an export');
assert.doesNotMatch(js, /statLabel|quoteContext|'Stat Card'/, 'no removed-style fields in the page');
assert.match(js, /c\.fillStyle = '#000000'/, 'the empty preview is plain black');
const css = fs.readFileSync('video-ads.css', 'utf8');
assert.doesNotMatch(css, /va-variant__stat/);

console.log('Video Ads hero tests passed.');
