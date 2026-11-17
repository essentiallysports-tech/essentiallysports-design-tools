# Reels Studio data formats: Phase 0 contract

Status: Phase 0 landed on `feature/reels-formats` (2026-11-18). Phase 1 (A, B, C) merged and integrated on the same branch (2026-11-19); the agreed deviations from this Phase 0 text are listed in **§9** and win over the earlier sections. This is the agreement that agents A (data and server), B (render, styles, export, lint) and C (UI, flow, gallery) build against in parallel. Product spec: the research doc `reels-formats-research.md` (coordinator scratchpad), §G.

**Owner decisions.** These are the defaults; apply them.
- **Formats, in build order:**
  1. **Game Swing** (`gameswing`): scorebug, win-probability line and clock over clips.
  2. **Moment Replay** (`replay`): a 3-frame strip, output as a reel and a carousel.
  3. **Hall-of-Fame Archive** (`archive`): a career timeline built from ES coverage.
- **Win probability:**
  - Always shown with the on-screen line `Win probability: ESPN Analytics`.
  - No CollegeFootballData key for now, so the CFBD fallback stays off.
- **Sports:** NFL, CFB and MLB, plus golf where it is already supported (Replay and Archive). No NBA yet.
- **Replay clips:**
  - Clips from X, the clip library or an upload are allowed for organic posts. The existing rights checks still apply.
  - A paid-ad export that contains league footage **warns**.
- **Default styles:** Game Swing uses `series` (ES Analytics Series), Replay uses `classic` (ES Classic), Archive uses `countdown` (ES Countdown).
- **Format gallery:** it sits **beside** the existing trend-first entry and does not replace it.
- **Rules from Phase 0:**
  - No AI calls and no production keys.
  - Existing reels render byte-for-byte as before. This was verified by hashing 96,145 draw calls across 8 timelines, plus their lint, the cost estimate and the fallback plan, on HEAD and on the branch.

---

## 1. Format registry: `reel-formats.js` (frozen after Phase 0)

| Export | Meaning |
|---|---|
| `FORMAT_IDS` | **Unchanged:** `['explainer','stat','top5','quote']`. These are the news formats; the existing format picker lists them. |
| `DATA_FORMAT_IDS` | `['gameswing','replay','archive']` |
| `ALL_FORMAT_IDS` | Both lists together. |
| `FORMATS[id]` | Holds every format. The new entries have the same fields as the old ones (`label`, `short`, `tag`, `blurb`, `beats`, `kinds`, `targetSeconds`, `maxSeconds`), so the director, the lint and the page keep working. They also add `family:'data'`, `description`, `source` (`game`/`clip`/`player`), `sports`, `defaultStyle`, `outputs` (`reel`/`carousel`), `dataKinds`, `voice` (`off`/`optional`), `attribution`, `cost {data, framePick, archiveResearch, hint}`, `rights`, and `carousel.slides {min,max}`. |
| `DATA_KINDS` | `['play','wpline','moment','panel3']`. These are new beat kinds. **They are not in `KINDS`**, so today `buildTimeline` and the director treat them as `point`. Agent B makes the renderer accept `F.ALL_KINDS`. |
| `ALL_KINDS`, `SLIDE_KINDS` (`cover/panel/moment/data/cta`), `SOURCE_KINDS`, `OUTPUTS` | Enums. |
| `isDataFormat(id)`, `formatKinds(id)` | `formatKinds` returns story kinds plus data kinds. |
| `suggestDataFormat(text)` | Hint for a trend card, e.g. "comeback" gives `gameswing`. `routeFormat()` is **unchanged** and never returns a data format. |
| `PRICES.data = 0`, `archiveResearch = 0`, `framePick = 0.002`, `framePickCap = 0.02` | |
| `estimateCost({ ..., data, framePick, archiveResearch })` | Adds the lines `data` ("Game and stats data (free)"), `archive` and `framepick` only when asked. News estimates are identical. |
| `formatCostOptions(id, { aiFramePick })` | The estimate options for a format's defaults. |

**What clamps a format.** The four places that clamp unknown formats to `explainer` all read `FORMATS`, so they now accept the data formats:
- `reel-maker.js` `plan`
- `projectSave`
- `recordEvent`
- `reel-render.js` `buildTimeline`

An unknown format still clamps. No DB migration is needed: `format` is `char_length <= 40`.

**Plan mode with a data format, before A lands.** The director writes a normal story-kind plan, and the free draft keeps `format`. `STYLES.suggestStyle({format})` returns the format's default style.

## 2. Server: `netlify/functions/reel-maker.js` FORMAT_MODES (Agent A)

There is one dispatch table, `FORMAT_MODES[mode] = { gate, label, feature?, run }`, and `formatMode(mode, body, ctx, gates?)` runs it.
- **When `run` is null**, the mode returns **501** `{ ok:false, reason:'coming-soon', mode, error:'<label> is coming soon to Reels Studio.' }`. This happens before any gate or network call.
- **To land a mode,** A sets `run` to a function from the new modules (e.g. `run: games.listGames`). No other edit to `reel-maker.js` is needed.
- **`ctx`** is `{ auth, token, track }`.
- **`run` returns** `{ ok:true, ... }` or `{ ok:false, status, reason?, error }`.
- **Thrown errors:** a thrown budget error becomes 503 `budget`; any other throw becomes 502.

**Gates by mode**

| Mode | Gate | What the gate does |
|---|---|---|
| `games` | `data` | Free. No spend gate. A adds a per-user limiter of 30/min inside `_reel-games.js`. |
| `game-data` | `data` | Same as `games`. |
| `athlete` | `data` | Same as `games`. |
| `archive-research` | `mcp` | Counts toward the hourly limit (MCP is rate-limited). No Gateway spend. |
| `frame-pick` | `ai` | `aiSpendGate(token, {feature:'reels-frame-pick'})`, then the weekly cap, then the hourly cap. Log with `logUsage` feature `reels-frame-pick`. |

**Config.** `config` now also returns:
- `dataFormats`
- `formatModes: { games:false, ... }`: true once `run` is set. C uses this to show "coming soon" tiles.

**New `EVENT_TYPES`:** `data`, `frames`, `carousel_export`.

### 2.1 Request and response shapes

All requests are `POST /api/reel-maker` with a JSON body `{ mode, ... }`, signed in. Shapes are exact, and the fixtures in §7 conform to them.

```jsonc
// games: list games for the picker. TTL: live 15 s, recent/date 60 s.
→ { "mode":"games", "sport":"nfl|cfb|mlb", "when":"live|recent|date", "date":"YYYYMMDD" /* when=date */ }
← { "ok":true, "sport":"nfl", "when":"recent", "date":"20261112"|null, "updatedAt":"ISO", "ttlSec":60,
    "games":[ GameSummary ] }               // <= 60 games; recent = finals in the last 48 h, sorted by drama desc (null last)
GameSummary = { "id":"401873052", "sport":"nfl", "name":"Washington Commanders at New York Giants", "startsAt":"ISO",
    "status":{ "state":"pre|in|post", "final":bool, "detail":"Final", "period":4|null, "clock":"0:00" },
    "teams":{ "home":{ "abbr":"NYG", "name":"New York Giants", "score":21 }, "away":{ ... } },
    "drama": 0..1|null,                      // max |swing| in the game when a digest is cached, else null
    "wpSpark": [0..1] (<= 24 values, home WP) | null }

// game-data: the digest of one game. TTL: live 20 s; final 7 days (immutable after FINAL + 2 h).
→ { "mode":"game-data", "sport":"nfl", "eventId":"401873063" }
← { "ok":true, "digest": GameDigest, "cached":bool, "ttlSec":604800 }
← { "ok":false, "status":502, "reason":"data-unavailable", "error":"Game data is unavailable; use the brief." }   // soft fail

// athlete: search, or stats by id. TTL 24 h.
→ { "mode":"athlete", "sport":"nfl", "query":"tom brady" }
← { "ok":true, "candidates":[ { "athleteId":"2330", "name":"Tom Brady", "sport":"nfl", "position":"QB", "years":"2000-2022" } ] }  // <= 8
→ { "mode":"athlete", "sport":"nfl", "athleteId":"2330" }
← { "ok":true, "athlete": Athlete }          // the same object goes into timeline.data.athlete

// archive-research: ES coverage for a player. $0 AI; MCP calls only.
→ { "mode":"archive-research", "sport":"nfl", "athleteId":"2330", "name":"Tom Brady", "angle":"5 best moments" }
← { "ok":true, "athleteId":"2330", "angle":"...", "cost":0,
    "articles":[ { "id":"a1", "type":"es-article", "title":"...", "url":"https://www.essentiallysports.com/...", "date":"ISO", "entities":["..."] } ],  // <= 30
    "photos":[ { "id":"p1", "url":"https://image-cdn.essentiallysports.com/...", "caption":"...", "credit":"...", "width":1200, "query":"..." } ], // <= 30
    "candidates":[ { "id":"m1", "year":2001, "date":"ISO"?, "title":"...", "line":"...", "stat":{ "value":"2,843", "label":"YDS" }?,
                     "cite":["src:a1"|"stat:s2001"], "photoId":"p1"|null } ],     // every candidate cites; uncited ones are dropped server-side
    "coverage":{ "articles":n, "photos":n, "thin":bool } }

// frame-pick: the vision pick over frames the browser sampled. Indices only, never images back.
→ { "mode":"frame-pick", "clipUrl":"https://x.com/...|''", "segment":{ "in":3.2, "out":9.8 },
    "frames":[ "data:image/jpeg;base64,..." ] /* <= 9, 320 px wide, ~20 KB each (body cap 220 KB) */, "times":[ seconds ], "budgetUsd":0.02 }
← { "ok":true, "setup":1, "play":4, "reaction":7, "clarity":[0..10 x frames], "captions":{ "setup":"<= 6 words", "play":"...", "reaction":"..." },
    "notes":"", "model":"google/gemini-3.5-flash-lite", "cost":0.0016, "cached":bool }
```

**Env vars.** All are optional and off when missing. Phase 0 adds none; A adds them.
- `REELS_FRAME_PICK_MODEL` (default `google/gemini-3.5-flash-lite`)
- `REELS_GAME_CACHE=memory|supabase` (default memory)
- `REELS_DATA_MLB_STATSAPI=off|fallback` (default **off**; MLBAM terms say non-commercial only)
- `CFBD_API_KEY`: **not set** (owner). Keep the CFBD path stubbed.

## 3. Timeline schema v2: `reel-timeline.js` (frozen; `window.ReelTimeline`)

| API | |
|---|---|
| `normalizeTimeline(tl)` | Converts v1 or v2 to v2. It is **lossless** for v1 (every v1 field is kept; beats only gain `refs: []`), idempotent, and never mutates its input. Returns null for non-objects. |
| `validateTimeline(tl)` | Returns `{ ok, errors:[{path,msg}], warnings, bytes }`. v1 timelines validate clean. |
| `validateDigest(d)` | Validates a GameDigest on its own, including the 8 KB cap. |
| `digestFacts(d)` | Deterministic facts text: scores, linescores, each play with period, clock, down, score, and WP % for both teams; the lowest and highest WP; the attribution. **Pass it to `lintTimeline(..., { extraSources })`.** |
| `resolveRef(tl, ref)`, `parseRef(ref)` | |
| `canvasFor(tl)` | Returns `{ w, h, safe }`. |
| `CANVASES` | `reel` is 1080×1920, safe x 65–1015, y 270–1580. `slide` is 1080×1350, safe 60 px on every side. |
| `LIMITS` | Timeline 200 KB, digest 8 KB, plays 30, play text 100, WP points 120, sources 30, photos 30, stat rows 40, labels 16, moments 12, slides 20, refs per beat 8, frames 3. |
| `ATTRIBUTION` | The attribution line per provider. |

```jsonc
{
  "v": 2,                                  // v1 = today's buildTimeline output (no canvas/data/slides)
  "canvas": { "w":1080, "h":1920 },        // or 1080x1350 for a carousel-only project; "size":[w,h] kept in sync
  "outputs": ["reel"] | ["reel","carousel"] | ["carousel"],   // a reel output needs the 1080x1920 canvas
  ...every v1 field (format, tag, style, beats, tracks, assets, sources, corpus, ...),
  "data": {
    "game": GameDigest | null,
    "athlete": Athlete | null,
    "archive": { "athleteId":"2330", "angle":"...", "sources":[ ES article as in §2.1, id "a<n>" ],
                 "photos":[ ES photo, id "p<n>", url on image-cdn.essentiallysports.com only ],
                 "moments":[ { "id":"m1", "year":2001, "title":"...", "line":"...", "cite":["src:a1"|"stat:s2001"] } ], "thin":bool } | null
  },
  "replay": { "origin":"x|library|upload", "clipAsset":"clip:...", "clipUrl":"...", "segment":{ "in":s, "out":s },
              "picker":"ai|code|manual", "frames":[ { "role":"setup|play|reaction", "t":seconds } ] } | null,
  "beats": [ { ...v1 beat, "refs":[ "play:<id>", "wp:<seq>", "src:a1", "stat:s2001", "photo:p1", "frame:setup" ] } ],
  "slides": [ { "id":"s1", "kind":"cover|panel|moment|data|cta", "text":"...", "caption":"..."?, "asset":"..."?, "beat":"b2"?, "refs":[...] } ]  // <= 20, 1080x1350 each
}
```

**Refs.** Each ref is `<type>:<id>` and must match `/^(play|wp|src|stat|photo|frame):[A-Za-z0-9_.-]{1,40}$/`:
- `play:` is a digest play `id`.
- `wp:` is a WP point's `seq` (`wp:-1` is pregame).
- `src:` and `photo:` are archive ids.
- `stat:` is an athlete season row `s<year>` (or `s<year>-<team>`), or `stat:totals`.
- `frame:` is a replay role.

The validator requires:
- every ref resolves;
- a `play` beat has a `play:` ref;
- a `wpline` beat needs WP in the digest;
- a `moment` beat cites `src:` or `stat:`;
- a `panel3` beat has `frame:` refs;
- **WP on screen** (a `wpline` beat or any `wp:` ref) requires `data.game.attribution`.

### 3.1 Athlete

```jsonc
{ "v":1, "provider":"espn", "sport":"nfl", "athleteId":"2330", "name":"Tom Brady", "position":"QB", "fetchedAt":"ISO",
  "source":{ "name":"ESPN", "url":"https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/2330/stats" },
  "stats":{ "category":"passing", "labels":["GP","CMP",...] /* <= 16 */, "names":["gamesPlayed",...],
            "seasons":[ { "id":"s2001", "year":2001, "teamId":"17", "team":"new-england-patriots", "stats":["15","264",...] } ] /* <= 40 */,
            "totals":["335","7753",...] } | null }
```

Stat values stay as ESPN's display strings (e.g. `"2,843"`). Never recompute them.

### 3.2 GameDigest (≤ 8 KB; built by A's `digestGame()`; golden: `scripts/fixtures/reels/nfl-401873063.digest.json`)

```jsonc
{ "v":1, "provider":"espn", "sport":"nfl|cfb|mlb", "eventId":"401873063", "fetchedAt":"ISO", "startsAt":"ISO"|null,
  "source":{ "name":"ESPN", "url":"<summary URL>" },
  "status":{ "state":"pre|in|post", "final":bool, "detail":"Final", "period":int|null, "clock":"" },
  "teams":{ "home":{ "id":"6", "abbr":"DAL", "name":"Dallas Cowboys", "score":40, "linescore":[10,6,3,21], "colors":["#rrggbb"]?, "logoId":"..."? },
            "away":{ ... } },                // never a logo URL (no espncdn); logos come from FrameUp's logo library
  "attribution":"Win probability: ESPN Analytics",   // required when wp.points is non-empty
  "wp":{ "team":"home", "points":[ [seq, wpHome] ] /* <= 120, seq increasing, -1 = pregame */, "count":203 } | null,
  "plays":[ {                                // <= 30, seq increasing
      "id":"401873063558", "seq":4, "period":1, "clock":"6:56", "half":null|"top"|"bottom" /* MLB */,
      "text":"<= 100 chars", "type":"Passing Touchdown",
      "score":{ "home":3, "away":7 },        // after the play
      "wallclock":"ISO"|null,                // snap time (clip matching: X post time minus wallclock in 1-15 min)
      "wpHome":0..1|null,                    // home WP after the play
      "swing":-1..1|null,                    // wpHome minus the previous WP value (pregame for the first); + = toward home
      "scoring":bool, "down":"1st & 10"|null /* football, before the snap */, "yards":11|null,
      "team":"home"|"away"|null,             // possession (football) / batting (MLB)
      "tags":["scoring","swing","lead-change","period-end","final"] } ] }
```

**Digest rules.** Agent A implements these exactly; the golden fixture follows them.
1. **`seq`** is the index of the play in the flattened play list:
   - football: `drives.previous[].plays[]` in order;
   - MLB (ESPN): `plays[]`.
2. **WP points** are `[seq of the play whose id matches winprobability[].playId, homeWinPercentage]`.
   - A **leading** unmatched entry becomes `seq -1` (pregame).
   - Other unmatched entries are dropped.
   - The series is downsampled to ≤ 120 points, always keeping the min, the max, the first and the last.
   - MLB StatsAPI percentages (0–100) are divided by 100.
3. **Text.** For a scoring play, use the matching `scoringPlays[].text` (trimmed). Otherwise:
   - strip leading parentheticals such as `(Shotgun)`;
   - cut at the last sentence end ≤ 100 characters, else at a word boundary ≤ 99 plus `…`.
4. **Tags:**
   - `scoring`: `scoringPlay`.
   - `lead-change`: the leader flips between home and away. A move from a tie does not count.
   - `period-end`: the last play of each period in the list.
   - `final`: the last play, only when `status.final` and its score equals the final score.
   - `swing`: one of the 12 largest `|swing|`, with `|swing| ≥ 0.05`.
5. **Selection.** Keep only tagged plays. If there are more than 30, drop `swing`-only plays with the smallest `|swing|` first, then `period-end`-only plays. Keep the result in `seq` order.
6. **Size.** If the digest is over 8 KB, shorten play text to 80, then 60 characters, then halve the WP points.

## 4. Elements and render: `reel-styles.js` (Agent B owns from Phase 1)

**`ELEMENTS`** are the overlay and card pieces of the data formats:

| Element | Purpose |
|---|---|
| `scorebug` | Teams, scores, period, clock, possession dot, down and distance. |
| `wpline` | Band or full-screen line, with 0/50/100 guides. |
| `clock` | Period plus clock. |
| `playcard` | Down chip plus the play line. |
| `panel3` | The 3-frame strip. |
| `timeline-node` | The year rail. |
| `source-chip` | The source line. |
| `attribution` | The WP attribution line. |

**Fields of each element:**
- `kinds`: the data kinds that use it.
- `zone`.
- `box` (1080×1920) and `box45` (1080×1350); `wpline` also has a `full` box.
- `tokens`: palette keys and type roles.
- `notes`.

**Tokens, boxes and the stub draw**
- `ELEMENT_TOKENS[style][element]` holds per-style overrides.
- `elementTokens(styleId, elementId)` resolves them to colours and ES font stacks.
- `validateStyle` now also checks every element token: it must be an ES font or a colour, and never purple.
- `elementBox(id, canvas)` returns the default box. Every default box is inside the safe area. The scorebug ends at x 808, clear of the ES mark (x 870, 50 px clear space).
- `drawPlaceholder(ctx, elementId, box, styleId)` is the Phase 0 stub. It draws a dashed, labelled box (`SCOREBUG · COMING SOON`) in the style's tokens and returns the op. It never throws. Keep it as the fallback for missing data.
- `FORMAT_STYLES` maps a format to its default style, and `suggestStyle({format})` honours it.

**What B builds in Phase 1:**
- **Render:**
  - accept `F.ALL_KINDS` in `buildTimeline`;
  - copy `refs` from plan beats into timeline beats;
  - emit `v: 2` plus `canvas` (via `normalizeTimeline`);
  - thread `canvas` through `layoutStyled`;
  - draw the elements in all 4 styles, using real data resolved through `resolveRef`;
  - draw slides with `buildSlides()`.
- **Export:** `exportStills()` writes a PNG zip via `frameup-zip.js`.
- **Lint rules:**
  - `data-attribution` (critical);
  - `archive-cite`;
  - `archive-date`;
  - `asset-host` (no `espncdn`/`mlb.com` images);
  - `replay-real-frames`;
  - the paid-export warning when a Replay contains league footage (`FORMATS.replay.rights.paidWithLeagueFootage === 'warn'`).

**The v1 path must stay byte-identical.** Re-run the hash check (§8).

## 5. Flow: `reel-flow.js` (frozen; Agent C consumes)

- `initial()`, `STEPS` and `STAGES` are **unchanged**, so the news flow is the same as before.
- `ALL_STEPS = ['format','source','story','review','export']`.
- `ALL_STAGES` adds `data` and `frames` before `script`.
- `stepsFor(format)`, `stagesFor(format)` (with per-format labels) and `sourceKindFor(format)` (`trend` for news formats).
- `FORMAT_FLOWS`:
  - `gameswing`: source `game`; stages `data`, `script`, `voice`, `visuals`, `build`.
  - `replay`: source `clip`; stages `frames`, `script`, `build`.
  - `archive`: source `player`; stages `data`, `script`, `voice`, `visuals`, `build`.
- `SOURCE_KINDS[kind] = { modes, required, origins?, angles? }`. Source objects:
  - `game`: `{ kind:'game', sport, eventId, label }`
  - `clip`: `{ kind:'clip', origin:'x'|'library'|'upload', url | assetId, segment?, gameRef? }`
  - `player`: `{ kind:'player', sport, athleteId, name, angle }`
- `sourceReady(format, source)`.

**New events**
- `{type:'pick-format', format}`: from the gallery. A data format starts on `source`; a news format goes to the old `story` state.
- `{type:'set-source', source}`: moves `source` → `story` once the source is complete.
- `go` accepts `format` and `source` in data flows.
- `make` refuses until the source is ready, then starts the format's first stage.
- A failed `data` stage stops the run, the same as `script`. A failed `frames` stage is soft (the code pick is the fallback).
- `reset` keeps the format.

## 6. Ownership and interfaces

| Agent | Owns (exclusive) | Reads |
|---|---|---|
| **A: data and server** | `netlify/functions/_reel-games.js`, `_reel-archive.js`, `_reel-frame-pick.js` (new); `_reel-director.js` (data-format prompt sections); `netlify/functions/reel-maker.js` (**only** setting `FORMAT_MODES[*].run` and the `plan` hand-off of digest/archive facts); `reel-data.js` (new, UMD: `planFromGame`, `keyPlays`, `dramaScore`, `scorebugAt`, `matchClipToPlay`, `planFromArchive`); `scripts/fixtures/reels/*` (writes); `scripts/test-reel-games.mjs`, `test-reel-data.mjs`, `test-reel-archive.mjs` | `reel-formats.js`, `reel-timeline.js` |
| **B: render, styles, export and lint** | `reel-render.js`, `reel-styles.js`, `reel-replay.js` (new: `candidateFrames`, `sharpness`, `sceneChange`, `panelLayout`, `buildSlides`), `reel-export.js`, `reel-lint.js`, `scripts/test-reel-render.mjs`, `test-reel-styles.mjs`, `test-reel-replay.mjs`, `test-reel-lint.mjs` | the fixture timelines and digest |
| **C: UI, flow and gallery** | `reel-gallery.js` (new), `reel-maker.html`, `reel-maker.js`, `reel-maker.css`, `assets/reels/formats/*`, `tours/updates.json` entry, `scripts/test-reels-gallery-ui.mjs` (new) | `reel-flow.js`, `reel-formats.js`, the response fixtures (mock `fetch` with them until A lands) |
| **Frozen (integrator only)** | `reel-formats.js`, `reel-flow.js`, `reel-timeline.js`, this contract, `scripts/test-reels-formats-core.mjs` | everyone |

**Interfaces between the agents**
- **A to B:** the GameDigest, Athlete and archive shapes (§3), and `digestFacts` as the lint's extraSources. A's `reel-data.js` `planFromGame(digest)` returns a plan whose beats carry `refs`. B draws only from the resolved refs: no numbers come from the model.
- **A to C:** the §2.1 request and response JSON, `config.formatModes` (feature flags), and the 501 `coming-soon` answer while a mode is not built.
- **B to C:**
  - `R.buildTimeline(plan, { style, canvas })`
  - `R.buildSlides(plan, opts)` returns slide timelines
  - `exportStills(slides)` returns a zip Blob
  - `S.ELEMENTS` for the gallery previews
- **C's own ground rules:**
  - The page loads `reel-timeline.js` (add the script tag with `?v=20261118-<branch>`).
  - The page calls `normalizeTimeline` on project load, so old v1 cloud projects keep working.

**Rule.** If a shape has to change, the change goes to the integrator as one PR that edits the frozen file, this doc and the fixtures together.

## 7. Fixtures: `scripts/fixtures/reels/`

**Real responses, trimmed** (GET only, no keys, 2026-11-17/18):
- `espn-nfl-summary-401873063.excerpt.json`
- `espn-cfb-summary.excerpt.json`
- `espn-nfl-scoreboard.excerpt.json`
- `espn-cfb-scoreboard.excerpt.json`
- `espn-golf-pga-scoreboard.excerpt.json`
- `espn-core-probabilities.json`
- `espn-athlete-2330-stats.excerpt.json`
- MLB StatsAPI files, for the off-by-default fallback only: `mlb-winprob-849799.excerpt.json`, `mlb-linescore-849799.json`, `mlb-feed-live-849799.excerpt.json`

No NBA and no MLB highlight-content files are included.

**Adapter input**
- `espn-nfl-summary-401873063.min.json` is the NFL excerpt reshaped into the real response shape: `header.competitions[0].competitors[].team`, `drives.previous[].plays[]`, `winprobability[]`, `scoringPlays[]`.
- It holds 5 plays out of 203, so it is a truncated game.
- It contains only excerpt values. The only additions are the team ids (from the play `start.team` ids) and the display names.

**Golden and response fixtures:**
- `nfl-401873063.digest.json`: the digest of the min summary under §3.2 rules (1,303 bytes).
- `game-data-401873063.response.json`
- `games-nfl.response.json`
- `athlete-2330.response.json`
- `athlete-search.response.json`
- `archive-research-2330.response.json`: a stat-rows-only, thin-coverage shape. No ES articles were fetched, so none are invented.
- `frame-pick.response.json`: a shape fixture.

**v2 timelines:**
- `timeline-v2-gameswing.json`
- `timeline-v2-replay.json` (reel and carousel)
- `timeline-v2-archive.json` (reel and carousel)

All three validate.

## 8. Tests

```bash
export PATH=$HOME/usr/local/bin:$PATH
node scripts/test-reels-formats-core.mjs          # this contract (16 tests)
for f in scripts/test-reel*.mjs; do node $f | tail -1; done   # existing reel tests
for f in scripts/test-*.mjs scripts/check-*.mjs; do node $f >/dev/null 2>&1 || echo FAIL $f; done
```

**Baseline failures.** Exactly 7, all unrelated:
- test-auth-security
- test-canvas-action-dock
- test-color-swatch-states
- test-newsletter-header-options
- test-reels-transcription-framework
- check-dashboard-ui
- check-site-chrome

**Render-equality check (B, before merge).**
1. Build stat and top5 timelines in all 4 styles.
2. Draw a frame every 397 ms into a recording stub context.
3. Hash the timelines, lint, `estimateCost` and `fallbackPlan` output together with the draw-call log.
4. Compare the hash on `HEAD~` and on the branch.

The Phase 0 numbers: hash `90a7617f…aa17d0`, 96,145 calls on both.

**Every test mocks `fetch`.** No network.

## 9. Agreed deviations after Phase 1 (integrator, 2026-11-19)

These came out of the Phase 1 builds and a live-data check (real ESPN GETs, 2026-11-18). Where they differ from §1–§8, this section wins.

**Data and server (A)**
1. **Digest rule 6 (fitting).** A full NFL or CFB game does not fit 30 plays plus 120 WP points in 8 KB. `fitDigest` goes in this order, stopping as soon as the digest fits:
   1. shorten play text to 80, then 60 characters (rule 3 cut; abbreviations such as `Sr.`, `Jr.` and initials are not sentence ends);
   2. halve the WP points, never below **60** (`WP_FLOOR`);
   3. drop `period-end`-only plays (oldest first), then `swing`-only plays (smallest `|swing|` first);
   4. halve the WP points again, down to 4;
   5. drop plays that are neither `final` nor `lead-change` (smallest `|swing|` first), then any play (oldest first).
   Live check: SF–DAL 7,994 B (20 plays, 60 WP points of 203), LAC–BAL 8,073 B, TEX–LSU (CFB) 8,076 B, MIL–TB (MLB) 6,339 B (70 of 70).
2. **Live football: `drives.current`.** Rule 1's flattened play list also takes `drives.current.plays[]` (when that drive is not already in `drives.previous`), so a live game's latest plays are in the digest.
3. **Drama is a composite**, not the max `|swing|` of §2.1: `dramaScore = 0.45·swing + 0.2·leads + 0.15·late + 0.2·comeback`, each 0..1 (`reel-data.js` `dramaParts`: swing = the biggest `|swing|` / 0.5; leads = lead changes / 4; late = a score in the last period within one score; comeback = how far below 50% the winner fell). Null without plays or WP.
4. **Archive `datePrecision`.** An archive article carries `datePrecision: 'day' | 'year'`. An article found for a career year but published in a different year gets `date: '<year>-01-01'` and `'year'`; only `'day'` dates are copied onto a moment's `date`. The `archive-date` lint reads it.
5. **Frame-pick frame size.** Each frame data URL is at most **60,000 characters** (~44 KB JPEG; the page sends ~20 KB at 320 px), at most 9 frames, inside the 220 KB request cap.
6. **`plan` with `playIds` (Game Swing).** The page sends `playIds` (the editor's ticked key plays). The server keeps only ids that are plays of the (re-validated or cached) digest, plans exactly those (the strongest **5** by `playWeight` when more are ticked, in game order, with an issue line "Kept the 5 strongest…"), and answers **422 `no-plays`** when `playIds` is sent but none is valid (an empty array included). Without `playIds` the code picks 4 key plays.
   ```jsonc
   → { "mode":"plan", "format":"gameswing", "digest": GameDigest, "playIds":["401873063558", ...], "clips":[{ "url","handle","text","postedAt" }] }
   ```
7. **`game-data` with `clips:true`.** Additive `clipMatches: [{ playId, url, handle, text, postedAt, lagSec, confidence, reasons, variants, thumb, durationMs, sourceKind }]` (≤ 30, sure matches only, from the clip library). The page sends them back as `plan.clips`; `planFromGame` re-matches each clip against **every** play (a clip goes to the play it shows) and puts only sure matches on a play beat (`visual:'clip'`, `beat.clip`). Game Swing play beats show only their matched clip, else a photo; they never take an unmatched clip from the general clip pool.

**Timeline, render and lint (B)**
8. **v2 only for data formats.** `buildTimeline` emits `v: 2` (canvas, outputs, data, replay, slides, refs) only for `gameswing`, `replay` and `archive`. News reels keep building today's v1 timeline byte for byte (the §8 hash gate).
9. **Captions on replay frames.** `replay.frames[]` may carry `caption` (≤ 6 words, number-free, from frame-pick or the editor); the panels and slides draw it.
10. **Element boxes (reel, 1080×1920)** were re-stacked so nothing overlaps the ES mark or each other: scorebug x 88 y 288 720×104 (ends at x 808); clock tab x 588 y 400 220×48 (under the bug's right end); WP band x 88 y 472 904×144 (full chart y 640, 904×600); play card y 1172; panel3 strip x 88 y 456 904×1104; source chip y 1448; attribution y 1512. The 4:5 boxes moved to match (see `S.ELEMENTS`).
11. **The clock never ticks.** The clock tab shows the period and clock exactly as the digest has them; it is static for the whole beat (a ticking clock would show times that are not in the data).
12. **Extra lint rule ids** beyond §4: `data-numbers` (every number on a v2 beat must be in its refs or the facts), `scorebug-clear` (scorebug/clock clear of the ES mark), `paid-league-footage` (the paid-ad warning), `slides` (carousel checks via `lintSlides`).
13. **Extra beat fields** in data plans (all optional, ignored by news reels): `holdMs` (the beat's designed hold, clamped 1.2–7 s), `playRef`, `clip { url, handle, lagSec, confidence, matchedBy }` on a play beat, and on a `wpline` beat `from`, `to`, `marks`, `team`, `attribution`; archive `moment` beats carry `year`, `title`, `line` and `cite`.
