'use strict';
// Design from a brief (the editor's brief box, frameup-brief.js).
//
// POST { mode: 'design', workspace, brief, ownPhoto }
//   1. Facts: the ES article the brief links (by its slug), else ES coverage of
//      the names in the brief; X posts it links (the tweet card's own fetch).
//   2. Match: the free rules matcher (frameup-brief-core.js shortlist, with the
//      team's template acceptance from the usage table, cached 6 h).
//   3. Fill: ONE Haiku call picks the template, says why in one line and writes
//      every field of three options (best first), only from the brief, the
//      link and ES data. Generate's limits (es-generate.js checkFields) and its
//      brand checker (_lint-spec.js) hold each option; options that break a
//      rule get one repair call; the rest are dropped.
//   4. Photo: the person's own photo (the page has it), else the ES photo pool
//      with the right-person check (_asset-service.js findPhotos: caption
//      evidence, then the cached vision check; no graphics, no text-heavy
//      images), in parallel with the AI call.
//   Over a weekly budget (free mode) or when the AI fails: the rules fill the
//   templates from the brief's own words (Generate's draftPlan), no AI.
//
// POST { mode: 'rewrite', workspace, brief, option, how: shorter|punchier|formal }
//   One Haiku call rewrites one option's text, checked the same way.
//
// Cost: one main-tier (Haiku) call per design, about $0.001-0.003; a repair
// or a rewrite is one more. Logged as feature "brief-design" (FEATURE_NAMES).
const { verifyEsUser } = require('./_supabase-auth.js');
const { aiText, aiSpendGate, freeModeGate, inFreeMode, userOverHourlyLimit, gatewayConfigured, isBudgetError, withAiMode } = require('./_ai-gateway.js');
const { lintSpec, applyPatch } = require('./_lint-spec.js');
const REST = require('./_supabase-rest.js');
const RULES = require('../../frameup-rules.js');
const CORE = require('../../frameup-brief-core.js');
const GEN = require('./es-generate.js').briefKit;

let ASSETS = null;
try { ASSETS = require('./_asset-service.js'); } catch (error) { ASSETS = null; }
let TWEETS = null;
try { TWEETS = require('./tweet-oembed.js'); } catch (error) { TWEETS = null; }

const clock = { now: () => Date.now() };
const ES_WP_API = 'https://www.essentiallysports.com/wp-json/wp/v2';
const WP_HEADERS = { 'User-Agent': 'ES-Designer/1.0 (+https://www.essentiallysports.com/)', Accept: 'application/json' };
// Brief to ready in under 8 s: each step has its own deadline.
const LIMITS = { factsMs: 3200, articleMs: 3500, tweetMs: 4000, photoMs: 4500, aiMs: 7000, repairBy: 4800, repairMs: 3200, statsMs: 1500 };
const OPTION_COUNT = 3;

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const timebox = (promise, ms, fallback) => {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback).finally(() => clearTimeout(timer)),
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); }),
  ]);
};
const tokenOf = event => String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
const cut = (value, max) => CORE.clean(value).slice(0, max);
const squash = text => ` ${String(text || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim()} `;

// ─── Facts ─────────────────────────────────────────────────────────────────
// An ES article by its link: the WordPress post with that slug.
function slugOf(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts[parts.length - 1] || '';
    return /^[a-z0-9-]{3,200}$/i.test(slug) ? slug.toLowerCase() : '';
  } catch (error) {
    return '';
  }
}
async function fetchArticle(url) {
  const slug = slugOf(url);
  if (!slug) return null;
  const api = new URL(`${ES_WP_API}/posts`);
  api.searchParams.set('slug', slug);
  api.searchParams.set('_fields', 'id,date,link,title,excerpt,content,yoast_head_json.og_image');
  const response = await fetch(api, { headers: WP_HEADERS, signal: AbortSignal.timeout(LIMITS.articleMs) });
  const list = await response.json().catch(() => null);
  const post = response.ok && Array.isArray(list) ? list[0] : null;
  if (!post) return null;
  return {
    title: GEN.clean(post.title?.rendered).slice(0, 200),
    url: String(post.link || url),
    date: String(post.date || '').slice(0, 10),
    excerpt: GEN.clean(post.excerpt?.rendered).slice(0, 500),
    body: GEN.clean(post.content?.rendered).slice(0, 9000),
    image: String(post.yoast_head_json?.og_image?.[0]?.url || ''),
  };
}

// An X post through the tweet card's own lookup (same auth, same sources).
async function fetchTweet(url, event) {
  if (!TWEETS?.handler) return null;
  const result = await TWEETS.handler({ httpMethod: 'GET', headers: event.headers || {}, queryStringParameters: { url } });
  const body = JSON.parse(result.body || '{}');
  if (result.statusCode !== 200 || !body.ok) return null;
  return {
    url: body.url || url,
    authorName: cut(body.authorName, 80) || 'X User',
    handle: cut(String(body.handle || '').replace(/^@/, ''), 40),
    text: String(body.text || '').slice(0, 600),
    dateLabel: cut(body.dateLabel, 40),
    metrics: cut(body.metrics, 80),
    avatarDataUrl: /^data:image\//.test(String(body.avatarDataUrl || '')) && String(body.avatarDataUrl).length < 120000 ? body.avatarDataUrl : '',
    avatarUrl: /^https:\/\//.test(String(body.avatarUrl || '')) ? String(body.avatarUrl).slice(0, 500) : '',
    verified: Boolean(body.verified),
    truncated: Boolean(body.truncated),
  };
}

const deps = {
  aiText,
  fetchArticle,
  esCoverage: text => GEN.esCoverage(text),
  fetchTweet,
  findPhotos: args => (ASSETS?.findPhotos ? ASSETS.findPhotos(args) : null),
  usageRows: async since => REST.request(`frameup_usage_events?select=action,meta&category=eq.generate&action=in.(brief-design,brief-export)&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5000`, { service: true }),
};

async function gatherFacts(brief, links) {
  const words = CORE.withoutLinks(brief);
  const [article, coverage] = await Promise.all([
    links.es[0] ? timebox(deps.fetchArticle(links.es[0]), LIMITS.articleMs, null) : null,
    words.length >= 6 ? timebox(deps.esCoverage(words), LIMITS.factsMs, { articles: [] }) : { articles: [] },
  ]);
  const articles = (coverage?.articles || []).filter(a => a && a.title && GEN.isEsUrl(a.url) && a.url !== article?.url).slice(0, 6);
  // Every ES article the design may cite or link (headline lists, tickers).
  const listed = [...(article ? [article] : []), ...articles];
  const digest = [
    article ? `## The linked ES article: "${article.title}" (${article.date}) ${article.url}\n${article.excerpt}\n${article.body.slice(0, 2200)}` : '',
    articles.length ? `## Latest ES coverage\n${articles.map(a => `- ${a.title} (${a.date}) ${a.url}\n  ${a.excerpt}\n  ${String(a.body || '').slice(0, 400)}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 5600);
  const corpus = listed.map(a => `${a.title}. ${a.excerpt} ${a.body || ''}`).join('\n').slice(0, 60000);
  return { article, articles, listed, urls: new Set(listed.map(a => a.url)), digest, corpus };
}

// ─── Template acceptance (the learning loop) ───────────────────────────────
// The team's brief designs over 90 days, from the usage table: how often each
// template was opened, exported and exported unchanged. Read with the service
// role (people can't read others' rows), cached 6 h per warm server; a failed
// read is remembered for 10 minutes and simply gives no nudge.
const STATS = { at: 0, ttl: 0, value: {} };
async function teamStats() {
  if (clock.now() - STATS.at < STATS.ttl) return STATS.value;
  let value = {};
  let ttl = 10 * 60 * 1000;
  if (REST.serviceRoleKey()) {
    const since = new Date(clock.now() - 90 * 86400000).toISOString();
    const rows = await timebox(deps.usageRows(since), LIMITS.statsMs, null);
    if (Array.isArray(rows)) { value = CORE.statsFromRows(rows); ttl = 6 * 60 * 60 * 1000; }
  }
  Object.assign(STATS, { at: clock.now(), ttl, value });
  return value;
}

// ─── Photos ────────────────────────────────────────────────────────────────
// Only photos that pass the right-person check; never a graphic or a
// text-heavy image. [] = looked, none verified; null = the check isn't available.
async function verifiedPhotos(subject, { sport = '', team = '', others = [], track }) {
  if (!subject) return null;
  const res = await timebox(deps.findPhotos({ person: subject, sport, teams: team ? [team] : [], others: others.slice(0, 6), count: 6, track }), LIMITS.photoMs, null);
  if (!res || res.ok === false || res.subject === null) return null;
  const raw = (res.photos || []).filter(p => p && (p.url || p.src) && p.sourceUrl);
  const checked = raw.some(p => p.verified != null);
  return {
    cost: Number(res.cost) || 0,
    photos: raw
      .filter(p => (!checked || p.verified) && p.graphic !== true && !['object', 'graphic', 'text'].includes(String(p.kind || '')))
      .slice(0, 6)
      .map(p => ({ url: String(p.url || p.src), sourceUrl: String(p.sourceUrl), title: cut(p.title || subject, 120), kind: String(p.kind || ''), focus: p.focus || null })),
    // Stored cut-outs of the person (YouTube player layouts); none are made here.
    cutouts: (res.cutouts || []).filter(c => c && /^https:\/\//.test(String(c.url || ''))).slice(0, 1).map(c => ({ url: String(c.url), person: cut(c.person || subject, 60) })),
  };
}

// ─── The prompt ────────────────────────────────────────────────────────────
function systemPrompt(workspace) {
  const values = Object.keys(CORE.templatesFor(workspace));
  return [
    `You are the senior designer-editor at EssentiallySports (ES). A teammate typed a brief in the FrameUp ${CORE.WORKSPACES[workspace]} editor. Pick the template that tells the story best and write every field of it.`,
    'Templates (use these ids and exactly these field shapes; character limits are hard limits):',
    CORE.promptTemplates(workspace, values, GEN.TEMPLATES),
    'Rules:',
    ...RULES.VOICE.map(line => `- ${line}`),
    '- Facts, names, numbers, scores, dates and quotes come ONLY from the brief, the linked article or the ES facts given. Never invent or round a number; leave out what you do not have.',
    '- Quote templates only for words someone actually said, copied exactly from the brief or the facts.',
    '- Stats templates only when the brief or facts give those stats.',
    '- Prefer the shortlisted templates, best first. Two options may share a template only with clearly different wording or layout.',
    'Reply with JSON only:',
    '{"subject": "the main person or team the design is about, as named (or empty)", "sport": "league, e.g. NFL, NBA, WNBA (or empty)", "team": "the subject\'s full team name (or empty)",',
    ` "options": [{"template": "<id>", "why": "max 80 chars: why this template fits this brief", "layout": "<layout id, if the template lists layouts>", "fields": {...}}, ... exactly ${OPTION_COUNT}, best first]}`,
  ].join('\n');
}

function userPrompt({ brief, shortlist, facts, tweets, ownPhoto }) {
  return [
    `Shortlist from the rules (best first): ${shortlist.map(item => `${item.value} (${item.why})`).join('; ') || 'cover'}`,
    ownPhoto ? 'The teammate attached their own photo: prefer a template that shows a photo.' : '',
    `Brief: ${brief}`,
    tweets.length ? `X posts linked (shown as they are; you only write the headline):\n${tweets.map((t, i) => `${i + 1}. ${t.authorName} (@${t.handle}): ${t.text.slice(0, 280)}`).join('\n')}` : '',
    facts.digest ? `ES facts you may use:\n${facts.digest}` : 'No ES facts were found: use only the brief.',
  ].filter(Boolean).join('\n\n');
}

// ─── Checking an option ────────────────────────────────────────────────────
// -> { option } (with warnings) or { errors: [msg] }.
function checkOption(workspace, raw, ctx, index) {
  const template = String(raw?.template || '').trim();
  const own = CORE.templateOf(workspace, template);
  if (!own) return { errors: [`option ${index + 1}: unknown template "${template}"`] };
  if (own.needs === 'tweet' && ctx.tweets.length < 1) return { errors: [`option ${index + 1}: ${template} needs a linked X post`] };
  if (own.needs === 'tweets' && ctx.tweets.length < 2) return { errors: [`option ${index + 1}: ${template} needs two or three linked X posts`] };
  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
  const checked = own.generate ? GEN.checkFields(template, fields) : CORE.checkFields(workspace, template, fields);
  if (checked.error) return { errors: [`option ${index + 1} (${template}): ${checked.error}`] };
  // Links only to ES articles research actually returned.
  const badLink = (checked.links || []).find(url => !ctx.urls?.has(url));
  if (badLink) return { errors: [`option ${index + 1} (${template}): the link ${badLink} is not one of the ES articles given; use only those links`] };
  // A quote template carries someone's exact words.
  if (own.quote) {
    const said = squash(`${ctx.brief} ${ctx.corpus}`);
    const words = squash((checked.lines || []).join(' '));
    if (words.trim().length >= 4 && !said.includes(words)) return { errors: [`option ${index + 1} (${template}): the quote is not in the brief or the ES research; use exact words someone said, or another template`] };
  }
  const spec = {
    postType: template,
    fields: checked.fields,
    lines: checked.lines || [],
    listicle: checked.listicle || null,
    sport: cut(ctx.sport, 20),
    team: cut(ctx.team, 40),
  };
  // One idea per option: the same lead line is only a repeat within one template
  // (a stat line and a Cover may both lead with the player's name).
  if (!ctx.leads.has(template)) ctx.leads.set(template, new Set());
  const lint = lintSpec(spec, { brief: ctx.brief, corpus: ctx.corpus, leads: ctx.leads.get(template) });
  // Headline lists show ES's own published headlines: only the format rules
  // (no hashtags, links or emojis) apply to them, not the hook-style rules.
  if (own.needs === 'articles') {
    lint.errors = lint.errors.filter(e => e.code !== 'banned' || /hashtag|link|emoji/.test(e.msg));
    lint.ok = !lint.errors.length;
  }
  if (!lint.ok) return { errors: lint.errors.slice(0, 3).map(e => `option ${index + 1} (${template}) ${e.field}: ${e.msg}; ${e.fix || ''}`.trim()) };
  applyPatch(spec, lint.patch);
  if (lint.lead) ctx.leads.get(template).add(lint.lead);
  return {
    option: {
      template,
      label: own.label,
      why: cut(raw.why, 90) || 'Fits the story',
      layout: CORE.pickLayout(workspace, template, raw.layout, index),
      fields: spec.fields,
      lines: spec.lines,
      listicle: spec.listicle,
      sport: spec.sport,
      team: spec.team,
      warnings: lint.warnings.slice(0, 3).map(w => w.msg),
    },
  };
}

// The rules' own fill, no AI: Generate's draftPlan for its templates, the
// core's for the rest. Only words from the brief.
function rulesOptions(workspace, brief, shortlist, ctx) {
  const out = [];
  const words = CORE.withoutLinks(brief) || brief;
  if (workspace === 'instagram') {
    const plan = GEN.draftPlan(words, { articles: [] }, shortlist.map(s => s.value).concat('cover'));
    shortlist.forEach(item => {
      const own = CORE.templateOf(workspace, item.value);
      const drafted = own?.generate ? plan.find(d => d.postType === item.value) : null;
      const fields = drafted ? drafted.fields : (!own?.generate ? CORE.rulesFill(workspace, item.value, brief) : null);
      if (fields) out.push({ template: item.value, why: item.why, fields });
    });
    if (!out.some(o => o.template === 'cover')) {
      const cover = plan.find(d => d.postType === 'cover');
      if (cover) out.push({ template: 'cover', why: 'A headline over a photo', fields: cover.fields });
    }
  } else {
    shortlist.forEach(item => {
      const fields = CORE.rulesFill(workspace, item.value, brief, { facts: ctx.corpus, articles: ctx.listed });
      if (fields) out.push({ template: item.value, why: item.why, fields });
    });
  }
  return out;
}

function finish(options) {
  return options.slice(0, OPTION_COUNT).map((option, rank) => ({ ...option, id: `brief-${clock.now().toString(36)}-${rank}`, rank }));
}

// ─── Design ────────────────────────────────────────────────────────────────
async function design({ workspace, brief, ownPhoto = false, event, token, email }) {
  const started = clock.now();
  const links = CORE.linksIn(brief);
  const notes = [];
  if (links.other.length) notes.push('Only EssentiallySports links are read; the design uses your words for the rest.');
  const track = { feature: 'brief-design', email, token };
  const [facts, tweets, stats] = await Promise.all([
    gatherFacts(brief, links),
    workspace === 'instagram' ? Promise.all(links.tweets.map(url => timebox(deps.fetchTweet(url, event), LIMITS.tweetMs, null))).then(list => list.filter(Boolean)) : [],
    teamStats().catch(() => ({})),
  ]);
  if (links.tweets.length && tweets.length < links.tweets.length) notes.push(tweets.length ? 'One X post could not be read, so it was left out.' : 'The X post could not be read (it may be private or deleted).');
  if (links.es.length && !facts.article) notes.push('The ES article could not be read, so the design uses your words and ES coverage.');

  // The photo search starts now and runs beside the AI call.
  const words = `${CORE.withoutLinks(brief)} ${facts.article?.title || ''}`;
  const names = GEN.nameCandidates(words);
  const subjectGuess = names[0] || '';
  // YouTube cut-outs are only known after the photo search: the matcher assumes
  // one per named person, and options without one fall back to one image.
  const shortlist = CORE.shortlist(`${brief} ${facts.article?.title || ''}`, workspace, { tweets: tweets.length, articles: facts.listed.length, cutouts: workspace === 'youtube' && !ownPhoto ? Math.min(2, names.length) : 0, stats: stats[workspace] || null });
  const sportGuess = facts.article ? GEN.sportFromUrl(facts.article.url) : '';
  const wantsPhoto = !ownPhoto && shortlist.some(item => CORE.templateOf(workspace, item.value)?.photo);
  const photoJob = wantsPhoto && subjectGuess
    ? verifiedPhotos(subjectGuess, { sport: sportGuess, others: names.slice(1), track: { ...track, feature: 'brief-design-photo' } }).catch(() => null)
    : Promise.resolve(null);
  // YouTube's two-player layout: the second named person's stored cut-out.
  const secondJob = workspace === 'youtube' && !ownPhoto && names[1] && /\b(?:vs\.?|versus|against|rivalry|head[- ]to[- ]head|or)\b/i.test(words)
    ? verifiedPhotos(names[1], { sport: sportGuess, others: [subjectGuess], track: { ...track, feature: 'brief-design-photo' } }).catch(() => null)
    : Promise.resolve(null);

  const ctx = { brief, corpus: [facts.corpus, ...tweets.map(t => t.text)].join('\n'), leads: new Map(), tweets, urls: facts.urls, listed: facts.listed, sport: sportGuess, team: '' };
  let cost = 0;
  let mode = 'ai';
  let options = [];
  let subject = subjectGuess;
  const canAi = gatewayConfigured() && !inFreeMode();
  if (canAi) {
    try {
      const reply = await deps.aiText({
        tier: 'main',
        system: systemPrompt(workspace),
        cacheSystem: true,
        messages: [{ role: 'user', content: userPrompt({ brief, shortlist, facts, tweets, ownPhoto }) }],
        effort: 'low', maxTokens: 1800, timeoutMs: LIMITS.aiMs, track,
      });
      cost += Number(reply.cost) || 0;
      const parsed = GEN.extractJson(reply.text) || {};
      ctx.sport = cut(parsed.sport, 20) || ctx.sport;
      ctx.team = cut(parsed.team, 40);
      subject = cut(parsed.subject, 60) || subject;
      const raw = (Array.isArray(parsed.options) ? parsed.options : []).slice(0, OPTION_COUNT + 1);
      const failed = [];
      raw.forEach((item, index) => {
        const result = checkOption(workspace, item, ctx, index);
        if (result.option) options.push({ ...result.option, source: 'ai' });
        else failed.push({ item, errors: result.errors });
      });
      // One repair call for what broke, while there is time for it.
      if (failed.length && options.length < OPTION_COUNT && clock.now() - started < LIMITS.repairBy) {
        const repair = await deps.aiText({
          tier: 'main',
          system: systemPrompt(workspace),
          cacheSystem: true,
          messages: [{ role: 'user', content: [
            userPrompt({ brief, shortlist, facts, tweets, ownPhoto }),
            `These options broke a rule. Fix each one (same template unless the fix needs another), changing nothing else:\n${failed.map(f => `${JSON.stringify(f.item).slice(0, 900)}\nProblems: ${f.errors.join(' | ')}`).join('\n\n')}`,
            `Reply with JSON only: {"options": [...the fixed options, same shape]}`,
          ].join('\n\n') }],
          effort: 'low', maxTokens: 1400, timeoutMs: LIMITS.repairMs, track: { ...track, feature: 'brief-design-repair' },
        }).catch(error => { if (isBudgetError(error)) throw error; return null; });
        if (repair) {
          cost += Number(repair.cost) || 0;
          const fixed = GEN.extractJson(repair.text);
          (Array.isArray(fixed?.options) ? fixed.options : []).slice(0, failed.length).forEach((item, index) => {
            const result = checkOption(workspace, item, ctx, raw.length + index);
            if (result.option) options.push({ ...result.option, source: 'ai', repaired: true });
          });
        }
      }
    } catch (error) {
      if (!isBudgetError(error) && error?.code !== 'free-mode') console.error('brief-design AI failed:', String(error?.message || error).slice(0, 200));
      notes.push(inFreeMode() ? '' : 'The AI did not answer in time, so the design uses your words.');
      mode = inFreeMode() ? 'free' : 'rules';
    }
  } else {
    mode = inFreeMode() ? 'free' : 'rules';
  }
  // Rules fill: free mode, an AI failure, or too few good options.
  if (options.length < OPTION_COUNT) {
    const have = new Set(options.map(o => `${o.template}|${o.lines.join('|')}`));
    rulesOptions(workspace, brief, shortlist, ctx).forEach((item, index) => {
      if (options.length >= OPTION_COUNT) return;
      const result = checkOption(workspace, item, ctx, options.length + index);
      if (!result.option) return;
      const key = `${result.option.template}|${result.option.lines.join('|')}`;
      if (have.has(key)) return;
      have.add(key);
      options.push({ ...result.option, why: item.why || result.option.why, source: 'rules' });
    });
  }
  const [photo, second] = await Promise.all([photoJob, secondJob]);
  if (photo) cost += photo.cost;
  if (second) cost += second.cost;
  const cutouts = [...(photo?.cutouts || []), ...(second?.cutouts || [])].slice(0, 2);
  // YouTube player layouts need their cut-outs: without them an option
  // becomes the one-image layout (same words), duplicates dropped.
  if (workspace === 'youtube') {
    const need = { 'variation-2': 1, 'variation-3': 2 };
    const seen = new Set();
    options = options.map(option => (need[option.template] > cutouts.length
      ? { ...option, template: 'variation-1', label: CORE.labelOf(workspace, 'variation-1'), layout: CORE.pickLayout(workspace, 'variation-1', option.layout, 0) }
      : option)).filter(option => {
      const key = `${option.template}|${option.lines.join('|')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (!options.length) {
    return { status: 422, body: { error: 'Nothing in that brief could fill a template. Add a name, a headline or a link and try again.', reason: 'empty', shortlist, notes: notes.filter(Boolean) } };
  }
  return {
    status: 200,
    body: {
      options: finish(options),
      shortlist,
      subject,
      photos: photo?.photos || [],
      cutouts,
      photoChecked: Boolean(photo),
      tweets,
      article: facts.article ? { title: facts.article.title, url: facts.article.url } : null,
      notes: [...new Set(notes.filter(Boolean))],
      engine: mode,
      ms: clock.now() - started,
      costUsd: Number(cost.toFixed(5)),
    },
  };
}

// ─── Rewrite ───────────────────────────────────────────────────────────────
async function rewrite({ workspace, brief, option, how, event, token, email }) {
  const ask = CORE.REWRITES[how];
  if (!ask) return { status: 400, body: { error: 'Unknown rewrite.' } };
  const own = CORE.templateOf(workspace, option?.template);
  if (!own || typeof option.fields !== 'object') return { status: 400, body: { error: 'Missing design.' } };
  if (!gatewayConfigured()) return { status: 503, body: { error: 'AI rewrites are not available right now.', reason: 'off' } };
  const links = CORE.linksIn(brief);
  const facts = await gatherFacts(brief, links);
  const tweets = Array.isArray(option.tweets) ? option.tweets.slice(0, 3).map(t => ({ text: cut(t?.text, 600) })) : [];
  const ctx = { brief, corpus: [facts.corpus, ...tweets.map(t => t.text)].join('\n'), leads: new Map(), tweets: own.needs ? [{}, {}, {}] : [], urls: new Set([...facts.urls, ...((option.fields?.items || []).map(item => item?.url)), option.fields?.url].filter(Boolean)), sport: cut(option.sport, 20), team: cut(option.team, 40) };
  try {
    const reply = await deps.aiText({
      tier: 'main',
      system: systemPrompt(workspace),
      cacheSystem: true,
      messages: [{ role: 'user', content: [
        `Rewrite this ${own.label} design. ${ask}`,
        `Brief: ${brief}`,
        `Current fields: ${JSON.stringify(option.fields).slice(0, 1500)}`,
        facts.digest ? `ES facts you may use:\n${facts.digest}` : '',
        `Reply with JSON only: {"template": "${option.template}", "why": "${cut(option.why, 80)}", "fields": {...}}`,
      ].filter(Boolean).join('\n\n') }],
      effort: 'low', maxTokens: 1200, timeoutMs: 8000, track: { feature: `brief-design-rewrite-${how}`, email, token },
    });
    const parsed = GEN.extractJson(reply.text) || {};
    const result = checkOption(workspace, { ...parsed, template: option.template, layout: option.layout }, ctx, 0);
    if (!result.option) return { status: 422, body: { error: 'That rewrite broke an ES rule, so it was not used. Try again.', issues: result.errors.slice(0, 3) } };
    if (result.option.lines.join('|') === (Array.isArray(option.lines) ? option.lines : []).join('|')) return { status: 422, body: { error: 'No better version this time. Try another.' } };
    return { status: 200, body: { option: { ...option, ...result.option, why: option.why || result.option.why, source: 'ai' }, costUsd: Number((Number(reply.cost) || 0).toFixed(5)) } };
  } catch (error) {
    if (isBudgetError(error)) return { status: 503, body: { error: "This week's AI budget is used up, so rewrites are paused until it resets.", reason: 'budget' } };
    console.error('brief-design rewrite failed:', String(error?.message || error).slice(0, 200));
    return { status: 502, body: { error: 'The rewrite failed. Try again in a moment.' } };
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────
const cleanBrief = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);

exports.handler = withAiMode(async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const auth = await verifyEsUser(event);
  if (!auth.ok) return json(auth.statusCode, { error: auth.error });
  try {
    const body = JSON.parse(event.body || '{}');
    const workspace = String(body.workspace || 'instagram');
    if (!CORE.WORKSPACES[workspace] || !Object.keys(CORE.templatesFor(workspace)).length) return json(400, { error: 'Design from a brief is not available in this editor yet.' });
    const brief = cleanBrief(body.brief);
    if (brief.length < 3) return json(400, { error: 'Describe what you need in a few words.' });
    const token = tokenOf(event);
    const mode = body.mode === 'rewrite' ? 'rewrite' : 'design';
    const feature = mode === 'rewrite' ? `brief-design-rewrite-${CORE.REWRITES[body.how] ? body.how : 'other'}` : 'brief-design';
    const [gate, overHour] = await Promise.all([aiSpendGate(token, { feature }), userOverHourlyLimit(token)]);
    // Free mode (a weekly budget is used up): designs come from the rules;
    // rewrites are AI-only, so they are skipped ({ mode: 'free', skipped: true }).
    const free = freeModeGate(gate);
    if (gate && !free) return json(gate.status, { error: gate.error, reason: gate.reason });
    if (mode === 'rewrite') {
      if (free) return json(503, { error: 'Rewrites are paused while AI is in free mode.', reason: 'free' });
      if (overHour) return json(429, { error: "You've made a lot of changes this hour. Take a short break and try again soon.", reason: 'limit' });
      const result = await rewrite({ workspace, brief, option: body.option, how: String(body.how || ''), event, token, email: auth.user.email });
      return json(result.status, result.body);
    }
    if (overHour && !free) return json(429, { error: "You've made a lot of designs this hour. Take a short break and try again soon.", reason: 'limit' });
    const result = await design({ workspace, brief, ownPhoto: body.ownPhoto === true, event, token, email: auth.user.email });
    return json(result.status, result.body);
  } catch (error) {
    console.error('brief-design failed:', String(error?.message || error).slice(0, 200));
    return json(500, { error: 'Design from a brief failed. Try again in a moment.' });
  }
});

exports._test = { deps, clock, LIMITS, STATS, slugOf, fetchArticle, gatherFacts, teamStats, verifiedPhotos, systemPrompt, userPrompt, checkOption, rulesOptions, design, rewrite, cleanBrief };
