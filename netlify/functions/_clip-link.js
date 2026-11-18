'use strict';
// Video Ads "Video link": any pasted link -> the direct video file(s) the
// browser downloads itself. The server only reads small JSON / HTML and
// HEAD responses; it never carries video bytes (Vercel caps replies at 4.5 MB).
//
//   X / Twitter   fxtwitter, then X's syndication feed (video-ads.js clipFromPost)
//   Bluesky       public AppView getPosts -> the original upload on the
//                 author's PDS (getBlob, CORS *)
//   Reddit        the post's JSON -> v.redd.it CMAF MP4s (video only: Reddit
//                 keeps sound in a separate file), or the X / Streamable link
//                 the post points at
//   Streamable    api.streamable.com (public) -> signed CDN MP4
//   Vimeo         player config "progressive" MP4s when the owner allows them;
//                 stream-only videos get the honest fallback
//   Google Drive  share link -> drive.usercontent.google.com direct download
//   Dropbox       share link -> dl.dropboxusercontent.com
//   Direct files  .mp4 .mov .m4v .webm (HEAD-checked)
//   Other pages   og:video / twitter:player:stream / <video src> MP4s
//   YouTube, Instagram, Threads, Facebook, TikTok: never downloaded (terms /
//                 no public file); the page says so and offers upload.
//   .m3u8 / .mpd playlists: not a single file; the page offers upload.
//
// Every URL the server fetches is checked first (https only, no credentials,
// port 443, no private / loopback / link-local / metadata addresses, after
// DNS), redirects are followed by hand and re-checked, and every call has a
// timeout. -> resolveLink(raw, { clipFromPost, env })
// Known API hosts (fxtwitter, Bluesky AppView, Reddit, Streamable, Vimeo
// player) are fixed addresses in code, not user input.
//   ok:   { ok, platform, platformLabel, url, openUrl, variants: [{ url, width,
//           height, bitrate, quality, bytes?, hasAudio? }], quality, handle,
//           author, text, thumbnail, durationMs, postedAt, bytes, hasAudio,
//           audioNote, cors: 'open' | 'blocked' | 'unknown', belowFloor }
//   fail: { ok: false, status, reason, platform, platformLabel, error, title?, openUrl? }
//         reason: bad-url | not-https | private | youtube | blocked | stream |
//                 not-video | no-video | private-file | too-large | unreachable

const dns = require('node:dns').promises;
const net = require('node:net');
const LINKS = require('../../video-ads-links.js');
const PUB = require('./_clip-source-public.js');

const UA = 'FrameUp/1.0 (+https://frameup.essentiallysports.com)';
const ORIGIN = 'https://frameup.essentiallysports.com';
const TIMEOUT_MS = 6000;
const MAX_HOPS = 4;
const MAX_BYTES = 500 * 1024 * 1024; // the browser holds the whole file in memory
const MAX_HTML = 600 * 1024;
const MIN_SHORT_SIDE = 720;

// Tests swap these (no network).
const deps = {
  lookup: host => dns.lookup(host, { all: true, verbatim: true }),
};

// ── SSRF guard ─────────────────────────────────────────────────────────────
function v4Private(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}
function isPrivateIp(raw) {
  const ip = String(raw || '').replace(/^\[|\]$/g, '').toLowerCase();
  const kind = net.isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  if (ip === '::' || ip === '::1') return true;
  const mapped = ip.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/) || ip.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Private(mapped[1]);
  const hex = ip.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) + parseInt(hex[2], 16);
    return v4Private([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link-local
    || (first & 0xff00) === 0xff00 // multicast
    || ip.startsWith('2001:db8:') || ip.startsWith('2001:0db8:');
}
const BAD_HOST = /^(?:localhost|metadata(?:\.google\.internal)?|instance-data)$|\.(?:localhost|local|internal|lan|home|arpa|test|invalid|example)$/i;

// -> { ok, url } | { ok: false, reason, error }
async function checkUrl(raw, { resolve = true } = {}) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return { ok: false, reason: 'bad-url', error: 'That doesn’t look like a link. Paste the full address, starting with https://' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not-https', error: 'Use a secure link (https://).' };
  if (u.username || u.password) return { ok: false, reason: 'bad-url', error: 'Links with a username or password can’t be used.' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'private', error: 'That link points at a server FrameUp can’t reach.' };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host.includes('.') && !net.isIP(host)) return { ok: false, reason: 'private', error: 'That link points at a server FrameUp can’t reach.' };
  if (BAD_HOST.test(host)) return { ok: false, reason: 'private', error: 'That link points at a server FrameUp can’t reach.' };
  if (net.isIP(host)) {
    return isPrivateIp(host) ? { ok: false, reason: 'private', error: 'That link points at a private address.' } : { ok: true, url: u.toString() };
  }
  if (!resolve) return { ok: true, url: u.toString() };
  let addrs;
  try { addrs = await deps.lookup(host); } catch (e) { return { ok: false, reason: 'unreachable', error: 'That site couldn’t be found. Check the link.' }; }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map(a => (typeof a === 'string' ? a : a?.address)).filter(Boolean);
  if (!list.length || list.some(isPrivateIp)) return { ok: false, reason: 'private', error: 'That link points at a private address.' };
  return { ok: true, url: u.toString() };
}

// fetch with every redirect re-checked. -> { response, url } | { error: check }
async function safeFetch(raw, { method = 'GET', headers = {}, timeoutMs = TIMEOUT_MS } = {}) {
  let url = raw;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const check = await checkUrl(url);
    if (!check.ok) return { error: check };
    let response;
    try {
      response = await fetch(check.url, { method, redirect: 'manual', headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { error: { ok: false, reason: 'unreachable', error: 'That site didn’t answer. Try again, or save the video and drop it here.' } };
    }
    const location = response.status >= 300 && response.status < 400 ? response.headers?.get?.('location') : null;
    if (!location) return { response, url: check.url };
    try { await response.body?.cancel?.(); } catch (e) { /* nothing to cancel */ }
    try { url = new URL(location, check.url).toString(); } catch (e) { return { error: { ok: false, reason: 'unreachable', error: 'That link redirects somewhere invalid.' } }; }
  }
  return { error: { ok: false, reason: 'unreachable', error: 'That link redirects too many times.' } };
}

const header = (response, name) => String(response?.headers?.get?.(name) || '');
const corsOf = response => {
  const acao = header(response, 'access-control-allow-origin').trim();
  if (acao === '*' || acao === ORIGIN) return 'open';
  return acao ? 'blocked' : 'unknown';
};
const looksVideo = type => /^video\//i.test(type) || /octet-stream|binary\/|application\/mp4/i.test(type);
const looksStream = type => /mpegurl|dash\+xml/i.test(type);

// HEAD (or a 1-byte range GET when HEAD is refused) a candidate file.
// Never reads the body. -> { ok, status, type, bytes, cors, url } | { error }
async function probeMedia(url) {
  const ask = async (method, extra = {}) => {
    const r = await safeFetch(url, { method, headers: { Origin: ORIGIN, Accept: 'video/*,*/*;q=0.5', ...extra } });
    if (r.response) { try { await r.response.body?.cancel?.(); } catch (e) { /* nothing to cancel */ } }
    return r;
  };
  let r = await ask('HEAD');
  if (r.error) return r;
  if ([400, 403, 405, 501].includes(r.response.status)) {
    const g = await ask('GET', { Range: 'bytes=0-0' });
    if (!g.error) r = g;
  }
  const { response } = r;
  const type = header(response, 'content-type').split(';')[0].trim().toLowerCase();
  const range = header(response, 'content-range').match(/\/(\d+)$/);
  const bytes = range ? Number(range[1]) : (response.status === 200 ? Number(header(response, 'content-length')) || 0 : 0);
  return { ok: response.status === 200 || response.status === 206, status: response.status, type, bytes, cors: corsOf(response), url: r.url };
}

// ── Shapes ─────────────────────────────────────────────────────────────────
const fail = (status, reason, error, extra = {}) => ({ ok: false, status, reason, error, ...extra });
const variant = v => {
  const width = Number(v.width) || 0;
  const height = Number(v.height) || 0;
  return {
    url: v.url,
    width,
    height,
    bitrate: Number(v.bitrate) || 0,
    quality: LINKS.qualityLabel(width, height),
    ...(Number(v.bytes) > 0 ? { bytes: Number(v.bytes) } : {}),
    ...(typeof v.hasAudio === 'boolean' ? { hasAudio: v.hasAudio } : {}),
  };
};
const area = v => (Number(v.width) || 0) * (Number(v.height) || 0);
function done(info, base) {
  const variants = (info.variants || []).filter(v => v && /^https:\/\//.test(v.url)).map(variant)
    .filter((v, i, all) => all.findIndex(o => o.url === v.url) === i)
    .sort((a, b) => area(b) - area(a) || b.bitrate - a.bitrate);
  if (!variants.length) return fail(404, 'no-video', 'We couldn’t find a video in that link. Save the video and drop it here.', base);
  const best = variants[0];
  const side = best.width && best.height ? Math.min(best.width, best.height) : 0;
  const bytes = Number(info.bytes) || best.bytes || 0;
  if (bytes > MAX_BYTES) return fail(413, 'too-large', `That file is ${LINKS.fmtBytes(bytes)}, too big to edit in the browser. Trim it first, then drop it here.`, base);
  return {
    ok: true,
    ...base,
    url: info.url || base.openUrl,
    variants,
    quality: best.quality,
    belowFloor: Boolean(side && side < MIN_SHORT_SIDE),
    handle: info.handle || '',
    author: info.author || '',
    text: String(info.text || '').slice(0, 280),
    thumbnail: /^https:\/\//.test(String(info.thumbnail || '')) ? info.thumbnail : '',
    durationMs: Number(info.durationMs) || 0,
    postedAt: info.postedAt || '',
    bytes,
    ...(typeof info.hasAudio === 'boolean' ? { hasAudio: info.hasAudio } : {}),
    ...(info.audioNote ? { audioNote: info.audioNote } : {}),
    cors: info.cors || 'unknown',
  };
}

// ── Resolvers ──────────────────────────────────────────────────────────────
async function fromX(found, base, { clipFromPost }) {
  const r = await clipFromPost(found.url);
  if (!r.ok) return fail(r.status || 404, r.status === 400 ? 'bad-url' : (r.reason || 'no-video'), r.error, base);
  return done({ ...r, cors: 'open' }, { ...base, openUrl: r.url });
}

async function fromBluesky(found, base, opts) {
  const m = new URL(found.url).pathname.match(/^\/profile\/([^/]+)\/post\/([a-z0-9]+)/i);
  if (!m) return fail(400, 'bad-url', 'Paste the link to one Bluesky post (…/profile/…/post/…).', base);
  // getPosts needs the author's DID in the at:// URI (a handle 500s).
  let actor = decodeURIComponent(m[1]);
  if (!/^did:/.test(actor)) {
    const who = await PUB.links.request(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?${new URLSearchParams({ handle: actor })}`, {});
    if (!who.ok || !/^did:[a-z]+:[A-Za-z0-9._:%-]+$/.test(String(who.json?.did || ''))) return fail(404, 'no-video', 'That Bluesky account wasn’t found. Check the link.', base);
    actor = who.json.did;
  }
  const uri = `at://${actor}/app.bsky.feed.post/${m[2]}`;
  const res = await PUB.links.request(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${new URLSearchParams({ uris: uri })}`, {});
  if (!res.ok) return fail(502, 'unreachable', 'Bluesky didn’t answer. Try again in a moment.', base);
  const post = res.json?.posts?.[0];
  if (!post) return fail(404, 'no-video', 'That Bluesky post wasn’t found. It may be deleted or private.', base);
  const parsed = PUB.links.parseBlueskyPost(post) || {};
  if (!parsed.media) {
    if (parsed.xs?.length) return fromX({ url: parsed.xs[0].url }, { ...base, platform: 'x', platformLabel: 'X' }, opts);
    return fail(404, 'no-video', 'That Bluesky post has no video.', base);
  }
  const pds = await PUB.links.pdsFor(parsed.media.did, {});
  if (!pds) return fail(502, 'unreachable', 'We couldn’t find where that Bluesky video is stored. Try again.', base);
  const mediaUrl = `${pds}/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: parsed.media.did, cid: parsed.media.cid })}`;
  // A self-hosted PDS can live anywhere: the same SSRF rules as any link.
  const check = await checkUrl(mediaUrl, { resolve: !PUB.links.PDS_ALLOWED.test(pds) });
  if (!check.ok) return fail(422, 'private', check.error, base);
  const handle = parsed.media.handle || post.author?.handle || '';
  return done({
    url: parsed.media.url,
    handle,
    author: post.author?.displayName || '',
    text: parsed.media.text,
    thumbnail: parsed.media.thumb,
    postedAt: parsed.media.postedAt,
    bytes: parsed.media.bytes,
    variants: [{ url: mediaUrl, width: parsed.media.width, height: parsed.media.height, bytes: parsed.media.bytes }],
    cors: PUB.links.PDS_ALLOWED.test(pds) ? 'open' : 'unknown',
  }, base);
}

// v.redd.it/<id> redirects to its post; reddit.com/…/comments/<id>/…; redd.it/<id>.
async function redditIdOf(found) {
  const u = new URL(found.url);
  const host = u.hostname.toLowerCase();
  const comments = u.pathname.match(/\/comments\/([a-z0-9]{4,10})/i);
  if (comments) return comments[1];
  if (host === 'redd.it') return (u.pathname.match(/^\/([a-z0-9]{4,10})\/?$/i) || [])[1] || '';
  if (host === 'v.redd.it' || /\/s\/[a-z0-9]+/i.test(u.pathname)) {
    // Follow the first redirect only (to the post), never the video.
    const check = await checkUrl(found.url);
    if (!check.ok) return '';
    try {
      const r = await fetch(check.url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const loc = header(r, 'location');
      return (loc.match(/\/comments\/([a-z0-9]{4,10})/i) || [])[1] || '';
    } catch (e) { return ''; }
  }
  return '';
}
async function fromReddit(found, base, opts) {
  const id = await redditIdOf(found);
  if (!id) return fail(400, 'bad-url', 'Paste the link to one Reddit post (…/comments/…).', base);
  const { post, status } = await PUB.links.redditPost(id, opts.env);
  if (!post) {
    return fail(status === 404 ? 404 : 502, status === 404 ? 'no-video' : 'unreachable',
      status === 404 ? 'That Reddit post wasn’t found.' : 'Reddit didn’t let us read that post right now. Open it, save the video, and drop it here.',
      { ...base, openUrl: found.url });
  }
  const parsed = PUB.links.parseRedditPost(post);
  if (!parsed) return fail(404, 'no-video', 'That Reddit post has no video we can use.', base);
  if (parsed.kind === 'x') return fromX({ url: parsed.candidate.url }, { ...base, platform: 'x', platformLabel: 'X' }, opts);
  if (parsed.kind === 'streamable') return fromStreamable({ url: `https://streamable.com/${parsed.id}` }, { ...base, platform: 'streamable', platformLabel: 'Streamable' });
  const c = parsed.candidate;
  // CMAF_<height>.mp4: offer the lower renditions too (same post, same host).
  const own = String(c.mediaUrl).match(/^(https:\/\/v\.redd\.it\/[a-z0-9]+\/(?:CMAF|DASH)_)(\d+)\.mp4$/i);
  const heights = own ? [1080, 720, 480].filter(h => h < Number(own[2])) : [];
  const ratio = c.width && c.height ? c.width / c.height : 16 / 9;
  const scaled = h => (ratio >= 1 ? { width: Math.round(h * ratio), height: h } : { width: h, height: Math.round(h / ratio) });
  return done({
    url: c.url,
    handle: c.handle,
    text: c.text,
    thumbnail: c.thumb,
    postedAt: c.postedAt,
    durationMs: c.durationMs,
    hasAudio: false,
    audioNote: c.audioUrl ? 'Reddit keeps the sound in a separate file, so this clip comes in without sound. Add music in Export, or save the post with its sound and drop it here.' : '',
    variants: [{ url: c.mediaUrl, width: c.width, height: c.height, hasAudio: false }, ...heights.map(h => ({ url: `${own[1]}${h}.mp4`, ...scaled(h), hasAudio: false }))],
    cors: 'open',
  }, { ...base, openUrl: c.url });
}

async function fromStreamable(found, base) {
  const id = PUB.links.streamableId(found.url);
  if (!id) return fail(400, 'bad-url', 'Paste the link to one Streamable video.', base);
  const media = await PUB.links.resolveStreamable(id, {});
  if (!media) return fail(404, 'no-video', 'That Streamable video isn’t available (it may still be processing, or it was removed).', base);
  return done({
    url: `https://streamable.com/${id}`,
    text: media.title,
    thumbnail: media.thumb,
    durationMs: media.durationMs,
    bytes: media.bytes,
    ...(typeof media.hasAudio === 'boolean' ? { hasAudio: media.hasAudio } : {}),
    variants: [{ url: media.mediaUrl, width: media.width, height: media.height, bytes: media.bytes }],
    cors: 'open',
  }, { ...base, openUrl: `https://streamable.com/${id}` });
}

async function fromVimeo(found, base) {
  const u = new URL(found.url);
  const m = u.pathname.match(/(?:^|\/)(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?/i);
  if (!m) return fail(400, 'bad-url', 'Paste the link to one Vimeo video.', base);
  const hash = m[2] || u.searchParams.get('h') || '';
  const res = await PUB.links.request(`https://player.vimeo.com/video/${m[1]}/config${hash ? `?h=${encodeURIComponent(hash)}` : ''}`, {});
  if (!res.ok) {
    return fail(res.status === 403 || res.status === 404 ? 404 : 502, res.status === 403 ? 'private-file' : 'unreachable',
      res.status === 403 ? 'That Vimeo video is private or can only play on its own site.' : 'Vimeo didn’t answer. Try again in a moment.', base);
  }
  const d = res.json || {};
  const progressive = (d.request?.files?.progressive || []).filter(p => /^https:\/\//.test(String(p?.url || '')));
  if (!progressive.length) {
    return fail(422, 'stream', 'This Vimeo video is only streamed, with no single file to download. If the owner allows downloads, use Vimeo’s Download button and drop the file here.',
      { ...base, title: 'Vimeo only streams this video' });
  }
  return done({
    url: `https://vimeo.com/${m[1]}`,
    author: d.video?.owner?.name || '',
    text: d.video?.title || '',
    thumbnail: d.video?.thumbs?.base || d.video?.thumbs?.['640'] || '',
    durationMs: Math.round((Number(d.video?.duration) || 0) * 1000),
    variants: progressive.map(p => ({ url: p.url, width: p.width, height: p.height })),
    cors: 'unknown',
  }, base);
}

// A single file at a URL we were given or built (Drive / Dropbox / direct).
async function fromFile(fileUrl, base, { share = '' } = {}) {
  const probe = await probeMedia(fileUrl);
  if (probe.error) return fail(probe.error.reason === 'unreachable' ? 502 : 422, probe.error.reason, probe.error.error, base);
  if (!probe.ok) {
    if ([401, 403, 404].includes(probe.status)) {
      const msg = share ? `That ${share} file isn’t shared publicly. Set it to “Anyone with the link”, or download it and drop it here.` : 'That file isn’t available (it may be private or removed).';
      return fail(404, share ? 'private-file' : 'no-video', msg, base);
    }
    return fail(502, 'unreachable', 'That site didn’t send the file. Open it, save the video, and drop it here.', base);
  }
  if (looksStream(probe.type)) return fail(422, 'stream', streamText, { ...base, title: 'That’s a stream, not a file' });
  if (!looksVideo(probe.type)) {
    // Drive answers big files with an HTML "can’t scan for viruses" page.
    const msg = share === 'Google Drive'
      ? 'Google Drive shows a warning page instead of this file (large files, or not shared publicly). Open it, download it, and drop it here.'
      : share ? `That ${share} link opens a page, not the file. Open it, download the video, and drop it here.` : 'That link isn’t a video file.';
    return fail(422, share ? 'private-file' : 'not-video', msg, base);
  }
  return done({ url: base.openUrl, bytes: probe.bytes, variants: [{ url: probe.url, bytes: probe.bytes }], cors: probe.cors }, base);
}
const streamText = 'That’s a streaming playlist (.m3u8 / .mpd) made of many small pieces, not one video file, so FrameUp can’t record it. Open the video, save it as an MP4, and drop it here.';

// Any other page: its og:video / twitter:player:stream / <video> MP4.
function videoFromHtml(html, pageUrl) {
  const metas = [];
  const re = /<meta\s[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = (tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (key && val) metas.push([key.toLowerCase(), val.replace(/&amp;/g, '&')]);
  }
  const get = k => metas.filter(([key]) => key === k).map(([, v]) => v);
  const width = Number(get('og:video:width')[0]) || 0;
  const height = Number(get('og:video:height')[0]) || 0;
  const tagSrc = [...html.matchAll(/<(?:video|source)\s[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(x => x[1].replace(/&amp;/g, '&'));
  const urls = [...get('og:video:secure_url'), ...get('og:video:url'), ...get('og:video'), ...get('twitter:player:stream'), ...tagSrc];
  for (const raw of urls) {
    let abs;
    try { abs = new URL(raw, pageUrl).toString(); } catch (e) { continue; }
    if (!/^https:\/\//.test(abs)) continue;
    const found = LINKS.detect(abs);
    if (found?.kind === 'file') return { url: abs, width, height, thumbnail: get('og:image')[0] || '', title: get('og:title')[0] || '' };
  }
  return null;
}
async function fromPage(found, base) {
  const r = await safeFetch(found.url, { headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' } });
  if (r.error) return fail(r.error.reason === 'unreachable' ? 502 : 422, r.error.reason, r.error.error, base);
  const type = header(r.response, 'content-type').toLowerCase();
  if (looksVideo(type)) {
    try { await r.response.body?.cancel?.(); } catch (e) { /* nothing to cancel */ }
    return fromFile(r.url, { ...base, platform: 'direct', platformLabel: 'Video file' });
  }
  if (looksStream(type)) {
    try { await r.response.body?.cancel?.(); } catch (e) { /* nothing to cancel */ }
    return fail(422, 'stream', streamText, { ...base, title: 'That’s a stream, not a file' });
  }
  if (!r.response.ok || !/html/.test(type)) {
    try { await r.response.body?.cancel?.(); } catch (e) { /* nothing to cancel */ }
    return fail(r.response.ok ? 422 : 502, r.response.ok ? 'not-video' : 'unreachable', 'We couldn’t find a video on that page. Open it, save the video, and drop it here.', base);
  }
  const html = await readCapped(r.response, MAX_HTML);
  const hit = videoFromHtml(html, r.url);
  if (!hit) return fail(422, 'not-video', 'We couldn’t find a video file on that page. Open it, save the video, and drop it here.', base);
  const file = await fromFile(hit.url, base);
  if (!file.ok) return file;
  const v = file.variants[0];
  if (!v.width && hit.width) { v.width = hit.width; v.height = hit.height; v.quality = LINKS.qualityLabel(hit.width, hit.height); file.quality = v.quality; }
  return { ...file, text: hit.title.slice(0, 280), thumbnail: /^https:\/\//.test(hit.thumbnail) ? hit.thumbnail : '' };
}
async function readCapped(response, max) {
  if (!response.body?.getReader) return String(await response.text?.() || '').slice(0, max);
  const reader = response.body.getReader();
  const parts = [];
  let got = 0;
  while (got < max) {
    const { done: end, value } = await reader.read();
    if (end) break;
    parts.push(Buffer.from(value));
    got += value.length;
  }
  try { await reader.cancel(); } catch (e) { /* done */ }
  return Buffer.concat(parts).toString('utf8').slice(0, max);
}

// ── Entry ──────────────────────────────────────────────────────────────────
async function resolveLink(raw, { clipFromPost, env = process.env } = {}) {
  const text = String(raw || '').trim().slice(0, 2000);
  if (!text) return fail(400, 'bad-url', 'Paste a link to a video first.');
  const found = LINKS.detect(text);
  if (!found) return fail(400, 'bad-url', 'That doesn’t look like a link. Paste the full address, starting with https://');
  const base = { platform: found.platform, platformLabel: found.label, openUrl: found.url };
  if (found.kind === 'blocked') {
    const msg = LINKS.BLOCKED[found.platform];
    return fail(422, found.platform === 'youtube' ? 'youtube' : 'blocked', msg.text, { ...base, title: msg.title });
  }
  if (!/^https:/.test(found.url)) return fail(400, 'not-https', 'Use a secure link (https://).', base);
  // Shape only here; every URL the server actually fetches is DNS-checked
  // (safeFetch / checkUrl) right before the request.
  const check = await checkUrl(found.url, { resolve: false });
  if (!check.ok) return fail(400, check.reason, check.error, base);
  try {
    switch (found.platform) {
      case 'x': return await fromX(found, base, { clipFromPost });
      case 'bluesky': return await fromBluesky(found, base, { clipFromPost });
      case 'reddit': return await fromReddit(found, base, { clipFromPost, env });
      case 'streamable': return await fromStreamable(found, base);
      case 'vimeo': return await fromVimeo(found, base);
      case 'drive': {
        const direct = LINKS.driveDirect(found.url);
        if (!direct) return fail(400, 'bad-url', 'Paste the share link of one Google Drive file (…/file/d/…).', base);
        return await fromFile(direct, { ...base, directUrl: direct }, { share: 'Google Drive' });
      }
      case 'dropbox': {
        const direct = LINKS.dropboxDirect(found.url);
        if (!direct) return fail(400, 'bad-url', 'Paste the share link of one Dropbox file (not a folder).', base);
        return await fromFile(direct, { ...base, directUrl: direct }, { share: 'Dropbox' });
      }
      case 'stream': return fail(422, 'stream', streamText, { ...base, title: 'That’s a stream, not a file' });
      case 'direct': return await fromFile(found.url, base);
      default: return await fromPage(found, base);
    }
  } catch (error) {
    return fail(502, 'unreachable', 'Something went wrong reading that link. Try again, or save the video and drop it here.', base);
  }
}

module.exports = { resolveLink, checkUrl, isPrivateIp, safeFetch, probeMedia, videoFromHtml, deps, MAX_BYTES };
