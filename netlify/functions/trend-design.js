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
// with league, team and player names. Responses are cached for 5 minutes (in
// the function and at the CDN), so the page refreshes every 5 minutes without
// hitting Google on every visit.

const { verifyEsUser } = require('./_supabase-auth.js');

const CACHE_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const PER_CATEGORY = 14;
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

// ── Classifier ─────────────────────────────────────────────────────────────
// [pattern, weight]. League words weigh most; team and player names next;
// shared nicknames (Giants, Cardinals, Rangers, Panthers, Jets, Tigers) get a
// small weight in each league and are settled by context words.
const w = (list, weight) => list.map(word => [word, weight]);
const RULES = {
  nfl: [
    ...w(['nfl', 'super bowl', 'afc', 'nfc', 'pro bowl', 'nfl draft', 'trade deadline'], 6),
    ...w(['quarterback', 'touchdown', 'wide receiver', 'running back', 'tight end', 'linebacker', 'sack', 'interception', 'field goal', 'snap count', 'depth chart', 'fantasy football'], 2),
    ...w(['chiefs', 'eagles', 'cowboys', '49ers', 'niners', 'bills', 'ravens', 'bengals', 'steelers', 'browns', 'packers', 'bears', 'lions', 'vikings', 'commanders', 'seahawks', 'rams', 'chargers', 'raiders', 'broncos', 'dolphins', 'patriots', 'texans', 'colts', 'titans', 'jaguars', 'saints', 'falcons', 'buccaneers', 'bucs'], 4),
    ...w(['giants', 'cardinals', 'jets', 'panthers'], 1),
    ...w(['mahomes', 'josh allen', 'lamar jackson', 'joe burrow', 'travis kelce', 'jalen hurts', 'aaron rodgers', 'dak prescott', 'c.j. stroud', 'cj stroud', 'brock purdy', 'jayden daniels', 'caleb williams', 'justin jefferson', 'saquon barkley', 'kirk cousins', 'tua tagovailoa', 'micah parsons', 'ja\'marr chase', 'patrick mahomes'], 5),
  ],
  cfb: [
    ...w(['college football', 'ncaaf', 'cfp', 'heisman', 'sec', 'big ten', 'big 12', 'acc', 'bowl game', 'signing day', 'transfer portal', 'playoff rankings', 'ap poll'], 6),
    ...w(['ohio state', 'buckeyes', 'alabama', 'crimson tide', 'georgia bulldogs', 'michigan', 'wolverines', 'texas longhorns', 'longhorns', 'lsu', 'oregon', 'ducks', 'notre dame', 'clemson', 'penn state', 'nittany lions', 'usc trojans', 'florida state', 'seminoles', 'tennessee vols', 'volunteers', 'oklahoma sooners', 'sooners', 'miami hurricanes', 'ole miss', 'auburn', 'texas a&m', 'aggies', 'mississippi state', 'nebraska', 'cornhuskers', 'iowa hawkeyes', 'wisconsin badgers', 'utah utes', 'colorado buffaloes', 'deion sanders', 'boise state', 'smu', 'byu', 'indiana hoosiers', 'missouri tigers'], 4),
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
      publishedAt: new Date(tag(item, 'pubDate') || Date.now()).toISOString(),
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
      publishedAt: new Date(tag(item, 'pubDate') || Date.now()).toISOString(),
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
  const push = text => {
    const t = String(text || '').replace(/^["']|["']$/g, m => m).replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
    if (!fits(t.replace(/"/g, ''))) return;
    if (ideas.some(i => i.toLowerCase() === t.toLowerCase())) return;
    ideas.push(t);
  };
  const clean = tidy(item.title);
  const related = (item.related || []).map(r => tidy(r.title));

  // 1. A direct quote.
  for (const text of [clean, ...related]) {
    const quote = (text.match(/"([^"]{10,60})"/) || [])[1];
    if (quote && fits(quote)) { push(`"${quote}"`); break; }
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
  if (String(process.env.GENERATE_AI || '').toLowerCase() === 'rules') return null;
  if (GROQ_API_KEY) return { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_API_KEY, models: [process.env.GROQ_TITLES_MODEL || 'openai/gpt-oss-20b', process.env.GROQ_GENERATE_MODEL || 'openai/gpt-oss-120b'] };
  if (USE_OPENAI) return { url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_API_KEY, models: [process.env.OPENAI_GENERATE_MODEL || 'gpt-4.1-mini'] };
  return null;
}

const titleCache = new Map();
async function aiTitles({ title, related = [], sport = '' }) {
  const provider = aiProvider();
  if (!provider) return null;
  const cacheKey = `${sport}|${title}`;
  if (titleCache.has(cacheKey)) return titleCache.get(cacheKey);
  const story = [`Headline: ${title}`, ...related.slice(0, 3).map(r => `Related: ${r}`), sport ? `Sport: ${sport}` : ''].filter(Boolean).join('\n');
  const messages = [
    { role: 'system', content: 'You write headlines for EssentiallySports social media graphics (US sports fans). Each headline goes in a bold two-line pill, so it must be 3 to 7 words and at most 42 characters. Be punchy and factual. Every claim must be stated in the story: never add opponents, seeds, outcomes, numbers, quotes or predictions that are not there. Questions are fine only about what the story itself raises. No emojis, hashtags or clickbait. Use names fans know. Reply with JSON only: {"titles": ["...", "...", "...", "..."]} with 4 different angles: straight news, name-led, a question the story raises, and a short punchy version (3 to 5 words) that still reads as a complete headline with a subject and a verb.' },
    { role: 'user', content: story },
  ];
  let lastError = null;
  for (const model of provider.models) {
    try {
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, temperature: 0.4, response_format: { type: 'json_object' }, messages }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) { lastError = new Error(data?.error?.message || `AI request failed: ${response.status}`); if (response.status === 429 || response.status === 400) continue; throw lastError; }
      const text = String(data?.choices?.[0]?.message?.content || '');
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      const titles = (parsed.titles || [])
        .map(t => String(t || '').replace(/[#\u{1F300}-\u{1FAFF}]/gu, '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, ''))
        .filter(t => words(t).length >= 2 && t.length <= 48)
        .slice(0, 4);
      if (!titles.length) throw new Error('No usable headlines.');
      titleCache.set(cacheKey, titles);
      if (titleCache.size > 500) titleCache.delete(titleCache.keys().next().value);
      return titles;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('AI headlines unavailable.');
}

// ── Images: the main person or team, from Wikipedia ─────────────────────
// Free, no key. Only used when Wikipedia's own description says it's sport,
// so a namesake can't slip in. Cached between refreshes; each refresh spends
// at most ~4 s on new lookups and fills the rest on the next one.
const WIKI_UA = 'FrameUpTrends/1.0 (https://frameup.essentiallysports.com)';
const SPORT_DESC = /\b(tennis|golf|golfer|football|baseball|basketball|hockey|soccer|athlete|player|coach|quarterback|pitcher|team|club|franchise|league|tournament|championship|cup|racing|driver|boxer|fighter|wrestler|sports?|stadium|olympi\w*|executive|program|athletics|nfl|mlb|nba|nhl|wnba|pga|lpga|atp|wta)\b/i;
const imageCache = new Map(); // name -> { url, title } | null
async function wikiImage(name) {
  if (imageCache.has(name)) return imageCache.get(name);
  let hit = null;
  try {
    const response = await fetch(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(name)}&limit=1`, { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(3000) });
    const page = (await response.json())?.pages?.[0];
    const thumb = page?.thumbnail?.url;
    if (thumb && page.description && !/referred to by the same term/i.test(page.description) && SPORT_DESC.test(page.description)) {
      const url = (thumb.startsWith('//') ? `https:${thumb}` : thumb).replace(/\/\d+px-/, '/330px-');
      hit = { url, title: page.title, logo: /logo|\.svg|wordmark|emblem|crest|seal/i.test(thumb) };
    }
  } catch (error) {
    return null; // not cached: try again next refresh
  }
  imageCache.set(name, hit);
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
        if (hit) { item.image = hit.url; item.imageKind = hit.logo ? 'logo' : 'photo'; item.imageCredit = `Wikipedia: ${hit.title}`; break; }
      }
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
}

// ── Build ──────────────────────────────────────────────────────────────────
const key = title => String(title).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2).slice(0, 7).join(' ');
const MATCH_LISTING = / - Match (WTA|ATP|ITF) - /i;
const PER_SOURCE = 3;
const NOISE = /\b(tickets?|promo code|betting odds|odds, picks|picks and predictions|prediction, odds|best bets|sale|discount|horoscope|obituary)\b/i;

async function buildTrends() {
  const results = await Promise.allSettled(SOURCES.map(source => fetchText(source.url).then(xml => ({ source, xml }))));
  const errors = [];
  const pool = [];
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') { errors.push(SOURCES[index].id); return; }
    const { source, xml } = result.value;
    const parsed = source.kind === 'search' ? parseTrends(xml) : parseNews(xml);
    parsed.forEach(item => pool.push({ ...item, from: source.id, hint: source.category || null }));
  });

  const seen = new Set();
  const out = [];
  for (const item of pool) {
    if (NOISE.test(item.title) || MATCH_LISTING.test(item.title)) continue;
    const k = key(item.title);
    if (!k || seen.has(k)) continue;
    const text = [item.title, ...item.related.map(r => r.title)].join(' · ');
    const { category, score } = classify(text);
    let cat = category;
    // A focused category search keeps its own category unless the text points clearly elsewhere.
    if (item.hint && (!cat || (cat !== item.hint && score < 6))) cat = item.hint;
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
    seen.add(k);
    out.push({
      id: `${item.from}-${Buffer.from(k).toString('base64').slice(0, 16)}`,
      category: cat,
      type: item.type,
      title: item.title,
      traffic: item.traffic || '',
      source: item.source,
      sourceDomain: item.sourceDomain || '',
      url: item.url,
      image: item.image || '',
      publishedAt: item.publishedAt,
      related: item.related,
      titles: suggestTitles({ ...item, category: cat }),
    });
  }

  const trafficValue = t => { const m = String(t || '').match(/([\d.]+)\s*([KkMm])?/); if (!m) return 0; return parseFloat(m[1]) * (/[Mm]/.test(m[2] || '') ? 1e6 : /[Kk]/.test(m[2] || '') ? 1e3 : 1); };
  const categories = {};
  for (const { id } of CATEGORIES) {
    // Search trends first (by volume), then newest stories; at most 3 per
    // source so one site can't fill a category.
    const perSource = {};
    categories[id] = out
      .filter(item => item.category === id)
      .sort((a, b) => (b.type === 'search') - (a.type === 'search') || trafficValue(b.traffic) - trafficValue(a.traffic) || new Date(b.publishedAt) - new Date(a.publishedAt))
      .filter(item => { const src = (item.source || '').toLowerCase().replace(/^www./, ''); perSource[src] = (perSource[src] || 0) + 1; return item.type === 'search' || perSource[src] <= PER_SOURCE; })
      .slice(0, PER_CATEGORY);
  }
  await addImages(CATEGORIES.flatMap(c => categories[c.id]));
  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    refreshSeconds: CACHE_MS / 1000,
    region: 'US',
    aiTitles: Boolean(aiProvider()),
    categories: CATEGORIES.map(c => ({ ...c, count: categories[c.id].length })),
    items: CATEGORIES.flatMap(c => categories[c.id]),
    sourcesFailed: errors,
  };
}

let cache = null;
let inflight = null;

async function getTrends(force) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) {
    inflight = buildTrends().then(data => { cache = { at: Date.now(), data }; return data; }).finally(() => { inflight = null; });
  }
  try {
    return await inflight;
  } catch (error) {
    if (cache) return { ...cache.data, stale: true };
    throw error;
  }
}

function json(statusCode, body, cacheControl) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      // CDN keeps a copy for 5 minutes; after that it serves the old copy while fetching a new one.
      'Cache-Control': cacheControl || 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async event => {
  if (event.httpMethod === 'OPTIONS') return json(204, {}, 'no-store');
  if (event.httpMethod === 'POST') {
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (error) { return json(400, { ok: false, error: 'Invalid request.' }, 'no-store'); }
    if (body.mode !== 'titles') return json(400, { ok: false, error: 'Unknown request.' }, 'no-store');
    const auth = await verifyEsUser(event);
    if (!auth.ok) return json(auth.statusCode, { ok: false, error: auth.error }, 'no-store');
    const title = String(body.title || '').slice(0, 300).trim();
    if (title.length < 3) return json(400, { ok: false, error: 'Missing headline.' }, 'no-store');
    const related = (Array.isArray(body.related) ? body.related : []).map(r => String(r || '').slice(0, 300)).slice(0, 3);
    try {
      const titles = await aiTitles({ title, related, sport: String(body.sport || '').slice(0, 40) });
      if (!titles) return json(200, { ok: true, ai: false, titles: suggestTitles({ title, related: related.map(t => ({ title: t })) }) }, 'no-store');
      return json(200, { ok: true, ai: true, titles }, 'no-store');
    } catch (error) {
      return json(502, { ok: false, error: 'Headline ideas are unavailable right now.' }, 'no-store');
    }
  }
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Use GET or POST.' }, 'no-store');
  try {
    return json(200, await getTrends(false));
  } catch (error) {
    return json(502, { ok: false, error: 'Trends are unavailable right now.', detail: error instanceof Error ? error.message : String(error) }, 'no-store');
  }
};

exports._test = { classify, parseNews, parseTrends, key, suggestTitles, aiTitles };
