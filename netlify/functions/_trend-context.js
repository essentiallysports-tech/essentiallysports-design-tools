// The trend behind a Generate brief (FrameUp Trends -> Generate).
//
// When a run starts from a trend (Trends "Design post", "Design as <Template>",
// keyboard D, a Home trending card), the page sends the trend itself beside
// the brief: { trend: { id, title, type, category, url, source, publishedAt,
// traffic, coverage, signal, team, image, imageKind, imageCredit, related[],
// storyline, why, hook, titles[] } }. It is user-controlled input, so:
//   - normalizeTrend() keeps known fields only, caps every string and list,
//     accepts https URLs only, and drops the trend when the brief no longer
//     tells its story (the editor rewrote it);
//   - trendResearch() turns it into research parts with a strict split:
//       section / corpus  real feed text only (headlines, outlets, team,
//                         how big it is), so the fact checks (fakeQuote,
//                         lintSpec numbers) may lean on it;
//       ideas             AI-written angles (why / hook / titles), labelled
//                         as ideas and NEVER put in the corpus or the digest,
//                         so a number or quote in them is still "invented".
// No network calls: everything here is already in the trend.

const MAX = { id: 80, title: 300, source: 80, domain: 80, traffic: 20, team: 60, short: 20, credit: 120, why: 400, hook: 200, idea: 140, url: 600, date: 40, category: 20, label: 80 };
const RELATED_MAX = 6;
const TITLES_MAX = 5;
// The design-photo hosts (same list as es-generate.js PROXY_IMAGE_HOSTS / es-image-search.js).
const PHOTO_HOSTS = new Set(['image-cdn.essentiallysports.com', 'www.essentiallysports.com', 'www.staging.essentiallysports.com']);

const text = (value, max) => String(value == null ? '' : value)
  .replace(/<[^>]*>/g, ' ')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
function httpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX.url) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch (error) {
    return '';
  }
}
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; } };
const isEsUrl = url => { const host = hostOf(url); return host === 'essentiallysports.com' || host.endsWith('.essentiallysports.com'); };
const isPhotoHost = url => { try { return PHOTO_HOSTS.has(new URL(url).hostname); } catch (error) { return false; } };
const count = (value, max) => { const n = Math.round(Number(value)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };

// Words that carry the story (for "is the brief still about this trend?").
const STOP = new Set('the and for with from that this into over after before about than then they them their his her its are was were has have had not but who what when where why how will would could should just more most very out off new news says said say vs via per amid as at by in of on to up a an is it be or if so no do did does can get got sport nfl nba mlb wnba cfb golf tennis headline context why fans care team story'.split(' '));
const words = value => String(value || '').toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !STOP.has(w));

// True when the brief still tells the trend's story: at least half of the
// trend headline's words (or of its top related headline's, for a search
// trend whose title is just the search) are in the brief, and at least 2.
function briefFitsTrend(brief, trend) {
  const have = new Set(words(brief));
  const fits = title => {
    const want = [...new Set(words(title))];
    if (!want.length) return false;
    const hit = want.filter(w => have.has(w)).length;
    return hit >= Math.min(2, want.length) && hit / want.length >= 0.5;
  };
  return fits(trend.title) || (trend.related || []).slice(0, 2).some(r => fits(r.title));
}

function normalizeTrend(raw, brief = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = text(raw.title, MAX.title);
  if (title.length < 3) return null;
  const trend = {
    id: text(raw.id, MAX.id).replace(/[^\w:.-]/g, ''),
    title,
    type: raw.type === 'search' ? 'search' : 'news',
    category: text(raw.category, MAX.category).toLowerCase().replace(/[^a-z]/g, ''),
    url: httpsUrl(raw.url),
    source: text(raw.source, MAX.source),
    publishedAt: Number.isFinite(Date.parse(raw.publishedAt)) ? new Date(Date.parse(raw.publishedAt)).toISOString() : '',
    traffic: text(raw.traffic, MAX.traffic).replace(/[^\w+,.\s]/g, ''),
    coverage: count(raw.coverage, 99),
    signal: raw.signal === 'hot' || raw.signal === 'rising' ? raw.signal : '',
    team: null,
    image: httpsUrl(raw.image),
    imageKind: raw.imageKind === 'logo' ? 'logo' : raw.imageKind === 'photo' ? 'photo' : '',
    imageCredit: text(raw.imageCredit, MAX.credit),
    related: [],
    storyline: null,
    why: text(raw.why, MAX.why),
    hook: text(raw.hook, MAX.hook),
    titles: [],
  };
  const team = raw.team && typeof raw.team === 'object' ? raw.team : (typeof raw.team === 'string' ? { name: raw.team } : null);
  if (team && text(team.name, MAX.team)) trend.team = { name: text(team.name, MAX.team), short: text(team.short, MAX.short) };
  const seen = new Set([title.toLowerCase()]);
  (Array.isArray(raw.related) ? raw.related : []).slice(0, RELATED_MAX * 2).forEach(r => {
    if (trend.related.length >= RELATED_MAX) return;
    const item = typeof r === 'string' ? { title: r } : (r && typeof r === 'object' ? r : null);
    const relTitle = item ? text(item.title, MAX.title) : '';
    if (relTitle.length < 3 || seen.has(relTitle.toLowerCase())) return;
    seen.add(relTitle.toLowerCase());
    trend.related.push({ title: relTitle, url: httpsUrl(item.url), source: text(item.source, MAX.source) });
  });
  if (raw.storyline && typeof raw.storyline === 'object') {
    const size = count(raw.storyline.size, 50);
    if (size) trend.storyline = { size, label: text(raw.storyline.label, MAX.label) };
  }
  (Array.isArray(raw.titles) ? raw.titles : []).slice(0, TITLES_MAX * 2).forEach(t => {
    const idea = text(t, MAX.idea);
    if (idea.length >= 3 && trend.titles.length < TITLES_MAX && !trend.titles.includes(idea)) trend.titles.push(idea);
  });
  if (brief && !briefFitsTrend(brief, trend)) return null;
  return trend;
}

const ageText = (iso, now) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const h = Math.max(0, (now - t) / 3600000);
  return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)} days ago`;
};

// One line on why now: what the feed measured (never a guess).
function whyNowLine(trend, now = Date.now()) {
  const parts = [];
  if (trend.signal === 'hot') parts.push('hot right now');
  else if (trend.signal === 'rising') parts.push('rising');
  if (trend.type === 'search' && trend.traffic) parts.push(`${trend.traffic} Google searches`);
  if (trend.coverage > 1) parts.push(`${trend.coverage} outlets on it`);
  if (trend.storyline?.size > 1) parts.push(`${trend.storyline.size} stories in this storyline`);
  const age = ageText(trend.publishedAt, now);
  if (age) parts.push(`first seen ${age}`);
  return parts.length ? `Why now (FrameUp Trends): ${parts.join(', ')}.` : '';
}

// The trend as research: { section, corpus, sources, ideas, teamName, photo, hint }.
//   section  for the digest (real feed text, labelled as other outlets' headlines)
//   corpus   real headlines only, for the fact checks
//   sources  ES URLs in the trend (designs may cite them)
//   ideas    AI angle ideas, labelled; for prompts only, never facts
//   photo    { image, title } when the trend picture is on an ES photo host
//   hint     who the trend picture shows (a Wikipedia credit), as a hint only
function trendResearch(trend, { now = Date.now() } = {}) {
  if (!trend) return null;
  const head = `${trend.title}${trend.source ? ` (${trend.source})` : ''}${trend.url ? ` ${trend.url}` : ''}`;
  const lines = [`- ${head}`, ...trend.related.map(r => `- ${r.title}${r.source ? ` (${r.source})` : ''}${r.url ? ` ${r.url}` : ''}`)];
  const why = whyNowLine(trend, now);
  const teamName = trend.team?.name || '';
  const hint = trend.image && trend.imageKind !== 'logo' && /^wikipedia:/i.test(trend.imageCredit) ? trend.imageCredit.replace(/^wikipedia:\s*/i, '') : '';
  const section = [
    '## The trend this brief came from (FrameUp Trends; headlines from ES and other outlets, real text)',
    ...lines,
    teamName ? `Team the feed tied it to: ${teamName}` : '',
    hint ? `The feed's picture is of: ${hint} (hint only)` : '',
    why,
  ].filter(Boolean).join('\n').slice(0, 1400);
  const corpus = [trend.title, ...trend.related.map(r => r.title)].join('\n');
  const sources = [trend.url, ...trend.related.map(r => r.url)].filter(url => url && isEsUrl(url));
  const ideaLines = [
    trend.why ? `- Why fans care: ${trend.why}` : '',
    trend.hook ? `- Hook: ${trend.hook}` : '',
    ...trend.titles.map(t => `- Headline idea: ${t}`),
  ].filter(Boolean);
  const ideas = ideaLines.length
    ? ['Angle ideas from FrameUp Trends (AI-written suggestions, NOT facts: use them for the angle or hook only; never take a number, quote, name or result from them that the brief or the research does not state):', ...ideaLines].join('\n').slice(0, 1200)
    : '';
  const photo = trend.image && trend.imageKind !== 'logo' && isPhotoHost(trend.image) ? { image: trend.image, title: trend.title, url: trend.url } : null;
  return { section, corpus, sources: [...new Set(sources)], ideas, teamName, photo, hint, whyNow: why };
}

// The trend's league as the brief's "Sport:" line when the brief has none
// (the page adds it from a local map that can lose old entries; the trend's
// own category is the ground truth). 'others' adds nothing.
const SPORT_OF = { nfl: 'NFL', cfb: 'CFB', mlb: 'MLB', golf: 'Golf', tennis: 'Tennis' };
function withTrendSport(brief, trend) {
  const sport = trend && SPORT_OF[trend.category];
  if (!sport || /^\s*sport\s*:/im.test(String(brief || ''))) return brief;
  return `${brief}\nSport: ${sport}`;
}

module.exports = { normalizeTrend, trendResearch, briefFitsTrend, whyNowLine, withTrendSport, SPORT_OF, PHOTO_HOSTS };
