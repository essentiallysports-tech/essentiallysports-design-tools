# Public clip sources (`netlify/functions/_clip-source-public.js`)

Free sources of fresh sports clips for Video Ads "Find a clip". They need no paid keys and cost $0.
Branch `feature/clips-public`. Measured on 2026-11-17 (UTC), with real unauthenticated GETs from a
residential IP and the `FrameUp/1.0 (+https://frameup.essentiallysports.com)` User-Agent.

## Interface

The module matches the shared clip-source contract and exports:

- `id: 'public'`, `configured(env)`, `search(opts)`: the combined source. It runs Reddit and Bluesky in
  parallel, merges, dedupes by media id or URL, sorts newest first and returns `{ candidates, cost: 0, diag }`.
  `diag.sources.reddit` and `diag.sources.bluesky` hold the per-source counts.
- `sources: [reddit, bluesky]`, plus `reddit` and `bluesky` on their own (same interface), for a caller that
  wants to run them separately.
- `MEDIA_HOSTS`: the exact URL patterns of every media host it returns (see "CORS" below).

Each candidate has `url` (the post), `platform` (`reddit` | `bluesky` | `x`), `handle`, `postedAt`, `text`,
`mediaUrl`, `thumb`, `durationMs`, `width`, `height`, `quality`, `sourceKind`, `ageHours`, `mediaId`, and
any of these that apply:

- `mediaHost`, `bytes`
- `hasAudio`, `audioUrl`, `hlsUrl`
- `expiresAt` (Streamable)
- `via` (the post an X link was found in)
- `serverStreamOk` (bytes ≤ 4 MB)

X links found in posts come back as `platform: 'x'` with `mediaUrl: null` and `postedAt: null`.
`discoveredAt` holds the time of the post they were found in. These go through `clipFromPost`, which
verifies the X timestamp. Their `sourceKind` comes from `video-ads-sources.js` `classifyHandle`, so
`@NFL` → league and a team handle → official.

What `search` does before returning:

- **Freshness:** checked against `sinceHours`, using verified timestamps only.
  - Reddit: `created_utc`.
  - Bluesky: the AppView's `indexedAt`, or the client's `createdAt` when that is earlier, so backdated
    imports read as old.
- **Throwback filter:** a copy of `looksOld`.
- **Quality floor:** ≥480p short side and 4–120 s, applied when those values are known.
- **Sport relevance:** applied to mixed-topic accounts and search results.
- **Blocked content:** NSFW posts and Bluesky moderation labels are dropped.

## Yield, last 48 h (2026-11-15 16:00 → 2026-11-17 16:00 UTC)

| Sport | Reddit | Bluesky MP4s (browser-downloadable) | Bluesky → X links for `clipFromPost` |
|---|---|---|---|
| NFL | not measurable: 403 (see below) | **67** (60 ≥720p; 11 ≤4 MB); all `fan` | **42**: 20 league (@NFL), 4 official (team), 1 media, 17 fan |
| CFB | 403 | **8** (all ≥720p; 6 `media` from @splitzoneduo.com, mostly podcast clips, not game highlights) | 0 |
| MLB | 403 | **2** (off-season; neither is a real fresh highlight) | 0 |
| Golf | 403 | 0 | 0 |

How the counts were reached:

- About 200–360 posts were scanned per sport: author feeds plus `searchPosts`.
- Posts dropped before the counts above:
  - off-topic: 47–74 per sport;
  - older than 48 h: 71–184 per sport.
- Most of the NFL yield comes from two places:
  - `nflnewsposter.bsky.social`, a bot that mirrors NFL X accounts. In 48 h it made about 54 video posts and
    84 X links, 49 of them to @NFL.
  - `watchmomentwire.bsky.social`.
- **Bottom line:** Bluesky meaningfully adds NFL clips and the official @NFL / team X posts behind them. It
  adds little for CFB, MLB and golf.

Official league and team presence on Bluesky (checked with `getProfiles` and `searchActors`):

- There is no NFL account.
- `mlb.com` is verified but has 0 posts.
- `espn.com` last posted video on 2026-09-08.
- `theathletic.com` last posted on 2026-08-24.
- `cfbplayoff.bsky.social` last posted on 2026-04-14.
- `pgatour.bsky.social` is empty.
- No team accounts were found worth polling.

## Reddit

- **Unauthenticated `.json` is blocked from here.** All of these returned 403 with an HTML block page:
  - `www.reddit.com/r/nfl/new.json`
  - `/search.json?q=flair:Highlights…`
  - `api.reddit.com`
  - `/new.rss`

  `old.reddit.com` redirects to `/login/?reason=lor2`. Expect the same from Vercel and AWS IPs. The module
  therefore treats an unauthenticated 403 as a block. It backs off from `www.reddit.com` for 30 minutes and
  does not retry within the call. The result shows as `diag.blocked` / `diag.rateLimited`.
- **App-only OAuth** is implemented. It runs when `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` are set:
  - It uses the `client_credentials` grant at `www.reddit.com/api/v1/access_token`, then `oauth.reddit.com`.
  - The token is cached until about 2 minutes before it expires.
  - When `x-ratelimit-remaining` drops below 3, it pauses until `x-ratelimit-reset`.
  - A 401 clears the token.
- **Terms (owner to check before turning OAuth on):**
  - Reddit's Data API Terms and Developer Terms allow free OAuth use within about 100 queries/min per client.
  - Commercial use needs Reddit's written approval.
  - New API apps now go through Reddit's approval process (Responsible Builder Policy).
  - An ES internal tool feeding paid ads is arguably commercial.

  The adapter is built and tested, but **yield is unmeasured** because of the 403.
- **What it reads:**
  - `/new` of the sport subs: r/nfl, r/CFB, r/baseball, r/MLB, r/golf, r/PGATour.
  - r/sports when no sport is given (sport-filtered).
  - The team sub when a team is given: a 62-entry NFL and MLB map. The names are well known but could not be
    verified because of the 403.
  - In-sub search when `query` is set.
  - Crossposts resolve to the parent video.
- **v.redd.it, checked live on ids found via Bluesky:**
  - `DASH_*.mp4` now returns **403**.
  - `CMAF_<h>.mp4` returns 206 and is **video-only**: one `vide` track, no `soun`.
  - Audio is a separate `CMAF_AUDIO_128.mp4`.
  - `HLSPlaylist.m3u8` (with audio) works.
  - All of them return `Access-Control-Allow-Origin: *`.

  The candidate's `mediaUrl` is the `fallback_url` (video-only), with `hasAudio: false`, plus `audioUrl` and
  `hlsUrl`. clips-library or the UI has to decide whether to use the clips silent or mux audio in the
  browser.
- **Streamable:**
  - `api.streamable.com/videos/{id}` is public and needs no key (the API itself sends no CORS header, which
    is fine because it is called server-side).
  - It returns `files.mp4` with width, height, duration and size.
  - The CDN URL `cdn-cf-east.streamable.com/video/mp4/{id}.mp4?Expires=…&Signature=…` returns 206 with
    `Access-Control-Allow-Origin: *`.
  - The URL is **signed and expires after about 3 days**: `expiresAt` is returned and the cache never
    outlives it.
  - The API gives no upload time, so `postedAt` is the Reddit post's time.

## Bluesky

- **Author feeds:** `public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed` works without auth. The account
  list is per sport in `BLUESKY_ACCOUNTS`.
- **Search:** `public.api.bsky.app/…/searchPosts` returns **403**. `api.bsky.app/…/searchPosts` works
  unauthenticated, but intermittently returned 403 or reset under repeated queries, and `#hashtag` queries
  returned 400.
  - Unauthenticated: best-effort, with a 15-minute back-off after a 403.
  - With `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD` (an app password, not the account password), it creates a
    session at `bsky.social` and searches through the PDS proxy with a Bearer token.
  - `CLIPS_BLUESKY_SEARCH=off` turns search off and keeps the feeds.
- **Video is HLS in the app**, but the original upload can be downloaded as an MP4:
  - `video.bsky.app/watch/{did}/{cid}/playlist.m3u8`: CORS `*`; returns 360p and 720p variants.
  - `{PDS}/xrpc/com.atproto.sync.getBlob?did=…&cid=…` returns `video/mp4` with `Access-Control-Allow-Origin: *`.
    `bsky.social/xrpc/com.atproto.sync.getBlob` 302-redirects to the PDS, also with CORS `*`.
  - The PDS is resolved per DID through `plc.directory` (or `did:web`) and cached for 24 h. Only PDS hosts
    matching `*.host.bsky.network` are returned; self-hosted PDSes are counted in `diag.pdsNotAllowed`.
  - Only `mimeType: video/mp4` uploads are returned; other formats are counted in `diag.notMp4`.
  - **Caveats:**
    - getBlob ignores `Range`, so the whole original downloads at once. The NFL median was about 8–12 MB,
      and some files were 37–39 MB.
    - Duration is not exposed (`durationMs: null`), so the 4–120 s check cannot run.
    - `width`/`height` come from the post's `aspectRatio`, which is normally the upload's pixel size.
- **Terms:** the Bluesky public API is open for this kind of read access. Rate limits are generous: about
  3000 requests per 5 minutes per IP on the AppView. The content belongs to the posters. The owner has
  decided copyrighted clips are acceptable, and the source URL is kept in `url`.

## CORS summary (clips-library)

| Host | Browser CORS | Notes |
|---|---|---|
| `v.redd.it/{id}/CMAF_{h}.mp4`, `CMAF_AUDIO_128.mp4` | `*` | video and audio are separate; Range ok; `DASH_*` returns 403 |
| `cdn-cf-*.streamable.com/video/mp4/{id}.mp4?Expires&Signature` | `*` | signed, expires ~3 days; Range ok |
| `*.host.bsky.network/xrpc/com.atproto.sync.getBlob` | `*` | original upload; no Range; can be >30 MB |
| `video.bsky.app/watch/…/playlist.m3u8` | `*` | HLS only (kept as `hlsUrl`) |
| `api.streamable.com`, `www.reddit.com`, `oauth.reddit.com`, `plc.directory` | n/a | called server-side only |

**No server stream is needed:** every media host allows direct browser download. If clips-library still
wants one, for example for the v.redd.it audio mux, allow-list exactly the `MEDIA_HOSTS[].pattern`
regexes, cap at 4 MB, and use `serverStreamOk` / `bytes` where known.

## Env vars

| Var | Default | Effect |
|---|---|---|
| `CLIPS_PUBLIC=off` | on | turns the whole module off |
| `CLIPS_REDDIT=off` | on | skips Reddit |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | unset | Reddit app-only OAuth (recommended; see the terms note above) |
| `CLIPS_BLUESKY=off` | on | skips Bluesky |
| `CLIPS_BLUESKY_SEARCH=off` | on | Bluesky author feeds only, no search |
| `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` | unset | authenticated Bluesky search (more reliable) |

## Politeness

- Every request sends the FrameUp User-Agent and has an 8 s timeout.
- Requests to the same host are spaced out:
  - Reddit public: 1.1 s
  - Reddit OAuth: 650 ms
  - Streamable: 400 ms
  - everything else: 250 ms
- Small pages: Reddit 75, Bluesky 50.
- Results are cached in memory: listings for 12 minutes, failed listings for 2 minutes, DID → PDS for 24 hours.
- On a 429, or a 403 where the host blocks us, the host is skipped until `Retry-After`, `x-ratelimit-reset`
  or `ratelimit-reset`. Without those headers the defaults are 15 minutes, or 30 minutes for the Reddit
  public block.
- The server never fetches video bytes.

## Not used

- **MLB Stats API game content** (`statsapi.mlb.com`, with mlb-cuts-diamond MP4s): MLBAM's copyright notice
  limits it to individual, non-commercial, non-bulk use. It is also the off-season.
- **ESPN `site.api.espn.com`**: undocumented, ESPN's terms forbid automated commercial use, and it returned
  no JSON from here.
- **nfl.com and league sites:** no public JSON video feeds.

## Tests

`scripts/test-clip-source-public.mjs` mocks every network call. It covers:

- parsing of Reddit and Bluesky listings, including crossposts, NSFW, self posts, labels and reposts;
- verified timestamps and freshness, including nanosecond and backdated timestamps;
- throwback, quality and length filters;
- media URL extraction for v.redd.it, Streamable, getBlob and X links, plus the PDS allow-list;
- dedupe within and across sources, and caching;
- the OAuth paths for Reddit and Bluesky;
- 403 and 429 cooldowns, and rate-limit headers;
- env gates, failure isolation, and the `MEDIA_HOSTS` patterns.
