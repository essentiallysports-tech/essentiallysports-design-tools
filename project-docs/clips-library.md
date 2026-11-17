# Video Ads clip library

Branch `feature/clips-library`, 2026-11-18. It makes clips in Video Ads "Find a clip" plentiful and instant:
one shared, always-warm library of verified clips that every search reads first.

## How it works

```
 daily cron (10 batches, 10:00–10:45 UTC)            every "Find a clip" search
 /api/clips-prefetch?batch=K                          POST /api/video-ads
   every NFL / CFB / MLB team once a day,               find-clips / moments-with-clips / library
   trending teams first                                  │
   free sources → AI sources (budgeted)                  ├─ 1. read the library (instant, free)
   verify → upsert ───────────┐                          │     ≥ 9 good clips → done
   re-check links → dead      │                          ├─ 2. top up live, in parallel:
   delete posts > 7 days      ▼                          │     web search or X API, grok, public sources
                       frameup_clip_library  ◄───────────┤ 3. verify, dedupe, rank, write new finds back
                       (Supabase, or memory)             └─ 4. still thin → labelled fallback from the library
```

### The library (`netlify/functions/_clip-library.js`)
- One row per verified clip:
  - identity: `url` (unique), `platform` (`x`, `bluesky`, `reddit`, `streamable`…), `handle`;
  - what it shows: `sport`, `teams[]`, `players[]` (only when a source knows them), `title`;
  - the media: `posted_at` (verified by the platform, never a model's claim), `media_url`, `variants`,
    `thumb`, `duration_ms`, `width`, `height`, `has_audio`;
  - how good it is: `source_kind` (`official` / `league` / `media` / `fan`), `found_by`, `score`, `likes`, `views`;
  - housekeeping: `first_seen`, `last_checked`, `dead`.
- Migration: `supabase/migrations/20261118121700_frameup_clip_library.sql`.
  - Idempotent, with an `Undo:` note.
  - Indexes on `(sport, posted_at desc)`, GIN on `teams`, and `last_checked`.
  - RLS: signed-in ES users read. Only the server writes, with `SUPABASE_SERVICE_ROLE_KEY`; there is no
    write policy, so a browser session can never write.
  - A second table, `frameup_clip_prefetch_runs`, holds one summary per cron batch. Only admins read it.
- **Before the migration** (or when `SUPABASE_SERVICE_ROLE_KEY` is missing), the library lives in memory on each
  server instance:
  - every search still writes its finds and reads them back;
  - a missing table is detected once and retried every 10 minutes;
  - nothing breaks.
- Reads use the service role. Without it they fall back to the caller's own token, which RLS allows.
- `CLIPS_LIBRARY=off` switches the library off completely.

### Searches (`netlify/functions/video-ads.js`)
1. **Library first.** If the library already has 9 or more good fresh clips (120 h or younger) for the request,
   the reply is instant and free. It skips the AI gates, because no AI runs.
   - The request can be a team, the teams of a colour, or a moment (its team, or its key words).
   - The reply carries `strategy: 'library'` and `fromLibrary: true`.
2. **Top-up.** With fewer than 9 good clips, the live sources run in parallel:
   - the existing capped Haiku x.com web search, or the X API when `X_BEARER_TOKEN` is set;
   - `_clip-source-grok.js` and `_clip-source-public.js`.
     - Both are loaded defensively (`require` inside `try`), so this branch works alone and the sources switch
       on when their branches merge.
     - `CLIPS_EXTRA_SOURCES=off` turns them off.
3. **Verify.**
   - X posts go through `clipFromPost`: verified timestamp, `video.twimg.com` MP4.
   - Direct MP4s get a HEAD request (or a 2-byte range GET when HEAD is refused), and only on allow-listed hosts:
     `video.twimg.com`, `v.redd.it`, `*.streamable.com`, `*.bsky.network`, `bsky.social`, plus
     `CLIPS_MEDIA_HOSTS`. Any other host is never fetched.
   - The same quality and freshness rules apply to every source: ≥ 480p, 4–120 s, verified time under 120 h,
     no throwbacks.
4. **Dedupe across platforms**, keeping the best copy:
   - the same URL;
   - the same X media id (re-posts);
   - a conservative "soft key": the same length to the second plus the same opening words of a caption at least
     24 characters long. This catches a Bluesky mirror of a team's X video.
5. **Rank**: official first, then league / network, then quality, recency and engagement.
6. **Write back.** New finds go into the library, tagged with the teams they are about:
   - the official account's team;
   - teams named in the text;
   - the searched team, when the clip is the team's own post or names the team.
7. **Never empty while the library has something nearby.** When a search ends with fewer than 3 clips, it adds
   labelled fallbacks, up to 9 clips in all, in this order:
   1. the same team's older clips (5–7 days), `via: 'older'`;
   2. the same sport, `via: 'sport'`;
   3. teams of the same colour in the other sports, `via: 'colorx'`.

   The `note` says what was added. `moments-with-clips` returns `fallback.clips`, the sport's newest library
   clips, when no moment has any.
8. **AI blocked** (switched off, not configured, over a limit, budget used up, or the search failed): the library
   and the free sources still answer.
   - The reply is `200` with `aiPaused` and `freeOnly: true`.
   - The old error comes back only when there is truly nothing.

**Response shape**: unchanged, with additions.
- Each clip now also has:
  - `platform`;
  - `sourceKind` (`official` / `league` / `media` / `fan`);
  - `foundBy` (`web`, `xapi`, `grok`, `bluesky`, …);
  - `teams`, and `hasAudio` (`false` for Reddit's video-only MP4s);
  - `via` (`search` / `league` / `color` / `older` / `sport` / `colorx`).
- `diag.sources` counts per source: library, web or xapi, and for each extra source `found`, `verified`, `kept`
  and `cost`. `diag.librarySaved` is the number of clips written back.
- New mode `library`: `POST { mode: 'library', sport, team?, sort: 'newest' | 'popular', offset, limit }`. It is
  free, needs no AI and skips the gates. It returns `{ clips, total, teams: [{ name, short, count }] }`.

### CORS
Every media host used answers `Access-Control-Allow-Origin: *`. clips-public measured this on 2026-11-17 for
`v.redd.it`, Streamable's CDN and Bluesky PDS `getBlob`, and `video.twimg.com` already worked. So the browser
downloads every clip itself, and **no server stream was added**: none was needed, and Vercel caps responses at
4.5 MB anyway.

## The daily prefetch (`/api/clips-prefetch`)
**Schedule.** Once a day (owner decision). Ten Vercel crons in `vercel.json` run five minutes apart:

| Cron | Path |
|---|---|
| `0 10 * * *` | `/api/clips-prefetch?batch=1` |
| `5 10 * * *` | `?batch=2` |
| … | … |
| `45 10 * * *` | `?batch=10` |

- 10:00 UTC is about 5–6 am ET.
- Daily crons are allowed on the Hobby project too.

**Why batches.**
- A Vercel function has 60 s.
- The 112 teams, in a stable order (sport, then name), are dealt round-robin into `CLIPS_PREFETCH_BATCHES`
  shares (default 10, about 11 teams each).
- Each batch:
  - runs up to 8 teams at a time;
  - stops starting teams after 30 s;
  - records the teams it skipped.
- Batch 1 also does today's trending teams first (up to 8 teams named by the last 48 h of trends).
- Over the ten batches, every team is refreshed once a day.

**Per team:**
1. **Free first**: the X API (if `X_BEARER_TOKEN`) and the free extra sources.
2. **Then AI**, only if the team still has fewer than 9 fresh clips and today's budget allows:
   - one small Haiku x.com search (2 searches, $0.03 cap), or none when the X API is on;
   - the paid extra sources (Grok).
3. Verify and upsert.

**Budget.**
- `CLIPS_PREFETCH_MAX_USD` (default **$0.75**) is the cap for the whole daily run, across all batches.
- Each batch subtracts what earlier batches spent today, read from `frameup_clip_prefetch_runs`.
- Before the migration, each batch gets an equal share instead (cap ÷ batches).
- A team's AI pass reserves $0.06 up front, so concurrent teams can never overshoot.
- Trending teams go first, so they get the budget.
- The cron's AI spend is logged in `frameup_ai_usage` as `clips-prefetch@essentiallysports.com`, feature
  `clips-prefetch`. It therefore counts toward the team's weekly cap.
- `AI_DISABLE=clips-prefetch` turns the AI part off; the free part still runs.

**Upkeep, every batch:**
- re-checks the 15 links checked longest ago (more than 20 h ago):
  - an X post without video, or a 404 / 410 file → `dead`;
  - a live link → `last_checked` is stamped;
- deletes rows whose post is older than 7 days.

**Security.**
- `CRON_SECRET` is required: Vercel sends `Authorization: Bearer <CRON_SECRET>`.
- Without it, every run is refused with `503`. A wrong secret gets `401`.
- The comparison is constant time (SHA-256 + `timingSafeEqual`).
- `CLIPS_PREFETCH=off` pauses the cron.

**External scheduler (optional)**, e.g. cron-job.org or a GitHub Actions schedule:

```
GET https://frameup.essentiallysports.com/api/clips-prefetch?batch=1
Authorization: Bearer <CRON_SECRET>        (or: x-cron-secret: <CRON_SECRET>)
```

Either call each batch (`batch=1..10`) a few minutes apart, or call `?batch=1&chain=1` once. With `chain=1`,
each batch calls the next one when it finishes. This needs `CLIPS_PREFETCH_BASE_URL` (e.g.
`https://frameup.essentiallysports.com`) or Vercel's `VERCEL_PROJECT_PRODUCTION_URL`. The secret is only ever
sent to that base URL, never to a host taken from the request.

### Admin diagnostics
`GET /api/clips-prefetch?diag=1` with a signed-in dashboard admin's bearer token. The admin check is
`is_es_designer_admin()`, run in the database. Everyone else gets `403`, the cron secret included.

It returns:
- `library`: total / fresh / older / dead, rows added in the last 24 h, newest post, and counts by sport, by
  `sport:team`, by platform, by source kind and by finder;
- `store`: where the library lives, and whether writes reach Supabase;
- `schedule`: the cron, the number of batches, UTC;
- `config`: booleans only (`cronSecret`, `serviceKey`, `xApi`, `aiGateway`, `aiOff`), plus `maxUsdPerDay` and
  each source's `configured` / `paid`;
- `lastDaily`: the most recent day summed up, i.e. which batches ran, teams done or skipped, clips found and
  saved, cost, and dead links marked;
- `runs`: the batch summaries from the last 48 h.

It never returns a secret. A test checks this.

Example: on the live site, signed in as an admin, send
`GET /api/clips-prefetch?diag=1` with `Authorization: Bearer <your session access token>`. In the browser
console, the page's own authenticated fetch helper (`ESAuth.fetchWithAuth`, which every FrameUp page uses for
`/api/*`) adds the token for you.

## The page (`video-ads.js` clip panel)
- **Results**:
  - a grid that is 3 columns when the panel is at least 336 px wide (desktop), 2 on phones;
  - 9 clips at a time, then **Load more** (up to 36);
  - a **team filter** (from the clips' teams);
  - **Best / Newest / Most popular** sorting.
- **Cards** show:
  - the platform chip (X, Bluesky, Reddit, Streamable);
  - Official / League / Network on X;
  - freshness ("2h ago");
  - quality and length;
  - "No sound" for video-only files;
  - a fallback label: Older / Same league / Same colour.
- **Library tab**:
  - everything fresh for NFL, CFB or MLB, browsable with no search;
  - a team filter with counts;
  - Newest / Most popular;
  - Load more.
- **Never "No fresh clips" while the library has something.**
  - An empty or failed search shows the sport's newest library clips under "From the clip library".
  - By moment does the same when no moment has a clip.
  - "No fresh clips" only appears when the library is empty too.
- "Make it without a clip" stays in every empty state.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | none | Server writes to the library (already set in prod). Without it: memory only |
| `CRON_SECRET` | none | Required for `/api/clips-prefetch` (already used by the budget watch) |
| `CLIPS_PREFETCH_MAX_USD` | `0.75` | AI cap for one daily run, all batches together. `0` = free sources only |
| `CLIPS_PREFETCH_BATCHES` | `10` | Must match the number of `clips-prefetch` crons in `vercel.json` |
| `CLIPS_PREFETCH` | on | `off` pauses the cron |
| `CLIPS_PREFETCH_BASE_URL` | none | Only for `chain=1` |
| `CLIPS_LIBRARY` | on | `off` = no library at all |
| `CLIPS_EXTRA_SOURCES` | on | `off` = no grok / public sources |
| `CLIPS_MEDIA_HOSTS` | none | Extra exact host names allowed for direct MP4s |
| `X_BEARER_TOKEN` | none | Existing: the X API path (free to us, replaces the web search) |

## Expected yield
Not measured live yet: there are no AI or X keys locally. These are estimates:

- **Free sources alone.** clips-public measured, for the last 48 h: about 67 NFL Bluesky MP4s and 42 X links
  (20 from @NFL), 8 CFB, and 2 MLB (off-season). Reddit was blocked from servers by a 403.
- **AI.** The $0.75 daily budget pays for about 15–25 team searches, each costing $0.03–0.05 and keeping
  roughly 3–8 verified X clips. Trending teams get it first.
- **The library therefore builds up**:
  - for the NFL, an estimated 150–300 fresh clips (5-day window), about 4–10 per team, more for trending teams;
  - fewer for CFB, and few for MLB in the off-season;
  - every live search adds its finds for everyone.
- **What a search costs:**
  - when the library has 9 or more clips for the request (busy NFL teams, trending moments): $0, under a second;
  - otherwise: the old cost ($0.06–0.09), minus whatever the library already supplies, and the finds are kept.
- **To verify live**: read `?diag=1` → `library.bySport` and `byTeam` the morning after the first run, and
  `lastDaily.saved`.

## Tests
- `scripts/test-clip-library.mjs` (also `npm run test:clips`), all mocked:
  - library fallbacks before the migration;
  - upsert, read, dead links and purge after it;
  - library-first with no AI;
  - top-up merge, cross-platform dedupe, ranking, write-back and per-source diag;
  - never-empty fallbacks, including while AI is gated;
  - moments and library mode;
  - the cron secret;
  - the daily schedule, and batches that cover every team exactly once;
  - the budget across batches;
  - dead-link recheck;
  - diag is admin-only and leaks no secret.
- `scripts/test-video-ads.mjs` and `scripts/test-video-ads-clips.mjs` run with `CLIPS_LIBRARY=off` and
  `CLIPS_EXTRA_SOURCES=off`, so they keep testing the live search on its own.
- `scripts/test-ai-guardrails.mjs` now accepts other daily crons next to the budget watch, and checks that every
  cron runs once a day.
