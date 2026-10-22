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
const { isMcpConfigured, createSession } = require('./_es-mcp.js');

const ES_WP_API = 'https://www.essentiallysports.com/wp-json/wp/v2';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// OpenAI is opt-in (it is billed separately): set GENERATE_USE_OPENAI=true.
const USE_OPENAI = process.env.GENERATE_USE_OPENAI === 'true' && Boolean(OPENAI_API_KEY);
const OPENAI_GENERATE_MODEL = process.env.OPENAI_GENERATE_MODEL || 'gpt-4.1-mini';
const ES_IMAGE_BUCKET = process.env.ES_IMAGE_BUCKET || 'essentiallysports-images-v2prod';
const TOOL_OVERRIDES = {
  think: process.env.ES_MCP_THINK_TOOL || '',
  articles: process.env.ES_MCP_ARTICLES_TOOL || '',
  stats: process.env.ES_MCP_STATS_TOOL || '',
  trending: process.env.ES_MCP_TRENDING_TOOL || '',
  images: process.env.ES_MCP_SEARCH_TOOL || '',
};
const MAX_DESIGNS = 4;

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
      return { lines, fields: { lines } };
    }
    case 'long-quote': {
      const text = within(String(fields.text || '').replace(/^["“]|["”]$/g, ''), 20, 220);
      if (!text) return { error: 'long quote needs 20-220 chars' };
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
      title: within(raw.title, 1, 80) || checked.lines[0].slice(0, 80),
      sport: within(raw.sport, 2, 20) || '',
      team: within(raw.team, 2, 40) || '',
      fields: checked.fields,
      lines: checked.lines,
      photoQuery: TEMPLATES[postType].photo ? (within(raw.photoQuery, 2, 80) || '') : '',
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
  stats: /\bstat|score|standing|box[\s_-]?score|player[\s_-]?(?:data|info)/i,
  articles: /article|stor(?:y|ies)|news|post|content/i,
  think: /generat|write|compose|draft|summari[sz]|intelligen|ask|answer|chat|complet|reason|copy/i,
};

function classifyTools(tools) {
  const named = tools.map(tool => ({ name: String(tool?.name || ''), text: `${tool?.name || ''} ${tool?.description || ''}`, schema: tool?.inputSchema || {} })).filter(t => t.name);
  const pick = role => {
    const override = TOOL_OVERRIDES[role];
    if (override) return named.find(t => t.name === override) || null;
    const byName = named.find(t => ROLE_PATTERNS[role].test(t.name) && (role === 'images' || !ROLE_PATTERNS.images.test(t.name)));
    if (byName) return byName;
    return named.find(t => ROLE_PATTERNS[role].test(t.text) && (role === 'images' || !ROLE_PATTERNS.images.test(t.text))) || null;
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
const STOP_WORDS = new Set('a an and are as at be but by for from has have he her his in is it its make me of on or our post she so that the their them they this to us was we were what when who will with after before about says said just'.split(' '));

// WordPress search matches every word, so a whole sentence finds nothing.
// Search with the names (capitalised runs) or the first few key words.
function keyTerms(text) {
  const plain = clean(text).replace(/["“”][^"“”]*["“”]/g, ' ').replace(/\d[\d,.]*\+?%?(?:\s+[A-Za-z]{1,8}\b)?/g, ' ');
  const names = plain.match(/(?:[A-Z][a-zA-Z'.-]+\s+){1,3}[A-Z][a-zA-Z'.-]+/g);
  if (names) return names[0].trim();
  return plain.toLowerCase().split(/[^a-z0-9'-]+/).filter(word => word.length > 2 && !STOP_WORDS.has(word)).slice(0, 3).join(' ');
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

function imageUrlsFromMcp(text) {
  const urls = String(text).match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  const s3 = [...String(text).matchAll(/s3:\/\/([^/\s"']+)\/([^\s"'<>)]+)/g)]
    .filter(match => match[1] === ES_IMAGE_BUCKET)
    .map(match => `https://${match[1]}.s3.amazonaws.com/${match[2]}`);
  return [...urls, ...s3].filter(url => {
    try {
      const host = new URL(url).hostname;
      return /\.(jpe?g|png|webp)(\?|$)/i.test(url) && (isEsUrl(url) || (host.endsWith('.amazonaws.com') && url.includes(ES_IMAGE_BUCKET)));
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
    const surname = terms.split(' ').filter(word => word.length > 2).slice(-2)[0]?.toLowerCase() || '';
    const known = articles.find(a => isEsUrl(a.image) && surname && `${a.title} ${a.excerpt}`.toLowerCase().includes(surname));
    const article = known || (await searchEsArticlesOnce(terms, 15000).catch(() => [])).find(a => isEsUrl(a.image));
    return article ? { title: article.title, sourceUrl: article.image, url: proxied(article.image) } : null;
  } catch (error) {
    return null;
  }
}

async function research(brief, mcp, tools, notes) {
  const out = { articles: [], digest: '', sources: [] };
  const sections = [];
  const tryTool = async (role, label) => {
    if (!mcp || !tools[role]) return;
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
    searchEsArticles(keyTerms(brief)).then(articles => { out.articles = articles; }).catch(() => {}),
  ]);
  if (out.articles.length) {
    sections.push(`## Latest ES coverage\n${out.articles.map(a => `- ${a.title} (${a.date}) ${a.url}\n  ${a.excerpt}`).join('\n')}`);
    out.sources.push(...out.articles.map(a => a.url));
  }
  out.sources = [...new Set(out.sources)];
  out.digest = sections.join('\n\n').slice(0, 9000);
  return out;
}

// ─── Think ─────────────────────────────────────────────────────────────────
function buildPrompt(brief, found, allowedTypes, count) {
  const catalog = Object.entries(TEMPLATES)
    .filter(([type]) => !allowedTypes.length || allowedTypes.includes(type))
    .map(([type, t]) => `- ${type} (${t.label}): ${t.use}\n  fields: ${t.shape}`)
    .join('\n');
  return [
    'You are the senior social designer at EssentiallySports (ES), a US sports media brand.',
    `Plan ${count} distinct Instagram post designs for the brief below, each using one of our templates.`,
    'Rules:',
    '- Use ONLY facts found in the ES research below. Never invent numbers, quotes or results. If a fact is missing, choose a template that does not need it.',
    '- Quotes must be real quotes from the research, attributed to the person who said them.',
    '- Write like ES: punchy, confident, plain American sports English. Title Case for pills and headlines. No emojis, no hashtags.',
    '- Respect every character limit exactly. Shorter is better.',
    '- Vary the templates when the story allows it.',
    '- sport is the league, e.g. NFL, NBA, MLB, NHL, WNBA, NCAAF, Golf, Tennis, F1, Soccer. team is the team or league name, e.g. "Los Angeles Lakers".',
    '- photoQuery is 2-5 words naming who should be in the photo, e.g. "LeBron James Lakers".',
    '',
    `Templates:\n${catalog}`,
    '',
    `Brief: ${brief}`,
    '',
    `ES research:\n${found.digest || '(no ES coverage found)'}`,
    '',
    'Reply with JSON only, no prose:',
    '{"designs": [{"postType": "...", "title": "short name", "sport": "...", "team": "...", "fields": {...}, "photoQuery": "...", "why": "one sentence on why this template fits", "sources": ["ES article URLs you used"]}]}',
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

async function thinkWithOpenAi(prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_GENERATE_MODEL,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed: ${response.status}`);
  return designsFrom(extractJson(data?.choices?.[0]?.message?.content));
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

function draftPlan(brief, found, allowedTypes) {
  const allow = type => !allowedTypes.length || allowedTypes.includes(type);
  // The person comes from the brief; an ES story is used only if it is about them.
  const photoQuery = keyTerms(brief) || guessEntity(brief);
  const surname = photoQuery.split(' ').filter(word => word.length > 2).slice(-2)[0]?.toLowerCase() || '';
  const lead = found.articles.find(a => surname && a.title.toLowerCase().includes(surname));
  const sources = lead ? [{ url: lead.url, title: lead.title }] : [];
  const designs = [];

  if (allow('cover')) {
    // Wording comes from the brief (ES stories may cover a different moment):
    // its first clause if that fits, else just the name.
    const pills = [brief.split(/[,.;!?"“]/)[0], photoQuery]
      .map(text => chunkWords(titleCase(text), 20, 3))
      .find(lines => lines.length) || [];
    if (pills.length) designs.push({ postType: 'cover', title: pills.join(' '), fields: { pills }, photoQuery, why: 'Draft: the brief as headline pills.', sources });
  }

  const quoteSource = `${brief} ${lead?.excerpt || ''}`;
  const quote = (quoteSource.match(/[“"]([^”"]{8,200})[”"]/) || [])[1];
  if (quote) {
    const short = chunkWords(titleCase(quote), 16, 3);
    if (short.length && allow('quote')) {
      designs.push({ postType: 'quote', title: quote, fields: { lines: short }, photoQuery, why: 'Draft: the quote found in the brief or ES story.', sources });
    } else if (allow('long-quote') && quote.length >= 20) {
      designs.push({ postType: 'long-quote', title: quote, fields: { text: quote.slice(0, 220) }, photoQuery, why: 'Draft: the full quote found in the brief or ES story.', sources });
    }
  }

  const stats = [...clean(brief).matchAll(/(\d[\d,.]*\+?%?)\s+([A-Za-z]{2,8})\b/g)]
    .map(match => ({ value: match[1].slice(0, 7), label: match[2].toUpperCase().slice(0, 8) }));
  if (allow('stats-single-ent') && stats.length >= 3) {
    designs.push({ postType: 'stats-single-ent', title: `${photoQuery} stats`, fields: { headline: chunkWords(titleCase(photoQuery), 22, 1)[0] || 'Record Alert!', stats: stats.slice(0, 3) }, photoQuery, why: 'Draft: the three numbers from the brief.', sources });
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
  if (!isMcpConfigured()) return { mcp: null, tools: {}, toolNames: [] };
  try {
    const mcp = createSession();
    const list = await mcp.listTools();
    return { mcp, tools: classifyTools(list), toolNames: list.map(tool => tool?.name).filter(Boolean) };
  } catch (error) {
    notes.push(`ES MCP unavailable: ${String(error.message || error).slice(0, 120)}`);
    return { mcp: null, tools: {}, toolNames: [] };
  }
}

const brainName = tools => (tools.think ? `es-mcp:${tools.think.name}` : (USE_OPENAI ? `openai:${OPENAI_GENERATE_MODEL}` : 'draft'));

async function generate({ brief, formats, count }) {
  const notes = [];
  const allowedTypes = (Array.isArray(formats) ? formats : []).filter(type => TEMPLATES[type]);
  const want = Math.min(Math.max(parseInt(count, 10) || MAX_DESIGNS, 1), MAX_DESIGNS);
  const { mcp, tools } = await discover(notes);
  const found = await research(brief, mcp, tools, notes);

  let brain = brainName(tools);
  let rawDesigns = [];
  const prompt = buildPrompt(brief, found, allowedTypes, want);
  try {
    if (tools.think) rawDesigns = await thinkWithMcp(prompt, mcp, tools.think);
    else if (USE_OPENAI) rawDesigns = await thinkWithOpenAi(prompt);
  } catch (error) {
    notes.push(`AI step failed, using draft mode: ${String(error.message || error).slice(0, 160)}`);
  }
  if (!rawDesigns.length) {
    if (brain !== 'draft') notes.push('The AI returned no usable designs; showing draft-mode results.');
    brain = 'draft';
    rawDesigns = draftPlan(brief, found, allowedTypes);
  }

  const designs = [];
  rawDesigns.forEach((raw, index) => {
    const checked = checkSpec(raw, index, allowedTypes);
    if (checked.error) notes.push(`Skipped ${checked.error}`);
    else if (designs.length < want) designs.push(checked.spec);
  });
  await Promise.all(designs.map(async spec => {
    spec.photo = await findPhoto(spec.photoQuery, mcp, tools, found.articles);
    if (!spec.sources.length && found.sources[0]) spec.sources = [{ url: found.sources[0], title: found.articles.find(a => a.url === found.sources[0])?.title || '' }];
  }));

  return {
    brain,
    designs,
    research: { articles: found.articles.map(({ title, url, date }) => ({ title, url, date })) },
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
      const { tools, toolNames } = await discover(notes);
      return json(200, {
        mcpConfigured: isMcpConfigured(),
        brain: brainName(tools),
        tools: toolNames,
        roles: Object.fromEntries(Object.entries(tools).map(([role, tool]) => [role, tool?.name || null])),
        templates: Object.fromEntries(Object.entries(TEMPLATES).map(([type, t]) => [type, t.label])),
        notes,
      });
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

    const body = JSON.parse(event.body || '{}');
    if (body.mode === 'trending') return json(200, await trending());
    const brief = clean(body.brief).slice(0, 600);
    if (brief.length < 3) return json(400, { error: 'Write a brief of at least a few words.' });
    return json(200, await generate({ brief, formats: body.formats, count: body.count }));
  } catch (error) {
    return json(500, { error: 'Generate failed.', detail: String(error.message || error).slice(0, 200) });
  }
};

// Pure helpers, exported for scripts/test-es-generate.mjs.
exports._test = { TEMPLATES, checkFields, checkSpec, classifyTools, buildArgs, extractJson, draftPlan, chunkWords, keyTerms };
