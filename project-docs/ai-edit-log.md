# AI Edit Log

Running handoff log for edits made to this site by any AI assistant (Claude or otherwise).
**Read this file first** before making changes, so you know what's in progress, what's finished,
and what's still uncommitted.

## 2026-11-25 — Suhail (Claude): Reels Studio 2.0 (branch release/reels2)
- Status: committed on release/reels2, not pushed (owner: one release, all checks, preview first).
- Built in four lanes on top of a page context (`window.ReelMakerCtx`), merged here:
  - A, looks: `reel-es-themes.js`, 8 looks on the ES engine (Paper default, byte-identical to before), `validateLook`, look lint; old styles retired and converted on open; data formats on ES.
  - B, data: ideas room (`_reel-ideas.js`, mode `ideas`: ES most-read + coverage + trend + ESPN, grounded angles, free drafts), ES coverage in `plan()`, trend radar (`reel-radar.js` function, official X clips by views/hour, Haiku read), trends with an ES angle and NBA/WNBA/tennis/NASCAR labels.
  - C, inputs: caption files, own voiceover (upload/record, `voice-align`: free transcription first, then alignScript), media tray with IndexedDB v2 persistence, new event types.
  - D, interface: Start screen with six tiles and recipes (`reel-recipes.js`), storyboard (`reel-storyboard.js`) with colour chips and reorder, one settings rail, 3 versions, Export all zip, accessibility (`reel-a11y.js`).
- Integration: the look reaches the director; retired styles are written as ES; FEATURE_NAMES labels; tour copy; guidelines; `npm test` runs the reel suite; cache key 20261125-reels2.
- Cost: ideas ~$0.002 (Sonnet ~$0.04 on request, fact check up to $0.03); radar read ~$0.001; voice sync $0 (Groq) or ~$0.004/min; versions $0-0.0015.
- Needs a live check: ES MCP / ESPN / X sources, real voice sync, Opus-free director prompt sizes. Thin: NBA/WNBA/NASCAR trend feeds, radar clips only NFL/CFB/MLB.
- For Vinay: the 7 new looks, green-on-paper contrast in the kit, Fan pulse end-card CTA "YOUR CALL. / TELL US BELOW."

## 2026-11-21 — Suhail (Claude): Dashboard Newsletter tab; Newsletter exports record asset and newsletter (branch feature/dashboard-newsletter-exports)
- Status: committed, not pushed (d2f1442 + cache keys / notes commit).
- Why (owner): "make me see in dashboard what all newsletter exports people are doing."
- **What was recorded before:** each Newsletter image export is an `es_designer_tasks` row (workspace `Newsletter`, `task_type exported_design`): who (creator email + name), when (`metadata.exportedAt`), title (canvas name / headline), file name, `workspace_variant` = the asset *label*, size (`metadata.outputSize`), `metadata.mimeType`, preview in Storage (`previews/<id>`). The newsletter brand only reached `team_or_league` as `state.team || state.newsletterBrand`, so it was usually a team name. The usage log (`frameup_usage_events`) got the same export (tool `newsletter`, `template`, `size`), copied widget HTML (label = asset id, `brand` = the editor brand, wrong for Trivia / Ticker / Desktop News Layout, which keep their own) and image links (size only).
- **Added (index.html, tracking only):** `newsletterExportInfo()` / `newsletterTrackMeta()`. Newsletter exports add `metadata.newsletterAsset`, `newsletterAssetLabel`, `newsletterBrand`, `newsletterBrandLabel`, `format` (PNG/JPEG); widget HTML copies and image links add `asset`, `template`, `brand`, `brandLabel` (and `format: HTML`). The builders' own brand is used for Trivia / Ticker / widgets. No personal data added. Export drawing, file names, the UTM context and copied HTML are unchanged (diff is only these calls), so exported images are byte-identical.
- **dashboard-data.js:** the task list reads the new fields as light JSON aliases (`meta_nl_asset`, `meta_nl_brand`, …; null on older rows); `trackDesignExport` passes asset / brand to the usage log; new read-only `fetchUsageEvents({ sinceIso, tool, categories })` (admins-read RLS, same table as Usage). No migration needed.
- **Dashboard → Newsletter tab** (after Exports; `frameup-newsletter-stats.js` maths, `frameup-newsletter-view.js`, `frameup-newsletter-view.css`): summary strip (this week, 7 / 30 / 90 days, most exported asset, most active person), exports over time in the Overview chart style (weekly above 30 days), by asset type / person / newsletter (click to filter), recent exports table (thumbnail via the existing preview loader + preview modal and task drawer, asset, newsletter, size · file, person, time) with range, person, asset, newsletter filters, search and Show more; loading / empty / error / stale states; notice that older rows have no brand. Image exports from the task list; copied HTML and image links from the usage log (usage `export` rows skipped: same as task rows). Admins only (page gate + RLS).
- Cache key `20261121-nl`. Release note `2026-11-21-dashboard-newsletter`.
- Tests: new `scripts/test-dashboard-newsletter.mjs` (22: rows from new and old metadata, aggregation, series, filters, search, empty data, asset / brand lists in step with index.html, `newsletterExportInfo` run on stubbed editor state, only tracking calls use it, wiring); `check-dashboard-ui` extended (tab, section, states, labels, tokens only, phone layout). Suites below.
- Visual QA (local mock server, sample data, no Supabase): 1440 / 1024 / 768 / 375, light + dark, empty / error / loading / usage-log-missing; no horizontal scroll. Shots `.claude/shots/dashboard-newsletter-*.png`.
- Unverified: real data with a signed-in admin (the new metadata starts with the next export after deploy).
## 2026-11-21 — Suhail (Claude): ES Reels design system in Reels Studio (branch feature/reels-es-system)
- Status: committed, not pushed.
- Why: the ES video team's reels brand kit (from Vinay, `es-reels-design-system.md`) becomes Reels Studio's house style: every reel should look like the video team's system. Only the markdown was available (not the kit's HTML template or logotype file), so the written rules are implemented exactly and the template's unwritten choices are inferred and marked `INFERRED` in `reel-es.js`.
- **New `reel-es.js`** (UMD, `window.ReelES`): tokens (blue #0A7DFA, ink #121212, paper #F1EFEA, green/red/yellow signals), type (Acumin Pro Condensed Black → Roboto Condensed 800, 0.84 / -0.01em, boxed words 0.16em cap-height-to-baseline), motion constants, the seven blocks with exactly their fields (`blockOf` maps every beat kind; `cleanBlock`, `legacyFields`), `*word*` caption emphasis, `scriptToPlan` (the person's script word for word, blocks picked by code, $0), layout ops with boxes (9:16 and a scaled 4:5), drawing (paper + grain, slab wipe, square ES mark from the official letters, logotype, stamp slam + shake, dot grid, bars, count-up), the checklist as `checks()` / `checklist()`, and the plain-English `GUIDELINES`.
- **Styles (`reel-styles.js`):** new `es` style first in `STYLE_IDS`, `DEFAULT_STYLE = 'es'`, `suggestStyle` returns `es` for news reels (data formats keep the owner's defaults; old heuristics kept as `legacySuggestStyle`). Every palette now uses the ES brand layer (countdown's navy/gold → ink/yellow; classic → ink).
- **Renderer (`reel-render.js`):** ES timelines (v1) draw through reel-es: blocks, one shot per scene drifting 1 → 1.1, the end card last for exactly 3 s with no VO (added when missing), stamp lands on its spoken word, `timing.estimate`, `sourceLine` (from the plan or the reel's sites), `aspect: '4:5'`. Shared brand layer for every style: the ES mark is an 80 px blue square (official letters), right 60 / top 330, clear 40, on the hook and the end card only (was 122×104 on every frame); logotype 96 px tall (was 417 px wide); no text-shadow blur (glow) and no light leak (lens flare). Slides keep their mark top-right at y 60, now the 80 px square.
- **Lint (`reel-lint.js`):** ES checks (safe frame, ≤2 signals, pill/line/quote lengths, numbers as spoken, end card + 3 s + source, frame one, emoji / left-edge stripes / glow); the ES safe frame for words in every style; the logo rule follows the new mark. Number provenance walks block fields (`reel-formats.js`).
- **Director (`_reel-director.js`):** in the ES style the prompt lists the seven blocks and their fields; `validatePlan` keeps a valid block, holds its numbers/quotes to the same source rules. Cost: about +600 input tokens a script in the ES style (≈ +$0.0006 on Haiku, flagged).
- **Page (`reel-maker.html/js/css`):** Story gets a **Script** source (your script, source line, optional VO length; never rewritten, Revise with AI hidden). Review edits each beat as its block (block picker + exactly its fields; end card edits the CTA and source line). ES blocks without media sit on paper (no designed background / team tile filled in). Quality checks show the 8-row ES checklist and the status line says "Safe frame ✓". Safe zones overlay shows the ES frame, caption line and mark spot. "ES video guidelines" dialog. Export: Size 9:16 / 4:5 (ES), MP4 export unchanged.
- Tests: new `scripts/test-reel-es.mjs` (21); updated for the intended changes: test-reel-styles, test-reel-quality, test-reel-render, test-reel-lint, test-reels-formats-core, test-reel-maker-api, check-reels-ui (+ Script/ES states; the audit lets a modal dialog cover the page). `run-suite.sh reel` OK (only test-reels-transcription-framework fails, accepted). Sample reels rendered and reviewed (stat, quote, compare, scale, 4:5, plus classic/explainer).
- Exports: `index.html` untouched (editor exports byte-identical). Reels output changes on purpose (new default style, mark rules, no glow/leak in every style).
- Needs the kit's files to be exact: the HTML template (block sizes, positions, stamp/kicker styling, end-card composition, quote layout, count-up timing) and the ES logotype / mark files (the mark is the official 122×104 artwork scaled to 80 px wide inside an 80 px blue square).
## 2026-11-21 — Suhail (Claude): Video Ads "Competitor ads" (branch feature/va-competitor-ads)
- **Owner action needed:** add `APIFY_TOKEN` (an Apify API token) in the Vercel **Enterprise project (frameup)**. Until then the panel says "Ask an admin to add APIFY_TOKEN in Vercel to turn this on" and the API answers `reason: 'not-set-up'`; nothing else changes. Optional: `APIFY_WEEKLY_LIMIT_USD` can only lower the $4 weekly cap.
- **Meta terms caveat:** this collects ads from Meta's public Ad Library automatically, through a third-party scraper (Apify actor `igolaizola~facebook-ad-library-scraper`). Whether that is acceptable under Meta's terms is the owner's business decision. Nothing is stored.
- What (owner: "which ads are running good or bad, what's the current trend", "ideate better than our competitors"): a **Competitor ads** button beside the Video Ads steps opens a full-width view (the work area hides; any step, "Back to your ad" or Esc returns; `#competitors` deep link). Quick picks (sports publishers + best-in-class newsletters, `QUICK_PICKS` in `video-ads-competitors.js`; the person's extra picks in localStorage only), a box for a brand / Facebook Page link / keyword, country, "Include stopped ads", **Check** (cost shown before: about $0.015 for 50 ads; real cost after). Results: summary strip (ads, video / image / carousel, median days running, 30+ days, new this week), tabs Working / Testing / Trends / Not working / Ideas / All ads, ad cards (creative, text, CTA, days running, platforms, View in Ad Library; broken images fall back to a neutral tile), 5 ideas for Essentially CFB / ES Dugout / The Huddle with **Use this idea** (switches the newsletter, fills headline / highlight / body / CTA through `applyCopy`, Undo toast; the newsletter switch itself is not undone). Loading with ETA, idle, empty, error, not set up, over-cap and AI-error states; keyboard (tabs with arrows, Esc), phone layout, focus rings.
- Server: new `netlify/functions/meta-ads.js` + `api/meta-ads.js` (vercel.json maxDuration 120). POST modes `status`, `advertisers`, `ads`, `analyze`; `verifyEsUser`, hourly limit, `aiSpendGate`, capped inputs, plain-English errors (401 / 402 / 403 plan / 408 / 429 / timeout). Actor input and field mapping re-implemented from fb-ad-library-mcp (MIT, credited in the file); no new dependencies. Token sent as an `Authorization: Bearer` header, never in the URL. In-memory 30-minute cache per query (no storage). Each run logged as `meta-ads-fetch` (results x $0.30 / 1000) so it shows in AI spend; code-side weekly cap $4 team-wide (reads the week's `meta-ads-fetch` rows with the service role when set, else this server's own count). Analysis: Haiku (main tier), `meta-ads-analyze`, about $0.002; Working / Testing buckets are decided in code (30+ days / last 7 days) and the AI only explains them; any number not in the ads' own text is dropped, ideas carry no numbers; free mode returns the counted facts without AI. `_ai-gateway.js`: one line, the label "Competitor ads" for AI_DISABLE messages. CSP: report-only `img-src` already allows `https:`, so Facebook CDN images need no change; videos are linked, not played, so `media-src` is unchanged.
- Sample data: on localhost (or `?demo=ads` off production) the panel uses `video-ads-competitors-demo.js` (made-up "Sample ..." brands, labelled "Sample data", a picker for every state); it never calls Apify or AI. `?demo=off` uses the real API locally.
- Cache key `20261121-compads` (new files on video-ads.html). Release note `2026-11-21-video-ads-competitor-ads`.
- Tests: new `scripts/test-meta-ads.mjs` (23 groups, all pass); `check-video-ads-ui.mjs` gains 20 Competitor ads states (sample data + live API stubs), 562 states, 0 issues; `run-suite.sh video` OK; full `run-suite.sh` (127 files): only the 3 allowed failures; inline-syntax OK.
- Unverified until the token exists: the actor's real output field names (handled: Meta snake_case passthrough, camelCase, flat), whether `fetchDetails: true` slows runs, any per-run start fee on top of $0.30 / 1000, and how well a brand name finds its Page from a keyword run.

## 2026-11-21 — Suhail (Claude): What's new dates fixed (branch suhail/release-note-dates)
- Status: pushed.
- Six release notes were dated ahead of their release (2026-11-23 / 2026-11-25), so they sat above newer notes and Manish's Archive Page FI note was buried. They are now dated 2026-11-21 (today) with matching ids, and the 2026-11-21 block is ordered by when each note really landed (newest first).
- `tours/updates.js`: `RENAMED` maps the old ids to the new ones, so anyone who already saw a note isn't shown it again; newer notes still show. The profile menu's What's new dot may light up once.
- Rule for everyone: date a release note with the day it goes live, never ahead (`add-release-note.mjs` already does).
- Tests: test-tour (new rename cases), test-newsletter-archive-page-fi.

## 2026-11-21 — Suhail: full check of main; tests no longer touch production; Video Ads toolbar fix (branch suhail/reels-sweep-no-prod-writes)
- Status: pushed in 1437087.
- Why: a full suite run on main (clean LF copy) found: the Reels sweep sent requests to production Supabase with its fake QA session (usage tracker rows and the AI spend meter; all refused with 401, nothing written); the "Move text" label overflowed the Video Ads toolbar around 1024; two tests still expected old behaviour.
- Changed: `check-reels-ui` blocks `*.supabase.co/rest/v1/*`; `check-editor-ui` and `check-panel-hygiene` block the usage-events endpoint (both fake a session); `check-pages-ui`, `check-video-ads-ui`, `check-generate-ui` already mock or block Supabase. `video-ads.css`: "Move text" collapses to its icon when the toolbar is under 900px, like Meta preview and Safe zone (cache key `20261125-movelbl` on video-ads.html, design-system.html). `test-video-ads-render` expects the 30 s custom length (2db0038); `test-ai-guardrails` expects Sonnet as default director (f7e049e) and still checks the auto mode (Haiku first, Sonnet on escalation).
- Tests: full suite on a clean LF copy of main: everything passes except the 3 allowed failures; reels, video-ads and panel-hygiene sweeps now pass; editor sweep passes alone (accordion timing flakes under load). Video Ads toolbar checked at 1024 and 1440.

## 2026-11-20 — Suhail: Dashboard "Exports over time" chart fix (branch suhail/dashboard-chart-fix)
- Status: pushed in d7f241f.
- Why: at 90 days the chart drew ~90 jagged daily points, and the SVG stretches to its box (preserveAspectRatio none), so the end dot was squashed into an oval at the right edge.
- Changed (`dashboard.html`, `dashboard-ui-system.css`): ranges over 30 days plot weekly totals (weeks end today; tooltip "Week of …", meta "weekly · peak N in the week of …"); dots are HTML marks over the SVG so they stay round; right padding 8 → 14. 24h / 7d / 30d unchanged. Cache key `dashboard-ui-system.css?v=20261125-chart`. Release note `2026-11-25-dashboard-trend-chart`.
- Tests: inline-syntax, check-dashboard-ui, check-dashboard-supabase, test-usage-tracking, test-impact, test-home-today pass. Local QA with 700 mock exports: dot 10×10 px at 24h/7d/30d/90d, inside the card; 375 px dark, no horizontal scroll; hover tooltip "58 exports · Week of Oct 3".

## 2026-11-20 — Suhail: Track everything taken from FrameUp + dashboard cleanup (branch suhail/dashboard-tracking)
- Status: pushed in a744d0d. Live check 2026-11-20: a Gallery "Make another" row reached the table and shows in Dashboard > Usage. Migration `supabase/migrations/20261125120000_frameup_usage_events.sql` run 2026-11-20 in the Supabase SQL editor (table created, RLS on, insert-own + admins-read policies checked, 0 rows).
- Why: owner asked to see everything taken from FrameUp, not only editor exports, and a tidier, categorised dashboard.
- **Tracker `frameup-track.js` (new):** `FrameUpTrack.track(category, { tool, action, label, meta })`. Categories: export, download, copy, share, open, generate. Tools: social, youtube, newsletter, generate, video-ads, reels, reels-studio, image-pool, gallery, trends, requests, home, design-system, other. Fire-and-forget, never throws, batches (1.5 s debounce, 20 per insert), client uuid + `ignoreDuplicates` so retries never double count, missing table / signed out / offline -> kept locally and sent on a later page, rejected rows dropped. Labels and meta scrubbed of emails and data/blob URLs, meta ≤ 12 keys / 2 KB. Off inside iframes (Generate's hidden editor), so nothing is counted twice.
- **Wired:** editor exports via `recordDesignExport` (all workspaces + design-request page), size-pack ZIP, image link, newsletter widget HTML; Generate PNG / set ZIP / open in editor / open as carousel / runs; Creative PNG/JPEG + open in editor; Video Ads MP4s (incl. daily sets) + download again; Reel Captions MP4 + SRT; Reels Studio / explainer MP4, carousel ZIP, download again; ES Image Pool copy link + download (grid and viewer); Gallery open in editor + make another; Trends copy (headline / kit text / shortlist) + design post; Home trend hand-offs; UI Library token copy. `frameup-track.js` added to index, generate, video-ads, reels, reel-maker, image-pool, gallery, design-request, design-system, dashboard.
- **Table `frameup_usage_events` (migration):** insert own rows (ES domain + own email), admins read; no update/delete; checks on category, tool/action slugs, sizes, created_at not in the future. Existing `frameup_events` / `es_designer_activity` untouched.
- **Dashboard:** new Usage tab (`frameup-usage.js` maths, `frameup-usage-view.js`, `frameup-usage.css`): range 7/30/90 d, filters tool / type / person, totals, stacked daily chart by type with tooltip + legend, by-type bars, tool x type table (click a tool to filter), top people, recent feed, loading / empty / "migration not run" states. Older export rows (es_designer_tasks, frameup_events export_done) fill the time before the first usage event. Tabs grouped with dividers and shortened (Overview, Usage, Impact | Board, Requests | Exports, Feedback, Activity | People, Access); the Activity log is now a tab; Overview sections renamed ("Exports and activity", "Workspaces and templates" with an "Everything taken" link); panel copy shortened. Type colours: validated categorical order (dataviz validator, light + dark).
- Cache key `20261125-tracking` on every page loading a changed file. Release note `2026-11-25-usage-tracking`. Editor drawing / export code untouched (only tracking calls after a successful export).
- Tests: new `scripts/test-usage-tracking.mjs` (18: taxonomy, scrubbing, batching, failure tolerance, missing table, queue cap/age, iframe off, migration vs taxonomy, combine / filters / summary, grep that every take calls track, every clipboard/download site is inventoried). `inline-syntax` ok, `test-tour` ok, full `run-suite.sh`: see the report.
- Visual QA (local, `local-serve.js ... noauth` with a local-only admin pass + mocked reads): Usage at 1440 / 1024 / 768 / 375, light + dark, populated / empty / migration-missing; Overview at 1440. Shots `.claude/shots/dashboard-*`. At 1024 and below the tab strip scrolls sideways inside itself (as before).
- Unverified: real inserts against Supabase (RLS + `upsert ... ignoreDuplicates` on an insert-only table: same pattern as `es_designer_activity`), live volume.

## 2026-11-20 — Suhail: Generate Creative quality: faces framed, ES pills, different every time (branch suhail/generate-creative-quality)
- Status: pushed in c5b23bb (merges 830280e, e042e83, 3f0b16c).
- Why (owner): photos cut faces / sat at the edge; pills didn't follow the ES rules; every Generate gave the same templates. Plan: `C:\Users\Suhail\.claude\plans\encapsulated-fluttering-snowglobe.md`.
- **Faces framed (40252ae):** `photoMeta` sent the vision box as `focus` and `coverRect` centred on it, i.e. on the box's top-left corner. `coverRect` now frames a box (head a third down, whole subject in when it fits). The vision check also returns a head point (same call, position only, face rule kept), and box/head are validated (corner form converted). Framing reaches photos, swaps, split sides and headshots; `swapPhoto` takes the new photo's framing; no box → upper-third aim. Cut-outs: head fully on canvas, ≥85% of the figure in. `visionPhotos` 8 → 12 (approved spend). New FATAL "subject outside the frame" in `check-generate-designs`; QA fixtures carry vision boxes. Across 3,371 photo layers, head-out / subject-cut 124 / 229 → 0 / 0. Live: 12-photo vision call 9 s (16 s limit), head on 20/20 verdicts, ~$0.038 per person.
- **Pills (9bb1a28):** `frameup-rules.js` `PILL` mirrors the editor's Cover pill (Acumin Post 900, 130:122, 18.4 / 21.88, touching rows, min 84, upper, no tracking), plus the editor's pair text-colour rule. Every Creative pill (headline boxes, kickers, labels, name tags, swipe) uses it, in the brand-kit pair. Removed tilted/shadowed sticker pills, highlight words inside pills, alternating pill colours, neon kicker glow. Headline lines aim at 10-16 characters. `es-guidelines` composed-fonts updated. New `test-pill-rules` checks against `index.html` and all 1078 brand-kit pairs. `index.html` only gets `?v=` bumps for frameup-rules.js / es-guidelines.js (no drawing code; exports unchanged).
- **Different every time (af97bd9):** each Creative run logs its looks + tones as a `directions_shown` row (existing table, no migration); `_direction-memory.recentFor` reads the person's own last 3 runs. The page also keeps them in localStorage and sends `recent`. Director: full tier 1+2 menu (27 looks) instead of fixed first picks, "choose different looks and tones than just shown", steer more/less/hook + avoid now passed; effort low → medium (`GENERATE_ART_DIRECTOR_EFFORT=low` restores it). Seeded shuffle + recency penalty in the code plan, tone rotation, seeded variants; Generate / Try again skip the 10-minute plan cache (`fresh` + nonce). Prefer lessons capped below the recency penalty. Classic director hears the last templates + hooks. **Cost: director ~$0.035 → ~$0.048 a run.** Live, same brief ×3: every set different, 9 distinct looks in 12 slots, 21-32 s.
- Release note `2026-11-25-generate-creative-quality`. Cache keys: frameup-compose.js / generate-creative.js `20261125-genq`, generate-assistant.js `20261125-framing`, frameup-rules.js / es-guidelines.js `20261125-pills` (generate.html, index.html, reel-maker.html).
- Unverified: the Supabase history read/write with a real login (mocked in tests); combined live run noted below.

## 2026-11-20 — Generate templates look: the same right-person photo check as Creative (Claude)
- Status: pushed in 597e93d.
- Why: owner reported photos that "don't match the person we are talking about". The templates look (es-generate.js) had its own weak photo step: up to 3 agency images by name + the lead image of any ES story in the research; with one candidate, or when the Haiku pick failed / timed out, it used the first candidate unchecked; the Haiku prompt asked it to recognise a face. Rivals on other cards (`findPhoto`) took the first search result unchecked.
- Now `classicPhotos` asks the asset service (`findPhotos`, the gen5 pipeline: caption evidence + one Sonnet vision check of uniform / number / team / setting, never a face) for the main person (or the brief's team when no person) and keeps only verified photos. Checked and nothing verified: no photo on the card, what was found goes to the photo picker (`pick-photo` warning). No asset service / over budget (`GENERATE_PHOTO_BUDGET_MS`, 25 s): the old candidates and Haiku pick, but an unchecked first photo is never placed.
- Other people on a card: the subject is the person or team from the brief that the writer's `photoQuery` names (not the whole phrase: "Bills celebrate Chiefs win" sent as a person matched a Chiefs ticketing story on a Bills card); names nobody: the main subject's checked photo. 15 s budget, skipped after 130 s.
- Evidence first: on the labelled set (`scripts/fixtures/gen5-photo-labels.json`) tightening the text rules (unsure -> caption only; text fallback caption only) would have dropped 26 right photos and caught 0 wrong ones, so `_photo-verify.js` is unchanged. With real Sonnet vision the remaining kept "wrong" photos were weak, not wrong-person (Verstappen's car, an injury cart).
- Live runs (real Gateway, WP media locally): Clark 27 s, verified photo; Allen vs Mahomes 33 s, Allen + a verified Bills photo on the team card; Scheffler vs McIlroy 29 s, each card its own verified golfer.
- Tests: new `scripts/test-generate-classic-photos.mjs` (7); flow / fast / direction tests now pin the fallback (asset service off) and "offered, not placed" for unchecked photos; 24 Generate / Trends suites pass. `_composer.js` exports `assetService`.

## 2026-11-20 — Trends -> Generate carries the whole trend; the server uses it (Claude)
- Status: pushed in 9cafe08.
- **Client:** `trends-logic.js` new `trendContext(item, ai, { more })` (compact trend: id, title, type, category, url, source, publishedAt, traffic, coverage, signal, team {name, short}, image/imageKind/imageCredit, up to 6 related incl. storyline siblings, storyline size, AI why/hook/titles), `designHandoff` (sessionStorage key `frameup.generateTrend.v1`), `trendStillFits` (60%+ of the original brief's story words still present). `trends-view.js` `designHere` (Design post, keyboard D, Design as <Template>, headline ideas, "Design this one") puts `trend` and the league (`sport`) in the `ais:design` detail. Home Post links (`frameup-home-today.js`) add `&trend=<id>` + store the trend on click. `generate.html`: `trendRun` set by the event / the `?trend=` link; `callApi` adds `trend` to `/api/es-generate` bodies (modes default / direct / creative) only while the brief still fits, else drops it. Text brief unchanged. Cache keys `20261124-trendctx` (trends-logic, trends-view, frameup-home-today).
- **Server:** new `netlify/functions/_trend-context.js`: `normalizeTrend` (known fields only, string/array caps, https only, URL <= 600 chars, null when the brief no longer tells the trend's story), `trendResearch`, `withTrendSport`. `es-generate.js`: `research(..., trend)` puts the trend's real headlines + outlets + team + one "Why now" line (hot/rising, searches, outlets, storyline size, age) first in the digest; the headlines join the corpus; ES URLs join the citable sources. AI why/hook/titles go to `found.trendIdeas`, labelled "AI-written suggestions, NOT facts", into the writer prompt, the director (`runDirector`/`directorRequest` new `ideas` arg) and the composer prompt, never the digest or corpus (so fakeQuote / lint still reject a number or quote taken from an idea). Brief without a `Sport:` line gets the trend's league. Trend team fills an empty `read.team` (brand-kit match only); composer `addTrendTeam` adds the logo-library team when readCreative found none (same sport only). Creative plan cache key includes the trend id. Response `research.trend` says what was used.
- **Photo:** the trend's `image` is offered as a candidate (`photoCandidates` `extra`) only on an ES photo host, not a logo, and only when its headline names the person; it then goes through the existing pick (templates) / `verifiedLocal` (Creative local search). Wikipedia/other pictures: never a photo; a Wikipedia credit is a "hint only" line. `_photo-verify.js` / `_imagery.js` / asset service untouched (so with the asset service on, the trend photo is not offered there).
- **Live (local, real Gateway):** Rams/Nacua trend, Creative, same brief: without trend `sport ''`, "Rams" read as a person, no Rams team; with trend `sport NFL`, team Rams, director note "Rams blue rising from the foot", headline "LEAGUE SUSPENDS RAMS STAR NACUA". Shelton trend (storyline of 6): with trend the cover used "Ben Shelton" (full name from a related headline). Request bodies checked for the in-page button, keyboard D, Design as Cover and Home "Make a post"; a rewritten brief sent no trend. No extra network calls; run time unchanged (~21 s both).
- Seen, not fixed (pre-existing): templates path made a long-quote from a headline sentence that is in the brief itself; the brief -> league local map keeps 40 briefs so a long Trends board loses the league for early cards (now also carried in the event and by the server); `POST /api/trend-design` AI angles 500 locally in the browser.
- Tests: new `scripts/test-generate-trend-context.mjs`; `run-suite.sh es-generate generate gen trend home-today hero creative compose tour`: 36 files pass; inline-syntax ok. UI: no visual change (data attributes only); checked Trends 1440 light and Generate 375 dark, no overflow.

## 2026-11-20 — Generate: AI steps get the 180 s budget; Sonnet directs again (Claude)
- Status: pushed in f7e049e.
- `es-generate.js` time guards were still tuned for the old 60 s function limit (their comment said so) after `3d4d45a` raised `maxDuration` to 180 s. Retuned: director start-by 9 s → 25 s, director call 12 s → 20 s, director retry-by 12 s → 30 s, `direct` retry-by 30 s → 60 s, repair start-by 25 s → 90 s, review start-by 38 s → 110 s, escalate start-by 20 s → 125 s (it was earlier than the review it follows, so it only ran on unusually fast runs). Latest finish ~150 s.
- Review call cap 12 s → 20 s: live reviews of 3 cards took 7-9 s; one run came back `quality.reviewed: false` (the review silently dropped).
- Director default `auto` (Haiku first) → `best` (Sonnet). In live runs Haiku's reply was cut off at `maxTokens` 1400 on every brief, so every run paid for a wasted Haiku call plus Sonnet and lost ~7 s. Director `maxTokens` 1400 → 2600. `GENERATE_DIRECTOR_MODEL=auto` still brings back Haiku-first. If that env var is set on Vercel, this default change has no effect there.
- Measured locally (same Caitlin Clark brief, real Gateway calls): before 29-31 s, 2 of 3 designs, Haiku cut-off + Sonnet; after 24 s, 3 of 3 designs, Sonnet first try, review ran.
- Tests updated where they pinned old values (`test-es-generate-direction` research-slow guard now uses `DIRECTOR_START_BY_MS`; director default/max_tokens in `test-creative-director`, `test-generate-director-mode`). 15 Generate suites pass. Plan: `project-docs/generate-next-research-plan.md` item 1.

## 2026-11-19 — Manish Kalsi (Claude): Newsletter "Archive Page FI" asset, 834 x 555 (branch manish/archive-page-fi)
- Status: `pushed in 49af2b4`, live on frameup.essentiallysports.com.
- New Newsletter asset in Feature images, built from Figma ES Design Team Files node 2365-65: its own 834 x 555 size (`NEWSLETTER_ASSET_TYPES["archive-page-fi"].workspace`), photo (sample golf photo until one is uploaded), a bottom overlay over the last 165px (clear -> 12% -> 45% -> 75% black) and a white-outlined "⚡ QUICK READ" tag 30px from the left and bottom, 57px tall. Tag text is editable (Text On Design, one line, upper-cased; empty = QUICK READ). New `drawNewsletterArchivePageFI` in `index.html`; no shared draw code changed, so other exports are untouched (not re-hashed).
- Measurements were taken from the rendered Figma frame (view-only, not Dev Mode), so gradient stops, font size and bolt colour (#FFC629) are close, not exact.
- Also: dropdown option, CSS hiding colour / pill / swipe cards, colour card list, editor-assist entry, release note `2026-11-19-archive-page-fi` (tags the template New). Cache key `20261119-archivefi` (frameup-editor-assist.js in index.html). No thumbnail yet (the picker shows the label).
- Tests: new `scripts/test-newsletter-archive-page-fi.mjs`; `inline-syntax` ok; `check-editor-ui` probe at 375 / 768 / 1024 / 1440, light + dark: no issues (screenshots `.claude/shots/archive-fi-*.png`). Related suites pass (editor-assist, tour, stat-templates, panel-hygiene, site-chrome, gen-ui, reels-gallery-ui). Full `check-editor-ui` sweep fails on this Windows machine on other Newsletter templates (widgets / ticker / list2 / tag-fi empty bands), the same as on untouched origin/main (31 problems there); none on archive-page-fi. Full run-suite not run.
## 2026-11-19 — Suhail (Claude): Video Ads music library, 7 licensed tracks (branch feature/va-music)
- Status: pushed in fe375a7 (migration run, 7 files uploaded to the private bucket `frameup-audio`).
- Owner confirmed the tracks are licensed for organic + paid. The repo is public, so the audio lives in a PRIVATE bucket: `audio-library.json` entries use `file: storage:frameup-audio/<id>.m4a`; `video-ads-audio.js` parses them (`track.storage`), `video-ads.js` `fetchStoredTrack` gets a 10-minute signed URL for the signed-in user.
- Files (AAC 192k m4a, 0.9-2.7 MB): calm-deeper, calm-lofi, calm-lofi-short, chill-beat, chill-beat-no-intro, chill-beat-short, summer-hip-hop. Local copies outside the repo: ~/Downloads/frameup-audio-upload/.
- Tests: test-video-ads-audio (shipped library, storage path rules), all Video Ads tests. Cache key 20261119-music. Release note 2026-11-19-music-for-video-ads.
## 2026-11-23 — Suhail (Claude, agent B): Generate gen5, designs built like the ES board (branch feature/gen5-board)
- Status: `committed on feature/gen5-board, not pushed`. Parallel with agent A (gen5-photos: photo identity). Contract `scratchpad/gen5-contract.md`.
- **Board study:** 22 frames downloaded and measured with the Figma MCP (file ZtArAy8Oa52pOF92FPl7Zo, section 2335:229): cover 2335:1869/740/1710, stats 2335:230/798/1725, quote 2335:1418/1395/1844, bar 2335:1297, listicle 2335:2341/1088, extra 2335:2645/2864. Measurements in the scratchpad (`gen5-out/board/measurements.md`).
- **Renderer (`frameup-compose.js`):** phrase-aware box line breaks (never after TO / THE / A, never inside a name or "UK SUPPLIERS", no stray short word lines); board box metrics (touching boxes, 0.17/0.15 cap pads) and deliberate cascades in cap heights; `boardColors` (team field, darker team colour boxes the brighter one at 4.5:1, white label boxes in the team colour); board fade (404px team colour); print `grit` texture (cap 22%); cut-out `bleed` (full-length figures run off the foot, busts sit on it) and number `overlap` (the head may cover the number's foot, as on the board; headroom and the designs check honour it); full-size "+" on board numbers; quote squares. Rebuilt: stat-stack, record-alert, stat-column, cover-boxes, quote-boxes, bar-race (now also two-sided comparisons), light-stat (board light page). New: name-stack (surname behind the player), team-post (team-colour extra post). `dropOrphanRules` removes accent rules with no words; `pickPhoto` reads agent A's `photo.kind` / `verified`.
- **Composer (`_composer.js`):** TIER and PRIORITY put the board looks first (trading card, collage strip, film strip are tier 3); 3+ stats lead with the stat column; ranks are never stats posts. Headline cuts keep the story's turn (unpaid, loss, record, history...), cover cuts need 5+ words, readings "Subject: turn clause" and own-subject clauses for variety; `cardTitle` drops titles that read as a team or sport; `input.name` is the named person only (no "GOLF" name strip); cross-sport team matches dropped ("UK" is not Kentucky); the quote speaker is the person; "72% from the field" is a fact.
- **AI:** art director Opus by default (`GENERATE_ART_DIRECTOR_MODEL`, Sonnet then Haiku fallback; new Gateway tier `top`, economy routes it to Haiku); the judge gets 1-3 ES board references (`_board-refs.js`, 324x405 JPEGs) and scores `board` (weight 1.6); `judgeTierFor` keeps a run under `RUN_CAP_USD` $0.25 given what the director spent (the page sends `spent`). Estimated AI per 4-design run: before ~$0.06-0.09, after ~$0.12-0.17 (+ cut-outs as before); estimate in `generate-assistant.js` updated. Not measured live (no key locally).
- **Rules:** `es-guidelines.js` COMPOSED_RULES `composed-board`, `composed-headline-point`; grit limit in `composed-effects`.
- **Tests:** new `scripts/test-gen5-board.mjs`; updated test-compose-looks (cascade), test-gen-director (Opus default), test-gen-ui (estimate range); `check-generate-designs.mjs` head check honours a declared overlap, ceilings 75/55/452 -> 68/55/422. Headline cuts skip an introductory phrase ("In a wild double-overtime thriller..., the Fever edge the Sun"); older (tier 2-3) looks keep 10-word headlines.
- **Sheets:** `scratchpad/gen5-out/` (`board/`, `before/`, `after/`, `sheets/brief-*.jpg` before/after/board rows, `sheets/family-*.jpg`, `progress/`).
- Cache key `20261123-gen5` (frameup-compose.js, generate-creative.js, generate-assistant.js in generate.html; es-guidelines.js key only in index.html, no render-path change). Release note `2026-11-23-gen5-board`. Generate composed designs change on purpose; editor exports untouched.
- Unverified: live Opus / judge cost and time, wrong-person photos (agent A).
## 2026-11-19 — Suhail (Claude, agent A): Generate v5 photos, the right person every time (branch feature/gen5-photos)
- Status: `committed on feature/gen5-photos, not pushed`. Contract `gen5-contract.md` section A; agent B (gen5-board) rebuilds the looks in parallel.
- **Live failure, as a class:** on "Josh Allen goes over 1000+ rushing yards as the Bills beat the Chiefs" the Allen cover used Patrick Mahomes, a design used a TV reporter, the cut-out showed Allen beside a woman; on "LIV Golf paid players millions before bankruptcy" designs 1 and 3 used the same golfer close-up and design 2 a golfer with no LIV tie. Causes: a person's photo with no evidence it was them was kept (fewer than 3 named photos), article lead images were trusted for any headline that mentioned the name, captions were matched on the surname (Josh Hines-Allen), group shots were cut out, team / league photos needed no tie at all, and the relaxed planner pass re-used the top photo.
- **New `netlify/functions/_photo-verify.js`:** (1) free text evidence on every photo: who the agency caption names first (datelines, photographer credits and venues ignored; "Kansas City Chiefs quarterback Patrick Mahomes 15 pats ... Josh Allen" is Mahomes), the ES headline's lead person (quotes, "ESPN's", "NFL Week 11 MVP Ladder:" handled; "Josh Allen's Wife ..." is a relation story; a second person the headline is about drops the image), short media titles / file names with two people, namesakes and surname-first agency style, the team each caption ties the person to ("Josh Allen 17 of the Buffalo Bills", "Terrion Arnold, a Detroit Lions cornerback"); (2) the person's team by vote over the captions among the brief's teams (the rest are opponents); (3) a vision check through the Gateway (`verifyWithVision`, tier `best` = Claude Sonnet, `GENERATE_PHOTO_VERIFY_TIER` can lower it): one call per subject, up to 8 photos (4 for a team), 1024 px images with their captions, the team / colours / number / opponents / other people in the prompt, never face recognition; returns match, people count, main subject, role (reporter, fan, family...), kind, focus box, cut-out, quality; verdicts cached 7 days per photo in memory (no table: the storage bucket takes images only, so no migration); (4) `decide()`: verified only with positive evidence and nothing against it.
- **`_imagery.js`:** `rankFor` uses the check: a person's photo is kept only when verified (caption / headline / file / vision), never when another person leads, never in an opponent's uniform, a namesake on another team is not verified, a group shot only when the person has fewer than 2 solo photos, cut-outs only from main-subject frames; team / league photos only when the caption ties the person to that team or names the league (LIV); article images are not used for teams. Candidates per subject 16 -> 32, media search 10 -> 16 (both free). Photo fields `verified`, `verifiedBy`, `main`, `shot`, `focus` on findPhotos / prepareImagery.
- **`_asset-service.js`:** findPhotos takes `teams / opponents / others`, wires `verify` (replaces the Haiku `generate-photo-pick` ranking; same feature name and spend gate), cache key v5.
- **`_composer.js` (photo parts only):** `photoFactsFor`, `resolvePhotos` passes the brief facts, keeps verified photos only, searches teams by full name ("Inter Miami CF", not the college "Miami"), the quick local fallback keeps headline-led photos only; `photoKey` treats one agency frame under several file names as one photo; the relaxed pass and a new `distinctPhotos` step give every design its own photo whenever its person / team has another one; `readCreative` no longer reads "the Connecticut Sun" as a person. **Contract for agent B:** `direction.photo = { src, person, verified, verifiedBy, kind (action | portrait | celebration | reaction | offfield | group | crowd | venue | object), focus ({ x, y, w, h } 0-1 or null), main, cutoutOk }`; the same fields on `input.photos`. When nothing verifies, the person has no photos and the planner goes type-led / logo-led.
- **Labelled set:** `scripts/fixtures/gen5-photo-labels.json`, 22 subjects (18 named players and coaches, the LIV league story, the Detroit Lions team), 513 real ES photos labelled by eye (main / present / absent, off-field, other team, graphic), with opponent and namesake traps. Text layer: wrong-person photos kept anywhere 63 -> 3 (14.6% -> 1.7%; a car shot, a tiny far-away figure, an injured Lions player on a cart), in the top 5 the composer keeps 14 -> 2 (other people 10 -> 0), not-the-main-subject 33 -> 11, main-subject photos kept 137 of 206. With a simulated model answering from the labels: 0 wrong, 150 kept; with a model that can never tell (all unsure): 2 wrong.
- **Real-photo lab (the 29 briefs + the LIV brief, code plan, no AI key, judged by eye):** designs showing someone other than the named person / team 16 -> 0 (before: Mahomes rookie, Aaron Glenn, Ben Shelton x2, Flavio Cobolli, Curry and LeBron on Jokic, Shedeur Sanders on Parsons, the Texas coach as Arch Manning x2, a Duke QB for Inter Miami, Sun opponents for a Fever story...); objects shown as the person (shoe cut-outs, cars) 4 -> 2 (Verstappen's own car); photos repeated inside a run 27 -> 8 (only subjects with fewer verified photos than designs). The Fever story is now type-led (no verified Aliyah Boston photo). Sheets: scratchpad `gen5a/compare/*.jpg`.
- **Cost and time (estimates, need a live check):** per subject call ~8.6k input + ~0.6k output tokens on Sonnet ~ $0.023 (team ~ $0.012); a typical run (1 person + 1-2 teams) ~ $0.035-0.05, before ~ $0.005 with Haiku: about +$0.04 per run, logged under `generate-photo-pick`, spend-gated, $0 on a repeat within 7 days. Time: the check runs beside the size probe; ~+3-6 s per subject in parallel; per-subject budget 20 s -> 26 s (`GENERATE_PHOTO_BUDGET_MS`), call timeout 16 s.
- Tests: new `scripts/test-gen-photo-verify.mjs` (text classes, decide, teams / leagues, the labelled-set ratchet, mocked vision call / cache / tier, findSubjectPhotos contract, asset-service wiring, composer contract, distinct photos, the LIV plan). `run-suite.sh gen tour`: all pass; full suite: only the 3 accepted failures (test-gen-imagery and test-tour failed on the first full run and were fixed: a fans photo for a team, the release-note date order). `check-generate-designs` stays at 452 / 75 / 55.
- Release note `2026-11-21-gen5-photos`. No client files changed (no cache-key bump); editor exports untouched.
- Unverified until deployed: the Sonnet verdicts on real photos (accuracy, latency, cost per run), the ES agency pool (needs the MCP token; the lab uses WP media + articles only).
## 2026-11-19 — Suhail (Claude): video explainers, better editing, Trends, a more natural voice (branch feature/explainers)
- Status: `[committed on feature/explainers — not pushed]`. Scripts only (`scripts/explainers/`): no page, API or export changes, no cache keys.
- **Edit** (`lib/edit.mjs`, new): dead time trimmed (no voice / cursor / click / visible change past 1.2 s -> 0.5 s; spinner-only waits sped up to 1.2 s), chapter holds with a title card, a camera path (zoom 1.3-1.8x on what is clicked or typed into, pans within a step, eases back out between steps; two critically damped springs = S-curve moves), short lower-third caption chunks (top only when the zoomed target is low), voice spans for ducking.
- **Encoder** (`compose.html`): camera applied to app, cursor and ripples; animated title / chapter / end cards in ES style (Acumin Pro Condensed Bold from `fonts/`, ES blue highlight boxes, no purple); music bed under the voice (voice normalised to -18 dBFS, bed -26 dBFS, ducked 12 dB under each line, 1.6 s fade in, 2.8 s fade out); `analyze` (frame diffs), `loudness` (RMS of the finished MP4). Capture at 1.5x pixel density so zooms stay sharp.
- **Voice** (`lib/capture.mjs`): `--voice` / `EXPLAINER_VOICE`, else the best installed English voice: any "(Premium)" (Ava, Zoe, Evan, Nathan first), then "(Enhanced)", then Samantha; logged per run. Installing a Premium voice later needs no code change. Scripts rewritten: contractions, shorter sentences, friendlier, same facts.
- **Music**: `--music <file>|none` / `EXPLAINER_MUSIC`, default `~/Downloads/frameup-audio-upload/calm-lofi.m4a` when it exists; read at encode time, never copied into the repo.
- **Trends** (`flows/trends.mjs`, new; server stub builds the feed with the real `trend-design.js` from synthetic RSS, AI angles answered locally): board + signals, AI angles (why fans care, headline ideas), sport and newsletter filters, post kit, Design post -> Generate with a ready brief.
- Recorded: Video Ads only (owner's call; scratchpad `explainers/`). Trends, Reels Studio and Generate flows are ready to record with the new editing but were not recorded (Generate's designs are being rebuilt).
- Tests: `scripts/test-explainers.mjs` (four flows, Trends stub, voice pick order, edit trims / holds / camera smoothness / caption chunks).
- Encoder fixes found in review: frames are prefetched by output time (every frame the next 2 s of the edit shows; the old look-ahead skipped most frames and froze the picture for up to 9 s), a frame on screen is never closed (drawing a closed bitmap killed the render loop and hung the encode), a fresh encoder page per encode, and a Node-side timeout so a dead renderer fails instead of hanging. The log now reports stale draws (0 in the final Video Ads cut).

## 2026-11-19 — Suhail (Claude): team rule A, direct pushes to main, no PRs (branch chore/team-setup)
- Status: `[pushed]`. Owner chose direct pushes over pull requests.
- `CLAUDE.md` / `ONBOARDING.md`: everyone pushes to `main` after "push": fetch, rebase, keep both sides on conflicts, run checks, `git push origin HEAD:main`; never force-push. PR template removed. GitHub admin asked to block force pushes and deletion on `main` only.

## 2026-11-19 — Suhail (Claude): team setup for more than one person (branch chore/team-setup)
- Status: `[committed on chore/team-setup — not pushed]`.
- `CLAUDE.md`: team rules first (session start, own branch `<name>/<topic>`, never push to main, ask before push, stay in your area, conflicts, edit-log format with names, security, design / cost / cache-key rules, checks, releases); the existing UI QA section kept as is.
- `scripts/release/`: the release kit moved into the repo (merge.sh, union.py, jsonmerge.py, bump.py, inline-syntax.mjs) plus `run-suite.sh` (whole suite or a subset; fails only on new failures).
- `ONBOARDING.md`: setup for a new teammate's Claude Code (access, clone, git identity, tools, account, no keys) and how a change flows to a PR.
- `.github/pull_request_template.md`: checklist (rebased, suite, viewports, cache keys, edit log, release note, cost).
- From now on every entry starts with the person's name.

## 2026-11-21 — Generate v4 UI: ideas, ETA, sources, AI usage, briefs (gen4-ui, branch feature/gen4-ui)

- Status: `[committed on feature/gen4-ui — not pushed]`. Base fix/generate-timeout. Agent B of 3 (owner points 1, 6, 7, 8, 10).
- **Focus view (#1):** suggestion chips show the whole text (the old `clean(text, 60)` cut "…irrelevant, an"); no "Apply:" prefix. New engine helpers in `generate-assistant.js`: `reviewCritique` (uses the server's `design.review = { autoFixed, suggestions }` from verdict / direction / scene), `normalizeReview`, `isRepair` (repairs are never offered as ideas, also for an older server and the quick check), `fixedLine`. "Fixed while designing: …" (autoFixed + the judge's in-code fix) is one quiet line in the assistant, the card's director note and the Director tab; "What could be better" became "Ideas to try". Shorter placeholder (it was cut), taller input, cost badge only once the chat costs something, starters are creative asks.
- **ETA (#6):** `generate-focus.js` util `etaModel / etaEstimate / etaRecord / etaProgress / etaLabel` (creative: 22 s + 5 s a design + 14 s with a named person (photos + cut-outs), 4 s without; templates 12 s + 3 s a design), corrected by this browser's last 12 runs (`frameup.generate.durations.v1`). Shown next to the cost before a run ("~55 s") and as a bar + "About 25 s left" + clock while running; past the estimate it says "Taking longer than usual", near 180 s that a notice will show if it stops.
- **Sources (#7):** "Based on these ES stories" is now a collapsed Sources card: what it is (the ES articles the facts came from, to check them), count, newest first, dated rows, external-link icon.
- **AI usage (#8):** card always opens a details popover (320 px beside the sidebar): spend + left + calls, per-tool rows with bars, the team line (shown to everyone: /api/ai-status already sends the aggregate to all signed-in users) and what happens at the team cap, what counts, reset in local time + UTC, free mode explained. CSS in `es-ui.css` (es-usage block).
- **Briefs (#10):** `TrendsLogic.briefFor` writes a real brief from the trend's own words (who: headline, related headlines as Context, Why fans care), no Team / Sport lines, no outlet names. The league is kept beside the brief (`rememberSport` / `sportForBrief`, localStorage, keyed by the first line; Home passes `&league=`) and `withSport` adds it as a last "Sport:" line only in what Generate sends (the server reads it). `tidyBrief` converts old labelled briefs (Recent, old links, ES MCP topics). Live trend tiles, trending chips, Trends and Home all use the same builder. Try examples rewritten as full briefs (same facts).
- Tests: new `scripts/test-gen-v4-ui.mjs`; updated test-gen-brain (chip label), test-trends-hero (brief shape), test-home-today (league param). `check-generate-ui.mjs`: 20 states (new: sources-open, progress-long, usage-open), review fixture on the plan, behaviour checks for the hand-off brief, ETA before / during / long, full-text creative-only chips, fixed line, sources. 0 problems.
- Cache key `20261121-gen4ui`: generate-assistant.js, generate-focus.js, generate-creative.js/.css, app-shell.js, es-ui.css, trends-logic.js, frameup-home-today.js (every page that loads them; index.html only the key strings, no render-path change). Release note `2026-11-21-gen4-ui`.
- Merge notes: agent C adds one marked line in `generate-creative.js` exportCard and a script tag in generate.html: no overlap with these hunks. Agent A's `design.review` is read from `verdict.review`, `dir.review` or `scene.review`, items as strings or `{ text | what | note }`.
## 2026-11-21 — Generate v4 (A, gen4-quality): the count honoured, fixes while designing, board-grade designs, no sport tags
- Status: `[branch feature/gen4-quality, not pushed]`. Owner points 2, 3, 5, 9 (contract `scratchpad/gen-v4-contract.md`). Parallel with gen4-ui (B) and gen4-learning (C).
- **Root causes found (all briefs, not one example):**
  - `_composer.js` `photoKey` keyed every proxied ES photo (`/api/es-image-search?image=...`) as "es-image-search": a run kept ONE photo, so designs fell back to type-only posters and sets came up short ("asked for 4, got 2"). Now keyed by the proxied image.
  - The code plan's focal / family / photo caps had no relaxed pass, so a story with no stats stopped at 2-3 designs. Now strict passes, then relaxed passes (photos may repeat, families still vary), then a top-up (`topUp`) and a last-resort second take: 1-8 always delivered.
  - Weak archetypes were picked first (typographic, big-number, unit-grid, prize-poster). New `TIER` from a real-photo audit of every archetype (sheets `gen-v4-out/quality/catalog-before/`); strict passes use tier 1-2 looks only and must show the named person when ES has photos; type-only posters only fill what nothing else can. `ensureLight` keeps light and dark mixed.
- **Renderer (`frameup-compose.js`):** sport / league kickers stripped (`cleanKicker`, no `input.sport` fallbacks; composer kickers are '' or a name tag); empty tag boxes and faded boxed images never drawn (`fadedImage`); typographic poster rebuilt (3+ word headline, no art box, cut-out or photo anchors the foot, else the words fill the poster with a deck line); big-number drops its 38% washed photo and stands the player cut-out beside the number on 4:5; light-stat and split-panel fill their space without a tag; type-knockout starts at the top. New `repair(scene, repairs, ctx)` (`REPAIR_OPS`: the FIXES plus flip-tone, headline, label, drop-stat, remove-tag, drop-image, swap-photo, use-cutout, use-photo), every step re-checked by `checkScene`. `scoreReport` flags an empty half.
- **Design-time fixes:** server `designTimeFixes` repairs each candidate's free-check issues; the judge now returns `repairs` (ops + replacement text) and at most one creative `idea`; the page (`generate-creative.js` `repairPicks`) applies the repairs, re-renders and asks the judge ONE second look (`recheck: true`, feature `generate-creative-recheck`, 15 s, only while the run is under 110 s), then applies what is left. Contract: `design.review = { autoFixed, suggestions }` on `card._review`, `card._dir.review`, `FrameUpCreative.review(id)` and the plan's public directions; suggestions creative only ("Try ..."). Repairs and old-style notes still reach the learning model (`issues`).
- **Copy:** code headlines keep their colon ("Rob Manfred: MLB owners won't compromise"), never chop a quote, never a sport / team alone; "Formula 1" is a name, not a number; labels stop at "against / vs".
- **Imagery (`_imagery.js`, no vision key):** an ES story image led by another person's name drops; off-field shots (wife, red carpet, premiere) drop; agency game captions count as action.
- **Spend:** art director Sonnet by default (`GENERATE_ART_DIRECTOR_MODEL=auto` brings back Haiku-first; Haiku fallback if Sonnet fails), 40 s step budget; concept art only for prize posters on stories with no person photo. Est. per 4-design run: before ~$0.03-0.06, after ~$0.06-0.09 (Sonnet director ~$0.025, judge ~$0.025, recheck ~$0.01). Logged per feature, shown in the run summary.
- Tests: new `scripts/test-gen-quality.mjs`; `test-generate-run.mjs` (repair loop case); `test-gen-director.mjs`, `test-gen-brain.mjs` updated for the repairs contract; `check-generate-designs.mjs` ceilings 86/59/490 -> 75/55/452.
- Sheets: `scratchpad/gen-v4-out/quality/` (before, after, compare, count-8, catalog-before). Lab: `scratchpad/qlab/lab.mjs` (real ES photos + macOS Vision cut-outs, real page run()).
- Cache key `20261121-gen4q` (frameup-compose.js, generate-creative.js in generate.html). Release note `2026-11-21-gen4-quality`. Generate composed designs change on purpose; editor exports untouched.

## 2026-11-21 — Generate: no more 504 timeouts (Claude, integrator)

- Live error log: `/api/es-generate` returned 504 five times on Creative runs after imagery v3 (60 s function limit). A pre-render timeout made the page fall back to the ES template flow.
- `vercel.json`: `api/es-generate.js` maxDuration 60 → 180, `api/gen-assets.js` 60 → 120 (Enterprise plan).
- `_composer.js` `resolvePhotos`: each subject's `findPhotos` has a hard budget (`GENERATE_PHOTO_BUDGET_MS`, default 20 s); on timeout the quick local ES search serves that subject.
- `generate-creative.js`: a 504 / timeout before any design shows "That took too long" with Try again, instead of silently switching to templates. Test added to `test-generate-run.mjs`.

## Standing rules
- Repo: `essentiallysports-tech/essentiallysports-design-tools`, origin = org repo directly (not a fork).
- Always give a local preview link before pushing.
- "push" = commit + push straight to `main` (deploys live via Netlify).
- "roll back" = revert to the commit before the last push.
- No unrequested extra work — ask before doing anything beyond what was asked.
- Local preview: `python3 -m http.server 8935` via `.claude/launch.json` (config name `design-tools` lives
  in the sibling session-root repo's launch.json, since preview tooling reads from there).

---

## Entries

### 2026-11-21 — Generate v4 point 4: learn from what goes final (branch feature/gen4-learning)
- Status: `[committed on feature/gen4-learning — not pushed]`. Agent C of the gen-v4 set; based on fix/generate-timeout.
- **Capture** (`frameup-learning.js`, new, `window.FrameUpLearning`): on every Generate download it diffs the design as delivered (history entry 0) against the downloaded version: headline / kicker / body words, photo swapped (no-person scene shot, player photo or cut-out), size, palette flip, shuffle, fixes, assistant asks. Shuffles send a `reject` from the `frameup:design-changed` event (no hook). Hooks: one line in `generate-creative.js` (`exportCard`), one script tag in `generate.html`; `generate-focus.js` needed none (its export goes through `exportCard`).
- **Learning** (`_creative-memory.js`): `chg-*` change lessons per archetype / sport / global ("On Stat Stack, people shorten the headline (9 to 3 words)"), stored as kind `avoid` rows (no migration). Unchanged exports = strong taste for the archetype and tone; shuffles = rejects. Same 21-day decay. Change lessons score hits / recurrences only on exports (the outcome), never on the judge pass.
- **Injection**: director gets every archetype's change lessons plus a ranking line (`lessonsFor({ archetypes: '*', limit: 7, rank: true })` in `es-generate.js creative()`); judge gets "not finished: fix it now" for its archetypes. Size lessons are admin-only. One marked hook line in `_composer.js` (`MEMORY.rankDirections?.(base, ...)`) orders the code-plan fill by the learned bias.
- **Admin trend**: every export's summary (unchanged / changes / repeats) rides in the `design_exported` row's `payload.learn`; `creative-lessons` returns `trend` (admins, `is_es_designer_admin`). Dashboard: new "Generate learning" card (`#gen-learning`) with weekly repeat-change rate, ship-as-is rate, top changes, active lessons, compositions.
- Tests: `scripts/test-gen-learning.mjs` (added to `test:generate`).

### 2026-11-19 — Video Ads: CFB / MLB clip sourcing + trusted sources only (branch feature/va-clip-sources)
- Status: `[committed on feature/va-clip-sources — not pushed]`. From origin/main 3d4d45a.
- Owner asks: (1) "NFL a lot of clips, CFB and MLB very few"; (2) "all videos should be from trusted sites: team websites, X, Google Videos, team accounts, league websites".
- **Root causes (CFB / MLB few clips):**
  - The daily library prefetch never runs on live (`/api/clips-prefetch` 503: no `CRON_SECRET` in the Enterprise project), so every list is a live per-request search, and every live source was X-only (Haiku x.com web search, Grok x_search / Sonar fallback, X links found on Reddit / Bluesky). Web indexes barely cover fresh college-program and MLB posts; NFL accounts post and get indexed far more.
  - By moment "All sports" counted all sports' moments together (`enough` = 12): a full NFL pool skipped the top-up for CFB and MLB entirely (regression test in `test-video-ads-clip-sources.mjs` §6).
  - One 5-day window: CFB plays weekly, so last Saturday's games fell out by Thursday; MLB is in its offseason (World Series ended Oct 28-29), so 5 days = nothing.
  - Coverage: 23 CFB programs missing (9 ACC, 7 Big 12, Northwestern, Rutgers, 5 top G5); CFB team searches asked `@CFBPlayoff` first instead of the team's conference; team tagging read "Kansas State" as Kansas too.
  - Rules classifier missed long MLB.com / ESPN play titles ("tosses 5 2/3 scoreless innings").
- **Fixes:**
  - New free source `netlify/functions/_clip-source-sites.js` (id `sites`, no keys, no AI): CFB = ESPN site API (this + last week's FBS scoreboard -> finished games -> each game's play clips, MP4 on espnmedia-cdn, 1080p measured from the file header); MLB = statsapi.mlb.com (schedule -> finished games -> MLB.com highlights, 1280x720 MP4s on mlb-cuts-diamond). NFL untouched. `CLIPS_SITES=off` switches it off. In-memory cache (lists 15 min, finished games 6 h; MLB's occasional empty-highlights answer is not cached).
  - Windows per sport (`windowFor` in video-ads.js): NFL 120 h (unchanged), CFB 168 h, MLB 720 h in the offseason (Nov 5 - Feb 19), labelled "Recent highlights (last 30 days)"; no MLB game in the window -> MLB.com's last games of the season, `via: 'lastgames'`, note "No MLB games in the last 30 days — showing highlights from the last games of the season (Oct 28)".
  - Moments: each sport needs its own share (enough / sports, >= 3); free top-up and the one paid round only for thin sports. Reply has `windows` per sport.
  - Handles: CFB 50 -> 73 teams (every Power Four program + ND + Boise State, Memphis, Tulane, UNLV, JMU; names / colours / logo ids from ESPN's team API, handles checked live on fxtwitter); conference accounts per team (`conferenceFor`), CFB league list reordered (SECNetwork, BigTenNetwork, accnetwork, Big12Conference first) + NCAAFootball; MLB league + Cut4, media + CBSSportsMLB. Prefetch batches 10 -> 12 (<= 12 teams each).
  - Trusted only: new `netlify/functions/_clip-trust.js` is the one allowlist (X accounts in video-ads-sources.js; league / network / team / athletics sites + their video CDNs; Google redirect links judged by their target). Used by assessClip (reason `untrusted`), runSources (untrusted candidates dropped before any fetch), searchRound, libraryClips (old fan rows hidden), checkMedia hosts (Reddit / Bluesky / Streamable files no longer search results), and the `clip` mode (pasted links still work, reply `trust: { trusted, kind, label }`, page shows "Unverified source"). Every clip carries `trust.label` ("@Yankees · team account", "MLB.com · league site", "ESPN · network"), shown on clip and moment cards. Web-search prompt now asks for official accounts only.
- **What the cron adds if `CRON_SECRET` is ever set** (no Vercel change made): every team refreshed daily into the library (instant, free lists), AI game-action verdicts (`clips-classify`, $0.30/day cap), engagement re-reads for trending order, dead-link checks. Sourcing above works without it.
- Cost: no increase. The new source is free (public JSON + a 64 KB header read per ESPN clip); paid caps unchanged ($0.06 search, $0.03 widen, $0.03 moments, Grok $0.03); free mode now returns CFB / MLB clips with no AI at all.
- Live checks (no keys, 2026-11-19): CFB Alabama 8 ESPN clips (1080p), CFB red teams 25, MLB Brewers 21 (World Series, last 30 days), Yankees 24 (labelled last games, Oct 8), moments All sports in free mode CFB 23 / MLB 16. NFL free mode unchanged.
- Tests: new `scripts/test-video-ads-clip-sources.mjs`; updated test-video-ads-clips (fan posts -> untrusted), test-clip-library (ESPN-style trusted source instead of Bluesky uploads, 12 batches). Cache key `20261119-clipsrc`: video-ads.js, video-ads-findclip.css (video-ads.html), video-ads-teams.js (video-ads, design-system, generate, reel-maker). Release note `2026-11-19-video-ads-clip-sources`.
- Not done: no Google Videos search path (needs a paid key / scraping); Google result links are accepted when they resolve to a trusted site. NFL gets no site source (owner: NFL is fine). X-handle trust is account-based; a trusted account reposting someone else's video still counts as that account.

### 2026-11-21 — Final QA: Generate (branch qa/final-generate)
- Status: `[committed on qa/final-generate — not pushed]`. From origin/main 6769e54. Final-QA agent 1 of 6 (area: generate).
- **New checks** (real headless Chrome over CDP, no deps, skip when Chrome is missing; shared harness `scripts/_qa-chrome.mjs`, fixtures `scripts/_qa-generate-fixtures.mjs`):
  - `scripts/check-generate-ui.mjs`: 17 Generate states (idle, trends offline, typed brief + ES templates, on-brand open, loading, Creative results, Creative results from the live plan shape, card panels, director note open, focus view x 4 tabs, limit error, templates "no designs", free mode, one design) x 1440/1024/375 x light/dark = 102 sweeps. Fails on doubled borders, empty bands, clipped / overflowing text, choice rows that hide options, horizontal scroll, misaligned cards / action rows / buttons, non-ES fonts, purple, unlabelled controls, >1 primary button, console errors, broken images, contrast; plus 16 behaviour checks (clicks do what they say). Off-grid spacing is reported. `QA_UI_SHOTS=<dir>` saves screenshots.
  - `scripts/check-generate-designs.mjs`: 24 briefs through the real composer (fake asset service, SVG figures, no AI/network) -> every fitting composition x 3 variants at 4:5 + 9:16 + 1:1 = 3,142 renders. Fails on a number under a cut-out's head (the check finds the head from the cut-out's own pixels), text over a face, missing images; text collisions / cut-off text / empty thirds are ratcheted at today's counts (86 / 59 / 490, mostly 1:1 and 9:16 resizes) so they can only go down.
- **Live bug (owner): Creative showed its designs, then Generate switched to the template flow.** Root cause: `addCutouts()` in `generate-creative.js` set `plan.imagery.cutoutCost`, but the server never sends `plan.imagery` (the composer's plan has no `imagery` key). Whenever the page made cut-outs (every brief naming a person with an ES photo), it threw `TypeError: Cannot set properties of undefined (setting 'cutoutCost')`; `run()`'s catch cleared the grid and returned 'fallback', so `generate()` ran "Directions first" / v1 templates. Reproduced in check-generate-ui (state results-live, the live plan shape) and test-generate-run. Fix = the integrator's fix/generate-flow hotfix, merged in compatibly: guard `plan.imagery`; designs on screen never fall back (each later step guarded, a calm notice instead); caught errors go to `FrameUpErrors.report` (limit / budget replies are not logged as errors). New `scripts/test-generate-run.mjs` (real run() in Chrome with a fake page API: plan with / without imagery, failing preview / summary / research / tracking, failure before render, limit).
- **Fixes:**
  - Renderer (`frameup-compose.js`): heads and faces stay clear. `headZone` finds the head from the cut-out's alpha (a raised arm / club / bat is too thin to count); after a first pass `planHeadroom` moves the figure (down / sideways, head on the design, >=70% of it in frame) so no number drawn behind it touches the head and no text drawn over it covers the face; when no move clears a number, the number is set smaller above the head. One extra pass only when needed. Number under head 130 -> 0 designs; text over face -> 0. Generate composed exports change on purpose (only designs that had a clash). Editor exports cannot change (index.html does not load frameup-compose.js).
  - Composer (`_composer.js`): "1000+ rushing yards" is now a fact (count, suffix +), so the design can use it; a headline never ends on a word that pointed at a number ("JOSH ALLEN GOES OVER").
  - Cards (`generate-creative.css/.js`): the badge row never wraps (long layout names shorten with an ellipsis + title), card names one line, the story always 2 lines high: cards in a row match and their toolbars line up (was 696 vs 728 px).
  - Phones: Tone / Audience segmented controls wrap into rows instead of a hidden sideways scroll that cut "Emotional" in half; the Format picker wraps into rows at <=930 px container width (was a carousel cutting the last card).
  - 4px grid: generate-owned paddings / gaps of 3 and 6 px moved to tokens (gen-kbd, gen-look__new, gen-tchip__logo, gen-fcard__art auto, gen-cc__who, gfx-btn, gfx-tab, gfx-src).
- Tests: new `scripts/test-generate-qa.mjs`, `scripts/test-generate-run.mjs`. Full suite = the 6 allowed failures only. Cache key `20261121-qa-generate`: generate-creative.css, frameup-compose.js, generate-creative.js (generate.html).
- Not done (reported): layout debts in a few compositions at 1:1 / 9:16 (trading-card, prize-poster, photo-mosaic, sticker-collage, empty lower thirds when the no-AI plan has no body copy); shared es-ui spacing (es-segmented__item 14px, es-chip, es-kbd, es-input) left to the pages owner; the "New: tours" corner card covers the composer on phones (tours owner). No release note added (tours/updates.json is shared; add one combined note at merge).
### 2026-11-21 — Final QA: Video Ads (branch qa/final-video-ads)
- Status: `[committed on qa/final-video-ads — not pushed]`. Final QA agent 2 of 6, from origin/main 6769e54.
- **New check** `scripts/check-video-ads-ui.mjs`: real headless Chrome over CDP, local static server, every `/api/*` stubbed per scenario (ok / empty / error / free mode), external thumbnails, clips and logos served from local fixtures (`design-request-banner.webm` is the clip). Sweeps 75 states (Copy: 5 styles, 3 brands, zones, lint, Ask AI open / context / options / grammar / chat / error, daily set loading / done / error; Clip: by team incl. multi-pick, loading, results, angles, empty, error; by colour multi / results / empty / error; by moment loading / done / empty / error; library done / empty / error; link empty / YouTube / error / ok; stage with a clip: play, pause, 3 sizes, Meta preview at 3 sizes, safe zone, Frame and Tint rail, zoom; Export: sizes, 4 sound modes, 3-style grid, preflight, a real MP4 recording (1440), set mode; fresh page no-clip and animated; free mode) at 1440 / 1024 / 375 in light and dark (442 audits, ~190 s). Fails on doubled borders, empty bands and extra flex gaps, clipped text, text over text, horizontal scroll, misaligned cards / buttons / action rows, non-ES fonts, purple, unnamed controls, more than one primary button, console errors, broken images, contrast; checks behaviour (each main button does what it says); off-grid spacing is reported (`VA_WARN=1`). A canary plants one of each defect first so a check that stops working fails. `VA_ONLY=375`, `VA_SHOTS=dir`, `VA_ALLSHOTS=1`.
- **Fixed**: "No sound" and the source tag collided on clip thumbnails (now an icon with screen-reader text); "Use clip" / "Use this" / "Animated background" were repeated primaries and Next was primary beside the step's own key action (Next is now primary only when the step has no primary of its own); the 4 sound sliders had no accessible name (a label wrapping an `<output>` labels the output; `for=` added); the user's Ask AI bubble text was 2.9:1 in dark (theme.css paragraph rule; bubble text now has a class); dark `--va-ink-3` lifted to #8A96AC (clip captions and "no clip" card text were 4.3:1); dark toast action 4.4:1; empty Ask AI output added a 12 px band; "Also: Condensed , Us vs Them" spacing; free mode no longer offers a pointless "Try again", and the Ask AI quick actions are marked `data-ai-only`; phones fold the Frame / Tint rail on a step change (it left ~70 px for the new step); "Using your The Huddle settings" toast reworded; obvious off-grid spacing (toolbar, team pill, swatch rail, tag gap).
- Cache key `20261121-qa-video-ads`: video-ads.js, video-ads.css, video-ads-findclip.css (video-ads.html, and design-system.html for video-ads.css). No server or render-path change; editor exports untouched.
### 2026-11-21 — Final QA 3/6: Reels Studio sweep + fixes (branch qa/final-reels)
- Status: `[committed on qa/final-reels — not pushed]`. Based on live origin/main 6769e54.
- **New check** `scripts/check-reels-ui.mjs` (+ in-page audit `scripts/lib/reels-ui-audit.js`): headless Chrome over CDP, no deps, static server with `/api/*` stubbed (fixtures in `scripts/fixtures/reels`; the script is the server's own code plan, AI off, no network, no keys). Walks reel-maker.html at 1440 / 1024 / 375, light + dark: Story (trends loading / loaded / empty / error, trend picked, "Start from data" collapsed + expanded, Brief + empty-brief error, All settings), Make → Review (every fold, quality checks, all 4 styles), Export (organic, paid, one real MP4 export at 1440), Game Swing (recent / live-empty / search / error + retry, story with key plays, review, sources, export), Replay (X link + bad link, library + error + empty, upload, clip card with trim, story, review with frame scrubbers, carousel view, export, paid footage warning), Archive (search, no results + ESPN-id fold, own angle, story, review, carousel, export, carousel zip export), free mode and server-offline drafts. About 330 states, ~3 min. Fails on doubled borders, empty bands (incl. zero-size items that still take a flex gap), clipped / cut text, boxes sticking out of their parent, horizontal scroll, uneven cards / buttons in a row, non-ES fonts, purple, unlabelled controls, >1 primary, console errors, broken images, contrast, a toast over Back / Next / Export, and the step bar wrapping. Off-grid spacing is reported only (`REELS_WARN=1`).
- **Fixed** (reel-maker.css block "final QA" at the end, reel-maker.js, reel-lint.js): empty meta / voice / clip-pick slots no longer add a 12–16px gap; trend skeleton rows 8px wider than the list; Export's "Where it will run" control 8px past its column (scoped `box-sizing`; root cause is `.es-segmented--full` in es-ui.css, left for the pages owner); Revise / X link / ESPN-id / photo search buttons 40px beside 44px fields; "Pick another" 32px beside "Use this clip" 40px; Voice fold said "Voice is not set up here." twice under a redundant VOICE heading; long X source URLs ran out of the rights card; 5-step bar on a 375 phone wrapped the tour help onto its own row; toasts covered Back / Next / Export (now centred under the preview on wide screens, above the bar on phones); paid-ads gate message ended ".)."; obvious off-grid spacing (strip, status line, ratio, gate, rights rows, beat fields).
- Cache key `20261121-qa-reels`: reel-maker.css, reel-maker.js, reel-lint.js (reel-maker.html only). Reels exports unchanged (no render file touched; the lint message text changed only).

### 2026-11-21 — Final QA 4/6: editor (Social, YouTube, Newsletter) (branch qa/final-editor)
- Status: `[committed on qa/final-editor — not pushed]`. Based on origin/main 6769e54.
- **New check `scripts/check-editor-ui.mjs`** (extends check-panel-hygiene's harness: headless Chrome over CDP, static server, `/api/*` stubbed, fake session, settle-and-retry once). Sweeps every template of all three workspaces at 1440 / 1024 / 375, light + dark, six tabs in parallel (~4 min, 648 states): every inspector section opened, a layer selected (1440), export menu, zoom, dock ES Image Pool search and Layers toggled (first template per combo), every phone bottom-nav sheet per template. Fails on doubled borders, empty bands (sections, gaps between dividers, empty phone sheets), clipped text, clipped focus / selection rings, controls spilling out of their bordered box, controls overlapping controls, page / inspector horizontal scroll, mismatched button / card heights in a row, non-ES fonts, purple, unlabelled controls, more than one primary in view, console errors, broken images, contrast (text over the artwork is sampled from the canvas), and the dock fitting its column and centred under the canvas; plus behaviour (template sticks, export menu opens, zoom changes, layer selection updates the header, sheets open and close). Off-grid spacing is listed with EDUI_VERBOSE=1 and fails only past a baseline (103 distinct selectors). Shadow DOM is walked. Debug one state with `EDUI_PROBE='{"width":375,"theme":"dark","ws":"newsletter","value":"widgets","sheet":"content","shot":"/tmp/x.png"}'`; `EDUI_ROOT` points it at another checkout (used for the before count).
- **Before / after** (same final check): see the QA report; after = 0 problems.
- **Fixes**: canvas dock capped by the real column (Layers rail / open column + inspector, editor-polish.css; the design-tokens.css cap assumed an open 240px Layers column → 166px dock at 1024) and its image buttons wrap; dock no longer pushed 51–72px off-centre by margin-inline:auto; dock search stacks under 1280. Below 1280 an open Layers list floats over the canvas as a drawer starting under the canvas bar (studio-inspector.css) instead of squeezing the canvas to 176px (empty-canvas buttons spilled, the canvas bar slid under Export). Layer "Aa" swatch uses the editor's own text colour (white on white before). Dark empty-canvas hint text readable on the white canvas. Listicle Remove 32px like Change. Selected-colour / focus rings no longer clipped by open sections (overflow: clip + 6px margin). Dock search submit is a quiet button (was a second primary). Phone: empty sheets say "No … settings for this template"; trailing dividers dropped; Media sheet Upload image secondary (one primary); dark sheets no longer paint white cards under light labels or #2A2D34 square-cornered bands; paste-link fields 44px so the input stays inside; image tool tabs use Roboto and a 5:1 active colour. Canvas bar chips on the 8px grid.
- `test-canvas-action-dock` passes: its Content-panel regex now allows the infographic-fields entry between `.text-card` and `swipe-button-card` (still asserts Swipe Button is in Content), plus new static asserts for the dock cap / wrap / centring; the live overflow check is check-editor-ui.
- Exports: render path untouched; 9 canvas renders (3 per workspace) byte-identical base vs HEAD.
- Cache key `20261121-qa-editor`: studio-inspector.css, editor-polish.css, frameup-editor-ui.css, frameup-editor-ui.js (index.html). Release note `2026-11-21-qa-editor`.
### 2026-11-21 — Final QA: pages (branch qa/final-pages)
- Status: `[committed on qa/final-pages — not pushed]`. QA agent 5 of 6 (Home, Trends, Gallery, account menu, Profile, Settings, Tours, What's new, search, phone menu, UI Library, How FrameUp works, 404).
- **New check `scripts/check-pages-ui.mjs`** (+ in-page scanner `scripts/lib/ui-scan.js`): headless Chrome over CDP, no npm deps, local static server, `/api/*` stubbed, every Supabase call answered through CDP Fetch (nothing leaves the machine except Google Fonts), fake session. The Trends feed is built by the real `trend-design.js` from synthetic RSS. 13 page loads x 3 widths (1440 / 1024 / 375) x light + dark, 182 states: Home (account menu, What's new, Tours picker, welcome offer, tour step, search, AI usage card, phone menu, trends-down + free mode), Trends (cards, list, 3 sports, post kit, shortcuts, newsletter filter, error, empty), Gallery (workspace, type, no results, viewer, empty, error), Profile, Settings, UI Library, How, 404. Checks: doubled borders, empty bands, clipped / overflowing text, short labels cut by an ellipsis, cut placeholders, page scroll, card heights / action rows / button heights, inconsistent type for the same element, non-ES fonts, purple, unlabelled controls, >1 primary button per layer, console errors, broken images, contrast; off-grid spacing as warnings (`PAGES_WARN=1`). Behaviour assertions per state (menus open, filters filter, viewer opens, Settings shows the live limit). Opt out per element with `data-qa-allow="<kind>"`. ~3–4 min.
- **Fixed:** Home phone hero empty band (index.html @680px: slide = banner + buttons, no fixed height); Home phone tool tiles cut to one line; Home and Gallery post titles cut to one line (now 2); Profile at 375 scrolled sideways (hidden avatar file input widened by a shared phone rule); Settings "of $20" next to the sidebar's "$50" (now reads /api/ai-status); Settings row titles drawn in two styles (design-tokens.css label rule now skips `.acc-row__title`); selected chip count 3.1:1 (es-ui.css, no opacity); How FrameUp works title squeezed to one word a line at 1024; stale "Collapse the sidebar" tips (the sidebar no longer collapses); search placeholder cut on phones ("Search FrameUp…"); UI Library find placeholder; Gallery "posted link" placeholder ("Paste the post link"); sidebar logo / search / nav icons on one 8px inset.
- **Left:** Video Ads components in the UI Library have 3.7–4.0:1 text (`.va-gram__*`, `.va-meta-who small`, video-ads.css): listed by the check as known, owned by the Video Ads area. 219 off-grid spacing warnings remain (mostly 6px badge/kbd padding, 14px field padding, 10px gaps in shared chrome) — reported, not failed.
- Cache key `20261121-qa-pages`: frameup-home-today.css, app-shell.js, account-pages.css, how-frameup-works.css, design-tokens.css, es-ui.css, frameup-posted.js (every page that loads them). Release note `2026-11-21-pages-polish`. Editor template exports: no render-path file touched (index.html change is the home hero's phone CSS only).
### 2026-11-21 — Final QA 6/6: auth + Dashboard + live error log (branch qa/final-auth-errors)
- Status: `[committed on qa/final-auth-errors — not pushed]`. Base: live origin/main 6769e54.
- **Live error log ("19 errors in 24 h, 3 people hit one"): root causes found from the code paths and reproduced locally.**
  - `es-auth.js`: every trip back to login (even a plain signed-out visit, or a session that ran out) was kept and sent as an "error" after the next sign-in, one row per trip (empty fingerprint). Now only notable trips are sent: not routine, or within 10 min of a login, or a loop (another trip in 2 min). They carry a stable fingerprint per reason + page, with the diagnostics in `stack`. The login page's loop breaker still sees every trip. Dashboard → Errors labels them "Sign-in".
  - `frameup-errors.js`: these no longer count as API failures:
    - an endpoint's own JSON answer: a JSON 404 ("no video in that link"), or a 5xx with `configured:false` or reason off / feature-off / budget / not-configured / limits;
    - requests cancelled by leaving the page;
    - anything while offline;
    - Chrome's "ResizeObserver loop …" notice.
    New export: `isDeliberateAnswer`.
  - `dashboard.html` boot: the admin, profile and role checks timed out at 5 s on slow first loads. Reproduced under load: "Dashboard admin check timed out" for an admin. The checks not yet awaited then became uncaught "role permission check timed out" rejections. Now they get 9 s, like the session check, and each is marked handled. The boot-error state hides the header primary.
  - `app-shell.js` (minimal edit, marked `qa-auth-errors`; the pages agent's file): on design-request.html and requests.html (paused), the redirect stops the parser. DOMContentLoaded then fires with no `<body>`, and buildSidebar crashed ("reading 'prepend'"), reported from every old Design Request link. The shell no longer boots on a page being left.
  - `frameup-impact-view.js`: an /api/impact-stats answer without `sources` no longer throws.
- **UI fixes:**
  - People:
    - rows share column positions (a fixed actions column; at 1024–1279 the actions sit under status);
    - the list sits on the panel's 24px inset.
  - Dashboard search no longer cuts its placeholder at 1024.
  - Impact KPI cards drop the empty delta line.
  - Empty status lines collapse on auth-callback, reset-password and login.
  - reset-password drops the line that contradicted its own new-link form.
  - Email fields on auth pages no longer reserve room for the password toggle (the placeholder was cut on phones).
  - No doubled "Email me a sign-in link" after a wrong password.
  - Diagnose panel: the main action is the primary, and its note matches the width of the details box.
  - The in-page "couldn't confirm your login" panel: Retry is the primary.
  - `design-tokens.css` (minimal edit, marked): panels focused by script (`tabindex="-1"`) no longer get a focus ring around the whole panel.
- **Stale guards, fixed honestly:**
  - `check-dashboard-ui` checked one old cache key. Now it checks that every stylesheet has a key, and that the order is kept.
  - `check-site-chrome` was written for things that no longer exist: the retired how-it-works.html (d01fc8e), a pinned old chrome key, and the old login footer (e7def29). It now checks:
    - the same chrome key on every page;
    - no links to the retired page;
    - admin-only Dashboard links;
    - the six-icon set, where present;
    - the auth guard and profile mount on how-frameup-works.html.
  - `test-auth-security`: the reset page's copy check now tests the in-page new-link form instead.
- **New check:** `scripts/check-auth-errors-ui.mjs`, with the in-page checks shared in `scripts/lib/ui-sweep-checks.js`.
  - Setup:
    - headless Chrome over CDP, 4 parallel windows on *.localhost origins;
    - Supabase stubbed inside Chrome (CDP Fetch);
    - /api/* stubbed, and /api/client-errors recorded.
  - Sweep: 35 states x 1440/1024/375 x light/dark, plus 15 main pages crawled for error reports = 225 runs, about 2.5–4 min.
    - Login: default, create, 5 reasons, wrong password, magic link, forgot, diagnose, loop breaker.
    - Reset, callback (x2), logout, and the auth-problem panel.
    - Dashboard: 9 views, the Errors card, the People role menu, 5 empty views and 2 failed loads.
  - Fails on:
    - doubled borders;
    - empty bands and empty message slots;
    - clipped text, including cut placeholders;
    - horizontal page scroll;
    - misaligned cards, buttons and list columns;
    - non-ES fonts and purple;
    - unlabelled controls, and more than one primary per layer;
    - a focus ring around a whole panel;
    - console errors and broken images;
    - contrast;
    - would-be /api/client-errors reports;
    - broken flows.
    Off-grid spacing is reported only.
  - Before (6769e54): 69 of 225 runs failing. After: 0.
- Tests:
  - `test-auth-login-loop`: a new notable-trips test.
  - `test-client-errors`: deliberate answers, offline, pagehide and ResizeObserver cases.
  - `test-auth-security`: the boot checks are handled and get 9 s.
  - Full suite: only the 4 allowed failures (canvas-action-dock, color-swatch-states, newsletter-header-options, reels-transcription-framework). check-dashboard-ui and check-site-chrome now pass.
- Cache key `20261121-qa-auth-errors`, on every page that loads one of: es-auth.js, frameup-errors.js, app-shell.js, design-tokens.css, auth-state.css, dashboard-people.css, dashboard-ui-system.css, frameup-impact-view.js.
- Release note `2026-11-21-qa-auth-errors`. No editor render file touched, so exports are unchanged.
- Left for others:
  - ai-page/settings.html: `#settings-status` keeps an empty 24px line at 375 (pages).
  - reel-maker.html doesn't load frameup-errors.js (reels).
### 2026-11-20 — Video Ads: multi-select teams and colours (branch feature/va-multiselect)
- Status: `[committed on feature/va-multiselect — not pushed]`. Based on fix/ai-cap-parse (live main 0328b3b + 2). Owner: "we should also allow to select multiple teams or colors".
- **By team**: the team chips are toggle buttons (`.es-chip` `aria-pressed`, one tab stop, arrows move, Space/Enter toggle, Enter in the search adds the first match). Up to 6 (`PICK_MAX`); a 7th is refused with a note. A compact summary row above the list: "N teams of 6", removable chips, Clear; "All teams — pick up to 6" when none. Button: "Find Alabama clips" / "Find clips for 3 teams". Results = clips of ANY picked team, one card per play (unchanged clustering), current sort; each card marks the picked team(s) it matched (`.va-mo__team.is-match`, from the server's `matched` tags).
- **By colour**: swatches are `role="checkbox"` (several on), team-colour dots kept, the same summary row; union of the colours' teams.
- **By moment / Library / result filters**: the Team and Colour `<select>`s are now chip menus (es-chip + checkbox popover, Clear, "Up to 6", Esc closes, flips right at the viewport edge). Library reloads when its menu closes ("Done"). `VideoAdsMoments.filterMoments` takes `teams: []` / `colors: []` (ANY within, AND between; single `team` / `color` still work).
- **Server** (`netlify/functions/video-ads.js`): find-clips and library accept `teams: []` / `colors: []` (single fields still merged in). Known teams in the sport / known colour ids only, max 6 (400 otherwise; library drops unknown names). One team / colour = the exact old path and cache key. Several = ONE library read with the overlap filter (`teams=ov.{…}`, `_clip-library.read` already did this), clips tagged `matched`; a thin selection runs at most ONE capped search (same `FIND_CLIPS` caps, no per-team multiplication, no colour widening), aimed at the thinnest team first; extra sources once. Cache keys by the sorted selection (`teams:a,b` / `colors:red,teal`).
- **Remembered**: last picks per sport in `localStorage['frameup.videoAdPicks.v1']` (try/catch, junk dropped). The Trends hand-off still opens By team / By moment with its one team and does not overwrite the saved picks.
- Tests: new `scripts/test-video-ads-multiselect.mjs` (helpers, validation + back compat, one overlap query, union / dedupe / matched, cost caps, colour union, library teams, persistence, page wiring). Full suite = the 7 baseline failures only. Browser: headless Chrome on :8996, fake session + stubbed `/api/*`, 64 shots in scratchpad `hero/va-multiselect/` (1440/1280/1024/375, light + dark), no console errors, no horizontal scroll.
- Cache key `20261120-multi`: video-ads.js, video-ads-moments.js, video-ads.css, video-ads-findclip.css. CSS in one block at the end of video-ads-findclip.css.
### 2026-11-20 — Generate v3 looks: 17 ES-board archetypes, 7 tone families, cut-out craft (branch feature/gen-looks)
- Status: `[committed on feature/gen-looks — not pushed]`. Agent A of Generate v3 (B gen-imagery, C gen-director in parallel). Research: `project-docs/gen-v3-style-research.md` (ES Figma board 2335:229 row by row + external sources).
- **17 looks** in `frameup-compose.js` (`LOOKS`, each `looks: true`, `family`, `tones`): stats (stat-stack, stat-column, record-alert, light-stat), cover (cover-boxes, frame-break, split-panel), quote (quote-boxes, quote-card, quote-duo), grid (headshot-grid), listicle (ranked-table), bar-graph (bar-race), extra (post-card, stat-sheet, print-collage), lifestyle (editorial-feature). 46 archetypes total; the 29 v1/v2 build exactly as before when no `input.tone` is given.
- **Tones** (`TONES`, `tonePalette`, `toneFor`): light, paper, vivid (the team colour itself), dark, duotone (3-stop team ramp on photos), editorial (B&W photos, white boxes), esblue. Roles box / boxInk / boxHi / tag / tagInk / inkSmall, all contrast-checked (test over 16 team palettes x 7 tones). Looks always draw a tone (`input.tone` if supported, else their first; variant 2 crosses light/dark); v1/v2 archetypes take `input.tone` only when it is in their `tones` (same maps as gen-director's fallback). `palette.base` keeps the team colours.
- **Shared input shape**: `normalizeInput` reads `{url}` or `{src}` for photos / cutouts / headshots / logos, sets `input.photo` (top-ranked) and `input.cutout` (the one made from the hero photo) when missing; looks' `fits` normalise, so direct `a.fits()` works.
- **Renderer**: staggered highlight boxes (`box.stagger`); cut-out `maxW` (wide swings grow past their box); `breakout` frame-break (the cut-out drawn in register on its own photo so the head rises out of the frame; not-registered cut-outs fall back to a blurred field, never a double); `trim` keeps the subject bounds. Gate: rank squares flagged `ordinal` (1-30) pass the fact check. `swapPhoto` keeps a frame photo with its cut-out.
- **Honesty rules in fits**: record alert only for record stories (a W-L record is not a broken record); bars only for one measure (seasons or players); ranked tables need rows or 3+ people; stat sheets never repeat a value; post cards need `input.post`; two voices need two speakers with their own photos; split panel never prints the name twice; athletes are never mirrored.
- `es-guidelines.js` COMPOSED_RULES: v3 archetype list + composed-tones, composed-cutout-craft, composed-honest-looks (text only; read server-side, not by the editor, so index.html's es-guidelines cache key was left alone: editor files untouched).
- Tests: new `scripts/test-compose-looks.mjs`; `test-generate-creative` / `test-gen-v2-integration` now scope their v1/v2 checks with `!a.looks`. Full suite = baseline failures only (+ check-dashboard-supabase: live network timeout). Editor exports cannot change (no editor file touched; export-hashes script not available).
- Lab: scratchpad `gen-v3-lab/` (render.html, run.mjs = static server + headless Chrome over CDP, 24 briefs across golf / NFL / CFB / NBA / WNBA / MLB / tennis / soccer / F1 with real ES photos + macOS Vision cut-outs). Sheets: scratchpad `gen-v3-out/looks/final/`.
- Cache key `20261120-looks` (frameup-compose.js in generate.html). Release note `2026-11-20-gen-looks`. Generate composed exports change on purpose.
### 2026-11-20 — Generate imagery v3: ranked ES photos, cut-outs, headshots, logos (branch feature/gen-imagery)
- Status: `[committed on feature/gen-imagery — not pushed]`. Agent B of Generate v3; contract in scratchpad `gen-v3-contract.md`.
- **Root causes, every brief:**
  - Cut-outs never ran in Generate. The server refuses them (no decoder), and `generate.html` didn't load `frameup-assets.js` / `frameup-cutout.js`.
  - Places, tours, weekdays and ALL-CAPS fragments were searched as people, and first names searched badly.
  - With no vision key, photos stayed in source order (logos, silhouettes and other people first).
  - Real sizes were unknown.
- **New:** `netlify/functions/_imagery.js`:
  - subject cleaning, plus ES tag resolution;
  - gather and de-duplication (agency ids across hosts);
  - header size probe and larger WordPress originals;
  - free signals, Haiku vision only for people (gated, cached 24 h);
  - a 0–1 score and a variety pick;
  - cut-out plan, headshots, logos.

  `findPhotos` now goes through it, returning contract-shaped `photos` / `cutouts` / `headshots` / `logos`.
  `prepareImagery` is the whole-brief variant.
- **Cut-outs:** `generate-creative.js` makes up to 3 per run in the browser ($0.05 cap, 25 s), rebuilds that
  person's designs through `checkScene`, and stores the PNG (`op: 'cutout-store'`, `gen-assets/cutouts/<sha>.png`,
  first write wins). Later runs get it from `findPhotos` at $0.
- `_composer.js` is not touched (gen-director owns it). Cache key `20261120-img1`: `generate-creative.js`, plus
  the new `frameup-cutout.js` / `frameup-assets.js` tags in `generate.html`.
- **Tests:** new `scripts/test-gen-imagery.mjs`; `test-gen-assets` updated (contract kinds, cache). Full suite = the 7 baseline failures only.

### 2026-11-20 — AI budget policy in code + free mode in every AI tool (branch feature/ai-free-mode)
- Status: `[committed on feature/ai-free-mode — not pushed]`. From origin/main 663c020. No migration, no new env var, no Vercel change. Screens: scratchpad `hero/ai-free-mode/`.
- **Policy in code** (`_ai-gateway.js` `POLICY`): $20/person, $45 team (Gateway hard stop is $50). `AI_USER_WEEKLY_LIMIT_USD` / `AI_TEAM_WEEKLY_LIMIT_USD` can only LOWER a limit (`$50`, `50 USD` parse); above the policy, 0 or garbage → ignored, logged (`limit-env-ignored`) and listed in `/api/ai-status` `envIgnored`. **Note:** a `$50` person value set in Vercel is now ignored (policy $20). To raise: edit `POLICY`.
- **Team spend** uses the existing `frameup_team_ai_spend` RPC (migration `20261118120000_ai_guardrails.sql`); before it runs the team cap fails open with a warning, as before. Crons read `frameup_ai_budget_summary` with the service role (`cronSpendGate`).
- **Free mode**: `withAiMode(handler)` gives each request a store (AsyncLocalStorage); `aiSpendGate` returns `{ free: 'user-limit'|'team-limit' }`, `freeModeGate(gate)` switches the request; then `gatewayConfigured()` is false and `aiText/aiWebResearch/aiImage/aiTranscribe` throw `code:'free-mode'` before any fetch, so existing no-AI paths run. A Gateway 402 (or 429/403 with budget/quota/credit words) → `gateway-budget` free mode for the rest of that request (next request re-probes; status shows it for 10 min). Replies: `{ ok:true, mode:'free', reason, notice, resetsAt }`; AI-only ops → `skipped:true` (200). Old `weekly-limit`/`team-limit`/budget replies are converted centrally (`annotateFree`).
- **Per feature**: Generate → rules/ES templates, no director (direct = []), judge = rule-check picks + critique, assistant = local edits only, rewrite/on-brand/scene image skipped. Video Ads → copy from rule-based templates (`freeCopy`, same ES checks, cost 0), clip search = library + free sources, grammar/chat/rating skipped, moment titles = cleaned captions. Reels → code plan, voice/music/scene/AI clips/clip judge/frame pick skipped, captions (transcription) off. Trends → rule ideas, AI angles hidden. Gen assets → cached/stored assets still served, no new AI images/cutouts. remove-bg now checks the team cap too. Cron: clips-prefetch skips paid sources + classify over the team cap and still succeeds.
- **Client**: new `frameup-ai-mode.js` (`window.FrameUpAI`): `/api/ai-status` once a minute (memory + sessionStorage), `<html data-ai-mode>`, one dismissible note (role=status), `[data-ai-only]` styling, and a fetch watcher (a `skipped` free reply reaches old code as a 503 whose error is the note). Sidebar card: "$x of $20", "Free mode · AI back …", team line for admins. Trends hides AI angles; Generate/Video Ads map the new reasons.
- `/api/ai-status` adds `mode, reason, notice, userLimitUsd, userSpentUsd, teamLimitUsd, teamSpentUsd, gatewayBudgetUsd, resetsAt, admin, policy, envIgnored`.
- Tests: new `scripts/test-ai-free-mode.mjs` (budget math, Gateway budget → free, 20 features × user/team table, annotateFree, ai-status shape, cron, client caching); updated guardrail/weekly-limit/feature tests for the new 200-free replies. Full suite = the 6 allowed failures only.
- Cache key `20261120-free`: frameup-ai-mode.js + app-shell.js (every app-shell page), video-ads.js, trends-view.js.
- Merge notes: marked `ai-free-mode` one-line gates in `_asset-service.js` (gate()), `video-ads.js` handler (+ `freeCopy` block before `AI_MODES`), `es-generate.js` (pickProvider + gate lines), `_clip-source-grok.js`; `_composer.js` / `_creative-director.js` / `frameup-compose.js` untouched.
### 2026-11-20 — Polish: MLB clock tab, CFB play text, Big-number poster at 9:16 / 1:1 (branch feature/polish-1120)
- Status: `[committed on feature/polish-1120 — not pushed]`. From origin/main 852a1d6. Before/after frames: scratchpad `hero/polish-1120/`.
- **Reels Game Swing, MLB**: baseball has no game clock, so the clock tab under the scorebug only repeated the bug's inning ("TOP 2"). `reel-render.js` `clockTab(state)`: the tab shows only with a clock, or a period the bug is not already showing (football with down & distance keeps "Q4  0:03"). The digest has no outs / bases, so nothing replaces it; the clip moves up into the space. Football unchanged.
- **Reels Game Swing, CFB play card**: the small second line was ESPN's raw play text ("Shotgun #16 A.Manning pass incomplete deep left to #3…"). New `ReelTimeline.cleanPlayText` (removes only: formation lead-in, jersey numbers, parentheticals incl. a cut-off "(Two-Point Run…", bracketed notes, Center/Holder credits, ball spot before "for N yards", "ran ob at X N", "reported in as eligible" notes, cut-off tail, dangling words; spaces initials; yards -> yds, TOUCHDOWN -> TD). Every number left is in the source (tested). `_reel-games.js` digest now applies `ReelTimeline.stripPlayNoise` (formation + jersey before a name) before its 60/80/100-char cut, so more of a college play fits; NFL golden digest byte-identical. `playHeadline` (reel-data.js) unchanged.
- **Generate, Big-number poster** (`frameup-compose.js`, `big-number`): 9:16 grows number / headline / body into the height (the 4:5 positions left the lower ~600 px empty); 1:1 tightens the stack (before, headline overflowed into the body and over the number label). 4:5 values unchanged: all 29 archetypes x 3 briefs x 3 variants (183 renders) have identical scene JSON; PNGs pixel-identical for 156, the other 27 differ by <= 2/255 on a few pixels, the same noise as before-vs-before re-renders of main.
- Gates: news-reel hash gate origin/main = HEAD (`1b18adf9…`); full suite = the 7 baseline failures only. Tests: `test-reel-render` (real MLB/CFB digests, new fixtures `scripts/fixtures/reels/{mlb-401908046,cfb-401856885}.digest.json`), `test-reel-games` (cleaner on real strings, digest pre-clean), `test-compose-styles` (big-number sizes through checkScene).
- Cache key `20261120-polish`: reel-timeline.js, reel-render.js (reel-maker.html), frameup-compose.js (generate.html).
### 2026-11-20 — Reels Studio: "Start from data" expands in place; explaining format thumbnails (branch feature/reels-gallery-expand)
- Status: `[committed on feature/reels-gallery-expand — not pushed]`. Owner: "when clicked on all formats, expand this panel from down, no need to change page, also better explaining thumbnail for each of them".
- **Expand in place**: "All formats" on the Story step's "Start from data" panel now grows the same panel downward (CSS `grid-template-rows: 0fr → 1fr`, 300 ms, off under reduced motion) and adds "From the news" (the 4 news formats) under the data row; no step change. The link becomes "Show less" (`aria-expanded`, `aria-controls="rm-fe-more"`, the hidden region is `inert`); the title reads "From live data and the archive" while open. Esc inside the panel collapses and returns focus to the toggle. Open/closed is remembered per browser (`frameup.reels.allFormats.v1`, try/catch). Picking a tile runs the same `pickFormat` as the gallery (data → its source step; news → stays on Story, format set, focus back on the tile).
- **One renderer**: `ReelGallery.tileHtml` draws both the Format-step gallery and the panel (`compact` + `prefix` options so ids stay unique). Each tile: 4:5 thumbnail, name, one-line summary (`ReelGallery.SUMMARY`, shortened from reel-formats.js blurbs; the registry is untouched), output chip, sports (or "Trend or brief"). The Format step (steps nav, data flow) still opens the full gallery.
- **Thumbnails** (`assets/reels/formats/*.svg`, all 7, 2–3.4 KB each): 4:5 mini reels in the ES broadcast palette with the real ES mark top-right — Game Swing scorebug "SF 46 · DAL 40 FINAL" + win-probability line with the swing marked; Replay SETUP / PLAY / REACTION frames + carousel stack; Archive big year, source chip, 2017→2023 rail; Explainer tag + headline + beat label; Stat alert big number; Top 5 ranked rows with #1 saved for last; Quote quote marks + kinetic type. Text in Roboto Condensed / Acumin with condensed fallbacks; numbers are illustrative only. Generator: scratchpad `hero/reels-gallery-expand/gen-thumbs.mjs`.
- **Responsive**: 3 columns in the panel at 1024–1440; at ≤ 480 px the collapsed row scrolls sideways with snap and the open panel is 2 columns. No page horizontal scroll at 1440/1280/1024/375. One focus ring per card (inset in the panel).
- CSS lives in one block at the end of `reel-maker.css` ("feature/reels-gallery-expand"); the old `.rm-fmt-mini` / `.rm-fmt-entry__row` rules are now unused (left in place to avoid merge churn). Cache key `20261120-gallery` (reel-gallery.js, reel-maker.js, reel-maker.css).
- Tests: `scripts/test-reels-gallery-ui.mjs` (art test now checks 4:5, size, fonts, ES mark, content; new entry-panel and expand/collapse wiring tests). Browser: headless Chrome, fake session + stubbed `/api/*`, shots in scratchpad `hero/reels-gallery-expand/shots/`.
### 2026-11-20 — One segmented control, one chip, one section heading (branch feature/ui-unify)
- Status: `[committed on feature/ui-unify — not pushed]`. From origin/main 852a1d6. Owner-approved follow-up to the 2026-11-19 QA (three segmented heights: 32 Generate, 36 UI Library, 40 Video Ads; Video Ads' own pill `.va-chip`; two trend-heading styles on Generate).
- **Segmented → `.es-segmented`** (36px segments in a 4px track = 44px) everywhere: Generate Look / Tone / Audience (were `.gen-chips`), Designs (`gen-count`), focus-view canvas size (`gfx-seg`); Trends layout (local 32px override removed, now `es-segmented__item--icon`); Video Ads newsletter, size, safe zone, clip fit (rail), sport ×3, what-to-export, sound (all `.va-seg` / `.va-rail__fit`). JS behaviour, role=radio/aria-checked, roving tabindex and arrow keys unchanged; ids kept.
- **Library (es-ui.css)**: `.es-segmented__item` now styles `aria-checked` / `aria-pressed` as selected (light + dark) and disabled segments; new `.es-segmented__item--icon`; documented `.es-segmented--sm` (32px in a 3px track) for the dense editor inspector only (its Layout / stat count / ticker direction already render that spec; markup left alone to keep the editor cascade and exports untouched). `.es-chip` adds `aria-checked`, `aria-disabled`, `.es-chip__count`, `.es-chip__dot`, and 44px on touch (`pointer: coarse`) for every page.
- **Chips → `.es-chip`**: Video Ads By moment sports, sort, quality, claims, style set, still length, and the By team picker (`.va-teamchip`, logo kept); Generate Trending now (`gen-tchip` is now layout only); Home's undefined `es-chip--sm` dropped; Trends counts use `.es-chip__count`. Removed the duplicate local CSS (va-seg/va-chip blocks and stage overrides, gen-chip/gen-count/gfx-seg, td-density sizes, Reels' global aria-checked overrides, logo-picker 32px segments, ai-studio va-chip motion). Video Ads keeps one local rule: a 1px line around the track on the grey stage; at about 1024 the stage toolbar uses 13px labels to stay one row (height unchanged).
- **Generate headings**: Trending now, Recent, Try a format and Start from a live trend share one style, the panel-title role (18 / 800 Roboto Condensed UPPERCASE, ink), like Reels Studio and Video Ads.
- Docs: `project-docs/frameup-design-system.md` (segmented, chips, section headings, radius line); UI Library `design-system.html` (segmented rule + icon / disabled / `--sm` specimens, new Chips block, Video Ads brand specimen on `.es-segmented`).
- Checks: new `scripts/test-ui-unify.mjs`; suite at the 7 baseline failures. Headless sweep 1440/1280/1024/375 light + dark (Home, Generate, focus view, Trends, Video Ads, By moment, Reels, UI Library): every segmented control 44px, every chip 32px (44 touch) / 10px radius, no horizontal scroll, no console errors. Editor exports byte-identical vs origin/main. Screenshots: scratchpad `hero/ui-unify/`.
- Cache key `20261120-unify` for every changed CSS/JS on every page that loads it.
### 2026-11-20 — Video Ads: Find a clip spacing pass + "Video link" takes any video link (branch feature/va-findclip)
- Status: `[committed on feature/va-findclip — not pushed]`. Based on origin/main 852a1d6.
- **Any video link** (server `clip` mode -> new `netlify/functions/_clip-link.js`; shared detector `video-ads-links.js`, UMD, also loaded by the page): X (unchanged clipFromPost), Bluesky (handle -> DID, getPosts, PDS getBlob), Reddit (post JSON / v.redd.it redirect -> CMAF MP4s, video only, said plainly; 403 -> honest fallback), Streamable (public API), Vimeo (player config progressive files; stream-only = fallback), Google Drive / Dropbox share links -> direct downloads (HEAD-probed), direct .mp4/.mov/.m4v/.webm, any page's og:video MP4. YouTube / Instagram / Threads / Facebook / TikTok are never downloaded (message + "save it and drop it here"); .m3u8/.mpd explained, not faked. The server never reads video bytes (HEAD or a 1-byte range GET only).
- **SSRF guard**: https only, no credentials, port 443, no private / loopback / link-local / CGNAT / metadata / mapped-IPv6 addresses after DNS, `.internal`/`.local`/single-label hosts refused, redirects followed by hand and re-checked (max 4), 6 s timeouts, HTML read capped at 600 KB, files over 500 MB refused. Known API hosts are fixed in code.
- **Page**: field renamed "Video link" + helper line of sources; result card (platform, handle, quality badge, duration, size, "No sound", quality chips, below-720p note); fallback card for YouTube / blocked / private file / stream / CORS-blocked downloads with "Open the file / Open on …" + "Choose file" (+ "Try again" / "Try anyway"). A browser download the host refuses (CORS) now lands on that card instead of a dead-end toast. Export records gain `clipPlatform` next to `clipSource` / `clipUrl`; the rights tick stays an optional, non-blocking reminder.
- **Find a clip spacing** (new `video-ads-findclip.css`, loaded after video-ads(-moments).css; no change to `.va-seg` / `.va-chip` / `.es-*` component styles): panel gutters 20 -> 24 (16 on phones), footer 20 -> 16/24; pane gaps 20/16 -> 16; status line dot 0 -> 8 px gap, centred; filters -> grid 12 -> 16; card padding 6/6/8 -> 8, inner gap 6 -> 8; action row pinned to the card floor (Use clip aligned across a row: was up to 26 px off); "+N angles" moved above the actions and shortened; title clamp 3 -> 2 lines with a fixed 2-line height; badges 6 -> 8 px from the thumb edge; stray "·" before views removed.
- CSP (report-only) connect-src += v.redd.it, *.streamable.com, *.host.bsky.network, (*.)dl.dropboxusercontent.com, drive.usercontent.google.com, *.vimeocdn.com, vod-progressive.akamaized.net. Other direct-file hosts still work (report-only) but will show in CSP reports.
- Tests: new `scripts/test-video-ads-links.mjs` (22 cases, mocked fetch + DNS; in `test:clips`); `test-video-ads.mjs` YouTube now 422 `reason: youtube`. Cache key `20261120-findclip` (video-ads.js, new video-ads-links.js, new video-ads-findclip.css). Release note `2026-11-20-findclip`.
### 2026-11-20 — Account menu, Edit profile, Settings, Tours panel, signed-out screen (branch feature/account-polish)
- Status: `[committed on feature/account-polish — not pushed]`. Based on origin/main 852a1d6.
- **Account menu** (`site-chrome.js` + a v3 block at the end of `site-chrome.css`): WAI-ARIA menu button (`aria-haspopup="menu"`, `role="menu"`, `menuitem` / `menuitemradio`, groups, separators). Header: avatar, name, email (truncated, full in a tooltip), role · team. Groups: Edit profile, Settings | Tours (done count, e.g. 2/6), What's new (unread dot), UI Library | Appearance Light / Dark / System | Log out. 40px rows (44 on touch), Lucide icons. Keys: Enter/Space/↓ open on the first item, ↑ on the last; ↑↓←→ move (wrap), Home/End, type-ahead, Esc closes and returns focus, Tab closes. Tours / What's new rows only show when those features loaded. Works in the sidebar, the phone menu and the old navbar. `FrameUpProfileMenu.registerUnsaved(fn)` + `unsavedWorkMessage()`.
- **Log out**: asks first only when there is unsaved work (`FrameUpAutosave.status()` dirty/failed after one `saveNow()`, or a page check such as Edit profile's form); otherwise straight to `ai-page/logout.html?from=menu`.
- **System theme** (`theme.js`): `FrameUpTheme.apply('system')` stores `system` and follows `prefers-color-scheme` live; `FrameUpTheme.preference()`; other tabs follow via `storage`. 404 / reset-password / auth-callback inline scripts still read only `dark` (show light for System).
- **Edit profile** (`ai-page/profile.html`, new `ai-page/account-pages.css`): page head, Profile card (avatar with initials fallback, upload cropped to 256px square + Remove, name / read-only sign-in email / role / team / note with count), validation with field errors, Save changes enabled only when dirty, Discard, Unsaved/Saved status, Ctrl/Cmd+S, leave-page warning; Account card (signed in as, Log out, Delete account: unchanged flow).
- **Bug fixed**: es-auth `syncProfile()` rewrites `es.ai.profile` with only `{name, email}` on every session read, so role / team / note / photo were wiped on the next page load. Edits are now also kept in `es.ai.profile.edits.v1` (tied to the signed-in email) and merged back by `account.js` and `site-chrome.js`; logout clears it. Root fix (merge in `syncProfile`) is in es-auth.js, not touched: owner call.
- **Settings** (`ai-page/settings.html`): Appearance (three preview cards incl. System), Start page (switch + select, the real `es.ai.settings` keys index.html reads; default now off, matching what index.html does), AI usage (this week from `frameup_my_ai_spend`, by feature, loading / empty / error + Try again), Tours and updates. Everything saves on change with a "Saved" tick; Restore defaults.
- **Tours panel** (`tours/tour-launcher.js`, `frameup-tour.css`): progress per person (`state.tours[id] = {startedAt, doneAt}` from `frameup:tour-start` / completed `frameup:tour-end`), "N of M done" bar, per-tour Done / Started / steps, This page tag, Latest update row, Reset progress, ↑↓ keys. `FrameUpTours.progressSummary()`. Body `data-tours="off"` opts a page out of offers/help buttons.
- **Signed out** (`ai-page/logout.html`): standalone ES-branded card (no sidebar/footer). from=menu signs out at once; direct visit asks; already signed out; error + Try again. Same `ESAuth.logout()` call.
- **UI Library** (`design-system.html`, separate `<style>`/`<script>` blocks + the toc bar only): search (`/` to focus, Esc clears, Enter jumps) filters subsections, match count, empty state; hairline under the sticky bar. Component sections untouched.
- Tests: new `scripts/test-account-menu.mjs`; `test-profile-layout.mjs` moved to the new layout. Cache key `20261120-account` (site-chrome.js/.css, theme.js, tour-launcher.js, frameup-tour.css, account.js, account-pages.css) on every page except login.html (not edited per branch rules).
### 2026-11-20 — Sign-in hiccups, login loop fix, People & roles view (branch feature/auth-roles)
- Status: `[committed on feature/auth-roles — not pushed]`. Based on origin/main 852a1d6. Migration NOT run: `supabase/migrations/20261120120000_people_roles_admin.sql` (owner runs it; the page works before it).
- **Login loop (live bug)**: most likely cause is a full localStorage. supabase-js tests storage once; when that write fails it silently keeps the session in page memory, so sign-in "works" and every next page finds no session. Fix in `es-auth.js`: resilient storage adapter (localStorage, else sessionStorage for the tab), post-login check that the STORED token and user are the new ones, stale sb-* / pre-v2 keys cleared before sign-in, clock skew over 50 min named. `requireAuth` retries after 1.5 s, uses the stored session when the check keeps failing, and within 60 s of a login shows an in-page Retry panel instead of bouncing. Bounces are recorded (no tokens or addresses) and sent to `/api/auth-bounce` (new, anonymous, logs; stores to frameup_client_errors only with `SUPABASE_SERVICE_ROLE_KEY`) and to `/api/client-errors` once signed in. `login.html` loop breaker: more than 2 bounces in 2 min (or `?diagnose=1`) shows a diagnostic panel with copyable details and "Clear sign-in data" (sb-* and es.auth* keys only).
- **supabase-js self-hosted** at `vendor/supabase-js-2.118.0.min.js` (byte-identical, same SRI), CDN as fallback; preload links updated (not on profile/settings/logout/design-system: account-polish owns those).
- **Auth flows**: repeated sign-up detected (identities: []) → "You already have an account"; per-address email cooldowns with a visible countdown (honours Supabase's "after N seconds"); honest limit text plus spam/quarantine help naming the Supabase sender; magic link for existing accounts only (no enumeration); unconfirmed login → Resend; expired links → send a new link in place (auth-callback, reset-password); invite/recovery links → set a password; session-expired reason; redirect back to the current page; password rules (8–72 bytes, no edge spaces), show/hide, keyboard tabs; error codes for every Supabase auth error. New `auth-flow.js` (pure helpers). Google sign-in NOT added: the provider is off (checked the public settings endpoint, read-only).
- **syncProfile** now merges into `es.ai.profile` (keeps role/team/note/photo; fresh for another account); dashboard presence reads `es.ai.profile` + `es.ai.profile.edits.v1` (same email only).
- **Dashboard → People** (`dashboard-people.js/.css`): search, status filters (active / pending confirmation / invited / access request), role menu with guards and a confirm dialog on the admin boundary, optimistic with rollback, approve/deny requests, admin "Confirm email", recent-changes audit. The migration adds role-based admins (with insert/update role protection), `admin_set_es_designer_role` (self / fixed / owner-only / last-admin guards, audited), `admin_list_es_designer_people`, `admin_confirm_es_designer_email`, `es_designer_role_audit`.
- `test-auth-security` fixed (stale assertions: sessionStatus guard, designteam@ admin). New tests: `test-auth-flows.mjs` (29), `test-auth-login-loop.mjs` (14). Docs: `project-docs/auth-recommendations.md`. Cache key `20261120-auth`. Screenshots: scratchpad `hero/auth-roles/`.

### 2026-11-19 — Release QA pass: spacing, UI Library, rules (branch release/2026-11-19)
- Status: `[committed on release/2026-11-19 — not pushed]`. Static audit of `origin/main..HEAD` + headless sweep (index home + Social/YouTube/Newsletter, generate + focus + Trends, video-ads, reel-maker; 1440/1280/1024/375, light + dark; computed fonts, purple, `[hidden]`, overflow, clipped text, labels, primaries). Screenshots + reports: scratchpad `hero/qa-1119/`.
- **Generate focus view + cards**: a Director fix that was applied now shows a green "Applied" (not a second Apply) while its version is current or behind it; Undo brings Apply back. The Director tab count and the card's "N to improve" leave out applied fixes. Focus stays in the list after Apply. API: `FrameUpCreative.design(id).isApplied(improvementId)`.
- **Generate 375**: the brief card no longer scrolls sideways (help + Bring it on-brand on one row, Generate full width; `.gen-brief` column `minmax(0,1fr)`). Focus view phone tabs: the Director count sits on the icon so labels line up.
- **Generate Trending now chips**: picked with `TrendsLogic.topPicks` (one per storyline, max 2 per sport) instead of the next 6 in feed order (was 5 near-identical golf stories).
- **Trends**: Post-now rows no longer repeat "2000+ searches · 2 outlets" under a meta line that already says it (`whyNow(item, { reach: false })`); the meta says "outlets" (was "sources"), the same word as Home.
- **Home Today dark**: the spotlight headline was muted to Slate 100 by theme.css's dark `<p>` rule; now full white.
- **Reels 375**: help button back on the steps row.
- **Tokens**: 60 hard-coded dark-mode hexes on lines this release added (generate-creative.css, trends.css, reel-maker.css, frameup-home-today.css) now use the palette tokens (`--es-slate-*`, `--es-blue-300/400`, `--es-white`); same values, no visual change.
- Cache key `20261119-rel2` for the changed files. Tests: `test-gen-ui`, `test-trends-hero` extended.

### 2026-11-18 — Video Ads: clip sound muted by default, Sound control, shared audio library; toolbar back to one row (branch feature/va-audio)
- Status: `[committed on feature/va-audio — not pushed]`. Based on feature/va-library-icon.
- **Muted by default**: the clip's own audio is off in the preview and in every export (single, Export 3 styles, Today's set). A muted export has NO audio track. New `video-ads-audio.js` (UMD, `window.VideoAdsAudio`): library parsing, upload validation (mp3/m4a/wav, 15 MB), levels (music -6 dB, clip ducked to -12 dB under music), fade / loop / trim-start maths, rights record, and `createMixer(ac)` (one Web Audio bus feeds the preview speaker and the recorder, so the preview hears the export mix).
- **Sound control** in Export (under Sizes / Export 3 styles): Muted | Original | Music | Upload; music volume, clip volume, fade in/out (0.5 s), start-the-track-at, loop to length, "Keep the clip's sound underneath". Remembered per newsletter in the brand defaults (`sound`); uploads stay in this tab only (like uploaded clips). Upload has an optional "I have the rights to use this audio" tick. Library tracks not cleared for paid ads show a warning (non-blocking).
- **Shared library** `audio-library.json` (EMPTY; "about" says how to add tracks) + `assets/audio/`. Empty state: "No tracks yet. Upload your own, or ask an admin to add library tracks." Reels Studio can point at the same file later (reel-* files untouched).
- Learning event `export` gets `sound` (mode, audible, clip source, track id + licence, or upload name + rights tick, levels).
- **Toolbar** (owner: "no need of Feed/Story/Reels"): Meta preview and Safe zone back in the top row with newsletter + size; the Feed / Story / Reels switch, its state, persistence and the Stories mock are removed. Meta preview follows the size: 9:16 → Reels, 4:5 / 1:1 → Feed. Narrow stages (1024–1199) use text-only segments; labels show when the toolbar has room. Phones keep their two-row grid.
- Tests: new `scripts/test-video-ads-audio.mjs`; `test-video-ads-hero.mjs` updated (no #va-placement). Cache key `20261118-va-audio`.
### 2026-11-18 — Video Ads clips: By moment = trending plays of the last 5 days; 720p and game action everywhere (branch feature/va-moments)
- Status: `[committed on feature/va-moments — not pushed]`. Based on `feature/va-library-icon`. Docs: `project-docs/clips-library.md` (new last section).
- **By moment** is no longer news headlines: the most popular clips of the last 5 days, one card per play (near-duplicates clustered: media key, soft key, shared player name + team / words + time), best version first, "+N angles" opens the others. Sport chips + **Team** and **Colour** filters + **Trending / Newest / Most viewed**. Trends hand-off (`frameup.videoAdMoment.v1`) pre-filters to the story's team.
- New shared UMD `video-ads-moments.js` (cluster, velocity, trend score, title cleaning, grounded AI-title check, filters, facets, hand-off) + `video-ads-moments.css` (moment cards, kept apart from video-ads.css for merging).
- Server `moments-with-clips` reworked (name kept): library first, free top-up, one capped paid round; optional light-tier titles (≤ $0.005/refresh, cached 6 h, gated). Library mode defaults to Trending.
- **720p floor** everywhere (`CLIP_MIN_SHORT_SIDE`); **game action only** (`_clip-classify.js`: Haiku 5.5 vision in the daily prefetch, ≤ $0.30/day, `ai` column via migration `20261118121800_frameup_clip_library_ai.sql`, rules fallback). Prefetch also refreshes likes / views (free). Page picks the 1080p variant when there is one.
- By team / By colour / Library cards are moment cards too (clustered, Trending default).
- Tests: new `scripts/test-video-ads-moments.mjs` (in `test:clips`); moments sections of `test-video-ads.mjs` and `test-clip-library.mjs` rewritten for the new contract; fixtures given game wording / 720p.
- Cache key `20261118-va-moments` (video-ads.js, video-ads.css, new moments js/css).
### 2026-11-19 — Reels Studio data formats: integration (branch feature/reels-formats)
- Status: `[committed on feature/reels-formats — not pushed]`. Integrates A/B/C (merged at 53d1e89). Contract §9 lists the agreed deviations.
- Game Swing `plan` honours `playIds` (server keeps ids in the digest, strongest 5 when more, 422 `no-plays` when none); the page's keepPickedPlays workaround is gone; the picker caps ticks at 5.
- Clips: the page asks `game-data` with `clips:true`; `clipMatches` carry text/variants; `planFromGame` matches each clip across all plays; play beats show only their sure-matched clip, else a photo/tile of the team that made the play. Fixed: `readDataInput` stripped clip URLs (clean() removes URLs), so matched clips never reached a beat.
- Live data fixes (real ESPN GETs 2026-11-18): `shortenText` no longer cuts at "Sr."/initials; play headlines drop ESPN college formation/jersey noise and dangling last words.
- Live check: NFL SF–DAL 401873063 (7,994 B digest), LAC–BAL 401873065 (8,073 B), CFB TEX–LSU 401856885 (8,076 B), MLB MIL–TB 401908046 (6,339 B): digests valid ≤ 8 KB, plans/timelines valid, no lint blockers; one frame sheet + MP4 per sport rendered through reel-maker.html in headless Chrome. Archive tested with a mocked ES MCP only.
- Hash gate: news reels byte-identical to origin/main a2b9762 (275,630 draw calls, 1b18adf9…). Cache keys `reel-data.js`, `reel-maker.js` → `20261119-reels-fmt`. Suite at the 7 baseline failures.
### 2026-11-18 — Reels Studio data formats, Phase 1 Agent A: game data, archive, frame pick, director (branch feature/reels-fmt-data)
- Status: `[committed on feature/reels-fmt-data — not pushed]`. Server + pure modules only; no UI, no migration. Contract §2/§3 shapes kept (additive fields only).
- New `netlify/functions/_reel-games.js` (ESPN public site API, no key, UA `FrameUp-Reels/1.0`; a UA with a URL in it gets 403 from ESPN's edge): `games` (live / recent 48 h / date; drama-sorted, null last; warms ≤ 6 digests per list in a 4.5 s budget), `game-data` (GameDigest per §3.2; golden fixture byte-identical; schema-checked, soft fail `data-unavailable`), `athlete` (search with a retired-player top-up, career stats). Caches: list 15 s live / 60 s, digest 20 s live / 2 min fresh final / 7 d final, athlete 24 h; one fetch in flight per URL; 30/min per-user limiter. MLB StatsAPI fallback behind `REELS_DATA_MLB_STATSAPI=fallback` (needs `gamePk`), CFBD stubbed off. Optional `clips:true` on game-data returns clip-library matches.
- New `netlify/functions/_reel-archive.js`: ES MCP `query_articles`, one call per career year in the ES era (≤ 8, newest first, pageview-ranked), ES-pool photos (image-cdn only), code-built moments that cite `src:`/`stat:`; `verifyCandidates` drops uncited moments and any number or year not in the cited source. $0 AI.
- New `netlify/functions/_reel-frame-pick.js`: one vision call (Gemini 3.5 Flash-Lite, `REELS_FRAME_PICK_MODEL`, Haiku 5.5 fallback), ~$0.0016/run, $0.02 cap, 7-day hash cache, logged `reels-frame-pick`, code pick when AI is off / capped / invalid.
- New `reel-data.js` (UMD, pure): `dramaScore`, `wpSpark`, `keyPlays`, `scorebugAt`, `matchClipToPlay` (1–15 min + team handle or player name; unsure → photo), `planFromGame` / `planFromArchive` / `planFromReplay` (beats with refs, slides), `archiveFacts`. Not loaded by any page yet (Agent C adds the script tag).
- `_reel-director.js`: `runDataDirector` (code plan + one optional Haiku copy pass that may only change words; numbers checked against the facts), `readDataInput` (re-validates digests, re-verifies archive moments). `reel-maker.js`: `FORMAT_MODES[*].run` set; `plan` with a data format + its data hands off to `dataPlan`.
- Digest size: a full NFL game does not fit 30 plays + 120 WP points in 8 KB; `fitDigest` keeps ≥ 60 WP points and drops period-end-only / swing-only plays first (flagged for the contract owner).
- Tests: new `test-reel-games.mjs` (15), `test-reel-data.mjs` (16), `test-reel-archive.mjs` (11); real trimmed fixtures added (full NFL summary 401873063, MLB summary 401908046, NFL scoreboard, Mahomes athlete). The frozen `test-reels-formats-core.mjs` still asserts the 501 stubs, so it fails until the integrator applies the prepared patch; otherwise the 7 baseline failures.
### 2026-11-18 — Reels Studio data formats, Phase 1 (B): render, styles, export, lint (branch feature/reels-fmt-render)
- Status: `[committed on feature/reels-fmt-render — not pushed]`. Owner files only (contract §6 B). No env var, no migration, no AI call. News reels render byte-identically (contract §8 hash check, HEAD vs branch: 275,630 draw calls, same sha256).
- `reel-render.js`: data formats build a v2 timeline (canvas, outputs, data, replay, slides, beat `refs`; A's `holdMs` is the beat's hold, panel captions from `frames[].caption`); a data kind whose data does not resolve degrades to `point`. Draws in all four styles: scorebug (team colours contrast-checked and never purple, scores count up on a scoring play and pulse, possession bar, down & distance or FINAL), game-clock tab (static: never invents seconds), WP band (play beats) and full WP chart (team-coloured areas, line draws on, swing highlighted with a marker and "SF 63%" callout), attribution line whenever WP shows (no attribution, no chart), play card, archive year rail + stat rows (ESPN display strings) + source chip, the 3-panel replay strip (staggered rise, Ken Burns, Classic comic borders and tilt, empty state). 1080x1350 slides via `drawFrame` (ES mark top-right inside 60 px). `provenanceNumbers` / `unbackedNumbers` / `wpOnScreen` for the lint.
- `reel-replay.js` (new): `candidateFrames` (9 = 3 per third from motion, scene change, sharpness), `applyPick` (frame-pick indices; bad answers fall back to the code pick), `pickRequest`, scrubber model (`scrubberModel`/`scrub`/`framesOf`), `panelLayout`, `buildSlides`, browser `sampleSegment` / `grabFrames`.
- `reel-styles.js`: `DATA_LAYOUTS`, element boxes re-stacked (clock tab under the bug's right end, WP band y 472, strip from y 456 clear of the mark), WP line in ink.
- `reel-export.js`: `renderStills` / `exportStills` (PNG slides zipped with `frameup-zip.js`). Reel export unchanged.
- `reel-lint.js`: v2-only rules `data-numbers`, `data-attribution`, `archive-cite`, `archive-date`, `asset-host`, `replay-real-frames`, `scorebug-clear`, `paid-league-footage` (warning); `lintSlides`. A v2 beat's own refs back its numbers.
- Tests: new `scripts/test-reel-replay.mjs` (8); render +9, lint +10, styles +1. Full suite: only the 7 baseline failures.
- For C: load `reel-timeline.js` and `reel-replay.js` before `reel-render.js`; put the full-size frames in `env.images['frame:<role>']` (`ReelReplay.grabFrames`) and archive photos as assets `photo:<id>`.
### 2026-11-18 — Reels Studio data formats, Phase 1 (C): gallery, source step, data review, carousel export (branch feature/reels-fmt-ui)
- Status: `[committed on feature/reels-fmt-ui — not pushed]`. Contract: `project-docs/reels-formats-contract.md` §5/§6 C. No new env var, no migration, no server change.
- New `reel-gallery.js` (UMD, pure): gallery model (news row + data row; "Coming soon" from `config.formatModes`: Game Swing needs games + game-data, Archive needs athlete + archive-research, Replay always ready with the free code pick), tile/entry HTML, game rows (sort live → drama desc → unknown last, swing badge, WP sparkline, logos from the FrameUp logo library), player rows, ESPN id/link parser, clip link parser, code frame pick, frame-pick index check, briefs built only from the data.
- `reel-maker.html/js/css`: "Start from data" strip on the Story step + full-width format gallery (beside the trend path; a news tile returns to the old Story state). Source step per kind: game picker (NFL/CFB/MLB, Live now with 30 s refresh, Last 48 h, Search by team or date), player search + ESPN player link/id fallback + angle chips, clip from X link (Video Ads `clip` mode), clip library (Video Ads `library` mode) or ES upload with a rights tick and an in/out trimmer. Story card with key-play ticks / coverage meter / clip summary. Make runs the format's stages (data, frames, script, voice, visuals, build) with per-stage cost notes; a failed data stage offers "Use a brief instead". `plan` gets `digest` / `archive`+`athlete` / `replay`+`captions` (A's hand-off); unticked key plays are dropped from the returned plan. Review: Game Swing linescore + swap-a-play (refs), Replay frame scrubbers + re-pick with AI, Archive moments with cite chips + swap + Sources panel. Preview Reel | Carousel (uses `R.buildSlides` when B lands; explains otherwise). Export: carousel PNG zip via `X.exportStills` (feature-detected), paid-ad league-footage warning, WP attribution line, data cost rows. Projects: `normalizeTimeline` on load; data reels save v2 fields. Script tags: `reel-timeline.js`, `reel-data.js` (A's file, lands on merge), `reel-gallery.js`.
- `assets/reels/formats/*.svg`: 7 preview tiles. `tours/updates.json`: `2026-11-19-reels-fmt-ui`. Test: `scripts/test-reels-gallery-ui.mjs` (20, fixtures + mocked fetch).
- News flow: unchanged code paths (Make, lint input, cost, timeline build all branch only for data formats).
- Wired to A (43f8028) and B (1031f4d) per the integrator: script order `reel-timeline.js`, `reel-replay.js`, `reel-data.js` before `reel-render.js`, `frameup-zip.js` before `reel-export.js`; Replay uses `ReelReplay.sampleSegment/candidateFrames/pickRequest/applyPick/scrubberModel/scrub/grabFrames` (full frames into `env.images['frame:<role>']`), falls back to the built-in code pick when B's file is absent; archive photos are `photo:<id>` assets with rights; carousel = `R.buildSlides(timeline)` + `X.exportStills(slides, { env, R })`. Checked in headless Chrome against a merged copy (C + A's reel-data.js + B's render files) in the scratchpad: all three timelines validate.
### 2026-11-18 — Reels Studio data formats, Phase 0: the shared contract (branch feature/reels-formats)
- Status: `[committed on feature/reels-formats — not pushed]`. Contract: `project-docs/reels-formats-contract.md` (read it before touching any reel-* file on this branch). No UI change, no AI call, no env var, no migration.
- `reel-formats.js`: `gameswing` (Game Swing, ES Analytics Series, game source, reel), `replay` (Moment Replay, ES Classic, clip source, reel + carousel), `archive` (Hall-of-Fame Archive, ES Countdown, player source, reel + carousel) in `FORMATS` (so the four clamp-to-explainer places accept them) but NOT in `FORMAT_IDS` (the picker is unchanged); `DATA_KINDS` play/wpline/moment/panel3 (kept out of `KINDS`), `SLIDE_KINDS`, `suggestDataFormat`, cost lines data / archive / framepick (only when asked), `formatCostOptions`. WP attribution "Win probability: ESPN Analytics". No NBA.
- `reel-styles.js`: `ELEMENTS` registry (scorebug, wpline, clock, playcard, panel3, timeline-node, source-chip, attribution) with reel and 4:5 boxes, per-style token overrides, `elementTokens`, `elementBox`, `drawPlaceholder` stub; `validateStyle` checks element tokens; `suggestStyle` honours a format's default style.
- `reel-flow.js`: unified data flow format → source → story → make (data / frames stages) → review → export; `pick-format`, `set-source` events; news flow untouched.
- New `reel-timeline.js` (UMD): timeline schema v2 (canvas 1080x1920 / 1080x1350, `data.game` GameDigest <= 8 KB, `data.athlete`, `data.archive` with citations, `replay`, `slides`, per-beat `refs`), `normalizeTimeline` (v1-compatible), `validateTimeline`, `validateDigest`, `digestFacts`, `resolveRef`. Not loaded by any page yet.
- `netlify/functions/reel-maker.js`: one `FORMAT_MODES` dispatch table (games, game-data, athlete, archive-research, frame-pick) answering 501 coming-soon until handlers land; gates data / mcp / ai; config gains `dataFormats`, `formatModes`; events `data`, `frames`, `carousel_export`.
- Fixtures `scripts/fixtures/reels/` (trimmed ESPN / MLB samples, a reshaped ESPN NFL summary, a golden digest, response and v2 timeline fixtures). Test `scripts/test-reels-formats-core.mjs` (16). Existing reel tests pass; render output hash-identical to HEAD; full suite at the 7 baseline failures. `reel-maker.html` cache keys for reel-formats / styles / flow → `20261118-reels-formats`.
### 2026-11-19 — Reels Studio: Story step UI, no page header, disclosure headers (branch feature/reels-ui)
- Status: `[committed on feature/reels-ui — not pushed]`. Files: `reel-maker.html/css/js` only (UI), `tours/updates.json` (release note), new `scripts/test-reels-story-ui.mjs`. No render/export/server/flow-logic changes; `reel-flow.js` untouched.
- Page header ("AI Studio" + "Reels Studio") removed; the h1 stays as `.es-sr-only`. `.rm-head` keeps the steps + tour "?" (tour target `#rm-steps` unchanged). Page top padding 32→24, stage height +50px.
- Story step: trend list now lives in `#rm-trendbox` (one bordered scroller) with the league filter as a sticky header (hairline + soft shadow once scrolled; single scrolling row on phones). Compact rows: 40px logo tile, 2-line title, meta + `.es-badge--brand` format tag, quiet 1px blue ring when picked; roving tabindex, arrows/Home/End, focus kept after a pick.
- "Reel about" is a summary card (eyebrow, title, meta, Change / Clear). The chip row became a Settings summary: four tiles Style · Voice · Clips · Format (consistent case), each opens All settings at that section and focuses its control. The fold is now "All settings" (meta: script quality + fact check).
- Make my reel: stays a filled primary while busy (`aria-disabled` + `aria-busy`, not `disabled`, so no outline fallback), spinner + "Making your reel · 2 of 4". Progress is a stepper (done / in progress / to do / skipped / needs a look, joined by a rail, `aria-current="step"`, polite live region); while it runs it replaces the trend list, settings and fold, so it never clips.
- Bugs fixed: the empty sticky footer (`.rm-pane-nav`) covered the panel bottom (its `:has()` matched hidden buttons' children); the picked card stayed visible after switching to Brief; the label reset to "Make my reel" even when AI was off.
- Every `.rm-fold` header (Settings, Revise, Voice, Style, Music, Sources) and the cost fold: inset rounded row (4px from the card edge, radius-chip), subtle tint on hover, chevron rotates when open, ES focus ring. Previously the hover filled edge to edge and hid the card outline.
- Spacing on the 8px grid (pane padding 24, gaps 16/8). Tests: `scripts/test-reels-story-ui.mjs` (10 checks); suite at baseline; tour tests pass.
### 2026-11-19 — Reels Studio output: the real ES logo, best-clip picker with a vision judge, pro motion, muted clip audio (branch feature/reels-quality)
- Status: `[committed on feature/reels-quality, not pushed]`. Audit: `project-docs/hero-audit-reels-quality.md`.
- **Logo** (`reel-render.js`): the ES mark is drawn from the official vector paths (`BRAND`, copied from `assets/brand-logos/essentiallysports-mark.svg`, `brand-logo-blue.svg`, `essentially-golf-wordmark.svg`) at 122x104, top-right of the platform safe zone (x 870, y 288), on every frame, last, never faded; black colourway when what is under it is ES blue (`markVariant`; Classic reads the pixels once per shot). Replaced: Classic's 76x65 top-left bug, the typeset "ES" badge, the scaled 168x143 end-card mark, the typeset "ESSENTIALLYSPORTS". End cards use the official wordmark (417 px; Essentially Golf on golf reels). Headlines wrap short beside the mark (50 px clear space). `logoPlacements(timeline)` + lint rule `logo` (critical: missing, scaled, moved, clear space, non-official file).
- **Styles**: masked word-by-word headline entrances (out-expo), highlight sweep after the word lands, tighter leading, tracked labels/chips, eyebrow tick; beat transitions push (Explainer, 420 ms), wipe with an ink bar (Series, 380 ms), lift + flip (Countdown, 380 ms) with the outgoing beat drawn whole (`frameAt().transition`); Classic headline words rise out of a mask. Count-ups on bar and versus values; dot ring sweeps round with a leader line to its callout; reel team colour on bars / versus chips that name it; ink on light team tiles; soft shade under pictures; cut-out breathes. Finish pass (`drawFinish`): vignette, grain (the page's noise tile), light leaks on dark looks at beat changes only. Captions: 820 px measure (clear of the like/share rail), karaoke pop. The hook headline is composed on frame 0 (the cover). Fake two-colour team "logo" disc removed.
- **Clips** (new `reel-clips.js`, UMD): per-beat ranking (subject from the beat's player/team, recency, resolution/length, source official > league > media), browser sampling (8 seeks: grey 48x27 frames for motion energy, 3 JPEGs at 320 px for the judge), best segment of the beat's length (`clipIn`/`clipOut`, new in `buildTimeline`), no reuse while a fitting clip is free (a reused clip plays another part), 7-day judgement cache per clip URL. Server: new `netlify/functions/_reel-clip-judge.js` + `POST /api/reel-maker {mode:'clip-judge'}` (aiSpendGate + hourly limit, <= 3 clips per call, data-URL images only). Model `google/gemini-3.8-flash` (newest Gateway Flash, $0.75/$3.75 per 1M, ~$0.004 per 3 clips), fallback `anthropic/claude-haiku-5.5`, `REELS_CLIP_JUDGE_MODEL` overrides; cap $0.10 per reel; logged as `reels-clip-judge`; cost line in the estimate. AI off: heuristic only.
- **Clip audio (owner request)**: muted by default in preview and export; "Original clip audio" (Music fold, off) adds each clip's own sound from its trim point at -12 dB, ducked to -26 dB under the voice (`opts.clipAudio`, audio kind `clip`, rights copied from the clip). Music reads `audio-library.json` (va-audio branch, licence `{organic, paid}`) first, then `reels-music.json` (`F.musicTracks`, `F.MUSIC_FILES`); same-origin files with a licence only; upload unchanged.
- Page wiring (`reel-maker.js`, owned by feature/reels-ui): `loadClip` split from `useXClip` (segment assets `clip:x@<in>`), `pickClips` in `fillVisuals`, swap-clip ranked, `clipJudge` cost line + `state.spent.clipJudge`, clip-audio checkbox/decoding/mix offsets, music library loader. `reel-maker.html`: the `rm-clip-audio` checkbox, a `reel-clips.js` script tag, `?v=20261118-reels-quality` on reel-formats/styles/render/lint/clips/maker.
- Env (optional): `REELS_CLIP_JUDGE_MODEL`. No migration. Release note `2026-11-19-reels-quality`.
- Tests: new `scripts/test-reel-quality.mjs` (17); the full suite shows only the 7 baseline failures; `test-tour.mjs` passes.

### 2026-11-19 — Generate v2 integrated: brain + styles + UI on one branch (branch feature/gen-v2)
- Status: `[committed on feature/gen-v2 — not pushed]`. Merges `feature/gen-brain` (a74b96e), `feature/gen-styles` (5968e26), `feature/gen-ui` (3e226e8) with `--no-ff`, then integration fixes.
- **One history**: gen-ui's `History` (`FrameUpCreative.design(id).history`) owns versions. `generate-assistant.js` keeps no private stack when the page hosts the design: every assistant change and `applyImprovement` goes through the host's `setScene(scene, { label })` (one version per change), its undo / redo call the host, its `commit()` is a no-op there, `history(id)` reads the host's. The chat's own Undo / Redo buttons and Cmd-Z handler hide/skip when hosted (the focus view's are the controls). New `FrameUpAssistant.unmount(slot)`; the chat repaints on `frameup:design-changed`.
- **Apply ids**: cards, focus view and assistant read one critique (`card._critique` = `FrameUpAssistant.designCritique(dir.critique, verdict.critique, scene)`, ids `i1..`); quick-check items (`{op:'<fix>'}`) also apply through the assistant (normalised to `{op:'fix',name}`); a failed assistant apply falls back to the free local fix.
- **Server**: `_composer.js` gets gen-styles' integration (Needs from `COMPOSE.NEEDS`, photos for film-strip / photo-mosaic, cut-out guard for trading-card / sticker-collage / stat-tower, PRIORITY derived from archetype `kinds`, `defaultNote` falls back to the archetype's `about`); brief labels ("Story: Story: Bryson…", "Summary:") are stripped before stories are split, so headlines no longer read "STORY: BRYSON…"; `plan.directions[].input` (composer input) so the size switch rebuilds instead of reframing (edits to copy / photo / palette are carried over).
- **Count / cost**: server caps 1-8 (`budgetFor`); the count control shows the assistant engine's `costEstimate(n)` range, and `FrameUpFocus.util.estimateCost` returns its `high` (one source of truth).
- Cache keys `20261119-gen-v2` on generate.html (compose, focus, assistant, creative, creative.css), the focus view's lazy loader, and `es-guidelines.js` in index.html. `package.json`: one `test:generate` key running every generate test.
- Tests: new `scripts/test-gen-v2-integration.mjs`. Full suite: baseline 7 failures only.
### 2026-11-19 — Generate v2 brain: director critique, learning model, AI design assistant (branch feature/gen-brain)
- Status: `[UNCOMMITTED in ds-branches/gen-brain: the commit was blocked by the permission classifier; browser QA not run]`. Contract: scratchpad `gen-v2-contract.md` (agent B).
- **Critique** (`_composer.js`): director JSON and vision judge return `strengths`, `improvements` (each with `fix`: `{op:'fix',name}` free in code, or `{op:'assist',instruction}`) and `nextTime`; free code checks (number without a unit, long headline, missing team logo, photo layouts with no photo). `publicDirection.critique`, judge `verdict.critique`; page merges with `FrameUpAssistant.designCritique(dir.critique, verdict.critique, scene)`.
- **Count 1-8** (default 4): `budgetFor` → 3 candidates up to 4 designs, 2 above; judge takes up to 8 sets (max 16 images); director/judge max tokens scale. `plan.budget`. `FrameUpAssistant.costEstimate(n)` for the UI.
- **Learning model** `netlify/functions/_creative-memory.js`: signals → topic observations (17 topics) per scope (global / archetype / sport / brand) → lessons (deduped by key, evidence decays with a 21-day half-life, active at 1.75), top 6 injected into director and judge prompts; hits / recurrences / hit rate; `adminView`. Storage: new table via migration `20261118130000_frameup_creative_lessons.sql` (team read, writes only via security-definer RPC with capped deltas; Undo note); instance memory before the migration. Exports / picks / thumbs / edits / fixes also go to `frameup_generate_direction_events` (types that fit).
- **Assistant** `netlify/functions/_design-assistant.js` + `generate-assistant.js` (UMD: patch engine + `window.FrameUpAssistant`): local intents free; Haiku (main) first, Sonnet (best) for layout changes; feature `generate-assistant` (aiSpendGate + hourly cap + logUsage; label added in `_ai-gateway.js`). Every op re-checked by `checkScene` + fact check (invented numbers skipped). Undo/redo per design, `frameup:design-changed` events, chat UI mounts into `#gen-assistant-slot`.
- **es-generate.js** modes: `creative-assist`, `creative-signal`, `creative-lessons`; `creative` passes lessons and count ≤ 8; `creative-judge` takes `sport`, injects lessons, learns from the critique.
- **generate-creative.js** (small, grouped): `data-design-id`, `card._critique`, `FrameUpAssistant.register`, export / edit signals, history commits for another / swap / text, `sport` on the judge call. `generate.html`: includes `generate-assistant.js`; cache key `20261118-gen-brain`.
- Tests: `scripts/test-gen-brain.mjs` (in `test:generate`). Full suite: baseline failures only.
### 2026-11-19 — Generate v2 styles: 15 new composition archetypes + pro-level renderer craft (branch feature/gen-styles)
- Status: `[committed on feature/gen-styles — not pushed]`. Contract: scratchpad `gen-v2-contract.md` section A. Samples: scratchpad `gen-v2-out/styles/`.
- **15 new archetypes** in `frameup-compose.js` (29 total, 3 variants each): ES pill headline (the SM-06/07 pill stack over 90% team mist), split-tone versus, trading card (foil sheen, 3D tilt, rim-lit cut-out), broadcast lower-third, newspaper front page (halftone photo), film-strip timeline, neon night game, minimal Swiss grid, oversized quote marks, record-breaker gauge, photo mosaic, sticker collage (die-cut edge), photo in type (knockout), stacked stat tower, game ticket. Every archetype now carries `needs` + `kinds`; `COMPOSE.NEEDS` exported.
- **Renderer craft**: cap-height text boxes (baseline on the box bottom), size-aware tracking, balanced lines, no widows, cap-padded ES highlight pills with equal gaps; gradient maps (duotone / tritone) with levels + S-curve, auto levels, depth blur (Safari-safe fallback, no ctx.filter needed), halftone, fade masks, shape masks, vignette, light leaks, inner shadow, neon glow, rim light, sticker edge, photo-in-type, 3D tilt for any layer; seeded grain (exports are deterministic); treated-photo buffer cache.
- **Contrast**: palette roles (`onAccent`, `inkSoft`, `deep`, `rim`, `tone`) all contrast-checked; render guard measures every text layer (3x3 samples) and recolours on a flat field or lays a feathered scrim over a busy photo below 3:1 (4.5:1 small); pill text that would not read becomes black/white. Fixed a wrap bug where a long non-first word overflowed its box.
- **Gate** (`checkScene`): FX_LIMITS (no blurred subject or type, rim/sticker only on cut-outs, glow/grain/texture/leak/tilt caps, smallest type 22px), mist normalised to exactly 90% (`mist-opacity`), text over an unprotected busy photo gets a shadow (`composed-contrast`). `es-guidelines.js` COMPOSED_RULES: archetype list + `composed-effects`, `composed-contrast`, `composed-mist`.
- **New fixes**: `brighten-photo`, `darken-photo`, `more-depth`, `add-scrim` (judge prompt picks them up via `COMPOSE.FIXES`).
- **Intentional export change** for all 14 existing archetypes: type metrics/tracking/line breaks, mist 90% (was up to 96%), tone curves, kicker pill 58px with team-colour text, contrast guard. Before/after crops in the samples folder.
- `_composer.js` NOT changed (gen-brain owns it): integration notes in scratchpad `gen-v2-out/styles/composer-integration.md` (needs text, photos for film-strip/mosaic, PRIORITY from `kinds`).
- Tests: new `scripts/test-compose-styles.mjs`; `test-generate-creative.mjs` archetype bound 12-20 → 24-40. Cache key `frameup-compose.js?v=20261118-gen-styles` (generate.html).
### 2026-11-19 — Generate v2 UI: one environment (focus view, assistant slot, count, distinct quick rows) (branch feature/gen-ui)
- Status: `[committed on feature/gen-ui — not pushed]`. Contract: scratchpad `gen-v2-contract.md` (agent C, gen-ui). Screenshots: scratchpad `gen-v2-out/gen-ui/`.
- **Design focus view** (new `generate-focus.js`, `<dialog class="gfx">`): click any Creative design. Top bar: back to results, design n of N, prev / next, size switch 4:5 · 9:16 · 1:1, undo / redo, shortcuts, JPG / PNG, Open in editor (only if `FrameUpCompose.openInEditor` exists). Left rail of the run's designs; dotted stage with Fit / 100 % and a layer outline on hover; right panel tabs: **Assistant** (`<section id="gen-assistant-slot" data-design-id>`, `FrameUpAssistant.mount(slot, { getScene, setScene, designId, runId })`, script loaded lazily as `generate-assistant.js`; polite offline state until it exists), **Director** (score + rubric bars, what works, what could be better with Apply, next time), **Layers** (text edits with the digits-are-facts rule, swap photo), **History** (every version, restore adds a version). Keys: ← →, ⌘/Ctrl Z, ⇧⌘Z, 1 2 3, F, E, /, ?, Esc.
- **Every change goes through `commit()`** in `generate-creative.js`: a version in the design's History, card + focus repaint, `frameup:design-changed` (detail `{ designId, scene, label, source, origin:'generate' }`). `setScene` runs `checkScene` first (a patch can't break the ES gate). External `frameup:design-changed` events with a `scene` are recorded too. `window.FrameUpCreative.design(id)` / `.designs()` expose a design to the assistant.
- **Sizes**: rebuilt from `scene.input || dir.input` when the server sends inputs; otherwise `reframe()` (taller: anchored; shorter: scaled inside the safe area). 66/66 test scenes pass `checkScene` at 9:16 and 1:1. Card media follows the design's aspect.
- **Cards**: "Story: Story:" fixed (`cleanStory`); one badge row (layout · On-brand · ★ score); title + story; the director note is a one-line `<details>` that opens to what works / what could be better (Apply → `FrameUpAssistant.applyImprovement(designId, id)`, else the composer's built-in fix, else Ask AI) / next time; one labelled toolbar (Open, Shuffle, Photo, Text, PNG, JPG) with tooltips. Critique read from `verdict.critique || dir.critique || scene.critique`; until B ships it, the free quick check's issues show as improvements.
- **Number of designs**: 1 / 2 / 4 / 6 / 8 control in the action bar with the estimated cost per choice (hover previews); `count` sent on Creative and ES templates runs (templates capped at 4). Remembered per browser.
- **Trending / Recent / Try** (generate.html): Trending = outlined live chips with league logo, a rising dot (search trend / traffic) and freshness; Recent = compact list with age and Run again (+ Clear; storage `frameup.generate.recent.v2`, v1 migrated); Try = format cards with the template art (ES templates look also selects that format). Each row is a `<details>`; on phones Recent and Try start closed. Fixes the clipped TRENDING label (no fixed 72px label column).
- **Spacing**: 8px grid pass (steer chips 2+32+2, grid gap 24, found chips, note text 13px).
- Tests: new `scripts/test-gen-ui.mjs` (in `test:generate`). Release note `2026-11-19-gen-ui`. Cache key `20261118-gen-ui` (generate-focus.js, generate-creative.js/.css).
### 2026-11-19 — Trends board UI pass: compact rows, fixed action slots, tidy toolbar (branch feature/trends-ui)
- Status: `[committed on feature/trends-ui — not pushed]`. Asked by Suhail ("please fix this UI", list and cards screenshots). Audit: `project-docs/hero-audit-trends-ui.md`.
- **Rows (cards + list, one markup):** title first (2-line clamp), one meta line (Hot/Rising, Google volume, source, age, sources), storyline as an inline "N more" toggle (list opens below), why-now stats in secondary ink. Card media 96px (was 112), list tile 40px; crests/wordmarks shown whole (`TrendsLogic.isLogoImage`, Wikipedia SVG/"logo" files) on a padded white tile. No always-on gradient rim (`ais-card` dropped): quiet border, hover lift, blue ring only for the open kit, focus ring for keyboard focus.
- **Actions:** Design post + five icon buttons in fixed slots, same order everywhere (`TrendsLogic.rowActions`): Post kit, Reel, Video ad, Shortlist, Read. Video ad stays in its slot, disabled with the reason, for non-NFL/CFB/MLB; tooltips (`data-tip`) with the shortcut. Labels show on wide cards and fold into tooltips when narrow; "⋯" menu (role=menu, arrows/Home/End/Esc) holds Reel/Video/Read (and Shortlist on phones). Container queries on `.trends-list`, so it follows the column, not the window.
- **Headline ideas:** hidden until they exist; a ghost "Headline ideas" button asks (same `[data-ai]` path, no new AI call site); then 3 compact rows with copy. Quick (rule) ideas only after AI says limited/off/error. Post kit unchanged.
- **Toolbar:** status + counts left; newsletter, layout toggle + shortcuts (now one group), AI angles and Refresh (both secondary) at 40px; labels fold to icon+tooltip below 860px of toolbar width. Phone: status + AI/Refresh/help, then newsletter + layout, then counts.
- **Chips:** light 12px counts, no separator; Shortlist is a normal filter chip with a bookmark (count only when > 0); right-edge fade where they scroll. **Headings:** ES section-title scale (15/700, sentence case), "See all" never clipped.
- `generate.html`: only the three `?v=` cache keys (trends.css, trends-logic.js, trends-view.js → `20261118-trends-ui`). Toolbar class tweaks are done from trends-view.js so the shared markup stays with gen-ui.
- Tests: `scripts/test-trends-hero.mjs` +3 checks (row actions, logo detection, UI wiring). Suite at baseline. Release note `2026-11-19-trends-ui`.
### 2026-11-19 — Home "Today" becomes mission control (branch feature/home-today)
- Status: `[committed on feature/home-today — not pushed]`. Audit: `project-docs/hero-audit-home-today.md`.
- `frameup-home-today.js` rewritten (same UMD shape, same sessionStorage caching, cache prefix now `frameup.home.v2.`): **Start here** (top story by `TrendsLogic.topPicks`, why-now line, suggested template, Make a post / Make a reel / Video ad using Trends' own hand-offs `briefFor` / `reelHandoff` / `videoHandoff`, Generate always `autorun=0`); **Create** launchers (Generate, Reels Studio, Video Ads, Editor) with continue hints read from this browser (`frameup.generate.recent.v1`, `frameup.reels.projects.v1`, `frameup.videoAds.brandDefaults.v1`, latest editor draft); **Trending now** (sport chips, sport label, Hot/Rising, age, outlets, 2-line titles linking to the story, Post / Reel / Ad per row); **Continue where you left off** (designs exported on this browser with thumbnails via `FrameUpDesigns.listLocal` + open in place via `openDesign`, `frameup_drafts` rows, Reels Studio projects; replaces the separate "Jump back in" section, removed from index.html); **Team exports** (10 Gallery posts with title / who / when, variant on hover); **Team this week** (posts per day for 7 days, top formats, most active, your count + streak; counted from the same single Gallery read, now `limit: 48`, shown as "48+" when the page is cut inside the week).
- Requests: card kept but `hidden`, only shown when `FrameUpFeatures.requests === true`; no Request-a-design launcher.
- No new endpoints, no AI calls, no new paid services, no migrations, no env vars. Requests on Home: trend-design (cached), one Gallery RPC + signed thumbs (as before, larger page), frameup_drafts (as before).
- `frameup-home-today.css` rewritten: local `--ht-*` tokens with dark overrides, container queries (`today` and `card`), skeleton / empty / error per card, reduced-motion.
- index.html: home section markup only; loads `trends-logic.js` (unchanged file) before the home script; cache keys `frameup-home-today.{js,css}?v=20261119-home`, `tours/tours.js?v=20261119-home` (index.html only).
- Server: `netlify/functions/trend-design.js` `classify()` — a college name with another sport word (basketball, hockey, …) and no football word goes to Others with score ≥ 6 ("Notre Dame Basketball" was College Football). Cases added to `scripts/test-trend-design.mjs`.
- Tests: new `scripts/test-home-today.mjs`; `scripts/test-hero-workflow.mjs` card ids updated. Release note `2026-11-19-home-today`; tour "Today" step text updated.
### 2026-11-20 — Editor inspector: selection-first right panel, one control style (branch `feature/inspector`)
- Status: `[committed on feature/inspector — not pushed]`. Research: `project-docs/inspector-research.md` (Figma, Canva, Adobe Express, Framer, Webflow, Kittl, Photoshop, Sketch, Linear / Notion, Material 3, Apple HIG; cited). Audit: `project-docs/hero-audit-inspector.md`.
- **Files:** new section at the end of `studio-inspector.css` ("Inspector redesign"; already render-blocking in the head, so no new request before first paint; rules win on specificity `html…:root body .app[data-workspace] > .panel`) + new `frameup-inspector.js` (deferred, after `frameup-editor-ui.js`; first pass after `load`). Cache key `20261118-inspector` on both.
- **Selection first:** strip under Export: "Whole design · <template>" or the selected layer (multi: "N layers selected"). Picking a layer (Layers panel or canvas) opens its section via `ESOpenStudioSection`, scrolls to it, marks it "Selected" (`data-fi-active`) and flashes it (no flash with reduced motion). Reads `FrameUpEditorUI.selectedLayers()` through a MutationObserver on `#layers-panel`; editor-ui unchanged.
- **One look:** every block starts with a 16px Lucide icon + 11px caps title (Template, Content, Text placement, Brand & colours, Photo layers, Photo, ES Image Pool, widget sections); 12px/500 labels, 36px controls with a 10px radius, 12px help text; toggles are label-left/switch-right with no box; YouTube Layout chips and the stat count are one grey-track segmented control (white pill selected); 40px swatches and logo tiles with a quiet blue ring; dashed empty photo drop area; collapse all / expand all.
- **Width:** 370px at 1280+, 320px below (was 370 everywhere); drag the left edge or ←/→ on it (300–440, `frameup.inspector.width`, double-click resets). Grid overrides use `var(--fi-w-user, var(--fi-w))`; editor-ui's canvas bar re-measures on the resize event.
- **Keyboard:** ↑/↓/Home/End between section titles; the resize edge is a focusable separator with aria-valuenow. **Scrub:** drag the X / Y / Zoom labels (Shift ×10); dispatches the same `input` events typing does.
- **Phone:** the existing bottom sheet stays; fields grow to 44px with 16px text; the strip and Photo title hide.
- index.html: only the two include lines. Tour: Inspector step text; `tours/tours.js` key bumped on 11 pages (not reel-maker.html). Release note `2026-11-20-inspector`.
- Not touched: Listicle Type 2 (`#listicle-type2-fields`) and infographic (`#infographic-fields`) are excluded in the CSS; no JS reference to them.
- **Exports byte-identical:** 20 cases (8 Social incl. a selected-layer + resized-panel case, 5 YouTube, 7 Newsletter incl. 2 widget HTMLs), seeded `Math.random`, before = `1503d36`. Note: `instagram/stats-single-ent` is not deterministic on the base commit itself (three different hashes across base-only runs, async logo load); in paired reruns base and branch give the same hash.
- **Speed** (4× CPU, 7-run medians, both served the same way): FCP Social 456 → 456 ms, Newsletter 432 → 432 / 408 → 416, YouTube 480 → 480 / 460 → 472 (run-to-run noise ±12 ms); longest task and TBT unchanged or lower.
- Tests: `scripts/test-inspector.mjs`. No AI, no migration, no env vars.
### 2026-11-19 — Generate asset service: AI backgrounds and concept art, cut-outs, varied ES photos (branch feature/gen-assets)
- Status: `[committed on feature/gen-assets — not pushed]`. Spec: `scratchpad/gen-creative-contract.md` (agent gen-assets). Docs: `project-docs/gen-assets.md`.
- New `netlify/functions/_asset-service.js` (`generateBackground`, `generateConceptArt`, `cutout`, `findPhotos`, `status`), `netlify/functions/gen-assets.js` + `api/gen-assets.js` (`GET/POST /api/gen-assets`, vercel.json maxDuration 60), browser client `frameup-assets.js` (`window.FrameUpAssets`, not loaded by any page yet: the gen-creative composer loads it).
- Models from the live Gateway list: photo `bfl/flux-3-image` ($0.048), illustration `recraft/recraft-v4.1` ($0.035), texture `bfl/flux-3-image-klein` ($0.009), abstract `recraft/recraft-v4.1-flash` ($0.007), concept `google/gemini-nano-banana-2.1` ($0.0336); economy/fallback klein.
- Never people: prompt sanitiser (names, brands, numbers, person words, action verbs) + no-people/no-marks clauses + a Haiku vision check on every image (one retry, then refused). Image-to-image only from our own backgrounds.
- Cut-outs keep the original pixels (mask alpha only, frameup-cutout.js checks); masks never stored. Small export added to `remove-bg.js` (`removeBackgroundMask`) and `es-image-search.js` (`_internals`).
- findPhotos: ES agency + article + media, de-duplicated (sizes, crops, bursts, already used), vision-ranked, varied by kind.
- Storage: existing public bucket `frameup-links`, prefix `gen-assets/<input hash>`, immutable cache; HEAD before generating. No migration.
- Tests: `scripts/test-gen-assets.mjs` (added to `test:generate`).
### 2026-11-19 — Generate: the Creative look (composed, art-directed designs) (branch feature/gen-creative)
- Status: `[committed on feature/gen-creative — not pushed]`. Contract: scratchpad `gen-creative-contract.md`. Audit: `project-docs/hero-audit-gen-creative.md`.
- **Composer** `frameup-compose.js` (UMD, new): 14 composition archetypes (hero cut-out + giant number, prize focus, big number, split screen, magazine cover, scoreboard, by the numbers, compare bars, quote + portrait, typographic, name + collage strip, duotone hero, record badge, unit chart), each with 3 variants; scene spec (background / photo / cutout / text / number / shape / logo / chart / pill, fx shadow / glow / opacity / blend / rotate); palettes from team / league / ES golf kit colours; canvas renderer (preview and 1080 export, crisp at any scale); ES vector art (trophy, golf ball, football, basketball, lights, cards, money) as the free stand-in for AI concept art.
- **ES gate for composed designs** `checkScene`: ES fonts only, no stroke / outline, palette colours only (snaps), no free ES logo layer (the renderer draws the mark top-right 122x104, 50px in, black over ES blue), safe area + logo clear space, every number a fact, unit charts backed by a fact. Rules listed as `COMPOSED_RULES` in `es-guidelines.js` (template rules untouched).
- **Server** `netlify/functions/_composer.js` (new): stories + facts from the brief (money, counts, scores, records, compares, quotes, speakers, leagues vs teams), photos per person / team (asset service `findPhotos`, else ES search), cut-outs and concept art via `_asset-service.js` when present (required defensively; none = ES photos + vector art), one Sonnet art-director call (feature `generate-creative-director`), `validateDirections` (story, archetype fit, digits from facts, off-brief names need a cited ES story, unique archetype / photo, team photos never cut out, per-fact labels), code plan fills gaps (and is the no-AI floor), 2-3 candidate scenes per direction, plan cache 10 min. `judge`: one Sonnet vision call over the page's small JPEGs (feature `generate-creative-judge`), rubric hierarchy / focal / readability / brand / originality, pick + one whitelisted fix + specific note, cache 30 min, heuristic fallback with no key.
- **es-generate.js**: `mode:'creative'` (spend gate feature `generate-creative`, hourly cap) and `mode:'creative-judge'` (spend gate). `_ai-gateway.js`: feature name "Creative designs" (AI_DISABLE=generate-creative switches it off).
- **Page**: `generate-creative.js` + `generate-creative.css` (new). "Look: Creative | ES templates" in the steer row (remembered per browser; Creative hides formats and Directions first). Cards: big preview, archetype, name, story, director note, score, On-brand, cited source, Try another composition, Swap photo, Edit text (digits must be facts), PNG / JPEG 1080 download recorded via `recordDesignExport` + Posted-it card + events. Summary shows compositions judged and the run cost. "Ideas left out by the fact check" lists dropped ideas (e.g. the LIV angle). `generate.html`: includes, a 6-line hand-off in `generate()`, `window.FrameUpGenerate` bridge.
- **Not built (next phase)**: layer editor (move / resize) and Open in editor for composed designs; exports are PNG / JPEG only.
- Cost per Creative run (est.): director ~$0.008, vision judge ~$0.011 (12 renders at 360px), assets with gen-assets $0.05-0.20 (cut-outs + 1-2 concept images) → ~$0.07-0.23.
- Tests: `scripts/test-generate-creative.mjs` (in `test:generate`). Release note `2026-11-19-gen-creative`. Cache key `20261118-gen-creative`.

### 2026-11-19 — Generate hero round: stat lines, records, carousels, no blank photos (branch feature/hero-generate)
- Status: `[committed on feature/hero-generate — not pushed; browser QA NOT run (preview server limit)]`
- Audit: `project-docs/hero-audit-hero-generate.md`.
- **New formats:** Player Stat Line and Team Record / Score in Generate (steps in `templates-player-stat-line.md`):
  `es-generate.js` TEMPLATES/checkFields/prompt rules/gold example, `_creative-director.js` POST_TYPES, STATS_TYPES,
  fits (3+ stats; a stated record + team), `_lint-spec.js` fields, `_generate-examples.js`, `_onbrand.js`,
  `_direction-memory.js`, `es-guidelines.js` (TEMPLATES, mapSlides: score → Team Record, 4+ stats → Player Stat Line),
  `frameup-spec.js` (SUPPORTED, applyStatTemplate, waits for the team logo), two format cards on `generate.html`.
- **Number accuracy:** `_lint-spec.js` stat-pair check (`stat-mismatch`): a value must keep the label the brief gives it;
  spelled-out labels accepted for Player Stat Line; a Team Record must be stated in the brief/research.
- **Never a blank photo:** `frameup-spec.js` draws a team graphic (team colour + library logo) when there is no ES photo;
  `renderWithInfo` tells the page; with no team, the photo panel opens and runs an ES photo search.
  New `mode: 'photos'` on `/api/es-generate` (no AI, no spend gate).
- **Same idea, new template:** Refine lists the other formats the brief fits; one click makes that design on the card's direction.
- **Carousel set bar:** Open as carousel (fills empty editor carousel slides, never overwrites) and Download all (.zip,
  numbered, same export path and quality as single downloads) via `FrameUpSpec.exportSet` + `frameup-zip.js`.
- **Keyboard:** `/` brief, `1`–`4` pick directions, Ctrl/⌘ + Enter make. Live trends make posts in one click; more trends become quick chips.
- **Cost:** photo-pick vision result cached 30 min, ES MCP image search 15 min (per warm instance).
- Intentional export change: a design with no ES photo now exports with the team graphic instead of the empty dark background.
- Cache key: `frameup-spec.js?v=20261118-hero-generate` (index.html). Release note `2026-11-19-hero-generate`.
- Tests: new `scripts/test-generate-hero.mjs` (in `test:generate`); photo caches are cleared per request in two existing tests.

### 2026-11-18 — Trends becomes the morning board: Post now, storylines, post kit (branch `feature/hero-trends`)
- Status: `[committed on feature/hero-trends, not pushed]`
- Audit: `project-docs/hero-audit-trends.md` (one real feed walked as a social editor).
- **Server** (`netlify/functions/trend-design.js`, all additive to the feed):
  - **Storylines**: stories in one sport sharing a person, team or running story ("Bryson DeChambeau", "Power rankings") get `storyline {id,label,size,lead}`; leads rank up to 1.6× by size; `storylines[]` in the reply.
  - **Signals**: `signal: 'hot' | 'rising'` (50K+ searches / 6+ outlets in 12 h; more outlets than the last build, or 2+ outlets within 3 h). Leads only. Rules, no AI.
  - **ES fit**: `fit {score 0-100, brand}` (The Huddle / Essentially CFB / ES Dugout from `video-ads-brands.js`); `brands[]` in the reply.
  - **Post kit, free half**: `template {id,label,why}` (Generate format ids: cover / quote / long-quote / stats-single-ent / listicle-type-2) and `photo {query,kind}` (Wikipedia-confirmed subject, star list, two-word name, team, storyline).
  - **AI** (`mode:'enrich'`, light tier, batched, unchanged contract + `hook`): ES-voice prompt, adds a reel hook; every number in AI copy must be in the story and clickbait words are dropped (`grounded`); cache 45 min → 6 h (ids are content hashes).
  - Quality: quick ideas reject source names, bare names and dependent fragments; noise filter drops TV listings, photo galleries, video games, expert picks; classifier knows QB and more coaches/players; Wikipedia images must match the asked name (no more "Saved game" for "Chad Ramey Saves").
- **Page**: the Trends script and CSS moved out of `generate.html` into `trends-view.js`, `trends-logic.js` (UMD, pure) and `trends.css` (the Generate view is untouched; the toolbar markup changed).
  - **Post now** (top 5 across sports, one per storyline, max 2 per sport, "why now" line), then each sport with storylines folded under their lead.
  - **Post kit** per card (button or P): 3 headlines (AI or quick ideas; copy / use), template with its thumbnail and "Design as …" (selects Generate's format card), photo query + team logo, reel hook + **Make a reel** (`frameup.reelMoment.v1` + `?moment=&sport=&team=&trend=`), video ad moment + brand, **Copy kit**.
  - Newsletter filter, Cards / compact list toggle (remembered), Hot / Rising badges, age colours, keyboard (J/K, P, D, R, V, S, C, O, ?), "Saved" → **Shortlist** (same storage key) with Copy list / Clear + Undo.
  - **AI cost**: no AI on load (unchanged) and **no AI on hover/focus any more**; only an opened kit (1 story), a card's AI angles, or the toolbar (≤6 stories, picks first). Browser cache sessionStorage → localStorage 6 h.
- Tours: Trends tour steps updated (Post now, Post kit); `tours/tours.js` key bumped to `20261118-hero-trends` on 11 pages (not `reel-maker.html`, owned by the Reels branch). Release note `2026-11-19-hero-trends`.
- Tests: `scripts/test-trends-hero.mjs` (18 checks, chained into `npm run test:trend-design`). No migration, no new env vars.
### 2026-11-19 — Editor UI: Layers panel rebuilt, canvas bar, safe zones, slide tools (branch `feature/editor-ui`)
- Status: `[committed on feature/editor-ui, not pushed]` (built on `feature/hero-editor`)
- Audit: `project-docs/hero-audit-editor-ui.md`.
- **New** `frameup-editor-ui.js` + `.css` (loaded last in index.html; the CSS sits at the end of the body so it never
  blocks first paint; the script waits for `load` and runs its first pass in idle steps).
- **Layers panel** (Cover and now standard YouTube thumbnails): type icon / photo thumbnail / "Aa" in the pill colours,
  a content line, double-click / Enter / F2 rename (stored in the existing `label`), click / Shift / ⌘ selection with a
  DOM outline on the canvas and canvas-click selects the layer, drag with a drop line, ⌘[ ⌘] and ⌘⇧[ ⌘⇧], Alt+↑/↓,
  H / L, filter from 7 rows, background row expands (team fade, YouTube player cut-outs), resizable 200–360 px
  (`frameup.layers.width`), collapsed per workspace (`frameup.layers.collapsed.<ws>`; rail by default below 1280 px,
  and on YouTube below 1440 px). Phones: layers in the More sheet. Reorders go through `applyOrder` on the same
  `state.coverLayers` array, so undo, autosave and saved drafts are unchanged.
- **index.html (surgical):** `isCoverLayersPanelActive` includes YouTube (not Quote Mode); `renderLayersPanelRows`
  delegates once `FrameUpEditorUI.ready`; inline list handlers yield to it; `_render` fires `frameup:rendered`;
  `getExportIssues` appends `FrameUpEditorUI.exportIssues()` (headline under the YouTube timestamp);
  `moveInstagramSlide` / `duplicateInstagramSlide` / `clearInstagramSlide` (swap / clone with `cloneDesignValue` /
  reset keeping the template); `window.FrameUpEditorBridge` (read-only getters for let/const state).
- **Canvas bar** next to Undo / save chip on all three workspaces: template · size chip (opens the picker; YouTube
  jumps to Layout), Safe zones (YouTube timestamp corner, Instagram 3:4 grid crop, ES 50 px margin; red dot when the
  headline hits the timestamp), Small size on YouTube (246 / 168 px previews). Phone header kicker says the template
  and size; the phone Export says Copy HTML on widgets.
- **Newsletter:** "Copy image link", a hint under the buttons (what you get, where to paste), labels on widget fields.
- **Carousel:** ⋯ menu next to the slide numbers: Duplicate to next empty slide, Move left / right, Clear (undoable).
- Shortcuts sheet (`frameup-extras.js`): Shift+1 fit, layer keys, rename. Editor tour: Layers text, new Format and
  safe zones step. Release note `2026-11-19-editor-ui`. `tours/tours.js` cache key bumped on every page that loads
  it (not reel-maker.html: Reels Studio belongs to another branch).
- **Exports byte-identical:** 15 cases across the three workspaces (incl. a reordered / hidden-layer Cover and two
  widget HTMLs), seeded `Math.random`, hashes equal before and after.
- **Speed** (4× CPU, warm, 7-run median, both sides served the same way): FCP 432 → 432 ms (Instagram, YouTube),
  DCL and longest task unchanged, TBT +8 ms. Newsletter FCP 396 → 400 ms.
- No Listicle Type 2 / infographic code touched. No AI, no migration, no env vars.
- Tests: `scripts/test-editor-ui.mjs`.
### 2026-11-18 — Editor hero: save chip, Best for this story, Brand check, pills stay on canvas (branch `feature/hero-editor`)
- Status: `[committed on feature/hero-editor, not pushed]`
- Audit: `project-docs/hero-audit-editor.md`.
- **Save chip** (`frameup-editor-assist.js` + `.css`, new): next to Undo / Redo: Saving…, Saved, Syncing…, Synced,
  Offline, Saved here, Couldn't save (with a toast). Click = Recent designs / drafts. Ctrl/⌘+S saves now (autosave
  `saveNow` + cloud `flush`). `frameup-autosave.js` now fires `frameup:autosave-state` and exposes `status()`;
  `frameup-cloud-drafts.js` fires `frameup:cloud-status` and exposes `statusText()`. A failed local save used to be
  silent.
- **Brand check**: `getExportIssues()` in index.html appends `FrameUpEditorAssist.exportIssues({workspace, state})`:
  the ES headline font failed or is loading (fix: Load the font), banned copy from `frameup-rules.js` BANNED (quotes:
  format rules only; tweets: none), Cover lines below FIT.cover minSize (84px). Sources from `es-guidelines.js`.
  Never blocks; the dialog intro reads "doesn't quite match the ES guidelines" / "Check these first".
  index.html now loads `frameup-rules.js` and `es-guidelines.js`.
- **Template picker** (`frameup-templates.js`): "best for" line per template, keyword search with word-prefix
  matching, **Best for this story** (reads the Cover headline or a 3+ word search; `suggestTemplates`, pure
  regex, no AI), **Recent** (per workspace, localStorage `frameup.templates.recent.<ws>`), arrow-key grid
  navigation, T opens it. Shortcut sheet and ⌘K list Save now and Browse templates (`frameup-extras.js`).
- **Pill fix (deliberate export change)**: `drawPills` used to pin an over-wide staggered group to the left, so the
  last pill ran off the right edge. Now each pill is clamped inside the safe area, only in that case. All other
  exports are byte-identical.
- No Listicle Type 2 code touched. No AI, no migration, no env vars.
- Tests: `scripts/test-editor-assist.mjs`. Release note `2026-11-19-hero-editor`.
### 2026-11-19 — Team workflow heroes: Today on Home, Gallery filters, request next steps, Needs attention (branch feature/hero-workflow)
- Status: `[committed on feature/hero-workflow - not pushed]`
- Audit: `project-docs/hero-audit-hero-workflow.md`.
- **Home → Today** (`frameup-home-today.js` + `.css`, one section added inside the Home `<main>` of index.html; editor untouched). It has quick actions (Generate, Video Ads, Reels Studio, Request a design) and four cards:
  - Trending now: free `GET /api/trend-design`, sport chips remembered per browser, and "Design this" opens Generate with `autorun=0`.
  - My requests: open requests I filed or am assigned, overdue first.
  - Team exports: Gallery RPC, 6 thumbnails.
  - My drafts: `frameup_drafts`; the button opens the existing drafts dialog.
  It loads after first paint, only on Home, with session caches of 2–10 min.
- **Gallery** (`frameup-gallery-query.js`):
  - every-word search, a Created-by select, and Posted / Not posted yet chips;
  - filters in the URL (`?q=&ws=&type=&by=&posted=`), Clear filters, `/` to search;
  - "Make another like this" in the viewer: Generate with a brief from the post's own fields, `autorun=0`.
- **Requests:** `request-lifecycle.js` `nextStep()` drives a "Next step" bar (claim / assign / start / attach / send for review / mark done / ask for a change) and a "Your move" badge in the list. Also added: Due soon, Up/Down keys, and a refresh when you return to the tab after 60 s or more. "Save changes" is now secondary.
- **Dashboard → Overview → Needs attention** (`dashboard-insights.js` + `.css`): overdue, unassigned, due in 24 h, stuck in review, pending access, bug reports, error spikes, export swings (only with enough volume) and quiet regulars. All counts come from data already loaded.
- **Sidebar:** NEW tags come from each item's `added` date (14 days). Generate and Gallery lost theirs; My requests gained one.
- **Performance:** the presence heartbeat is throttled (8 → 2 writes in the first 6 s of a page view). Dashboard live sync no longer repeats the presence upsert, and has a 10 s minimum gap.
- **Tours:** the welcome tour mentions Today, reels, My requests and Needs attention. Release note `2026-11-19-hero-workflow` added.
- Cache keys `20261118-hero-workflow`: app-shell, dashboard-data, request-lifecycle, requests.js/css and tours.js on every page **except reel-maker.html** (owned by the Reels branch; bump it at release).
- Tests: `scripts/test-hero-workflow.mjs` (22).
### 2026-11-18 — Video Ads hero pass: today's ad set, check before export, Meta placements (branch `feature/hero-video-ads`)
- Status: `[committed on feature/hero-video-ads — not pushed; migration NOT applied]`
- Audit: `project-docs/hero-audit-video-ads.md`.
- **Owner decisions (Suhail, 2026-11-18):** Stat Card and Quote Card removed everywhere (picker, suggestion, Ask AI
  fields, renderer, server checks, rating prompt v1.2.0, learning ranking skips their old exports, tests, CSS);
  unknown/removed styles fall back to Highlight (`VideoAdsBrands.styleOr`). Copyrighted clips may run in Meta paid
  ads: the rights tick is now an optional reminder ("I have the rights to use this footage") and never blocks;
  the source URL and the tick are logged with each export. The empty preview is plain #000 until a clip, photo
  or the animated background is chosen.
- **Make my daily set** (Copy step): one Haiku call (`mode:'copy', set:true`) writes 3 angles in mixed styles;
  `planDailySet` keeps each in a style it can fill. Review grid: live 9:16 / 4:5 / 1:1 thumbnails per angle, the
  free rubric checks, a style picker, Include, Edit (edits save back into the angle). No brief yet: uses today's top
  trend for the brand's sport. AI down: "Use my copy in 3 styles instead". Export: "Today's set / This ad only";
  every angle × size records in **one** real-time pass, named `{brand}_{style}_a{n}_{WxH}_{date}`.
- **Check before you export** (on demand): `preflight()` — background, readiness, fit, small text (55+), safe zone,
  unsubscribe, plus `copyChecks()` (clear free offer, readability, trust, sign-up button) — each with a one-click fix
  (or "Shorten / Calm it with AI"). Optional "Get an AI score" uses the existing `/api/ad-rating` (Haiku vision,
  cached system prompt) with 3 frames; same ad again in the session is free. Fixes go to Ask AI.
- **Meta preview**: Feed / Story / Reels for any size; 9:16 in the feed shows the 4:5 crop, 4:5 / 1:1 in Stories or
  Reels sit on a blurred fill; a note says what to export instead.
- **Per-brand defaults** (localStorage `frameup.videoAds.brandDefaults.v1`): last newsletter, style, sizes, safe zone,
  tint, button, unsubscribe, placement; "Reset" in the toast.
- **AI quality/cost**: `COPY_SYSTEM` rewritten around the rating rubric and marked cacheable (≥1,024 chars); chat uses
  the same static cached system prompt with the ad's context in the first turn; copy responses cached 10 min (skips
  gates); variants ranked by `copyChecks`; grammar moved from gpt-oss (light) to Haiku (main) — "Haiku only".
  Unapproved Us vs Them claims are never suggested first.
- **Claims admin**: `claims` / `save-claims` modes + "Edit claims (admin)" under Us vs Them. Migration (owner runs):
  `supabase/migrations/20261118124800_frameup_video_ad_claims.sql` (read: signed in; write: `is_es_designer_admin()`).
  Before it runs, the file's placeholder claims and the warning stay.
- Tests: new `scripts/test-video-ads-hero.mjs`; updated `test-video-ads.mjs`, `test-video-ads-styles.mjs`,
  `test-ad-learning.mjs`, `test-ad-rating.mjs`. No new env vars. Clip search code untouched (owned by the clips branches).
### 2026-11-18 — Clips: free public clip sources, Reddit and Bluesky (branch feature/clips-public)
- Status: `[committed on feature/clips-public - not pushed]`
- New `netlify/functions/_clip-source-public.js`, which follows the shared clip-source contract. It exports a combined `public`
  source, `sources: [reddit, bluesky]` and `MEDIA_HOSTS`. Its results:
  - X links found in posts come back as `platform: 'x'` candidates for `clipFromPost`.
  - Timestamps are verified, then the throwback, quality and sport-relevance filters run.
  - Duplicates are removed, results are cached for 12 minutes, and requests to each host are spaced out.
  - After a 403 or 429 the host is skipped for a while. Each call costs $0.
- **Measured over 48 h:**
  - Bluesky: NFL 67 MP4s plus 42 X links (20 from @NFL, 4 from team accounts), CFB 8, MLB 2, golf 0.
  - Reddit: unauthenticated `.json` returns 403, so its yield could not be measured.
  - All media hosts send CORS `*`, so clips-library does not need a server stream.
  - Details: `project-docs/clips-public.md`.
- Env vars (all optional):
  - Turn sources off: `CLIPS_PUBLIC`, `CLIPS_REDDIT`, `CLIPS_BLUESKY` and `CLIPS_BLUESKY_SEARCH` (`=off`).
  - Credentials: `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`; `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD`.
- Tests: `scripts/test-clip-source-public.mjs`. All network calls are mocked.
- Not wired into `video-ads.js`; clips-library owns that integration.
### 2026-11-18 — Video Ads clips: Grok X-search source (branch feature/clips-grok)
- Status: `[committed on feature/clips-grok - not pushed]`
- New `netlify/functions/_clip-source-grok.js` (source interface from the clips contract: `id`, `configured(env)`, `search()` -> `{candidates, cost, diag}`).
  It calls xAI's `x_search` tool (Responses API) on the official team, league and network handles from `video-ads-sources.js`.
  Handles go in batches of 20, `from_date` is set to the last 120 h, and `max_turns: 1`.
- Routes: `XAI_API_KEY` sends it direct to api.x.ai. Otherwise it goes through the Gateway `/v1/responses` with `spacexai/grok-4.20-non-reasoning`.
  The Gateway does not document x_search, and it could not be tested without a key. If the Gateway rejects or ignores the tool, the module falls back to `perplexity/sonar` (x.com, last week).
- Only cited URLs become candidates. Model-written URLs without a citation are dropped (`diag.invented`). `postedAt` is decoded from the status-id snowflake, and the throwback rule is copied from `video-ads.js`.
  Candidates are `platform:'x'` with `mediaUrl:null`, so `clipFromPost` verifies them downstream.
- Cost: every call is logged with `logUsage` under feature `video-ads-find-clips-grok`. `aiSpendGate` runs first, and the per-search budget is `CLIPS_GROK_MAX_USD` (default 0.03).
  x_search bills $0.005 per post fetched, so a call costs about $0.03-0.11. Details are in `project-docs/clips-grok.md`.
- New env: `CLIPS_GROK` (off), `CLIPS_GROK_MODEL`, `CLIPS_GROK_DIRECT_MODEL`, `CLIPS_GROK_MAX_USD`, `CLIPS_GROK_MAX_TURNS`, `CLIPS_GROK_FALLBACK`, `CLIPS_GROK_FALLBACK_MODEL`, and optional `XAI_API_KEY`.
- Tests: `scripts/test-clip-source-grok.mjs` (all mocked). `video-ads.js` and `video-ads-sources.js` are untouched.
### 2026-11-18 — Video Ads: shared clip library, daily prefetch, library-first clip search (branch feature/clips-library)
- Status: `[committed on feature/clips-library - not pushed]`
- **Library**: new `netlify/functions/_clip-library.js` and migration
  `supabase/migrations/20261118121700_frameup_clip_library.sql`.
  - One row per verified clip (X, Bluesky, Reddit, Streamable…).
  - ES users read; the server writes with `SUPABASE_SERVICE_ROLE_KEY`.
  - Before the migration it runs in memory.
- **Daily prefetch**: `/api/clips-prefetch` (`netlify/functions/clips-prefetch.js`, `api/clips-prefetch.js`).
  - Ten daily Vercel crons, `?batch=1..10`, from 10:00 UTC; every team once a day, trending teams first.
  - Free sources first, then AI within `CLIPS_PREFETCH_MAX_USD` (default $0.75 per day).
  - Re-checks links (marking dead ones) and purges posts older than 7 days.
  - `CRON_SECRET` is required. `?diag=1` is for admins only.
- **find-clips / moments-with-clips** (`netlify/functions/video-ads.js`):
  - read the library first, so 9 or more clips means instant and free;
  - otherwise top up from the web search or X API plus `_clip-source-grok.js` / `_clip-source-public.js`
    (loaded defensively);
  - dedupe across platforms, write back, and add labelled never-empty fallbacks;
  - when AI is gated, still answer from the library and the free sources;
  - new free `library` mode.
- **Page** (`video-ads.js` clip panel, `video-ads.html`, `video-ads.css`; cache keys `20261118-clips-library`):
  - 3-column results, 9 at a time with Load more;
  - team filter; Best / Newest / Most popular;
  - platform and source badges, freshness, "No sound";
  - new **Library** tab;
  - library fallbacks instead of "No fresh clips".
- Docs: `project-docs/clips-library.md`. Tests: `scripts/test-clip-library.mjs` (`npm run test:clips`).
- Owner to do:
  - run the migration;
  - make sure `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are set in the Enterprise project;
  - optionally set `CLIPS_PREFETCH_MAX_USD`;
  - after the first morning, check `?diag=1`.
### 2026-11-18 — Reels Studio: voice bug fix, four ES styles, human voices, clips first, one-click flow (branch feature/reels-styles)
- Status: `[committed on feature/reels-styles, not pushed]`
- **Voice bug ("no voiceover audio")**: `frameup_ai_usage` had `reels-director` rows and no `reels-voice` rows: the
  voice was only made when someone found "Make the voiceover" in Edit. Now it is made automatically after every
  script (Make my reel, revise, reopen), per-line cached, re-made for edited lines (1.8 s after typing, and always
  before Preview and Export). Failure shows "The voiceover didn't record" + Retry; captions-only export still works.
  The same Web Audio mix feeds preview, WebCodecs/Mediabunny (now `reel-export.js`) and the MediaRecorder fallback.
- **Speech hardening** (`_reel-voice.js`): audio read from `audio` / `audio.base64` / `audio.data` / `data`; mp3 or wav
  sniffed; reply keys logged on failure (never audio or keys). `GET /api/reel-maker?diag=voice` (admins via
  `is_es_designer_admin()`, fails closed) runs one "Test." synthesis and returns ok/model/format/bytes or the error.
- **Voice (Suhail: "much more human, 4 options")**: default model `elevenlabs/eleven-v4` (falls back to Multilingual
  v2, then Flash v2.5, unless `REELS_TTS_MODEL` pins one). Four premade library voices, ids checked on
  api.elevenlabs.io/v1/voices: Brian `nPczCjzI2devNBz1zQrb`, Liam `TX3LPaxmHKxFdv7VOQHJ`, Sarah
  `EXAVITQu4vr4xnSDxMaL`, Bella `hpp4J3VqNfWAUOO0d1Us`. Samples (`mode: voice-sample`, cached both sides). Money and
  multipliers are read naturally ("$32 million", "2 times"); `[excited]` only on Liam's hook line on v4/v3.
- **Styles** (`reel-styles.js`, data): ES Classic, ES Data Explainer, ES Analytics Series, ES Countdown; picker with
  live renderer thumbnails and a code suggestion. The renderer's styled engine draws every beat kind in every style:
  stat hero, bars, versus cards (incl. "?"), dot rank, chips, step tracker, team tiles, role cards, mystery, plus
  eyebrow, ES badge, series tag, a persistent data strip, block captions, cut-out player over the frame. Director
  writes the components (fields validated, numbers sourced); explainer/series run 90–120 s (24 beats).
- **Visuals**: clip-first (planner targets 80% of the time: `F.planVisualMix`), official X clips via Video Ads
  `find-clips`, downloaded by the browser (`no-referrer`); then ES photos (query → team → league), team graphic,
  AI scene still (`mode: scene`, name-free prompts), AI b-roll (`_reel-media.js`, Veo 3.1 Lite async job, off unless
  `REELS_AI_CLIPS=gateway`, max 2), then the designed background. Empty = plain black (owner call). X clips are
  cleared for Meta paid ads (owner call): no paid block, source links kept in the rights table.
- **Flow**: Story → Review → Export, "Make my reel" (script → voice → clips → build, with progress), beat strip under the
  preview, one beat at a time with Swap clip / Use photo / Team graphic / AI / Upload, settings in folds, status line.
- New files: `reel-styles.js`, `reel-export.js`, `reel-flow.js`, `netlify/functions/_reel-media.js`; tests
  `test-reel-styles`, `test-reel-media`, `test-reel-export-flow` (+ updates to the five existing reel tests).
- Env (optional): `REELS_AI_CLIPS`, `REELS_AI_CLIPS_MAX`, `REELS_AI_CLIP_MODEL`. No migration.
- Owner to do after deploy: open `/api/reel-maker?diag=voice` signed in as an admin.
### 2026-11-18 — Generate: the creative director first, ES guidelines, Bring it on-brand (branch feature/generate-director)
- Status: `[committed on feature/generate-director - not pushed]`
- **Director first.** Generate now asks the director for 2-4 named directions (`POST /api/es-generate {mode:'direct'}`):
  name, angle, hook, template, why it works, past ES posts that inspired it (corpus ids P1..Pn, validated) and a
  confidence score (model's, tempered by verified facts). The page lets editors pick one or several, edit an
  angle/hook/headline inline, More / Less like this, Make selected / all, or Skip · Auto (the old one-step path,
  also used whenever the director fails). Picked directions go back as `directions: [...]`, are re-checked in
  code (template fit, real facts) and written without a second director call (one direction = 2 takes).
  Results are grouped by direction; each card shows its direction name and angle.
- **Steering:** tone (Hype / Analytical / Emotional / Witty) and audience (Casual fan / Die-hard) chips, saved
  per browser; `steer` now also accepts `{hook, tone, audience, more, less}` (the old string still works).
- **Director's note per design:** what works + one fix (from the art-director review, now also returning
  `strong`, the brand checks and the diversity guard). "Apply fix" calls `mode:'rewrite', instruction:'fix'`
  (or opens the photo picker). Rewrites keep the direction's angle.
- **Memory:** new migration `supabase/migrations/20261118121500_frameup_generate_direction_events.sql` (RLS: own
  insert/read, admins read all; `frameup_generate_direction_signals()` security definer, no user ids) and
  `/api/generate-direction-events`. The page logs directions shown/chosen/edited/skipped, more/less, fix
  applied, opened, exported. Signals feed the director and the past-posts ranking (rated and exported posts,
  and posts from runs the team exported, rank higher). Exports now carry runId/angle/hook/aiText
  (`frameup-spec.js`, `index.html` cache key bumped).
- **Model:** Sonnet stays the default. `GENERATE_DIRECTOR_MODEL=auto` = Haiku first, one Sonnet call when Haiku
  fails or fewer than 2 concepts validate (source `sonnet-escalated`). Costs log under `generate-director`.
- **ES guidelines (Suhail's follow-up):** `es-guidelines.js` (UMD) is a machine-readable spec extracted from
  `social-media-guide-01..11`, `brand-logo-guide-01..11`, `video-brand-guide-01..05`, the guideline pages and
  `frameup-rules.js`; every rule cites its image; `UNCLEAR` lists what needs Suhail. The director and writer
  plan inside it; every design passes a Guideline check (hard gate after `_lint-spec.js`) and shows
  "On-brand" or the fixes it made.
- **Bring it on-brand:** composer button + panel: drop / paste / choose up to 6 slides (downscaled in the
  browser), optional note. `mode:'onbrand'`: one vision read (main tier, feature `generate-onbrand`) critiques
  against the rule ids (validated), maps each slide to an ES template (`mapSlides`: viewership numbers become
  a Cover hook, real stat labels become Player Stats, lists become rankings, quotes become Quote), and remakes
  them from the image's own words and numbers. Carousel export as one multi-slide file is not built (each
  slide is its own ES design).
- Tests: `scripts/test-generate-director-mode.mjs`, `scripts/test-es-guidelines.mjs` (added to `test:generate`).
- Owner to do: run the migration; optionally set `GENERATE_DIRECTOR_MODEL=auto` (vercel.json already has
  `api/generate-direction-events.js`). Confirm the UNCLEAR guideline items in `es-guidelines.js`.
### 2026-11-18 — Impact loop: "Posted it? Paste the link", UTM tags, results import, admin Impact view
- Status: `[committed on feature/impact-posted-links, not pushed]`
- Brief: items 2 and 10 plus quick wins 3 and 5 of `project-docs/frameup-opportunities-research.md`.
- **Posted links** (`frameup-posted.js` + `.css`): after every export (editor, Generate download, Video Ads,
  Reels) a quiet floating card asks "Posted it? Paste the link". The platform is detected from the URL
  (Instagram, X, Facebook, Threads, YouTube, Beehiiv issue, Meta ad id or Ads Library / Ads Manager link).
  The same form sits in the Gallery viewer and the Dashboard export drawer; Gallery cards show
  "Posted · Instagram". Video Ads also shows the Meta ad name per size
  (`{brand}_{style}_{angle}_{WxH}_{yyyymmdd}`) with Copy buttons. Tools without a task row give the
  export a reference id (`gen-…`, `vad-…`, `reel-…`) so links, events and results all join on `task_id`.
- **UTM**: "Copy link" in the editor and newsletter widget "Copy HTML" add utm_source/medium/campaign
  (campaign = brand + design id) when a toggle is on (off by default, remembered per browser; the toggle
  appears in the card after a copy and re-copies). The hosted image path is never changed; in widget HTML
  only `<a href>` links are tagged, never `img src`.
- **Events**: `design_started` (first real interaction after open / after the last export),
  `export_done` (with `elapsed_ms`), `generate_run`, `posted_link_added` go to a new `frameup_events`
  table, not `es_designer_activity`, so the dashboard feed stays readable.
- **Dashboard → Impact** (`frameup-impact-view.js` + `frameup-impact.css`, new sidebar tab): exports this
  week (north-star proxy), active users, median time to export, posted rate, Generate run → export,
  AI cost per export (and per AI-made export), requests on time, imported results; exports per week
  (12-week bar chart), exports per creator, template leaderboard (exports, creators, posted %, clicks,
  impressions/opens), CSV import (Meta Ads / Beehiiv: auto-detect, column mapping, match preview,
  upsert), recently posted links.
- **Stats API groundwork**: `/api/impact-stats` (admin only) reports whether `BEEHIIV_API_KEY` /
  `META_ACCESS_TOKEN` are set; the pull itself returns 501 until built. Documented in `.env.example`.
- **Migration (owner runs it)**: `supabase/migrations/20261118124600_frameup_post_links.sql` —
  `frameup_post_links` (own insert/read/delete, admin read all), `list_frameup_post_status(ids)` for the
  Gallery, `frameup_post_results` (admin only, unique per source/row/period), `frameup_events` (own
  insert, admin read). Before it is applied: links are kept on the device and saved later, events are
  skipped, the Impact view shows a note and uses tasks, requests and AI usage.
- Logic is pure and tested: `frameup-impact.js`, `scripts/test-impact.mjs` (`npm run test:impact`).
- Verified locally with a stubbed sign-in and Supabase client (light/dark, 1280 and 375).
### 2026-11-18 — Design Requests become a tracked workflow, with Slack threads (branch `feature/requests-slack`)
- Status: `[committed on feature/requests-slack, not pushed; migration NOT applied]`
- Brief: item 7 of `project-docs/frameup-opportunities-research.md`.
- **Lifecycle** (`request-lifecycle.js`, shared by browser, functions and tests): New → (Assigned) → In progress → In review → Done, plus **Declined**. Designers claim unassigned work, hand back their own, and move their own one step at a time; admins do anything; requesters comment and can withdraw before work starts.
- **Migration** `supabase/migrations/20261118120000_request_workflow.sql` (idempotent, Undo in header): `Declined` status + `status_changed_at`; `frameup_request_designers` (admin-managed); designers read all design requests (one SELECT policy, extended); `frameup_request_events` (history + comments, written by a trigger on every status/assignee/due/priority change); `frameup_request_deliveries`; RPCs `frameup_request_update / _comment / _attach / _detach / _set_slack_thread / _claim_notifications`, `frameup_my_open_request_count`. Everything degrades before it runs (read-only list + notice).
- **My requests** page (`requests.html/.css/.js`, data in `design-requests.js`): Mine / My queue / All / Designers views, Open/Overdue/Done/Declined filters, search, progress steps, facts, manage panel, brief, delivered designs (attach a FrameUp export or link; In progress auto-moves to In review), activity + comments. NAV "My requests" under Work with an open-count badge (`app-shell.js`).
- **Slack** (`netlify/functions/_slack.js`): bot mode (`SLACK_BOT_TOKEN` + `SLACK_DESIGN_REQUEST_CHANNEL`) posts with chat.postMessage and stores the ts in task metadata, so updates/comments reply in-thread; webhook mode (existing `SLACK_DESIGN_REQUEST_WEBHOOK_URL`) posts standalone updates. `/api/design-request-update` runs changes as the user and posts DB-claimed events. `/api/slack-command` (`/frameup request|status|help`) verifies `SLACK_SIGNING_SECRET`, refuses without it; filing directly needs bot + `SUPABASE_SERVICE_ROLE_KEY`, otherwise replies with a pre-filled form link. Owner steps: `project-docs/slack-app-setup.md`.
- **Request form**: clearer labels/help, email locked to the sign-in, collision-safe IDs (`DR-YYYYMMDD-XXXX`; the old per-browser counter could collide across people), success screen with "Track this request", Slack-link prefill (`?brief=&priority=&due=`). No file upload exists, so references stay links.
- **Dashboard**: status filter (incl. Open/Declined), Declined column only when needed, "History and comments" link in the task drawer, Declined no longer counted as open, edits ask the server to post to the Slack thread.
- Tests: `scripts/test-request-workflow.mjs` (33 checks, fetch mocked; no real Slack).

### 2026-11-18 — Reliability: cloud drafts, error reports, /api/health, shell-first loading (branch `feature/reliability-drafts`)
- Status: `[committed on feature/reliability-drafts — not pushed, not merged]`
- Brief: research "Trust and truth" item 1 (§4.1) + launch-readiness P1 #1 (blank main area for 1–4 s).
- **Cloud drafts** (`frameup-cloud-drafts.js`, new; hooks in `frameup-autosave.js` / `frameup-designs.js`; one script line in `index.html`):
  - each confirmed local autosave fires `frameup:autosaved`;
  - the web-photo-only snapshot is upserted to `frameup_drafts` (key `editor`) about 20 s later, and on tab hide, close or reconnect;
  - exports sync too (`design:<id>`);
  - **conflicts:** last write wins, but a newer save from another device asks first ("A newer version is on another device": Keep this one / Open the newer one); an empty editor just opens the newer draft;
  - **safety:** local stays the source of truth; offline and signed-out saves wait; >400 KB is skipped; a missing table switches the feature off for the page load;
  - "Your drafts" section added to the Recent designs dialog.
- **Error reports** (`frameup-errors.js`, new, first script on every signed-in page):
  - catches `window.onerror`, `unhandledrejection`, script/CSS load failures, and `/api/*` fetches that return 5xx/404 or get no response;
  - scrubbed (emails, tokens, keys, passwords, query strings), deduped, max 5/min and 20/page, batched;
  - goes to `POST /api/client-errors` (new; auth required, 401/413, per-user backstop, writes `frameup_client_errors` with the user's token, optional Sentry forward when `SENTRY_DSN` is set, hashed user id);
  - Dashboard → Overview → **Errors** panel: last 7 days, grouped, stack on click.
- **Uptime:** `GET /api/health` (new; no auth, no secrets) checks Supabase `/auth/v1/health` plus the AI gateway configured flag. Optional Slack alert on state change, only for callers with `CRON_SECRET`, when `SLACK_OPS_WEBHOOK_URL` is set. Setup steps are in `project-docs/uptime-and-errors.md`.
- **Blank-page delay:**
  - **Cause:** `ESAuth.requireAuth` hides the whole `<html>` until the Supabase SDK downloads and the session check finishes.
  - **Fix on Generate, Video Ads and Gallery:** new `frameup-shell-first.js` shows the shell and a skeleton at once and keeps `#main`, the account name and AI usage hidden (and unclickable) until `es:auth-ready`. Auth itself is unchanged; the auth script isn't edited.
  - **Fix on Dashboard:** skeletons and "—" KPIs paint before the auth/admin checks; it used to show "0"s and empty cards.
  - **Measured** (local, SDK held back 1.5 s): shell visible at 1.5–3.0 s before, 26–46 ms after; content appears at auth-ready (~1.5 s), as before.
- Also: P1 #3, the Reels phone Export now mirrors the desktop button's disabled state.
- Migrations (owner runs): `20261118120000_frameup_drafts.sql`, `20261118120100_frameup_client_errors.sql`.
- New env vars (all optional): `SENTRY_DSN`, `CRON_SECRET`, `SLACK_OPS_WEBHOOK_URL`.
- Tests: `scripts/test-cloud-drafts.mjs`, `test-client-errors.mjs`, `test-health.mjs`, `test-reliability-wiring.mjs`.
### 2026-11-17 — Video Ads: four no-footage styles, motion, safe zones, test sets (branch `feature/video-ad-styles`)
- Status: `[committed on feature/video-ad-styles — not pushed; coordinator merges after Suhail approves]`
- Brief: Phase 1 of `project-docs/video-ad-styles-research.md`.
- **Motion base** (`video-ads-render.js`): ops may carry `anim` (fade / rise / scale / pop / wipe, with optional exit);
  `drawOps` / `drawFrame` take the ad clock `{ t, duration }`. Times scale so every entrance ends by 40% of the ad;
  the CTA then holds to the last frame. No clock (or no `anim`) draws exactly as before. The preview honours
  reduced motion and shows the finished frame while you edit; play / scrub shows the timeline. Exports always run it.
- **Four styles**, each with a spec per size, always inside Meta's Reels safe zone (9:16 copy band y 270–1250, CTA
  clear of the action rail): Stat Card, Today's 3, Us vs Them, Quote Card. They work on the animated background,
  a photo or a clip. Shared rules live in the new `video-ads-styles.js` (browser + server).
- **Facts**: stats must be a number from the brief (or typed by the editor); quotes verbatim with a named speaker;
  Today's 3 headlines must restate real stories; Us vs Them "us" lines only from `verifiedClaims` per brand.
  **The claims in `video-ads-brands.js` are placeholders (`claimsApproved: false`, TODO) — Suhail must approve them.**
- **Copy server** (`netlify/functions/video-ads.js`): per-style fields, checks and code repairs; a style asked for
  without its facts skips before any AI call; every reply carries a `suggestion`; new `suggest-style` mode (no model).
- **Suggestion**: "Suggested: Stat Card — your brief has a number (412)". Rules first; the brand's export ranking
  (`_ad-learning.js` `styleRankingFor`: export share × edit distance) and the AI's pick only break near-ties (≤ 0.09).
- **Export 3 styles**: the chosen copy in 2–3 styles × sizes, one pass; files named
  `{brand}_{style}_{angle}_{WxH}_{yyyymmdd}.mp4` (all exports use this now). One `export` event per style with
  `style`, `angle`, `gridId`, file names.
- **Safe zones**: "Safe zone" toolbar overlay; classic styles get `safeZone: 'meta' | 'classic'` (default meta);
  "Unsubscribe anytime" ≥ 32px (34px in the new styles).
- **Rating** (`_ad-rating.js`): PROMPT_VERSION v1.1.0 — knows the styles, backgrounds and timed reveals; never
  penalises a missing clip. Rubric, weights and RUBRIC_VERSION unchanged.
- Tests: new `scripts/test-video-ads-styles.mjs`; additions to `test-video-ads.mjs`, `test-video-ads-render.mjs`,
  `test-ad-learning.mjs`, `test-ad-rating.mjs`. No migration, no new env vars.
- Not done: `style_selected` / `grid_created` events (the events table's type check would reject them; needs a
  migration), What's new / tour copy (shared files across pages).
### 2026-11-18 — AI guardrails: team cap, alerts, kill switches, measurable usage (branch `feature/ai-guardrails`)
- Status: `[committed on feature/ai-guardrails, not pushed; the coordinator merges]`
- **Full write-up:** `project-docs/ai-strategy-and-costs.md` → "What shipped", including a table of every AI env var.
- **Limits:** none lowered. The per-person cap stays $20/week (a testing value; `AI_USER_WEEKLY_LIMIT_USD` raises it).
- **Server:**
  - `_ai-gateway.js`:
    - `aiSpendGate()` checks the kill switch, then the person's weekly cap, then the team cap (`AI_TEAM_WEEKLY_LIMIT_USD`, off when unset).
    - It fails open with a JSON warning event, or fails closed with `AI_FAIL_CLOSED=1`.
    - `AI_DISABLE` kill switches and `AI_ECONOMY=1` (Sonnet tier → Haiku).
    - `logUsage` now writes cache tokens, task and run id (and retries without them before the migration).
    - `PRICES` fixed: Sonnet 5.5 cache read $0.10; Haiku's long-context rate is now priced.
    - The cache hint is skipped for tiny prompts, and a rejected hint logs a warning.
  - **Handlers:** `es-generate.js`, `es-generate-image.js`, `trend-design.js`, `video-ads.js`, `ad-rating.js` and `es-video-intelligence.js` all use the gate.
  - **Generate writer:** one cached prefix for every format choice, with the picked formats after the break. Run `npm run eval:generate` with picked formats before relying on it.
  - **Video Ads copy:** no longer marked cacheable (under 512 tokens).
  - **Reels:** OpenAI transcription logs usage.
  - **New files:**
    - `_ai-alerts.js`: Slack alerts at 50/80/100% of the team cap and 80% of a person's cap, once per week each;
    - `ai-budget-watch.js`: the daily cron, protected by `CRON_SECRET`;
    - `ai-status.js`: caps and switches for the UI;
    - `api/` adapters for both functions;
    - `vercel.json`: two `functions` entries and one daily `crons` entry, `0 13 * * *`.
- **UI:**
  - **Dashboard:** the AI panel is now "AI spend · this week": team vs cap, cost per export, cache hit rate, Sonnet share, top features and top people (`ai-usage-summary.js`, `dashboard-data.js`, `dashboard-ui-system.css`).
  - **Polite "switched off" and limit states** in Generate, Trends, Video Ads and Reels.
  - **Cache keys** bumped to `20261118-ai-guardrails`.
- **Migration (owner runs it):** `supabase/migrations/20261118120000_ai_guardrails.sql` adds:
  - the nullable usage columns;
  - `frameup_team_ai_spend` (aggregate only);
  - `frameup_ai_budget_summary` and `frameup_ai_alert_claim` (service_role only);
  - the `frameup_ai_alerts` table.
  It ends with an "Undo:" block.
- **New env vars:** `AI_TEAM_WEEKLY_LIMIT_USD`, `AI_FAIL_CLOSED`, `AI_DISABLE`, `AI_ECONOMY`, `SLACK_AI_ALERTS_WEBHOOK_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. Set them in the Enterprise Vercel project.
- **Tests:** new `scripts/test-ai-guardrails.mjs` (all network mocked; no Slack message sent). The full suite shows only the 7 known baseline failures.
- **Follow-up (same branch): every AI call on the Gateway key.**
  - **Reels captions:** they can transcribe through the Gateway: `POST /v4/ai/transcription-model`, default `elevenlabs/scribe-v2` at $0.0037/min, with word timings.
    - The order is Groq → Gateway → OpenAI, and `REELS_TRANSCRIBE` moves one provider first.
    - The billed steps are gated and logged.
  - **Backup without Groq:** the Generate writer and Trends fall back to `AI_BACKUP_MODEL` (`openai/gpt-oss-120b`) on the Gateway.
  - **Admin diagnostics:** `GET /api/ai-status?diag=1` lists each job's provider, model and whether its key is present (booleans only).
  - **New env vars:** `AI_BACKUP_MODEL`, `AI_TRANSCRIPTION_MODEL`, `REELS_TRANSCRIBE`.
  - **Docs:** `.env.example` and the strategy doc are updated.
- **Browser:** the Dashboard AI panel was checked through a temporary local harness (stubbed `ESAuth` / `ESDashboardData`, since deleted) at 1280 and 375, light and dark. It covered no-cap, economy, empty and no-settings states, with no horizontal scroll and no console errors.
### 2026-11-18 — Editor quick wins: smaller link images, Remove background, size packs, P1 fixes, faster editor links
- Status: `[committed on feature/editor-quick-wins - not pushed, not merged]`
- Branch/worktree: `feature/editor-quick-wins` in `ds-branches/editor-quick-wins` (from origin/main 150ab31).
- **Smaller newsletter link images (egress).** `copyImageLink()` now encodes JPEG link uploads at 0.85
  (downloads stay 0.94) and caps newsletter link images at 1200 px wide (2x a 600 px email column; only
  the 2x export option is affected). Measured on the newsletter templates in the browser: Feature Image
  146→98 KB (−33%), Video FI 111→73 KB (−35%), Tag FI 106→68 KB (−36%). Side-by-side checks showed no
  visible difference at 100%. Helpers: `linkImagePlan()`, `resizeCanvasForLink()` (index.html).
- **Remove background** (`frameup-cutout.js`, `netlify/functions/remove-bg.js`, `api/remove-bg.js`): a
  "Remove background" action on each photo in the Photos panel. **Changed per Suhail ("use a chatgpt cheap
  model"):** default provider is OpenAI `gpt-image-1-mini` (cheapest GPT Image model; `REMOVE_BG_MODEL`
  overrides) via `/v1/images/edits` with `background: transparent`, `quality: low`, WebP output (keeps
  alpha, stays under Vercel's 4.5 MB response cap), called **directly with the existing `OPENAI_API_KEY`**
  (same key as Reels transcription), so no new key. `REMOVE_BG_PROVIDER=gateway` (opt-in: the Gateway's
  OpenAI image-edit route isn't documented for transparency) and `=bria` (`BRIA_API_KEY`) remain options.
  **Likeness rule:** the model's picture is never shown. The editor pads the photo to the model's size
  (1024², 1024×1536 or 1536×1024), takes only the returned alpha, maps it back to the photo, softens the
  edge and applies it to the ORIGINAL pixels at up to 2048 px. A mask is rejected (falls back to the free
  plain-backdrop tool, or "Couldn't cut this one out cleanly") when it is near-empty/near-full, spills into
  the padding (moved/rescaled), or the model's pixels under it disagree with the photo (mean diff > 48 or
  > 20% of pixels clearly different = redrawn/shifted). Cost is computed from the response's token usage
  ($2 text / $2.5 image in / $8 out per 1M for gpt-image-1-mini; about $0.005 per image at low) and logged
  via `logUsage` as `remove-bg` with model `openai/gpt-image-1-mini`. Signed-in only, 6 MB cap, per-person
  hourly cap + shared hourly/weekly AI caps. Not set up → dialog naming the env var. Free in-browser
  plain-backdrop flood fill kept. Per-photo session cache and Undo kept. **Not tried against the real
  OpenAI API** (no real calls from this session); the mask pipeline was checked in the browser with a
  stand-in model response.
  **Gateway follow-up:** `REMOVE_BG_PROVIDER=gateway` now uses the Gateway's documented JSON form of
  `POST https://ai-gateway.vercel.sh/v1/images/edits` (`model: openai/gpt-image-1-mini`, `images:
  [{ image_url: <data URL> }]`, plus `background/output_format/quality/size` top-level and in
  `providerOptions.openai`). Default stays `openai` (direct) because the Gateway docs show edits only with
  `openai/gpt-image-2` and never mention transparent output passthrough; switch with one env var after a
  real call on a preview. New admin check: `GET /api/remove-bg?diag=1` (dashboard admins via
  `is_es_designer_admin()`, or `REMOVE_BG_DIAG_EMAILS`) returns provider, model, endpoint and key presence
  as booleans.
- **Size packs** (`frameup-size-pack.js`, `frameup-zip.js`, `frameup-quick-wins.css`): Export settings →
  "Size pack" (and ⌘K "Export size pack") in the Social Media workspace: feed 1080×1350, square 1080×1080,
  story 1080×1920, X 1600×900, YouTube 1280×720, preview grid, tick sizes, one ZIP (tiny stored-ZIP writer,
  no CDN). Cover Image is re-laid out at every size (story/YouTube use the Reels/YouTube workspaces' own
  fade and text anchor). Every other template was checked at each size and does NOT re-lay out cleanly
  (fixed-coordinate cards overlap the wordmark), so they are shown whole on a blurred backdrop ("Fitted"),
  with a centred crop only when ≤6% would be lost. Each preview is labelled Original / Re-laid out /
  Cropped / Fitted.
- **Launch-readiness P1s:** the ES Image Pool inputs already had `aria-label` (no change); added a visually
  hidden `h1#studio-route-heading` kept in sync with the workspace name; Reels phone Export now mirrors the
  desktop button's `disabled` (MutationObserver) and starts disabled.
- **Performance:** tour scripts (4 files, ~78 KB) are `defer`; Home's second banner and four workspace
  cards are `loading="lazy"`, and opening an editor link (`#instagram|#youtube|#newsletter`) keeps Home out
  of the first layout until the router runs, so those images are never fetched there: same-origin images
  on an editor deep link went 588 KB → 106 KB. Local (cached, localhost) parse/DCL timings were within
  noise before and after (~60–80 ms).
- Tests: `scripts/test-remove-bg.mjs`, `test-size-pack.mjs` (ZIP bytes + `unzip -t`), `test-cutout.mjs`,
  `test-editor-quick-wins.mjs`. Full suite: only the 7 known baseline failures.
- Env: reuses `OPENAI_API_KEY`. New optional: `REMOVE_BG_PROVIDER`, `REMOVE_BG_MODEL`, `REMOVE_BG_QUALITY`,
  `REMOVE_BG_HOURLY_LIMIT`, and for Bria only `BRIA_API_KEY`, `BRIA_REMOVE_BG_URL`, `REMOVE_BG_COST_USD`. No migrations.
### 2026-11-18 — Reels Studio MVP (reel-maker.html), branch feature/reels-studio
- Status: `[on branch feature/reels-studio, NOT committed (git commit blocked by the permission system twice); not pushed]`
- Built from `project-docs/ai-reels-research.md` (MVP, §1.3 craft norms, §3 legal path, §5 lint, §6 architecture).
- New page `reel-maker.html` / `reel-maker.js` / `reel-maker.css`: Topic (trend from the last 48 h or a brief; format cards with a router "fits" dot; sport; Standard/Economy script tier; capped fact check; cost estimate) → Edit (beats: on-screen text, voiceover, stat / rank / quote fields, highlight word, ES-pool photo per beat, reorder/delete/add; Revise chips; voice and caption style; music upload or library + licence; sources; quality checks) → Export (organic/paid target, rights table, lint gate, real cost, MP4). Live 9:16 preview with transport, mute, safe-zone overlay, Space to play.
- Shared pure modules (UMD, Node-tested): `reel-formats.js` (formats, router, number provenance, pacing, cost estimate, grounded no-AI draft), `reel-render.js` (timeline/EDL builder, frame timing, layout, drawing; reuses `video-ads-render.js` videoRect / tintLayers / drawGenerated), `reel-lint.js` (rules; `netlify/functions/_reel-lint.js` wraps it for the server).
- Server: `netlify/functions/reel-maker.js` + `api/reel-maker.js` (modes config, trends, plan, revise, voice, projects, project-save, project-load, event), `_reel-director.js` (Haiku, Sonnet only when weak; validates every beat; drafts when AI is off or over a cap), `_reel-voice.js` (ElevenLabs or Gateway TTS, env-gated, never-clone check, one beat per response). `vercel.json`: `api/reel-maker.js` at 60 s.
- Export: WebCodecs + Mediabunny 1.62.1 (jsDelivr; frame-exact, about 5 s for a 28 s reel in Chrome), else the Video Ads MediaRecorder path in real time.
- Migration (owner runs it): `supabase/migrations/20261118120000_frameup_reel_projects.sql` (projects + events, RLS own rows, admins read all). Until then projects autosave in the browser only.
- Voice (follow-up, same day): ALL voice goes through the Vercel AI Gateway by default, so no ElevenLabs account is needed.
  - Speech: `POST https://ai-gateway.vercel.sh/v4/ai/speech-model` (headers `ai-gateway-protocol-version: 0.0.1`, `ai-speech-model-specification-version: 4`, `ai-model-id`; body `{ text, voice, outputFormat, providerOptions }` → `{ audio: base64 }`), docs https://vercel.com/docs/ai-gateway/modalities/text-to-speech. Default model `elevenlabs/eleven-flash-v2.5`, default voice ElevenLabs "Roger" (`CwhRBWXzGAHq8TQ4Fs17`, public library voice).
  - Caption timing: the speech reply has no word timings, so each clip is transcribed once with `elevenlabs/scribe-v2` via `POST /v4/ai/transcription-model` (body `{ audio, mediaType }`, words in `providerMetadata.elevenlabs.words`), docs https://vercel.com/docs/ai-gateway/modalities/speech-to-text. The script's words keep their spelling and take Scribe's times. Cached by text hash.
  - Cost for a 30 s reel (about 450 characters): voice $0.018 + alignment $0.0018 ≈ $0.02 (Gateway list prices from /v1/models, 2026-11-17). Logged as `reels-voice` and `reels-voice-align`.
  - Music bed (optional, `REELS_MUSIC=gateway`): `elevenlabs/music-v2.5`, $0.0025/s, logged as `reels-music`. ElevenLabs Music Terms (updated 2026-10-09) allow online commercial use on paid plans (not film/TV/radio) but don't name paid ads, and the plan behind Vercel's keys is unconfirmed → recorded as organic only, so paid exports with it are blocked by the lint.
  - Direct ElevenLabs only behind `REELS_TTS=elevenlabs`.
- Env (all optional): `REELS_TTS` (unset = Gateway | off | elevenlabs), `REELS_TTS_MODEL`, `REELS_TTS_VOICE`, `REELS_ALIGN_MODEL`, `REELS_MUSIC`, and for the fallback `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`. All listed in `.env.example`.
- `reels-music.json` is empty on purpose (TODO for the owner: licensed tracks only).
- Shared files touched: `app-shell.js` (NAV item + usage label), `tours/tours.js`, `tours/tour-launcher.js`, `tours/updates.json`, `vercel.json`, and the `?v=` keys of app-shell / tours on every app-shell page (13 pages incl. `index.html`, a three-line change each).
- Tests: `scripts/test-reel-render.mjs`, `test-reel-lint.mjs`, `test-reel-director.mjs`, `test-reel-voice.mjs`, `test-reel-maker-api.mjs`; the full suite shows only the 7 baseline failures.
### 2026-11-18 — Two stat templates (Player Stat Line, Team Record / Score) and the FrameUp logo library
- Status: `[local, uncommitted - branch feature/social-templates-logos]`
- **Social templates** (index.html Social Media): `player-stat-line` and `team-record` (4:5), built from
  Suhail's reference designs. Data models in `social-stat-templates.js` (UMD); draw functions
  `drawPlayerStatLinePost` / `drawTeamRecordPost`; fields `#player-stat-line-fields` / `#team-record-fields`;
  thumbnails in `assets/template-thumbs/`; picker group "Stats" (frameup-templates.js); tagged New in
  `tours/updates.json`. State fields documented for the sports-calendar branch in
  `project-docs/templates-player-stat-line.md`. Not added to Generate (steps documented there).
- **Logo library**: `logo-library-data.js` (generated by `scripts/build-logo-library.py` from ESPN's public
  team API) + `logo-library.js` (`window.FrameUpLogos`: search, aliases, league chips, team colours) +
  `logo-picker.js/.css` (`window.FrameUpLogoPicker`: modal dialog, recents, favourites, light/dark preview,
  per-user uploads in IndexedDB). 803 entries; 477 logos vendored as 256px WebP in `assets/logos/` (5.4 MB);
  college basketball outside FBS uses ESPN CDN URLs (they send `Access-Control-Allow-Origin: *`, loaded with
  crossOrigin so exports stay untainted). F1 constructors, ATP and WTA are drawn name badges
  (`scripts/build-logo-marks.py`), labelled as such.
- **Wired into**: Player Stat Line, Team Record, Rankings Table and Ranked List row logos ("Choose/Change"
  opens the library; upload lives in the same dialog), Newsletter infographic logo layers (tour logos,
  badges), and Generate's Rankings/Ranked List rows (a row's `team` gets its library logo in frameup-spec.js).
  Listicle data validators accept library sources.
- Tests: `scripts/test-logo-library.mjs`, `scripts/test-stat-templates.mjs` (new);
  `test-listicle-type2-ui.mjs` regex now allows a `?v=` cache key.

### 2026-09-10 — Fix a regression from this same day's earlier fixes: concurrent profile upsert race
- Status: `[pushed - see rollback point below]`
- Files touched: `dashboard-data.js`. No database changes this time.
- Context: right after confirming the "30MB embedded images" fix (previous entry) deployed, Suhail reported
  the dashboard's People panel now showing **"Profile sync timed out. People sync timed out. Task sync
  timed out. Activity sync timed out."** — all four, worse than the single "Task sync timed out" before.
  Went back into Supabase rather than assuming: the project's own health page showed 99.8% success / 4,276
  requests over the last hour (healthy, not overloaded), but `Logs → Postgres Logs` showed a *new* error
  type that didn't exist before today's earlier RLS fix: repeated
  `ERROR: new row violates row-level security policy for table "es_designer_profiles"`, four of them
  within about one second (16:27:28–29), with the exact failing statement captured — an
  `INSERT ... ON CONFLICT ("email") DO UPDATE` against `es_designer_profiles`, i.e.
  `upsertSupabaseProfileAndPresence()`.
- **Root cause — a bug introduced by this same day's own earlier changes, not the RLS/database fix**:
  `upsertSupabaseProfileAndPresence()` and `flushPendingCloudWrites()` are each called from *two* separate
  places: the presence-heartbeat path (`recordPresenceHeartbeat()`, which fires immediately on
  `es:auth-ready`) and inside `refreshCloudDashboardData()`. Both of those fire at boot. Two changes made
  earlier today made this collide in practice for the first time:
  1. The "part 1" load-time fix removed the artificial 500ms `setTimeout` in `boot()` before the first
     `refreshCloudDashboardData()` call, which had been (accidentally) giving the heartbeat's upsert just
     enough of a head start to usually finish first.
  2. That same fix made `refreshCloudDashboardData()`'s internal operations run concurrently
     (`Promise.allSettled`) instead of sequentially.
  Combined, at every dashboard boot two concurrent `INSERT ... ON CONFLICT DO UPDATE` statements now hit
  the *exact same row* within milliseconds of each other. One of the two loses the race and Postgres
  reports it as an RLS violation rather than a lock wait — a real, reproducible client-side concurrency bug,
  not a flaw in the RLS policies themselves (the policies were not touched this entry).
- **Fix**: added the same in-flight de-duplication pattern the file already uses for
  `refreshCloudDashboardData()` itself (`cloudRefreshInFlight`) to these two functions specifically:
  - `upsertSupabaseProfileAndPresence()`: renamed the real implementation to
    `runUpsertSupabaseProfileAndPresence()`; the public-facing function now checks a new
    `presenceUpsertInFlight` promise and returns/awaits the existing in-flight call instead of starting a
    second one, only clearing the flag in a `finally`.
  - `flushPendingCloudWrites()`: identical treatment with `runFlushPendingCloudWrites()` /
    `pendingFlushInFlight`, since it has the exact same dual-call-site shape and could race the same way
    on task/activity upserts.
  - Neither function's actual logic changed — this is purely "don't run two of these at once from the
    same tab," which cannot make anything slower for the normal (non-overlapping) case and only skips
    genuinely redundant concurrent work.
- Verification note: reviewed both wrapped functions line-by-line (brace balance, that the original
  function bodies are unchanged apart from the rename), zero console errors on local preview reload. Have
  **not** watched this specific race stop occurring live — that requires reloading the real dashboard
  again and checking Postgres logs afterward for a recurrence, same limitation as every entry today.
- **Rollback point: `a1638cd`** — HEAD before this commit.

### 2026-09-10 — Fix dashboard load time, part 2 (real root cause): 30MB of embedded base64 images
- Status: `[pushed - see rollback point below]`
- Files touched: `dashboard-data.js`, `dashboard.html`.
- Context: the RLS fix immediately above this entry (same day) was real and Performance-Advisor-verified,
  but Suhail reported the *exact same* "Task sync timed out" error minutes later, understandably
  frustrated ("i dont understand what is so difficult here"). Went back into Supabase to find the actual
  live, current-moment cause rather than assuming the previous fix was sufficient.
- **What was actually happening, checked live**: the project's own overview page showed **91.1% success
  rate** (not slowness — real failures) over the last 60 minutes. `Logs → Postgres Logs` showed repeated,
  ongoing `ERROR: canceling statement due to statement timeout` entries, with the *exact* failing query
  captured in full: a plain PostgREST-generated `SELECT * FROM es_designer_tasks ORDER BY updated_at DESC
  LIMIT/OFFSET` — i.e. exactly `fetchSupabaseTasks()`. `Database → Tables` showed why:
  **`es_designer_tasks` has 58 rows but is 30 MB** (compare `es_designer_profiles`: 31 rows, 80 KB). ~500KB
  average per row. Traced it to `metadata.previewDataUrl` — every exported-design task stores its full
  export preview as a base64 data URI directly in a `jsonb` column, and the routine `select('*')` list
  fetch (now polled every 5s per the earlier session's interval change, likely making this worse, not
  better) re-downloads every export's full-size image on every single load, just to render counts and
  list rows.
- **Fix — stop transferring the image on the routine path, load it lazily on demand instead**:
  - `dashboard-data.js`: `fetchSupabaseTasks()` now selects an explicit column list (`TASK_LIST_COLUMNS`)
    instead of `select('*')` — every field the list/summary views need, plus the small `metadata` sub-
    fields (`exportedAt`, `durationMs`, `outputSize`, `mimeType`, `exportScale`) via PostgREST JSON-path
    aliases (`meta_exported_at:metadata->>exportedAt`, etc.) — but *not* `previewDataUrl`.
    `normalizeSupabaseTask()` rebuilds a lightweight `metadata` object from those aliased fields when the
    full `metadata` object isn't present, so every existing reader of `task.metadata.*` keeps working
    unchanged; `previewDataUrl` simply comes back empty from this path now.
  - Added `fetchTaskPreview(taskId)`: a new, separate one-row fetch (`select('id, preview:metadata->>
    previewDataUrl').eq('id', id)`) that loads *just* one export's image, and writes it back into
    `cloudTasksCache` in place so it's fetched at most once per export per session, never again on
    subsequent polls. Exported from the module's public API.
  - `dashboard.html`: `renderExportList()` no longer disables the preview button/"View Export" CTA when
    an image hasn't loaded yet (it will, lazily) — shows "Loading…" in the thumbnail slot instead of the
    old permanent "No preview". Added `hydrateExportPreviews(designs)`, called after both places that
    render an export list (`renderOverviewExports`, `renderDesigns`): fires `fetchTaskPreview()` in the
    background for every visible row still missing an image, and patches the `<img>` into the DOM (via
    `CSS.escape`-guarded `data-preview-task` selector) as each resolves. `openExportPreview()` is now
    async and does its own on-demand fetch as a fallback for a click that beats the background hydration.
- **Why this is the right fix, not a band-aid**: this scales — the routine list/poll payload stays small
  forever regardless of how many exports accumulate (the actual growth driver of the original 30MB), and
  each export's image is transferred at most once per browser session no matter how many times it's
  polled or how many admins are looking, instead of being re-sent whole on every 5-second tick.
- Did not touch `es_designer_activity`/`es_designer_profiles`/`es_designer_presence` — checked their sizes
  in the same Tables view (80KB/80KB/64KB) and they show no similar blow-up; no evidence they need the
  same treatment right now, revisit if that changes.
- Verification note: same limitation as always for the authenticated dashboard itself (Supabase login
  gate) — checked for zero console errors on reload of the local preview, and reviewed both files
  line-by-line, but have not watched the lazy-load thumbnails or the "Task sync" success/failure actually
  render in Suhail's browser yet. Ask him to reload and confirm both (a) the timeout is gone and
  (b) export thumbnails still show up (just a beat later than before) in Recent Exports / Review Exports.
- **Rollback point: `ee65a99`** — HEAD before this commit.

### 2026-09-10 — Fix dashboard load time (real root cause): RLS auth.jwt() re-evaluated per row
- Status: `[applied directly to production Supabase; migration file added and pushed to this repo for history]`
- Files touched: `supabase/migrations/20260910070000_fix_dashboard_rls_performance.sql` (new). No app code
  changes — this is a database-only fix.
- Context: the previous session's client-side parallelization (2026-09-09 entry) was real and correct but
  wasn't the actual bottleneck. Suhail logged into the live app and got a concrete in-app error —
  **"Task sync timed out."** — which pointed straight at one specific Supabase table read
  (`fetchSupabaseTasks()` in `dashboard-data.js`).
- Investigated directly in Supabase (Suhail logged in himself; the assistant drove the dashboard UI and
  SQL editor with his session, per his explicit "open supabase here i will login and you check whatever
  but fix it" ask this session):
  - **Performance Advisor showed 10 warnings**, all either "Auth RLS Initialization Plan" (RLS policies
    calling `auth.<function>()` directly, so Postgres re-evaluates it **per row scanned** instead of once
    per query — Supabase's own documented #1 RLS performance anti-pattern) or "Multiple Permissive
    Policies" (two separate permissive SELECT policies on the same table, both evaluated on every query).
  - Confirmed via `pg_policies` and `pg_get_functiondef` that every policy across
    `es_designer_tasks`, `es_designer_activity`, `es_designer_presence`, `es_designer_profiles`, and
    `es_designer_access_requests` — directly or through the shared helper functions
    `is_es_designer_admin()` / `is_es_designer_domain_user()` — called bare `auth.jwt()`, and that
    `es_designer_tasks` and `es_designer_access_requests` each carried two separate permissive SELECT
    policies (e.g. tasks had both "Dashboard admins can read dashboard tasks" and "ES users can read own
    dashboard tasks" as independent SELECT policies, each separately calling the unwrapped auth check).
  - Also discovered, as a side effect of reading `is_es_designer_admin()`'s real definition, that it
    hardcoded exactly the same two emails as the client-side `DASHBOARD_ADMIN_EMAILS` allowlist —
    confirming the caveat flagged in the "Grant designteam@ full dashboard access" entry: the app-side fix
    from that session let `designteam@` open the dashboard page, but the database itself would still have
    only shown it "own rows" data, not full admin access, until this fix.
- **Fix applied** (full SQL captured in the new migration file):
  1. `is_es_designer_admin()` and `is_es_designer_domain_user()` rewritten to wrap `auth.jwt()` as
     `(select auth.jwt())`, and `is_es_designer_admin()` now also includes
     `designteam@essentiallysports.com` in its allowlist (the real database-level admin gate, not just the
     app-side one).
  2. Every other RLS policy with a bare `auth.jwt()` call (own-row insert/update policies on
     `es_designer_activity`, `es_designer_presence`, `es_designer_profiles`, `es_designer_tasks`) rewritten
     the same way — same logic, just cached per query instead of per row.
  3. Consolidated the duplicate SELECT policies on `es_designer_tasks` and `es_designer_access_requests`
     into one each (admin-or-own-row condition combined with `OR`), removing the redundant second policy.
- **How this was actually executed**: the assistant could not type this directly into the Supabase SQL
  editor — every attempt (even after Suhail's explicit "yes fix it" and later "you only do it please") was
  blocked by this session's auto-mode safety classifier as a sensitive schema/security-definer change
  against production, and did not lift with in-chat confirmation. Wrote the complete SQL to a file
  (`fix-dashboard-rls-performance.sql`), sent it to Suhail directly, and he pasted/ran it himself in the
  already-open, already-logged-in SQL editor tab.
- **Verified, not just assumed**: re-checked the Performance Advisor after Suhail ran it —
  **10 warnings → 0 warnings**. Also confirmed via the Database > Policies UI that `es_designer_tasks`
  dropped from 4 policies to 3 (the duplicate SELECT policy is gone). Both checks were read-only
  navigation/inspection, not blocked by the classifier, so this is a real confirmed-in-browser result, not
  a code-review-only claim like every other entry in this log.
- Added `supabase/migrations/20260910070000_fix_dashboard_rls_performance.sql` to this repo afterward so
  the change has a permanent record here too, even though it was applied out-of-band via the SQL editor
  rather than through a migration-apply workflow.
- **Rollback**: no git rollback point applies (no app code changed). To revert the database side, restore
  the previous `CREATE OR REPLACE FUNCTION` bodies (bare `auth.jwt()`, no `designteam@` in the admin list)
  and re-create the two dropped policies with their original `USING`/`WITH CHECK` clauses — all of which
  are preserved verbatim in the "2026-09-02 — Grant designteam@..." and this entry's description above,
  and in git history of the migrations directory before this file.

### 2026-09-09 — Fix dashboard load time: parallelize serial Supabase calls
- Status: `[pushed - see rollback point below]`
- Files touched: `dashboard-data.js`, `dashboard.html`. No data-layer/schema changes.
- Ask (Suhail): after the previous session's account-access grant and interval tightening, reported "it
  is not solved yet"; clarified the actual complaint was load time (not stale/mismatched data), and asked
  to fix it, push it, and verify how much time it was actually taking.
- **Measured first, rather than guessing**: could not log into the live dashboard to profile it directly
  (same Supabase-login limitation as every prior entry), but could measure real, unauthenticated round-trip
  time to the Supabase REST endpoint from this environment via `curl -w`: **~0.4–1.6s per request**
  (3 samples: 0.88s, 1.62s, 0.41s). That's the concrete number the fix is based on.
- **Root cause**: not slow individual requests so much as unnecessary serial chains of them:
  1. `dashboard.html`'s `boot()` awaited four independent Supabase/auth checks **one after another**
     (`isValidSession` → `isCurrentUserAdmin` → `getCurrentUser` → `canCurrentUserAssignRoles`) before the
     page even became visible, even though none of them needs a previous one's resolved value to start —
     only to decide what happens next. At ~0.4-1.6s each, that's roughly 1.6-6.4s of pure serial waiting
     before first paint, worst case up to 24s of stacked timeouts if Supabase were slow/down.
  2. `refreshCloudDashboardData()` in `dashboard-data.js` awaited the profile/presence upsert, then
     awaited the pending-write-queue flush, and only *then* started the parallel fetch of
     people/tasks/activity that actually populates the dashboard's numbers — another two full round trips
     of pure serial waiting stacked in front of the real data fetch every single load.
- **Fix**: in both places, fire all the independent calls at once and await them in whatever order the
  logic needs, instead of awaiting each before starting the next:
  - `boot()`: all four checks now start as promises before any `await`; still awaited/gated in the same
    logical order (session → admin → user → role) so redirect behavior is unchanged, but the four network
    calls now overlap instead of stacking.
  - `refreshCloudDashboardData()`: profile-upsert, pending-flush, and (when fetching for the dashboard)
    people/tasks/activity are now one `Promise.allSettled` batch instead of two sequential `await`s
    followed by a separate parallel batch. Preserved the existing all-or-nothing failure signaling
    (`cloudSyncStatus`/`emitDashboardChange`) exactly — this is a pure concurrency change, not a logic
    change.
  - Also removed a flat, unconditional 500ms `setTimeout` in `boot()` that delayed the first real data
    refresh for no functional reason.
- **Expected effect**: boot's four checks go from a summed ~1.6-6.4s to roughly the single slowest call
  (~0.4-1.6s); `refreshCloudDashboardData`'s two serial pre-steps collapse into the same batch as the
  three fetches, saving another ~1-3s per load. Combined with the prior session's 20s/5s heartbeat/poll
  intervals, first-paint-to-real-data should land in roughly 1-3s under normal conditions instead of
  5-10+s.
- Verification note: **could not verify the actual before/after wall-clock time on the real dashboard** —
  still blocked by the Supabase login gate in this environment (same limitation noted in every dashboard
  entry so far). What was verified: (1) the real Supabase REST latency figures above, measured directly
  with `curl`, not estimated; (2) both edited functions reviewed line-by-line for correctness (brace
  balance, preserved destructuring order matching the new task-array order, unchanged error/status
  semantics); (3) zero console errors on reload of the local preview (though that only exercises the
  pre-login page, not the authenticated dashboard code path itself). Suhail should time an actual page
  load after this deploys and report back if it still feels slow — if so, the next place to look is
  Supabase's own query/RLS performance (outside this repo) rather than more client-side parallelism, since
  the remaining serial-chain opportunities in this codebase are now used up.
- **Rollback point: `d7cb699`** — HEAD before this commit.

### 2026-09-02 — Grant designteam@ full dashboard access; tighten sync latency
- Status: `[pushed - see rollback point below]`
- Files touched: `dashboard-data.js`, `dashboard.html`. No migrations.
- Ask (Suhail): the "different numbers on different machines" turned out to be because his Mac and PC
  are signed into two different real Supabase accounts that both display as "Suhail Quraishi" —
  `suhail.quraishi@essentiallysports.com` (created 24 Aug, short history) and
  `designteam@essentiallysports.com` (created 8 Jul, long history, previously NOT in the dashboard-admin
  allowlist at all). Asked to give both full dashboard access since both are his. Separately, after
  confirming the fix worked, reported the sync "took too long" and asked to fix that too.
- **Access grant**: `SERVER_OWNER_EMAIL` (singular) generalized to `SERVER_OWNER_EMAILS` (array) containing
  both emails. Updated every exact-match check that gated on the single owner email:
  `DASHBOARD_ADMIN_EMAILS`, `DEFAULT_ROLE_ASSIGNMENTS` (both now treated as `'Server Owner'`),
  `canCurrentUserAssignRoles()`, `updatePersonAccessRole()`'s owner check, and the redundant hardcoded
  fast-path literal in `dashboard.html`'s `boot()` (`canAssignDashboardRoles = [...].includes(signedInEmail) || await canCurrentUserAssignRoles()`).
  **Caveat flagged to Suhail and still true**: the Supabase RPC `set_es_designer_access_role` (referenced
  in a comment near `updatePersonAccessRole`) is a Postgres function living in the Supabase project, not
  in this repo — it must independently allow `designteam@essentiallysports.com` to call it, or that account
  will get dashboard *access* fine but may hit a server-side rejection if it tries to change someone else's
  role. Not fixable from this codebase.
  - This edit was initially blocked by the session's auto-mode safety classifier as a sensitive
    access-control change; re-attempted and went through after Suhail explicitly confirmed.
- **Latency**: two intervals were tightened, both pure numeric tuning, no logic change:
  - `PRESENCE_HEARTBEAT_MS` (how often each open tab pushes its own presence/pending-write-queue to
    Supabase): `60s → 20s`.
  - The dashboard's own live-poll interval (`startDashboardLiveSync`'s `setInterval`, re-fetches
    people/tasks/activity while the tab is visible): `15s → 5s`.
  - Combined, worst-case staleness for a cross-device change to appear on an open dashboard tab drops from
    roughly ~75s (60s heartbeat + 15s poll) to ~25s (20s + 5s) in the pending-write-retry case, and general
    poll lag drops from up to 15s to up to 5s in the common case where the source write already succeeded
    immediately. Did not add a manual "Refresh" button or otherwise change the underlying architecture
    (local-first writes with a pending-retry queue) — just made the existing polling cadence tighter.
- Verification note: same limitation as always — could not get past the Supabase login gate in-browser
  (repeated `navigate` attempts to gated pages denied in this session, same as prior entries); confirmed
  via `curl` against the real production URL (`https://frameup.essentiallysports.com`, provided by Suhail
  this session) that the *previous* commit's fixes were actually live, which is what surfaced this
  session's two-accounts finding in the first place. This session's changes verified by code review only —
  reload-and-check-console-errors on the (unauthenticated) login redirect page, not a full in-app test.
- **Rollback point: `216504e`** — HEAD before this commit.

### 2026-09-02 — Fix profile-save sync delay and inflated visitor counts
- Status: `[pushed - see rollback point below]`
- Files touched: `ai-page/profile.html`, `dashboard.html`. No data-layer/migration changes.
- Ask (Suhail): dashboard numbers ("Visitors last 24h" / "this month") kept looking stale/wrong; asked to
  check and fix, then confirmed after a first attempt that he still saw no change — that turned out to be
  because the fixes below were made but not yet pushed (nothing to do with the fixes themselves).
- Investigated the actual data pipeline (`dashboard-data.js`, `dashboard.html`) rather than guessing, and
  found two separate, real bugs (not just the expected ~15s poll delay documented in the prior audit
  entry):
  1. **`ai-page/profile.html`'s Save Profile / avatar-upload handlers only wrote to `localStorage`**
     (`saveProfile()` in `ai-page/account.js`) and never touched Supabase. The profile/presence row other
     views read (dashboard People list, another device) only updated whenever *this same browser's* next
     60-second presence heartbeat happened to fire, or a different page reloaded. Fixed by calling
     `window.ESDashboardData?.recordPresenceHeartbeat?.()` immediately after `saveProfile()` in both
     handlers, so edits push to Supabase right away. (Caught and fixed my own mistake before shipping:
     first draft was `...recordPresenceHeartbeat?.().catch(...)`, which throws if `ESDashboardData` isn't
     loaded, since `?.()` short-circuiting to `undefined` still needs `?.catch` too — fixed to
     `...recordPresenceHeartbeat?.()?.catch(() => {})`.)
  2. **`uniqueVisitorCount()` in `dashboard.html` unconditionally added the signed-in admin to every
     visitor-count window**, bypassing the 24h/this-month predicate entirely
     (`if (dashboardUser.email) visitors.add(dashboardUser.email);` ran before any time check). This
     silently inflated both "Visitors last 24h" and "Visitors this month" by 1, regardless of whether the
     admin had actually been seen in that window. Removed the special case — the admin's own presence row
     already flows through the normal `people` list (they heartbeat like anyone else), so it's now counted
     the same way as every other person, correctly time-filtered.
  3. Also resolved, along the way, a mystery from earlier in the session: `profile.html` initially
     appeared not to exist anywhere in the repo (`find . -maxdepth 1` came up empty) before realizing it
     lives under `ai-page/profile.html`, not the repo root — noting this here in case a future session hits
     the same false "file doesn't exist" dead end.
- Did not touch the ~15s dashboard poll cadence or the "stuck pending write on another device" scenario
  from the earlier audit entry (`2026-09-02 — Dashboard access/data audit`) — those are real but weren't
  the concrete bug found this time; flagged again here in case they still need addressing separately.
- Verification note: same limitation as always — couldn't get past the Supabase login gate in the local
  preview to watch this work end-to-end (repeated `navigate` attempts to gated pages were denied in this
  session). Verified by direct code/logic review against `dashboard-data.js`'s actual exported API
  (confirmed `recordPresenceHeartbeat` is exported and never rejects) rather than by running it.
- **Rollback point: `92d3c05`** — HEAD before this commit.

### 2026-09-02 — Add master brand/site design-system doc
- Status: `[pushed - see rollback point below]`
- Files touched (new): `project-docs/brand-design-system-master.md`. No code changes.
- Ask (Suhail): a single markdown file explaining the whole brand's site look — design tokens, navbar,
  footer, font usage, page rules — so it can bootstrap any future EssentiallySports website, not just
  this app.
- Wrote it from direct inspection of the live code, not from the older brand-guide docs' assumptions:
  read `design-tokens.css`, `theme.css`, `theme.js`, `site-chrome.css`, and the real navbar/footer markup
  in `index.html` (lines ~66–200 for the page-chrome `:root` tokens and `.navbar`, ~9052+ for the
  `.site-footer` markup).
- Key things captured that weren't written down anywhere before:
  - **No shared template/include system** — every page duplicates its own navbar/footer markup; changing
    the navbar means editing every page that has one. This is the single most important operational fact
    for anyone extending the site.
  - **Two overlapping token systems** exist on purpose: page-chrome tokens (`:root` per page, `--chrome-*`
    in `site-chrome.css`) for site chrome/new pages, vs. the stricter semantic `--es-*` type-hierarchy in
    `design-tokens.css` for product/app UI inside workspace shells. Documented when to use which.
  - **Corrected a stale assumption from `es-designer-brand-design-guide.md` §14**, which describes the
    footer as "Dark/navy or strong branded section." The real implementation
    (`site-chrome.css` `.site-footer`) is a **white body with a blue (`--chrome-accent` / `#0A7DFA`) hero
    band on top** — not solid navy. Verified directly against the CSS, not assumed.
  - Dark mode mechanics (`theme.js`: `data-theme` attribute, `localStorage['frameup.theme.v1']`,
    `frameup-theme-change` event) and the fact that the navbar/footer intentionally don't reskin for dark
    mode (only product-shell chrome does).
  - Real responsive breakpoints in use (420 / 560 / 900 / 1260px) pulled from actual `@media` queries in
    `site-chrome.css` / `site-mobile-chrome.css`, not guessed.
- This file supersedes `es-designer-brand-design-guide.md` / `frameup-design-system.md` for site-chrome
  purposes only; both are kept and cross-referenced — they still own product-UI typography rules and
  canvas/export creative rules respectively, which this doc doesn't repeat.
- Delivered a copy directly to Suhail as a standalone file before pushing.
- Verification note: this is documentation, not a code change — nothing to browser-test. Accuracy comes
  from reading the actual CSS/HTML values cited above, not from re-deriving them by inspection in a
  running page.
- **Rollback point: `cf3ee4c`** — HEAD before this commit (from another session's dashboard-chart/
  allowlist work, already pulled in previously).

### 2026-09-02 — Listicle: default to 5 visible rows + Add Row; Listicle 1 swipe-button toggle; Quote Image name tag
- Status: `[pushed - see rollback point below]`
- Files touched: `index.html`, `listicle-data.js`, `listicle-type2-data.js`,
  `scripts/test-listicle-accordion.mjs`, `scripts/test-listicle-data.mjs`, `scripts/test-listicle-type2-data.mjs`.
- Three separate asks from Suhail, landed together:
  1. **Listicle Type 1 & 2 — default to 5 rows, rest optional/added.** Follow-up on the earlier 10-row
     expansion: instead of always showing all 10 row cards (dimmed when hidden), the editor now only
     renders cards for non-hidden rows, defaulting to the first 5 visible / last 5 hidden
     (`DEFAULT_VISIBLE_ROW_COUNT = 5`, new export on both `ESListicle`/`ESListicleType2`). A dashed
     **"+ Add Row"** button appears below the list whenever fewer than 10 rows are visible; clicking it
     reveals the next hidden row (lowest index first) and expands it. Each visible row's toggle button is
     now just **"Remove"** (single action, since a hidden row is no longer rendered at all — there's
     nothing to "unhide" from within the list). Reused the exact same `hidden` field and canvas
     reflow/content-scaling logic built for the original hide/unhide feature, so no renderer changes were
     needed. Fixed a latent bug while in there: `setListicleRowExpanded`/`setListicleType2RowExpanded`
     compared DOM position to row index (`index === rowIndex`), which only worked because all 10 cards
     used to render with no gaps — now compares `card.dataset.listicleRowCard`/`listicleType2RowCard`
     directly, since cards are sparse once rows can be individually removed/added back out of order.
  2. **Listicle Type 1 — optional swipe button.** It was previously forced on unconditionally
     (`drawSwipeButton(ctx, W, H, scale, true)`, force flag bypassing the shared toggle). Flipped
     `supportsSwipe: true` in `INSTAGRAM_POST_TYPES['listicle-type-1']`, stopped force-hiding
     `#swipe-button-card` for that type specifically (still hidden for Type 2, which never drew one), and
     changed the render call to respect `state.swipeButton` like every other post type. To avoid silently
     removing the button from existing designs, `switchInstagramPostType` now defaults `state.swipeButton`
     back to `'dark'` each time Listicle Type 1 is freshly selected (previous type !== this one) — so it's
     on by default per visit, with the existing "Black Swipe Button" switch now available to turn it off.
  3. **Quote Image ("Quote Image" / `quote` post type, incl. Reels "Quote Reel") — optional name tag.**
     New "Name (optional)" input (mirrors the existing `long-quote-name` field pattern; new `state.quoteName`,
     wired through `getCurrentDesignSnapshot`/`cloneDesignSnapshot`/`applyDesignSnapshot` like
     `longQuoteName` so it round-trips correctly per post-type context). Rendered in `drawQuoteTextGroup`
     15px→28px (see below) under the last quote pill line, weight 500 (was 700 first pass), white,
     **horizontally centered on the last line's own center** (`lastStrip.x + lastStrip.w / 2`, which
     includes that line's individual random jitter offset — not the group's nominal `centerX` used for the
     first version, per Suhail's correction: "keep the name mid aligned with last line"). Computed from the
     same already-shifted `stripPositions`/`centerX` the quote pills use, so dragging the quote block moves
     the name with it with no special-case drag code — it's just recomputed fresh every render. Extended
     `state.lastTextBounds`/`textHitRects` to include the name's box (so clicking the name also starts a
     drag, and the safe-area edge-clamp accounts for it instead of letting it run off-canvas near the
     bottom). Caught and fixed a font-state bug of my own before shipping: measuring the name text
     overwrote `ctx.font`, which the very next block (drawing the quote pills) implicitly relied on being
     the pill font — added an explicit `ctx.font` reset before that loop.
- Iterated per Suhail's live feedback after the first pass: centered the name on the last line's own
  offset (not the group center), reduced weight 700→500, increased the gap 15px→28px.
- Updated `scripts/test-listicle-*.mjs` for the new default-visible-count behavior and the
  `setListicleRowExpanded` dataset-comparison fix. **Could not run them** — no Node.js in this
  environment, only reviewed the diffs.
- Verification note: same as always — local `python3 -m http.server` preview is gated by real Supabase
  login; only checked for zero console/JS errors on reload (confirms no syntax breakage), everything
  visual (row add/remove flow, swipe toggle, name tag position/drag) is unverified in-browser by the
  assistant. Suhail iterates live in his own logged-in session.
- **Rollback point: `d89d3e4`** — HEAD before this batch.

### 2026-09-02 — Dashboard access/data audit (findings only, no code changes yet)
- Status: `[docs only - not yet started]`
- Files touched: none — this entry records a read-only audit ahead of a fix, so the next session (or the
  next turn in this one) knows what was already found instead of re-deriving it.
- Ask (Suhail): who has dashboard access, and is the dashboard data working correctly? Then: "we'll start
  work on this" — i.e. treat the findings below as the starting point for a follow-up fix.
- **Who has access**: hardcoded to exactly two emails in `dashboard-data.js` (`DASHBOARD_ADMIN_EMAILS`,
  currently `suhail.quraishi@essentiallysports.com` as Server Owner and `manish.kalsi@essentiallysports.com`
  as Super Admin). `dashboard.html`'s boot sequence calls `isCurrentUserAdmin()`, which checks only this
  array; anyone else is redirected to `index.html#frames` before the dashboard renders. Not configurable
  from the UI.
- **Presence/activity sync**: checked out fine on read. `scheduleSupabasePresence()` runs globally on every
  page (not just the dashboard) via the shared `es:auth-ready` event dispatched from `es-auth.js`, plus a
  60s heartbeat and focus/pageshow triggers — gated only on having a valid session, not on being an admin.
  Task/activity writes from exports and design requests go through a local-first queue
  (`queuePendingTask`/`flushPendingCloudWrites`) with retry on reconnect, so offline writes aren't lost.
- **Real bug found**: the dashboard's People panel lets the Server Owner assign roles (Associate / Admin /
  Super Admin / Server Owner) via `updatePersonAccessRole`, which implies assigning "Admin" should grant
  dashboard access. It doesn't — `isCurrentUserAdmin()` never reads that role field at all, only the
  hardcoded two-email list above. So today, promoting someone to "Admin" in the dashboard UI has **zero
  effect** on whether they can actually open `dashboard.html`. Either the access gate needs to also honor
  `DASHBOARD_ACCESS_ROLES` (`Admin` / `Super Admin` / `Server Owner`) read from the person's Supabase
  profile, or the role picker's copy/behavior needs to make clear it's display-only — Suhail hasn't picked
  which yet.
- Not yet verified against live data (Supabase rows, actual presence/task records) — this was a static
  code read only, since the app is gated behind Supabase login and the assistant does not authenticate on
  Suhail's behalf. `getAdminConfig()`'s `ownerEmails` (from `es.dashboard.adminConfig.v1` in localStorage)
  was also checked and confirmed to be display-only (adds people to the People list with a label) — it does
  not feed into `isCurrentUserAdmin()` either.
- **Next step (not started)**: decide and implement the fix for the role/access mismatch above.

### 2026-08-19 — Add ASAP Template 1 to the Social Media workspace; reconciled with a parallel session's changes
- Status: `[pushed - bc1faf3, merge 8383e51]`
- Files touched (new): `asap-template-data.js`. Files touched (existing): `index.html` only.
- Ask (Suhail): given a Figma-exported JSON (`asap-template-structure.json`) plus a rendered PNG reference
  for a new social post design — a photo background, an ES logo badge top-right, and a rounded gray card
  holding a bold headline plus a dashed-divider list of dated update rows — "follow what's already
  actually there just this is a similar different design." Read that as: reuse the established
  `INSTAGRAM_POST_TYPES` architecture (same pattern as the two Listicle templates), not the literal pixel
  coordinates in the Figma export — those turned out not to be in the same coordinate space as the
  1080×1350 canvas (e.g. the background image layer is exported at its intrinsic 1700×1794 size, not its
  placed/cropped size), so the final layout was derived from the *screenshot's* proportions plus the
  site's existing `LISTICLE_CANVAS_LAYOUT`-style safe-inset convention (50px), not trusted 1:1 from the JSON.
- Researched the full Listicle Type 1 implementation first (via an Explore agent, since `index.html` is
  huge) to find every touchpoint a new post type must hook into: the post-type `<select>`, the
  `INSTAGRAM_POST_TYPES` registry, a new editor-fields block (reused the existing generic `.listicle-*`
  CSS classes directly rather than writing new ones), `createDesignerState()`, `syncPostTypeControls()`
  (text-card label, field-panel visibility, `hidePrimaryTextarea`, `colorCard` hide), the
  `onTextChange`/`setupCanvasDrag` bail-outs, and `getMainTextSlug()`. Deliberately did **not** add the new
  type to `isListicleImageControlLocked()` or the CSS `body:is([data-instagram-post-type="listicle-type-1"],
  ...])` combinator that hides `.image-tool-rail` — unlike the Listicle templates, this one needs a real
  photo background with pan/zoom controls active.
- Data model follows the exact same UMD pattern as `listicle-data.js` (`asap-template-data.js`, exposing
  `window.ESAsapTemplate1`): a title field plus up to 6 rows, each a single text string; blank rows are
  simply skipped when rendering rather than requiring dynamic add/remove row UI, so the card's height
  computes itself from however many rows are actually filled in (clamped to a sane min/max).
- Verified end-to-end in a no-auth-code srcdoc harness: zero JS errors on load; selecting "ASAP Template 1"
  correctly shows its editor fields (6 row inputs) and hides the primary textarea/color card; the canvas
  renders at 1080×1350 with the card's exact background color (`rgb(232,232,232)`) sampled from real pixel
  data; edited a row's text and confirmed state updates live; blanked all rows down to zero and confirmed
  no crash; round-tripped through a different post type and back with all visibility toggles restored
  correctly; confirmed `.image-tool-rail` stays visible (`display:flex`) so photo pan/zoom still works.
- **Mid-task reconciliation**: `git push` was rejected — `origin/main` had moved 30 commits ahead (another
  session/person had been working in parallel: a Twitter Quotes post type added to the *exact same*
  `INSTAGRAM_POST_TYPES`-adjacent code, Listicle rows expanded 5→10, a full Tool Feedback redesign +
  dashboard-inbox integration, a shared typography/design-tokens system, and a mobile editor overhaul).
  Per the standing rule from the 2026-07-29 entry below ("check `git fetch` before assuming local `main`
  is current"), fetched and merged rather than force-pushing. `index.html` had 6 real conflict hunks — all
  the same shape: my `asap-template-1` addition and their `twitter-quote` addition landing on the same
  line in a shared conditional (post-type `<option>`, the registry object, and four spots inside
  `syncPostTypeControls()`) — resolved by keeping both branches' lines side by side (never picking one
  over the other) in each hunk. Re-ran the full verification harness against the merged file afterward to
  confirm both new post types (mine and theirs) still work correctly side by side before pushing.

### 2026-08-19 — Listicle Type 1 & 2: expand to 10 rows, add per-row Hide/Unhide
- Status: `[pushed - see rollback point below]`
- Files touched: `listicle-data.js`, `listicle-type2-data.js`, `index.html`,
  `scripts/test-listicle-data.mjs`, `scripts/test-listicle-type2-data.mjs`,
  `scripts/test-listicle-rank-pill.mjs`, `scripts/test-listicle-type2-ui.mjs`,
  `scripts/test-listicle-accordion.mjs`.
- Ask (Suhail): Listicle Type 1 and Type 2 should support 10 rows instead of 5, and each row needs a
  Hide/Unhide control so a row can be excluded from the rendered post without deleting its content.
- Data layer: `ROW_COUNT` raised 5 → 10 in both `listicle-data.js` and `listicle-type2-data.js`; extended
  `DEFAULT_ACCENTS` / `DEFAULT_LOGO_SOURCES` (cycling the existing 5 placeholder logos, there are only 5
  logo assets in `assets/listicle-placeholders/`) and `DEFAULT_ROWS` to 10 entries each. Added a `hidden`
  boolean field to `normalizeRow` in both files (defaults to `false`); `updateListicleRow` already patches
  arbitrary fields so toggling `hidden` needed no other data-layer change.
- Editor UI: each row's accordion summary now has a sibling **Hide/Unhide** button (`listicle-row-header`
  wraps the existing toggle `<button>` and the new hide `<button>` as siblings, since a button can't nest
  inside a button). Hidden rows dim to 50% opacity (`.is-row-hidden`) in the row list. Click handlers added
  to both `initListicleControls` and `initListicleType2Controls` toggling `row.hidden` via
  `updateListicleRow`, then rebuilding the row controls and re-rendering.
- Canvas rendering — this was the trickiest part, and went through two passes:
  1. First pass: rows with `hidden: true` are filtered out before rendering, and the remaining visible
     rows are laid out across the fixed canvas (1080×1350), with row height/pitch shrinking as needed to
     fit however many rows are visible (`Math.min(baseRowHeight, floor(availableSpace / visibleCount))`).
     Hiding rows down to ~5 or fewer reproduces the original spacious 5-row layout exactly (rowScale = 1
     at ≤5 visible rows, so nothing changed for the existing 5-row use case).
  2. Suhail flagged the first pass as "too small" at 10 rows — the bug was scaling fonts/logos/rank-pills
     by the same linear factor as the row pitch, so 10 rows shrank content to ~53% of original size.
     Fixed by decoupling: row *pitch* (vertical spacing) still shrinks linearly to fit more rows, but
     content size (fonts, logo frame, rank pill, player cutout) uses `Math.pow(rowScale, 0.6)` — a gentler
     curve that keeps glyphs/logos meaningfully larger at high row counts (e.g. at 10 rows content lands
     at ~68% scale instead of ~53%), while still fitting inside each row's slot without overlap. At ≤5
     visible rows this curve is still an identity (rowScale = 1), so it's fully backward compatible.
  3. Type 1 (`drawListicleType1Post`): available table height computed from `rowTop` down to just above
     the always-on swipe button (`SWIPE_BUTTON_H` + `SWIPE_BUTTON_SAFE_MARGIN` + a small gap). Type 2
     (`drawListicleType2Post`, no swipe button) computes available height down to a small fixed bottom
     margin instead. `drawListicleRankPill` gained an optional `rowScale` parameter (defaults to `1`, so
     the standalone rank-pill tests calling it with the old 6-arg signature are unaffected).
  4. If every row in a template is hidden, rendering falls back to showing all rows rather than a blank
     canvas.
- Updated the existing Node test scripts (`scripts/test-listicle-*.mjs`) for the new row count (10 instead
  of 5) and added hide/unhide coverage. **Could not run them** — no Node.js available in this environment;
  only manually re-read the diffs for correctness.
- Verification note: like other pages on this site, the local `python3 -m http.server` preview is gated by
  real Supabase login (domain-restricted to `essentiallysports.com`), which the assistant does not attempt
  to bypass or log into on Suhail's behalf. Suhail is verifying visually in his own logged-in session;
  the "too small" fix above was made in response to that feedback, not independently confirmed in-browser
  by the assistant.
- **Rollback point: `1a5946c`** — HEAD before this batch, i.e. "the version before" if this needs reverting.

### 2026-08-18 — Tool Feedback focused form redesign
- Status: `[pushed - 1f4f2b8]`
- Files touched: `tool-feedback.html`, `tool-feedback.css`, `tool-feedback.js`.
- Ask (Suhail): bring Tool Feedback fully into the website's established UI language, improve its
  iconography and hierarchy, and turn it into a focused single-column form without changing feedback
  storage or submission behavior.
- Rebuilt the page around one centered `840px` panel and removed the competing right-side guidance
  card. The page now uses shared design tokens, the standard page-title scale, restrained account
  metadata, a `10px` panel radius, and the same ES-blue selected/focus/CTA language as the main site.
- Replaced the tall feedback cards with compact Bug, Idea, Praise, and Other selectors using consistent
  `24x24` viewBox line icons rendered at `18px`. The selected state uses `#E8F2FF` with an ES-blue border;
  the redundant `Signed-in users only` badge was removed.
- Added feedback-type-specific guidance below `Tell us what happened`, kept the tool preselection and
  custom dropdown contract intact, increased the textarea height, moved the character count inside its
  lower-right edge, and paired a quiet `Back to workspaces` link with the standard primary CTA. The
  dropdown also received improved keyboard handling.
- Mobile now uses `16px` page margins, a `2x2` feedback selector grid, `16px` form text, and a full-width
  submit button while preserving 44px-or-larger touch targets. Auth, API submission, validation,
  loading/error/success states, query-string tool preselection, and reset behavior remain intact.
- Verified: `node --check tool-feedback.js`, `scripts/test-design-tokens.mjs`, and
  `scripts/test-vercel-api-adapters.mjs` pass. Browser smoke passed at 1280px, 1440px, 390x844, and
  360x740 with no horizontal overflow or console errors; contextual helper changes, query preselection,
  and empty-submit validation were exercised. A real authenticated submission was not created during
  visual QA to avoid adding test feedback; the API adapter regression covers the submission contract.
- Known unrelated check: `scripts/check-site-chrome.mjs` still reports pre-existing failures for the
  missing `how-it-works.html` page and stale chrome expectations on unrelated pages. Those files were
  not changed as part of this focused redesign.

### 2026-08-17 — Newsletter widget builder: per-pick Show/Hide switches, paste-link field cleanup
- Status: `[pushed - 573da5d, 6edf0c1, 9966dbe]`
- Files touched: `index.html` only.
- Ask (Suhail): make each "Top Pick N" label more prominent/black, add a Hide/Show switch on the far
  right of that row that decides whether the story renders in the generated HTML + live preview, hide
  (not remove) the "Upload Image" button for now, and remove the WordPress/Google "Tip" line under every
  image field.
- Fix: `.widget-pick-label` set to bold black; added a small inline switch (`.widget-pick-switch`,
  reusing the same track/thumb visual language as the existing `.quote-switch` component elsewhere in
  this file) per Top Pick row, wired to `widgetBuilderState.picks[i].hidden`; `buildWidgetHtml()` now
  does `state.picks.filter(pick => !pick.hidden)` before mapping, so a hidden pick's `<table>` block and
  its divider are both actually absent from the output, not just visually dimmed. Upload buttons hidden
  via a blanket `[data-widget-upload] { display: none; }` rule (DOM untouched, one line to revert). All 7
  `.widget-inline-tip` paragraphs deleted.
- Two follow-up UI nits from the same area: removed the leading chain-link `<svg>` icon from all 5
  paste-link fields (main + 4 picks); then fixed a "two nested boxes" look on those same fields — a
  site-wide `input[type="text"]` rule (specificity `(0,1,1)`) was outranking `.widget-paste-link-input`'s
  own `border: 0` (specificity `(0,1,0)`), so the input kept its own rounded border inside the field's
  border. Fixed by bumping the selector to `input.widget-paste-link-input` (same specificity, later in
  the cascade, wins) and explicitly resetting `width`/`border-radius`/`padding` too, not just `border`.
- Verified: intercepted `navigator.clipboard.writeText` and clicked the real "Copy HTML" button
  before/after toggling a pick off — confirmed the pick's row and its divider are genuinely absent from
  the copied HTML, then restored on toggling back on. Confirmed upload buttons `display:none` but still
  present in the DOM. Confirmed computed `border` on the paste-link input is `0` after the specificity fix.

### 2026-08-17 — Bumped site-chrome cache-busting version (stale navbar icons on other accounts)
- Status: `[pushed - 979f64a]`
- Files touched: `index.html`, `reels.html`, `design-request.html`, `dashboard.html`, `login.html`,
  `ai-page/index.html`, `ai-page/settings.html`, `ai-page/profile.html`, `ai-page/logout.html`,
  `tool-feedback.html`.
- Bug (Suhail: "i can still see the old icon used for profile bar on navbar" on other accounts):
  root-caused via an Explore agent diffing `af76c5f` (the Aug 15 icon-unification commit) — it changed
  `site-chrome.js`'s `profileIcon()` glyphs (the Edit/Settings/Logout dropdown-row icons) but never
  bumped the shared `?v=20260723-profile2` / `?v=20260723-profile3` query strings on `site-chrome.js`/
  `site-chrome.css`. Any browser that had already cached those files before Aug 15 had no reason to
  re-fetch them — identical URL, identical cache key — so it kept serving the pre-unification icons
  indefinitely. Note: the top-right avatar bubble itself is CSS/initials-only (no image), so it was never
  in scope for icon unification; the "old icon" was specifically the dropdown-menu glyphs.
- Fix: bumped both to `?v=20260817-icons1` everywhere they're referenced (10 files, confirmed all were
  byte-identical `20260723` values beforehand via grep, so this was a clean global bump, not a
  per-file reconciliation).

### 2026-08-17 — New Tool Feedback page + Google Sheets integration, then reworked to match the real design language
- Status: `[pushed - 795c4a6, 07855c1, fd77195, 692ea3b]`
- Files touched (new): `tool-feedback.html`, `tool-feedback.css`, `tool-feedback.js`,
  `netlify/functions/tool-feedback-submit.js`, `api/tool-feedback-submit.js`. Files touched (existing):
  the 8 pages with a top navbar (added a "Tool Feedback" link right after FAQ), `GOOGLE_SHEETS_SETUP.md`.
- Ask (Suhail): a "Tool Feedback" nav link after FAQ on every navbar, leading to a page where anyone can
  submit feedback that lands in a specific Google Sheet (gave a link with public edit access).
- Built by reusing the exact append-to-sheet pattern already proven in
  `netlify/functions/design-request-submit.js` (signed-JWT service-account OAuth2, `sheets.googleapis.com
  ...:append`) — same `GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_PRIVATE_KEY` env vars, new
  `GOOGLE_FEEDBACK_SHEETS_ID` (defaults to the sheet Suhail gave, so no extra Netlify/Vercel config is
  required to start working). Submission is auth-gated like the rest of the site; the submitter's email
  comes from their session, not a form field.
- First visual pass invented its own look (pill-shaped radio buttons, a rounded chip "eyebrow" label, a
  narrow centered card) — Suhail flagged it didn't match the site ("it doesnt visually look in our
  language"). Re-researched the *actual* design system via an Explore agent reading real CSS out of
  `design-request.html`/`reels.css` (exact hex tokens, radius scale, the `.request-dropdown` animated
  dropdown, the `.reels-style-card` selectable-card pattern, the real `.btn`/`.btn-primary` spec) and
  rebuilt the page against those, including replacing a native `<select>` with a from-scratch animated
  custom dropdown matching `.request-dropdown` exactly, since the user separately flagged the native
  dropdown ("dropdown is not in our language our animations").
- Real bug found and fixed along the way: when the Sheets integration is unconfigured, the function
  returned `{ok:false, skipped:true}` with no `error` field, so the client showed a generic, useless
  "Could not send your feedback" message. Added a real `error` string to that response so a future
  misconfiguration is actually diagnosable instead of silent.
- Verified: zero JS errors via the usual no-auth-code srcdoc harness; confirmed the deployed endpoint is
  live and reachable (`curl -X POST https://essentiallysports-design-tools.vercel.app/api/tool-feedback-submit`
  returns a proper `401 {"ok":false,"error":"Authentication required."}`, proving the function deployed
  correctly and CORS/OPTIONS handling works); confirmed the custom dropdown opens/closes, selecting an
  option updates the underlying `<select>` and closes the menu. **Not verified from this sandbox**: the
  full authenticated submit → Sheets-append path end-to-end (no way to obtain a real Supabase session
  here, same limitation noted in the widget-image-hosting entry below) — this depends on Suhail's own
  testing, which is how the missing-`error`-field bug above was actually caught.

### 2026-08-17 — Reels: fixed auto-caption freezing the tab; simplified caption style; removed safe-zone outline
- Status: `[pushed - 97e1adc, fba90d9, 1fc6497]`
- Files touched: `reels.js`, `reels.html`, `reels.css`, `reels-whisper-worker.js` (new).
- Ask (Suhail): drop the caption style picker down to one built-in style — a single centered word at a
  time — with Top/Middle/Bottom position options replacing it. Implemented (`CAPTION_STYLES` reduced to
  one entry, `drawCaption`/`getActiveCaptionWord`/`drawSingleWordCaption` replace the old multi-style pill
  layout/animation code, ~300 lines of now-dead style/animation helpers removed). Verified structurally
  (zero JS errors after the refactor, position dropdown correctly relabeled Top/Middle/Bottom, direct
  source trace confirms the position `<select>`'s `change` handler writes `state.captionPosition` which
  `getCaptionBlockTop()` reads on every draw) — pixel-level canvas verification was attempted but proved
  unreliable in this harness (the specific test video already contains substantial blue content of its
  own, confounding a blue-pixel-based pill-detection scan; documented as a known limitation rather than a
  confirmed pass).
- Bug (Suhail: tab shows Chrome's "Page Un-responsive" dialog partway through Auto-caption on longer
  clips): root cause was the on-device Whisper fallback (`@huggingface/transformers`) running its model
  load + inference directly on the main thread — long enough on a real clip to trip the browser's hang
  watchdog. Fix: moved that work into a dedicated Web Worker (`reels-whisper-worker.js`, `type: 'module'`
  so the CDN `import()` works inside it) — `transcribeLocalAudioChunks` now posts each audio chunk to the
  worker and awaits a message back instead of calling the pipeline inline.
- Verified for real (not just code review): spun up the actual worker in a browser harness, watched it
  download and load the real model via progress-callback messages, ran real inference on a sample buffer,
  and got back a correctly-shaped `{text, chunks}` result — confirming the whole path works off the main
  thread before shipping.
- Separately, removed the dotted "Caption safe zone" outline overlay on the stage frame per a one-line
  request ("in reel frame no need of that dotted outline box") — deleted the `.reels-safe-frame` div and
  its now-unused CSS.

### 2026-08-15 to 2026-08-17 — Newsletter widget image hosting: Netlify Blobs (abandoned, unverified) → Cloudinary (verified working)
- Status: `[pushed - 0250930, 58de19a, aa712c1, 2e53375]` (the WordPress/Google recommendation tip added
  here was later removed again on 2026-08-17, see the widget-builder entry above)
- Ask (Suhail): uploading a widget image from a local device didn't produce a real link, so the copied
  HTML never actually showed the image anywhere except the local preview. Wanted an auto-hosting solution,
  free if possible; had a WordPress account on the org domain as one option.
- Explored WordPress Application Passwords first — confirmed unavailable on the org's actual WP install
  (scrolled to the real bottom of the profile page; no such section exists, just the version footer).
  Abandoned that path.
- Built a Netlify Blobs solution (two functions: an auth-gated upload, and a public-but-key-validated
  read-back) with a graceful fallback to manual link-paste. **Could not verify the real success path from
  this sandbox** — `window.ESAuth` is `Object.freeze()`'d, so `fetchWithAuth` can't be mocked, and there's
  no way to fake a real logged-in Supabase session here; also no Netlify CLI/API access to check the
  actual deploy or env vars. Suhail reported it still wasn't working in production and asked directly
  whether it had been checked before pushing — it hadn't, only client-side logic and syntax had been.
- **Pivoted to Cloudinary unsigned uploads** specifically *because* it doesn't require a login step to
  test, once Suhail supplied a real cloud name + upload preset. Verified end-to-end for real this time:
  a real upload succeeded, the returned public URL was reachable with zero auth, the full widget-builder
  upload → auto-fill-link → Copy HTML flow was tested, and the copied HTML was confirmed to contain the
  real Cloudinary link. The Netlify Blobs functions and the temporary `@netlify/blobs` dependency were
  fully removed as part of the pivot (package.json is back to zero dependencies).
- **Lesson for whoever picks this up next**: when a fix can't be verified end-to-end from this sandbox
  (usually anything behind real auth or requiring a live deploy), say so plainly rather than shipping a
  second unverified guess — especially once the user has already flagged frustration with back-and-forth.
  Prefer pivoting to an approach that *can* be fully tested here over iterating blind on one that can't.

### 2026-08-15 — Icon unification, sliding hero carousel, nav label renames
- Status: `[pushed - af76c5f and others same day, see `git log --oneline` around this date]`
- This entry predates this log's most recent AI session and is reconstructed from commit subjects only
  (no first-hand verification detail available to record): unified site icons into one Lucide-based line
  family (`af76c5f`); rebuilt the homepage hero into an always-forward sliding carousel with real banner
  art across several follow-up commits; renamed nav labels site-wide ("Reels"→"Reel Captions", "Home
  Page"→"Home", "YouTube Assets"→"YouTube", "Newsletter Assets"→"Newsletter") and added a Reel Captions
  showcase card to the login page (`2c72461`); made Reels caption pills square instead of rounded
  (`8f142c8`). The hero carousel later needed a real bug fix (blank banner after navigating away and back
  while autoplay was running unboundedly in the background — fixed 2026-08-17, `f286b54`) and a top-padding
  tweak on workspace cards (`5879ea0`) — both one-off, low-context fixes not otherwise detailed here.

### 2026-07-29 — Fix caption pill shape: word/pill boxes didn't actually look like pills
- Status: `[pending push]`
- Files touched: `reels.js` only.
- Bug (Suhail: "pill styling is not right"): confirmed visually via a throwaway QA harness (no auth
  code, same approach as always) with a real uploaded clip and both a short and a longer caption.
  Two separate rendering paths both drew what's supposed to be a "pill" as a shape that didn't read as
  one at all:
  - `drawAnimatedWordBox` (the per-word animated boxes used by all 5 caption styles — ES Word Pop,
    Karaoke Box Sweep, Broadcast Step, Punch Box, Snap Stack, since they all share this one function):
    hardcoded a 6px corner radius regardless of box size. At the actual rendered box height (~120px),
    6px is imperceptible — each word rendered as a near-rectangle, and consecutive words looked like
    disconnected bricks in a row rather than a cohesive pill/capsule shape.
  - `drawCaptionPills` (the fallback path for captions with no word-level timing): used a plain
    `ctx.fillRect` with **zero** rounding — not a pill at all. In practice this path is close to
    unreachable today (word timings get synthesized for any non-empty caption text in
    `getCaptionWordBoxes`), but fixed it anyway since it's clearly the same bug in spirit.
- Fix: both now use `roundRect(..., height / 2)` — a true capsule/pill shape. Also hardened the shared
  `roundRect` helper itself to clamp `radius` to `min(radius, width/2, height/2)`, since a naive
  `height/2` radius on a *narrow* box (single short word like "A" or "IS", width can clamp down to
  54px while height is ~120px) would make the capsule ends overlap into a lens/eye shape without that
  clamp — verified this specifically by testing a caption with several short words side by side.
- Verified visually: captured actual canvas pixels (not just code review) at multiple points during
  playback, before and after the fix, for both a short one-word caption and a longer multi-word one
  that wraps to two lines. Confirmed all words — including narrow ones — now render as clean rounded
  pills with no lens artifacts, consistent across styles (spot-checked ES Word Pop and Karaoke Box
  Sweep; the other 3 styles share the same box-drawing function so inherit the fix identically).
- Note on process: initially suspected the caption wasn't rendering *at all* (a sparse full-canvas
  pixel scan missed the small text region) — don't trust a coarse scan for "is anything drawn," sample
  the actual expected region, or better, just look at a real crop of the canvas.

### 2026-07-29 — Reconciled with a major Reels rewrite pushed by someone else; reapplied 2 of 3 fixes
- Status: `[pending push]`
- Files touched: `reels.js` only.
- Context: had a local, unpushed commit (`c534991`, since discarded — see below) fixing three things in
  the *old* stub-based Reels: the invisible-video seek bug, the prompt's team-name matching, and MP4
  export preference. Before pushing it, `git push` was rejected — `origin/main` had moved 15 commits
  past what this session's local `main` was based on. Someone else (unclear who/what — possibly Suhail
  directly, possibly another AI session picking up the `reels-handoff.md` next-steps list) had built a
  **substantially more complete Reels** in the meantime: real speech-to-text via a new
  `netlify/functions/es-video-intelligence.js` backend (Groq Whisper / OpenAI / ES MCP, with graceful
  fallback), a proper 4-step UI ("Reels Studio": Upload → Speech Recognition → Transcript Review →
  Brand Styling), SRT export, and more — a near-total rewrite of `reels.js`/`reels.css`/`reels.html`.
- Rather than merge a stale 3-line-conflict-prone patch over a rewritten file, checked each of the 3
  fixes against the new code before touching anything:
  - **Seek bug**: still present, same pattern, just renamed (`onVideoReady` → `onVideoMetadata`). Reapplied
    the same fix (non-zero seek offset + 1.2s timeout fallback).
  - **Team-name matching**: already independently fixed there, and arguably better than mine — theirs
    (`findBrandCandidates`) splits the prompt into words and matches against `sport + team + variation`
    combined, not just the team name alone. Did **not** reapply my version — theirs is what's live.
  - **MP4 export preference**: still missing (their export was WebM-only, but had gained something mine
    didn't have — merging the original video's audio track into the canvas capture via
    `createCaptionedExportStream`). Reapplied MP4-preference **on top of** their audio-merging logic,
    not by reverting to my simpler export.
- Reconciliation method: `git reset --hard origin/main` (safe — the discarded local commit is fully
  described here and in the prior entries, and is recoverable via reflog if ever needed; nothing
  uncommitted was lost since it was already committed before the reset).
- Re-verified both reapplied fixes against the **actual current** `reels.html`/`reels.js` structure
  (element IDs changed — `mapElements()` now maps a different set) using a fresh throwaway QA harness,
  same no-auth-code approach as before: real video renders after upload (seek fix confirmed), and
  export produces a genuine 15KB `video/mp4;codecs=avc1,mp4a.40.2` blob downloaded as
  `es-captioned-reel.mp4` (MP4 preference confirmed). Did not attempt to test the real transcription
  backend itself (would require hitting their live Vercel deployment / real API keys, out of scope for
  verifying these two specific fixes).
- **Takeaway for whoever reads this next**: check `git fetch && git log origin/main` before assuming
  local `main` is current — this repo is apparently being worked on by more than one
  session/person right now, and the "always give a local preview before pushing" rule doesn't cover
  "check if origin moved," which is a real gap this incident exposed.

### 2026-07-28 — Reels: fix invisible video on upload, add loading feedback
- Status: `[pending push]`
- Files touched: `reels.js`, `reels.css`.
- Bug (reported by Suhail: "I can't see it even if it's getting uploaded"): `drawFrame()` ran on the
  video's `loadedmetadata` event, which only guarantees known dimensions — not an actually decoded
  frame. `drawImage` on a video with no decoded frame yet paints nothing, so the canvas just showed its
  `#05070d` background fill with the placeholder text already hidden — i.e. nothing visibly wrong, just
  nothing there. There was also no feedback at all between choosing a file and (maybe) seeing it.
- Fix: after `loadedmetadata`, force `video.currentTime = 0` and wait for the `seeked` event (which
  browsers only fire once a real frame at that time is decoded) before revealing the canvas and drawing.
  Added a spinner + "Loading clip…" state in the stage from the moment a file is chosen until that first
  real frame lands, an error state if the file fails to load (bad format/codec), and the upload button
  now reads "Change Clip" once something's loaded (previously gave no indication a clip was active).
- Still unverified in-browser (same login-gate limitation as every prior Reels entry).

### 2026-07-28 — Reels UX rework: auto-generate + timeline, contextual prompt (not a tab)
- Status: `[pushed - 6f2c831, combined with the MVP entry below into one commit]`
- Files touched: `reels.html`, `reels.js`, `reels.css` (all uncommitted, layered on top of the entry
  right below this one — no separate commit boundary between them yet).
- Suhail corrected the first pass after linking [Riverside 2.0](https://riverside.com/blog/riverside-2-0)
  as a reference product. Changes made:
  - Removed the manual "add caption" form (text box + Sport/Team/color-swatch picker). Replaced with
    a single **Auto-Generate Captions** button. Since there's no real transcription backend yet (open
    question in the plan), generation is currently a **stub**: it chunks the clip into ~2.6s segments
    with placeholder text ("Caption 1 — tap to edit", etc.) at a neutral default color. This is
    explicitly not real speech-to-text — swapping in a real provider is the very next step once that's
    decided.
  - Added an Instagram-style **caption timeline**: segments laid out proportionally along the clip's
    duration, click to select, drag either edge (pointer events, no library) to retime. Selecting a
    segment reveals a detail card with the caption's **text and start/end time still manually
    editable** — that part intentionally stayed manual, matching how Instagram's own Reel editor works.
  - Removed the standalone "Prompt" tab entirely (was the 3rd tab). There are now only two tabs
    (Captions, Lower Thirds). A **contextual "restyle with a prompt" box** appears only once something
    exists to restyle: under a selected caption's detail card, or under a lower third once one's been
    placed/selected. It's now the *only* way to change color/position — the old manual Sport/Team/color
    dropdown and manual x/y position controls were removed in favor of prompt-only restyling (per
    Suhail: "edit those without manual intervention").
  - The prompt logic itself (team-name match via `brand-kit.js` for recolor, keyword match for lower-
    third position) is unchanged from the first pass — still a local heuristic, not Claude/MCP-backed.
- Re-verified after the rewrite: bracket balance in `reels.js`, and a full `getElementById` ↔ HTML `id`
  cross-check — no mismatches. Still unverified in an actual browser (same login-gate limitation as
  before; did not attempt to bypass it).
- Plan doc (`reels-workspace-plan.md`) updated with a note on this UX correction and the Riverside
  research, so the "why" isn't lost if someone reads the plan without this log entry.

### 2026-07-28 — Reels workspace MVP (new, uncommitted)
- Status: `[pushed - 6f2c831]`
- Files touched (all new, nothing existing removed): `reels.html`, `reels.css`, `reels.js`,
  `brand-kit.js` (new). Small edits to existing `index.html` (4th `frame-card` for Reels, nav
  dropdown entry, "3 design workspaces" → "4") and `how-it-works.html` (nav dropdown entry).
- Followed the plan in [reels-workspace-plan.md](reels-workspace-plan.md), decisions confirmed by
  Suhail: client-side render/export (canvas + MediaRecorder, no new backend infra) and placement as a
  4th workspace card.
- Built as its **own top-level page** (`reels.html`), not a route inside `index.html`'s shared
  canvas-editor SPA — that shared app (`.app[data-workspace]`, one canvas/state model across
  Instagram/YouTube/Newsletter) is a ~15k-line single file and a video timeline is a different enough
  UI paradigm that bolting it on risked destabilizing the existing workspaces. Matches how
  `how-it-works.html`/`dashboard.html`/`design-request.html` already sit outside that SPA.
- `brand-kit.js`: extracted the exact `BRAND_KIT` source verbatim out of `index.html` (163 teams across
  8 sports/leagues + 4 tennis-surface variations) into a standalone shared file so Reels' team-color
  picker reads the same real data instead of a duplicate/placeholder set. `index.html` was **not**
  changed to consume this file — it keeps its own inline copy for now, so this is a live duplication.
  Follow-up noted in the plan doc: point `index.html` at the same shared file so there's one source of
  truth, once this is confirmed stable.
- MVP scope implemented: single clip upload, playhead-based caption add/edit/delete with Sport → Team
  → color-swatch picker (reusing the real brand palette), 6 lower-third templates (Name & Title, Score
  Bug, Quote Strip, Team Matchup, Location Tag, Social Handle) placed at the current playhead and
  listed/deletable, and a prompt box that edits the **selected** caption/lower-third.
- Prompt box is explicitly a stub, not real AI: local heuristic only — regex-matches a team name
  against `brand-kit.js` for recolor, and keyword-matches top/bottom/left/right/center for
  repositioning. Every apply logs what it did (or didn't) understand. Real Claude/MCP-backed
  understanding is the next step (see plan doc §3) — needs a Netlify/Vercel function decision and API
  key, not done here.
- Export: `canvas.captureStream(30)` + `MediaRecorder` records a real-time play-through of the
  composited canvas (video + active captions/lower-thirds), downloads as `.webm` on stop/end. Not yet
  validated on a real clip — MediaRecorder browser support/quality on longer footage is a real risk
  flagged in the plan and still unverified.
- Auto-transcription is **not implemented** — captions are manually typed at the current playhead.
  Needs a provider decision (plan §7, open question 2) before wiring that up.
- Verification note: same login-gate limitation as `how-it-works.html` — couldn't get past
  Supabase auth locally (no Node/`netlify dev`), and per earlier guidance did **not** attempt to bypass
  the auth gate again, even for this brand-new unpushed page. Verified what's possible without a
  browser: bracket-balance check on `reels.js`, and a full cross-check that every `getElementById` in
  `reels.js` matches an id that actually exists in `reels.html` (no mismatches found). Everything else
  (does it actually record video, does the canvas render correctly, does the swatch/prompt UI work) is
  unverified until Suhail logs in and tries it.

### 2026-07-28 — fresh clone + baseline
- Status: `[no edits yet]`
- Cloned fresh from `https://github.com/essentiallysports-tech/essentiallysports-design-tools.git`
  into `/Users/suhailquraishi/Downloads/AI Meet/essentiallysports-design-tools`.
- Baseline commit: `f744cf8` — "Rotate the hero headline word, drop the hero image".
- Confirmed local preview works at http://localhost:8935 (login page shows current "Frameup" branding).
- **Rollback point: `f744cf8`** — this is "the version before" for the first push we make.

### 2026-07-28 — How It Works hero art + newsletter ticker + first-login redirect
- Status: `[pushed - 506e2cd]`
- Files touched: `how-it-works.html`, `how-it-works.css`, `login.html`,
  `assets/how-it-works/how-hero-bg.jpg` (new), `assets/how-it-works/logos/*.svg` (new, 10 files).
- Hero (`.how-hero--art`): added the "hands reaching" dot-matrix background image supplied by Suhail,
  compressed via `sips` (4.7MB → ~750KB), with a dark scrim gradient fading to `#05070d` so it hands off
  seamlessly into the strip below. Fixed a specificity bug where `.how-hero h1 { color: var(--how-ink) }`
  (defined later in the file) was overriding the new white-text rule — resolved with `!important`.
- Hero kicker copy: "FrameUp Workflow" → "Welcome to FrameUp".
- New `.how-brand-strip` section: an infinite-scroll marquee (pure CSS `@keyframes`, respects
  `prefers-reduced-motion`) directly below the hero, same `#05070d` tone. Carries the ES mark
  (`brand-logo-blue.svg` — blue box/white text, matches the nav) plus 10 real newsletter logos supplied
  by Suhail: Essentially CFB, Essentially Golf, Essentially Dunk, Essentially W (formerly "She Got Game" —
  renamed), Break Point, The Huddle, Steelers/Cowboys/Chiefs Huddle, Lucky Dog on Track. Logos keep their
  native corners (no border-radius), all normalized to the same height via `clamp()` so mixed aspect
  ratios don't stick up/down. Strip is full-bleed at any resolution via the `left:50%; width:100vw;
  margin-left:-50vw` break-out pattern, sizing scales with `clamp()` instead of fixed breakpoints.
- `frameup-intro__credit` byline: 3px gap added between the two lines; "Suhail Quraishi" → "- Suhail Quraishi".
- First-login routing: `login.html`'s create-account submit now sends new signups' confirmation email to
  `how-it-works.html` instead of `index.html` (`auth-callback.html` already honors `?redirect=` faithfully).
  Every login after that first confirmation already falls through to the existing default (`index.html`) —
  no extra "seen onboarding" flag was needed since the confirmation link only fires once per account.
- Hero loop effect: tried a scanline-sweep + flicker first, Suhail called it "absurd and childish" —
  replaced with a slow breathing glow (`filter: brightness/saturate` pulse, 4.8s ease-in-out, peak
  brightness 1.28/saturate 1.65) so only the existing blue dots pulse brighter, no moving overlay.
- Hero CTA: "Open a Workspace" → "Learn More", now scrolls to `#intro` (added that id to
  `.frameup-intro`) instead of linking to `index.html#frames`. Style switched from `--primary` (blue
  fill) to `--secondary` (white), with a scoped smaller/down-facing chevron (`.how-arrow--down`) — kept
  scoped so the shared `.ui-arrow-right` class used elsewhere on the site is untouched.
- Viewport fit: `.how-hero--art .how-hero-stage` has `min-height: calc(100svh - header - 64px)` so hero
  + ticker together fill exactly the first screenful at any resolution — ticker stays visible on load,
  no white from the section below shows pre-scroll. (Tried a dark-to-transparent fade at the top of
  `.frameup-intro` to soften that seam — Suhail wanted a hard clean edge instead, so that fade was
  reverted.)
- Kicker color: "Welcome to FrameUp" set to white (`.how-hero--art .how-hero-kicker`), scoped so the
  blue kicker color elsewhere is unaffected.
- `.claude/launch.json` port (8934→8935) was changed locally to avoid clashing with the sibling
  session's dev server on this machine — deliberately left **out** of this commit since it's a personal
  local-dev convenience, not a real product change.
- Verification note: this page is gated by real Supabase login, which can't run against the local
  `python3 -m http.server` preview (no Node/`netlify dev` available in this environment). Suhail verified
  visually by logging in himself and screenshotting back; every fix above was made in response to those
  screenshots, not independently confirmed by the assistant in-browser.
- **Rollback point: `506e2cd`** — current HEAD, pushed to `origin/main`. Previous rollback point was
  `f744cf8` if this whole batch needs reverting.

### 2026-10-31 — Dashboard metric range filter (1d/7d/30d/90d); "Stars of the week" ticker on Home (top 3)
- Status: `[pushed - see rollback point below]`
- **Dashboard range filter** (`dashboard.html`, `dashboard-ui-system.css`): a 1d/7d/30d/90d toggle above the
  four overview cards, reusing the charts' existing `.chart-range-toggle` markup/style. It drives
  "Exports · last N" and "Visitors · last N"; the other two cards became all-time totals ("Designs exported ·
  all time", "Visitors · all time") so the row doesn't double up. Choice persists in localStorage
  (`frameup.dashboard.metricRange`), default 1d (same numbers as before). "Visitors this month" (calendar
  month) was replaced; the now-unused `isThisMonth()` was removed. Visitor counts are people whose last-seen
  falls in the window (same method as before, just a variable window).
- **Stars of the week ticker** (`app-shell.js`, `es-ui.css`, new migration
  `supabase/migrations/20261031120000_add_frameup_star_user.sql`): shows the top 3 people by exports (all
  workspaces) in the rolling last 7 days — Suhail first asked for one star, then "stars of the week" with 3 names. First built for every page; Suhail then asked for **Home only**
  (`index.html#frames`) — it loads only on the main `index.html` and hides/shows on `hashchange`, so it's
  gone on the editor routes that share that file. Design (after "design can be much better"): sports-broadcast
  style — 40px ink (`#0e1014`) strip, a fixed slanted brand-blue "🏆 Stars of the week" tag on the left, then a
  scrolling loop of #1/#2/#3, each with rank, initials avatar, name in
  Roboto Condensed caps and count — ringed/coloured gold, silver, bronze; diamond separators; faded edges, pauses on hover, static under reduced motion. Under
  600px the tag shortens to "Stars". (A "Last 7 days" pill was tried and dropped at Suhail's request.) Editor height calc subtracts `--es-ticker-h` (0 unless
  the ticker is showing).
- Data: new SECURITY DEFINER RPC `get_frameup_star_user(p_days)` (returns up to 3 rows), same model as the gallery RPCs — approved
  ES users only, returns just a display name + count (never emails), windowed on `created_at` (not
  `metadata.exportedAt`, see the gallery date fix). Cached 10 min in sessionStorage. If the RPC errors or
  nobody exported, no ticker renders. **Suhail applied the migration to production Supabase himself via the
  SQL editor on 2026-10-31** and confirmed the ticker working before the redesign. The top-3 change (`limit 1` → `limit 3`, same
  columns) was **re-run in the SQL editor by Suhail on 2026-10-31**.
- Cache-busting: `app-shell.js` / `es-ui.css` → `?v=20261031-ticker1` on all 11 app-shell pages,
  `dashboard-ui-system.css` → `?v=20261031-range1`.
- Verified: `node --check app-shell.js` and the dashboard inline script parse clean. Ran the real
  `app-shell.js` + `es-ui.css` locally with a stubbed Supabase client: renders on `#frames`, hidden on
  `#instagram`, back on `#frames`; name formatting, singular/plural, caching, RPC-error → no ticker, 375px with
  no horizontal scroll. Dashboard range filter not seen in-browser (login-gated).
- **Not in this push**: separate local Listicle Type 2 / Infographic 1 work stays unpushed until Suhail
  approves it; it gets its own entry when it ships.
- **Rollback point: `1afec65`**.

### 2026-11-11 — Editor basics: autosave, reopen designs, template picker, export check, spell check, What's new, shortcuts
- Status: `[local, awaiting "push"]`
- Asked for: "check what basics we're missing … go all in, work cleanly with a checklist, utter safety".
  Working checklist: `project-docs/basics-checklist.md` (local). Feature guide: `project-docs/editor-basics.md`.
- New files: `frameup-autosave.js`, `frameup-designs.js`, `frameup-templates.js`, `frameup-extras.js`,
  `assets/template-thumbs/*.webp` (28), no database migration.
- Changed: `index.html` (render hooks for autosave, export capture, export check + Copy link check,
  spell check attributes, export options, "New" tag in dropdowns, Recent + options buttons),
  `dashboard-data.js` (design copy goes to the cloud record only; `fetchGalleryDesign`; Gallery asks for
  every workspace and falls back), `gallery.html` (workspace filter, landscape thumbs, Open in editor),
  `app-shell.js` (What's new), `design-tokens.css` / `es-ui.css` (styles), `frameup-spec.js` (Generate
  "Edit" waits for the restore and uses an empty slide). Cache-busting bumped on every page that loads them.
- Fixed on the way: the export "still loading" check looked at the Newsletter template while exporting
  from Social Media; Pill colour swatches now follow a brand change (earlier today).
- Verified locally: restore of every workspace incl. photos and widget forms; broken-save recovery; Start
  fresh; export check on 9 newsletter assets + Social/YouTube; reopen from Recent and from Gallery; shared
  copy (8 KB, no files); picker on desktop and 375 px; What's new dot; shortcuts; export options; dark theme;
  every page console-clean; 476 renders across all brands error-free; 32 designs pixel-identical to the
  previous version (remaining differences are the browser's own image cache/anti-aliasing, reproduced in
  the old version too).
- Gallery stays Social Media only (Suhail, 2026-11-11): no database change. Reopen works for posts exported on the same browser.
- "New" badges made uniform: picker, dropdowns and What's new use the sidebar's .es-badge--new; Locked / Current tags match its size.

### 2026-11-11 — Round 2: icon family, panel sizes, Content · Photos · Style, ⌘K templates, Jump back in, names, phone menu, ESPN logos
- Status: `[pushed]`
- Icons: stroke 1.8 everywhere (15 files + icon CSS). Right panel: `editor-polish.css` (44 / 36 / 40 px system, desktop).
- Phase 4: ⌘K palette sources (`FrameUpShell.addPaletteSource`), Home "Jump back in" (`#home-recent`).
- Phase 3: inspector tabs Content · Photos · Style (`STUDIO_SECTION_TABS`, `data-studio-tab`); ES Image Pool inside Photos; empty tabs hide.
- Phase 5: phone menu from `NAV` (`buildMobileNav`); dead `.studio-rail` / `.studio-panel-head` CSS removed.
- Template names: Section Header (Left / Centred), Video FI (Play Button), Tag FI (Corner Label), Trivia, Headline List (Big Numbers / Simple).
- ESPN 500px team logos resized to 240px for the listicle placeholders (Suhail approved the download).
- Verified: 476 renders error-free, all pages console-clean, desktop + phone. Details: project-docs/editor-basics.md.

### 2026-11-13 — Generate: prompt caching, backup-AI spend tracking, dashboard label fix
- Status: `[local, awaiting "push"]` (nothing committed). Files: `netlify/functions/_ai-gateway.js`,
  `netlify/functions/es-generate.js`, `netlify/functions/trend-design.js`, `dashboard.html`.
- Ask (Suhail): make Generate the hero — best designs in our style (Generate + Trend angles), an engine that
  learns from mistakes, routes models by task level, and a Dashboard that tracks every AI spend. Only ~8% of the
  weekly Claude budget was left, so this is the small, safe first slice; the rest is planned below.
- Also: removed Generate's four dead page-level icon sizes (`generate.html`) and added `.gen-card__actions .es-icon-btn`
  to the compact-control icon list in `design-tokens.css` (32px buttons → 16px icons, others 18px), from the
  `improve-ui` audit; `design-tokens.css` link bumped to `?v=20261113-genicons1` on generate.html only.
- Done:
  1. **Prompt caching.** `buildPrompt` now ends its unchanging part (rules, templates, model answers) with
     `PROMPT_CACHE_BREAK`; `chat()` splits there (`splitPrompt`) and sends that part as a cached `system` block
     (`aiText({ system, cacheSystem: true })` → `cache_control: ephemeral`). Groq/backup calls strip the marker
     and get the same text as before. `anthropicCall` retries once without the cache hint if the Gateway
     returns 400. The "Plan up to N designs" count moved after the break (`Return up to N designs.`) so the
     cached prefix is identical for every request (including "Again").
  2. **Backup AI is now tracked.** New `logBackupCall()` in `_ai-gateway.js`; Generate's Groq/OpenAI fallback
     and Trend Design's Groq/OpenAI fallback log rows as `generate-backup` / `trend-headlines-backup`
     (model `groq/<model>`, tokens recorded, cost 0 while Groq is free tier). No schema change.
  3. **Dashboard labels.** `AI_FEATURE_LABELS` now maps the real feature names (`generate-photo-pick`,
     `generate-scene-image`) plus the two new backup features.
- Verified (no Node here, so in the browser): all three function files + dashboard scripts parse; with a mocked
  network, `aiText` sends `system` as `[{text, cache_control}]`, retries as a plain string on a 400, and costs
  cache reads at the cache-read price; `splitPrompt` splits correctly and passes through un-marked/multi-message
  prompts. NOT verified live: real Gateway caching (needs a live, logged-in Generate run — check that
  `cacheRead` tokens appear / cost per click drops), the Dashboard rows (login-gated).
- Still untracked: transcription (`es-video-intelligence.js`: Groq Whisper, OpenAI transcribe, ES MCP) and the
  ES MCP "think" path — need audio-seconds + a `track` through that handler.
- **Plan for the rest (not started)**: (1) usage table columns (request id, provider, workspace, template,
  tier, fallback reason, cache tokens, audio seconds) + SQL aggregation functions/indexes + dashboard range
  picker, daily trend, per-request drill-down, CSV, editable budget/alerts; (2) model router — Light
  (`openai/gpt-oss-20b`) / Main (Haiku 5.5) / escalate to Sonnet 5.5 only when repair fails or on a "best
  quality" click, `pickTier()` from brief shape/research size/retries, shared response cache, "Again" skips
  research, A/B gpt-6-luna / deepseek-v4.1-flash / qwen3.8-flash on past briefs before any swap; (3) learning
  loop — `frameup_generate_events` table (request id, per-card id, shown/exported/edited diff/Again/thumbs/
  validation failures/trend origin) + distilled "lessons" injected after the rules (keep lesson text in the DB,
  not the repo — it's public); (4) hero features — Trend angle/traffic/source links in the brief, parallel card
  rendering, per-card refine-by-chat, widget auto-fill from article links, more formats.
- Models (Gateway list, USD/1M in/out, 2026-11): Haiku 5.5 0.10/0.50 (current main), Sonnet 5.5 2/10,
  gpt-oss-20b 0.03/0.14 (light), gpt-6-luna 0.10/0.50, deepseek-v4.1-flash 0.30/1.20, qwen3.8-flash 0.15/0.47,
  flux-3-image-klein $0.009/image (current), recraft-v4.1-flash $0.007/image.
- Also noted: a read-only `improve-ui` design audit of the Generate page was run as a separate agent (no files
  changed); its findings go to Suhail for selection.
- **Rollback point:** current `origin/main` HEAD at the time of the push.

### 2026-11-13 — Generate: keyboard focus, steady progress spinner, download feedback (interaction + UI-engineering review)
- Status: `[local, awaiting "push"]`. File: `generate.html` only.
- From a read-only review of the Generate page against the supplied `interaction-design` and
  `frontend-ui-engineering` guidance (FrameUp's own rulebook took precedence; nothing new invented):
  1. **Focus no longer lost.** New `restoreFocus()`; after results render focus goes to the first card's Edit button
     (or Generate if none), and Download / Try again return focus to their button after re-enabling. Picking a photo
     or making a scene image re-focuses the same thumb / Scene button after the panel re-renders (it used to drop to
     `<body>`). Only acts when focus was actually lost, so it never steals focus the person moved elsewhere.
  2. **Progress spinner steady.** The "Generating…" rows were rebuilt every 500 ms, restarting the spinner mid-turn;
     they now rebuild only when the step changes and each tick only updates the seconds.
  3. **Download feedback.** The button shows the existing `.gen-spinner` while exporting and the status line says
     "PNG downloaded." for 3 s, then restores the results summary.
- Not done: dark-mode override colours in generate.html (:124-137 area) that restate tokens — needs a rendered
  before/after dark check.
- Verified (browser, mocked API): page scripts parse; spinner node identical across ticks, seconds update, focus
  returns to Generate after a failed run; photo pick keeps focus on the same thumb. Not verified: real Download /
  Scene button flows (need a logged-in session), screen-reader announcements.

### 2026-11-13 — Full FrameUp UI/UX pass, micro-motion, long inspector menu, Layers collapse, Tweet team colours
- Status: `[pushed to main on Suhail's "push"]` (worked on branch ui-pass/uipro-frameup).
- **UI/UX Pro Max skill**: security-reviewed (ui-ux-pro-max-cli v2.15.0: default `init --ai claude` copies bundled
  files, no network, no install scripts, no hooks/settings). Only the core skill was copied to
  `.claude/skills/ui-ux-pro-max/` (68 files, local Python search, no network). The 6 sub-skills were NOT installed
  (`design` loads `.env` and calls Gemini/MUAPI/AtlasCloud; `brand` sync writes design-tokens files; `ui-styling`
  runs shadcn). Used as reference only; FrameUp's rulebook stayed the source of truth.
- **Audit fixes (≈60 findings, 4 batches)**: focus rings restored where `outline:none` beat the global ring
  (navbar icons, Jump back in, toggles, feedback cards, prompt box, chips, menus); 44px tap targets on coarse
  pointers; keyboard support (custom select arrows/Home/End/Escape, inspector tabs, ⌘K palette ARIA, hero dots);
  dark-mode fixes (reset-password inputs, AI spend panel, login); radii/labels moved to tokens
  (`--es-radius-control`/`--es-radius-container`, field-label tokens); icon sizes (logout 28px, prompt chip remove
  16px); request-list Status/Assignee menus no longer clipped (dashboardViewEnter keyframe ends on
  `transform:none`); Design Request has a real page header; swatches are buttons with `aria-pressed`.
- **New today on top of the audit**:
  1. `es-motion.css` (new, linked after es-ui.css on every shell page): press feedback on icon buttons/chips/nav/
     search/cards, a one-time chip pop, active nav pill settle, unread-dot pulse (3×), short cascade on card grids
     (Home, Jump back in, Gallery, Generate results), image drift on card hover, "Create Now" arrow nudge, Generate
     sparkle turn. All inside `prefers-reduced-motion: no-preference`; hovers inside `(hover: hover)`; entrances
     use fill-mode `backwards` so no transform is left behind. Legacy cta-hover.css classes untouched.
  2. Sidebar: 4px between nav rows; the native "Generate" tooltip only shows in the collapsed rail
     (`data-tip` → `title` in `setCollapsed`). Collapsed rail: 8px side insets, full-size expand button, centred
     account avatar, more air at dividers.
  3. Editor undo/redo/history float to the right of the Layers column instead of over the "LAYERS" heading.
  4. **Layers panel collapse** (index.html): button in the Layers header, 48px rail when collapsed, remembered in
     `localStorage['frameup.layers.collapsed']`.
  5. **One long inspector menu on desktop** (≥901px): `setStudioInspectorMode` keeps
     `body[data-studio-inspector="all"]`; the Content/Photos/Style tab bar is hidden; order is Export + Post Type →
     folding sections (Content, Photo Layers, Text Placement, Brand & Colors) → photo tools → ES Image Pool
     (editor-polish.css unwraps `.studio-control-dock` with `display:contents`). Requests for a tab
     (`'ai'`/`'image'`/`'style'`) scroll to that block. Canvas image editing is allowed in "all".
     Phones keep their bottom tabs. `scripts/test-image-controls-contextual.mjs` updated to the new rule.
  6. **Tweet / X Post team colours**: the colour card (Sport, Team, Pill & Text) now shows for `twitter-quote`
     (removed from the hide list in JS and CSS); its headline pill already used `state.pillPalette`.
     Multiple Tweets still hides it (no pill).
  7. `logUsage` in `_ai-gateway.js`: `authConfig()` moved inside the try (fixes test-es-generate-flow; production
     robustness — tracking can never break a feature).
- Cache keys: changed assets bumped to `?v=20261113-uipass1/2/3`, `es-motion.css?v=20261113-motion1`.
- Tests (on the exact pushed files): 21 pass / 7 fail. All 7 failed before this work (auth-security, canvas-action-dock, color-swatch-states,
  newsletter-header-options, reels-transcription, check-dashboard-ui and check-site-chrome both pin old cache keys).
- Not verified: Dashboard with real data (needs login), screen readers, Safari. Left alone: Suhail's uncommitted
  Listicle Type 2 / infographic work in index.html, listicle-type2-data.js and its tests.
- Open choice: settings/profile field labels use the 13px field-label token; the dashboard rule asks ≥14px.
  8. **Clean right menu (beehiiv-style)**: Export / settings / Copy link row is sticky; Post Type sits 16px below
     it; Sport is a dropdown like Team (was 10 chips); the swipe-arrow toggle and the photo block are flat rows, not
     boxes; ES Image Pool shows title + search only until there are results; quieter field hints.
  9. **Final sweep fixes**: canvas bottom bar may wrap to 2–3 rows on 1024–1300px screens (old fixed 54px height
     hid Upload / slide arrows); Layers column dark in dark mode; How It Works phone "On this page" strip fits the
     16px gutter with a fade edge. Overflow/clipped-text sweep of every page at 1440 / 820 / 375 px came back clean.
- Pushed without Suhail's local Listicle Type 2 column toggles / Infographic 1 work (index.html hunks,
  listicle-type2-data.js, its tests and its log entry stay local, uncommitted).
- **Rollback point:** `main` at 736ce0b (the commit before this UI pass).

### 2026-11-17 — FrameUp tours: Welcome offer, page tours, Tours picker, automatic What's new tour on every update
- Status: `[branch feature/frameup-tour, not pushed; owner review first]`, rebased on `0443bbb` (Video Ads v2,
  Generate format cards, AI usage card, quiet focus, UI Library).
- Asked (Suhail): "the best possible tour of FrameUp; whenever we push a new update, it should automatically reflect
  as a new tour", then "keep options to skip as well, a nice tour experience, make it look the best."
- New: `frameup-tour.js` + `frameup-tour.css` (vanilla spotlight engine: soft rounded cut-out that glides between
  targets, card with a Lucide icon tile, Roboto 600 title, step dots, "Skip tour" on every step, Back / Next with the
  es-btn system, Esc always exits; top-layer popover, focus trap, aria-live, reduced motion, dark, bottom-docked on
  phones; multi-page resume via sessionStorage; missing targets skipped; never runs inside iframes),
  `tours/tours.js` (Welcome, Generate, Trends, Video Ads v2, Editor; targets checked against today's markup),
  `tours/updates.json` (release notes, newest first; today's "Video Ads v2, Ask AI and tours" note),
  `tours/updates.js` (comparison, generated tour, corner card, deploy check), `tours/tour-launcher.js` (Welcome
  offer: new people get a small "Take the tour / Not now / Don't show again" choice, existing people a corner card
  once; "Tours" picker in the profile menu, "?" buttons, What's new "Show me" + Tours, ⌘K), `api/version.js` +
  `netlify/functions/version.js` (signed-in only, live commit sha + subject), `scripts/add-release-note.mjs`,
  `scripts/test-tour.mjs`, `project-docs/release-tours.md`.
- Changed: `app-shell.js` — WHATS_NEW moved to `tours/updates.json` (fetched with `cache: no-cache`), What's new
  panel unchanged otherwise, fires `frameup:whatsnew-open`; NAV groups got ids `create`/`work`/`help` (sidebar
  classes for tour targets). All 13 app-shell pages (incl. index.html, include lines only) load the tour CSS +
  4 scripts right after app-shell.js. app-shell.js's own `?v=` was not bumped (files are served must-revalidate).
- Release workflow: `node scripts/add-release-note.mjs`, edit, remove `"draft": true`, push. See release-tours.md.
- Verified locally (auth stripped in a scratch mirror, headless Chrome): Welcome offer (Take / Not now / Esc /
  Don't show again, new and existing person), Welcome end to end Home → editor → Generate → Video Ads, Skip tour and
  Esc at every step of the Generate and Video Ads tours, keyboard only, replay from the Tours picker (navigates to
  the tour's page), What's new toast → generated tour across pages, light/dark, 1280 and 375.
  Not verified: real login (ESAuth session key), the AI usage step with real data, `/api/version` on Vercel,
  Safari/Firefox, screen readers.

### 2026-11-20 — Generate v3 (C, gen-director): a smarter art director for composed sets
- Status: `[branch feature/gen-director, not pushed]`. Parallel with gen-looks (A) and gen-imagery (B).
- Asked (Suhail): sets an ES senior designer would ship; fix the live golf set (coverage counts as stats, "2027" as the
  hero number and repeated in the headline, "2027 SEASON WHY FANS", three dark designs, no cut-out of a named star),
  and fix each failure CLASS for every brief and sport.
- `_composer.js`: content sense (coverage counts and years/dates/identifiers are never stats; labels cut at the next
  sentence; ratios "14 of 15", ordinals "4th MVP", ranks "No. 1" as facts; Trends coverage meta stripped), stat weights
  pick the hero, code headlines never chopped before their number, scene-based "say it once" check, ES families
  (stats / cover / quote / grid / listicle / bar-graph / lifestyle / extra, from the ES Figma board) with one per family,
  tones (`input.tone`: light / paper / vivid / dark / duotone / editorial / esblue) mixed light and dark, a cut-out-led
  design for a named star, image-led sets, empty-area check (3x3 cells) with a swap, set scorecard `plan.review`.
  Art director: Haiku first, Sonnet once if the plan is thin (`GENERATE_ART_DIRECTOR_MODEL`). Judge: rubric adds
  image / labels / stats and a set `toneVariety`; fixes map to assistant ops (palette flip, remove, text, assist).
- `_creative-memory.js`: topics stat-meaning, label-sense, duplicate, tone-monotone, no-cutout, image-weak; 7 house
  lessons (seeds) under their own heading in the director and judge prompts.
- Tests: `scripts/test-gen-director.mjs` (23 briefs, 8 sports, every class asserted), `test-generate-creative.mjs`
  updated for the say-it-once rule. Suite: only the 7 baseline failures.
