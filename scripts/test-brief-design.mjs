#!/usr/bin/env node
// Design from a brief: the shared core (frameup-brief-core.js), the server
// (netlify/functions/brief-design.js, AI mocked) and the wiring.
//   1. core: rules matcher (Social), X post rules, acceptance nudge, links,
//      template checks, kept / changed, usage stats, rules fills, prompt list
//   2. server: one Haiku call fills three options; invented numbers are sent
//      back once (repair) or dropped; free mode and AI failures use the rules;
//      X post templates only with readable links; the ES article link is read
//      by slug; photos only when the right-person check passed (no graphics);
//      team acceptance from the usage table (service role, cached); rewrites;
//      validation and the feature switch
//   3. wiring: two tags in index.html, the API route, the feature name, the
//      spec bridge's origin hook
// Every network call is mocked: no AI, no Supabase, no WordPress.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const Core = require('../frameup-brief-core.js');
let passed = 0;
const ok = (value, message) => { assert.ok(value, message); passed += 1; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); passed += 1; };

// ─── 1. Core ───────────────────────────────────────────────────────────────
{
  const top = (text, opts) => Core.shortlist(text, 'instagram', opts)[0]?.value;
  eq(top('LeBron drops 41 points and 12 assists in the win'), 'player-stat-line', 'stat line');
  eq(top('Chiefs beat Bills 27-24 in overtime'), 'team-record', 'score');
  eq(top('Tom Brady career: from 2000 draft pick to 2021 Super Bowl'), 'asap-template-1', 'timeline');
  eq(top('Caitlin Clark is changing the WNBA forever'), 'cover', 'a plain headline is a Cover');
  ok(Core.shortlist('LeBron drops 41 points and 12 assists', 'instagram').some(item => item.value === 'cover'), 'Cover is always on the list');
  ok(Core.shortlist('LeBron drops 41 points', 'instagram').every(item => item.label && item.why), 'labels and reasons');
  ok(Core.shortlist('a b c d e f g h', 'instagram').length <= 5, 'five at most');
  // X posts come only from links.
  ok(!Core.shortlist('Steph Curry posted on X after the game', 'instagram').some(item => /^twitter/.test(item.value)), 'no tweet template without a link');
  eq(top('Steph reacts', { tweets: 1 }), 'twitter-quote', 'one linked X post');
  eq(top('Fans react', { tweets: 2 }), 'twitter-multi', 'two linked X posts');
  // Newsletter (R2).
  const nl = (text, opts) => Core.shortlist(text, 'newsletter', opts).map(item => item.value);
  eq(nl('Trade Talk')[0], 'section-header', 'newsletter: a short title is a section header');
  eq(nl('Watch the full highlights of the Lakers win')[0], 'youtube-fi', 'newsletter: a video');
  eq(nl('Top NBA stories this week', { articles: 6 }).slice(0, 2), ['list', 'list2'], 'newsletter: a roundup of ES stories');
  ok(!nl('Top NBA stories this week', { articles: 3 }).includes('list'), 'newsletter: lists need five ES articles');
  eq(nl('NBA trivia about LeBron James records')[0], 'trivia', 'newsletter: a quiz');
  eq(nl('Kelce on retirement: "I still love this game"')[0], 'ig-player-quote', 'newsletter: a quote');
  ok(nl('The Lakers sale to a new owner closes at 10 billion').includes('ticker'), 'newsletter: money news');
  ok(['ig-headline-photo', 'tag-fi'].includes(nl('Caitlin Clark is changing the WNBA forever')[0]), 'newsletter: a feature image by default');
  ok(!Object.keys(Core.templatesFor('newsletter')).some(t => t === 'feature-image' || t === 'widgets'), 'newsletter: locked templates are never offered');
  eq(Core.checkFields('newsletter', 'tag-fi', { tag: 'TENNIS' }).lines, ['TENNIS']);
  ok(Core.checkFields('newsletter', 'tag-fi', { tag: 'A VERY LONG TAG HERE' }).error, 'tag max 16');
  eq(Core.checkFields('newsletter', 'archive-page-fi', {}).fields.tag, 'QUICK READ', 'archive tag default');
  eq(Core.checkFields('newsletter', 'youtube-fi', {}).lines, [], 'video FI has no text');
  ok(Core.checkFields('newsletter', 'section-header', { title: 'X'.repeat(21) }).error, 'section header max 20');
  eq(Core.checkFields('newsletter', 'ig-player-quote', { line1: '"I still love', line2: 'this game"' }).fields, { line1: 'I still love', line2: 'this game' }, 'quote marks stripped');
  const five = [1, 2, 3, 4, 5].map(n => ({ text: `ES headline number ${n} about the Lakers`, url: `https://www.essentiallysports.com/nba-news-${n}/` }));
  eq(Core.checkFields('newsletter', 'list', { items: five }).links.length, 5, 'list: five ES links');
  ok(Core.checkFields('newsletter', 'list', { items: five.slice(0, 4) }).error, 'list: exactly five');
  ok(Core.checkFields('newsletter', 'list2', { items: [...five.slice(0, 4), { text: 'Another headline here', url: 'https://espn.com/x' }] }).error, 'list: ES links only');
  ok(Core.checkFields('newsletter', 'list', { items: [...five.slice(0, 4), five[0]] }).error, 'list: no repeats');
  ok(Core.checkFields('newsletter', 'trivia', { question: 'Who scored the most points in Lakers history?', options: ['Kobe', 'LeBron', 'Kareem', 'Kobe'], answer: 2 }).error, 'trivia: four different answers');
  ok(Core.checkFields('newsletter', 'trivia', { question: 'Who scored the most points in Lakers history?', options: ['Kobe', 'LeBron', 'Kareem', 'West'], answer: 9 }).error, 'trivia: the right answer is 1-4');
  eq(Core.checkFields('newsletter', 'ticker', { label: 'VALUATIONS', category: 'BUSINESS OF SPORTS', headline: 'Lakers sale closes at a record price', summary: 'The deal is the largest in NBA history.', direction: 'sideways' }).fields.direction, 'up', 'ticker: up or down');
  eq(Core.rulesFill('newsletter', 'tag-fi', 'Big NBA night in Phoenix'), { tag: 'NBA' }, 'rules: the sport is the tag');
  eq(Core.rulesFill('newsletter', 'list', 'Top stories', { articles: five.map(a => ({ title: a.text, url: a.url })) }).items.length, 5, 'rules: a list from ES articles');
  eq(Core.rulesFill('newsletter', 'list', 'Top stories', { articles: [] }), null, 'rules: no articles, no list');
  // YouTube (R3).
  const yt = (text, opts) => Core.shortlist(text, 'youtube', opts).map(item => item.value);
  eq(yt('Caitlin Clark is changing the WNBA'), ['variation-1'], 'youtube: one image by default');
  eq(yt('Caitlin Clark is changing the WNBA', { cutouts: 1 })[0], 'variation-2', 'youtube: a player cut-out when there is one');
  eq(yt('Mahomes vs Allen: who wins Sunday', { cutouts: 2 })[0], 'variation-3', 'youtube: two players for a matchup');
  eq(yt('Kelce said "I still love this game"')[0], 'quote', 'youtube: a quote thumbnail');
  eq(Core.checkFields('youtube', 'variation-1', { pills: ['Mahomes', 'Is Back'] }).lines, ['Mahomes', 'Is Back']);
  ok(Core.checkFields('youtube', 'variation-2', { pills: ['a', 'b', 'c'] }).error, 'youtube: two pills max');
  ok(Core.checkFields('youtube', 'quote', { lines: ['x'.repeat(19)] }).error, 'youtube quote: 18 chars a line');
  eq(Core.rulesFill('youtube', 'quote', 'Kelce: "I still love this game"'), { lines: ['I still love this', 'game'] }, 'rules: the quote from the brief');
  eq(Core.rulesFill('youtube', 'variation-1', 'Mahomes is back, again'), { pills: ['Mahomes is back'] }, 'rules: pills from the brief');
  // Acceptance nudge.
  eq(Core.acceptanceBonus({ applied: 4, exported: 4, kept: 4 }), 0, 'needs 5 brief designs');
  ok(Core.acceptanceBonus({ applied: 20, exported: 18, kept: 15 }) > 0, 'often kept: up');
  ok(Core.acceptanceBonus({ applied: 20, exported: 1, kept: 0 }) < 0, 'rarely exported: down');
  ok(Math.abs(Core.acceptanceBonus({ applied: 1000, exported: 1000, kept: 1000 })) <= 0.75, 'bounded');
  const text = 'Chiefs beat Bills 27-24 in overtime';
  const base = Core.shortlist(text, 'instagram').map(item => item.value);
  const nudged = Core.shortlist(text, 'instagram', { stats: { cover: { applied: 40, exported: 40, kept: 40 }, 'team-record': { applied: 40, exported: 0, kept: 0 } } });
  ok(nudged.find(item => item.value === 'cover').bonus > 0 && nudged.find(item => item.value === 'team-record').bonus < 0, 'stats move scores');
  eq(nudged[0].value, base[0], 'rules still lead: a strong rule hit beats a small nudge');
  // Links.
  const links = Core.linksIn('See https://www.essentiallysports.com/nfl-news-x-y/ and https://x.com/espn/status/123 and https://twitter.com/a/status/9 plus https://espn.com/story.');
  eq(links.es, ['https://www.essentiallysports.com/nfl-news-x-y/'], 'ES links');
  eq(links.tweets, ['https://x.com/espn/status/123', 'https://twitter.com/a/status/9'], 'X post links');
  eq(links.other, ['https://espn.com/story'], 'other links (trailing dot dropped)');
  eq(Core.withoutLinks('Make it https://x.com/a/status/1 now'), 'Make it now');
  // Checks.
  eq(Core.checkFields('instagram', 'asap-template-1', { title: 'Tom Brady through the years', rows: ['2000 - Drafted 199th', '2021 - Seventh ring'] }).lines.length, 3, 'timeline ok');
  ok(Core.checkFields('instagram', 'asap-template-1', { title: 'Short', rows: ['2000 - x'] }).error, 'timeline limits');
  ok(Core.checkFields('instagram', 'asap-template-1', { title: 'Tom Brady through the years', rows: Array(7).fill('2000 - Drafted 199th') }).error, 'six rows max');
  eq(Core.checkFields('instagram', 'twitter-quote', { headline: '' }).lines, [], 'tweet headline may be empty');
  ok(Core.checkFields('instagram', 'twitter-quote', { headline: 'x'.repeat(23) }).error, 'tweet headline max 22');
  ok(Core.checkFields('instagram', 'nope', {}).error, 'unknown template');
  // Kept or changed.
  eq(Core.outcome(['LeBron James', 'Drops 41'], ['LEBRON JAMES', 'drops 41']), { kept: true, changed: 0, switched: false }, 'case and spacing are not changes');
  eq(Core.outcome(['LeBron James', 'Drops 41'], ['LeBron James', 'Drops 40']).kept, false, 'an edited line');
  eq(Core.outcome(['A'], ['A'], { template: 'cover', nowTemplate: 'quote' }).switched, true, 'a switched template');
  // Usage stats.
  const stats = Core.statsFromRows([
    { action: 'brief-design', meta: { template: 'cover', ws: 'instagram' } },
    { action: 'brief-design', meta: { template: 'cover', ws: 'instagram' } },
    { action: 'brief-export', meta: { template: 'cover', ws: 'instagram', kept: true } },
    { action: 'brief-export', meta: { template: 'cover', ws: 'instagram', kept: false } },
    { action: 'brief-design', meta: { template: 'x', ws: 'nowhere' } },
    { action: 'other', meta: { template: 'cover', ws: 'instagram' } },
  ]);
  eq(stats, { instagram: { cover: { applied: 2, exported: 2, kept: 1 } } }, 'stats per workspace and template');
  // Rules fills.
  eq(Core.rulesFill('instagram', 'asap-template-1', 'Tom Brady through the years\n2000 - Drafted 199th\n2021 - Seventh ring'), { title: 'Tom Brady through the years', rows: ['2000 - Drafted 199th', '2021 - Seventh ring'] }, 'timeline from dated lines');
  eq(Core.rulesFill('instagram', 'asap-template-1', 'No dates here at all'), null, 'no dates, no timeline');
  eq(Core.rulesFill('instagram', 'twitter-quote', 'LeBron reacts, again https://x.com/a/status/1'), { headline: 'LeBron reacts' }, 'tweet headline from the brief');
  // Prompt list and layouts.
  const list = Core.promptTemplates('instagram', ['cover', 'asap-template-1'], { cover: { shape: '{"pills": [...]}', use: 'Headline post' } });
  ok(/"cover".*Headline post/.test(list) && /pills/.test(list) && /stagger/.test(list) && /rows/.test(list), 'prompt lists Generate and own shapes, with layouts');
  eq(Core.pickLayout('instagram', 'quote', 'logo-top', 0), 'logo-top', 'a valid layout is kept');
  eq(Core.pickLayout('instagram', 'cover', 'nope', 1), 'aligned', 'else the n-th');
  eq(Core.pickLayout('instagram', 'team-record', '', 2), 'default');
  eq(Core.chunkWords('LeBron James drops forty one', 12, 3), ['LeBron James', 'drops forty', 'one']);
}

// ─── 2. Server (mocked) ────────────────────────────────────────────────────
for (const name of ['AI_USER_WEEKLY_LIMIT_USD', 'AI_TEAM_WEEKLY_LIMIT_USD', 'AI_DISABLE', 'AI_DISABLE_FEATURES', 'AI_ECONOMY', 'AI_FAIL_CLOSED', 'SUPABASE_SERVICE_ROLE_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ES_MCP_ACCESS_TOKEN', 'ES_MCP_REFRESH_TOKEN', 'ES_MCP_CLIENT_ID', 'SLACK_AI_ALERTS_WEBHOOK_URL']) delete process.env[name];
process.env.AI_GATEWAY_API_KEY = 'gw-test';
let mySpend = 0;
let wpPost = null;
const fetched = [];
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  fetched.push(href);
  if (href.endsWith('/rpc/frameup_my_ai_spend')) return reply(200, [{ total_usd: mySpend, by_feature: {}, calls: 1 }]);
  if (href.endsWith('/rpc/frameup_team_ai_spend')) return reply(200, [{ total_usd: 0 }]);
  if (href.endsWith('/rpc/frameup_my_ai_calls_last_hour')) return reply(200, 0);
  if (href.includes('/rest/v1/rpc/')) return reply(200, null);
  if (href.includes('/wp-json/wp/v2/posts') && href.includes('slug=')) return reply(200, wpPost ? [wpPost] : []);
  if (href.includes('/wp-json/wp/v2/')) return reply(200, []);
  if (href.startsWith('https://ai-gateway.vercel.sh/')) throw new Error('stop: a real AI call was attempted');
  throw new Error(`offline in tests: ${href}`);
};
const authPath = path.join(root, 'netlify/functions/_supabase-auth.js');
const realAuth = require(authPath);
require.cache[authPath].exports = {
  ...realAuth,
  authConfig: () => ({ url: 'https://db.example.supabase.co', publishableKey: 'pk' }),
  verifyEsUser: async () => ({ ok: true, user: { id: 'u1', email: 'designer@essentiallysports.com' } }),
};
const quiet = { error: console.error, warn: console.warn };
console.error = () => {};
console.warn = () => {};
const Brief = require('../netlify/functions/brief-design.js');
const T = Brief._test;
const call = async body => {
  const res = await Brief.handler({ httpMethod: 'POST', headers: { authorization: 'Bearer tok' }, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

// Mock AI: a queue of replies; each records its prompt.
let aiQueue = [];
let aiCalls = [];
T.deps.aiText = async args => {
  aiCalls.push(args);
  const next = aiQueue.shift();
  if (!next) throw new Error('no mock reply left');
  if (next instanceof Error) throw next;
  return { text: typeof next === 'string' ? next : JSON.stringify(next), cost: 0.0012, model: 'anthropic/claude-haiku-5.5' };
};
let photoCalls = [];
T.deps.findPhotos = async args => {
  photoCalls.push(args);
  return {
    ok: true,
    cost: 0,
    photos: [
      { url: '/api/es-image-search?image=a', sourceUrl: 'https://image-cdn.essentiallysports.com/a.jpg', title: 'LeBron James dunks', verified: true, kind: 'action' },
      { url: '/api/es-image-search?image=b', sourceUrl: 'https://image-cdn.essentiallysports.com/b.jpg', title: 'Anthony Davis', verified: false, kind: 'action' },
      { url: '/api/es-image-search?image=c', sourceUrl: 'https://image-cdn.essentiallysports.com/c.jpg', title: 'LeBron graphic', verified: true, graphic: true },
      { url: '/api/es-image-search?image=d', sourceUrl: 'https://image-cdn.essentiallysports.com/d.jpg', title: 'LeBron James portrait', verified: true, kind: 'portrait' },
    ],
  };
};
T.deps.esCoverage = async () => ({ articles: [{ title: 'LeBron James leads the Lakers past the Suns', url: 'https://www.essentiallysports.com/nba-news-lebron/', date: '2026-11-26', excerpt: 'LeBron scored 41 points.', body: 'He also had 12 assists and 9 rebounds in the 120-112 win.' }] });
T.deps.fetchTweet = async url => ({ url, authorName: 'ESPN', handle: 'espn', text: 'LeBron tonight: 41 points.', dateLabel: 'Nov 26', metrics: '', avatarDataUrl: '', avatarUrl: '', verified: true });

const BRIEF = 'LeBron James drops 41 points, 12 assists and 9 rebounds as the Lakers beat the Suns 120-112';
const STAT = { template: 'player-stat-line', why: 'Three stats from one game', layout: 'default', fields: { firstName: 'LeBron', lastName: 'James', opponent: 'V/S THE SUNS', stats: [{ value: '41', label: 'PTS' }, { value: '12', label: 'AST' }, { value: '9', label: 'REB' }] } };
const COVER = { template: 'cover', why: 'A big headline', layout: 'aligned', fields: { pills: ['LeBron James', 'Drops 41', 'On The Suns'] } };
const RECORD = { template: 'team-record', why: 'The score', fields: { record: '120-112', subline: 'LAKERS BEAT THE SUNS' } };
const reset = () => { aiQueue = []; aiCalls = []; photoCalls = []; fetched.length = 0; mySpend = 0; wpPost = null; };

{
  // Happy path: one AI call, three checked options, a verified photo.
  reset();
  aiQueue.push({ subject: 'LeBron James', sport: 'NBA', team: 'Los Angeles Lakers', options: [STAT, COVER, RECORD] });
  const { status, body } = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  eq(status, 200, 'design: 200');
  eq(aiCalls.length, 1, 'design: ONE AI call');
  eq(aiCalls[0].tier, 'main', 'design: the main (Haiku) tier');
  eq(aiCalls[0].track.feature, 'brief-design', 'design: logged as brief-design');
  ok(aiCalls[0].cacheSystem === true && /player-stat-line/.test(aiCalls[0].system), 'design: the template list is in the cached system prompt');
  ok(/Shortlist from the rules[^\n]*player-stat-line/.test(aiCalls[0].messages[0].content), 'design: the rules shortlist leads the prompt');
  ok(/LeBron James leads the Lakers/.test(aiCalls[0].messages[0].content), 'design: ES facts in the prompt');
  eq(body.options.map(o => o.template), ['player-stat-line', 'cover', 'team-record'], 'design: three options, best first');
  eq(body.options.map(o => o.rank), [0, 1, 2], 'design: ranks');
  eq(body.options[1].layout, 'aligned', 'design: the AI\'s layout is kept');
  eq(body.options[0].team, 'Los Angeles Lakers', 'design: the team (sets colours and logo)');
  ok(body.options.every(o => o.label && o.why && Array.isArray(o.lines) && o.source === 'ai'), 'design: labels, reasons, lines');
  eq(body.photos.map(p => p.url), ['/api/es-image-search?image=a', '/api/es-image-search?image=d'], 'photo: only verified, never a graphic');
  eq(photoCalls[0].person, 'LeBron James', 'photo: the named person');
  eq(photoCalls[0].track.feature, 'brief-design-photo', 'photo: its own feature name');
  eq(body.engine, 'ai', 'engine ai');
  ok(body.costUsd > 0 && body.costUsd < 0.005, `cost under half a cent (${body.costUsd})`);
}

{
  // An invented number: one repair call; then it passes.
  reset();
  const invented = { ...STAT, fields: { ...STAT.fields, stats: [{ value: '50', label: 'PTS' }, { value: '12', label: 'AST' }, { value: '9', label: 'REB' }] } };
  aiQueue.push({ subject: 'LeBron James', sport: 'NBA', team: 'Los Angeles Lakers', options: [invented, COVER, RECORD] });
  aiQueue.push({ options: [STAT] });
  const { body } = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  eq(aiCalls.length, 2, 'repair: one more call');
  eq(aiCalls[1].track.feature, 'brief-design-repair', 'repair: its feature name');
  ok(/50/.test(aiCalls[1].messages[0].content) && /not in the brief/.test(aiCalls[1].messages[0].content), 'repair: the problem is named');
  ok(body.options.some(o => o.template === 'player-stat-line' && o.repaired && o.fields.stats[0].value === '41'), 'repair: the fixed option is used');
  ok(!JSON.stringify(body.options).includes('"50"'), 'repair: the invented number never ships');
}

{
  // Repair also fails: dropped, and the rules fill the gap.
  reset();
  const invented = { ...COVER, fields: { pills: ['LeBron Drops 55'] } };
  aiQueue.push({ subject: 'LeBron James', options: [invented] });
  aiQueue.push({ options: [invented] });
  const { body } = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  ok(!JSON.stringify(body.options).includes('55'), 'still invented: dropped');
  ok(body.options.length >= 1 && body.options.every(o => o.source === 'rules'), 'rules fill in');
}

{
  // Free mode: over the weekly cap, no AI call, the rules design it.
  reset();
  mySpend = 25;
  const { status, body } = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  eq(status, 200, 'free: 200');
  eq(aiCalls.length, 0, 'free: no AI call');
  eq(body.mode, 'free', 'free: the reply says free mode');
  ok(body.notice, 'free: with the notice');
  ok(body.options.length >= 1 && body.options.every(o => o.source === 'rules'), 'free: rules options');
  ok(body.options.some(o => o.template === 'cover'), 'free: a Cover from the brief');
  ok(body.options.every(o => o.lines.join(' ').split(/\s+/).every(word => BRIEF.toLowerCase().includes(word.toLowerCase().replace(/[^a-z0-9-]/g, '')) || /^\|$/.test(word))), 'free: only words from the brief');
}

{
  // The AI fails (timeout): the rules, with a note.
  reset();
  aiQueue.push(new Error('timeout'));
  const { status, body } = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  eq(status, 200, 'AI failure: still a design');
  eq(body.engine, 'rules', 'AI failure: engine rules');
  ok(body.notes.some(n => /did not answer/.test(n)), 'AI failure: a note says so');
}

{
  // X post templates need readable links.
  reset();
  const tweetOption = { template: 'twitter-quote', why: 'A post', fields: { headline: 'LeBron Reacts' } };
  aiQueue.push({ subject: 'LeBron James', options: [tweetOption, COVER] });
  aiQueue.push({ options: [] });
  let res = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  ok(!res.body.options.some(o => o.template === 'twitter-quote'), 'tweet: not without a link');
  reset();
  aiQueue.push({ subject: 'LeBron James', options: [tweetOption, COVER] });
  res = await call({ mode: 'design', workspace: 'instagram', brief: `LeBron reacts to the win https://x.com/espn/status/1234567890` });
  eq(res.body.options[0].template, 'twitter-quote', 'tweet: with a link');
  eq(res.body.tweets[0].authorName, 'ESPN', 'tweet: the post data goes to the page');
  ok(/X posts linked/.test(aiCalls[0].messages[0].content) && /41 points/.test(aiCalls[0].messages[0].content), 'tweet: the post text is in the prompt');
  ok(/twitter-quote/.test(res.body.shortlist[0].value), 'tweet: the matcher leads with it');
}

{
  // The ES article link: read by its slug; its facts back the numbers.
  reset();
  wpPost = { id: 1, date: '2026-11-26T10:00:00', link: 'https://www.essentiallysports.com/nba-news-lebron-41/', title: { rendered: 'LeBron James scores 41 in Phoenix' }, excerpt: { rendered: '<p>A season high.</p>' }, content: { rendered: '<p>He made 15 of 22 shots.</p>' }, yoast_head_json: { og_image: [{ url: 'https://image-cdn.essentiallysports.com/x.jpg' }] } };
  aiQueue.push({ subject: 'LeBron James', options: [{ template: 'cover', why: 'Headline', fields: { pills: ['LeBron James', '15 Of 22'] } }] });
  const { body } = await call({ mode: 'design', workspace: 'instagram', brief: 'Make a post from https://www.essentiallysports.com/nba-news-lebron-41/' });
  ok(fetched.some(h => h.includes('slug=nba-news-lebron-41')), 'link: fetched by slug');
  ok(/LeBron James scores 41 in Phoenix/.test(aiCalls[0].messages[0].content), 'link: the article is in the prompt');
  eq(body.article?.title, 'LeBron James scores 41 in Phoenix', 'link: the article goes back to the page');
  ok(body.options.some(o => o.source === 'ai' && o.lines.includes('15 Of 22')), 'link: a number from the article passes the check');
  eq(T.slugOf('https://www.essentiallysports.com/nfl-news-a-b-c/?utm=1'), 'nfl-news-a-b-c');
  eq(T.slugOf('https://www.essentiallysports.com/'), '');
}

{
  // Own photo: no ES photo search.
  reset();
  aiQueue.push({ subject: 'LeBron James', options: [COVER] });
  const { body } = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF, ownPhoto: true });
  eq(photoCalls.length, 0, 'own photo: no pool search');
  eq(body.photos, [], 'own photo: no ES photos');
  ok(/own photo/.test(aiCalls[0].messages[0].content), 'own photo: the AI is told');
}

{
  // Team acceptance: read with the service role, cached.
  reset();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
  T.STATS.at = 0; T.STATS.ttl = 0;
  let reads = 0;
  T.deps.usageRows = async () => { reads += 1; return [...Array(10)].map(() => ({ action: 'brief-design', meta: { template: 'cover', ws: 'instagram' } })).concat([...Array(10)].map(() => ({ action: 'brief-export', meta: { template: 'cover', ws: 'instagram', kept: true } }))); };
  aiQueue.push({ options: [COVER] });
  let res = await call({ mode: 'design', workspace: 'instagram', brief: 'Caitlin Clark is changing the WNBA forever' });
  ok(res.body.shortlist.find(item => item.value === 'cover')?.bonus > 0, 'stats: an accepted template is nudged up');
  aiQueue.push({ options: [COVER] });
  res = await call({ mode: 'design', workspace: 'instagram', brief: 'Caitlin Clark is changing the WNBA forever' });
  eq(reads, 1, 'stats: cached (one read)');
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  T.STATS.at = 0; T.STATS.ttl = 0;
}

{
  // Rewrite.
  reset();
  const option = { template: 'cover', label: 'Cover Image', why: 'A big headline', layout: 'aligned', fields: COVER.fields, lines: COVER.fields.pills, sport: 'NBA', team: 'Los Angeles Lakers' };
  aiQueue.push({ template: 'cover', fields: { pills: ['LeBron 41', 'Vs Suns'] } });
  let res = await call({ mode: 'rewrite', workspace: 'instagram', brief: BRIEF, how: 'shorter', option });
  eq(res.status, 200, 'rewrite: 200');
  eq(res.body.option.lines, ['LeBron 41', 'Vs Suns'], 'rewrite: the new text');
  eq(res.body.option.layout, 'aligned', 'rewrite: same layout');
  eq(aiCalls[0].track.feature, 'brief-design-rewrite-shorter', 'rewrite: its feature name');
  aiQueue.push({ template: 'cover', fields: COVER.fields });
  res = await call({ mode: 'rewrite', workspace: 'instagram', brief: BRIEF, how: 'punchier', option });
  eq(res.status, 422, 'rewrite: the same text is not a rewrite');
  aiQueue.push({ template: 'cover', fields: { pills: ['LeBron 60'] } });
  res = await call({ mode: 'rewrite', workspace: 'instagram', brief: BRIEF, how: 'formal', option });
  eq(res.status, 422, 'rewrite: an invented number is refused');
  res = await call({ mode: 'rewrite', workspace: 'instagram', brief: BRIEF, how: 'louder', option });
  eq(res.status, 400, 'rewrite: unknown kind');
  mySpend = 25;
  res = await call({ mode: 'rewrite', workspace: 'instagram', brief: BRIEF, how: 'shorter', option });
  ok(res.body.mode === 'free' && res.body.skipped === true, 'rewrite: skipped in free mode');
}

{
  // Newsletter: headline lists link only ES articles research returned; a
  // quote FI only carries words someone said.
  reset();
  T.deps.esCoverage = async () => ({ articles: [1, 2, 3, 4, 5, 6].map(n => ({ title: `Lakers story ${n}: LeBron James scores 41`, url: `https://www.essentiallysports.com/nba-news-story-${n}/`, date: '2026-11-26', excerpt: 'LeBron scored 41 points.', body: '' })) });
  const items = [1, 2, 3, 4, 5].map(n => ({ text: `Lakers story ${n}: LeBron James scores 41`, url: `https://www.essentiallysports.com/nba-news-story-${n}/` }));
  const badItems = [...items.slice(0, 4), { text: 'A story we made up about the Lakers', url: 'https://www.essentiallysports.com/nba-news-made-up/' }];
  aiQueue.push({ subject: 'LeBron James', options: [
    { template: 'list', why: 'A roundup', fields: { items } },
    { template: 'list2', why: 'A simple roundup', fields: { items: badItems } },
    { template: 'ig-player-quote', why: 'His words', fields: { line1: 'I am the best', line2: 'ever' } },
    { template: 'tag-fi', why: 'A feature image', fields: { tag: 'NBA' } },
  ] });
  aiQueue.push({ options: [] });
  const { status, body } = await call({ mode: 'design', workspace: 'newsletter', brief: 'Top Lakers stories this week as LeBron James scores 41' });
  eq(status, 200, 'newsletter: 200');
  ok(/"list"/.test(aiCalls[0].system) && /Tag FI/.test(aiCalls[0].system), 'newsletter: its own template list');
  ok(/nba-news-story-1\//.test(aiCalls[0].messages[0].content), 'newsletter: article links in the prompt');
  eq(body.options[0].template, 'list', 'newsletter: the list with real links');
  ok(!body.options.some(o => o.template === 'list2' && o.source === 'ai'), 'newsletter: a made-up link is refused');
  ok(/not one of the ES articles/.test(aiCalls[1].messages[0].content), 'newsletter: the repair names the bad link');
  ok(!body.options.some(o => o.template === 'ig-player-quote'), 'newsletter: an invented quote is refused');
  ok(body.options.some(o => o.template === 'tag-fi'), 'newsletter: the feature image passes');
  T.deps.esCoverage = async () => ({ articles: [{ title: 'LeBron James leads the Lakers past the Suns', url: 'https://www.essentiallysports.com/nba-news-lebron/', date: '2026-11-26', excerpt: 'LeBron scored 41 points.', body: 'He also had 12 assists and 9 rebounds in the 120-112 win.' }] });
}

{
  // YouTube: player layouts keep their cut-outs, else become one image.
  reset();
  let withCutout = true;
  const realFind = T.deps.findPhotos;
  T.deps.findPhotos = async args => { const res = await realFind(args); return withCutout ? { ...res, cutouts: [{ url: 'https://store.example.com/cutouts/lebron.png', person: args.person }] } : res; };
  const v2 = { template: 'variation-2', why: 'The player over the scene', layout: 'stagger', fields: { pills: ['LeBron Drops 41'] } };
  const v1 = { template: 'variation-1', why: 'One image', fields: { pills: ['Lakers Beat Suns'] } };
  aiQueue.push({ subject: 'LeBron James', options: [v2, v1] });
  let res = await call({ mode: 'design', workspace: 'youtube', brief: BRIEF });
  eq(res.status, 200, 'youtube: 200');
  eq(res.body.options[0].template, 'variation-2', 'youtube: the player layout with a cut-out');
  eq(res.body.cutouts[0].url, 'https://store.example.com/cutouts/lebron.png', 'youtube: the cut-out goes to the page');
  ok(/variation-2/.test(aiCalls[0].system) && /Quote thumbnail/.test(aiCalls[0].system), 'youtube: its own templates');
  reset();
  withCutout = false;
  aiQueue.push({ subject: 'LeBron James', options: [v2, { ...v1, fields: { pills: ['LeBron Drops 41'] } }] });
  res = await call({ mode: 'design', workspace: 'youtube', brief: BRIEF });
  eq(res.body.options[0].template, 'variation-1', 'youtube: no cut-out, one image');
  eq(res.body.options.filter(o => o.lines.join() === 'LeBron Drops 41').length, 1, 'youtube: no duplicate after the fallback');
  reset();
  aiQueue.push({ subject: 'LeBron James', options: [{ template: 'quote', why: 'His words', fields: { lines: ['I Am The', 'Best Ever'] } }] });
  aiQueue.push({ options: [] });
  res = await call({ mode: 'design', workspace: 'youtube', brief: BRIEF });
  ok(!res.body.options.some(o => o.template === 'quote'), 'youtube: an invented quote is refused');
  T.deps.findPhotos = realFind;
}

{
  // Validation and the switch.
  reset();
  eq((await call({ mode: 'design', workspace: 'instagram', brief: ' ' })).status, 400, 'empty brief');
  eq((await call({ mode: 'design', workspace: 'reels', brief: BRIEF })).status, 400, 'unknown editor');

  process.env.AI_DISABLE = 'brief-design';
  const off = await call({ mode: 'design', workspace: 'instagram', brief: BRIEF });
  eq(off.status, 503, 'switched off');
  ok(/Design from a brief is switched off/.test(off.body.error), 'switched off: named in plain words');
  delete process.env.AI_DISABLE;
  eq(aiCalls.length, 0, 'no AI on refusals');
  const get = await Brief.handler({ httpMethod: 'GET', headers: {}, body: '' });
  eq(get.statusCode, 405, 'POST only');
}
console.error = quiet.error;
console.warn = quiet.warn;

// ─── 3. Wiring ─────────────────────────────────────────────────────────────
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  eq((html.match(/<script src="frameup-brief\.js\?v=[^"]+"><\/script>/g) || []).length, 1, 'index.html: one script tag');
  eq((html.match(/<link rel="stylesheet" href="frameup-brief\.css\?v=[^"]+">/g) || []).length, 1, 'index.html: one CSS link');
  ok(!/fu-brief/.test(html.replace(/<script src="frameup-brief\.js[^>]+><\/script>|<link rel="stylesheet" href="frameup-brief\.css[^>]+>/g, '')), 'index.html: no other brief markup');
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  ok(vercel.functions['api/brief-design.js']?.maxDuration >= 15, 'vercel.json: the route');
  ok(/netlify\/functions\/brief-design\.js/.test(fs.readFileSync(path.join(root, 'api/brief-design.js'), 'utf8')), 'api adapter');
  const gw = require('../netlify/functions/_ai-gateway.js');
  ok(/Design from a brief/.test(gw.featureOffMessage('brief-design-rewrite-shorter')), 'FEATURE_NAMES covers every brief-design call');
  const spec = fs.readFileSync(path.join(root, 'frameup-spec.js'), 'utf8');
  ok(/setOrigin/.test(spec) && /originProvider\(\)/.test(spec) && /brand, setOrigin/.test(spec), 'spec bridge: origin hook and brand step');
  const client = fs.readFileSync(path.join(root, 'frameup-brief.js'), 'utf8');
  ok(/load\('frameup-brief-core\.js'\)/.test(client) && /load\('frameup-brief-apply\.js'\)/.test(client) && /\?v=\$\{VERSION\}/.test(client), 'client: loads its own files with its own cache key');
  ok(/if \(!IN_FRAME && !enabled\(\)\) return;/.test(client), 'client: flag off loads nothing');
  ok(/setOrigin\?\.\(originNow\)/.test(client) && /'brief-export'/.test(client) && /'brief-design'/.test(client), 'client: learning rows and export origin');
  const apply = fs.readFileSync(path.join(root, 'frameup-brief-apply.js'), 'utf8');
  ok(!/\beval\(/.test(apply), 'appliers: no eval');
  ok(/metrics: tweet\.metrics \|\| ''/.test(apply), 'appliers: never the tweet card\'s sample numbers');
}

console.log(`brief design tests: ${passed} passed`);
