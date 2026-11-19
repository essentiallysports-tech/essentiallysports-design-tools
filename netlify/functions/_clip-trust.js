'use strict';
// Video Ads: the ONE trusted-source allowlist for clips (owner, 2026-11-19:
// "All videos should be from trusted sites like team websites, Twitter (X),
// Google Videos, team accounts, league websites").
//
// Every clip path asks this module: live search (X API, web search, Grok),
// the official-site source (ESPN / MLB.com), the public discovery sources,
// the shared clip library (rows are re-checked on every read, so clips saved
// before this rule are hidden too), By moment, and the daily prefetch. A clip
// that is not on the list is dropped from search, moments and the library.
//
// Pasted links (the "Video link" tab) are the user's own choice: they still
// work from any host, but the reply says "Unverified source" when the link
// is not on the list.
//
// Trusted:
//   X posts by an account in video-ads-sources.js: every team's official
//     account, league / conference accounts, recognised networks (ESPN, FOX,
//     CBS, NBC, NFL / MLB / college networks). Any sport's list counts here
//     (the sport decides ranking, not trust).
//   Websites (and their video CDNs) in SITES below: league sites, network
//     sites and team / athletics sites.
//   Google redirect links (google.com/url?…) are judged by where they lead,
//     so a Google Videos result counts when it resolves to a trusted site.
// Not trusted: every other X account (fans, aggregators), Reddit, Bluesky,
// Streamable, Vimeo, Drive / Dropbox and unknown hosts.
const SOURCES = require('../../video-ads-sources.js');

// domain -> [name, kind]. kind: 'league' (league / conference sites),
// 'media' (networks), 'official' (a team's own site). A host matches its
// domain or any subdomain (www.mlb.com, mlb-cuts-diamond.mlb.com).
const SITES = {
  // Leagues, conferences and their video CDNs
  'mlb.com': ['MLB.com', 'league'],
  'nfl.com': ['NFL.com', 'league'],
  'ncaa.com': ['NCAA.com', 'league'],
  'collegefootballplayoff.com': ['College Football Playoff', 'league'],
  'secsports.com': ['SEC', 'league'],
  'bigten.org': ['Big Ten', 'league'],
  'theacc.com': ['ACC', 'league'],
  'big12sports.com': ['Big 12', 'league'],
  // Networks (ESPN's MP4s are served from espnmedia-cdn.akamaized.net)
  'espn.com': ['ESPN', 'media'],
  'espnmedia-cdn.akamaized.net': ['ESPN', 'media'],
  'foxsports.com': ['FOX Sports', 'media'],
  'cbssports.com': ['CBS Sports', 'media'],
  'nbcsports.com': ['NBC Sports', 'media'],
  'nbc.com': ['NBC', 'media'],
  'secnetwork.com': ['SEC Network', 'media'],
  'btn.com': ['Big Ten Network', 'media'],
  // NFL team sites (MLB team sites live under mlb.com/<team>)
  'azcardinals.com': ['Arizona Cardinals', 'official'], 'atlantafalcons.com': ['Atlanta Falcons', 'official'],
  'baltimoreravens.com': ['Baltimore Ravens', 'official'], 'buffalobills.com': ['Buffalo Bills', 'official'],
  'panthers.com': ['Carolina Panthers', 'official'], 'chicagobears.com': ['Chicago Bears', 'official'],
  'bengals.com': ['Cincinnati Bengals', 'official'], 'clevelandbrowns.com': ['Cleveland Browns', 'official'],
  'dallascowboys.com': ['Dallas Cowboys', 'official'], 'denverbroncos.com': ['Denver Broncos', 'official'],
  'detroitlions.com': ['Detroit Lions', 'official'], 'packers.com': ['Green Bay Packers', 'official'],
  'houstontexans.com': ['Houston Texans', 'official'], 'colts.com': ['Indianapolis Colts', 'official'],
  'jaguars.com': ['Jacksonville Jaguars', 'official'], 'chiefs.com': ['Kansas City Chiefs', 'official'],
  'raiders.com': ['Las Vegas Raiders', 'official'], 'chargers.com': ['Los Angeles Chargers', 'official'],
  'therams.com': ['Los Angeles Rams', 'official'], 'miamidolphins.com': ['Miami Dolphins', 'official'],
  'vikings.com': ['Minnesota Vikings', 'official'], 'patriots.com': ['New England Patriots', 'official'],
  'neworleanssaints.com': ['New Orleans Saints', 'official'], 'giants.com': ['New York Giants', 'official'],
  'newyorkjets.com': ['New York Jets', 'official'], 'philadelphiaeagles.com': ['Philadelphia Eagles', 'official'],
  'steelers.com': ['Pittsburgh Steelers', 'official'], '49ers.com': ['San Francisco 49ers', 'official'],
  'seahawks.com': ['Seattle Seahawks', 'official'], 'buccaneers.com': ['Tampa Bay Buccaneers', 'official'],
  'tennesseetitans.com': ['Tennessee Titans', 'official'], 'commanders.com': ['Washington Commanders', 'official'],
  // College athletics sites (the football programs in video-ads-teams.js)
  'rolltide.com': ['Alabama Athletics', 'official'], 'arkansasrazorbacks.com': ['Arkansas Athletics', 'official'],
  'auburntigers.com': ['Auburn Athletics', 'official'], 'floridagators.com': ['Florida Athletics', 'official'],
  'georgiadogs.com': ['Georgia Athletics', 'official'], 'ukathletics.com': ['Kentucky Athletics', 'official'],
  'lsusports.net': ['LSU Athletics', 'official'], 'olemisssports.com': ['Ole Miss Athletics', 'official'],
  'hailstate.com': ['Mississippi State Athletics', 'official'], 'mutigers.com': ['Missouri Athletics', 'official'],
  'soonersports.com': ['Oklahoma Athletics', 'official'], 'gamecocksonline.com': ['South Carolina Athletics', 'official'],
  'utsports.com': ['Tennessee Athletics', 'official'], 'texaslonghorns.com': ['Texas Athletics', 'official'],
  '12thman.com': ['Texas A&M Athletics', 'official'], 'vucommodores.com': ['Vanderbilt Athletics', 'official'],
  'fightingillini.com': ['Illinois Athletics', 'official'], 'iuhoosiers.com': ['Indiana Athletics', 'official'],
  'hawkeyesports.com': ['Iowa Athletics', 'official'], 'umterps.com': ['Maryland Athletics', 'official'],
  'mgoblue.com': ['Michigan Athletics', 'official'], 'msuspartans.com': ['Michigan State Athletics', 'official'],
  'gophersports.com': ['Minnesota Athletics', 'official'], 'huskers.com': ['Nebraska Athletics', 'official'],
  'ohiostatebuckeyes.com': ['Ohio State Athletics', 'official'], 'goducks.com': ['Oregon Athletics', 'official'],
  'gopsusports.com': ['Penn State Athletics', 'official'], 'purduesports.com': ['Purdue Athletics', 'official'],
  'uclabruins.com': ['UCLA Athletics', 'official'], 'usctrojans.com': ['USC Athletics', 'official'],
  'gohuskies.com': ['Washington Athletics', 'official'], 'uwbadgers.com': ['Wisconsin Athletics', 'official'],
  'clemsontigers.com': ['Clemson Athletics', 'official'], 'seminoles.com': ['Florida State Athletics', 'official'],
  'ramblinwreck.com': ['Georgia Tech Athletics', 'official'], 'gocards.com': ['Louisville Athletics', 'official'],
  'miamihurricanes.com': ['Miami Athletics', 'official'], 'goheels.com': ['North Carolina Athletics', 'official'],
  'smumustangs.com': ['SMU Athletics', 'official'], 'hokiesports.com': ['Virginia Tech Athletics', 'official'],
  'thesundevils.com': ['Arizona State Athletics', 'official'], 'baylorbears.com': ['Baylor Athletics', 'official'],
  'byucougars.com': ['BYU Athletics', 'official'], 'cubuffs.com': ['Colorado Athletics', 'official'],
  'kstatesports.com': ['Kansas State Athletics', 'official'], 'okstate.com': ['Oklahoma State Athletics', 'official'],
  'gofrogs.com': ['TCU Athletics', 'official'], 'texastech.com': ['Texas Tech Athletics', 'official'],
  'utahutes.com': ['Utah Athletics', 'official'], 'und.com': ['Notre Dame Athletics', 'official'],
  'nusports.com': ['Northwestern Athletics', 'official'], 'scarletknights.com': ['Rutgers Athletics', 'official'],
  'bceagles.com': ['Boston College Athletics', 'official'], 'calbears.com': ['Cal Athletics', 'official'],
  'goduke.com': ['Duke Athletics', 'official'], 'gopack.com': ['NC State Athletics', 'official'],
  'pittsburghpanthers.com': ['Pitt Athletics', 'official'], 'gostanford.com': ['Stanford Athletics', 'official'],
  'cuse.com': ['Syracuse Athletics', 'official'], 'virginiasports.com': ['Virginia Athletics', 'official'],
  'godeacs.com': ['Wake Forest Athletics', 'official'], 'arizonawildcats.com': ['Arizona Athletics', 'official'],
  'gobearcats.com': ['Cincinnati Athletics', 'official'], 'uhcougars.com': ['Houston Athletics', 'official'],
  'cyclones.com': ['Iowa State Athletics', 'official'], 'kuathletics.com': ['Kansas Athletics', 'official'],
  'ucfknights.com': ['UCF Athletics', 'official'], 'wvusports.com': ['West Virginia Athletics', 'official'],
  'broncosports.com': ['Boise State Athletics', 'official'], 'gotigersgo.com': ['Memphis Athletics', 'official'],
  'tulanegreenwave.com': ['Tulane Athletics', 'official'], 'unlvrebels.com': ['UNLV Athletics', 'official'],
  'jmusports.com': ['James Madison Athletics', 'official'],
};

// Video CDNs whose files may be checked and downloaded for a search result
// (all answer CORS * so the browser downloads them itself; measured
// 2026-11-19). video.twimg.com files belong to the X post that carries them,
// so an X clip's trust is decided by the post's account, never the CDN.
const MEDIA_HOSTS = ['video.twimg.com', 'espnmedia-cdn.akamaized.net', 'mlb-cuts-diamond.mlb.com'];

const KIND_WORD = { official: 'team account', league: 'league account', media: 'network' };
const SITE_WORD = { official: 'team site', league: 'league site', media: 'network' };
const PLATFORM_HOSTS = { reddit: 'Reddit', bluesky: 'Bluesky', streamable: 'Streamable', vimeo: 'Vimeo', drive: 'Google Drive', dropbox: 'Dropbox' };

function urlOf(raw) {
  try {
    const u = new URL(String(raw || ''));
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch { return null; }
}
const hostOf = raw => (urlOf(raw)?.hostname || '').toLowerCase().replace(/\.$/, '');
const isXHost = host => /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(host);

// A Google redirect (google.com/url?url=… or ?q=…, as Google Search / Google
// Videos results link out) -> the address it leads to; anything else as is.
function unwrapRedirect(raw) {
  const u = urlOf(raw);
  if (!u) return String(raw || '');
  const host = u.hostname.toLowerCase();
  if (/^(?:www\.)?google\.[a-z.]{2,6}$/.test(host) && u.pathname === '/url') {
    const target = u.searchParams.get('url') || u.searchParams.get('q') || '';
    if (urlOf(target)) return target;
  }
  return u.toString();
}

// The SITES entry for a URL's host ({ domain, name, kind }) or null.
function siteFor(raw) {
  const host = hostOf(unwrapRedirect(raw));
  if (!host) return null;
  const domain = Object.keys(SITES).find(d => host === d || host.endsWith(`.${d}`));
  return domain ? { domain, name: SITES[domain][0], kind: SITES[domain][1] } : null;
}

const mediaHostTrusted = raw => {
  const u = urlOf(raw);
  if (!u || u.protocol !== 'https:') return false;
  return MEDIA_HOSTS.includes(u.hostname.toLowerCase());
};

const xHandleOf = raw => {
  const u = urlOf(raw);
  if (!u || !isXHost(u.hostname.toLowerCase())) return '';
  const first = u.pathname.split('/')[1] || '';
  return /^[A-Za-z0-9_]{1,15}$/.test(first) && first.toLowerCase() !== 'i' ? first : '';
};

const unverified = (where = '') => ({ trusted: false, kind: 'unverified', site: where, label: where ? `${where} · unverified` : 'Unverified source' });

// One clip (or candidate, or pasted link) -> { trusted, kind, label, site }
// kind: 'official' | 'league' | 'media' | 'unverified'
// label: "@Yankees · team account", "MLB.com · league site", "ESPN · network".
// Inputs: platform ('x', 'espn', 'mlb', 'reddit', …), handle, url (the post or
// page), mediaUrl (the file, for non-X results: it must sit on a trusted CDN).
function classify({ platform = '', handle = '', url = '', mediaUrl = '' } = {}) {
  const pageUrl = unwrapRedirect(url);
  const host = hostOf(pageUrl);
  const isX = platform === 'x' || isXHost(host) || (!platform && !host && handle);
  if (isX) {
    const h = String(handle || xHandleOf(pageUrl) || '').replace(/^@/, '').trim();
    const kind = h ? SOURCES.classifyHandle(h) : 'other';
    if (kind === 'other') return unverified(h ? `@${h}` : 'X');
    return { trusted: true, kind, site: 'X', label: `@${h} · ${KIND_WORD[kind]}` };
  }
  const site = siteFor(pageUrl) || (mediaUrl && !pageUrl ? siteFor(mediaUrl) : null);
  if (!site) return unverified(PLATFORM_HOSTS[platform] || (host ? host.replace(/^www\./, '') : ''));
  // A search result's file must come from a trusted CDN too (a trusted page
  // embedding a file from an unknown host is not enough).
  if (mediaUrl && !mediaHostTrusted(mediaUrl) && !siteFor(mediaUrl)) return unverified(site.name);
  return { trusted: true, kind: site.kind, site: site.name, label: `${site.name} · ${SITE_WORD[site.kind]}` };
}

const isTrusted = c => classify(c || {}).trusted;

// For lists: the clip with its trust label attached ({ ...clip, trust }).
function withTrust(clip) {
  if (!clip) return clip;
  const mediaUrl = clip.platform && clip.platform !== 'x' ? (clip.variants?.[0]?.url || clip.mediaUrl || '') : '';
  const t = classify({ platform: clip.platform || 'x', handle: clip.handle, url: clip.url, mediaUrl });
  return { ...clip, trust: { kind: t.kind, label: t.label, site: t.site } };
}

module.exports = { SITES, MEDIA_HOSTS, classify, isTrusted, withTrust, siteFor, unwrapRedirect, mediaHostTrusted, xHandleOf };
