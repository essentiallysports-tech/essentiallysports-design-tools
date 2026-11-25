#!/usr/bin/env node
// Reels Studio media tray (reel-media-tray.js), the pure logic: which file
// goes on which scene (videos to the hook first, file names matched to the
// scene's words, the person's own uploads never replaced), size and type
// validation in plain English, pasted X links, re-adding missing files, and
// the IndexedDB store ('frameup-reels' v2, 'media', keyed projectId/assetId)
// with LRU eviction, on a fake IndexedDB. No DOM, no network.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../reel-media-tray.js');
const E = require('../reel-es.js');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`✅ ${name}`); } catch (error) { console.error(`❌ ${name}\n   ${error.stack}`); process.exitCode = 1; }
}

// ── A small fake IndexedDB: versions, upgrades, stores with out-of-line keys ──
function fakeIndexedDB() {
  const dbs = new Map(); // name -> { version, stores: Map(name -> Map) }
  const log = { opens: [], upgrades: [] };
  const request = fn => { const req = { result: undefined, error: null, onsuccess: null, onerror: null }; queueMicrotask(() => { try { req.result = fn(); req.onsuccess && req.onsuccess({ target: req }); } catch (error) { req.error = error; req.onerror && req.onerror({ target: req }); } }); return req; };
  const storeApi = map => ({
    put: (value, key) => request(() => { map.set(key, value); return key; }),
    get: key => request(() => map.get(key)),
    delete: key => request(() => { map.delete(key); }),
    getAllKeys: () => request(() => [...map.keys()].sort()),
    getAll: () => request(() => [...map.keys()].sort().map(k => map.get(k))),
  });
  return {
    log, dbs,
    open(name, version) {
      log.opens.push([name, version]);
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        const rec = dbs.get(name) || { version: 0, stores: new Map() };
        if (version < rec.version) { req.error = Object.assign(new Error('VersionError'), { name: 'VersionError' }); req.onerror && req.onerror({}); return; }
        const db = {
          objectStoreNames: { contains: n => rec.stores.has(n) },
          createObjectStore: n => { if (rec.stores.has(n)) throw new Error('ConstraintError'); rec.stores.set(n, new Map()); return storeApi(rec.stores.get(n)); },
          transaction: n => { if (!rec.stores.has(n)) throw new Error('NotFoundError'); return { objectStore: () => storeApi(rec.stores.get(n)) }; },
          close() {},
        };
        req.result = db;
        if (version > rec.version) { log.upgrades.push([rec.version, version]); const old = rec.version; rec.version = version; dbs.set(name, rec); req.onupgradeneeded && req.onupgradeneeded({ oldVersion: old }); }
        req.onsuccess && req.onsuccess({});
      });
      return req;
    },
  };
}
const blob = (bytes, type = 'image/jpeg') => ({ size: bytes, type, fake: true });
const MB = 1024 * 1024;

// ── Validation ──
await test('validate: photos and videos the page already took, up to 120 MB', () => {
  assert.deepEqual(T.validate({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }), { ok: true, kind: 'image', type: 'image/jpeg' });
  assert.equal(T.validate({ name: 'a.png', type: 'image/png', size: 1 }).kind, 'image');
  assert.equal(T.validate({ name: 'a.webp', type: 'image/webp', size: 1 }).kind, 'image');
  assert.equal(T.validate({ name: 'a.mp4', type: 'video/mp4', size: 1 }).kind, 'video');
  assert.equal(T.validate({ name: 'a.mov', type: 'video/quicktime', size: 1 }).kind, 'video');
  assert.equal(T.validate({ name: 'a.webm', type: 'video/webm', size: 120 * MB }).ok, true);
  // No type from the OS: the extension decides.
  assert.equal(T.validate({ name: 'CLIP.MOV', type: '', size: 5 }).kind, 'video');
  assert.equal(T.LIMITS.maxBytes, 120 * MB);
  assert.equal(T.ACCEPT, 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm');
});

await test('validate: errors are plain English and say what to do', () => {
  const big = T.validate({ name: 'game-footage.mov', type: 'video/quicktime', size: 300 * MB });
  assert.equal(big.reason, 'size');
  assert.equal(big.error, 'game-footage.mov is 300 MB. Files can be up to 120 MB.');
  assert.match(T.validate({ name: 'IMG_1.HEIC', type: 'image/heic', size: 9 }).error, /Save it as a JPG or PNG/);
  assert.match(T.validate({ name: 'old.avi', type: 'video/x-msvideo', size: 9 }).error, /Save it as an MP4/);
  assert.match(T.validate({ name: 'take.mp3', type: 'audio/mpeg', size: 9 }).error, /is audio\. Add a voiceover under Voice and captions/);
  assert.equal(T.validate({ name: 'notes.pdf', type: 'application/pdf', size: 9 }).error, 'notes.pdf is not a photo or a video.');
  assert.equal(T.validate({ name: 'a.jpg', type: 'image/jpeg', size: 0 }).reason, 'empty');
  assert.equal(T.validate(null).ok, false);
  // Long names are shortened, never the whole path.
  assert.ok(T.validate({ name: `${'x'.repeat(90)}.pdf`, type: '', size: 1 }).error.length < 70);
  assert.equal(T.skippedMessage([]), '');
  assert.equal(T.skippedMessage(['a.pdf is not a photo or a video.']), 'a.pdf is not a photo or a video.');
  assert.match(T.skippedMessage(['one.', 'two.', 'three.']), /^3 files were skipped\. one\. two\. And 1 more\.$/);
});

// ── Auto-assign ──
const beats = (over = {}) => [
  { id: 'b1', media: true, hook: true, locked: false, text: 'THE CUBS LOST', vo: 'The Cubs lost on Sunday.' },
  { id: 'b2', media: false, hook: false, locked: false, text: '1 IN 2,500', vo: 'Kalshi says 1 in 2,500.' },
  { id: 'b3', media: true, hook: false, locked: false, text: 'THIS BAR GOT PAID', vo: 'This bar in Wrigleyville got paid.' },
  { id: 'b4', media: true, hook: false, locked: false, text: 'JOSH ALLEN', name: 'Josh Allen', vo: 'Josh Allen did it again.' },
  { id: 'b5', media: false, hook: false, locked: false, text: '', vo: '' },
].map(b => ({ ...b, ...(over[b.id] || {}) }));
const img = (id, name = `${id}.jpg`) => ({ id, kind: 'image', name });
const vid = (id, name = `${id}.mp4`) => ({ id, kind: 'video', name });

await test('assign: fills the scenes that take media, in order; the others are skipped', () => {
  const out = T.assign([img('i1'), img('i2'), img('i3')], beats(), { match: false });
  assert.deepEqual(out.pairs.map(p => [p.item, p.beat]), [['i1', 'b1'], ['i2', 'b3'], ['i3', 'b4']]);
  assert.deepEqual(out.left, []);
  assert.ok(out.pairs.every(p => p.why === 'order'));
});

await test('assign: the first video goes to the hook, wherever it was in the list', () => {
  const out = T.assign([img('i1'), img('i2'), vid('v1'), vid('v2')], beats(), { match: false });
  assert.deepEqual(out.pairs.find(p => p.item === 'v1'), { item: 'v1', beat: 'b1', why: 'hook' });
  assert.deepEqual(out.pairs.filter(p => p.why === 'order').map(p => [p.item, p.beat]), [['i1', 'b3'], ['i2', 'b4']]);
  assert.deepEqual(out.left, ['v2'], 'more files than scenes: the rest wait in the tray');
  // Only photos: the hook just takes the first one.
  assert.equal(T.assign([img('i1')], beats(), { match: false }).pairs[0].beat, 'b1');
});

await test('assign: a file name that matches a scene\'s words goes there first', () => {
  const out = T.assign([img('i1', 'stadium-wide.jpg'), img('i2', 'Josh_Allen_TD.jpg'), vid('v1', 'wrigleyville-bar.mp4')], beats());
  assert.deepEqual(out.pairs.find(p => p.item === 'i2'), { item: 'i2', beat: 'b4', why: 'name' });
  assert.deepEqual(out.pairs.find(p => p.item === 'v1'), { item: 'v1', beat: 'b3', why: 'name' });
  assert.deepEqual(out.pairs.find(p => p.item === 'i1'), { item: 'i1', beat: 'b1', why: 'order' });
  // Camera-roll names match nothing (no false matches on "img", numbers or extensions).
  assert.equal(T.matchScore('IMG_2500.jpg', beats()[1]), 0);
  assert.equal(T.matchScore('video-final-copy.mp4', beats()[0]), 0);
  assert.equal(T.matchScore('cubs-lost.png', beats()[0]), 2);
  // Matching can be switched off.
  assert.ok(T.assign([img('i2', 'Josh_Allen_TD.jpg')], beats(), { match: false }).pairs[0].beat === 'b1');
});

await test('assign: the person\'s own uploads are never replaced; no free scene -> the file waits', () => {
  const locked = beats({ b1: { locked: true }, b3: { locked: true } });
  const out = T.assign([vid('v1'), img('i1')], locked, { match: false });
  assert.deepEqual(out.pairs.map(p => [p.item, p.beat]), [['v1', 'b4']]);
  assert.deepEqual(out.left, ['i1']);
  assert.deepEqual(T.assign([img('i1')], beats({ b1: { locked: true }, b3: { locked: true }, b4: { locked: true } })), { pairs: [], left: ['i1'] });
  assert.deepEqual(T.assign([], beats()), { pairs: [], left: [] });
  assert.deepEqual(T.assign([img('i1')], []), { pairs: [], left: ['i1'] });
  // One file per scene, one scene per file.
  const many = T.assign([img('a'), img('b'), img('c'), img('d'), img('e')], beats(), { match: false });
  assert.equal(new Set(many.pairs.map(p => p.beat)).size, many.pairs.length);
  assert.equal(new Set(many.pairs.map(p => p.item)).size, many.pairs.length);
});

await test('assign: works on a real ES plan (ES.takesMedia decides which scenes take a picture)', () => {
  const plan = E.scriptToPlan('The Cubs lost on Sunday night. This bar got paid in full. Kalshi says 1 in 2,500 bets was insurance. Nobody in Wrigleyville is complaining now.');
  const list = plan.beats.map((b, i) => ({ id: b.id, media: E.takesMedia(b), hook: i === 0, locked: false, text: b.text, vo: b.vo }));
  const taking = list.filter(b => b.media).map(b => b.id);
  assert.ok(taking.includes(plan.beats[0].id), 'the hook takes media');
  assert.ok(!taking.includes(plan.beats[plan.beats.length - 1].id), 'the end card does not');
  const out = T.assign([img('i1'), vid('v1')], list, { match: false });
  assert.equal(out.pairs.find(p => p.item === 'v1').beat, plan.beats[0].id);
  out.pairs.forEach(p => assert.ok(taking.includes(p.beat)));
});

await test('pasted text: an X post link is recognised; anything else is left alone', () => {
  assert.deepEqual(T.xLinkIn('https://x.com/BuffaloBills/status/1234567890123?s=20'), { url: 'https://x.com/BuffaloBills/status/1234567890123', handle: 'BuffaloBills', id: '1234567890123' });
  assert.equal(T.xLinkIn(' twitter.com/NFL/status/99999 ').url, 'https://x.com/NFL/status/99999');
  assert.equal(T.xLinkIn('mobile.twitter.com/NFL/statuses/99999/video/1').handle, 'NFL');
  ['https://x.com/NFL', 'see https://x.com/NFL/status/99999 now', 'https://evil.com/x.com/NFL/status/99999', 'https://youtube.com/watch?v=1', '', null].forEach(text => assert.equal(T.xLinkIn(text), null));
});

await test('re-adding missing files: name + size first, then name; the rest are new files', () => {
  const missing = [{ id: 'up:1', name: 'hook.mp4', size: 100, beats: ['b1'] }, { id: 'up:2', name: 'bar.jpg', size: 50, beats: ['b3'] }, { id: 'up:3', name: 'bar.jpg', size: 70, beats: ['b4'] }];
  const files = [{ name: 'bar.jpg', size: 70 }, { name: 'hook.mp4', size: 999 }, { name: 'new.png', size: 5 }, { name: 'bar.jpg', size: 50 }];
  const out = T.matchMissing(missing, files);
  assert.deepEqual(out.pairs.map(p => [p.missing.id, p.file.size]).sort(), [['up:1', 999], ['up:2', 50], ['up:3', 70]]);
  assert.deepEqual(out.rest.map(f => f.name), ['new.png']);
  assert.deepEqual(out.left, []);
  assert.deepEqual(T.matchMissing(missing, [{ name: 'other.jpg', size: 1 }]).left.length, 3);
  assert.equal(missing.length, 3, 'the input list is not changed');
});

// ── Persistence ──
await test('store: opens frameup-reels at v2 and adds the media store next to the voice cache', async () => {
  const idb = fakeIndexedDB();
  // A browser that already has v1 (the voice cache only).
  await new Promise(resolve => { const req = idb.open('frameup-reels', 1); req.onupgradeneeded = () => req.result.createObjectStore('vo'); req.onsuccess = resolve; });
  idb.dbs.get('frameup-reels').stores.get('vo').set('k', { bytes: 1 });
  const store = T.createStore({ indexedDB: idb });
  assert.equal(await store.put('p1', 'up:1', blob(10), { name: 'a.jpg', kind: 'image' }), true);
  assert.deepEqual(idb.log.upgrades, [[0, 1], [1, 2]]);
  const rec = idb.dbs.get('frameup-reels');
  assert.equal(rec.version, 2);
  assert.deepEqual([...rec.stores.keys()].sort(), ['media', 'vo']);
  assert.deepEqual(rec.stores.get('vo').get('k'), { bytes: 1 }, 'the voice cache is untouched');
  assert.ok(rec.stores.get('media').has('p1/up:1'), 'keyed projectId/assetId');
  assert.equal(T.DB_NAME, 'frameup-reels');
  assert.equal(T.DB_VERSION, 2);
  // A fresh browser gets both stores in one go.
  const fresh = fakeIndexedDB();
  await T.openDb(fresh);
  assert.deepEqual([...fresh.dbs.get('frameup-reels').stores.keys()].sort(), ['media', 'vo']);
});

await test('store: put / get / remove keep the file and its details', async () => {
  let clock = 1000;
  const store = T.createStore({ indexedDB: fakeIndexedDB(), now: () => (clock += 1) });
  const file = blob(2048, 'video/mp4');
  await store.put('p1', 'up:a', file, { name: 'hook.mp4', type: 'video/mp4', kind: 'video', size: 2048 });
  const got = await store.get('p1', 'up:a');
  assert.equal(got.blob, file);
  assert.deepEqual([got.name, got.type, got.kind, got.size], ['hook.mp4', 'video/mp4', 'video', 2048]);
  assert.equal(await store.get('p1', 'nope'), null);
  assert.equal(await store.get('p2', 'up:a'), null, 'projects do not see each other\'s files');
  await store.put('p1', 'voice', blob(900, 'audio/webm'), { name: 'Recording', kind: 'voice' });
  assert.equal((await store.get('p1', 'voice')).kind, 'voice', 'an uploaded voiceover is kept the same way');
  assert.equal(await store.remove('p1', 'up:a'), true);
  assert.equal(await store.get('p1', 'up:a'), null);
  assert.equal(await store.put('', 'x', file), false);
  assert.equal(await store.put('p1', 'x', null), false);
});

await test('store: least recently used projects go once there are more than 12', async () => {
  let clock = 0;
  const idb = fakeIndexedDB();
  const store = T.createStore({ indexedDB: idb, now: () => (clock += 1) });
  for (let i = 1; i <= 14; i += 1) await store.put(`p${i}`, 'up:1', blob(MB));
  await store.touch('p1'); // reopened: now the most recent
  const gone = await store.evict('p14');
  assert.deepEqual(gone.sort(), ['p2', 'p3']);
  const left = (await store.projects()).map(p => p.projectId);
  assert.equal(left.length, 12);
  assert.ok(left.includes('p1') && left.includes('p14') && !left.includes('p2'));
  assert.equal(await store.get('p2', 'up:1'), null);
  assert.ok(await store.get('p1', 'up:1'));
  assert.deepEqual(await store.evict('p14'), [], 'nothing more to remove');
  assert.equal(T.LIMITS.storeProjects, 12);
});

await test('store: past ~500 MB the oldest projects go; the open project never does', async () => {
  let clock = 0;
  const store = T.createStore({ indexedDB: fakeIndexedDB(), now: () => (clock += 1) });
  await store.put('old', 'up:1', blob(200 * MB));
  await store.put('mid', 'up:1', blob(200 * MB));
  await store.put('mid', 'up:2', blob(50 * MB));
  await store.put('new', 'up:1', blob(150 * MB));
  assert.deepEqual(await store.evict('new'), ['old']);
  assert.deepEqual((await store.projects()).map(p => [p.projectId, p.bytes]), [['new', 150 * MB], ['mid', 250 * MB]]);
  // The open project alone is over the limit: it stays (its files are in use), the others go.
  await store.put('new', 'up:2', blob(120 * MB));
  await store.put('new', 'up:3', blob(120 * MB));
  await store.put('new', 'up:4', blob(120 * MB));
  assert.deepEqual(await store.evict('new'), ['mid']);
  assert.equal((await store.projects()).length, 1);
  assert.ok(await store.get('new', 'up:4'));
  assert.equal(T.LIMITS.storeBytes, 500 * MB);
});

await test('store: no IndexedDB, or a blocked upgrade, never throws (uploads still work in this tab)', async () => {
  const none = T.createStore({ indexedDB: null });
  assert.equal(none.available(), false);
  assert.equal(await none.put('p', 'a', blob(1)), false);
  assert.equal(await none.get('p', 'a'), null);
  assert.deepEqual(await none.projects(), []);
  assert.deepEqual(await none.evict('p'), []);
  // An upgrade that never finishes (another tab on v1) gives up quietly.
  const stuck = { open: () => ({}) };
  await assert.rejects(T.openDb(stuck, { timeoutMs: 20 }), /blocked/);
  const broken = T.createStore({ indexedDB: { open() { throw new Error('SecurityError'); } } });
  assert.equal(await broken.put('p', 'a', blob(1)), false);
  assert.equal(await broken.get('p', 'a'), null);
});

console.log(process.exitCode ? '\nReel media tray tests failed.' : `\nAll ${passed} reel media tray tests passed.`);
