// Trend Design: what US sports fans are searching and reading right now.
//
// Sources (free, public, no keys):
//   1. Google Trends "Trending now" RSS for the US — real search trends with
//      approximate search volume and related news. Covers every topic, so only
//      the sports ones are kept.
//   2. Google News "Sports" top stories for the US.
//   3. A focused Google News search per category (last 24 hours, US edition).
//
// Every item is sorted into Golf, Tennis, NFL, College Football, MLB or Others
// with league, team and player names.
//
// Freshness rules (the page says "Updated X min ago" from updatedAt):
//   - Real publish times only: an item with no date, or a date more than 15
//     minutes in the future, is dropped (no "just now" guesses).
//   - Hard cutoffs: news older than 48 h and search trends older than 24 h are
//     dropped (search trends older than that are no longer trending).
//   - The same story from several sources is merged (title similarity), and
//     the extra sources count as momentum.
//   - Ranking: recency (half-life 8 h news, 12 h search) × momentum (Google
//     search volume, number of sources) × ES sport relevance.
//   - Cache: fresh for 10 minutes; up to 60 minutes old it is served at once
//     while a rebuild runs in the background (stale-while-revalidate). The CDN
//     adds at most 5 minutes on top.
//
// AI (POST mode "enrich"): a one-line "why fans care" and 3 headline ideas
// per trend, only for cards someone opens, hovers or asks about. Light tier,
// up to 6 trends per call, cached per trend id for 45 minutes and shared by
// every user of the instance; hourly and weekly limits apply.

const { verifyEsUser, bearerToken } = require('./_supabase-auth.js');
const { gatewayConfigured, aiText, isBudgetError, logBackupCall, userOverHourlyLimit, aiSpendGate, featureDisabled, freeModeGate, inFreeMode, withAiMode } = require('./_ai-gateway.js');
let TEAMS = null;
try { TEAMS = require('../../video-ads-teams.js'); } catch (error) { /* team logos are optional */ }

const FRESH_MS = 10 * 60 * 1000; // rebuild after this
const STALE_MAX_MS = 60 * 60 * 1000; // serve old data at once (and rebuild) up to this age
const FORCE_MIN_MS = 2 * 60 * 1000; // "Refresh" rebuilds only data older than this
const MAX_AGE_H = { '1d': { news: 48, search: 24 }, '2d': { news: 48, search: 48 } };
const FUTURE_SKEW_MS = 15 * 60 * 1000;
const HALF_LIFE_H = { news: 8, search: 12 };
const CORE_SPORTS = new Set(['nfl', 'cfb', 'mlb', 'golf', 'tennis']);
// A trend id is a hash of the story's words, so its angles stay right as long
// as the story is on the board (48 h at most): keep them for 6 h per instance.
const ENRICH_TTL_MS = 6 * 60 * 60 * 1000;
const ENRICH_BATCH = 6;
const FETCH_TIMEOUT_MS = 6000;
const PER_CATEGORY = 16; // more per sport now that storylines fold repeats
const UA = 'Mozilla/5.0 (compatible; FrameUpTrends/1.0; +https://frameup.essentiallysports.com)';

const CATEGORIES = [
  { id: 'golf', label: 'Golf' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'nfl', label: 'NFL' },
  { id: 'cfb', label: 'College Football' },
  { id: 'mlb', label: 'MLB' },
  { id: 'others', label: 'Others' },
];

const NEWS = 'https://news.google.com/rss';
const US = 'hl=en-US&gl=US&ceid=US:en';
const SOURCES = [
  { id: 'trends', kind: 'search', url: 'https://trends.google.com/trending/rss?geo=US' },
  { id: 'sports', kind: 'news', url: `${NEWS}/headlines/section/topic/SPORTS?${US}` },
  { id: 'nfl', kind: 'news', category: 'nfl', url: `${NEWS}/search?q=${encodeURIComponent('NFL when:1d')}&${US}` },
  { id: 'cfb', kind: 'news', category: 'cfb', url: `${NEWS}/search?q=${encodeURIComponent('"college football" OR CFP OR Heisman when:1d')}&${US}` },
  { id: 'mlb', kind: 'news', category: 'mlb', url: `${NEWS}/search?q=${encodeURIComponent('MLB when:1d')}&${US}` },
  { id: 'golf', kind: 'news', category: 'golf', url: `${NEWS}/search?q=${encodeURIComponent('"PGA Tour" OR "LIV Golf" OR LPGA OR "DP World Tour" when:1d')}&${US}` },
  { id: 'tennis', kind: 'news', category: 'tennis', url: `${NEWS}/search?q=${encodeURIComponent('ATP OR WTA tennis when:1d')}&${US}` },
];
// Video Ads looks back two days, and only at the sports it makes ads for.
const SOURCES_2D = [
  { id: 'nfl', kind: 'news', category: 'nfl', url: `${NEWS}/search?q=${encodeURIComponent('NFL when:2d')}&${US}` },
  { id: 'cfb', kind: 'news', category: 'cfb', url: `${NEWS}/search?q=${encodeURIComponent('"college football" OR CFP OR Heisman when:2d')}&${US}` },
  { id: 'mlb', kind: 'news', category: 'mlb', url: `${NEWS}/search?q=${encodeURIComponent('MLB when:2d')}&${US}` },
  { id: 'trends', kind: 'search', url: 'https://trends.google.com/trending/rss?geo=US' },
];

// ── Classifier ─────────────────────────────────────────────────────────────
// [pattern, weight]. League words weigh most; team and player names next;
// shared nicknames (Giants, Cardinals, Rangers, Panthers, Jets, Tigers) get a
// small weight in each league and are settled by context words.
const w = (list, weight) => list.map(word => [word, weight]);
const RULES = {
  nfl: [
    ...w(['nfl', 'super bowl', 'afc', 'nfc', 'pro bowl', 'nfl draft', 'trade deadline'], 6),
    ...w(['qb'], 3),
    ...w(['quarterback', 'touchdown', 'wide receiver', 'running back', 'tight end', 'linebacker', 'sack', 'interception', 'field goal', 'snap count', 'depth chart', 'fantasy football'], 2),
    ...w(['chiefs', 'eagles', 'cowboys', '49ers', 'niners', 'bills', 'ravens', 'bengals', 'steelers', 'browns', 'packers', 'bears', 'lions', 'vikings', 'commanders', 'seahawks', 'rams', 'chargers', 'raiders', 'broncos', 'dolphins', 'patriots', 'texans', 'colts', 'titans', 'jaguars', 'saints', 'falcons', 'buccaneers', 'bucs'], 4),
    ...w(['giants', 'cardinals', 'jets', 'panthers'], 1),
    ...w(['mahomes', 'josh allen', 'lamar jackson', 'joe burrow', 'travis kelce', 'jalen hurts', 'aaron rodgers', 'dak prescott', 'c.j. stroud', 'cj stroud', 'brock purdy', 'jayden daniels', 'caleb williams', 'justin jefferson', 'saquon barkley', 'kirk cousins', 'tua tagovailoa', 'micah parsons', 'ja\'marr chase', 'patrick mahomes', 'derrick henry', 'geno smith', 'aidan hutchinson', 'dan campbell', 'andy reid', 'sean payton', 'myles garrett', 'trevor lawrence', 'bo nix', 'drake maye', 'puka nacua', 'ceedee lamb', 'jahmyr gibbs', 'travis hunter'], 5),
  ],
  cfb: [
    ...w(['college football', 'ncaaf', 'cfp', 'heisman', 'sec', 'big ten', 'big 12', 'acc', 'bowl game', 'signing day', 'transfer portal', 'playoff rankings', 'ap poll'], 6),
    ...w(['ohio state', 'buckeyes', 'alabama', 'crimson tide', 'georgia bulldogs', 'michigan', 'wolverines', 'texas longhorns', 'longhorns', 'lsu', 'oregon', 'ducks', 'notre dame', 'clemson', 'penn state', 'nittany lions', 'usc trojans', 'florida state', 'seminoles', 'tennessee vols', 'volunteers', 'oklahoma sooners', 'sooners', 'miami hurricanes', 'ole miss', 'auburn', 'texas a&m', 'aggies', 'mississippi state', 'nebraska', 'cornhuskers', 'iowa hawkeyes', 'wisconsin badgers', 'utah utes', 'colorado buffaloes', 'deion sanders', 'boise state', 'smu', 'byu', 'indiana hoosiers', 'missouri tigers', 'arch manning', 'dan lanning', 'kirby smart', 'ryan day', 'lane kiffin', 'jeremiah smith'], 4),
    ...w(['tigers'], 1),
    ...w(['football'], 1),
  ],
  mlb: [
    ...w(['mlb', 'world series', 'baseball', 'cy young', 'al mvp', 'nl mvp', 'home run', 'pitcher', 'bullpen', 'inning', 'spring training', 'free agency', 'mlb draft', 'gold glove', 'silver slugger'], 6),
    ...w(['yankees', 'dodgers', 'red sox', 'mets', 'cubs', 'astros', 'braves', 'phillies', 'padres', 'mariners', 'orioles', 'guardians', 'twins', 'brewers', 'blue jays', 'royals', 'rockies', 'diamondbacks', 'd-backs', 'reds', 'pirates', 'white sox', 'athletics', 'angels', 'marlins', 'nationals'], 4),
    ...w(['giants', 'cardinals', 'rangers', 'tigers', 'rays'], 1),
    ...w(['ohtani', 'aaron judge', 'juan soto', 'paul skenes', 'tarik skubal', 'bobby witt', 'mookie betts', 'freddie freeman', 'vladimir guerrero', 'pete alonso', 'misiorowski'], 5),
  ],
  golf: [
    ...w(['golf', 'pga tour', 'pga', 'liv golf', 'lpga', 'dp world tour', 'ryder cup', 'masters', 'the open championship', 'fedex cup', 'tour championship', 'presidents cup', 'solheim cup'], 6),
    ...w(['scottie scheffler', 'scheffler', 'rory mcilroy', 'mcilroy', 'bryson dechambeau', 'dechambeau', 'tiger woods', 'brooks koepka', 'jon rahm', 'xander schauffele', 'nelly korda', 'jordan spieth', 'ludvig aberg', 'collin morikawa', 'viktor hovland', 'jeeno thitikul', 'lydia ko', 'birdie', 'bogey'], 5),
  ],
  tennis: [
    ...w(['tennis', 'atp', 'wta', 'wimbledon', 'roland garros', 'french open', 'australian open', 'davis cup', 'billie jean king cup', 'atp finals', 'wta finals', 'grand slam'], 6),
    ...w(['jannik sinner', 'sinner', 'carlos alcaraz', 'alcaraz', 'novak djokovic', 'djokovic', 'aryna sabalenka', 'sabalenka', 'coco gauff', 'gauff', 'iga swiatek', 'swiatek', 'taylor fritz', 'ben shelton', 'jessica pegula', 'daniil medvedev', 'alexander zverev', 'elena rybakina', 'naomi osaka', 'frances tiafoe', 'madison keys', 'emma navarro'], 5),
  ],
  others: [
    ...w(['nba', 'wnba', 'nhl', 'mls', 'soccer', 'premier league', 'champions league', 'world cup', 'ufc', 'mma', 'boxing', 'formula 1', 'f1', 'nascar', 'indycar', 'olympics', 'olympic', 'march madness', 'college basketball', 'ncaab', 'stanley cup', 'nba finals', 'fifa', 'uswnt', 'usmnt', 'wrestlemania', 'wwe'], 6),
    ...w(['lakers', 'celtics', 'warriors', 'knicks', 'bucks', 'nuggets', 'heat', 'mavericks', 'thunder', 'cavaliers', 'timberwolves', 'lebron', 'steph curry', 'stephen curry', 'giannis', 'luka doncic', 'wembanyama', 'caitlin clark', 'a\'ja wilson', 'angel reese', 'messi', 'ronaldo', 'pochettino', 'oilers', 'maple leafs', 'bruins', 'rangers', 'panthers', 'jets', 'verstappen', 'lewis hamilton'], 3),
  ],
};
// Context words that settle shared nicknames.
const CONTEXT = {
  nfl: ['quarterback', 'touchdown', 'qb', 'week ', 'snap', 'yards', 'sack', 'nfl'],
  mlb: ['pitcher', 'inning', 'home run', 'mlb', 'baseball', 'bullpen', 'roster spot', 'free agent'],
  cfb: ['college', 'ncaa', 'freshman', 'recruit', 'commit', 'bowl'],
};

// Generic sports words only add to a score that already has a real sports signal.
const GENERIC = ['vs', 'score', 'game', 'match', 'coach', 'season', 'playoff', 'injury', 'roster', 'trade', 'signs', 'contract'];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const COMPILED = Object.fromEntries(Object.entries(RULES).map(([cat, rules]) => [cat, rules.map(([word, weight]) => [new RegExp(`(^|[^a-z0-9])${escapeRe(word)}([^a-z0-9]|$)`, 'i'), weight])]));

// A college name next to another sport ("Notre Dame Basketball", "Michigan
// hockey") is not college football: it goes to Others, with a score strong
// enough that a College Football search hint can't pull it back.
const NOT_FOOTBALL = /(^|[^a-z])(basketball|hoops|hockey|volleyball|soccer|softball|lacrosse|wrestling|gymnastics|ncaab|march madness|final four)([^a-z]|$)/i;
const FOOTBALL = /(^|[^a-z])(football|cfp|heisman|bowl game|quarterback|touchdown|ncaaf|nfl)([^a-z]|$)/i;

function classify(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const scores = {};
  for (const [cat, rules] of Object.entries(COMPILED)) {
    let score = 0;
    for (const [re, weight] of rules) if (re.test(t)) score += weight;
    for (const word of CONTEXT[cat] || []) if (t.includes(word)) score += 1;
    if (score > 1) for (const word of GENERIC) if (t.includes(` ${word} `)) score += 1;
    scores[cat] = score;
  }
  const ranked = Object.entries(scores).filter(([cat]) => cat !== 'others').sort((a, b) => b[1] - a[1]);
  const [bestCat, best] = ranked[0];
  if (bestCat === 'cfb' && NOT_FOOTBALL.test(t) && !FOOTBALL.test(t)) return { category: 'others', score: Math.max(best, scores.others, 6) };
  if (best >= 4) return { category: bestCat, score: best };
  if (scores.others >= 3 || best >= 3) return { category: best >= scores.others ? bestCat : 'others', score: Math.max(best, scores.others) };
  return { category: null, score: Math.max(best, scores.others) };
}

// ── RSS parsing ────────────────────────────────────────────────────────────
function decode(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ''; };
const items = xml => [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; } };

// A real publish time, or '' (the item is then dropped). Small clock skew is
// clamped to now; a date far in the future is not trusted.
function publishTime(value, now = Date.now()) {
  const t = Date.parse(String(value || '').trim());
  if (!value || !Number.isFinite(t) || t > now + FUTURE_SKEW_MS) return '';
  return new Date(Math.min(t, now)).toISOString();
}

function parseTrends(xml) {
  return items(xml).map(item => {
    const news = [...item.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map(m => ({
      title: tag(m[1], 'ht:news_item_title'),
      url: tag(m[1], 'ht:news_item_url'),
      source: tag(m[1], 'ht:news_item_source'),
    })).filter(n => n.title && /^https?:/.test(n.url));
    const title = tag(item, 'title');
    return {
      type: 'search',
      title: title.replace(/\b\w/g, c => c.toUpperCase()),
      query: title,
      traffic: tag(item, 'ht:approx_traffic'),
      publishedAt: publishTime(tag(item, 'pubDate')),
      image: /^https:/.test(tag(item, 'ht:picture')) ? tag(item, 'ht:picture') : '',
      url: news[0]?.url || `https://trends.google.com/trending?geo=US`,
      source: news[0]?.source || 'Google Trends',
      sourceDomain: hostOf(news[0]?.url || '') || 'trends.google.com',
      related: news.slice(0, 3).map(n => ({ ...n, domain: hostOf(n.url) })),
    };
  });
}

function parseNews(xml) {
  return items(xml).map(item => {
    const raw = tag(item, 'title');
    const source = tag(item, 'source') || (raw.match(/ - ([^-]+)$/) || [])[1] || '';
    const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
    return {
      type: 'news',
      title,
      url: tag(item, 'link'),
      source,
      sourceDomain: hostOf((item.match(/<source[^>]*\surl="([^"]+)"/) || [])[1] || ''),
      publishedAt: publishTime(tag(item, 'pubDate')),
      related: [],
    };
  }).filter(n => n.title && /^https?:/.test(n.url));
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Headline ideas ─────────────────────────────────────────────────────────
// Short, ES-style headlines (fit a two-line pill: ~4–7 words, ≤ 42 chars),
// built from the story itself. No AI: nothing is invented, words come from
// the headline, its quotes and the names in it.
const LEAD_NOISE = /^(?:(?:report|reports|watch|video|breaking|live|exclusive|opinion|analysis|look|photos?|ranking|rumor|rumors)\s*[:|-]\s*)+/i;
const TAIL_NOISE = /\s*(?:\|[^|]*$|-\s*(?:live|latest|updates?|highlights)\b.*$|\(\s*(?:video|photos?|watch)\s*\)\s*$)/i;
const SPLIT = /\s(?:-|–|—|\|)\s|:\s|;\s|,\s(?=(?:as|after|but|while|with|amid|despite|before|and|reach|says|per)\b)/i;
const WEAK_END = /\s(?:a|an|the|of|to|for|in|on|at|with|and|or|but|as|by|from|after|before|his|her|their|its|is|are|was|be|that|this)$/i;
const NOT_NAMES = new Set(['The', 'A', 'An', 'How', 'Why', 'What', 'When', 'Who', 'Where', 'After', 'Before', 'With', 'Week', 'Day', 'Report', 'Watch', 'Live', 'Best', 'Top', 'New', 'Latest', 'Here', 'This', 'That', 'These', 'It', 'Is', 'Are', 'Will', 'Can', 'Should', 'Could', 'Breaking', 'Video', 'Photos', 'Ranking', 'Rankings', 'Every', 'All', 'Our', 'Your', 'His', 'Her', 'Their', 'Former', 'Latest', 'Takeaways', 'Grades', 'Player', 'Bizarre', 'Down', 'Up', 'In', 'On', 'At', 'For', 'From', 'To', 'Of', 'And', 'But', 'Or', 'Bay', 'Area']);

const words = s => s.split(/\s+/).filter(Boolean);
const FRAGMENT_LEAD = /^(?:here['’]?s|here is|see (?:where|how|what)|plus|best of|latest|live|watch|full|every|he|she|they|it|his|her|their|but|and|or|as)\b/i;
function tidy(text) {
  return String(text || '')
    .replace(LEAD_NOISE, '')
    .replace(TAIL_NOISE, '')
    .replace(/\s*(?:\.\.\.|…)\s*$/, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function cap(text, maxWords = 7, maxChars = 42) {
  let ws = words(text);
  while (ws.length > 2 && (ws.length > maxWords || ws.join(' ').length > maxChars)) ws = ws.slice(0, -1);
  let out = ws.join(' ').replace(/[,;:–—-]+$/, '');
  while (WEAK_END.test(out) && words(out).length > 3) out = out.replace(WEAK_END, '');
  return out;
}
// Proper names: runs of capitalised words (keeps "Jeremiah Smith", "Ohio State", "WTA Finals").
function names(text) {
  const out = [];
  const re = /\b((?:[A-Z][\w'.&-]*|[A-Z]{2,}\d*)(?:\s+(?:[A-Z][\w'.&-]*|of|de|van|der|la)){0,3})/g;
  let m;
  while ((m = re.exec(text))) {
    const parts = words(m[1]).filter((w, i) => !(i === 0 && NOT_NAMES.has(w)));
    while (parts.length && /^(of|de|van|der|la)$/.test(parts[parts.length - 1])) parts.pop();
    const name = parts.join(' ');
    if (name && !NOT_NAMES.has(name) && name.length > 2 && !out.includes(name)) out.push(name);
  }
  return out;
}

function suggestTitles(item) {
  // Only whole phrases: a quote, a clause or a headline that already fits a
  // two-line pill. Nothing is cut mid-phrase and nothing is invented.
  const ideas = [];
  const fits = t => { const n = words(t).length; return n >= 2 && n <= 8 && t.length <= 46 && !WEAK_END.test(t); };
  // Not a headline: a publication's name, a bare name ("Tiger Woods"), a
  // fragment that leans on the rest of the sentence ("Here's When He'll Play
  // Next") or a broken bit of markup ("Instagram Story)").
  const sourceNames = new Set([item.source, ...(item.related || []).map(r => r.source)].filter(Boolean).map(n => n.toLowerCase()));
  const standsAlone = (t, quoted) => {
    const plain = t.replace(/"/g, '');
    if (sourceNames.has(plain.toLowerCase())) return false;
    if ((plain.match(/\(/g) || []).length !== (plain.match(/\)/g) || []).length || /\w\/\w/.test(plain)) return false;
    if (FRAGMENT_LEAD.test(plain)) return false;
    if (quoted) return true;
    return /(^|\s)[a-z][a-z'’]{2,}/.test(plain) || words(plain).length >= 4;
  };
  const push = (text, quoted = false) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (!fits(t.replace(/"/g, '')) || !standsAlone(t, quoted)) return;
    if (ideas.some(i => i.toLowerCase() === t.toLowerCase())) return;
    ideas.push(t);
  };
  const clean = tidy(item.title);
  const related = (item.related || []).map(r => tidy(r.title));

  // 1. A direct quote.
  for (const text of [clean, ...related]) {
    const quote = (text.match(/"([^"]{10,60})"/) || [])[1];
    if (quote && fits(quote)) { push(`"${quote}"`, true); break; }
  }
  // 2. The headline itself, or its first clause.
  push(clean.replace(/"/g, ''));
  for (const part of clean.split(SPLIT)) push(part.replace(/"/g, '').replace(/^./, c => c.toUpperCase()));
  // 3. Search trends: the name people search for + "is trending", and the lead story.
  if (item.type === 'search') {
    const query = String(item.query || item.title).toLowerCase();
    const named = names(related.join(' · ')).find(n => query.includes(n.toLowerCase()) && words(n).length <= 3);
    if (named) push(`${named} is trending`);
    for (const story of related) for (const part of story.split(SPLIT)) push(part.replace(/"/g, ''));
  }
  return ideas.slice(0, 3);
}

// ── On-demand AI headlines (same free model as Generate) ──────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const USE_OPENAI = process.env.GENERATE_USE_OPENAI === 'true' && Boolean(OPENAI_API_KEY);
function aiProvider() {
  if (String(process.env.GENERATE_AI || '').toLowerCase() === 'rules' || inFreeMode()) return null; // ai-free-mode: no Groq either
  if (GROQ_API_KEY) return { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_API_KEY, models: [process.env.GROQ_TITLES_MODEL || 'openai/gpt-oss-20b', process.env.GROQ_GENERATE_MODEL || 'openai/gpt-oss-120b'] };
  if (USE_OPENAI) return { url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_API_KEY, models: [process.env.OPENAI_GENERATE_MODEL || 'gpt-4.1-mini'] };
  return null;
}

const TITLES_SYSTEM = 'You write headlines for EssentiallySports social media graphics (US sports fans). Each headline goes in a bold two-line pill, so it must be 3 to 7 words and at most 42 characters. Be punchy and factual. Every claim must be stated in the story: never add opponents, seeds, outcomes, numbers, quotes or predictions that are not there. Questions are fine only about what the story itself raises. No emojis, hashtags or clickbait. Use names fans know. Reply with JSON only: {"titles": ["...", "...", "...", "..."]} with 4 different angles: straight news, name-led, a question the story raises, and a short punchy version (3 to 5 words) that still reads as a complete headline with a subject and a verb.';

function parseTitles(text) {
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const titles = (parsed.titles || [])
    .map(t => String(t || '').replace(/[#\u{1F300}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, ''))
    .filter(t => words(t).length >= 2 && t.length <= 48)
    .slice(0, 4);
  if (!titles.length) throw new Error('No usable headlines.');
  return titles;
}

// One light-tier JSON call: the Vercel AI Gateway first (logged with cost),
// then Groq / opt-in OpenAI as the backup (logged as "<feature>-backup").
async function lightJson({ system, user, maxTokens }, track) {
  const provider = aiProvider();
  let lastError = null;
  if (gatewayConfigured()) {
    try {
      const { text, cost } = await aiText({ tier: 'light', system, messages: [{ role: 'user', content: user }], json: true, maxTokens, timeoutMs: 15000, track });
      return { text, cost };
    } catch (error) {
      lastError = error;
    }
  }
  if (!provider) {
    // No Groq / OpenAI key: one try on the Gateway backup model (a different
    // model from the light tier), unless the budget is gone or AI is switched off.
    if (gatewayConfigured() && lastError && !isBudgetError(lastError) && lastError.code !== 'feature-off') {
      const { text, cost } = await aiText({ tier: 'backup', system, messages: [{ role: 'user', content: user }], json: true, maxTokens, timeoutMs: 15000, track: track ? { ...track, feature: `${track.feature || 'trend'}-backup` } : track });
      return { text, cost };
    }
    throw lastError || new Error('AI unavailable.');
  }
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  for (const model of provider.models) {
    const started = Date.now();
    try {
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.4, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      const backupName = provider.url.includes('groq') ? 'groq' : 'openai';
      if (!response.ok) { lastError = new Error(data?.error?.message || `AI request failed: ${response.status}`); await logBackupCall(track, { provider: backupName, model, ok: false, started, error: lastError.message }); if (response.status === 429 || response.status === 400) continue; throw lastError; }
      await logBackupCall(track, { provider: backupName, model, ok: true, usage: data?.usage, started });
      return { text: String(data?.choices?.[0]?.message?.content || ''), cost: 0 };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('AI unavailable.');
}
const aiAvailable = () => Boolean(aiProvider()) || gatewayConfigured();

// Headline ideas for one story (older "titles" mode; the page now uses "enrich").
const titleCache = new Map(); // key -> { at, titles }
function rememberTitles(cacheKey, titles) {
  titleCache.set(cacheKey, { at: Date.now(), titles });
  if (titleCache.size > 500) titleCache.delete(titleCache.keys().next().value);
  return titles;
}

async function aiTitles({ title, related = [], sport = '' }, track) {
  if (!aiAvailable()) return null;
  const cacheKey = `${sport}|${title}`;
  const hit = titleCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ENRICH_TTL_MS) return hit.titles;
  const story = [`Headline: ${title}`, ...related.slice(0, 3).map(r => `Related: ${r}`), sport ? `Sport: ${sport}` : ''].filter(Boolean).join('\n');
  const { text } = await lightJson({ system: TITLES_SYSTEM, user: story, maxTokens: 1500 }, track);
  return rememberTitles(cacheKey, parseTitles(text));
}

// ── AI enrichment: "why fans care" + 3 headlines, several trends per call ──
const ENRICH_SYSTEM = [
  'You write for EssentiallySports (ES) social editors; the readers are US sports fans.',
  'ES voice: fan-first and direct, the name fans know up front, present tense, confident, never clickbait. No "BREAKING", no "you won\'t believe", no emojis or hashtags.',
  'For each story return:',
  '- "why": one plain line, at most 14 words, on why fans care right now;',
  '- "titles": 3 headlines for a bold two-line graphic pill, each 3 to 7 words and at most 42 characters, with different angles: straight news, name-led, and short and punchy with a verb;',
  '- "hook": the opening line of a 9:16 reel, at most 12 words, that makes a fan keep watching (the question the story raises, or a tease of its key fact).',
  'Facts: use only what the story says. Never add opponents, numbers, quotes, outcomes or predictions. Any number you write must appear in the story.',
  'Reply with JSON only: {"items":[{"id":"<id>","why":"...","titles":["...","...","..."],"hook":"..."}]} with one entry per story id.',
].join('\n');

const enrichCache = new Map(); // trend id -> { at, why, titles }
function cachedEnrichment(id, now = Date.now()) {
  const hit = enrichCache.get(id);
  if (!hit) return null;
  if (now - hit.at > ENRICH_TTL_MS) { enrichCache.delete(id); return null; }
  return { why: hit.why, titles: hit.titles, hook: hit.hook || '' };
}
function rememberEnrichment(id, value, now = Date.now()) {
  enrichCache.set(id, { at: now, ...value });
  if (enrichCache.size > 1500) enrichCache.delete(enrichCache.keys().next().value);
}

const cleanLine = (text, max) => String(text || '').replace(/[#\u{1F300}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
// Every number in the AI's line must be in the story (no invented stats,
// scores or dates); clickbait words are dropped too.
const numbersIn = text => (String(text || '').replace(/,(?=\d{3})/g, '').match(/\d+(?:\.\d+)?/g) || []);
const CLICKBAIT = /\b(?:breaking|you won['’]t believe|shocking|insane|must[- ]see|jaw[- ]dropping)\b/i;
function grounded(line, source) {
  if (!line || CLICKBAIT.test(line)) return false;
  if (source == null) return true;
  const known = new Set(numbersIn(source));
  return numbersIn(line).every(n => known.has(n));
}
// sources: optional { id: story text } to check numbers against.
function parseEnrichment(text, ids, sources = null) {
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const out = {};
  for (const entry of Array.isArray(parsed.items) ? parsed.items : []) {
    const id = String(entry?.id || '');
    if (!ids.includes(id) || out[id]) continue;
    const source = sources ? sources[id] ?? '' : null;
    const titles = (Array.isArray(entry.titles) ? entry.titles : [])
      .map(t => cleanLine(t, 60).replace(/[.]+$/, ''))
      .filter(t => words(t).length >= 2 && t.length <= 48 && grounded(t, source))
      .slice(0, 3);
    let why = cleanLine(entry.why, 140).replace(/^why fans care:?\s*/i, '');
    if (!grounded(why, source) || words(why).length > 18) why = '';
    let hook = cleanLine(entry.hook, 100).replace(/^hook:?\s*/i, '');
    if (!grounded(hook, source) || words(hook).length > 14) hook = '';
    if (titles.length || why || hook) out[id] = { why, titles, hook };
  }
  return out;
}
function storyBlock(story) {
  return [`id: ${story.id}`, `Headline: ${story.title}`, ...(story.related || []).slice(0, 2).map(r => `Related: ${r}`), story.sport ? `Sport: ${story.sport}` : ''].filter(Boolean).join('\n');
}
// Output budget: the light model reasons before it answers, so leave room.
const enrichMaxTokens = n => Math.min(3200, 900 + 340 * n); // +hook

// stories: [{ id, title, related: [string], sport }] (already de-duplicated).
// Returns { items: { id: { why, titles, ai, cached } }, calls, cost }.
async function enrich(stories, track, { now = Date.now() } = {}) {
  const items = {};
  const misses = [];
  for (const story of stories) {
    const hit = cachedEnrichment(story.id, now);
    if (hit) items[story.id] = { ...hit, ai: true, cached: true };
    else misses.push(story);
  }
  if (!misses.length) return { items, calls: 0, cost: 0 };
  const { text, cost } = await lightJson({ system: ENRICH_SYSTEM, user: misses.map(storyBlock).join('\n\n'), maxTokens: enrichMaxTokens(misses.length) }, track);
  const parsed = parseEnrichment(text, misses.map(s => s.id), Object.fromEntries(misses.map(s => [s.id, [s.title, ...(s.related || [])].join(' · ')])));
  for (const story of misses) {
    const value = parsed[story.id];
    if (!value) continue;
    rememberEnrichment(story.id, value, now);
    items[story.id] = { ...value, ai: true, cached: false };
  }
  return { items, calls: 1, cost: cost || 0 };
}

// ── Images: the main person or team, from Wikipedia ─────────────────────
// Free, no key. Only used when Wikipedia's own description says it's sport,
// so a namesake can't slip in. Cached between refreshes; each refresh spends
// at most ~4 s on new lookups and fills the rest on the next one.
const WIKI_UA = 'FrameUpTrends/1.0 (https://frameup.essentiallysports.com)';
const SPORT_DESC = /\b(tennis|golf|golfer|football|baseball|basketball|hockey|soccer|athlete|player|coach|quarterback|pitcher|team|club|franchise|league|tournament|championship|cup|racing|driver|boxer|fighter|wrestler|sports?|stadium|olympi\w*|executive|program|athletics|nfl|mlb|nba|nhl|wnba|pga|lpga|atp|wta)\b/i;
const imageCache = new Map(); // name -> { hit: { url, title } | null, at }
const IMAGE_MISS_TTL_MS = 6 * 60 * 60 * 1000; // a miss is retried after 6 h
async function wikiImage(name) {
  const known = imageCache.get(name);
  if (known && (known.hit || Date.now() - known.at < IMAGE_MISS_TTL_MS)) return known.hit;
  let hit = null;
  try {
    const response = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=1`, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    const page = (await response.json())?.pages?.[0];
    const thumb = page?.thumbnail?.url;
    // The page must be about the name we asked for (Wikipedia's title search
    // is fuzzy: "Ramey Saves" finds "Saved game").
    const asked = new Set(words(String(name).toLowerCase()).filter(w => w.length >= 4));
    const sameName = words(String(page?.title || '').toLowerCase().replace(/[()]/g, '')).some(w => asked.has(w));
    if (thumb && sameName && page.description && !/referred to by the same term/i.test(page.description) && SPORT_DESC.test(page.description)) {
      const url = (thumb.startsWith('//') ? `https:${thumb}` : thumb).replace(/\/\d+px-/, '/330px-');
      hit = { url, title: page.title, logo: /logo|\.svg|wordmark|emblem|crest|seal/i.test(thumb) };
    }
  } catch (error) {
    return null; // not cached: try again next refresh
  }
  imageCache.set(name, { hit, at: Date.now() });
  if (imageCache.size > 3000) imageCache.delete(imageCache.keys().next().value);
  return hit;
}
const TEAM_HINT = /\b(Volunteers|Vols|Buckeyes|Crimson Tide|Bulldogs|Wolverines|Longhorns|Tigers|Ducks|Fighting Irish|Seminoles|Sooners|Hurricanes|Cougars|Utes|Hoosiers|Aggies|Huskers|Cornhuskers|Hawkeyes|Badgers|Nittany Lions|Trojans|Gators)\b/;
function imageCandidates(item) {
  const text = item.type === 'search' ? `${item.query || item.title} · ${(item.related || []).map(r => r.title).join(' · ')}` : item.title;
  const plain = tidy(text).replace(/['’]s\b/g, '');
  // Title Case headlines run names into verbs ("Joe Mixon Speaks Out"), so also
  // try the first two and three words of each run ("Joe Mixon").
  const runs = names(plain).filter(n => words(n).length >= 2);
  const found = runs.flatMap(n => { const w = words(n); return w.length <= 2 ? [n] : [w.slice(0, 2).join(' '), w.slice(-2).join(' '), w.slice(0, 3).join(' '), w.length <= 4 ? n : null]; })
    .filter(n => n && !/^(NFL|MLB|NBA|WTA|ATP|PGA|LPGA|CFP|DP World|World Tour|College Football|Playoff|Free Agents?|Executive|Awards?|Top \d+)\b/i.test(n));
  // Single well-known surnames (e.g. "Andreeva", "McIlroy") are tried after full names.
  const singles = names(plain).filter(n => words(n).length === 1 && n.length > 4 && !/^[A-Z]{2,}$/.test(n));
  const teams = TEAM_HINT.test(item.title) ? [item.title.match(new RegExp(`[A-Z][a-z]+(?:\\s[A-Z][a-z]+)?\\s${TEAM_HINT.source.slice(3, -3)}`))?.[0]].filter(Boolean) : [];
  return [...new Set([...found, ...teams, ...singles])].slice(0, 5);
}
async function addImages(list, budgetMs = 4000) {
  const started = Date.now();
  const todo = list.filter(item => !item.image);
  let index = 0;
  async function worker() {
    while (index < todo.length && Date.now() - started < budgetMs) {
      const item = todo[index++];
      for (const name of imageCandidates(item)) {
        const hit = await wikiImage(name);
        if (hit) { item.image = hit.url; item.imageKind = hit.logo ? 'logo' : 'photo'; item.imageCredit = `Wikipedia: ${hit.title}`; Object.defineProperty(item, 'imageSubject', { value: hit.title, enumerable: false, configurable: true }); break; }
      }
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
}

// ── Build ──────────────────────────────────────────────────────────────────
const key = title => String(title).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2).slice(0, 7).join(' ');
const MATCH_LISTING = / - Match (WTA|ATP|ITF) - /i;
const PER_SOURCE = 3;
const NOISE = /\b(tickets?|promo code|betting odds|odds, picks|picks and predictions|prediction, odds|best bets|expert picks|sale|discount|horoscope|obituary|where to watch|how to watch|live stream(?:ing)?|tv channel|photo galler(?:y|ies)|prospects chat|mlb the show|madden \d+|ea sports fc|jobs pay)\b/i;

// Stable id from the story's words (the same story keeps its id across
// refreshes and sources, so the AI cache and saved trends keep working).
function trendId(title) {
  let h = 0x811c9dc5;
  for (const ch of key(title) || String(title)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return `t-${h.toString(36)}`;
}

// Freshness: drop items without a real date or past the cutoff for their type.
function withinCutoff(item, now = Date.now(), maxAge = MAX_AGE_H['1d']) {
  const t = Date.parse(item.publishedAt || '');
  if (!Number.isFinite(t)) return false;
  const hours = (now - t) / 3600e3;
  return hours >= -FUTURE_SKEW_MS / 3600e3 && hours <= (maxAge[item.type] ?? maxAge.news);
}

// ── Same story, several sources ────────────────────────────────────────────
const STOP = new Set('the and for nor but with from into over under after before about than then this that these those his her their its who what why how when where will can could would should not new says say said report reports per amid just more most has have had they them our your you are was were been being out off vs. game games season week'.split(' '));
function tokens(text) {
  return new Set(String(text || '').toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(word => word.length > 2 && !STOP.has(word))
    .map(word => (word.length > 4 ? word.replace(/(?:ing|ed|es|s)$/, '') : word)));
}
// Two titles tell the same story when they share most of their words. A
// search trend's short query ("jeremiah smith") matches any story it names.
function sameStory(a, b) {
  const A = tokens(a.query || a.title);
  const B = tokens(b.query || b.title);
  let inter = 0;
  for (const word of A) if (B.has(word)) inter += 1;
  if (inter < 2) return false;
  const small = Math.min(A.size, B.size);
  const union = A.size + B.size - inter;
  if (inter / union >= 0.5) return true;
  if ((a.type === 'search' || b.type === 'search') && inter / small >= 0.8) return true;
  return small >= 4 && inter / small >= 0.75;
}
// Keeps the first item of each story (callers pass search trends first, then
// the newest news) and folds the others in: their sources count as coverage
// and fill the related links.
function dedupe(list) {
  const out = [];
  for (const item of list) {
    const rep = out.find(existing => sameStory(existing, item));
    if (!rep) {
      out.push({ ...item, related: [...(item.related || [])], sources: new Set([item.sourceDomain || item.source || item.from]) });
      continue;
    }
    rep.sources.add(item.sourceDomain || item.source || item.from);
    if (item.type === 'news' && rep.related.length < 3 && !rep.related.some(r => r.url === item.url) && item.url !== rep.url) {
      rep.related.push({ title: item.title, url: item.url, source: item.source, domain: item.sourceDomain || hostOf(item.url) });
    }
  }
  return out.map(({ sources, ...item }) => ({ ...item, coverage: sources.size }));
}

// ── Ranking: recency × momentum × ES relevance ──────────────────────────────
const trafficValue = t => { const m = String(t || '').replace(/,/g, '').match(/([\d.]+)\s*([KkMm])?/); if (!m) return 0; return parseFloat(m[1]) * (/[Mm]/.test(m[2] || '') ? 1e6 : /[Kk]/.test(m[2] || '') ? 1e3 : 1); };
function rankScore(item, now = Date.now()) {
  const ageH = Math.max(0, (now - Date.parse(item.publishedAt)) / 3600e3) || 0;
  const recency = Math.pow(0.5, ageH / (HALF_LIFE_H[item.type] || HALF_LIFE_H.news));
  const searches = item.type === 'search' ? 0.5 + 0.5 * Math.log10(1 + trafficValue(item.traffic) / 100) : 0;
  const momentum = (1 + searches) * Math.min(2, 1 + 0.25 * ((item.coverage || 1) - 1));
  const relevance = (CORE_SPORTS.has(item.category) ? 1 : 0.6) * (0.6 + 0.4 * Math.min(1, (item.score || 0) / 12));
  return recency * momentum * relevance;
}

// ── Team logos (NFL, CFB, MLB) from video-ads-teams.js ─────────────────────
const TEAM_RES = {};
function teamFor(item) {
  if (!TEAMS || !['nfl', 'cfb', 'mlb'].includes(item.category)) return null;
  if (!TEAM_RES[item.category]) {
    const pool = TEAMS.TEAMS.filter(team => team.sport === item.category);
    const names = [...pool.map(team => [team.name, team]), ...pool.map(team => [team.short, team])].sort((a, b) => b[0].length - a[0].length);
    TEAM_RES[item.category] = names.map(([name, team]) => [new RegExp(`(^|[^A-Za-z])${escapeRe(name)}(?![A-Za-z])`), team]);
  }
  const text = item.type === 'search' ? `${item.title} · ${(item.related || []).map(r => r.title).join(' · ')}` : item.title;
  const found = TEAM_RES[item.category].find(([re]) => re.test(text));
  if (!found) return null;
  const team = found[1];
  return { name: team.name, short: team.short, logo: TEAMS.logoFor(team) || '' };
}

// ── Storylines: the same story told by several outlets ────────────────────
// Title similarity (dedupe) only merges near-identical headlines. A storyline
// is wider: stories in one sport that share a person, team or a named running
// story ("Bryson DeChambeau", "Power rankings"). The board then shows one lead
// card per storyline with the rest folded under it.
const STORY_PHRASES = [
  [/\bpower rankings?\b/i, 'Power rankings'],
  [/\b(?:cfp|college football playoff|playoff) (?:rankings?|picture|race|bubble)\b|\bplayoff picture\b/i, 'Playoff picture'],
  [/\bmock drafts?\b|\bdraft order\b/i, 'The draft'],
  [/\bfree agen(?:t|ts|cy)\b|\bhot stove\b/i, 'Free agency'],
  [/\btrade (?:rumors?|deadline|idea)\b|\brumors? tracker\b/i, 'Trade talk'],
  [/\bheisman\b/i, 'Heisman race'],
  [/\bwaiver wire\b|\bfantasy football\b/i, 'Fantasy'],
  [/\bcoaching (?:search|carousel|hot seat)\b|\bfired\b|\bfires\b/i, 'Coaching moves'],
];
const NOT_STORY = new Set('nfl mlb nba nhl wnba pga lpga atp wta liv tour world golf tennis college football baseball basketball playoff playoffs week season draft rankings ranking power finals final championship open cup game games team teams news update updates report reports rumors rumor free agency agent agents top best first last year years day days fantasy odds picks title titles win wins loss losses coach coaches players player star stars league sports sport cfp heisman ncaa ncaaf espn athletic dp ryder mvp series american national state university city united north south east west new york los angeles san bay sunday monday tuesday wednesday thursday friday saturday january february march april may june july august september october november december'.split(' '));
function storyKeys(item) {
  const text = item.type === 'search' ? `${item.query || item.title} · ${item.title}` : item.title;
  const keys = new Map(); // key -> label hint
  for (const [re, label] of STORY_PHRASES) if (re.test(text)) keys.set(`p:${label.toLowerCase().replace(/\s+/g, '-')}`, [label]);
  for (const run of names(tidy(text).replace(/['’]s\b/g, ''))) {
    const parts = run.split(/[\s-]+/).filter(Boolean);
    parts.forEach((part, index) => {
      const clean = part.replace(/['’]$/, '');
      const k = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (k.length < 4 || NOT_STORY.has(k) || NOT_NAMES.has(clean) || /^\d/.test(k)) return;
      // Label: the name with its neighbour ("Tiger" -> "Tiger Woods",
      // "DeChambeau" -> "Bryson DeChambeau"); buildStorylines keeps the
      // version most members agree on.
      const nameish = w => w && /^[A-Z][a-z'’.]+$/.test(w) && !NOT_NAMES.has(w) && !NOT_STORY.has(w.toLowerCase()) && !TITLE_WORDS.has(w);
      const prev = parts[index - 1];
      const next = parts[index + 1]?.replace(/['’]$/, '');
      const label = nameish(prev) ? `${prev} ${clean}` : nameish(next) ? `${clean} ${next}` : clean;
      const list = keys.get(`n:${k}`) || [];
      keys.set(`n:${k}`, [...list, label]);
    });
  }
  return keys;
}
// items: one sport's stories, best first. Returns [{ id, label, ids }] and
// sets item.storyline = { id, label, size, lead } on every member.
function buildStorylines(list, category) {
  const index = new Map(); // key -> { label, members: Set }
  list.forEach((item, i) => {
    for (const [key, labels] of storyKeys(item)) {
      if (!index.has(key)) index.set(key, { labels: new Map(), members: new Set() });
      const entry = index.get(key);
      entry.members.add(i);
      new Set(labels).forEach(label => entry.labels.set(label, (entry.labels.get(label) || 0) + 1));
    }
  });
  // A key on most of the sport's stories is not a storyline, it's the sport.
  const tooCommon = n => list.length >= 5 && n > list.length * 0.6;
  const candidates = [...index.entries()]
    .filter(([, e]) => e.members.size >= 2 && !tooCommon(e.members.size))
    .sort((a, b) => b[1].members.size - a[1].members.size || Math.min(...a[1].members) - Math.min(...b[1].members) || (a[0] < b[0] ? -1 : 1));
  const taken = new Set();
  const out = [];
  for (const [key, entry] of candidates) {
    const members = [...entry.members].filter(i => !taken.has(i)).sort((a, b) => a - b);
    if (members.length < 2) continue;
    members.forEach(i => taken.add(i));
    // The most common label; ties go to the two-word one ("Bryson DeChambeau").
    const label = [...entry.labels.entries()].sort((a, b) => b[1] - a[1] || words(b[0]).length - words(a[0]).length || b[0].length - a[0].length)[0][0];
    const id = `s-${category}-${key.slice(2).replace(/[^a-z0-9-]/g, '')}`.slice(0, 40);
    out.push({ id, label, category, ids: members.map(i => list[i].id) });
    members.forEach((i, n) => { list[i].storyline = { id, label, size: members.length, lead: n === 0 }; });
  }
  return out;
}

// ── Signals: hot, rising, new ───────────────────────────────────────────────
// Deterministic, from the feed itself (and the previous build on this
// instance when there is one): no AI.
//   hot:    50K+ Google searches, or 6+ outlets on one storyline within 12 h
//   rising: more outlets or searches than the last build, or 2+ outlets /
//           a 3-story storyline / a search trend within 3 h
// Only a storyline's lead (or a story on its own) carries a signal.
function signalFor(item, { now = Date.now(), size = 1, prev = null } = {}) {
  const ageH = (now - Date.parse(item.publishedAt)) / 3600e3;
  if (!Number.isFinite(ageH)) return null;
  const searches = trafficValue(item.traffic);
  const outlets = (item.coverage || 1) + Math.max(0, size - 1);
  if (item.type === 'search' && searches >= 50000) return 'hot';
  if (outlets >= 6 && ageH <= 12) return 'hot';
  if (prev && ((item.coverage || 1) > (prev.coverage || 1) || searches > trafficValue(prev.traffic))) return 'rising';
  if (ageH <= 3 && ((item.coverage || 1) >= 2 || size >= 3 || item.type === 'search')) return 'rising';
  return null;
}

// ── ES relevance per sport and newsletter brand ────────────────────────────
// 0–100. Core ES sports first, the three flagship newsletters (The Huddle,
// Essentially CFB, ES Dugout) next, then a team we have a logo for, a star in
// the classifier's player lists, Google search volume and a big storyline.
let BRANDS = null;
try { BRANDS = require('../../video-ads-brands.js'); } catch (error) { /* brands are optional */ }
const BRAND_SPORTS = new Set(['nfl', 'cfb', 'mlb']);
function brandFor(category) {
  if (!BRAND_SPORTS.has(category)) return '';
  const brand = BRANDS?.AD_BRANDS?.find(b => b.sport === category);
  return brand ? brand.id : '';
}
function esFit(item, { size = 1 } = {}) {
  let score = CORE_SPORTS.has(item.category) ? 50 : 25;
  if (BRAND_SPORTS.has(item.category)) score += 15;
  if (item.team) score += 10;
  if ((item.score || 0) >= 9) score += 10; else if ((item.score || 0) >= 6) score += 5;
  if (item.type === 'search') score += 10;
  score += Math.min(15, 5 * Math.max(0, size - 1));
  return { score: Math.min(100, score), brand: brandFor(item.category) };
}

// ── Post kit, the free part: template, photo query ─────────────────────────
// Template ids are the Generate formats (generate.html FORMATS).
const TEMPLATE_LABEL = { cover: 'Cover', quote: 'Quote', 'long-quote': 'Long Quote', 'stats-single-ent': 'Player Stats', 'listicle-type-2': 'Ranked List' };
const STAT_UNITS = /\b\d+(?:\.\d+)?\s?(?:yards|yds|points|pts|touchdowns|tds?|td passes|home runs|hrs?|strikeouts|ks|rbis?|sacks|aces|birdies|eagles|under par|-under|rebounds|assists|goals|saves|era)\b/i;
const LIST_WORDS = /\b(?:power rankings?|rankings?|ranked|top \d+|\d+ (?:best|players|teams|takeaways|things|questions|landing spots)|landing spots|mock draft|draft order|waiver wire|winners and losers|grades)\b/i;
function suggestTemplate(item) {
  const title = tidy(item.title);
  const quote = (title.match(/["“]([^"”]{10,140})["”]/) || [])[1] || '';
  if (quote) return quote.length > 60 ? { id: 'long-quote', label: TEMPLATE_LABEL['long-quote'], why: 'The story leads with a quote.' } : { id: 'quote', label: TEMPLATE_LABEL.quote, why: 'The story leads with a quote.' };
  if (LIST_WORDS.test(title)) return { id: 'listicle-type-2', label: TEMPLATE_LABEL['listicle-type-2'], why: 'It is a ranking or a list.' };
  if (STAT_UNITS.test(title)) return { id: 'stats-single-ent', label: TEMPLATE_LABEL['stats-single-ent'], why: 'The headline has a player stat.' };
  return { id: 'cover', label: TEMPLATE_LABEL.cover, why: 'A bold headline over a photo fits a news story.' };
}
// What to search for in the photo library: the main person, else the team,
// else the storyline, else the league.
const TITLE_WORDS = new Set('Announces Announced Interest Could Would Should Take Takes Top Questions Players Entering Lose Loses Latest Free Updated Early Fresh Five Three Four Ten Sell Buy Total Did Does Week Joins Signs Says Set Gets Makes Wins Beats Leads Rises Drops Names Hires Fires Reveals Confirms Reacts Return Returns Comeback News Report Rumors Odds Picks Predictions Projection Prediction Rankings Ranking Power Playoff Draft Mock Observations Simulator Takeaways Grades Live Watch Today Tonight Game Games Season Team Teams Star Stars Coach Hype Alarm Reveal Reveals Get Say Comes Metrics Interest Outlines Says'.split(' '));
const NOT_PEOPLE = /^(?:NFL|MLB|NBA|NHL|WTA|ATP|PGA|LPGA|LIV|CFP|DP|College|Playoff|Power|Free|World|Tour|Week|Draft|Super|Pro|Ryder|Grand|Heisman|Hall|Tennis|Golf|Finals?|Open|Masters|Championship)\b/;
function photoQuery(item) {
  const wiki = String(item.imageSubject || '').replace(/\s*\([^)]*\)$/, '');
  const text = item.type === 'search' ? `${item.query || item.title} · ${(item.related || []).map(r => r.title).join(' · ')}` : item.title;
  // 2. A star from the classifier's player lists, as written in the story.
  const lower = text.toLowerCase();
  const star = (RULES[item.category] || []).filter(([, weight]) => weight === 5).map(([name]) => name).filter(name => name.includes(' ') && lower.includes(name)).sort((a, b) => b.length - a.length)[0];
  if (star) { const at = lower.indexOf(star); return { query: text.slice(at, at + star.length), kind: 'person' }; }
  // The person Wikipedia confirmed for the card photo (a sports page).
  if (wiki && item.imageKind !== 'logo' && words(wiki).length >= 2 && words(wiki).length <= 3) return { query: wiki, kind: 'person' };
  // 3. A two-word name ("Dan Lanning"), not a Title Case headline fragment.
  const person = names(tidy(text).replace(/['’]s\b/g, ''))
    .flatMap(n => { const w = words(n); return w.map((_, i) => w.slice(i, i + 2)).filter(pair => pair.length === 2); })
    .find(([a, b]) => /^[A-Z][a-z'’.-]+$/.test(a) && /^[A-Z][a-zA-Z'’.-]+$/.test(b) && !NOT_NAMES.has(a) && !TITLE_WORDS.has(a) && !TITLE_WORDS.has(b) && !NOT_STORY.has(a.toLowerCase()) && !NOT_STORY.has(b.toLowerCase()) && !NOT_PEOPLE.test(a));
  if (person) return { query: person.join(' '), kind: 'person' };
  if (item.team?.name) return { query: item.team.name, kind: 'team' };
  if (item.storyline?.label) return { query: item.storyline.label, kind: 'story' };
  return { query: CATEGORIES.find(c => c.id === item.category)?.label || 'Sports', kind: 'league' };
}

// The last build per window: id -> { coverage, traffic }, for "rising".
const previousBuild = {};

async function buildTrends(sources = SOURCES, { window = '1d', now = Date.now() } = {}) {
  const maxAge = MAX_AGE_H[window] || MAX_AGE_H['1d'];
  const results = await Promise.allSettled(sources.map(source => fetchText(source.url).then(xml => ({ source, xml }))));
  const errors = [];
  const pool = [];
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') { errors.push(sources[index].id); return; }
    const { source, xml } = result.value;
    const parsed = source.kind === 'search' ? parseTrends(xml) : parseNews(xml);
    parsed.forEach(item => pool.push({ ...item, from: source.id, hint: source.category || null }));
  });
  // Every source down: fail, so the last good copy is kept (marked stale).
  if (errors.length === sources.length) throw new Error('Every trend source failed.');

  let dropped = 0;
  const kept = [];
  for (const item of pool) {
    if (NOISE.test(item.title) || MATCH_LISTING.test(item.title)) continue;
    if (!withinCutoff(item, now, maxAge)) { dropped += 1; continue; }
    const text = [item.title, ...item.related.map(r => r.title)].join(' · ');
    const { category, score } = classify(text);
    let cat = category;
    // A focused category search keeps its own category unless the text points clearly elsewhere.
    if (item.hint && (!cat || (cat !== item.hint && score < 6))) cat = item.hint;
    // The story's own title wins over its related headlines and the search hint:
    // "Boston College Basketball" is not NFL or college football, even when the
    // related stories are about football.
    if ((cat === 'nfl' || cat === 'cfb') && NOT_FOOTBALL.test(` ${item.title} `) && !FOOTBALL.test(` ${item.title} `)) cat = 'others';
    // Google Search trends cover every topic: keep one only with a clear
    // sports signal (a league, team or player name, not just a sporty word).
    if (item.type === 'search') {
      const own = classify(item.title);
      const sportyStories = item.related.filter(r => classify(r.title).score >= 5).length;
      if (!cat || score < 5 || (own.score < 5 && sportyStories < 2)) continue;
    }
    // Google News "Sports" stories are already sport; unmatched ones go to Others.
    if (!cat && item.from === 'sports') cat = 'others';
    if (!cat) continue;
    kept.push({ ...item, category: cat, score });
  }
  // Search trends first (by volume), then the newest news, so a story keeps
  // its strongest version when sources are merged.
  kept.sort((a, b) => (b.type === 'search') - (a.type === 'search') || trafficValue(b.traffic) - trafficValue(a.traffic) || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const out = dedupe(kept).map(item => {
    const shaped = {
      id: trendId(item.title),
      category: item.category,
      type: item.type,
      title: item.title,
      traffic: item.traffic || '',
      source: item.source,
      sourceDomain: item.sourceDomain || '',
      url: item.url,
      image: item.image || '',
      publishedAt: item.publishedAt,
      coverage: item.coverage,
      related: item.related,
      titles: suggestTitles(item),
    };
    shaped.rank = Number(rankScore({ ...shaped, score: item.score }, now).toFixed(4));
    const team = teamFor(shaped);
    if (team) shaped.team = team;
    Object.defineProperty(shaped, 'score', { value: item.score, enumerable: false });
    return shaped;
  });

  const categories = {};
  for (const { id } of CATEGORIES) {
    // Best first; at most 3 news stories per publication so one site can't
    // fill a category.
    const perSource = {};
    categories[id] = out
      .filter(item => item.category === id)
      .sort((a, b) => b.rank - a.rank)
      .filter(item => { const src = (item.source || '').toLowerCase().replace(/^www./, ''); perSource[src] = (perSource[src] || 0) + 1; return item.type === 'search' || perSource[src] <= PER_SOURCE; })
      .slice(0, PER_CATEGORY);
  }
  // Storylines per sport; a storyline's lead ranks higher the more outlets
  // tell it (capped), then signals, ES fit and the free half of the post kit.
  const prev = previousBuild[window] || null;
  const storylines = [];
  for (const { id } of CATEGORIES) {
    storylines.push(...buildStorylines(categories[id], id));
    for (const item of categories[id]) {
      const size = item.storyline?.size || 1;
      if (item.storyline?.lead) item.rank = Number((item.rank * Math.min(1.6, 1 + 0.12 * (size - 1))).toFixed(4));
      const signal = item.storyline && !item.storyline.lead ? null : signalFor(item, { now, size, prev: prev?.get(item.id) });
      if (signal) item.signal = signal;
      item.fit = esFit(item, { size: item.storyline?.lead ? size : 1 });
      item.template = suggestTemplate(item);
    }
    categories[id].sort((a, b) => b.rank - a.rank);
  }
  previousBuild[window] = new Map(CATEGORIES.flatMap(c => categories[c.id]).map(item => [item.id, { coverage: item.coverage, traffic: item.traffic }]));
  await addImages(CATEGORIES.flatMap(c => categories[c.id]));
  CATEGORIES.forEach(c => categories[c.id].forEach(item => { item.photo = photoQuery(item); }));
  return {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    refreshSeconds: FRESH_MS / 1000,
    freshness: { newsMaxHours: maxAge.news, searchMaxHours: maxAge.search, freshMinutes: FRESH_MS / 60000, dropped },
    region: 'US',
    aiTitles: aiAvailable() && !featureDisabled('trend-headlines'),
    aiEnrich: aiAvailable() && !featureDisabled('trend-enrich'),
    // Switched off with AI_DISABLE: the page says so and keeps its free ideas.
    aiOff: featureDisabled('trend-enrich'),
    categories: CATEGORIES.map(c => ({ ...c, count: categories[c.id].length })),
    items: CATEGORIES.flatMap(c => categories[c.id]),
    storylines,
    brands: (BRANDS?.AD_BRANDS || []).map(b => ({ id: b.id, label: b.label, sport: b.sport, accent: b.accent })),
    sourcesFailed: errors,
  };
}

// One cache per window ('1d' = Trends, '2d' = Video Ads).
// Stale-while-revalidate: under FRESH_MS the copy is served as is; up to
// STALE_MAX_MS it is served at once and a rebuild starts in the background;
// older than that the request waits for the rebuild (and still gets the old
// copy, marked stale, if every rebuild fails).
const caches = {};
const inflights = {};

function rebuild(id) {
  if (!inflights[id]) {
    inflights[id] = buildTrends(id === '2d' ? SOURCES_2D : SOURCES, { window: id })
      .then(data => { caches[id] = { at: Date.now(), data }; return data; })
      .finally(() => { inflights[id] = null; });
  }
  return inflights[id];
}

async function getTrends(force, { window = '1d' } = {}) {
  const id = window === '2d' ? '2d' : '1d';
  const cache = caches[id];
  const age = cache ? Date.now() - cache.at : Infinity;
  if (cache && (force ? age < FORCE_MIN_MS : age < FRESH_MS)) return cache.data;
  if (cache && !force && age < STALE_MAX_MS) {
    rebuild(id).catch(error => console.error('trend-design background refresh failed:', error));
    return { ...cache.data, revalidating: true };
  }
  try {
    return await rebuild(id);
  } catch (error) {
    if (caches[id]) return { ...caches[id].data, stale: true };
    throw error;
  }
}

// Adds cached AI enrichment to the trends people are about to see (free:
// nothing new is asked of the AI here).
function withCachedEnrichment(data) {
  if (!data?.items) return data;
  const now = Date.now();
  return { ...data, items: data.items.map(item => { const ai = cachedEnrichment(item.id, now); return ai ? { ...item, ai } : item; }) };
}

function json(statusCode, body, cacheControl) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // The CDN keeps a copy for 5 minutes, then serves it while it fetches a
      // new one. updatedAt in the body is always the real build time.
      'Cache-Control': cacheControl || 'public, max-age=60, s-maxage=300, stale-while-revalidate=900',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

// The stories to enrich: the server's own copy when it has the id (so the
// prompt uses what the feed said), else the text the page sent, trimmed.
function storiesFrom(body) {
  const known = new Map((caches['1d']?.data?.items || []).map(item => [item.id, item]));
  const label = id => CATEGORIES.find(c => c.id === id)?.label || '';
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(body.items) ? body.items : []) {
    const id = String(raw?.id || '').slice(0, 40);
    if (!/^[\w-]{2,40}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const own = known.get(id);
    const title = String(own?.title || raw.title || '').slice(0, 300).trim();
    if (title.length < 3) continue;
    const related = (own ? own.related.map(r => r.title) : (Array.isArray(raw.related) ? raw.related : [])).map(r => String(r || '').slice(0, 200)).filter(Boolean).slice(0, 2);
    out.push({ id, title, related, sport: own ? label(own.category) : String(raw.sport || '').slice(0, 40), fallback: own?.titles });
    if (out.length >= ENRICH_BATCH) break;
  }
  return out;
}
const rulesFor = story => ({ why: '', hook: '', titles: story.fallback?.length ? story.fallback : suggestTitles({ title: story.title, related: story.related.map(t => ({ title: t })) }), ai: false });

async function handleEnrich(event, body) {
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error }, 'no-store');
  const stories = storiesFrom(body);
  if (!stories.length) return json(400, { ok: false, error: 'No trends to enrich.' }, 'no-store');
  const now = Date.now();
  const items = {};
  stories.forEach(story => { const hit = cachedEnrichment(story.id, now); if (hit) items[story.id] = { ...hit, ai: true, cached: true }; });
  const misses = stories.filter(story => !items[story.id]);
  // Everything cached: no AI call, no limit check, no cost.
  if (!misses.length) return json(200, { ok: true, ai: true, items, calls: 0 }, 'no-store');
  const withRules = () => { misses.forEach(story => { if (!items[story.id]) items[story.id] = rulesFor(story); }); return items; };
  if (!aiAvailable()) return json(200, { ok: true, ai: false, items: withRules(), calls: 0 }, 'no-store');
  if (featureDisabled('trend-enrich')) return json(200, { ok: true, ai: false, limited: 'off', items: withRules(), calls: 0 }, 'no-store');
  const token = bearerToken(event.headers);
  const [gate, overHour] = await Promise.all([aiSpendGate(token, { feature: 'trend-enrich' }), userOverHourlyLimit(token)]);
  // ai-free-mode: over a weekly budget -> the free rule-based ideas (AI angles hidden on the page).
  if (freeModeGate(gate)) return json(200, { ok: true, ai: false, items: withRules(), calls: 0 }, 'no-store');
  if (gate) return json(gate.status, { ok: false, error: gate.error, reason: gate.reason, items: withRules() }, 'no-store');
  if (overHour) return json(200, { ok: true, ai: false, limited: 'hourly', items: withRules(), calls: 0 }, 'no-store');
  try {
    const result = await enrich(misses, { feature: 'trend-enrich', email: auth.user.email, token }, { now });
    Object.assign(items, result.items);
    return json(200, { ok: true, ai: true, items: withRules(), calls: result.calls }, 'no-store');
  } catch (error) {
    return json(200, { ok: true, ai: false, items: withRules(), calls: 0, error: 'AI ideas are unavailable right now.' }, 'no-store');
  }
}

// withAiMode (ai-free-mode): one free-mode store per request; replies carry mode: 'free'.
exports.handler = withAiMode(async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {}, 'no-store');
  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid request.' }, 'no-store'); }
    if (body.mode === 'enrich') return handleEnrich(event, body);
    if (body.mode !== 'titles') return json(400, { ok: false, error: 'Unknown request.' }, 'no-store');
    const auth = await verifyEsUser(event);
    if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error }, 'no-store');
    const title = String(body.title || '').slice(0, 300).trim();
    if (title.length < 3) return json(400, { ok: false, error: 'Missing headline.' }, 'no-store');
    const related = (Array.isArray(body.related) ? body.related : []).map(r => String(r || '').slice(0, 300)).slice(0, 3);
    // Over the weekly $ limit: 429 like the other AI modes (the page keeps its
    // free rule-based ideas).
    // Switched off (AI_DISABLE=trend-headlines): the free rule-based ideas.
    if (featureDisabled('trend-headlines')) return json(200, { ok: true, ai: false, off: true, titles: suggestTitles({ title, related: related.map(t => ({ title: t })) }) }, 'no-store');
    const [gate, overHour] = await Promise.all([aiSpendGate(bearerToken(event.headers), { feature: 'trend-headlines' }), userOverHourlyLimit(bearerToken(event.headers))]);
    // ai-free-mode: over a weekly budget -> the free rule-based headlines.
    if (freeModeGate(gate)) return json(200, { ok: true, ai: false, titles: suggestTitles({ title, related: related.map(t => ({ title: t })) }) }, 'no-store');
    if (gate) return json(gate.status, { ok: false, error: gate.error, reason: gate.reason }, 'no-store');
    // Over the hourly AI limit: fall back to the free rule-based headlines.
    if (overHour) {
      return json(200, { ok: true, ai: false, titles: suggestTitles({ title, related: related.map(t => ({ title: t })) }) }, 'no-store');
    }
    try {
      const titles = await aiTitles({ title, related, sport: String(body.sport || '').slice(0, 40) }, { feature: 'trend-headlines', email: auth.user.email, token: bearerToken(event.headers) });
      if (!titles) return json(200, { ok: true, ai: false, titles: suggestTitles({ title, related: related.map(t => ({ title: t })) }) }, 'no-store');
      return json(200, { ok: true, ai: true, titles }, 'no-store');
    } catch (error) {
      return json(502, { ok: false, error: 'Headline ideas are unavailable right now.' }, 'no-store');
    }
  }
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Use GET or POST.' }, 'no-store');
  try {
    const fresh = String(event.queryStringParameters?.fresh || '') === '1';
    const data = withCachedEnrichment(await getTrends(fresh));
    // A forced refresh is never kept by the CDN.
    return json(200, data, fresh ? 'no-store' : undefined);
  } catch (error) {
    console.error('trend-design failed:', error);
    return json(502, { ok: false, error: 'Trends are unavailable right now.' }, 'no-store');
  }
});

exports.getTrends = getTrends;
exports._test = {
  classify, parseNews, parseTrends, key, suggestTitles, aiTitles,
  publishTime, withinCutoff, tokens, sameStory, dedupe, rankScore, trafficValue, trendId, teamFor,
  buildTrends, enrich, parseEnrichment, enrichMaxTokens, cachedEnrichment, withCachedEnrichment,
  storyKeys, buildStorylines, signalFor, esFit, suggestTemplate, photoQuery, grounded, ENRICH_SYSTEM,
  reset() { Object.keys(previousBuild).forEach(k => delete previousBuild[k]); Object.keys(caches).forEach(k => delete caches[k]); Object.keys(inflights).forEach(k => delete inflights[k]); enrichCache.clear(); titleCache.clear(); imageCache.clear(); },
  setCacheAge(window, ms) { if (caches[window]) caches[window].at = Date.now() - ms; },
  FRESH_MS, STALE_MAX_MS, ENRICH_TTL_MS, ENRICH_BATCH, MAX_AGE_H,
};
