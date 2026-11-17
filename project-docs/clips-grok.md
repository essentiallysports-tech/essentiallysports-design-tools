# Video Ads clip source: Grok X search (`_clip-source-grok.js`)

Status: built on `feature/clips-grok`, mocked tests pass. **Not run live.** There is no Gateway or xAI key locally, so no real call has been made. See "What is unverified".

## Why

`find-clips` asks Haiku's web search for X status URLs. Web search engines barely index fresh X posts, so few candidates exist to begin with.

xAI's `x_search` tool searches X itself (keyword, semantic and user search over posts, plus thread fetch). It can be limited to a list of handles and to a date range. That is the closest thing to the X API's recent search that the AI key can reach.

## Is X search available on the Vercel AI Gateway?

Short answer: **not documented, and not verifiable without a key.** The module tries it and falls back by itself.

The evidence, as of 2026-11-17:

| Source | What it says |
|---|---|
| Live model list, `https://ai-gateway.vercel.sh/v1/models` | Grok language models are listed under `spacexai/*` (not `xai/*`). Examples: `spacexai/grok-4.20-non-reasoning`, `-reasoning`, `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `grok-build-0.1`. Each has a `web_search` price ($5 per 1k calls). None lists an `x_search` price. `grok-4.6` and `grok-4.7` do not carry the `web-search` tag. |
| Gateway web-search docs, [vercel.com/docs/ai-gateway/models-and-providers/web-search](https://vercel.com/docs/ai-gateway/models-and-providers/web-search) | "SpaceXAI web search" documents only `xai.tools.webSearch` (allowed/excluded domains, at most 5), used through the AI SDK with `spacexai/grok-4.20-non-reasoning`. There is no `xSearch`. |
| AI SDK xAI provider, [ai-sdk.dev/providers/ai-sdk-providers/xai](https://ai-sdk.dev/providers/ai-sdk-providers/xai) | `xai.tools.xSearch({ allowedXHandles, excludedXHandles, fromDate, toDate, enableImageUnderstanding, enableVideoUnderstanding })` exists on the **direct** provider. The page warns that the Gateway does not expose every `@ai-sdk/xai` API. |
| AI SDK Gateway provider, [ai-sdk.dev/providers/ai-sdk-providers/ai-gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway) | Provider-executed tools "may not work through AI Gateway". The page gives no list of supported tools. |
| xAI docs, [docs.x.ai/developers/tools/x-search](https://docs.x.ai/developers/tools/x-search) | `x_search` is a server-side tool on `POST https://api.x.ai/v1/responses`. |
| xAI Live Search, [docs.x.ai/docs/guides/live-search](https://docs.x.ai/docs/guides/live-search) | The old `search_parameters` (`sources: [{type:'x', ...}]`, `return_citations`) now redirects to the Web Search tool page. It has been replaced by the agentic tools, so the module does not use it. |

Because nothing confirms it, the module uses three routes, picked at runtime:

1. **`XAI_API_KEY` set:** it calls xAI directly (`api.x.ai/v1/responses` + `x_search`). This is the documented route and needs a separate xAI key.
2. **Gateway key only (the default):** it sends the same Responses body to `ai-gateway.vercel.sh/v1/responses` with `spacexai/grok-4.20-non-reasoning`. The module treats x_search as unsupported in either case:
   - the Gateway answers 400, 404 or 422 with an error naming the tool;
   - or it answers 200 with no X search usage, no X tool-call items and no citations, which means the tool was silently dropped.

   The finding is remembered for 6 hours on that warm instance, and `diag.unsupported` says why.
3. **Fallback, Gateway key only:** `perplexity/sonar` on `/v1/chat/completions`, with `providerOptions.perplexity`:
   - `search_domain_filter: ['x.com']`
   - `search_recency_filter: 'week'`
   - low search context

   This is the best Gateway-only alternative: an index-based search with recency and domain filters, about $0.006 a call. It suffers the same "web index of X" weakness as today, so expect modest yield. `CLIPS_GROK_FALLBACK=off` disables it.

**First live check (owner or coordinator, with the production key):** call `search({ sport: 'nfl' })` once and read `diag.mode` and `diag.unsupported`.
- `mode: 'gateway'` with `cited > 0`: Gateway X search works.
- `mode: 'sonar'`: it does not. If X search is worth it, set `XAI_API_KEY`.

## Request shape (x_search, Gateway or xAI)

```json
POST https://ai-gateway.vercel.sh/v1/responses     (or https://api.x.ai/v1/responses)
Authorization: Bearer <AI_GATEWAY_API_KEY | XAI_API_KEY>

{
  "model": "spacexai/grok-4.20-non-reasoning",       // direct: "grok-4.20-0309-non-reasoning"
  "input": [
    { "role": "system", "content": "...only list posts the search returned; never invent a URL... JSON only." },
    { "role": "user", "content": "NFL: Kansas City Chiefs video highlights from this week.\nSearch X posts from these accounts: @Chiefs, @NFL, ...\nOnly posts made after 2026-11-12T21:00 UTC (the last 120 hours) that carry a native video.\nReply as {\"posts\":[{\"url\",\"handle\",\"text\"}]} ..." }
  ],
  "tools": [{
    "type": "x_search",
    "allowed_x_handles": ["Chiefs", "NFL", "nflnetwork", "NFLonFOX", "..."],   // <= 20, no @
    "from_date": "2026-11-12",                                                // UTC day, inclusive
    "enable_image_understanding": false,
    "enable_video_understanding": false
  }],
  "max_turns": 1,
  "max_output_tokens": 1200,
  "temperature": 0
}
```

- **Handles.** The order is:
  1. the team(s) asked for;
  2. the sport's league accounts;
  3. its network accounts;
  4. for sport-wide or colour searches only, every other team account of that sport.

  Handles come from `video-ads-sources.js` (read with `require`, not edited) and are deduped. They are sent in batches of 20, the `allowed_x_handles` limit. A single-team search is one call. An NFL-wide search has 40 handles, so 2 batches. A search with no sport covers all sports.
- **Dates.** `from_date` is the UTC day of `now - sinceHours`. The exact 120 h cut is made on each post's own time, decoded from its status id. X ids are snowflakes, with creation time = `(id >> 22) + 1288834974657` ms. This is a verified timestamp, not one the model claims.
- **`max_turns: 1`** (xAI's agentic-loop cap) keeps posts fetched, and so cost, down. Set it with `CLIPS_GROK_MAX_TURNS` (1–5).

## Parsing: only cited URLs count

- **Candidate post ids** come only from what the API returned:
  - top-level `citations`;
  - `output[].content[].annotations[]` of type `url_citation`;
  - any status URL in tool-call outputs;
  - for Sonar, also `search_results[]` and message annotations.
- **The model's JSON answer** is used only for hints: post text, and a handle for `x.com/i/status/<id>` links (only when it is one of the handles searched), and only for ids that are already cited.
- **A model-written URL with no citation is dropped** and counted in `diag.invented`.
- **Filters:** a post older than `sinceHours` by its id, or whose hinted text trips the throwback rule (`looksOld`, a verbatim copy of `video-ads.js`, kept in sync by the test), is dropped.
- **Candidate fields:** `platform: 'x'` and `mediaUrl: null`. `sourceKind` comes from `SOURCES.classifyHandle`, with `other` reported as `fan`. Official accounts sort first, then by recency.
- **Verification** of the MP4, real text, date, quality and length is left to `clipFromPost` in `video-ads.js`.

`search()` never throws. It returns `{ candidates, cost, diag }`, where `diag` contains:
- `mode`: `off`, `feature-off`, `blocked`, `gateway`, `xai` or `sonar`;
- counts: `calls`, `batches`, `handles`, `searched`, `cited`, `found`, `invented`, `tooOld`, `throwback`, `noDate`, `duplicate`, `failed`, `xPostsFetched`;
- `unsupported` and `error` when they apply.

The first failed call ends that search, so there are no retries on later batches.

## Cost

Prices are from the live Gateway list (2026-11-17) and [docs.x.ai/developers/pricing](https://docs.x.ai/developers/pricing).

| Item | Price |
|---|---|
| `spacexai/grok-4.20-non-reasoning` (default; the cheapest general Grok tagged `web-search`, and the model the Gateway docs use for xAI search) | $1.25 / 1M input, $0.20 cached, $2.50 / 1M output |
| `x_search` | **$5 per 1,000 posts fetched** ($0.005 each), $10 / 1k profiles. Billed per item, not per call. |
| `web_search` (Grok) | $5 / 1k calls |
| `perplexity/sonar` (fallback) | $0.25 / $2.50 per 1M tokens + ~$0.005 per request |

`grok-build-0.1` has lower token rates ($1 / $2), but it is a coding and reasoning model, so it spends more output tokens. Its search behaviour is not documented.

**One x_search call, estimated:**

| Part | Estimate |
|---|---|
| Prompt plus the fetched posts in context (~3–6k input tokens) | ~$0.004–0.008 |
| Answer (~500 tokens) | ~$0.001 |
| Posts fetched | $0.005 × posts |

If Grok fetches 4 posts the call is about $0.03. At 10 posts it is about $0.06, and at 20 posts about $0.11.

**The $0.03 target is only met when a search fetches 4 posts or fewer.** The per-post fee dominates, and there is no documented `max_results` for x_search. What the module does about it:
- `max_turns: 1`.
- A per-search budget, `CLIPS_GROK_MAX_USD` (default 0.03). The first batch always runs, and a later batch runs only if `spent + last call's cost` stays within the budget. The default therefore means one call per search.
- Real cost is logged:
  - xAI's own `usage.cost_in_usd_ticks` (1 USD = 1e10 ticks) when the reply carries it;
  - else `usage.cost`;
  - else the estimate above from `usage.server_side_tool_usage_details.x_posts_fetched`.

  Each call writes one `frameup_ai_usage` row with feature `video-ads-find-clips-grok`. Failed and rejected calls are logged too.
- `aiSpendGate(token, { feature: 'video-ads-find-clips-grok' })` runs before any call when a token is passed. `AI_DISABLE=video-ads-find-clips` (or `...-grok`) switches it off.

**Recommendation:** let the shared clip library (clips-library) call this source on a schedule per sport and per handle batch, and serve users from the library. For example, 3 sports × 2 batches every 2 hours is 72 calls a day, at about $0.03–0.08 each, so roughly $2–6 a day. Users then pay nothing per search. If the bill matters more than coverage, raise `CLIPS_GROK_MAX_USD` only for the cron.

## Expected yield (estimate, not measured)

The 20 searched accounts are official team, league and network accounts, which post several videos a day in season. One x_search call over 5 days typically returns 10–20 posts. Two caveats: the model cites only part of them, and only some posts carry native video. Expect about **4–10 cited candidates per call, of which perhaps 60–80% pass `clipFromPost`** (video, ≥480p, 4–120 s). By comparison, today's web search often returns 0–3. The Sonar fallback will likely sit near today's numbers. Treat these numbers as a guess until the first live check.

## Env

| Variable | Default | Meaning |
|---|---|---|
| `CLIPS_GROK` | on | `off` disables the source (`configured()` false) |
| `CLIPS_GROK_MODEL` | `spacexai/grok-4.20-non-reasoning` | Gateway model |
| `CLIPS_GROK_DIRECT_MODEL` | `grok-4.20-0309-non-reasoning` | model on api.x.ai |
| `XAI_API_KEY` | unset | optional; direct xAI route (documented x_search) |
| `CLIPS_GROK_MAX_USD` | `0.03` | budget per `search()` |
| `CLIPS_GROK_MAX_TURNS` | `1` | xAI `max_turns` |
| `CLIPS_GROK_FALLBACK` | on | `off` disables the Sonar fallback |
| `CLIPS_GROK_FALLBACK_MODEL` | `perplexity/sonar` | fallback model |

The module uses `AI_GATEWAY_API_KEY` and respects `GENERATE_AI=rules`, as the rest of the AI stack does.

## Interface (for clips-library)

```js
let grok = null;
try { grok = require('./_clip-source-grok.js'); } catch {}
if (grok?.configured(process.env)) {
  const { candidates, cost, diag } = await grok.search({ sport, team, teams, color, query, sinceHours: 120, limit: 25, track, token });
  // candidates: { url, platform:'x', handle, postedAt (from the id), text, mediaUrl:null, sourceKind, ... } -> clipFromPost(url)
}
```

`track` is the usual `{ token, email, ... }`, and its `feature` is overridden with `video-ads-find-clips-grok`. Pass `token` so the spend gate runs. If the caller already gated, it may omit `token`.

## What is unverified

- Whether the Gateway runs `x_search` for `spacexai/*` on `/v1/responses`, and whether it passes `max_turns`, `citations` and `cost_in_usd_ticks` through.
- Whether the Gateway forwards `providerOptions.perplexity` filters for Sonar on chat completions.
- The `grok-4.20-0309-non-reasoning` id on api.x.ai (it is taken from xAI's pricing page).
- The yield and cost numbers above.

Tests: `scripts/test-clip-source-grok.mjs`. Everything is mocked: the off states, the spend gate, batching, dates and snowflakes, citation parsing, invented URLs, cost and logging, budget, the fallback, and the direct route.
