// FrameUp Generate: turns a brief into on-brand Social Media design specs.
//
//   1. Research  ES coverage (ES MCP tools when configured, else the public
//                essentiallysports.com WordPress API).
//   2. Think     ES MCP reasoning tool if it has one, else OpenAI, else a
//                rule-based draft planner (clearly labelled "draft").
//   3. Check     every spec against the template's limits; invalid ones drop.
//   4. Photo     one ES image per spec that takes a photo.
//
// The AI never draws: it only fills fields our templates already understand.
// The browser renders each spec with the real editor (frameup-spec.js).
const { verifyEsUser } = require('./_supabase-auth.js');
const { loadPastDesigns, selectExamples, formatExamples } = require('./_generate-examples.js');
const { isMcpConfigured, createSession } = require('./_es-mcp.js');
const { gatewayConfigured, aiText, isBudgetError, MODELS: AI_MODELS } = require('./_ai-gateway.js');

const ES_WP_API = 'https://www.essentiallysports.com/wp-json/wp/v2';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// OpenAI is opt-in (it is billed separately): set GENERATE_USE_OPENAI=true.
const USE_OPENAI = process.env.GENERATE_USE_OPENAI === 'true' && Boolean(OPENAI_API_KEY);
const OPENAI_GENERATE_MODEL = process.env.OPENAI_GENERATE_MODEL || 'gpt-4.1-mini';
// Groq (free tier) is the default brain whenever GROQ_API_KEY is set.
// GENERATE_AI=rules turns AI off; GENERATE_AI=openai prefers OpenAI.
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_GENERATE_MODEL = process.env.GROQ_GENERATE_MODEL || 'openai/gpt-oss-120b';
// Tried in order when the main model is rate limited (each has its own free allowance).
const GROQ_FALLBACK_MODELS = String(process.env.GROQ_FALLBACK_MODELS ?? 'openai/gpt-oss-20b,qwen/qwen3.8-27b').split(',').map(s => s.trim()).filter(Boolean);
const GENERATE_AI = String(process.env.GENERATE_AI || '').toLowerCase();
const AI_PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: GROQ_API_KEY, model: GROQ_GENERATE_MODEL, fallbacks: GROQ_FALLBACK_MODELS },
  openai: { url: 'https://api.openai.com/v1/chat/completions', key: OPENAI_API_KEY, model: OPENAI_GENERATE_MODEL },
};
function pickProvider() {
  if (GENERATE_AI === 'rules') return null;
  if (GENERATE_AI === 'openai' && USE_OPENAI) return { name: 'openai', ...AI_PROVIDERS.openai };
  // Vercel AI Gateway (main tier: Claude Haiku) is preferred when its key is set; Groq stays as the backup.
  if (GENERATE_AI !== 'groq' && gatewayConfigured()) {
    return { name: 'gateway', model: AI_MODELS.main, backup: GROQ_API_KEY ? { name: 'groq', ...AI_PROVIDERS.groq } : null };
  }
  if (GROQ_API_KEY) return { name: 'groq', ...AI_PROVIDERS.groq };
  if (USE_OPENAI) return { name: 'openai', ...AI_PROVIDERS.openai };
  return null;
}
const ES_IMAGE_BUCKET = process.env.ES_IMAGE_BUCKET || 'essentiallysports-images-v2prod';
const TOOL_OVERRIDES = {
  think: process.env.ES_MCP_THINK_TOOL || '',
  articles: process.env.ES_MCP_ARTICLES_TOOL || '',
  stats: process.env.ES_MCP_STATS_TOOL || '',
  trending: process.env.ES_MCP_TRENDING_TOOL || '',
  images: process.env.ES_MCP_SEARCH_TOOL || '',
};
const MAX_DESIGNS = 4;
// Hosts the /api/es-image-search proxy will fetch (same list as es-image-search.js);
// a photo on any other host would fail to load in the editor.
const PROXY_IMAGE_HOSTS = new Set(['image-cdn.essentiallysports.com', 'www.essentiallysports.com', 'www.staging.essentiallysports.com']);
const canProxy = url => {
  try {
    return PROXY_IMAGE_HOSTS.has(new URL(url).hostname);
  } catch (error) {
    return false;
  }
};

// ─── Templates and their limits ────────────────────────────────────────────
// Limits keep every generated line inside what the template lays out well.
const TEMPLATES = {
  cover: {
    label: 'Cover Image',
    use: 'Headline post: 1-4 short pill lines over a photo. Best for news, milestones, announcements.',
    photo: true,
    shape: '{"pills": ["2-20 chars", "... 1 to 4 lines"]}',
  },
  quote: {
    label: 'Quote',
    use: 'A short, punchy quote split over 1-3 lines of 1-3 words each.',
    photo: true,
    shape: '{"lines": ["max 18 chars", "... 1 to 3 lines"]}',
  },
  'long-quote': {
    label: 'Long Quote',
    use: 'A full quote of one or two sentences.',
    photo: true,
    shape: '{"text": "20-220 chars, the quote only, no quotation marks"}',
  },
  'double-entity-quote': {
    label: 'Two-Person Quote',
    use: 'Two people quoted against each other (rivalry, debate, reaction).',
    photo: false,
    shape: '{"a": {"quote": "4-48 chars", "name": "2-26 chars", "context": "0-60 chars"}, "b": {same as a}}',
  },
  'stats-single-ent': {
    label: 'Player Stats',
    use: 'One player or team: a headline plus exactly 3 big numbers.',
    photo: true,
    shape: '{"headline": "2-22 chars", "stats": [{"value": "1-7 chars", "label": "1-8 chars"}, exactly 3]}',
  },
  'listicle-type-1': {
    label: 'Rankings Table',
    use: 'A ranked TABLE: a title plus 3-10 rows, each a name and two short values (e.g. QB | Coach | Seasons, Team | Record | Win %). Use for any top-N, record or ranking with columns.',
    photo: false,
    shape: '{"title": "max 60 chars; use one \\n to split into two lines of max 30", "entityHeader": "max 14", "metric1Header": "max 14", "metric2Header": "max 14", "rows": [{"rank": "1", "entity": "max 26 chars", "metric1": "max 14", "metric2": "max 14", "team": "the team that row achieved it with, full name (e.g. New England Patriots); empty only if truly unknown"}] (3-10 rows, in rank order)}',
  },
  'listicle-type-2': {
    label: 'Ranked List',
    use: 'A ranked LIST of people or teams: a title plus 3-10 rows, each a name and one subtitle (their team or one fact). Use for top-N lists without number columns.',
    photo: false,
    shape: '{"title": "max 60 chars; use one \\n to split into two lines of max 30", "rows": [{"rank": "1", "entity": "max 26 chars", "subtitle": "max 28 chars", "team": "the team that row achieved it with, full name (e.g. New England Patriots); empty only if truly unknown"}] (3-10 rows, in rank order)}',
  },
  'stats-double-ent': {
    label: 'Head-to-Head Stats',
    use: 'Two players compared: a headline plus exactly 4 stats each, same labels in the same order.',
    photo: false,
    shape: '{"headline": "2-30 chars", "a": {"name": "2-24 chars", "stats": [4 x {"value","label"}]}, "b": {same as a}}',
  },
};

const clean = value => String(value ?? '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#8217;|&rsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
  .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '-')
  // Unicode hyphens/dashes (e.g. the non-breaking hyphen AI models emit) may be
  // missing from the post fonts: use a plain hyphen.
  .replace(/[‐-―−]/g, '-')
  .replace(/[  ]/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#\d+;/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const within = (value, min, max) => {
  const text = clean(value);
  return text.length >= min && text.length <= max ? text : null;
};

function readStats(list, count) {
  if (!Array.isArray(list) || list.length !== count) return null;
  const stats = list.map(stat => ({ value: within(stat?.value, 1, 7), label: within(stat?.label, 1, 8) }));
  return stats.every(stat => stat.value && stat.label) ? stats : null;
}

const statLine = stat => `${stat.value} | ${stat.label}`;

// Quote templates show no speaker, so the words must be the subject's own.
// "He done stacked his team" (he/his, no I/we) is someone talking ABOUT them.
const readsAsAbout = text => /\b(?:he|she|him|his|her|hers)\b/i.test(text) && !/\b(?:i|i'm|i've|i'll|me|my|we|we're|our|us)\b/i.test(text);
const QUOTE_ABOUT_ERROR = 'quote reads as words about the person (he/his), not by them; quote templates show no speaker, so use the Two-Person Quote or drop it';

// Returns { lines, fields } for a valid spec, or { error } explaining why not.
function checkFields(postType, fields = {}) {
  switch (postType) {
    case 'cover': {
      const pills = Array.isArray(fields.pills) ? fields.pills.map(p => within(p, 2, 20)) : [];
      if (!pills.length || pills.length > 4 || pills.some(p => !p)) return { error: 'cover needs 1-4 pills of 2-20 chars' };
      return { lines: pills, fields: { pills } };
    }
    case 'quote': {
      const lines = Array.isArray(fields.lines) ? fields.lines.map(l => within(l, 1, 18)) : [];
      if (!lines.length || lines.length > 3 || lines.some(l => !l)) return { error: 'quote needs 1-3 lines of max 18 chars' };
      if (readsAsAbout(lines.join(' '))) return { error: QUOTE_ABOUT_ERROR };
      return { lines, fields: { lines } };
    }
    case 'long-quote': {
      const text = within(String(fields.text || '').replace(/^["“]|["”]$/g, ''), 20, 220);
      if (!text) return { error: 'long quote needs 20-220 chars' };
      if (readsAsAbout(text)) return { error: QUOTE_ABOUT_ERROR };
      return { lines: [text], fields: { text } };
    }
    case 'double-entity-quote': {
      const side = s => ({ quote: within(s?.quote, 4, 48), name: within(s?.name, 2, 26), context: within(s?.context ?? '', 0, 60) ?? null });
      const a = side(fields.a);
      const b = side(fields.b);
      if (![a, b].every(s => s.quote && s.name && s.context !== null)) return { error: 'two-person quote needs a quote and name for each side' };
      return { lines: [a.quote, a.name, a.context, b.quote, b.name, b.context], fields: { a, b } };
    }
    case 'stats-single-ent': {
      const headline = within(fields.headline, 2, 22);
      const stats = readStats(fields.stats, 3);
      if (!headline || !stats) return { error: 'player stats needs a headline and exactly 3 stats' };
      return { lines: [headline, ...stats.map(statLine)], fields: { headline, stats } };
    }
    case 'stats-double-ent': {
      const headline = within(fields.headline, 2, 30);
      const side = s => ({ name: within(s?.name, 2, 24), stats: readStats(s?.stats, 4) });
      const a = side(fields.a);
      const b = side(fields.b);
      if (!headline || ![a, b].every(s => s.name && s.stats)) return { error: 'head-to-head needs a headline and 2 players with 4 stats each' };
      return {
        lines: [headline, a.name, ...a.stats.map(statLine), b.name, ...b.stats.map(statLine)],
        fields: { headline, a, b },
      };
    }
    case 'listicle-type-1':
    case 'listicle-type-2': {
      const table = postType === 'listicle-type-1';
      // A one-line title that is too long is split at a word break (same words).
      const rawTitle = String(fields.title || '').split(/\n|\\n/).map(line => clean(line)).filter(Boolean);
      const titleSource = rawTitle.length === 1 && rawTitle[0].length > 30 ? chunkWords(rawTitle[0], 30, 2) : rawTitle;
      const titleLines = (titleSource.length ? titleSource : ['']).map(line => within(line, 1, 30)).slice(0, 3);
      if (!titleLines.length || titleLines.length > 2 || titleLines.some(line => !line)) return { error: `${postType} title needs 1-2 lines of max 30 chars` };
      const rows = Array.isArray(fields.rows) ? fields.rows.map((row, index) => ({
        rank: within(row?.rank ?? index + 1, 1, 3),
        entity: within(row?.entity, 1, 26),
        ...(table
          ? { metric1: within(row?.metric1, 1, 14), metric2: within(row?.metric2, 1, 14) }
          : { subtitle: within(row?.subtitle ?? '', 0, 28) }),
        team: within(row?.team ?? '', 0, 40) || '',
      })) : [];
      if (rows.length < 3 || rows.length > 10) return { error: `${postType} needs 3-10 rows` };
      const badRow = rows.findIndex(row => !row.rank || !row.entity || (table ? !row.metric1 || !row.metric2 : row.subtitle === null));
      if (badRow >= 0) return { error: `${postType} row ${badRow + 1} needs rank, entity (max 26 chars) and ${table ? 'two values (max 14 chars)' : 'a subtitle (max 28 chars)'}` };
      const headers = table ? {
        entityHeader: within(fields.entityHeader, 1, 14),
        metric1Header: within(fields.metric1Header, 1, 14),
        metric2Header: within(fields.metric2Header, 1, 14),
      } : {};
      if (table && Object.values(headers).some(value => !value)) return { error: 'listicle-type-1 needs three headers of max 14 chars' };
      const listicle = { title: titleLines.join('\n'), ...headers, rows };
      return { lines: [], fields: listicle, listicle };
    }
    default:
      return { error: `unsupported post type "${postType}"` };
  }
}

function isEsUrl(value) {
  try {
    const host = new URL(value).hostname;
    return host === 'essentiallysports.com' || host.endsWith('.essentiallysports.com');
  } catch (error) {
    return false;
  }
}

// A background scene for the optional AI image ("Scene image" button): places
// and objects only. Every word with a capital letter (names, teams, leagues,
// brands) is dropped, so an image is never asked for a real person or a logo.
function sceneText(value) {
  const text = clean(value).replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
  const words = text.split(' ').filter(word => word && !/[A-Z]/.test(word) && !/\d{2,}/.test(word));
  const scene = words.join(' ').replace(/[^a-z0-9 ,'-]/g, '').replace(/\s+/g, ' ').trim();
  return scene.length >= 8 ? scene.slice(0, 140) : '';
}

function checkSpec(raw, index, allowedTypes) {
  const postType = String(raw?.postType || '').trim();
  if (!TEMPLATES[postType]) return { error: `design ${index + 1}: unsupported post type "${postType}"` };
  if (allowedTypes.length && !allowedTypes.includes(postType)) return { error: `design ${index + 1}: format not requested` };
  const checked = checkFields(postType, raw.fields || raw);
  if (checked.error) return { error: `design ${index + 1}: ${checked.error}` };
  return {
    spec: {
      id: `gen-${Date.now().toString(36)}-${index}`,
      postType,
      label: TEMPLATES[postType].label,
      title: within(raw.title, 1, 80) || (checked.lines[0] || checked.listicle?.title.replace(/\n/g, ' ') || '').slice(0, 80),
      sport: within(raw.sport, 2, 20) || '',
      team: within(raw.team, 2, 40) || '',
      fields: checked.fields,
      lines: checked.lines,
      listicle: checked.listicle || null,
      photoQuery: TEMPLATES[postType].photo ? (within(raw.photoQuery, 2, 80) || '') : '',
      scene: TEMPLATES[postType].photo ? sceneText(raw.scene) : '',
      photo: null,
      why: within(raw.why, 1, 220) || '',
      sources: (Array.isArray(raw.sources) ? raw.sources : [])
        .map(source => (typeof source === 'string' ? { url: source, title: '' } : source))
        .filter(source => isEsUrl(source?.url))
        .slice(0, 3)
        .map(source => ({ url: source.url, title: clean(source.title).slice(0, 120) })),
    },
  };
}

// ─── ES MCP tool discovery ─────────────────────────────────────────────────
const ROLE_PATTERNS = {
  images: /search[\w-]*images?|images?[\w-]*search/i,
  trending: /trend|popular|top[\s_-]?stor|hot[\s_-]?topic/i,
  stats: /stats?(?:$|_)|score|standing|player[\s_-]?(?:data|info)/i,
  articles: /article|stor(?:y|ies)|news|post|content/i,
  think: /generat|write|compose|draft|summari[sz]|intelligen|ask|answer|chat|complet|reason|copy/i,
};

// The real ES MCP tools we know how to call well come first.
const PREFERRED_TOOLS = { images: 'search_images', articles: 'query_articles' };

// Roles come from tool NAMES only: descriptions are too broad (e.g. an
// analytics tool that "answers questions" is not a writer).
function classifyTools(tools) {
  const named = tools.map(tool => ({ name: String(tool?.name || ''), schema: tool?.inputSchema || {} })).filter(t => t.name);
  const pick = role => {
    const override = TOOL_OVERRIDES[role];
    if (override) return named.find(t => t.name === override) || null;
    const preferred = named.find(t => t.name === PREFERRED_TOOLS[role]);
    if (preferred) return preferred;
    return named.find(t => ROLE_PATTERNS[role].test(t.name) && (role === 'images' || !ROLE_PATTERNS.images.test(t.name))) || null;
  };
  return { images: pick('images'), articles: pick('articles'), stats: pick('stats'), trending: pick('trending'), think: pick('think') };
}

const TEXT_KEYS = ['query', 'q', 'prompt', 'question', 'brief', 'input', 'text', 'message', 'topic', 'keyword', 'keywords', 'search'];

// Fill a tool's main text argument (from its JSON schema) plus a small limit.
function buildArgs(tool, text, extra = {}) {
  const props = tool.schema?.properties || {};
  const keys = Object.keys(props);
  const textKey = TEXT_KEYS.find(key => keys.includes(key) && (props[key]?.type || 'string') === 'string')
    || keys.find(key => props[key]?.type === 'string');
  const args = { ...extra };
  if (textKey) args[textKey] = text;
  ['per_page', 'limit', 'count', 'max_results', 'top_k', 'size'].forEach(key => {
    if (keys.includes(key) && args[key] == null) args[key] = 5;
  });
  const required = Array.isArray(tool.schema?.required) ? tool.schema.required : [];
  return required.every(key => args[key] != null) ? args : null;
}

function resultText(result) {
  if (!result) return '';
  const parts = [];
  (Array.isArray(result.content) ? result.content : []).forEach(item => {
    if (item?.type === 'text' && item.text) parts.push(item.text);
  });
  if (result.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  if (!parts.length) parts.push(typeof result === 'string' ? result : JSON.stringify(result));
  return parts.join('\n').slice(0, 7000);
}

function urlsIn(text) {
  return [...new Set(String(text).match(/https?:\/\/[^\s"'<>)\]]+/g) || [])].filter(isEsUrl).slice(0, 8);
}

// ─── Research ──────────────────────────────────────────────────────────────
// Also drops instruction words ("make a post", "happy birthday") so searches use the name.
const STOP_WORDS = new Set(('a an and are as at be but by for from has have he her his in is it its make me of on or our post she so that the their them they this to us was we were what when who will with after before about says said just '
  + 'create design graphic cover quote stats stat posts happy birthday congrats congratulations need want please do some random player team').split(' '));

// WordPress search matches every word, so a whole sentence finds nothing.
// Search with the names (capitalised runs) or the first few key words.
function keyTerms(text) {
  const plain = clean(text).replace(/["“”][^"“”]*["“”]/g, ' ').replace(/\d[\d,.]*\+?%?(?:\s+[A-Za-z]{1,8}\b)?/g, ' ');
  const names = plain.match(/(?:[A-Z][a-zA-Z'.-]+\s+){1,3}[A-Z][a-zA-Z'.-]+/g);
  if (names) return names[0].trim();
  return plain.toLowerCase().split(/[^a-z0-9'-]+/).filter(word => word.length > 2 && !STOP_WORDS.has(word)).slice(0, 3).join(' ');
}

// The word that identifies who a text is about: a name's surname ("Patrick
// Mahomes Chiefs" -> "mahomes"), else the first key word ("lakers losing streak").
function mainWord(terms) {
  const words = String(terms || '').split(' ').filter(word => word.length > 2);
  const isName = words.length > 1 && /^[A-Z]/.test(words[0]) && /^[A-Z]/.test(words[1]);
  return (isName ? words[1] : words[0] || '').toLowerCase();
}

// ES search is slow when uncached (~15s), so: one search, and a shorter retry
// only when the first one came back empty quickly.
async function searchEsArticles(query) {
  const started = Date.now();
  const found = await searchEsArticlesOnce(query).catch(() => []);
  const shorter = String(query || '').split(' ').slice(0, 2).join(' ');
  if (found.length || shorter === query || Date.now() - started > 8000) return found;
  return searchEsArticlesOnce(shorter).catch(() => []);
}

async function searchEsArticlesOnce(query, timeoutMs = 20000) {
  if (!query) return [];
  const url = new URL(`${ES_WP_API}/posts`);
  url.searchParams.set('search', query);
  url.searchParams.set('per_page', '5');
  url.searchParams.set('_fields', 'id,date,link,title,excerpt,yoast_head_json.og_image');
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ES-Designer/1.0 (+https://www.essentiallysports.com/)', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) return [];
  return data.map(post => ({
    title: clean(post?.title?.rendered),
    url: post?.link || '',
    date: String(post?.date || '').slice(0, 10),
    excerpt: clean(post?.excerpt?.rendered).slice(0, 400),
    image: String(post?.yoast_head_json?.og_image?.[0]?.url || ''),
  })).filter(article => article.title && isEsUrl(article.url));
}

// ─── Fast research: ES tags ────────────────────────────────────────────────
// Every ES story is tagged with the people and teams in it. A tag lookup plus
// "posts with that tag" takes ~3s, against ~15s for a full-text search, and
// finds stories actually about the person (newest first).
const NAME_STOP = new Set(('a an the and or but of in on at to for with from by as is are was were be been can could will would should does do did has have had not no yes why how what when where who which this that these those it its his her their our my your '
  + 'after before just new big top best worst make create post headline story context sport breaking report reports says said fans season game games week today tonight again still now here there anyone everyone nobody '
  + 'stop stops win wins won lose loses lost beat beats over vs versus against i we he she they you if all every more most first last next one two three back off out up down into than then').split(' '));

// Likely names in a brief, most specific first: runs of capitalised words
// ("Caitlin Clark", "Indiana Fever"), then single names ("Lakers"). Labels
// from Trend Design ("Headline:", "Story:", "Sport: NBA") are skipped.
function nameCandidates(brief) {
  const multi = [];
  const single = [];
  // A Title Case headline makes every word look like a name: its words come
  // last, one by one ("Are The Lakers Already Cooked?" -> "Lakers").
  const late = [];
  String(brief || '').split('\n').forEach(rawLine => {
    if (/^\s*sport\s*:/i.test(rawLine)) return;
    const headline = /^\s*headline\s*:/i.test(rawLine);
    const line = rawLine.replace(/^\s*(?:headline|story|context)\s*:\s*/i, '').replace(/["“”][^"“”]*["“”]/g, ' , ');
    let run = [];
    const flush = () => {
      if (headline) late.push(...run.filter(word => word.length >= 4));
      else if (run.length >= 2) multi.push(run.slice(0, 3).join(' '));
      else if (run.length === 1 && run[0].length >= 4) single.push(run[0]);
      run = [];
    };
    line.split(/\s+/).forEach(token => {
      const word = token.replace(/(?:['’]s|['’])$/i, '').replace(/^[^A-Za-z]+|[^A-Za-z.'’-]+$/g, '');
      const breaks = /[,.;:!?()]$/.test(token) && !/^[A-Z]\.$/.test(token);
      const isName = /^[A-Z][a-zA-Z.'’-]*$/.test(word) && !NAME_STOP.has(word.toLowerCase()) && !/^[A-Z]{2,4}$/.test(word);
      if (isName) run.push(word); else flush();
      if (breaks) flush();
    });
    flush();
  });
  if (!multi.length && !single.length && !late.length) {
    const words = keyTerms(brief).split(' ').filter(word => word.length > 2);
    if (words.length >= 2) multi.push(words.slice(0, 2).join(' '));
    single.push(...words.slice(0, 2));
  }
  return [...new Set([...multi, ...single, ...late])].slice(0, 4);
}

const normName = text => clean(text).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const WP_HEADERS = { 'User-Agent': 'ES-Designer/1.0 (+https://www.essentiallysports.com/)', Accept: 'application/json' };

// The best ES tag for one candidate name: an exact name, or a team whose
// full name ends with it ("Lakers" -> "Los Angeles Lakers"); most used wins.
async function esTagFor(candidate) {
  const url = new URL(`${ES_WP_API}/tags`);
  url.searchParams.set('search', candidate);
  url.searchParams.set('orderby', 'count');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '6');
  url.searchParams.set('_fields', 'id,name,count');
  const response = await fetch(url, { headers: WP_HEADERS, signal: AbortSignal.timeout(6000) });
  const tags = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(tags)) return null;
  const want = normName(candidate);
  const match = tags.filter(tag => Number(tag?.count) >= 3).find(tag => {
    const name = normName(tag.name);
    return name === want || name.endsWith(` ${want}`) || (want.endsWith(` ${name}`) && name.includes(' '));
  });
  return match ? { id: match.id, name: clean(match.name), count: Number(match.count) } : null;
}

const toArticle = post => ({
  title: clean(post?.title?.rendered),
  url: post?.link || '',
  date: String(post?.date || '').slice(0, 10),
  excerpt: clean(post?.excerpt?.rendered).slice(0, 400),
  image: String(post?.yoast_head_json?.og_image?.[0]?.url || ''),
});

async function esPostsByTags(ids) {
  if (!ids.length) return [];
  const url = new URL(`${ES_WP_API}/posts`);
  url.searchParams.set('tags', ids.join(','));
  url.searchParams.set('per_page', '6');
  url.searchParams.set('_fields', 'id,date,link,title,excerpt,yoast_head_json.og_image');
  const response = await fetch(url, { headers: WP_HEADERS, signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) return [];
  return data.map(toArticle).filter(article => article.title && isEsUrl(article.url));
}

// Research results are reused for 10 minutes (Retry, the same brief again).
const COVERAGE_CACHE = new Map();
const COVERAGE_TTL_MS = 10 * 60 * 1000;

// ES coverage for a brief: tagged stories (fast) about up to two people or
// teams, else the slow full-text search. Returns { articles, tags }.
async function esCoverage(brief) {
  const candidates = nameCandidates(brief);
  const key = candidates.join('|') || keyTerms(brief);
  const hit = COVERAGE_CACHE.get(key);
  if (hit && Date.now() - hit.at < COVERAGE_TTL_MS) return hit.value;
  const found = await Promise.all(candidates.map(name => esTagFor(name).catch(() => null)));
  const tags = [];
  found.forEach(tag => {
    if (tag && !tags.some(t => t.id === tag.id) && tags.length < 2) tags.push(tag);
  });
  let articles = await esPostsByTags(tags.map(tag => tag.id)).catch(() => []);
  if (!articles.length) articles = await searchEsArticles(keyTerms(brief)).catch(() => []);
  const value = { articles, tags };
  if (articles.length) {
    if (COVERAGE_CACHE.size > 100) COVERAGE_CACHE.delete(COVERAGE_CACHE.keys().next().value);
    COVERAGE_CACHE.set(key, { at: Date.now(), value });
  }
  return value;
}

function imageUrlsFromMcp(text) {
  const urls = String(text).match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  const s3 = [...String(text).matchAll(/s3:\/\/([^/\s"']+)\/([^\s"'<>)]+)/g)]
    .filter(match => match[1] === ES_IMAGE_BUCKET)
    .map(match => `https://${match[1]}.s3.amazonaws.com/${match[2]}`);
  return [...urls, ...s3].filter(url => {
    try {
      const host = new URL(url).hostname;
      return /\.(jpe?g|png|webp)(\?|$)/i.test(url) && (PROXY_IMAGE_HOSTS.has(host) || (host.endsWith('.amazonaws.com') && url.includes(ES_IMAGE_BUCKET)));
    } catch (error) {
      return false;
    }
  });
}

const proxied = url => `/api/es-image-search?image=${encodeURIComponent(url)}`;

// ES agency images via MCP first, else the lead image of the newest ES story
// about the same person (from research when possible, saving a slow search).
async function findPhoto(query, mcp, tools, articles = []) {
  if (!query) return null;
  try {
    if (mcp && tools.images) {
      const args = buildArgs(tools.images, query, { type: 'agency' }) || buildArgs(tools.images, query);
      if (args) {
        const url = imageUrlsFromMcp(resultText(await mcp.callTool(tools.images.name, args, { timeoutMs: 8000 })))[0];
        if (url) return { title: query, sourceUrl: url, url: proxied(url) };
      }
    }
    const terms = keyTerms(query) || query;
    const surname = mainWord(terms);
    const known = articles.find(a => canProxy(a.image) && surname && `${a.title} ${a.excerpt}`.toLowerCase().includes(surname));
    const article = known || (await esCoverage(query).catch(() => ({ articles: [] }))).articles.find(a => canProxy(a.image));
    return article ? { title: article.title, sourceUrl: article.image, url: proxied(article.image) } : null;
  } catch (error) {
    return null;
  }
}

// ES MCP query_articles returns markdown records like:
//   **[Title](https://www.essentiallysports.com/...)**
//   Sport: NBA | Writer: ... | Published: 17:30 | Entity: Lebron James,76Ers | Type: ...
function parseEsArticles(text) {
  const records = [];
  const re = /\*\*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\*\*\s*\n([^\n]*)/g;
  let match;
  while ((match = re.exec(String(text)))) {
    const meta = match[3];
    const field = name => (meta.match(new RegExp(`${name}:\\s*([^|]+)`)) || [])[1]?.trim() || '';
    const sport = field('Sport').split('/')[0].trim();
    const entities = field('Entity');
    records.push({
      title: clean(match[1]),
      url: match[2],
      date: '',
      sport,
      excerpt: [sport && `Sport: ${sport}.`, entities && `Tagged: ${entities}.`].filter(Boolean).join(' '),
      image: '',
    });
  }
  return records.filter(article => isEsUrl(article.url));
}

// Recent ES coverage about the person, ranked by readership (keyword = title search).
async function queryEsArticles(mcp, tool, name) {
  if (!name) return [];
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const ask = args => mcp.callTool(tool.name, { keyword: name, limit: 8, order_by: 'total_pageviews', order_dir: 'desc', ...args }, { timeoutMs: 12000 })
    .then(result => parseEsArticles(resultText(result)));
  const recent = await ask({ publish_date_start: since });
  return recent.length ? recent : ask({});
}

async function research(brief, mcp, tools, notes) {
  const out = { articles: [], tags: [], digest: '', sources: [] };
  const sections = [];
  const name = keyTerms(brief).split(' ').slice(0, 2).join(' ');
  const tryTool = async (role, label) => {
    if (!mcp || !tools[role]) return;
    if (role === 'articles' && tools.articles.name === 'query_articles') {
      try {
        const articles = await queryEsArticles(mcp, tools.articles, name);
        if (articles.length) {
          out.mcpArticles = articles;
          sections.push(`## Recent ES articles about ${name} (ES MCP, most read first)\n${articles.map(a => `- ${a.title} ${a.url}\n  ${a.excerpt}`).join('\n')}`);
          out.sources.push(...articles.map(a => a.url));
        }
      } catch (error) {
        notes.push(`ES articles lookup failed: ${String(error.message || error).slice(0, 120)}`);
      }
      return;
    }
    const args = buildArgs(tools[role], brief);
    if (!args) return;
    try {
      const text = resultText(await mcp.callTool(tools[role].name, args, { timeoutMs: 9000 }));
      if (text) {
        sections.push(`## ${label} (ES MCP: ${tools[role].name})\n${text.slice(0, 3500)}`);
        out.sources.push(...urlsIn(text));
      }
    } catch (error) {
      notes.push(`${label} lookup failed: ${String(error.message || error).slice(0, 120)}`);
    }
  };
  await Promise.all([
    tryTool('articles', 'ES articles'),
    tryTool('stats', 'Stats'),
    // ES stories tagged with the people in the brief (fast). Skipped when
    // ES MCP's query_articles supplies tagged articles instead.
    (mcp && tools.articles?.name === 'query_articles' ? Promise.resolve({ articles: [], tags: [] }) : esCoverage(brief))
      .then(coverage => { out.articles = coverage.articles; out.tags = coverage.tags; }).catch(() => {}),
  ]);
  if (!out.mcpArticles?.length && !out.articles.length && mcp && tools.articles?.name === 'query_articles') {
    const coverage = await esCoverage(brief).catch(() => ({ articles: [], tags: [] }));
    out.articles = coverage.articles;
    out.tags = coverage.tags;
  }
  if (out.articles.length) {
    if (out.tags.length) sections.push(`ES tags (who the stories are about): ${out.tags.map(tag => tag.name).join(', ')}`);
    sections.push(`## Latest ES coverage\n${out.articles.map(a => `- ${a.title} (${a.date}) ${a.url}\n  ${a.excerpt}`).join('\n')}`);
    out.sources.push(...out.articles.map(a => a.url));
  }
  // ES MCP records (tagged with sport and teams) lead; site search adds images.
  if (out.mcpArticles?.length) {
    const seen = new Set(out.mcpArticles.map(a => a.url));
    out.articles = [...out.mcpArticles, ...out.articles.filter(a => !seen.has(a.url))];
  }
  out.sources = [...new Set(out.sources)];
  // Kept short to stay inside free-tier token limits (Groq).
  out.digest = sections.join('\n\n').slice(0, 4500);
  return out;
}

// ─── Think ─────────────────────────────────────────────────────────────────
// Hand-written model answers: the format, template choice and ES voice to copy.
// They demonstrate structure only; their facts are illustrative.
const GOLD_EXAMPLES = [
  {
    brief: 'Mahomes after the Chiefs win: "We are not done yet." 320 YDS, 3 TD, 1 INT',
    designs: [
      { postType: 'stats-single-ent', sport: 'NFL', team: 'Kansas City Chiefs', fields: { headline: 'Mahomes Delivers', stats: [{ value: '320', label: 'YDS' }, { value: '3', label: 'TD' }, { value: '1', label: 'INT' }] }, photoQuery: 'Patrick Mahomes Chiefs' },
      { postType: 'quote', sport: 'NFL', team: 'Kansas City Chiefs', fields: { lines: ['We Are Not', 'Done Yet'] }, photoQuery: 'Patrick Mahomes Chiefs' },
      { postType: 'cover', sport: 'NFL', team: 'Kansas City Chiefs', fields: { pills: ['Can Anyone', 'Stop Mahomes?'] }, photoQuery: 'Patrick Mahomes Chiefs' },
    ],
  },
  {
    brief: 'TOP 3 RUSHING YARDS THIS SEASON\nRank\nPlayer\nTeam\nYards\n1\nDerrick Henry\nRavens\n1,120\n2\nSaquon Barkley\nEagles\n1,050\n3\nJosh Jacobs\nPackers\n980',
    designs: [
      { postType: 'listicle-type-1', sport: 'NFL', team: '', fields: { title: 'Top 3 Rushing Yards\nThis Season', entityHeader: 'Player', metric1Header: 'Team', metric2Header: 'Yards', rows: [{ rank: '1', entity: 'Derrick Henry', metric1: 'Ravens', metric2: '1,120', team: 'Baltimore Ravens' }, { rank: '2', entity: 'Saquon Barkley', metric1: 'Eagles', metric2: '1,050', team: 'Philadelphia Eagles' }, { rank: '3', entity: 'Josh Jacobs', metric1: 'Packers', metric2: '980', team: 'Green Bay Packers' }] } },
    ],
  },
  {
    brief: 'make a post about the Warriors trade rumours',
    designs: [
      { postType: 'cover', sport: 'NBA', team: 'Golden State Warriors', fields: { pills: ['Are The Warriors', 'About To Blink?'] }, photoQuery: 'Stephen Curry Warriors' },
    ],
  },
];

// Lower-case letters and digits only, for comparing words regardless of
// punctuation, curly quotes or line splits.
const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()} `;

// A quote design whose words are not in the brief or the research was made up.
function fakeQuote(spec, source) {
  const quotes = spec.postType === 'quote' ? [spec.lines.join(' ')]
    : spec.postType === 'long-quote' ? [spec.lines[0]]
      : spec.postType === 'double-entity-quote' ? [spec.fields.a.quote, spec.fields.b.quote]
        : [];
  const made = quotes.find(quote => squash(quote).trim().length >= 4 && !source.includes(squash(quote)));
  return made ? `quote "${made}" is not in the brief or the ES research; quotes must be real words someone said` : '';
}

// The short follow-up for rejected designs: errors, the designs, the shapes.
function repairPrompt(brief, broken) {
  const shapes = [...new Set(broken.map(p => p.raw?.postType).filter(type => TEMPLATES[type]))]
    .map(type => `- ${type}: ${TEMPLATES[type].shape}`).join('\n');
  return [
    'Our brand checker rejected these EssentiallySports Instagram designs. Fix each so it passes, or leave it out.',
    'Keep the person\'s exact words and numbers. Quotes must be words that appear in the brief. Respect every character limit.',
    `Brief: ${brief.slice(0, 600)}`,
    `Errors:\n- ${broken.map(p => p.error).join('\n- ')}`,
    `Rejected designs:\n${JSON.stringify(broken.map(p => p.raw)).slice(0, 2500)}`,
    shapes ? `Template fields:\n${shapes}` : '',
    'Reply with JSON only: {"designs": [...]}',
  ].filter(Boolean).join('\n');
}

function goldExamplesText() {
  return GOLD_EXAMPLES.map(example => `Brief: ${example.brief.replace(/\n/g, ' / ')}\nAnswer: ${JSON.stringify({ designs: example.designs })}`).join('\n\n');
}

function buildPrompt(brief, found, allowedTypes, count, pastExamples = '', avoid = []) {
  const catalog = Object.entries(TEMPLATES)
    .filter(([type]) => !allowedTypes.length || allowedTypes.includes(type))
    .map(([type, t]) => `- ${type} (${t.label}): ${t.use}\n  fields: ${t.shape}`)
    .join('\n');
  return [
    'You are the senior social designer at EssentiallySports (ES), a US sports media brand.',
    `Plan up to ${count} distinct Instagram post designs for the brief below, each using one of our templates.`,
    'First understand the brief: who or what it is about, and what the person wants.',
    '- If the brief already contains the post text (words in quotation marks, a headline, numbers), use those exact words and numbers. You may only split them into lines and fix capitalisation.',
    '- If the brief is an instruction (e.g. "stats post on Mahomes\' last game"), write the copy yourself using ONLY facts from the ES research below.',
    'Rules:',
    '- Never invent numbers, quotes or results. If a fact is missing, choose a template that does not need it, or return fewer designs.',
    '- Quotes must be real (from the brief or the research). Quote and Long Quote show no name, so use them ONLY for words said BY the post\'s main person. Words said about them by someone else need the Two-Person Quote (which names both speakers) or no quote at all.',
    '- Player Stats and Head-to-Head are ONLY for real game or season performance numbers with standard labels (PTS, REB, AST, YDS, TD, INT, HR, RBI, AVG, G, GOALS...). Never use ages, years, dates, contract money, deficits or rankings as stats. No such numbers: skip the stats templates.',
    '- Write like ES: punchy, confident, plain American sports English. Title Case for pills and headlines. No emojis, no hashtags.',
    '- ES Covers are HOOKS, not summaries: a bold claim or a curious question in 2-8 words, e.g. "Does Patrick Mahomes Really Deserve This?", "Warriors\' $40M Gamble Just Got Worse", "Are Steelers Doomed at QB?". Never just list the facts on a Cover.',
    '- Player Stats headlines are a short reaction, not a label: e.g. "Statement Made", "No One Can Stop Her", "Mahomes Delivers".',
    '- Respect every character limit exactly; anything longer is rejected. Shorter is better.',
    '- Vary the templates when the story allows it.',
    '- Give the editor choices: whenever the brief has a real story, return at least 2 designs. When only Covers fit (no quote, no game numbers), return 3 Covers with clearly different hooks built on the brief\'s facts (a headline from the brief comes first, word for word). A different hook is an opinion or question, not a new fact.',
    '- Every design is about the brief\'s own story or moment. The ES research is for facts, the current team and context; never switch to a different story from the research (a book, an injury, a trade) unless the brief is only a name or a topic.',
    '- If the brief is a ranking, table or top-N list (even pasted with one value per line), make ONE listicle-type-1 (Rankings Table, when rows have number columns) or listicle-type-2 (Ranked List) design with all rows in order, using the exact names and values. Never split a list into one post per row. You may add one Cover with the headline as a second option. Fill every row\'s "team" with the team that person or pair did it with (e.g. Tom Brady & Bill Belichick: New England Patriots); each row is coloured in its team\'s brand colours.',
    '- Work out the person\'s CURRENT team and league from the ES research (newest coverage wins; players change teams). sport is the league: NFL, NBA, WNBA, MLB, CFB (college football), CBB Men, CBB Women, Tennis. team is that person\'s own team, full name, e.g. "Kansas City Chiefs" (never the opponent). Our templates use the team\'s brand colours, so get the team right.',
    '- A team named in the brief (e.g. "Dream duo", "after the Chiefs win") is the team; it beats anything you remember, since players move.',
    '- Every design about the same person uses the same CURRENT team; a duo or list from one team uses that team on every design. If unsure of a team, leave it empty rather than guess an old team.',
    '- What the brief states counts as true: "a post about the Lakers losing streak" lets you write Cover hooks about that streak (no invented numbers). Only if the brief gives you nothing true to say (no story, no facts, no quote, nothing in the ES research, e.g. "a stats post on a random player"), return {"designs": []}.',
    '- photoQuery is 2-5 words: the person plus their current team, e.g. "Patrick Mahomes Chiefs".',
    '- scene (photo templates only) is 5-14 lowercase words for an optional AI background image: a place or objects that fit the story, with NO people, faces, names, teams, logos, jerseys or text, e.g. "empty football stadium at night under bright floodlights".',
    '- A brief from Trend Design has labelled lines. "Headline:" is the headline the editor picked: put it word for word on a Cover (split into pills of max 20 chars; fix capitalisation only). "Story:" and "Context:" are the news to work from. "Sport:" is the league.',
    '',
    `Templates:\n${catalog}`,
    '',
    `Model answers (copy the format, template choice and voice; not the facts):\n${goldExamplesText()}`,
    '',
    ...(pastExamples ? [`Real ES posts on similar topics (style and template choice only; never reuse their facts, names or numbers):\n${pastExamples}`, ''] : []),
    `Brief: ${brief}`,
    ...(avoid.length ? ['', `The editor asked for a fresh take: do not reuse these lines: ${avoid.map(line => JSON.stringify(line)).join(', ')}`] : []),
    '',
    `ES research:\n${found.digest || '(no ES coverage found)'}`,
    '',
    'Reply with JSON only, no prose:',
    '{"designs": [{"postType": "...", "title": "short name", "sport": "...", "team": "...", "fields": {...}, "photoQuery": "...", "scene": "...", "why": "one short sentence on why this template fits", "sources": ["ES article URLs you used"]}]}',
  ].join('\n');
}

function extractJson(text) {
  const raw = String(text || '');
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  for (let end = raw.length; end > start; end -= 1) {
    const ch = raw[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try {
      return JSON.parse(raw.slice(start, end));
    } catch (error) {
      // keep shrinking
    }
  }
  return null;
}

const designsFrom = parsed => (Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.designs) ? parsed.designs : []));

async function thinkWithMcp(prompt, mcp, tool) {
  const args = buildArgs(tool, prompt);
  if (!args) throw new Error(`ES MCP tool ${tool.name} has no text input`);
  return designsFrom(extractJson(resultText(await mcp.callTool(tool.name, args, { timeoutMs: 25000 }))));
}

// OpenAI-compatible chat (Groq and OpenAI). Returns the raw reply text. When a
// model hits its rate limit, the provider's backup models are tried in order
// (each Groq model has its own free allowance); provider.used records which ran.
async function chat(provider, messages) {
  if (provider.name === 'gateway' && provider.fallback) {
    if (!provider.backup) throw new Error('The AI is unavailable.');
    const text = await chat(provider.backup, messages);
    provider.used = provider.backup.used;
    return text;
  }
  if (provider.name === 'gateway' && !provider.fallback) {
    try {
      const { text, model, cost } = await aiText({ tier: 'main', messages, effort: 'low', maxTokens: 6000, timeoutMs: 25000, track: provider.track });
      provider.used = model;
      provider.cost = (provider.cost || 0) + cost;
      return text;
    } catch (error) {
      // Claude failed (e.g. the weekly AI budget ran out): this and any later
      // call in the request run on Groq, reported as the brain.
      provider.fallback = isBudgetError(error) ? 'budget' : 'error';
      if (!provider.backup) throw error;
      const text = await chat(provider.backup, messages);
      provider.usedProvider = provider.backup.name;
      provider.used = provider.backup.used;
      return text;
    }
  }
  // Each model is tried in strict JSON mode, then (if the provider rejects its
  // JSON) in plain mode, which extractJson can still read.
  let lastError = null;
  for (const model of [provider.model, ...(provider.fallbacks || [])]) {
    for (const json of [true, false]) {
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          messages,
        }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await response.json().catch(() => null);
      if (response.ok) {
        provider.used = model;
        return String(data?.choices?.[0]?.message?.content || '');
      }
      lastError = new Error(data?.error?.message || `${provider.name} request failed: ${response.status}`);
      const badJson = response.status === 400 && /json/i.test(lastError.message);
      if (badJson && json) continue; // same model, plain mode
      if (response.status === 429 || badJson) break; // next model
      throw lastError; // anything else: stop
    }
  }
  throw lastError;
}

// Rule-based fallback so the flow works with no AI connected. Only uses text
// from the brief and ES articles; it never makes up numbers or quotes.
function chunkWords(text, maxChars, maxLines) {
  const lines = [];
  let line = '';
  for (const word of clean(text).split(' ')) {
    if (!word) continue;
    if (word.length > maxChars) return [];
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars) {
      line = next;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return [];
    }
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : [];
}

const titleCase = text => clean(text).replace(/\w\S*/g, word => (word.length <= 3 && /^(of|to|in|on|at|by|and|the|for|vs)$/i.test(word) ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1)))
  .replace(/^./, c => c.toUpperCase());

function guessEntity(text) {
  const match = clean(text).match(/(?:[A-Z][a-zA-Z'.-]+(?:\s+|$)){2,3}/);
  return match ? match[0].trim() : clean(text).split(' ').slice(0, 3).join(' ');
}

// ─── Tables in the brief ───────────────────────────────────────────────────
// Reads a ranking pasted from a web page (one cell per line: title, "Rank",
// headers, then rank/value/value... rows) or from a sheet (tab or | separated).
function parseTableBrief(brief) {
  const lines = String(brief || '').split('\n').map(line => line.trim()).filter(Boolean);
  const isRank = value => /^#?\d{1,2}\.?$/.test(value);
  // Sheet style: each row on one line with tabs or pipes.
  const split = lines.map(line => line.split(/\t|\s*\|\s*/).map(cell => cell.trim()).filter(Boolean));
  const rowStart = split.findIndex(cells => cells.length >= 2 && isRank(cells[0]));
  if (rowStart >= 0 && split.slice(rowStart).filter(cells => isRank(cells[0])).length >= 3) {
    const rows = split.slice(rowStart).filter(cells => isRank(cells[0]) && cells.length >= 2);
    const headerCells = rowStart > 0 && split[rowStart - 1].length >= 2 ? split[rowStart - 1] : [];
    const headers = headerCells.length === rows[0].length ? headerCells.slice(1) : headerCells.slice(-(rows[0].length - 1));
    const title = lines.slice(0, Math.max(0, rowStart - (headerCells.length ? 1 : 0))).join(' ');
    return { title, headers, rows: rows.map(cells => ({ rank: cells[0].replace(/\D/g, ''), cells: cells.slice(1) })) };
  }
  // Web-table style: one cell per line. Columns = lines from "Rank" up to the first "1".
  const rankAt = lines.findIndex(line => /^(rank|rk|#|no\.?|pos(ition)?)$/i.test(line));
  const firstRow = lines.findIndex((line, index) => index > rankAt && line === '1');
  if (rankAt < 0 || firstRow < 0) return null;
  const width = firstRow - rankAt;
  if (width < 2 || width > 4) return null;
  const headers = lines.slice(rankAt + 1, firstRow);
  const rows = [];
  for (let at = firstRow; at + width <= lines.length; at += width) {
    const cells = lines.slice(at, at + width);
    if (!isRank(cells[0])) break;
    rows.push({ rank: cells[0].replace(/\D/g, ''), cells: cells.slice(1) });
  }
  return rows.length >= 3 ? { title: lines.slice(0, rankAt).join(' '), headers, rows } : null;
}

// Shorten a header to the template's 14 characters, keeping whole words
// ("Seasons Starting 5-0 Together" -> "Seasons").
function shortHeader(text, fallback) {
  let out = '';
  for (const word of clean(text).split(' ')) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > 14) break;
    out = next;
  }
  return out || clean(text).slice(0, 14) || fallback;
}

// Keep an all-caps title as written; otherwise Title Case it.
const tableTitle = text => (text && text === text.toUpperCase() ? clean(text) : titleCase(text || 'The Rankings'));

// The ranking as a design, using the person's exact names and values.
function tableDesign(table) {
  if (!table) return null;
  const columns = table.rows[0].cells.length;
  const titleText = tableTitle(table.title);
  const rows = table.rows.slice(0, 10);
  if (columns >= 3 || columns === 2 && rows.every(row => row.cells[1].length <= 14)) {
    const [a, b, c] = table.headers;
    return {
      postType: 'listicle-type-1',
      title: titleText,
      fields: {
        title: titleText,
        entityHeader: shortHeader(a, 'Name'),
        metric1Header: shortHeader(columns >= 3 ? b : '', columns >= 3 ? 'Value' : ' '),
        metric2Header: shortHeader(columns >= 3 ? c : b, 'Value'),
        rows: rows.map(row => ({
          rank: row.rank,
          entity: row.cells[0],
          metric1: columns >= 3 ? row.cells[1] : '-',
          metric2: columns >= 3 ? row.cells[2] : row.cells[1],
        })),
      },
      why: 'Your table, in rank order, as a Rankings Table.',
    };
  }
  return {
    postType: 'listicle-type-2',
    title: titleText,
    fields: { title: titleText, rows: rows.map(row => ({ rank: row.rank, entity: row.cells[0], subtitle: row.cells[1] || '' })) },
    why: 'Your list, in rank order, as a Ranked List.',
  };
}

function draftPlan(brief, found, allowedTypes) {
  const allow = type => !allowedTypes.length || allowedTypes.includes(type);
  // The person comes from the brief; an ES story is used only if it is about them.
  // A lower-case brief has no capitalised name to find: use its first two key words.
  const terms = keyTerms(brief);
  const photoQuery = (/[A-Z]/.test(terms) ? terms : terms.split(' ').slice(0, 2).join(' ')) || guessEntity(brief);
  const surname = mainWord(photoQuery);
  const lead = found.articles.find(a => surname && a.title.toLowerCase().includes(surname));
  const sources = lead ? [{ url: lead.url, title: lead.title }] : [];
  const designs = [];

  if (allow('cover')) {
    // Wording comes from the brief (ES stories may cover a different moment):
    // its first clause if that fits, else just the name.
    const instruction = /^(?:make|create|do|design|give|need|want|can you|please|post)\b/i.test(brief.trim());
    const pills = [instruction ? '' : brief.split(/[,.;:!?"“—\n]/)[0], photoQuery]
      .map(text => chunkWords(titleCase(text), 20, 3))
      .find(lines => lines.length) || [];
    if (pills.length) designs.push({ postType: 'cover', title: pills.join(' '), fields: { pills }, photoQuery, why: 'Your text as headline pills.', sources });
  }

  // The person writes the post: quotes come only from their text.
  const quoteSource = brief;
  const quote = (quoteSource.match(/[“"]([^”"]{8,200})[”"]/) || [])[1];
  if (quote) {
    const short = chunkWords(titleCase(quote.replace(/[.,;:]+$/, '')), 16, 3);
    if (short.length && allow('quote')) {
      designs.push({ postType: 'quote', title: quote, fields: { lines: short }, photoQuery, why: 'Your quote, split into short lines.', sources });
    } else if (allow('long-quote') && quote.length >= 20) {
      designs.push({ postType: 'long-quote', title: quote, fields: { text: quote.slice(0, 220) }, photoQuery, why: 'Your full quote.', sources });
    }
  }

  // Only real stat labels count ("1 Luka" in a ranking is not a stat).
  const STAT_LABELS = /^(PTS|REB|REBS|AST|ASTS|STL|BLK|TOV|FG|3PM|YDS|YARDS|TD|TDS|INT|INTS|REC|CAR|RUSH|SACK|SACKS|TKL|HR|RBI|AVG|ERA|SO|K|HITS|SB|GOALS|G|A|SOG|SV|SAVES|PPG|RPG|APG|MIN|MINS)$/;
  const stats = [...clean(brief).matchAll(/(\d[\d,.]*\+?%?)\s+([A-Za-z0-9]{1,8})\b/g)]
    .map(match => ({ value: match[1].slice(0, 7), label: match[2].toUpperCase().slice(0, 8) }))
    .filter(stat => STAT_LABELS.test(stat.label));
  if (allow('stats-single-ent') && stats.length >= 3) {
    designs.push({ postType: 'stats-single-ent', title: `${photoQuery} stats`, fields: { headline: chunkWords(titleCase(photoQuery), 22, 1)[0] || 'Record Alert!', stats: stats.slice(0, 3) }, photoQuery, why: 'The three numbers from your text.', sources });
  }
  return designs;
}

// ─── Handler ───────────────────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

async function discover(notes) {
  if (!isMcpConfigured()) return { mcp: null, tools: {}, toolNames: [], error: '' };
  try {
    const mcp = createSession();
    const list = await mcp.listTools();
    return { mcp, tools: classifyTools(list), toolNames: list.map(tool => tool?.name).filter(Boolean), error: '' };
  } catch (error) {
    const message = String(error.message || error).slice(0, 160);
    notes.push(`ES MCP unavailable: ${message}`);
    return { mcp: null, tools: {}, toolNames: [], error: message };
  }
}

// What is connected, so the page can explain draft mode precisely.
const connectionInfo = (tools, toolNames, error) => ({
  mcpConfigured: isMcpConfigured(),
  mcpError: error || '',
  tools: toolNames,
  roles: Object.fromEntries(['think', 'articles', 'stats', 'trending', 'images'].map(role => [role, tools[role]?.name || null])),
  openai: USE_OPENAI,
  ai: pickProvider()?.name || null,
});

// ES story URLs start with the league, e.g. /nfl-active-news-..., /nba-news-...
const URL_SPORTS = [
  [/^\/wnba-/, 'WNBA'], [/^\/nba-/, 'NBA'], [/^\/nfl-/, 'NFL'], [/^\/mlb-/, 'MLB'],
  [/^\/(?:college-football|ncaaf|cfb)-/, 'CFB'], [/^\/(?:college-basketball|ncaab|cbb)-/, 'CBB Men'],
  [/^\/tennis-/, 'Tennis'],
];
function sportFromUrl(url) {
  try {
    const pathName = new URL(url).pathname;
    return (URL_SPORTS.find(([pattern]) => pattern.test(pathName)) || [])[1] || '';
  } catch (error) {
    return '';
  }
}

// Text about the design's person, for matching the team (and its colours) in the editor.
function brandHints(spec, brief, articles) {
  const terms = keyTerms(spec.photoQuery || brief) || '';
  const surname = mainWord(terms);
  const about = surname ? articles.filter(a => `${a.title} ${a.excerpt}`.toLowerCase().includes(surname)) : [];
  const sports = about.map(a => a.sport || sportFromUrl(a.url)).filter(Boolean);
  const sport = sports.sort((a, b) => sports.filter(s => s === b).length - sports.filter(s => s === a).length)[0] || '';
  return {
    sport,
    person: surname,
    text: [brief, ...about.map(a => `${a.title}. ${a.excerpt}`)].join(' ').slice(0, 2500),
  };
}

// ─── Photos of real people ─────────────────────────────────────────────────
// Candidates come only from ES (agency images via ES MCP, and the lead images
// of ES stories tagged with the person). AI never draws a real person.
async function photoCandidates(person, mcp, tools, articles) {
  const out = [];
  const add = (sourceUrl, title) => {
    if (sourceUrl && !out.some(c => c.sourceUrl === sourceUrl) && out.length < 6) out.push({ title: clean(title || person).slice(0, 120), sourceUrl, url: proxied(sourceUrl) });
  };
  if (person && mcp && tools.images) {
    try {
      const args = buildArgs(tools.images, person, { type: 'agency' }) || buildArgs(tools.images, person);
      if (args) imageUrlsFromMcp(resultText(await mcp.callTool(tools.images.name, args, { timeoutMs: 8000 }))).slice(0, 3).forEach(url => add(url, person));
    } catch (error) { /* ES story images below */ }
  }
  articles.filter(a => canProxy(a.image)).forEach(a => add(a.image, a.title));
  return out;
}

// Claude (main tier, it can see images) picks the photo that shows the person
// best. Runs alongside the design call, so it adds no waiting. Returns the
// index of the best candidate (0 when unsure or on any failure).
const PHOTO_PICK_MAX = 5;
async function pickPhoto(person, candidates, track) {
  if (!person || candidates.length < 2 || !gatewayConfigured()) return { index: 0, cost: 0, picked: false };
  const shown = candidates.slice(0, PHOTO_PICK_MAX);
  const content = [{ type: 'text', text: `Which photo best shows ${person} for a sports Instagram post? Prefer ${person} clearly visible and recognisable (ideally alone, face visible, sharp). Avoid graphics, collages, text-heavy images and photos of other people. Reply with JSON only: {"best": <photo number, or 0 if none shows ${person}>}` }];
  shown.forEach((candidate, index) => content.push({ type: 'text', text: `Photo ${index + 1}:` }, { type: 'image', source: { type: 'url', url: candidate.sourceUrl } }));
  try {
    const { text, cost } = await aiText({ tier: 'main', messages: [{ role: 'user', content }], effort: 'low', maxTokens: 2000, timeoutMs: 15000, track: { ...track, feature: 'generate-photo-pick' } });
    const best = Number(extractJson(text)?.best);
    return { index: best >= 1 && best <= shown.length ? best - 1 : 0, cost, picked: best >= 1 && best <= shown.length };
  } catch (error) {
    return { index: 0, cost: 0, picked: false };
  }
}

const brainName = tools => {
  if (tools.think) return `es-mcp:${tools.think.name}`;
  const provider = pickProvider();
  return provider ? `${provider.name}:${provider.model}` : 'draft';
};

async function generate({ brief, formats, count, avoid, token, email }) {
  const started = Date.now();
  const notes = [];
  const allowedTypes = (Array.isArray(formats) ? formats : []).filter(type => TEMPLATES[type]);
  const want = Math.min(Math.max(parseInt(count, 10) || MAX_DESIGNS, 1), MAX_DESIGNS);
  const { mcp, tools, toolNames, error: mcpError } = await discover(notes);
  // Past team designs (background learning) load alongside the research.
  const [found, pastDesigns] = await Promise.all([research(brief, mcp, tools, notes), loadPastDesigns(token).catch(() => [])]);
  const pastExamples = formatExamples(selectExamples(brief, pastDesigns, allowedTypes));
  const researchMs = Date.now() - started;
  // The main person (or team): the top ES tag, else the names in the brief.
  const person = found.tags?.[0]?.name || nameCandidates(brief)[0] || '';
  const wantsPhoto = !allowedTypes.length || allowedTypes.some(type => TEMPLATES[type].photo);
  // Photo candidates and Claude's pick run while the designs are written.
  const photoTrack = { email, token };
  const photoWork = wantsPhoto
    ? photoCandidates(person, mcp, tools, found.articles)
      .then(async candidates => ({ candidates, pick: await pickPhoto(person, candidates, photoTrack) }))
      .catch(() => ({ candidates: [], pick: { index: 0, cost: 0, picked: false } }))
    : Promise.resolve({ candidates: [], pick: { index: 0, cost: 0, picked: false } });

  let brain = brainName(tools);
  const provider = tools.think ? null : pickProvider();
  if (provider) provider.track = { feature: 'generate', email, token };
  let aiFailed = false;
  const avoidLines = (Array.isArray(avoid) ? avoid : []).map(line => clean(line).slice(0, 120)).filter(Boolean).slice(0, 12);
  const prompt = buildPrompt(brief, found, allowedTypes, want, pastExamples, avoidLines);
  const designs = [];
  const seen = new Set();
  // Quotes must be real: their words have to appear in the brief or the ES research.
  const sourceText = squash(`${brief} ${found.digest}`);
  const keepValid = (list, offset = 0) => {
    const problems = [];
    list.forEach((raw, index) => {
      const checked = checkSpec(raw, index + offset, allowedTypes);
      const fake = checked.error ? '' : fakeQuote(checked.spec, sourceText);
      if (checked.error || fake) return problems.push({ error: checked.error || `design ${index + offset + 1}: ${fake}`, raw });
      const key = `${checked.spec.postType}|${checked.spec.lines.join('|')}`;
      if (!seen.has(key) && designs.length < want) {
        seen.add(key);
        designs.push(checked.spec);
      }
    });
    return problems;
  };
  const fixable = problem => !/format not requested|unsupported post type/.test(problem.error);
  const skipped = problems => problems.map(p => `Skipped ${p.error}`);
  try {
    if (tools.think) {
      notes.push(...skipped(keepValid(await thinkWithMcp(prompt, mcp, tools.think))));
    } else if (provider) {
      const reply = await chat(provider, [{ role: 'user', content: prompt }]);
      const problems = keepValid(designsFrom(extractJson(reply)));
      notes.push(...skipped(problems.filter(p => !fixable(p))));
      const broken = problems.filter(fixable);
      // One small repair round: only the broken designs and the rules they
      // broke (not the whole research again), to stay inside free-tier limits.
      if (broken.length && designs.length < want) {
        const fixed = keepValid(designsFrom(extractJson(await chat(provider, [{ role: 'user', content: repairPrompt(brief, broken) }]))), 10);
        notes.push(...skipped(fixed));
      }
    }
  } catch (error) {
    aiFailed = true;
    notes.push(`AI step failed, using your text with simple rules: ${String(error.message || error).slice(0, 160)}`);
  }
  // A table in the brief always becomes a ranking design, first, even if the
  // AI missed it (free models are not consistent about this).
  const table = tableDesign(parseTableBrief(brief));
  const isRanking = spec => spec.postType === 'listicle-type-1' || spec.postType === 'listicle-type-2';
  if (table && (!allowedTypes.length || allowedTypes.includes(table.postType)) && !designs.some(isRanking)) {
    const before = designs.length;
    const problems = keepValid([table], 20);
    if (designs.length > before) designs.unshift(designs.pop());
    else if (designs.length >= want && !problems.length) {
      designs.pop();
      keepValid([table], 21);
      designs.unshift(designs.pop());
    }
    notes.push(...skipped(problems));
  } else if (designs.some(isRanking)) {
    designs.unshift(...designs.splice(designs.findIndex(isRanking), 1));
  }
  // Rules fallback (the person's own words only) when no AI could run, or the
  // AI returned nothing for a brief that has real content. An instruction with
  // nothing true to say ("make a stats post on a random player") gets nothing.
  const isInstruction = /^(?:make|create|do|design|give|need|want|can you|please|post)\b/i.test(brief.trim());
  if (!designs.length && (brain === 'draft' || aiFailed || !isInstruction)) {
    if (brain !== 'draft') notes.push('The AI was unavailable; built them from your text instead.');
    brain = 'draft';
    notes.push(...skipped(keepValid(draftPlan(brief, found, allowedTypes))));
  }
  const aiMs = Date.now() - started - researchMs;
  const { candidates, pick } = await photoWork;
  const ordered = candidates.length ? [candidates[pick.index], ...candidates.filter((_, i) => i !== pick.index)] : [];
  const personWord = mainWord(keyTerms(person) || person);
  await Promise.all(designs.map(async spec => {
    // Designs about the main person use the picked ES photo; anyone else
    // (e.g. the other side of a rivalry) gets their own ES photo.
    const aboutPerson = !spec.photoQuery || (personWord && squash(spec.photoQuery).includes(` ${personWord} `));
    spec.photo = !TEMPLATES[spec.postType].photo ? null
      : (aboutPerson && ordered[0]) ? { ...ordered[0] } : await findPhoto(spec.photoQuery, mcp, tools, found.articles);
    spec.photos = TEMPLATES[spec.postType].photo ? (aboutPerson ? ordered : [spec.photo, ...ordered].filter(Boolean)).slice(0, 6) : [];
    spec.hints = brandHints(spec, brief, found.articles);
    spec.brief = brief.slice(0, 600);
    if (!spec.sport) spec.sport = spec.hints.sport;
    if (!spec.sources.length && found.sources[0]) spec.sources = [{ url: found.sources[0], title: found.articles.find(a => a.url === found.sources[0])?.title || '' }];
  }));

  return {
    brain: brain !== 'draft' && provider?.used ? `${provider.usedProvider || provider.name}:${provider.used}` : brain,
    designs,
    research: { articles: found.articles.map(({ title, url, date }) => ({ title, url, date })) },
    connection: connectionInfo(tools, toolNames, mcpError),
    ai: { fallback: provider?.fallback || '', failed: aiFailed },
    photo: { person, candidates: candidates.length, picked: pick.picked },
    meta: { ms: { research: researchMs, ai: aiMs, total: Date.now() - started }, costUsd: Number(((provider?.cost || 0) + (pick.cost || 0)).toFixed(5)) },
    learning: { pastDesigns: pastDesigns.length, examplesUsed: pastExamples ? pastExamples.split('\n').length : 0 },
    notes,
  };
}

async function trending() {
  const notes = [];
  const { mcp, tools } = await discover(notes);
  if (!mcp || !tools.trending) return { topics: [], notes: [...notes, 'No ES MCP trending tool is available.'] };
  const args = buildArgs(tools.trending, 'sports') || {};
  const text = resultText(await mcp.callTool(tools.trending.name, args, { timeoutMs: 9000 }));
  const topics = text.split(/\n+/).map(line => clean(line.replace(/^[-*\d.)\s]+/, ''))).filter(line => line.length > 8 && line.length < 140).slice(0, 8);
  return { topics, notes };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };

  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });

  try {
    if (event.httpMethod === 'GET') {
      const notes = [];
      const { tools, toolNames, error } = await discover(notes);
      const connection = connectionInfo(tools, toolNames, error);
      return json(200, {
        ...connection,
        brain: brainName(tools),
        templates: Object.fromEntries(Object.entries(TEMPLATES).map(([type, t]) => [type, t.label])),
        notes,
      });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

    const body = JSON.parse(event.body || '{}');
    if (body.mode === 'trending') return json(200, await trending());
    // Keep line breaks: a pasted table is only readable row by row.
    const brief = String(body.brief || '').replace(/<[^>]*>/g, ' ').replace(/[^\S\n\t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
    if (brief.length < 3) return json(400, { error: 'Write a brief of at least a few words.' });
    const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    return json(200, await generate({ brief, formats: body.formats, count: body.count, avoid: body.avoid, token, email: auth.user.email }));
  } catch (error) {
    return json(500, { error: 'Generate failed.', detail: String(error.message || error).slice(0, 200) });
  }
};

// Pure helpers, exported for scripts/test-es-generate.mjs.
exports._test = { TEMPLATES, checkFields, checkSpec, classifyTools, buildArgs, extractJson, draftPlan, chunkWords, keyTerms, mainWord, sportFromUrl, brandHints, parseEsArticles, buildPrompt, parseTableBrief, tableDesign, fakeQuote, squash, repairPrompt, nameCandidates, esCoverage, sceneText, pickPhoto, photoCandidates, COVERAGE_CACHE };
