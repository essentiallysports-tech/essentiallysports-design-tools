// The template look's photo (es-generate.js classicPhotos): the same
// right-person check as Creative (asset service findPhotos), and never an
// unchecked guess. Run: node scripts/test-generate-classic-photos.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
delete process.env.AI_GATEWAY_API_KEY; // no Gateway: the old Haiku pick cannot run
process.env.GENERATE_PHOTO_BUDGET_MS = '4000';
const composer = require('../netlify/functions/_composer.js');
const { _test } = require('../netlify/functions/es-generate.js');
const { classicPhotos, verifiedPhotosFor } = _test;

const ES = name => `https://image-cdn.essentiallysports.com/wp-content/uploads/${name}.jpg`;
const proxy = url => `/api/es-image-search?image=${encodeURIComponent(url)}`;
const READ = { subjects: ['Josh Allen', 'Patrick Mahomes'], team: 'Buffalo Bills', sport: 'NFL' };
const FOUND = { articles: [{ title: 'Patrick Mahomes leads Chiefs past Bills', image: ES('mahomes-lead') }] };
let calls = [];
const service = photos => ({ findPhotos: async args => { calls.push(args); return typeof photos === 'function' ? photos(args) : photos; } });
let pass = 0;
const ok = async (name, fn) => { calls = []; await fn(); pass += 1; console.log(`ok - ${name}`); };

await ok('verified photos from the asset service are used, best first; unverified ones never', async () => {
  composer.setAssetService(service({ ok: true, subject: { name: 'Josh Allen' }, photos: [
    { url: proxy(ES('allen-1')), sourceUrl: ES('allen-1'), title: 'Bills QB Josh Allen 17', verified: true },
    { url: proxy(ES('mahomes-2')), sourceUrl: ES('mahomes-2'), title: 'Chiefs QB', verified: false },
    { url: proxy(ES('allen-3')), sourceUrl: ES('allen-3'), title: 'Josh Allen runs', verified: true },
  ] }));
  const { candidates, pick } = await classicPhotos({ person: 'Josh Allen', read: READ, found: FOUND, mcp: null, tools: {}, track: { runId: 'r' } });
  assert.deepEqual(candidates.map(c => c.sourceUrl), [ES('allen-1'), ES('allen-3')]);
  assert.equal(pick.picked, true);
  assert.equal(pick.rejected, false);
  assert.equal(pick.verified, true);
});

await ok('the right-person facts go to the service: sport, team, the other people named', async () => {
  composer.setAssetService(service({ ok: true, subject: {}, photos: [] }));
  await classicPhotos({ person: 'Josh Allen', read: READ, found: FOUND, mcp: null, tools: {}, track: null });
  assert.equal(calls[0].person, 'Josh Allen');
  assert.equal(calls[0].sport, 'NFL');
  assert.deepEqual(calls[0].teams, ['Buffalo Bills']);
  assert.deepEqual(calls[0].others, ['Patrick Mahomes'], 'never labelled as this person');
});

await ok('checked and nothing shows them: no photo on the card, what was found goes to the picker', async () => {
  composer.setAssetService(service({ ok: true, subject: { name: 'Josh Allen' }, photos: [] }));
  const { candidates, pick } = await classicPhotos({ person: 'Josh Allen', read: READ, found: FOUND, mcp: null, tools: {}, track: null });
  assert.equal(pick.rejected, true, 'the Mahomes lead image is never placed on a Josh Allen post');
  assert.deepEqual(candidates.map(c => c.sourceUrl), [ES('mahomes-lead')], 'but it is offered to pick');
});

await ok('no asset service: the old candidates, but an unchecked first photo is never used', async () => {
  composer.setAssetService(null);
  const { candidates, pick } = await classicPhotos({ person: 'Josh Allen', read: READ, found: FOUND, mcp: null, tools: {}, track: null });
  assert.equal(candidates.length, 1);
  assert.equal(pick.picked, false);
  assert.equal(pick.rejected, true, 'one candidate and no check: offered, not placed');
});

await ok('a failing or slow service falls back (never throws, never hangs the run)', async () => {
  composer.setAssetService({ findPhotos: async () => { throw new Error('ES down'); } });
  assert.equal(await verifiedPhotosFor('Josh Allen', READ, null), null);
  composer.setAssetService({ findPhotos: () => new Promise(() => {}) });
  const started = Date.now();
  assert.equal(await verifiedPhotosFor('Josh Allen', READ, null, 50), null);
  assert.ok(Date.now() - started < 1000, 'the budget cuts it off');
  composer.setAssetService(service({ ok: false, error: 'empty' }));
  assert.equal(await verifiedPhotosFor('Josh Allen', READ, null), null);
});

await ok('an unknown subject (not an ES person or team) falls back instead of counting as checked', async () => {
  composer.setAssetService(service({ ok: true, subject: null, photos: [] }));
  assert.equal(await verifiedPhotosFor('Masters trophy', READ, null), null);
});

await ok('a story with no person: the team is the subject (by its name, not as a person)', async () => {
  composer.setAssetService(service({ ok: true, subject: {}, photos: [{ url: proxy(ES('bills')), sourceUrl: ES('bills'), title: 'Buffalo Bills', verified: true }] }));
  const { candidates, pick } = await classicPhotos({ person: '', read: { subjects: [], team: 'Buffalo Bills', sport: 'NFL' }, found: { articles: [] }, mcp: null, tools: {}, track: null });
  assert.equal(calls[0].team, 'Buffalo Bills');
  assert.equal(calls[0].person, undefined);
  assert.equal(pick.picked, true);
  assert.equal(candidates[0].sourceUrl, ES('bills'));
});

composer.setAssetService(null);
console.log(`test-generate-classic-photos: ${pass} passed`);
