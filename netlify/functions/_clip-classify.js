'use strict';
// Is a clip great game footage? Video Ads only shows game action (plays,
// highlights, scoring moments, on-field celebrations), never podcasts,
// pressers, talk shows, graphics-only promos or memes.
//
//   classifyClips(clips, opts)  one cheap AI Gateway vision call per batch of
//       up to 8 clips: the post text plus the video thumbnail. Model: the main
//       tier (Claude Haiku 5.5, $0.10 / $0.50 per M tokens, vision; on
//       2026-11-18 the live Gateway list had nothing cheaper with vision that
//       FrameUp already prices: Gemini 2.5 Flash-Lite is the same input price).
//       -> Map(url -> { isGameAction, quality 1-5, subject[], label, by: 'ai', model, at })
//       A batch whose image fails is retried once as text only.
//   heuristic(clip)  the free fallback when AI is off or over budget: the
//       source (official / league / network), length 6-90 s and keywords.
//       -> { isGameAction, quality, subject, label, by: 'rules' }
//   verdictOf(clip)  the stored AI verdict, else the heuristic.
//   isGreat(clip)    what lists show: game action (AI says so, or the rules
//                    do when no AI verdict exists yet).
//
// The verdict is cached forever per clip URL: in the clip library row (`ai`
// jsonb, migration 20261118121800) and in memory. The daily prefetch does the
// classifying (budget CLIPS_CLASSIFY_MAX_USD, default $0.30/day), so searches
// never wait or pay for it. AI_DISABLE=clips-classify switches it off.
const { aiText, gatewayConfigured, featureDisabled } = require('./_ai-gateway.js');

const FEATURE = 'clips-classify';
const BATCH = 8;
const EST_USD_PER_BATCH = 0.003; // reserved before a call: ~11k input tokens (8 small thumbnails) + ~600 output on Haiku 5.5
const MEMO = new Map(); // url -> verdict (per instance, forever)
const MEMO_MAX = 5000;

const str = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ── Rules ─────────────────────────────────────────────────────────────────
const NOT_GAME = /\b(podcast|episode|ep\.?\s?\d|full show|the show|on air|live show|livestream|stream(?:ing)? now|press conference|presser|media availability|availability|interview|sits? down with|joins us|joined|speaks? (?:to|with|on|about)|talks?(?: about| with)?|discuss(?:es|ing)?|q&a|ama|mic['’]?d up podcast|reacts?|reaction|breakdown|film (?:room|study)|analysis|preview show|mailbag|tickets?|on sale|giveaway|merch|shop now|presented by|sponsored|schedule (?:release|reveal)|wallpaper|graphic|poster|uniform reveal|meme|caption this|vote now|birthday|happy birthday)\b/i;
const GAME = /\b(touchdown|td|pick[- ]?six|interception|int\b|sack|fumble|field goal|fg\b|2-?pt|two-point|kick return|punt return|one-handed|catch|grab|run|rushing|scramble|dime|bomb|deep ball|hail mary|walk-?off|home run|homer|hr\b|grand slam|strikeout|struck out|k'?s\b|no-hitter|double play|diving|robbed|steal|rbi|go-ahead|game-winning|game winner|clutch|comeback|highlights?|play of the (?:day|game)|what a (?:play|catch|throw|run|grab|hit)|scores?|scoring|goal line|end zone|celebrat\w*|innings?|scoreless|strikeouts?|fans (?:\w+ )?(?:\d+|two|three|four|five|six|seven|eight|nine|ten)|single|double|triple|base hit|pitch(?:es|ing)?|throws?|pass(?:es)?|connects|hauls? in|picked off|picked)\b/i;
// Added 2026-11-19: baseball and college football play words from MLB.com and
// ESPN clip titles ("tosses 5 2/3 scoreless innings", "connects for 9-yard TD
// pass"), which the rules missed when a clip ran past 90 s.

function heuristic(clip = {}) {
  const text = `${clip.text || ''}`;
  const kind = clip.sourceKind || (clip.source === 'other' ? 'fan' : clip.source) || 'fan';
  const secs = Number(clip.durationMs || 0) / 1000 || Number(clip.duration || 0);
  const side = Number(clip.shortSide) || 0;
  const notGame = NOT_GAME.test(text);
  const game = GAME.test(text);
  const trusted = ['official', 'league', 'media'].includes(kind);
  const lengthOk = secs >= 6 && secs <= 90;
  const isGameAction = !notGame && (game || (trusted && lengthOk));
  let quality = 2;
  if (isGameAction) {
    quality = 3;
    if (game && trusted) quality += 1;
    if (side >= 1080) quality += 1;
  } else if (notGame) quality = 1;
  return {
    isGameAction,
    quality: Math.max(1, Math.min(5, quality)),
    subject: (Array.isArray(clip.teams) ? clip.teams : []).slice(0, 3),
    label: notGame ? 'not game action' : game ? 'game action' : trusted && lengthOk ? 'likely game action' : 'unclear',
    by: 'rules',
  };
}

function normalizeVerdict(raw, { model = '', at = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const quality = Math.round(Number(raw.quality));
  if (typeof raw.isGameAction !== 'boolean' || !(quality >= 1 && quality <= 5)) return null;
  const subject = (Array.isArray(raw.subject) ? raw.subject : typeof raw.subject === 'string' ? [raw.subject] : [])
    .map(s => str(s, 60)).filter(Boolean).slice(0, 4);
  return { isGameAction: raw.isGameAction, quality, subject, label: str(raw.label, 60), by: 'ai', model: str(model, 60), at };
}

// The stored verdict (AI) if there is one, else the rules.
function verdictOf(clip = {}) {
  const stored = clip.ai && typeof clip.ai === 'object' ? clip.ai : MEMO.get(clip.url);
  if (stored && typeof stored.isGameAction === 'boolean') return stored;
  return heuristic(clip);
}
const isGreat = clip => verdictOf(clip).isGameAction === true;

// ── AI ────────────────────────────────────────────────────────────────────
const SYSTEM = [
  'You sort sports video posts for EssentiallySports newsletter ads. Only real game footage may be used.',
  'For each post you get its text and, when available, a frame from the video.',
  'isGameAction is true only for game action: plays, highlights, scoring moments, big defensive plays, on-field or in-stadium celebrations during or right after a game.',
  'isGameAction is false for podcasts, studio or talk shows, press conferences and interviews, practice-only b-roll, graphics-only promos, schedule or ticket posts, memes, and fan reaction videos.',
  'quality 1-5: how strong the clip is for an ad (5 = a clear, exciting, well-shot play; 1 = unusable).',
  'subject: the teams or players the post text names (never guess names that are not in the text).',
  'label: 2-5 words, e.g. "touchdown catch", "walk-off home run", "press conference".',
  'Reply with JSON only: {"clips":[{"i":1,"isGameAction":true,"quality":4,"subject":["..."],"label":"..."}]}',
].join('\n');

// pbs.twimg.com thumbnails have a small rendition: fewer image tokens.
function thumbFor(clip) {
  const raw = String(clip.thumb || clip.thumbnail || '');
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return '';
    if (u.hostname === 'pbs.twimg.com') { u.searchParams.set('name', 'small'); }
    return u.toString();
  } catch { return ''; }
}

function batchMessages(batch, { images = true } = {}) {
  const content = [];
  batch.forEach((clip, k) => {
    const secs = Math.round(Number(clip.durationMs || 0) / 1000);
    content.push({ type: 'text', text: `${k + 1}. @${str(clip.handle, 40) || clip.platform || 'post'}${secs ? ` (${secs}s)` : ''}: ${str(clip.text, 280) || '(no text)'}` });
    const thumb = images ? thumbFor(clip) : '';
    if (thumb) content.push({ type: 'image', source: { type: 'url', url: thumb } });
  });
  content.push({ type: 'text', text: `Classify all ${batch.length} posts.` });
  return [{ role: 'user', content }];
}

function parseReply(text, batch, model) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  let data = null;
  for (let end = raw.length; end > start && start >= 0; end -= 1) {
    if (raw[end - 1] !== '}') continue;
    try { data = JSON.parse(raw.slice(start, end)); break; } catch { /* shrink */ }
  }
  const out = new Map();
  (Array.isArray(data?.clips) ? data.clips : []).forEach(item => {
    const k = Number(item?.i) - 1;
    if (!Number.isInteger(k) || k < 0 || k >= batch.length) return;
    const v = normalizeVerdict(item, { model });
    if (v) out.set(batch[k].url, v);
  });
  return out;
}

// clips -> { verdicts: Map(url -> verdict), cost, calls, failed, skipped }
// maxUsd: the budget for this call; each batch reserves EST_USD_PER_BATCH first.
// track: { feature, email, token, runId } (aiText logs through it when it has
// a token); onCost(cost, model) lets the cron log with the service role.
async function classifyClips(clips, { maxUsd = 0.3, track = {}, onCost = null, batchSize = BATCH, concurrency = 3 } = {}) {
  const todo = [];
  const seen = new Set();
  (clips || []).forEach(c => {
    if (!c?.url || seen.has(c.url)) return;
    seen.add(c.url);
    if (c.ai && typeof c.ai.isGameAction === 'boolean') return;
    if (MEMO.has(c.url)) return;
    todo.push(c);
  });
  const result = { verdicts: new Map(), cost: 0, calls: 0, failed: 0, skipped: 0 };
  if (!todo.length) return result;
  if (!gatewayConfigured() || featureDisabled(FEATURE)) { result.skipped = todo.length; return result; }
  // Batches that fit the budget (each reserves its estimate up front, so
  // parallel calls can never overshoot); the rest wait for the next run.
  const batches = [];
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize));
  const affordable = Math.max(0, Math.floor((maxUsd + 1e-9) / EST_USD_PER_BATCH));
  batches.slice(affordable).forEach(b => { result.skipped += b.length; });
  const run = batches.slice(0, affordable);
  const one = async batch => {
    for (const images of [true, false]) {
      try {
        result.calls += 1;
        const reply = await aiText({
          tier: 'main', system: SYSTEM, messages: batchMessages(batch, { images }), json: true, maxTokens: 900, timeoutMs: 20000,
          track: { ...track, feature: FEATURE },
        });
        result.cost += Number(reply.cost) || 0;
        if (onCost) await onCost(Number(reply.cost) || 0, reply.model);
        parseReply(reply.text, batch, reply.model).forEach((v, url) => {
          result.verdicts.set(url, v);
          MEMO.set(url, v);
          while (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
        });
        return;
      } catch (error) {
        if (images === false) result.failed += batch.length;
      }
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, run.length) }, async () => {
    while (next < run.length) { const b = run[next]; next += 1; await one(b); }
  }));
  result.cost = Number(result.cost.toFixed(6));
  return result;
}

module.exports = { FEATURE, BATCH, EST_USD_PER_BATCH, heuristic, verdictOf, isGreat, classifyClips, normalizeVerdict, thumbFor, _test: { MEMO, parseReply, batchMessages, SYSTEM } };
