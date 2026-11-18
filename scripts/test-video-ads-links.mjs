#!/usr/bin/env node
// Video Ads "Video link" (video-ads-links.js + netlify/functions/_clip-link.js),
// every network call and DNS lookup mocked: platform detection, Drive /
// Dropbox conversion, the SSRF guard (private IPs, redirects, DNS), one
// resolver per platform, YouTube / Instagram / stream / CORS-blocked messages,
// the 720p badge, and that the server never reads video bytes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const L = require(path.resolve('video-ads-links.js'));
const PUB = require(path.resolve('netlify/functions/_clip-source-public.js'));
const LINK = require(path.resolve('netlify/functions/_clip-link.js'));
PUB._test.pacing.scale = 0;

let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; };

// ── Mocks ──────────────────────────────────────────────────────────────────
const DNS = { 'cdn.example-sports.com': ['93.184.216.34'], 'files.example.org': ['151.101.1.1'], 'evil.example.net': ['10.0.0.5'], 'rebind.example.net': ['93.184.216.34', '127.0.0.1'], 'meta.example.net': ['169.254.169.254'], 'v6.example.net': ['::ffff:192.168.1.1'], 'drive.usercontent.google.com': ['142.250.1.1'], 'dl.dropboxusercontent.com': ['162.125.1.1'], 'v.redd.it': ['151.101.1.140'], 'news.example.org': ['151.101.2.2'] };
LINK.deps.lookup = async host => {
  if (!DNS[host]) { const e = new Error('ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }
  return DNS[host].map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
};
const routes = [];
const seen = [];
const route = (test, reply) => routes.push([test, reply]);
const res = (status, body, headers = {}) => {
  const h = new Headers(headers);
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  return { ok: status >= 200 && status < 300, status, headers: h, json: async () => JSON.parse(text), text: async () => text, body: { cancel: async () => {}, getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new TextEncoder().encode(text) })), cancel: async () => {} }; } } };
};
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  seen.push({ href, method: init.method || 'GET', headers: init.headers || {} });
  for (const [t, reply] of routes) if (typeof t === 'string' ? href.startsWith(t) : t.test(href)) return reply(href, init);
  throw new Error(`unexpected fetch ${href}`);
};
const reset = () => { routes.length = 0; seen.length = 0; PUB._test.reset(); };
const noVideoBytes = () => {
  for (const s of seen) {
    const isMediaGet = s.method === 'GET' && /\.(?:mp4|mov|webm)(?:\?|$)|getBlob|CMAF_/.test(s.href);
    if (isMediaGet) assert.equal(s.headers.Range, 'bytes=0-0', `media GET must be a 1-byte probe: ${s.href}`);
  }
};
const xStub = async url => ({ ok: true, url, handle: 'NFL', author: 'NFL', text: 'Catch', thumbnail: 'https://pbs.twimg.com/t.jpg', durationMs: 18000, variants: [
  { url: 'https://video.twimg.com/a/vid/avc1/1280x720/a.mp4', width: 1280, height: 720, bitrate: 2176000 },
  { url: 'https://video.twimg.com/a/vid/avc1/1920x1080/a.mp4', width: 1920, height: 1080, bitrate: 10368000 },
] });
const resolve = (u, extra = {}) => LINK.resolveLink(u, { clipFromPost: xStub, env: {}, ...extra });

// ── Detection ──────────────────────────────────────────────────────────────
await test('detect: every platform, files, streams, pages', () => {
  const kinds = {
    'https://x.com/NFL/status/1': ['x', 'post'], 'https://twitter.com/NFL/status/1': ['x', 'post'], 'x.com/NFL/status/1': ['x', 'post'],
    'https://www.youtube.com/watch?v=abc': ['youtube', 'blocked'], 'https://youtu.be/abc': ['youtube', 'blocked'], 'https://m.youtube.com/shorts/abc': ['youtube', 'blocked'],
    'https://bsky.app/profile/nfl.bsky.social/post/3abc': ['bluesky', 'post'],
    'https://www.reddit.com/r/nfl/comments/abc123/td/': ['reddit', 'post'], 'https://v.redd.it/xyz789': ['reddit', 'post'], 'https://redd.it/abc123': ['reddit', 'post'],
    'https://streamable.com/abc12': ['streamable', 'post'], 'https://vimeo.com/76979871': ['vimeo', 'post'], 'https://player.vimeo.com/video/76979871': ['vimeo', 'post'],
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing': ['drive', 'share'], 'https://www.dropbox.com/scl/fi/abc/td.mp4?rlkey=k&dl=0': ['dropbox', 'share'],
    'https://www.instagram.com/reel/abc/': ['instagram', 'blocked'], 'https://www.threads.net/@nfl/post/abc': ['threads', 'blocked'], 'https://www.facebook.com/watch/?v=1': ['facebook', 'blocked'], 'https://fb.watch/abc/': ['facebook', 'blocked'], 'https://www.tiktok.com/@nfl/video/1': ['tiktok', 'blocked'],
    'https://cdn.example-sports.com/clips/td.mp4': ['direct', 'file'], 'https://cdn.example-sports.com/a.MOV?sig=1': ['direct', 'file'], 'https://cdn.example-sports.com/a.webm': ['direct', 'file'],
    'https://cdn.example-sports.com/live/master.m3u8': ['stream', 'stream'], 'https://news.example.org/story': ['web', 'page'],
  };
  for (const [u, [platform, kind]] of Object.entries(kinds)) {
    const d = L.detect(u);
    assert.equal(d?.platform, platform, u);
    assert.equal(d?.kind, kind, u);
  }
  assert.equal(L.detect(''), null);
  assert.equal(L.detect('not a link'), null);
  assert.equal(L.detect('ftp://x.com/a'), null);
  assert.equal(L.detect('javascript:alert(1)'), null);
});

await test('Drive and Dropbox share links -> direct downloads', () => {
  assert.equal(L.driveDirect('https://drive.google.com/file/d/1AbCdEfGhIjKlMn_-/view?usp=sharing'), 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn_-&export=download');
  assert.equal(L.driveDirect('https://drive.google.com/open?id=1AbCdEfGhIjKlMn'), 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn&export=download');
  assert.equal(L.driveDirect('https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMn&resourcekey=0-xyz'), 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn&export=download&resourcekey=0-xyz');
  assert.equal(L.driveDirect('https://drive.google.com/drive/folders/abc'), '');
  assert.equal(L.dropboxDirect('https://www.dropbox.com/s/abc123/td.mp4?dl=0'), 'https://dl.dropboxusercontent.com/s/abc123/td.mp4');
  assert.equal(L.dropboxDirect('https://www.dropbox.com/scl/fi/abc123/td.mp4?rlkey=k9&dl=0'), 'https://dl.dropboxusercontent.com/scl/fi/abc123/td.mp4?rlkey=k9');
  assert.equal(L.dropboxDirect('https://www.dropbox.com/sh/folder/abc?dl=0'), '', 'folders are not files');
  assert.equal(L.dropboxDirect('https://evil.example.net/s/abc/td.mp4'), '');
});

await test('quality labels and sizes', () => {
  assert.equal(L.qualityLabel(1920, 1080), '1080p');
  assert.equal(L.qualityLabel(1080, 1920), '1080p');
  assert.equal(L.qualityLabel(1280, 720), '720p');
  assert.equal(L.qualityLabel(640, 360), '360p');
  assert.equal(L.qualityLabel(3840, 2160), '4K');
  assert.equal(L.qualityLabel(0, 0), '');
  assert.equal(L.fmtBytes(24e6), '24 MB');
  assert.equal(L.fmtBytes(0), '');
});

// ── SSRF guard ─────────────────────────────────────────────────────────────
await test('SSRF: private, loopback, link-local, metadata, mapped IPv6, ports, schemes', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1'.replace('a00:1', '10.0.0.1')]) {
    assert.equal(LINK.isPrivateIp(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(LINK.isPrivateIp(ip), false, ip);
  const bad = ['http://cdn.example-sports.com/a.mp4', 'https://127.0.0.1/a.mp4', 'https://[::1]/a.mp4', 'https://169.254.169.254/latest/meta-data', 'https://localhost/a.mp4', 'https://box.internal/a.mp4', 'https://intranet/a.mp4', 'https://user:pw@cdn.example-sports.com/a.mp4', 'https://cdn.example-sports.com:8443/a.mp4', 'https://evil.example.net/a.mp4', 'https://rebind.example.net/a.mp4', 'https://meta.example.net/a.mp4', 'https://v6.example.net/a.mp4'];
  for (const u of bad) assert.equal((await LINK.checkUrl(u)).ok, false, u);
  assert.equal((await LINK.checkUrl('https://cdn.example-sports.com/a.mp4')).ok, true);
  assert.equal((await LINK.checkUrl('https://nope.example-sports.com/a.mp4')).reason, 'unreachable', 'unknown host');
});

await test('SSRF: a redirect to a private address is refused, and nothing is fetched there', async () => {
  reset();
  route('https://cdn.example-sports.com/go.mp4', () => res(302, '', { location: 'https://evil.example.net/secret.mp4' }));
  const r = await resolve('https://cdn.example-sports.com/go.mp4');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'private');
  assert.ok(!seen.some(s => s.href.includes('evil.example.net')), 'never fetched');
  reset();
  route('https://cdn.example-sports.com/loop', (href) => res(302, '', { location: href }));
  const loop = await resolve('https://cdn.example-sports.com/loop');
  assert.equal(loop.ok, false, 'redirect loops end');
  assert.ok(seen.length <= 5);
});

await test('a pasted private / http / bad link is refused before any fetch', async () => {
  reset();
  for (const u of ['https://192.168.1.10/clip.mp4', 'http://cdn.example-sports.com/a.mp4', 'nonsense', '']) {
    const r = await resolve(u);
    assert.equal(r.ok, false, u);
    assert.ok([400, 422].includes(r.status), `${u} -> ${r.status}`);
  }
  assert.equal(seen.length, 0);
});

// ── Blocked hosts ──────────────────────────────────────────────────────────
await test('YouTube: never downloaded, a clear message, no fetch', async () => {
  reset();
  const r = await resolve('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.equal(r.reason, 'youtube');
  assert.match(r.title, /YouTube/);
  assert.match(r.error, /drop the file here/);
  assert.equal(r.openUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(seen.length, 0);
});
await test('Instagram / Threads / Facebook / TikTok: blocked with the upload fallback', async () => {
  reset();
  for (const [u, p] of [['https://www.instagram.com/reel/abc/', 'instagram'], ['https://www.threads.net/@a/post/b', 'threads'], ['https://fb.watch/x/', 'facebook'], ['https://www.tiktok.com/@a/video/1', 'tiktok']]) {
    const r = await resolve(u);
    assert.equal(r.reason, 'blocked', u);
    assert.equal(r.platform, p);
    assert.match(r.error, /drop the file here/);
  }
  assert.equal(seen.length, 0);
});
await test('m3u8 playlists: explained, not faked', async () => {
  reset();
  const r = await resolve('https://cdn.example-sports.com/live/master.m3u8');
  assert.equal(r.reason, 'stream');
  assert.match(r.error, /not one video file/);
});

// ── Resolvers ──────────────────────────────────────────────────────────────
await test('X: best first, quality badges, CORS open', async () => {
  reset();
  const r = await resolve('https://twitter.com/NFL/status/123?s=20');
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'x');
  assert.deepEqual(r.variants.map(v => v.quality), ['1080p', '720p']);
  assert.equal(r.quality, '1080p');
  assert.equal(r.belowFloor, false);
  assert.equal(r.cors, 'open');
  const bad = await LINK.resolveLink('https://x.com/NFL/status/1', { clipFromPost: async () => ({ ok: false, status: 404, reason: 'no-video', error: 'That post has no downloadable video.' }) });
  assert.equal(bad.reason, 'no-video');
});

await test('Bluesky: post -> PDS getBlob (original upload)', async () => {
  reset();
  const did = 'did:plc:abc123';
  const cid = 'bafkreiexample';
  route('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle', href => {
    assert.match(href, /handle=nfl\.bsky\.social/);
    return res(200, { did });
  });
  route('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts', href => {
    assert.match(decodeURIComponent(href), /at:\/\/did:plc:abc123\/app\.bsky\.feed\.post\/3kxyz/, 'the handle is resolved to a DID first');
    return res(200, { posts: [{ uri: `at://${did}/app.bsky.feed.post/3kxyz`, cid: 'c', author: { did, handle: 'nfl.bsky.social', displayName: 'NFL' }, indexedAt: new Date().toISOString(),
      record: { text: 'Walk-off', createdAt: new Date().toISOString(), embed: { $type: 'app.bsky.embed.video', aspectRatio: { width: 1920, height: 1080 }, video: { ref: { $link: cid }, mimeType: 'video/mp4', size: 12e6 } } },
      embed: { $type: 'app.bsky.embed.video#view', cid, playlist: 'https://video.bsky.app/watch/x/playlist.m3u8', thumbnail: 'https://video.bsky.app/watch/x/thumbnail.jpg' } }] });
  });
  route(`https://plc.directory/${did}`, () => res(200, { service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://morel.us-east.host.bsky.network' }] }));
  const r = await resolve('https://bsky.app/profile/nfl.bsky.social/post/3kxyz');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.platform, 'bluesky');
  assert.equal(r.variants[0].url, `https://morel.us-east.host.bsky.network/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${cid}`);
  assert.equal(r.quality, '1080p');
  assert.equal(r.bytes, 12e6);
  assert.equal(r.cors, 'open');
  noVideoBytes();
});
await test('Bluesky: a self-hosted PDS on a private address is refused', async () => {
  reset();
  const did = 'did:web:evil.example.net';
  route('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle', () => res(200, { did }));
  route('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts', () => res(200, { posts: [{ uri: `at://${did}/app.bsky.feed.post/3k`, author: { did, handle: 'evil.example.net' }, indexedAt: new Date().toISOString(), record: { text: 'x', embed: { $type: 'app.bsky.embed.video', video: { ref: { $link: 'bafk' }, mimeType: 'video/mp4' } } }, embed: { $type: 'app.bsky.embed.video#view', cid: 'bafk' } }] }));
  route('https://evil.example.net/.well-known/did.json', () => res(200, { service: [{ id: '#atproto_pds', serviceEndpoint: 'https://evil.example.net' }] }));
  const r = await resolve('https://bsky.app/profile/evil.example.net/post/3k');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'private');
});

const redditPost = { kind: 'Listing', data: { children: [{ kind: 't3', data: { permalink: '/r/nfl/comments/abc123/td/', subreddit: 'nfl', title: 'Kelce TD', created_utc: Date.now() / 1000 - 3600, score: 900,
  secure_media: { reddit_video: { fallback_url: 'https://v.redd.it/vid9/CMAF_1080.mp4?source=fallback', width: 1920, height: 1080, duration: 21, has_audio: true, hls_url: 'https://v.redd.it/vid9/HLSPlaylist.m3u8?a=1' } } } }] } };
await test('Reddit: post -> v.redd.it MP4s, best first, sound missing said plainly', async () => {
  reset();
  route('https://www.reddit.com/comments/abc123.json', () => res(200, [redditPost]));
  const r = await resolve('https://www.reddit.com/r/nfl/comments/abc123/td/');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.platform, 'reddit');
  assert.deepEqual(r.variants.map(v => v.url), ['https://v.redd.it/vid9/CMAF_1080.mp4', 'https://v.redd.it/vid9/CMAF_720.mp4', 'https://v.redd.it/vid9/CMAF_480.mp4']);
  assert.deepEqual(r.variants.map(v => v.quality), ['1080p', '720p', '480p']);
  assert.equal(r.hasAudio, false);
  assert.match(r.audioNote, /without sound/);
  assert.equal(r.durationMs, 21000);
  noVideoBytes();
});
await test('Reddit: v.redd.it link follows one redirect to its post', async () => {
  reset();
  route('https://v.redd.it/vid9', () => res(301, '', { location: 'https://www.reddit.com/r/nfl/comments/abc123/td/' }));
  route('https://www.reddit.com/comments/abc123.json', () => res(200, [redditPost]));
  const r = await resolve('https://v.redd.it/vid9');
  assert.equal(r.ok, true, r.error);
  assert.equal(seen.find(s => s.href.startsWith('https://v.redd.it/vid9')).method, 'HEAD');
});
await test('Reddit: blocked (403) -> honest fallback with the post to open', async () => {
  reset();
  route('https://www.reddit.com/comments/', () => res(403, {}));
  const r = await resolve('https://www.reddit.com/r/nfl/comments/zzz999/td/');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unreachable');
  assert.match(r.error, /drop it here/);
  assert.equal(r.openUrl, 'https://www.reddit.com/r/nfl/comments/zzz999/td/');
});

await test('Streamable: public API -> signed CDN MP4', async () => {
  reset();
  route('https://api.streamable.com/videos/abc12', () => res(200, { status: 2, title: 'Catch', thumbnail_url: '//cdn-cf-east.streamable.com/image/abc12.jpg', audio_channels: 2,
    files: { mp4: { url: '//cdn-cf-east.streamable.com/video/mp4/abc12.mp4?Expires=9999999999&Signature=s', width: 1280, height: 720, duration: 14.2, size: 5e6 } } }));
  const r = await resolve('https://streamable.com/abc12');
  assert.equal(r.ok, true, r.error);
  assert.match(r.variants[0].url, /^https:\/\/cdn-cf-east\.streamable\.com\/video\/mp4\/abc12\.mp4\?/);
  assert.equal(r.quality, '720p');
  assert.equal(r.hasAudio, true);
  assert.equal(r.durationMs, 14200);
});

await test('Vimeo: progressive files when allowed; stream-only explained', async () => {
  reset();
  route('https://player.vimeo.com/video/111222333/config', () => res(200, { video: { title: 'Drill', duration: 30, owner: { name: 'Coach' } }, request: { files: { progressive: [
    { url: 'https://vod-progressive.akamaized.net/a/360.mp4', width: 640, height: 360 }, { url: 'https://vod-progressive.akamaized.net/a/1080.mp4', width: 1920, height: 1080 },
  ], hls: {} } } }));
  const r = await resolve('https://vimeo.com/111222333');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.variants.map(v => v.quality), ['1080p', '360p']);
  assert.equal(r.cors, 'unknown');
  reset();
  route('https://player.vimeo.com/video/76979871/config', () => res(200, { video: { title: 'x', duration: 62 }, request: { files: { dash: {}, hls: {}, progressive: [] } } }));
  const s = await resolve('https://vimeo.com/76979871');
  assert.equal(s.reason, 'stream');
  assert.match(s.title, /Vimeo/);
});

await test('Google Drive: converted, probed with HEAD; HTML warning page explained', async () => {
  reset();
  route('https://drive.usercontent.google.com/download', (href, init) => {
    assert.equal(init.method, 'HEAD');
    return res(200, '', { 'content-type': 'video/mp4', 'content-length': '24000000' });
  });
  const r = await resolve('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.platform, 'drive');
  assert.equal(r.bytes, 24e6);
  assert.equal(r.directUrl, 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMn&export=download');
  assert.equal(r.cors, 'unknown', 'no ACAO header: the page tries, then falls back');
  reset();
  route('https://drive.usercontent.google.com/download', () => res(200, '<html>', { 'content-type': 'text/html; charset=utf-8' }));
  const warn = await resolve('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view');
  assert.equal(warn.reason, 'private-file');
  assert.match(warn.error, /Google Drive/);
  reset();
  route('https://drive.usercontent.google.com/download', () => res(403, ''));
  const priv = await resolve('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view');
  assert.match(priv.error, /Anyone with the link/);
});

await test('Dropbox: converted; HEAD refused -> 1-byte range GET; CORS read from ACAO', async () => {
  reset();
  route('https://dl.dropboxusercontent.com/scl/fi/abc/td.mp4', (href, init) => (init.method === 'HEAD'
    ? res(405, '')
    : res(206, '', { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/31000000', 'access-control-allow-origin': '*' })));
  const r = await resolve('https://www.dropbox.com/scl/fi/abc/td.mp4?rlkey=k9&dl=0');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.bytes, 31e6);
  assert.equal(r.cors, 'open');
  noVideoBytes();
});

await test('Direct files: video checked; too big refused; not a video refused; CORS blocked flagged', async () => {
  reset();
  route('https://cdn.example-sports.com/clips/td.mp4', () => res(200, '', { 'content-type': 'video/mp4', 'content-length': '9000000', 'access-control-allow-origin': 'https://other.site' }));
  const r = await resolve('https://cdn.example-sports.com/clips/td.mp4');
  assert.equal(r.ok, true);
  assert.equal(r.cors, 'blocked');
  assert.equal(r.quality, '', 'size unknown until the browser reads it');
  reset();
  route('https://cdn.example-sports.com/huge.mp4', () => res(200, '', { 'content-type': 'video/mp4', 'content-length': String(900e6) }));
  assert.equal((await resolve('https://cdn.example-sports.com/huge.mp4')).reason, 'too-large');
  reset();
  route('https://cdn.example-sports.com/fake.mp4', () => res(200, '', { 'content-type': 'text/html' }));
  assert.equal((await resolve('https://cdn.example-sports.com/fake.mp4')).reason, 'not-video');
});

await test('Any page: og:video MP4 found and probed; none -> fallback', async () => {
  reset();
  route('https://news.example.org/story', () => res(200, '<html><head><meta property="og:title" content="Big catch"><meta property="og:video:secure_url" content="https://cdn.example-sports.com/v/catch.mp4"><meta property="og:video:width" content="1280"><meta property="og:video:height" content="720"><meta property="og:image" content="https://cdn.example-sports.com/i.jpg"></head></html>', { 'content-type': 'text/html' }));
  route('https://cdn.example-sports.com/v/catch.mp4', () => res(200, '', { 'content-type': 'video/mp4', 'content-length': '4000000', 'access-control-allow-origin': '*' }));
  const r = await resolve('https://news.example.org/story');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.variants[0].url, 'https://cdn.example-sports.com/v/catch.mp4');
  assert.equal(r.quality, '720p');
  assert.equal(r.text, 'Big catch');
  reset();
  route('https://news.example.org/plain', () => res(200, '<html><body>No video</body></html>', { 'content-type': 'text/html' }));
  const none = await resolve('https://news.example.org/plain');
  assert.equal(none.reason, 'not-video');
  assert.match(none.error, /drop it here/);
  // og:video pointing at a private host: refused by the same guard.
  reset();
  route('https://news.example.org/trap', () => res(200, '<meta property="og:video" content="https://evil.example.net/x.mp4">', { 'content-type': 'text/html' }));
  assert.equal((await resolve('https://news.example.org/trap')).reason, 'private');
});

await test('below 720p is flagged for the badge', async () => {
  reset();
  const r = await LINK.resolveLink('https://x.com/a/status/1', { clipFromPost: async url => ({ ok: true, url, variants: [{ url: 'https://video.twimg.com/a/vid/avc1/640x360/a.mp4', width: 640, height: 360 }] }) });
  assert.equal(r.quality, '360p');
  assert.equal(r.belowFloor, true);
});

console.log(`Video Ads link tests passed (${passed}).`);
