/* Video Ads "Video link": what a pasted link is, shared by the page and the
   server (netlify/functions/_clip-link.js). Pure, no network.

   detect(url)        -> { platform, label, kind, url, host } | null
                         kind: 'post'   a post / page the server resolves to MP4s
                               'file'   a direct video file (.mp4 .mov .webm .m4v)
                               'stream' an HLS / DASH playlist (.m3u8 .mpd)
                               'share'  a Google Drive / Dropbox share link
                               'blocked' a host that does not allow downloads
                               'page'   any other web page (looked at for og:video)
   driveDirect(url)   -> the direct-download URL of a Drive share link, or ''
   dropboxDirect(url) -> the direct-download URL of a Dropbox share link, or ''
   qualityLabel(w, h) -> '1080p' etc. from the short side ('' when unknown)
   BLOCKED[platform]  -> { title, text } for hosts we never download from
   HELP               -> the helper line under the field
   fmtBytes(n)        -> '24 MB' */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VideoAdsLinks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [platform, label, host pattern, kind]
  const PLATFORMS = [
    ['x', 'X', /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/, 'post'],
    ['youtube', 'YouTube', /^(?:(?:www|m|music)\.)?youtube(?:-nocookie)?\.com$|^youtu\.be$/, 'blocked'],
    ['bluesky', 'Bluesky', /^(?:www\.)?bsky\.app$/, 'post'],
    ['reddit', 'Reddit', /^(?:(?:www|old|new|np|m|sh)\.)?reddit\.com$|^redd\.it$|^v\.redd\.it$/, 'post'],
    ['streamable', 'Streamable', /^(?:www\.)?streamable\.com$/, 'post'],
    ['vimeo', 'Vimeo', /^(?:(?:www|player)\.)?vimeo\.com$/, 'post'],
    ['drive', 'Google Drive', /^drive\.google\.com$|^docs\.google\.com$|^drive\.usercontent\.google\.com$/, 'share'],
    ['dropbox', 'Dropbox', /^(?:www\.)?dropbox\.com$|^dl\.dropbox(?:usercontent)?\.com$/, 'share'],
    ['instagram', 'Instagram', /(?:^|\.)instagram\.com$|^instagr\.am$/, 'blocked'],
    ['threads', 'Threads', /(?:^|\.)threads\.(?:net|com)$/, 'blocked'],
    ['facebook', 'Facebook', /(?:^|\.)facebook\.com$|^fb\.watch$|^fb\.com$/, 'blocked'],
    ['tiktok', 'TikTok', /(?:^|\.)tiktok\.com$/, 'blocked'],
  ];
  const FILE_EXT = /\.(?:mp4|m4v|mov|webm)$/i;
  const STREAM_EXT = /\.(?:m3u8|mpd)$/i;

  function parse(raw) {
    let text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    // "x.com/…" pasted without a scheme.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^[\w-]+(?:\.[\w-]+)+(?:[/:?#]|$)/.test(text)) text = `https://${text}`;
    try { return new URL(text); } catch (e) { return null; }
  }

  function detect(raw) {
    const u = parse(raw);
    if (!u || !/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    const hit = PLATFORMS.find(p => p[2].test(host));
    if (hit) return { platform: hit[0], label: hit[1], kind: hit[3], url: u.toString(), host };
    const file = u.pathname.split('/').pop() || '';
    if (STREAM_EXT.test(file)) return { platform: 'stream', label: 'Stream', kind: 'stream', url: u.toString(), host };
    if (FILE_EXT.test(file)) return { platform: 'direct', label: 'Video file', kind: 'file', url: u.toString(), host };
    return { platform: 'web', label: 'Web page', kind: 'page', url: u.toString(), host };
  }

  // drive.google.com/file/d/<id>/view, /open?id=<id>, /uc?id=<id>
  function driveId(raw) {
    const u = parse(raw);
    if (!u) return '';
    const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
    const id = m ? m[1] : (u.searchParams.get('id') || '');
    return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : '';
  }
  function driveDirect(raw) {
    const id = driveId(raw);
    if (!id) return '';
    const out = new URL('https://drive.usercontent.google.com/download');
    out.searchParams.set('id', id);
    out.searchParams.set('export', 'download');
    const key = parse(raw)?.searchParams.get('resourcekey');
    if (key) out.searchParams.set('resourcekey', key);
    return out.toString();
  }

  // www.dropbox.com/s/<id>/<name>?dl=0, /scl/fi/<id>/<name>?rlkey=…&dl=0
  // -> dl.dropboxusercontent.com/<same path>?rlkey=… (the file itself).
  function dropboxDirect(raw) {
    const u = parse(raw);
    if (!u || !/(?:^|\.)dropbox(?:usercontent)?\.com$/i.test(u.hostname)) return '';
    if (!/^\/(?:s|scl\/fi|sh)\//.test(u.pathname) && u.hostname !== 'dl.dropboxusercontent.com') return '';
    if (/^\/sh\//.test(u.pathname)) return ''; // folders
    const out = new URL(`https://dl.dropboxusercontent.com${u.pathname}`);
    const rlkey = u.searchParams.get('rlkey');
    if (rlkey) out.searchParams.set('rlkey', rlkey);
    return out.toString();
  }

  function qualityLabel(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const side = w && h ? Math.min(w, h) : 0;
    if (!side) return '';
    if (side >= 2160) return '4K';
    if (side >= 1440) return '1440p';
    if (side >= 1080) return '1080p';
    if (side >= 720) return '720p';
    return `${side}p`;
  }

  function fmtBytes(n) {
    const b = Number(n) || 0;
    if (!b) return '';
    if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
    if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
    return `${Math.max(1, Math.round(b / 1e3))} KB`;
  }

  const SAVE = 'If you may use it, save the video and drop the file here.';
  const BLOCKED = {
    youtube: { title: 'YouTube doesn’t allow downloads', text: `YouTube’s terms don’t allow downloading its videos, so FrameUp won’t fetch them. ${SAVE}` },
    instagram: { title: 'Instagram doesn’t share video files', text: `Instagram only plays videos inside its own app and needs a sign-in for the file. ${SAVE}` },
    threads: { title: 'Threads doesn’t share video files', text: `Threads only plays videos inside its own app. ${SAVE}` },
    facebook: { title: 'Facebook doesn’t share video files', text: `Facebook only plays videos inside its own app. ${SAVE}` },
    tiktok: { title: 'TikTok doesn’t share video files', text: `TikTok only plays videos inside its own app and blocks other sites from the file. ${SAVE}` },
  };
  const HELP = 'Works with X, Bluesky, Reddit, Streamable, Vimeo, Google Drive and Dropbox links, and direct .mp4, .mov or .webm files. YouTube, Instagram and TikTok can’t be downloaded.';

  return { PLATFORMS, detect, parse, driveId, driveDirect, dropboxDirect, qualityLabel, fmtBytes, BLOCKED, HELP, FILE_EXT, STREAM_EXT };
}));
