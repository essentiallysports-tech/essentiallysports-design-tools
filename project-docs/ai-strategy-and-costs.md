# FrameUp AI: strategy, costs and the creative powerhouse plan

Written 2026-11-17 from the code on local `main` (plus the uncommitted Generate/Video Ads work). Read-only research: no code was changed.

**Sources:**
- `netlify/functions/_ai-gateway.js`, `es-generate.js`, `_creative-director.js`, `es-generate-image.js`, `trend-design.js`, `video-ads.js`, `_ad-rating.js`, `ad-rating.js` and `es-video-intelligence.js`;
- the clients `generate.html` and `video-ads.js`;
- `supabase/migrations/*ai*`;
- `project-docs/generate-creative-brain-research.md`.

**Real usage numbers:** `frameup_ai_usage` is admin-only (RLS), and no service key is in the repo, so I could not read real rows. Every number below is estimated from prompt sizes in the code (about 4 characters per token) and the Gateway prices in `PRICES`. Section D1 adds what is needed to replace these estimates with measured ones. **Re-run the tables in A against one week of real rows before acting on B1.**

---

## TL;DR

1. **The bill is small, and the risk is the cap, not the spend.**
   - A typical active editor costs about **$0.45 a week, about $1.90 a month**.
   - That gives roughly **$19, $48 and $97 a month** at 10, 25 and 50 active users.
   - The per-person cap is $20 a week, which is about 45× typical use. At 50 users the theoretical ceiling is about **$4,300 a month**. There is no team-wide cap and no alerting.
2. **Two items make up about 80% of spend:**
   - Sonnet 5.5 calls, about **52%**: the new creative director (on by default), escalations and "Best version".
   - Web search in Video Ads "Find clips", about **29%**, at $0.01 a search.
   - Haiku, the review model, gpt-oss and images together are under 20%.
3. **Biggest saving: let Haiku direct, and escalate to Sonnet only when Haiku's concepts are weak.** It is an env flip plus about 25 lines, and cuts about 35% of spend. It must pass `npm run eval:generate` first (guardrails in F).
4. **Prompt caching may not be doing anything yet, and nobody can tell.**
   - `logUsage` drops the cache-read and cache-write token counts.
   - `anthropicCall` silently retries without `cache_control` when the Gateway returns 400.
   - The Video Ads `COPY_SYSTEM` is about 440 tokens, under Haiku 5.5's 512-token minimum, so it never caches.
   - Fix the logging before tuning anything else.
5. **Most "powerhouse" features cost under a tenth of a cent per use** on Haiku. The best ones need no new model at all:
   - captions and alt-text added to the writer call;
   - one-click repurposing;
   - brand checks on manual designs, using the existing `_lint-spec.js`;
   - a weekly Slack trend digest for about $0.05 a month.
6. **Self-hosting never pays at this scale.** Revisit only if a single task passes $2k a month.

---

## A. Current AI inventory

### A1. Prices used (USD per 1M tokens, from `_ai-gateway.js` `PRICES` / `IMAGE_PRICES`)

| Tier (`MODELS`) | Model | In / Out | Cache read / write | Notes |
|---|---|---|---|---|
| `light` | `openai/gpt-oss-20b` | 0.03 / 0.14 | none | Reasoning model: hidden reasoning tokens bill as output |
| `main` | `anthropic/claude-haiku-5.5` | 0.10 / 0.50 | 0.01 / 0.125 | Thinking is adaptive by default; calls send `effort: 'low'` |
| `search` | `anthropic/claude-haiku-5.5` + `web_search_20250305` | as main, plus **$0.01 per search** | | Search results come back as input tokens (about 5–10k per search) |
| `review` | `openai/gpt-6-luna` | 0.10 / 0.50 | none | Different model family on purpose |
| `best` | `anthropic/claude-sonnet-5.5` | 2 / 10 | 0.20 / 2.5 | Anthropic's list price for Sonnet 5.5 cache reads is $0.10. Check the Gateway's price and fix `PRICES` if it is lower |
| `image` | `bfl/flux-3-image-klein` | $0.011 per image | | |
| backup | Groq gpt-oss-120b / 20b / qwen, Whisper | $0 (free tier) | | Logged as `<feature>-backup` with cost 0 |
| outside Gateway | OpenAI `gpt-4o-transcribe` (Reels) | about $0.006 per audio minute | | Only if `OPENAI_API_KEY` is set. **Not logged** to `frameup_ai_usage` |

### A2. Every AI call in the product

Token counts are typical; "out" includes thinking and reasoning tokens.

| # | Feature (`feature` in usage) | Code | Model / settings | Trigger | Typical tokens in / out | Cost per call | Caching today |
|---|---|---|---|---|---|---|---|
| 1 | `generate` (writer) | `es-generate.js` `chat()` L844 | Haiku, effort low, max 6000 | User: Generate, "More like this", per-card regenerate | about 2.2k static + 1.5–2.5k request / about 1.5k | **$0.0011–0.0013** | Prompt cache on the static prefix before `PROMPT_CACHE_BREAK`. The prefix differs per format choice (9 variants). No response cache |
| 2 | `generate` (repair round) | `es-generate.js`, `repairPrompt` | Haiku | Automatic, in about 30% of runs | about 1.5k / 0.6k | $0.00045 | None: no cache break in the repair prompt |
| 3 | `generate-director` | `_creative-director.js` `runDirector` L376 | **Sonnet by default** (`directorTier()` returns `best`), effort low, max 1400. Retries once on Haiku if the call fails | Automatic in Generate when `want ≥ 2` and research took under 9s | about 0.95k system (cached) + about 2.6k / about 0.7k | **$0.012–0.014** on Sonnet; $0.0006 on Haiku | System prompt cached; no response cache (by design) |
| 4 | `generate-photo-pick` | `es-generate.js` `pickPhoto` L1140 | Haiku vision, 2–5 image URLs at full size, max 2000 | Automatic when the template needs a photo and there are 2 or more candidates | about 5–8k (images) / about 0.1k | $0.0007 | None |
| 5 | `generate-review` | `reviewDesigns` L1191 | gpt-6-luna, JSON | Automatic on every Gateway run | about 0.8k / 0.15k | $0.00016 | None |
| 6 | `generate-escalate` | `escalateDesigns` L1233 | Sonnet, effort medium, up to 2 cards | Automatic when a card's review score is under 3.5 (p ≈ 0.2–0.4 per run) | about 1.8k / 0.3–0.6k | $0.0066–0.010 | None |
| 7 | `generate-rewrite-{punchier,shorter,angle}` | `es-generate.js` L1595 | Haiku | User click | about 1.2k / 0.4k | $0.0003 | None |
| 8 | `generate-rewrite-best` | same | Sonnet, effort medium | User click | about 1.2k / 0.8k | $0.010 | None |
| 9 | `generate-scene-image` | `es-generate-image.js` L62 | flux-3-image-klein | User click | 1 image | $0.011 | None |
| 10 | `trend-headlines` | `trend-design.js` `aiTitles` L300 | gpt-oss-20b, max 1500 | **Automatic**: one call per trend card as it scrolls into view (`generate.html` L704) | about 0.35k / about 0.3k | $0.00005 | Per-instance `Map` (no TTL) plus the browser's `sessionStorage`. Not shared across users or cold starts |
| 11 | `video-ads-copy` | `video-ads.js` `copy()` L567 | Haiku, `cacheSystem: true` | User: "Write copy". One automatic retry when fewer than 2 variants pass | about 1.5k / 0.6k (×1.3 average) | $0.0006 | `COPY_SYSTEM` is about 440 tokens, **below the 512 minimum, so it never caches** |
| 12 | `video-ads-chat` | `chat()` L619 | Haiku | User message (history capped at 12) | about 1.5–3k / 0.3k | $0.0004 | None: the system prompt embeds per-request context |
| 13 | `video-ads-grammar` | `grammar()` L735 | gpt-oss-20b | User click | about 0.4k / 0.3k | $0.00005 | Response cache, 10 min, per instance, exact copy as the key |
| 14 | `video-ads-find-clips` | `findClips()` L263 | Haiku + up to 2 web searches, max 900, **hard cap $0.03** | User click (team, colour or moment) | about 10–20k / 0.9k | **$0.02–0.03** | Response cache, 15 min, **per instance** (in memory) |
| 15 | `moments-with-clips` | `momentsWithClips()` L362 | Haiku + up to 3 searches, cap $0.03 | Server mode only; the v2 client no longer calls it | | up to $0.04 | 15 min, per instance |
| 16 | `video-ads-rating` | `_ad-rating.js` `rateCreative` L481 | Haiku vision, 4 frames at 540px, `cacheSystem` (about 1.6k tokens, caches) | User. The rating UI was removed in Video Ads v2; the endpoint is still live | about 4.5–5k / about 1.2k (×2 if invalid) | $0.0011 | System prompt cached |
| 17 | Reels transcription | `es-video-intelligence.js` | OpenAI `gpt-4o-transcribe`, else Groq Whisper (free) | User | per minute of audio | about $0.006 a minute, or $0 | **Not logged** |

Limits today (`_ai-gateway.js`):
- 120 AI calls per person per hour (`AI_USER_HOURLY_LIMIT`). The automatic trend headlines count against it.
- $20 per person per week (`AI_USER_WEEKLY_LIMIT_USD`).
- The Gateway key's own weekly cap, set in Vercel.
- Both per-person checks **fail open**.

Kill switch: `GENERATE_AI=rules` turns the Gateway off everywhere through `gatewayConfigured()`. There is no per-feature switch.

### A3. Cost per Generate run (4 designs, defaults today)

| Step | p (how often) | $ | Expected $ |
|---|---|---|---|
| Director (Sonnet) | 0.85 | 0.013 | 0.0111 |
| Writer (Haiku) | 1 | 0.0012 | 0.0012 |
| Repair | 0.3 | 0.00045 | 0.00014 |
| Photo pick | 0.8 | 0.0007 | 0.00056 |
| Review (luna) | 1 | 0.00016 | 0.00016 |
| Escalation (Sonnet) | 0.3 | 0.0075 | 0.00225 |
| **Total** | | | **≈ $0.0153 (1.5¢)**. About 73% is the director and about 15% the escalation |

### A4. Monthly cost at 10 / 25 / 50 active users

"Typical active editor" per week:
- 15 Generate runs and 5 "More like this";
- 8 quick rewrites and 2 "Best version";
- 3 scene images;
- about 60 automatic trend headlines;
- in Video Ads: 6 copy runs, 10 chat turns, 4 grammar checks, and 8 clip searches (about 25% served from cache, so 6 billed).

"Heavy" is 3× that.

| Line item | $ per user per week | Share |
|---|---|---|
| Generate runs (15 × $0.0153) | 0.230 | 52% |
| More like this (5 × about $0.004) | 0.020 | 4% |
| Rewrites (8 × $0.0003 + 2 × $0.010) | 0.022 | 5% |
| Scene images (3 × $0.011) | 0.033 | 7% |
| Trend headlines (60 × $0.00005) | 0.003 | 1% |
| Video Ads copy, chat and grammar | 0.008 | 2% |
| **Find clips (6 × $0.022)** | **0.130** | **29%** |
| **Total** | **≈ $0.45 a week, ≈ $1.93 a month** | |

Sonnet calls in total (director, escalation, "Best version") ≈ **$0.23 a week, 52%**. Web search ≈ **29%**.

| Active users | Typical, per month | Heavy (3×), per month | **Theoretical ceiling** ($20/week cap × 4.33) |
|---|---|---|---|
| 10 | **$19** | $58 | $866 |
| 25 | **$48** | $145 | $2,165 |
| 50 | **$97** | $290 | $4,330 |

The gap between "typical" and "ceiling" is the real exposure. A stuck client loop, a shared login or a scripted caller could reach it, because both per-person checks fail open.

After the top-10 levers in B, typical spend drops to about **$0.24 per user per week** (≈ $10 / $26 / $52 a month), and the ceiling to about $1,000 a month total with a team cap.

---

## B. Top 10 cost savings, ranked by $ saved per unit of effort

Effort: S is under 2 hours, M is half a day to a day, L is 2 days or more. Savings are as a share of the typical bill in A4.

### B1. Haiku directs by default; escalate to Sonnet only on weak concepts. Saves about 35% (≈ $0.16 per user per week). Effort S

**File:** `netlify/functions/_creative-director.js`.

**Change:**
1. Flip the default in `directorTier()` (L35) so that unset means `'main'`. `GENERATE_DIRECTOR_MODEL=sonnet` keeps today's behaviour.
2. In `runDirector` (L366+), invert the retry. Ask `main` first. Re-ask `best` once, while `now() - startedAt < retryByMs`, when either:
   - the call failed for a non-budget reason; or
   - `validateConcepts(...)` returned fewer than `Math.min(want, 2)` concepts.
3. Add `source: 'sonnet-escalated'`.

```js
// _creative-director.js
function directorTier(value = process.env.GENERATE_DIRECTOR_MODEL || process.env.GENERATE_DIRECTOR_TIER || '') {
  const wanted = String(value).trim().toLowerCase();
  return /^(?:best|sonnet)$/.test(wanted) ? 'best' : 'main';   // was: default 'best'
}
// in runDirector, after validateConcepts:
const enough = concepts.length >= Math.min(want, 2);
if (!enough && tier === 'main' && now() - startedAt < retryByMs) { /* ask('best') once, re-validate, source = 'sonnet-escalated' */ }
```

**Gate:** the research doc (§G, last line) already plans this flip "if the eval shows Haiku directing nearly as well". Run `npm run eval:generate` on both tiers. Ship only if all three hold:
- the Haiku director's mean review score is at least the Sonnet score minus 0.15;
- `lintStats.passedFirst` is not lower;
- the escalation rate is not up by more than 10 points.

**Tests:**
- Update `scripts/test-creative-director.mjs` for the new default.
- Add a test that two invalid Haiku concepts trigger exactly one Sonnet call.

### B2. A team weekly cap, a lower per-person cap and spend alerts. Caps the ceiling from $4,330 to about $1,000 a month. Effort S–M

Mostly risk control, not average savings.

**Files:**
- `_ai-gateway.js`;
- a new migration `supabase/migrations/2026112xxxxxxx_frameup_ai_team_spend.sql`;
- the env vars below.

**Changes:**
1. **Per-person cap.** Set `AI_USER_WEEKLY_LIMIT_USD=5`. That is 11× typical use, and 3.7× the heavy profile's about $1.35 a week.
2. **Team cap.** Add `AI_TEAM_WEEKLY_LIMIT_USD=` (suggest $60 at 25 users) and a `security definer` RPC `frameup_team_ai_spend(p_since)` that returns only the total, callable by `is_es_designer_domain_user()`. Then add `teamOverWeeklyLimit(token)`, mirroring `userOverWeeklyLimit`, and check it in the same `Promise.all` in each handler: `es-generate.js` L1643/1654, `video-ads.js` L775, `trend-design.js` L516, `ad-rating.js` L72 and `es-generate-image.js` L57.
3. **Fail closed on cost.** Keep failing open on database errors, but cache the last known weekly total per user in memory for 60s, so a flapping database cannot unlock unlimited calls.
4. **Slack alert on spikes.** In `logUsage`, when `row.cost_usd > 0.05` or a user crosses 50% or 100% of their cap, post to a **new** `SLACK_AI_ALERTS_WEBHOOK_URL`. Fire-and-forget, with a 2s timeout. Never reuse `SLACK_DESIGN_REQUEST_WEBHOOK_URL`.

**Tests:** extend `scripts/test-ai-weekly-limit.mjs` with team-over-limit leading to a 429 with `reason: 'team-limit'`.

### B3. A shared clip cache plus "one search first". Saves about 15–18% (≈ $0.07 per user per week). Effort M

**Files:**
- `video-ads.js` (`findClips` L222–268 and `momentsWithClips`);
- a new `netlify/functions/_ai-cache.js`;
- a new migration `frameup_ai_cache` (see D2).

**Changes:**
1. **Share the cache.** Replace the per-instance `CLIP_CACHE` `Map` with `_ai-cache.js`: an in-memory first layer, then the Supabase table. Keep today's key, `${sport}|team:${name}` / `color:` / `query:`, with the query lower-cased, whitespace collapsed, and leading "the" and punctuation stripped. Raise the TTL to 30 min; it is safe because `reAge()` already drops clips that pass 72h on read.
   - Team and colour searches overlap heavily across editors: 32 NFL teams, 8 colours.
   - Expected hit rate moves from about 25% to about 60%, so billed searches fall from 6 to about 3.2 per user per week.
2. **One search first.** For team and colour modes, set `maxUses: 1` and run a second capped call only when fewer than `FIND_CLIPS.minClips` (3) verified clips come back. Expect about 40% of misses to stop after one search ($0.011 instead of $0.022).

**Tests (`scripts/test-video-ads.mjs`):**
- a cache hit on a second "instance" (clear the in-memory layer and stub the table) costs 0;
- a team search with 3 or more clips from one search makes exactly one gateway call.

### B4. Make caching measurable: log cache tokens, task and run id. Saves $0 directly, but every later lever depends on it. Effort S

**Files:**
- `_ai-gateway.js`;
- a migration adding columns to `frameup_ai_usage`;
- `dashboard-data.js` `fetchAiUsage` (add the new columns to the select).

**Changes:**
1. Add the columns: `cache_read_tokens int default 0`, `cache_write_tokens int default 0`, `run_id text`, `cached boolean default false` (a response-cache hit, logged as a $0 row) and `task text`.
2. In `aiText` and `aiWebResearch`, pass `result.usage.cacheRead` and `cacheWrite` into `logUsage`.
3. In `anthropicCall`, when the cache-hint retry on 400 fires, log it once per cold start (`console.warn('[ai] gateway rejected cache_control')`). Otherwise a rejected hint silently doubles requests and caching looks "on" when it is off.

**One-off check (admin, about $0.03):** call the director twice, 10s apart, with the same system prompt. `cache_read_tokens` must be above 0 on the second call. If it is 0, the Gateway is not passing `cache_control`. Then either send `providerOptions: { anthropic: { cacheControl } }` on the Gateway, per the Vercel docs at build time, or accept no caching. On Haiku it is worth under $0.02 per user per month anyway.

**Tests:** `scripts/test-es-generate-fast.mjs` already stubs usage. Assert that `cache_read_tokens` is written.

### B5. Tighten the Sonnet escalation. Saves about 5% (≈ $0.02 per user per week). Effort S

**File:** `es-generate.js`, L1172–1173 (`REVIEW_PASS = 3.5`, `ESCALATE_MAX = 2`).

**Change:** `REVIEW_PASS = 3.2` and `ESCALATE_MAX = 1`. Only the single weakest card escalates. Escalation probability falls from about 0.3 to about 0.15, and cost when it fires from about $0.0075 to about $0.0055.

**Gate:** in `eval:generate`, the share of cards scoring under 3.5 after review may rise by at most 5 points.

**Alternative, if the eval is mixed:** escalate first on `main` at `effort: 'medium'` (about $0.001), and go to Sonnet only if the re-review is still under 3.2. That adds one review call ($0.00016).

### B6. Per-feature kill switches and a monthly soft budget. Saves $0 normally; caps incidents. Effort S

**File:** `_ai-gateway.js` (`aiText`, `aiWebResearch`, `aiImage`).

```js
const DISABLED = new Set(String(process.env.AI_DISABLE_FEATURES || '').split(',').map(s => s.trim()).filter(Boolean));
// at the top of aiText / aiWebResearch / aiImage:
if (track?.feature && [...DISABLED].some(f => track.feature === f || track.feature.startsWith(`${f}-`))) {
  throw Object.assign(new Error('This AI feature is paused.'), { status: 503, code: 'feature-paused' });
}
```

- Callers already fall back on any throw: Groq, rules, the old path, or a calm error.
- Examples: `AI_DISABLE_FEATURES=video-ads-find-clips,generate-scene-image,generate-escalate`.
- Add `AI_FORCE_TIER_BEST=main`, which remaps `best` to `main`. It is a one-env "economy mode" for the last days of a month.

**Tests:** a new `scripts/test-ai-gateway-switches.mjs`. A disabled feature throws before any fetch; a non-matching feature calls through.

### B7. Cache scene images by normalised scene. Saves about 2–3%. Effort M

**Files:** `es-generate-image.js`, `_ai-cache.js`, and Supabase Storage (the bucket used by AI images; see `project-docs/ai-images-es-storage.md`).

**Change:**
- Key: `sha1(sceneText.toLowerCase().replace(/\s+/g,' ').trim() + '|' + size)`.
- On a hit, return the stored public URL at $0. On a miss, generate, upload, then store `{key → url}` with no TTL.
- Scenes are deliberately generic ("empty football stadium at night under bright floodlights"), so repeats are common. Assume a 30% hit rate.
- Offer "New image" in the UI to bypass the cache.

**Tests:** the second identical request makes no `aiImage` call.

### B8. Trend headlines: shared, batched, and not counted against the hourly cap. Saves about 1% in $, plus about 60 calls and rows per user per week. Effort M

**Files:** `trend-design.js` (`aiTitles` L289 and the GET trends path L467–486), `generate.html` L704–760.

**Changes:**
1. When the trend list refreshes (every 5 min, `CACHE_MS`), run **one** light call for the top 20 trends without cached titles. One JSON reply holds 20 × 4 titles: about 3k in and 3k out, about $0.0005. Store the results in `frameup_ai_cache` under `titles|${sport}|${title}` with a 48h TTL, and return them inside the GET payload.
2. The client renders titles from the payload and only POSTs `mode: 'titles'` for cards that are missing them.
3. Track these calls with `feature: 'trend-headlines-batch'` under a system email, `ai-system@`, so they do not count against any one editor's 120-call hourly cap.
   - **Decision for Suhail:** the insert policy needs the user's own JWT, so this needs either a service-role key in env (none exists today) or a security-definer `frameup_log_system_ai_usage` RPC guarded by a shared secret.

**Tests:** `scripts/test-trend-design.mjs`: one gateway call for N trends, then zero calls on the next GET.

### B9. Smaller photo-pick images, and skip the pick when the answer is obvious. Saves about 1–2%. Effort S

**File:** `es-generate.js` `pickPhoto` (L1134) and `photoCandidates`.

**Changes:**
1. Send each candidate through the existing image proxy (`proxied(...)`) at about 512px wide, instead of `sourceUrl` at full size. Vision tokens are about width × height / 750, so this is roughly 350 tokens instead of 1.2–1.6k per image: about 70% fewer input tokens.
2. Skip the call when exactly one candidate is an agency image whose title contains the person's full name.
3. Set `maxTokens: 300`, since the reply is `{"best": n}`.

**Tests:** `scripts/test-es-generate.mjs`. Image URLs carry the width parameter; the obvious-pick case makes no AI call.

### B10. Hygiene for the small Haiku calls. Saves about 1%; mostly latency. Effort S

**Changes:**
- **Thinking off where it adds nothing.** Add `thinking` to `anthropicCall`'s arguments. For `generate-photo-pick` and `video-ads-grammar`-style one-shot JSON, send `thinking: { type: 'disabled' }`. Haiku 5.5 accepts this at effort `high` or below. Do **not** send it to Sonnet 5.5 (it returns 400) or to Opus 5.5.
- **`video-ads-chat`.** Send the system prompt as two blocks: `COPY_SYSTEM` plus the assistant rules, then the per-request context. Mark `cache_control` only on the first block. That needs a `systemBlocks` option in `anthropicCall`.
- **`video-ads-copy`.** Either drop `cacheSystem` (it is a no-op below 512 tokens) or move the static `contextLines` rules into `COPY_SYSTEM` so it crosses 512.
- **Generate writer prefix.** Build the static template catalog from **all** templates, always. The allowed formats already go after the break in the request ("Use only: …"). That turns 9 cache prefixes into 1, and the hit rate rises at low traffic.
- **Repair prompt.** Put `repairPrompt` behind the same `PROMPT_CACHE_BREAK`, so it reuses the writer's cached prefix.

### Ranked summary

| Rank | Lever | Typical $ saved | Ceiling or risk | Effort |
|---|---|---|---|---|
| 1 | B1 Haiku director, Sonnet on weak output | **≈35%** | | S |
| 2 | B2 Team cap, $5 user cap, alerts | ≈0% | **ceiling −75%** | S–M |
| 3 | B3 Shared clip cache, one search first | **≈15–18%** | | M |
| 4 | B4 Log cache tokens, verify the Gateway | enables the rest | | S |
| 5 | B5 Tighter escalation | ≈5% | | S |
| 6 | B6 Kill switches, economy mode | 0% | incidents | S |
| 7 | B7 Scene image cache | ≈2–3% | | M |
| 8 | B8 Batched trend headlines | ≈1% (calls −60 per user per week) | hourly-cap noise | M |
| 9 | B9 Photo-pick downsizing | ≈1–2% | | S |
| 10 | B10 Small Haiku hygiene | ≈1% | latency | S |

All 10 together take typical spend from **$0.45 to about $0.24 per user per week, −47%**.

### Levers I considered and rejected for now

- **Output caps (`maxTokens`) as a saving.** They are ceilings, not spend, and lowering them causes "cut off" failures that cost a retry. Only B9's photo-pick cap is worth changing.
- **Batch API (50% off).** Every current call is interactive. Use it only for the background jobs in C (weekly digest, explaining past posts), and only if the Gateway supports `/v1/messages/batches`; otherwise skip it. At about $0.05 a month the saving is cents.
- **Response caching for Generate.** Users press Generate again to get *new* ideas, and the research doc forbids caching director results. Rewrites are spec-specific. Keep it off.
- **Moving grammar rules into code.** Deterministic checks are a good idea for quality and the existing `checkGrammarIssues` already guards output. But grammar costs $0.00005 a call, so there is no money in it. Do it in C6 for quality, not cost.
- **In-flight coalescing.** Worth a small guard against double-clicking Generate: key `email|sha1(brief|formats)`, 20s, per instance, in `es-generate.js` `handler`. It saves less than 1%. Fold it into the router (D1).

---

## C. Top 10 "creative powerhouse" features, ranked by value per cost

Costs use A1 prices.

| Rank | Feature | User value | Model / tier | Cost per use | Build effort |
|---|---|---|---|---|---|
| 1 | **Captions, hashtags and alt-text with every design** | Every export needs an Instagram caption; alt-text helps accessibility and SEO. Saves 2–3 minutes per post | Inside the **existing writer call**: add `caption` (≤ 300 characters), `hashtags` (≤ 5) and `alt` (≤ 125 characters) to each design's JSON | **≈ $0.0003 per run** (about +500 output tokens). No extra call | S: the `TEMPLATES` shape, `checkSpec` limits, a "Copy caption" button. Alt-text is built from the spec text, so no vision is needed |
| 2 | **Brand-compliance check on manual designs** | Catches typos, over-length text, wrong team colours and invented stats before export, for designs made by hand in the editor | **Code only:** run `_lint-spec.js` `lintSpec` and `frameup-rules.js` on the editor state at export. Optional Haiku vision "tone check" on one 540px render | **$0** (code); about $0.0008 with vision | M: an editor export hook and a warnings panel (reuse the Generate lint codes) |
| 3 | **One-click repurposing** (post → story 9:16 → video ad → newsletter blurb) | One brief becomes four assets. Video Ads copy and the templates already exist | Haiku: one call that takes the spec and returns `{story, videoAd:{headline, body, cta}, newsletterBlurb}`, checked by the existing `checkVariant` (Video Ads) and `checkSpec` | ≈ $0.0008 | M: a server mode `repurpose` in `es-generate.js`, a 9:16 layout preset, and a deep link into Video Ads with the copy prefilled |
| 4 | **Creative director** (in progress) | Distinct angles instead of 4 similar cards; the biggest quality jump | Haiku by default, Sonnet when concepts are weak (B1) | ≈ $0.0006–0.0013 (Haiku), $0.013 (Sonnet) | In progress (research doc, Phase 1) |
| 5 | **Weekly trend digest in Slack** | Monday 9am: the week's top 10 ES trends, the 3 best-performing team posts, and "angles to try", so editors start the week with ideas | Haiku, scheduled, 1 call a week. ES MCP trending plus `frameup_generate_corpus` | **≈ $0.002 a week ($0.01 a month)** | M: a scheduled function, `SLACK_AI_DIGEST_WEBHOOK_URL`, and a system-usage log (same decision as B8) |
| 6 | **Voice and tone presets per newsletter or brand** | Each Video Ads newsletter and each sport sounds like itself; fewer edits | **$0 model cost.** 3–6 lines of preset text per brand in `video-ads-brands.js`, appended **after** the cache break. `_ad-learning.js` lessons already feed this | +≈ $0.00002 per call | S |
| 7 | **"Pick likelihood" for headline variants** (honest version of "predicted CTR") | There is **no CTR or engagement data in FrameUp**. What exists is whether editors kept AI text unedited (`generated.aiText` vs `edited` in `_generate-examples.js`) and what they exported. Rank variants by "how often this hook type and template got exported unedited" | **Code only:** counts by `hook × postType × sport` from the corpus. Show "Usually kept" chips | **$0** | M. Becomes real CTR prediction only once Instagram Insights are imported (see risks) |
| 8 | **"Why this works" on top past posts** | Teaches new editors the house style. Feeds the director's lessons | Haiku. Precompute **once per post** and store it forever in `frameup_ai_cache` (no TTL) | ≈ $0.0004 per post; 300 posts = **$0.12 one-off** | S–M: a Gallery panel and a background backfill (could use the Batch API) |
| 9 | **Smart crop and focal point for photos** | Faces never cut off in 4:5 or 9:16 crops; repurposing (3) needs it | **In the browser first:** a face detector (MediaPipe Face Detector, WASM, already allowed by the `wasm-unsafe-eval` CSP) gives the focal point for $0. Fallback: Haiku vision returns `{x, y}` at 512px | **$0**, or ≈ $0.0003 fallback | M |
| 10 | **Embeddings search over past designs** | "Show me past posts like this brief" | `openai/text-embedding-3-small` through the Gateway (about $0.02 per 1M tokens): 300 posts × 150 tokens ≈ **$0.001 total**; $0.000003 per query. Needs pgvector | ≈ $0 | M–L. **Defer:** with ≤ 300 corpus rows, the deterministic relevance scoring (research doc C6) is as good. Revisit above about 2,000 rows or if editors ask for free-text search in the Gallery |

**Dropped:**
- **Translation and localisation check.** ES writes in US English for a US audience, so the value is low. A deterministic British-spelling list in `_lint-spec.js` (colour→color, favourite→favorite) covers the real risk for $0. Add it to item 2.
- **AI-generated people or athletes.** Never; it is already a hard rule in the code.

**What it adds up to:** features 1, 2, 5, 6, 7 and 9 add **under $0.01 per user per month**. Repurposing at 10 uses a week adds about $0.035 per user per month. The powerhouse costs almost nothing once B1 is in.

---

## D. Target architecture

```
browser ─► api/<feature>.js ─► _ai-router.js runTask(task, input)
                                  │ 1 kill switch (AI_DISABLE_FEATURES)
                                  │ 2 budgets: user hourly · user weekly · team weekly (cached 60s)
                                  │ 3 response cache: L1 memory LRU → L2 frameup_ai_cache (by task policy)
                                  │ 4 in-flight coalescing (same key ⇒ same promise)
                                  │ 5 call: _ai-gateway.js aiText / aiWebResearch / aiImage
                                  │ 6 validate (task.validate) → escalate once (task.escalateTo) if weak
                                  │ 7 fallback: Groq / rules (existing behaviour)
                                  └ 8 log: frameup_ai_usage (+cache tokens, task, run_id, cached)
                                          └► alerts (Slack) · dashboard views · weekly digest
```

### D1. `netlify/functions/_ai-router.js` (new), with a task registry

One table decides the model, effort, caps and cache policy for every AI job, so a change is one line in one place.

```js
const TASKS = {
  'generate-writer':     { fn: 'text', tier: 'main', effort: 'low', maxTokens: 6000, promptCache: 'prefix', responseCache: null },
  'generate-director':   { fn: 'text', tier: 'main', effort: 'low', maxTokens: 1400, promptCache: 'system', escalateTo: 'best' },
  'generate-photo-pick': { fn: 'text', tier: 'main', effort: 'low', maxTokens: 300, thinking: 'off' },
  'generate-review':     { fn: 'text', tier: 'review', maxTokens: 1200, json: true },
  'generate-escalate':   { fn: 'text', tier: 'best', effort: 'medium', maxTokens: 3000 },
  'generate-scene-image':{ fn: 'image', responseCache: { scope: 'shared', ttl: Infinity } },
  'trend-headlines':     { fn: 'text', tier: 'light', maxTokens: 1500, json: true, responseCache: { scope: 'shared', ttl: 48 * 3600 } },
  'video-ads-copy':      { fn: 'text', tier: 'main', maxTokens: 2000, json: true },
  'video-ads-chat':      { fn: 'text', tier: 'main', maxTokens: 1800, json: true, promptCache: 'system-first-block' },
  'video-ads-grammar':   { fn: 'text', tier: 'light', maxTokens: 1500, json: true, responseCache: { scope: 'shared', ttl: 600 } },
  'video-ads-find-clips':{ fn: 'search', tier: 'search', maxUses: 1, maxUsesOnWeak: 2, maxCostUsd: 0.03, responseCache: { scope: 'shared', ttl: 1800 } },
};
async function runTask(name, { system, messages, json, track, cacheKey, validate, runId }) { /* steps 1–8 above */ }
```

- `_ai-gateway.js` stays the transport: prices, HTTP, logging.
- Callers migrate one at a time, so behaviour is unchanged until a task's settings change.
- The router also owns `PRICES` updates. A unit test fails when a model in `MODELS` has no `PRICES` entry, because unknown models silently count at Haiku rates today.

### D2. `netlify/functions/_ai-cache.js` and `frameup_ai_cache`

```sql
create table public.frameup_ai_cache (
  key text primary key,            -- '<task>|<normalised input>' (sha1 when long)
  task text not null,
  value jsonb not null,            -- ≤ 64 KB (checked in the RPC)
  created_at timestamptz not null default now(),
  expires_at timestamptz           -- null = forever (scene images, "why this works")
);
alter table public.frameup_ai_cache enable row level security;   -- no direct policies
-- frameup_ai_cache_get(p_key) / frameup_ai_cache_put(p_key, p_task, p_value, p_ttl_seconds):
-- security definer, require is_es_designer_domain_user(), delete a few expired rows on put.
```

**Rule:** cache only outputs that do **not** depend on the user's private input and are safe to share inside ES:
- clip searches;
- trend headlines;
- scene images;
- grammar results (the key is the exact copy);
- "why this works" explanations.

Never cache Generate designs, director concepts, chat, or rewrites.

### D3. Budgets

| Layer | Default | Where |
|---|---|---|
| Per person, hourly calls | 120 (exclude system and batch rows) | existing |
| Per person, weekly $ | **$5** (from $20) | env `AI_USER_WEEKLY_LIMIT_USD` |
| Team, weekly $ | **$60 at 25 users** (about 2.5× typical) | new `AI_TEAM_WEEKLY_LIMIT_USD` + RPC |
| Gateway key, weekly | Set at the team cap + 25% | Vercel dashboard (hard stop; Groq takes over) |
| Per call | find-clips $0.03 (existing); add `maxCostUsd` to the director ($0.03) | router |
| Economy mode | `AI_FORCE_TIER_BEST=main` | env |

### D4. Observability: a cost dashboard on data that already exists

`frameup_ai_usage` plus the B4 columns feeds the Dashboard's existing "AI usage" section (`dashboard.html`, `fetchAiUsage`). Add:
- **Spend:** by day (stacked by feature), by model, by person. This week against the team cap.
- **Unit costs:** cost per Generate run (sum by `run_id`), cost per Video Ad (copy + clip), and cost per export (AI $ in the window ÷ exports, from the existing export table). The last one is the north-star cost metric.
- **Efficiency:** prompt-cache hit rate per task (`cache_read / (cache_read + input)`), response-cache hit rate (`cached = true` rows), Sonnet share of spend, and backup (Groq) share.
- **Health:** error rate per feature, p95 `duration_ms`, and the count of "cut off" errors (a sign `maxTokens` is too low for thinking).

Two SQL views for admins, `frameup_ai_daily` and `frameup_ai_by_run`, keep the browser from pulling 5,000 raw rows (the current `limit(5000)` will truncate at about 50 users).

### D5. Alerts (`SLACK_AI_ALERTS_WEBHOOK_URL`, separate from design requests)

- **Real time,** from `logUsage`: one call over $0.05; a user crosses 50% or 100% of their weekly cap; any `isBudgetError` from the Gateway.
- **Daily, from a scheduled function** (`api/ai-budget-watch.js` plus a cron in `vercel.json` at `0 9 * * *`):
  - yesterday's spend above 2× the 4-week daily average;
  - error rate above 10% for any feature;
  - prompt-cache hit rate for the writer or director below 20%;
  - Sonnet share above 60%.
- **Needs** a server-side read of usage. **Decision for Suhail:** add `SUPABASE_SERVICE_ROLE_KEY` (server-only env, used only by this function), or a security-definer summary RPC protected by a long random secret in env.

### D6. Monthly review (first Monday, 15 minutes, owner: Suhail)

1. Top 5 features by $; any feature above 30% of spend needs a one-line justification.
2. Cost per export and cost per Generate run against last month (target: flat or down).
3. Cache hit rates; Sonnet share; backup share. Error and cut-off counts.
4. Check the Gateway price list and update `PRICES` / `IMAGE_PRICES`.
5. New cheaper model released? Run `npm run eval:generate` on it before any `AI_*_MODEL` switch.
6. Revisit the caps: raise them if a real user hit one doing real work.

### D7. When to self-host or use open models

- **Today:** open models already run free through Groq as the backup, and `gpt-oss-20b` is the light tier at $0.03 / $0.14.
- **Self-hosting a GPU** costs at least $300–1,500 a month for one always-on instance, plus ops. The whole AI bill at 50 users is about $100 a month. **Do not self-host.**
- **Reconsider when any one of these holds:**
  - a single task's bill passes about $2,000 a month and an open model passes the same eval within 0.1 review points;
  - legal requires that content never leaves our infrastructure;
  - Groq free-tier limits block real work, in which case use paid Groq or Gateway-hosted open models, still not self-hosting.
- **Cheap open-model candidates worth evaluating:** trend headlines and grammar (already `gpt-oss-20b`), and the review step (`gpt-oss-120b` as a third model family).

---

## E. Phased implementation plan

Each phase ships on its own. Run `npm test` (keeping the 7 known baseline failures unchanged) plus the named tests.

### Phase 0: measure (1 day). Do this first.

| Task | Files | Test | Acceptance |
|---|---|---|---|
| Log cache tokens, `task`, `run_id`, `cached` (B4) | `_ai-gateway.js`, new migration `…_frameup_ai_usage_cache_cols.sql`, `es-generate.js` (pass `runId` in `track`), `dashboard-data.js` | `test-es-generate-fast.mjs` asserts the cache columns and that `run_id` is the same across one run's rows | Rows show `cache_read_tokens`; Dashboard lists cost per run |
| Warn when the Gateway rejects `cache_control` | `_ai-gateway.js` `anthropicCall` | Stub a 400, then a 200: one warn, one retry | |
| Verify Gateway caching live (2 director calls) | Manual, admin | n/a | `cache_read_tokens > 0` on call 2, or a decision recorded in `ai-edit-log.md` |
| Log Reels transcription (OpenAI) to usage | `es-video-intelligence.js` | `test-es-video-intelligence.mjs` stubs `logUsage` | One row per transcription, with cost = minutes × 0.006 |
| One week of real data, then re-run section A | none | n/a | A4 replaced with measured numbers |

### Phase 1: the big two and the safety net (1–2 days)

| Task | Files | Test | Acceptance |
|---|---|---|---|
| B1 Haiku-first director, Sonnet on weak | `_creative-director.js` | `test-creative-director.mjs`, `test-es-generate-direction.mjs`; `npm run eval:generate` on both tiers | Eval gate in B1 met; median cost per run under $0.006 |
| B2 Team cap, $5 user cap, real-time alerts | `_ai-gateway.js`, migration `…_frameup_team_ai_spend.sql`, 6 handlers, env | `test-ai-weekly-limit.mjs` (team-limit returns 429) | A team over its cap gets the calm message; Slack gets one alert per threshold per week (dedupe in memory and in the alert text) |
| B6 Kill switches and economy mode | `_ai-gateway.js` | New `test-ai-gateway-switches.mjs` | A disabled feature makes 0 fetches and the caller's fallback works |
| B5 Escalation tightening | `es-generate.js` | `test-es-generate-quality.mjs` (cost bound under $0.02) | Eval: the share of cards under 3.5 rises by at most 5 points |

### Phase 2: shared cache and router (3–4 days)

| Task | Files | Test | Acceptance |
|---|---|---|---|
| `frameup_ai_cache` table and RPCs | New migration | SQL smoke test in `check-dashboard-supabase.mjs` style | get/put work for domain users; anonymous users are denied |
| `_ai-cache.js` (L1 LRU of 500 entries, then L2 RPC, 1.5s timeout, fail open) | New file | New `test-ai-cache.mjs` | A miss calls through; a hit makes 0 AI calls; an RPC timeout falls back to calling the AI |
| B3 Clip cache and one search first | `video-ads.js` | `test-video-ads.mjs` | Over a week, the clip response-cache hit rate is at least 50% and search $ per user is down 40% or more |
| B8 Batched trend headlines | `trend-design.js`, `generate.html` | `test-trend-design.mjs` | 0 per-card title POSTs for the top 20 trends |
| B7 Scene image cache | `es-generate-image.js`, `generate.html` ("New image" bypass) | Test in `test-es-generate.mjs` | The second identical scene costs $0 |
| `_ai-router.js` with the task registry; migrate the Generate calls first, then Video Ads | New file, callers | New `test-ai-router.mjs`: every `MODELS` entry has a price, every task resolves, coalescing returns one promise | No behaviour change in existing tests |
| B9 and B10 hygiene | `es-generate.js`, `video-ads.js`, `_ai-gateway.js` | Existing tests, plus a check for the thinking flag | Photo-pick input tokens down 60% or more |

### Phase 3: dashboard, daily alerts, review (2 days)

| Task | Files | Test | Acceptance |
|---|---|---|---|
| `frameup_ai_daily` and `frameup_ai_by_run` views | Migration | Supabase check | Admin-only select |
| Dashboard cost panels (D4) | `dashboard.html`, `dashboard-data.js`, `dashboard-ui-system.css` | `check-dashboard-ui.mjs` | Cost per export, cache hit %, Sonnet share and team cap progress are visible |
| Daily budget watcher (D5) | `api/ai-budget-watch.js`, `netlify/functions/ai-budget-watch.js`, `vercel.json` cron | Unit test with stubbed rows | One Slack message per breached rule per day |
| Monthly review checklist | Append D6 to `project-docs/ai-edit-log.md` standing rules | n/a | |

### Phase 4: the powerhouse features (in C order; about 1 to 1.5 weeks in total)

| Task | Files | Test | Acceptance |
|---|---|---|---|
| C1 Captions, hashtags, alt-text in the writer | `es-generate.js` (`TEMPLATES` shapes, `buildPrompt`, `checkSpec` limits), `generate.html` | `test-es-generate.mjs`: field limits, and no hashtag that is not in the brief or research for names | Run cost rises ≤ $0.0005 |
| C2 Brand check on manual designs | Editor export path, `_lint-spec.js` (plus the British-spelling list) | `test-lint-spec.mjs` | Warnings show before export at $0 |
| C6 Voice presets | `video-ads-brands.js`, `video-ads.js` (after the cache break) | `test-video-ads.mjs` | Presets are in the prompt and the cached prefix is unchanged |
| C3 Repurpose | `es-generate.js` mode `repurpose`, `video-ads.js` (prefill) | New test | One click gives 4 assets, all passing `checkSpec` / `checkVariant` |
| C5 Weekly digest | Scheduled function, `SLACK_AI_DIGEST_WEBHOOK_URL` | Stubbed test | One post every Monday, at $0.01 a month or less |
| C7 Pick likelihood | `_generate-examples.js` (counts), `generate.html` chips | `test-generate-examples.mjs` | $0 AI |
| C8 "Why this works" backfill | Gallery, `_ai-cache.js` (no TTL) | New test | Each post is explained once, ever |
| C9 Smart crop | Editor (browser face detector), Haiku fallback | UI test | No face is cut off in 4:5 or 9:16 presets |

---

## F. Guardrails: costs fall, quality does not

1. **No cheaper config ships without the eval.**
   - `npm run eval:generate` is the gate for any change to Generate's tier, effort or prompt.
   - Pass rules: the mean review score drops by at most 0.15; the `lintStats.passedFirst` rate does not drop; the share of runs with fewer than 2 designs does not rise.
   - Record the before and after in `project-docs/ai-edit-log.md`.
2. **Escalate on evidence, not by default.** Every downgrade (B1, B5) keeps an automatic step up to Sonnet when a validator says the output is weak. Quality has a floor; only the average cost falls.
3. **Live quality metrics sit next to cost on the Dashboard:**
   - the review score (`spec.review.score`);
   - the escalation rate;
   - the rate at which AI text is exported **unedited** (from `_generate-examples.js`);
   - the Video Ads `check_failed` events;
   - the grammar issues dropped by `checkGrammarIssues`.
   If any moves more than 10% the wrong way in the week after a cost change, revert it with an env flip (B1, B5 and B6 are all env-switchable).
4. **Hard gates stay in code, whatever the model:** `checkSpec`, `lintSpec`, `checkVariant`, fact-grounding (no invented numbers or quotes), no AI-drawn real people, verified clip timestamps under 72h. Cheaper models are allowed only because these gates catch their misses.
5. **Caching never serves stale or private content:**
   - shared caches only for the task list in D2;
   - clips are re-aged on every read;
   - personal or brief-specific outputs are never cached;
   - every cache layer fails open (on a miss or error, call the model).
6. **Fallbacks stay graceful.** A budget, cap or kill switch always ends in an existing fallback (Groq, rules, the old path) or one calm sentence. Never a raw error, and never a blank screen.
7. **Cost assertions live in tests:**
   - `test-es-generate-fast.mjs`: a run without escalation costs under $0.006 after B1;
   - `test-es-generate-quality.mjs`: worst case under $0.03;
   - `test-video-ads.mjs`: one find-clips call costs $0.03 or less (existing cap).
   A prompt that grows silently fails CI.
8. **One change at a time, one week apart,** so the Dashboard can attribute any quality or cost movement to the change that caused it.

---

## Risks and open questions for Suhail

1. **The director tier.** The creative-brain doc chose Sonnet on purpose. B1 is the single biggest saving, but only after the Phase 1 eval. OK to make "Haiku first, escalate on weak" the target default?
2. **A server key for alerts and system jobs.** B8, C5 and D5 need either `SUPABASE_SERVICE_ROLE_KEY` in server env or secret-guarded security-definer RPCs. Which do you prefer?
3. **Lowering the per-person cap from $20 to $5.** Typical use is about $0.45 a week, so nobody doing real work would notice. OK?
4. **The team cap value.** $60 a week at 25 users is suggested. Do you want it in env, or editable on the Dashboard?
5. **Real CTR.** "Predicted CTR" needs Instagram Insights (impressions and saves per post). Until that import exists, C7 uses "kept unedited and exported" as the honest stand-in.
6. **The Gateway's prompt-cache pass-through is unverified.** Phase 0 settles it. At current volumes caching is worth under $1 a month either way. The real value is lower latency on the director.
