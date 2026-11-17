# FrameUp: what to build next, beyond the current plans (research, 2026-11-17)

Research only. No product code, git, env or config was changed. Agent `opportunities`.

**Question (Suhail):** "let's research what better we can do apart from this on FrameUp, do long research."

**What "this" means:** this doc does not repeat work that is already researched or planned:
- the Generate creative brain (`generate-creative-brain-research.md`);
- the Generate UX plan (`generate-ux-plan.md`, done);
- the AI cost plan and its "powerhouse" list: captions/hashtags/alt-text in the writer call, brand checks on manual designs, one-click repurposing, a Slack trend digest, voice presets, pick likelihood, "why this works", smart crop and embeddings (`ai-strategy-and-costs.md` §B–C);
- Reels Studio (`ai-reels-research.md`);
- the launch-readiness P1/P2 list, including painting the page shell early and splitting the 1 MB `index.html` (`launch-readiness.md`);
- release tours (`release-tours.md`).

Where an item here builds on one of those, it says so and names the dependency.

**How it was researched:**
- **Code:** `app-shell.js` NAV; `index.html` (grep only); `dashboard-data.js`; `netlify/functions/*`; `supabase/migrations/*`; `frameup-autosave.js`; the project docs above.
- **Web:** about 30 searches and fetches, accessed 2026-11-17 (§9).
- **Not read:** `login.html` and `es-auth.js`. A local privacy hook blocked them, so the current sign-in providers are **unverified**.
- **Not covered:** `video-ad-styles-research.md` (new Video Ads styles) landed while this was being written. Ad styles are out of scope here and are not repeated.

**Conventions:**
- **(est.)** means an estimate.
- **(unverified)** means I could not confirm it from a primary source.
- Prices are list prices from the source and date in §9.

---

## 1. Executive summary

FrameUp is already strong at **making one good graphic fast**: Generate, templates, the brand kit, the ES Image Pool and autosave. What it lacks is everything **around** that graphic:
- **what to make:** a calendar and live game data;
- **how many versions:** sizes and bulk;
- **who signs off:** review and requests;
- **where it goes:** posting;
- **whether it worked:** performance.

The data model shows this clearly:
- `es_designer_tasks` records an export and stops there.
- No table knows if, where or when a design was posted, or how it performed.
- Drafts live only in the browser's IndexedDB (`frameup-autosave.js`).
- There is no error monitoring: no Sentry or similar in the repo.

The ten opportunities below close that loop. They are ranked by impact on ES (time saved × number of people × revenue link) divided by effort.

| # | Opportunity | Why it matters for ES | Effort | Impact |
|---|---|---|---|---|
| 1 | **Trust foundation: cloud drafts, error monitoring, uptime** | Drafts live only in one browser, and nobody hears about crashes. One lost game-night design costs more trust than any feature earns. Sentry's free tier is about 5k errors a month (§9). | S–M | High: prevents churn |
| 2 | **"Posted" tracking + performance loop** (mark as posted → Instagram Insights + beehiiv stats → back into FrameUp) | Every AI "learning" plan today runs on "kept unedited" as a stand-in for performance (`ai-strategy` §C7, Q5). Real saves, shares and clicks turn Generate, Video Ads and the template choice into a measurable growth engine. | M (manual + beehiiv) → L (Meta API) | Very high: unlocks learning |
| 3 | **Game-day data templates** (Final score, Player stat line, Standings, Injury list), filled from a licensed feed | Sports social runs on speed after the whistle. Today an editor types every score and stat by hand, which is slow and error-prone. Box Out-style score templates are table stakes for teams (§9). | M–L | Very high on game days |
| 4 | **Sports content calendar** (schedule → slots → suggested posts per event) | ES covers 8+ sports and runs 3 flagship newsletters plus many team newsletters. Planning lives outside FrameUp, so nobody can see coverage gaps or who is on what. Canva, Later and Sprout all pair a planner with creation. | M | High |
| 5 | **Size packs: one design → feed, story, X, YouTube thumbnail, newsletter header** | Every post needs 2–4 placements. Today each is a separate template build. Canva Magic Resize, Box Out's "3 sizes in one click" and Adobe all do this (§9). Builds on smart crop (`ai-strategy` C9). | M–L | High |
| 6 | **Bulk create from a sheet** (CSV/Google Sheet → 10–50 graphics) | Power rankings, "every team's grade", weekly picks, 32-team or 30-club series, and newsletter widget batches. Figma Buzz and Canva both ship this (§9). | M | High in tentpole weeks |
| 7 | **Design Request workflow + two-way Slack** (assign, status, due, comments, notify; request from Slack) | Requests already post to a Slack webhook and land in `es_designer_tasks` with Backlog→Done statuses. The loop back to the requester is missing. | M | Medium–high |
| 8 | **Review and approval: share link, pinned comments, versions** | No second pair of eyes before export: typos and wrong logos ship. Canva and Adobe gate approvals behind Enterprise. A lightweight in-house version fits 15 users. | M | Medium–high |
| 9 | **Asset library v2: rights metadata, cut-outs, team packs** | Images come from ES Storage via MCP or WordPress media with no licence, credit or expiry fields. Editorial-only photos are not cleared for ads (Getty licence, §9). Adds background removal for player cut-outs (Bria about $0.018 per image, commercial-safe). | M–L | Medium–high; reduces legal risk |
| 10 | **North-star admin view: time-to-export, reuse, template leaderboard, AI cost per export** | The Dashboard counts exports and visitors. It cannot say whether FrameUp is saving time or which templates win. Almost everything needed is already in `es_designer_activity`, `es_designer_tasks` and `frameup_ai_usage`. | S–M | Medium; steers everything else |

**Just outside the top 10:**
- a phone "game-day mode" (§4.13);
- Google Workspace SSO, roles and an audit log (§4.11);
- AI image tools beyond cut-outs (§4.12);
- accessibility at export (§4.10);
- direct scheduling to Instagram and X (§4.5b): high value but L effort, so it goes after #2 proves the loop.

**Explicitly not recommended now:**
- Real-time co-editing (XL, and 15 users rarely edit the same canvas).
- Spanish and localisation (`ai-strategy` already dropped it; revisit only if ES launches a Spanish property).
- Face recognition on the photo pool (biometric-privacy exposure; team and player tags from ES article metadata give 90% of the value).
- Generated athletes (already a hard rule).

---

## 2. Users and jobs-to-be-done

Inferred from the features, the data model (`es_designer_tasks.workspace` / `workspace_variant`, request fields `publication`, `socialChannel`, `publishAt`, `designDueAt`, `priority`) and how sports publishers' social teams work. **Interviews are needed to confirm** (§8 Q1).

| Persona (est. share of 15 MAU) | Main jobs | Where FrameUp is used | Where time is lost today (inferred) |
|---|---|---|---|
| **Designer** (3–4) | Build and keep templates; make hero posts; fulfil design requests; guard the brand | Editor (all workspaces), Guidelines, Dashboard review | Re-sizing the same post per placement; repetitive request fixes; one-off "can you change the name" edits; no queue view of their own requests |
| **Social editor** (4–6) | Turn news and trends into posts in minutes; game-night posting; captions | Generate, Trends, Social templates, Gallery | Typing scores and stats by hand; picking the format; writing captions separately; finding a usable photo; posting from a phone at night |
| **Newsletter editor** (2–3: Essentially CFB, ES Dugout, The Huddle, team Huddles) | Weekly widgets, headers, picks and infographics; images hosted for Beehiiv | Newsletter workspace (widgets, Copy HTML), infographics | Batches of near-identical widgets; image hosting egress (`ai-edit-log` 2026-11-17 egress entry); no click data per graphic |
| **Growth / ads** (1–2) | Newsletter sign-up video ads; CTA copy tests | Video Ads | No performance data back from Meta; clip rights uncertain (`ai-reels-research` §3) |
| **Requester** (writers, SEO, partnerships; occasional) | Ask the design team for something by a deadline | Design Request | Not knowing the status; retyping context |
| **Admin / lead** (1–2, Suhail) | Access, quality, cost, rollout | Dashboard, AI usage | No north-star metric, no per-template value, no alerts |

**How peers work (for calibration):**
- **House of Highlights (B/R):** "social programmers" curate, source, caption and post everything, and a highlights team cuts clips on request during games (Digiday, B/R job listings, §9). The bottleneck is **packaging speed**, not design depth.
- **NFL teams:** over half used Slate in one recent season to "take pressure off of their in-house design team" for vertical content (Slate, §9). Templated speed tools sit next to designers; they don't replace them.
- **Backlash against AI art in sports design is real.** The Timberwolves, Saints and Blues have publicly rejected it ("Made by real people. Not AI.", FOS 2026, §9). FrameUp's stance (AI for judgment and copy, ES photos and templates for pixels, no generated athletes) is the right one, and it should stay visible in the product.
- **Instagram's 2026 originality update** de-ranks reposts and near-duplicates, including photos and carousels. It treats saves and shares as strong signals (PetaPixel, Tubefilter, April 2026, §9). This favours **original, ES-branded graphics with real data**, which is exactly opportunities #3 and #5.

**Day in the life: social editor on an NFL Sunday (inferred):**
- **Before kickoff:** inactive lists and injury notes.
- **During games:** score updates and big plays (often clips, not graphics).
- **At the final whistle:** a final score graphic within about 5 minutes, then a top performer stat line.
- **Evening:** standings or playoff picture, plus a quote graphic from the press conference.

FrameUp covers the quote and the stat line today, with manual typing. It does not cover the time-critical final-score moment, standings, or phone use.

---

## 3. Competitive scan

| Tool | Best-in-class features (2026) | Copy for FrameUp | Beat with ES's edge |
|---|---|---|---|
| **Canva** (Teams/Enterprise) | Brand Kit + **Brand Controls**: approved colours and fonts only, folder-locked kits, **approval before publish** (approver groups Enterprise-only). **Bulk Create** from data. **Magic Resize**. **Content Planner** (schedules to IG, FB, LinkedIn, Pinterest, X; one design at a time). Magic Studio / Canva AI (Magic Write, background remover, Magic Expand) on credit limits | Approval gate; folder-locked brand; bulk from sheet; resize; planner | Sports-native: team brand kit (163 teams already), live data, ES coverage grounding, trends → post |
| **Adobe Express / Firefly** (Business/Enterprise) | Brand kits by team/region; **locked template elements**; templates from PS/AI/ID files; **Brand Check (beta, MAX 2026)** finds and fixes inconsistencies in one click; Firefly custom models on own assets | One-click brand check (planned as `ai-strategy` C2: extend to "fix it"); lockable fields | Free for ES; rules come from ES's own lint (`_lint-spec.js`, `frameup-rules.js`) |
| **Figma** (Buzz, Make, Sites) | **Buzz**: designers publish templates with locked layers, marketers edit approved fields, **bulk create from CSV/XLSX** (100+ assets; images need XLSX); lower-cost content seats. Config 2026: code layers, motion, Figma Agent GA, 20 MCP integrations | Field-level template contract ("approved fields only"); XLSX image columns; Figma → FrameUp template import (infographics already come from Figma, `infographics.md`) | Data-bound sports templates; one tool for social + newsletter + video |
| **Kittl** | Brand Studio ("build your brand once, generate ads, posts"); background remover, upscaler, vectoriser; real-time team workspace | Cut-out and upscale buttons in the photo panel | — |
| **VistaCreate / Picsart / Simplified** | Animated templates; mobile-first editing (Picsart); batch from one template; cheap seats | Phone-first quick edit; simple motion on stills (score "pop") | Brand governance (their team controls are weaker, §9) |
| **Predis.ai / Ocoya** | Prompt → post, carousel or video + scheduling + analytics; Predis competitor analysis | Competitor/peer watch: what B/R and The Athletic posted on a trend (a Trends add-on) | Grounded in ES reporting, not generic |
| **Jasper / Typeface** (enterprise) | Brand voice enforcement + approvals (Jasper). Typeface "Arc" (Mar 2026): brand knowledge graph, governed agents, MCP server, **Arc Loop feeds performance back into workflows** (Sept 2026) | The performance loop (#2) and a brand "knowledge graph" = ES guidelines + corpus + team kits, exposed to the AI | Built for ES at about $0 licence vs Typeface's reported $100k+ a year (unverified) |
| **WSC Sports** | Automated highlights from live feeds, auto graphics, AI recaps; 650+ sports orgs | Not a competitor for a non-rights-holder; a **partner** if ES licenses footage (`ai-reels` §8) | — |
| **Greenfly** | AI tagging of faces, jersey numbers, sponsor logos and scenes; mobile app to browse, download and publish; acquired Miro AI | Tagging and a "browse → share in a few taps" phone flow for the image pool | Tags from ES article metadata instead of biometric face matching |
| **Minute Media Voltax** (competing publisher) | OVP + contextual AI + AI video for articles without footage; 400k-video library | Article → asset automation is where publishers are heading | — |
| **Hootsuite / Sprout / Later / Buffer** | Calendar, approvals, scheduling, analytics. Sprout about $199–399 per seat a month; Hootsuite approvals at the Advanced tier (about $399 per user); Later from about $25 a month; **Buffer's new public GraphQL API (May 2026) on every plan, legacy REST API retired 2027-02-01** | The calendar + approval + analytics loop. Possibly integrate rather than build: push FrameUp exports into whatever scheduler ES uses (§8 Q4) | Creation + data + brand in one place; no per-seat cost |
| **Bannerbear / Placid / Templated** (automation APIs) | Template + JSON → image/video by API; Bannerbear from about $49 a month for 1,000 calls; Templated from about $29 | FrameUp already renders templates in the browser. Expose the **same renderer headlessly** (`/api/render`), so a scores feed, sheet or Slack command can make graphics without anyone opening the editor | Zero per-render fee; ES templates |
| **Box Out Sports** (teams/schools) | Score, stat and story templates; **three sizes in one click**; motion versions | Final score set + size pack | Pro-grade ES look, live data fill |

**What the scan says:** every serious competitor has converged on the same five pieces: brand-locked templates, bulk, resize, approvals and a planner/scheduler. The 2026 frontier is **performance flowing back into creation** (Typeface Arc Loop, Sprout analytics).

FrameUp has none of the five except partial brand locking, but it has things none of them have:
- sports data;
- ES reporting;
- 163 team kits;
- a cost model in cents.

---

## 4. Opportunity deep-dives

Effort scale (one experienced builder agent with review):
- **S:** 1–3 days
- **M:** 1–2 weeks
- **L:** 3–5 weeks
- **XL:** over 6 weeks

All new tables follow the house pattern: RLS on, ES-domain users read or write their own rows, admins read everything, security-definer RPCs for shared reads. That matches `list_frameup_gallery` and `frameup_ai_usage`.

### 4.1 Trust foundation: cloud drafts, error monitoring, uptime (Top 10 #1)

**Problem:**
- `frameup-autosave.js` stores drafts in IndexedDB on one device. A cleared browser, a different laptop or a phone means the work is gone. "Recent designs" only reopens exports.
- There is no client or server error monitoring. The 2026-09 dashboard load bugs and the 2026-11 RLS heartbeat errors were found by hand (`ai-edit-log`).
- Supabase is spend-capped and newsletter images already hit egress (`ai-edit-log`, egress entry).

**Idea:**
1. **Cloud drafts.** On autosave (debounced, about every 20 s and on blur), upsert the same JSON the editor already serialises for exports (`metadata.design`, about 8 KB) into a new `frameup_drafts` table. "Recent" shows the union of local and cloud. Conflicts go to the newest `updated_at`, and the loser is kept as a version (sets up §4.8).
2. **Sentry** (browser SDK on every page via `app-shell.js`, Node SDK in `netlify/functions/*`):
   - release = the `/api/version` sha;
   - user = a hashed email;
   - replay off, or a 1% sample.
   - **Free Developer tier:** about 5k errors a month and 1 user; Team about $26 a month (third-party figures, verify, §9).
3. **Uptime:** a scheduled check of `/`, `/generate.html`, `/api/version` and `/api/trend-design` every 5 min (Vercel cron or a free external monitor), alerting to Slack.
4. **Web Vitals:** Vercel Speed Insights or a 30-line `PerformanceObserver` posting LCP/INP to `es_designer_activity` (`event_type='vitals'`). This measures the P1 "blank for 1–4 s" fix.
5. **Backups:** confirm the Supabase plan's daily backups and PITR. Export `es_designer_tasks` metadata (not the base64) weekly to Storage.

**Tables:** `frameup_drafts(id uuid, owner_email, workspace, variant, title, design jsonb, thumb_path, updated_at, deleted_at)`, owner-only RLS.

**Cost:** $0–26 a month (est.).

**Effort:** S (Sentry, uptime) + M (cloud drafts).

**Risks:**
- Drafts with embedded photos as data URLs would bloat rows. Store photo URLs only, as the export metadata already does.
- Sentry must scrub emails (the privacy plugin in this repo flags them).

**Dependencies:** none. This should go first, because every later feature adds failure modes.

### 4.2 "Posted" tracking and the performance loop (Top 10 #2)

**Problem:**
- FrameUp knows a design was exported. It does not know whether it was posted, where, or how it did.
- So the creative brain's ranking (C3), "pick likelihood" (C7), Video Ads learning (`_ad-learning.js`) and template decisions all run on proxies.
- `ai-strategy` Q5 already names this as the blocker for real CTR.

**Idea, in three steps (each useful on its own):**

1. **Mark as posted (S).**
   - After export, a quiet "Posted it? Paste the link" field, also on the Gallery card.
   - Accept instagram.com, x.com, threads.net, facebook.com and `*.beehiiv.com` URLs.
   - Store platform, URL and posted_at.
   - The UTM builder appends `utm_source=<platform>&utm_medium=social&utm_campaign=frameup-<export_id>` to any link the editor puts on the clipboard. That covers newsletter CTAs and Video Ads landing URLs, so web analytics can attribute traffic to a design (needs ES analytics access, §8).
2. **Beehiiv stats (M).**
   - Newsletter designs carry a known publication (the Beehiiv publications are listed in `site-chrome.js`).
   - A daily scheduled function calls `GET /v2/publications/{id}/posts/{postId}?expand=stats` (opens, clicks, per-URL clicks; `/posts/aggregate_stats`) for posts linked in step 1.
   - Map **per-URL clicks** to the FrameUp image or widget link (the `frameup-links` Storage path is unique per design), so each widget gets its own click count.
   - Needs a Beehiiv API key per workspace (server env only).
3. **Instagram and Facebook Insights (L).**
   - A Meta app with `instagram_basic` and `instagram_manage_insights` on ES's business accounts.
   - A daily job reads `/{ig-media-id}/insights` for linked posts.
   - Use the **2026 metric set**: Meta is retiring legacy reach/impressions in favour of views and viewers, and adding reposts and reels skip rate (Supermetrics, Meta changelog, §9). Store raw JSON so metric renames don't break history.
   - Saves and shares are the strongest ranking signals after the April 2026 update (secondary source).
   - X analytics via pay-per-use reads (about $0.005 per post read, third-party, §9). This is optional; do it last.

**Uses once the data exists:**
- **Template leaderboard** (§4.14): median saves per 1k views by template, sport and hook.
- Generate's corpus scoring adds `performance_score` as signal #1 above admin stars (creative-brain C3).
- Video Ads lessons get real CPA/CTR if Meta Ads data is imported. That is a later step and needs Ads API access.
- A weekly Slack digest (`ai-strategy` C5) gets "top 3 posts by saves this week".

**Tables:**
- `frameup_posts(id, task_id → es_designer_tasks.id, platform, url, external_id, account, posted_at, posted_by, utm_campaign)`
- `frameup_post_metrics(post_id, captured_at, metrics jsonb, source)`, append-only, plus a view of the latest row per post.

**AI cost:** $0. Optionally Haiku explains outliers, about $0.0004 each.

**Effort:** S + M + L.

**Risks:**
- Meta app review and token upkeep (60-day tokens, or a system user through Business Manager).
- People forget to paste links. Mitigation: make it one paste. Later, auto-match recent IG posts to recent exports by perceptual image hash and caption similarity (M).

**Dependencies:** a Meta Business admin and the Beehiiv account owner (§8 Q4–Q5).

### 4.3 Game-day data templates from a licensed feed (Top 10 #3)

**Problem:**
- Score, stat and standings graphics are the highest-frequency sports post, and the most time-critical.
- Today they are typed by hand into templates (Player Stats, Rankings Table, Listicles), which is slow and risks errors.
- Generate's guardrails forbid invented stats, but the truth has to come from somewhere.

**Idea:**
- **A "Live" tab in the Social workspace:** pick a sport and date, see today's games, and click a game to fill these templates:
  - **Final Score:** logos, score, record, top performer, ES photo;
  - **Player Stat Line:** box-score row → the existing Player Stats template;
  - **Standings / Playoff Picture:** the Rankings Table template;
  - **Injury Report** (NFL Fri/Sun inactives).
- **"Game just ended" nudges:** a 2-minute poll of the scoreboard while games are live. When a game the user follows goes final, a toast appears: "Bills 31–24 Chiefs is final: make the graphic", and one click opens the pre-filled template.
- **Generate gets a facts tool:** Generate's research step can call the same feed, so stats posts are grounded in data, not just ES articles.

**Data source options (accessed 2026-11-17):**

| Source | Coverage | Price | Licence fit for a publisher | Verdict |
|---|---|---|---|---|
| ESPN "hidden" JSON (`site.api.espn.com`) | All US leagues, live | Free | **Undocumented, no support, ToS risk for commercial use**; ESPN retired its public API in 2014 | Prototype and internal QA only; never the production source |
| **MySportsFeeds** | NFL, MLB, NBA, NHL, NCAA FB/BB; CORE (schedules, scores) + STATS + DETAILS (box scores, play-by-play) + EXTRAS (drafts) | **Commercial from $39/mo NFL, $35 MLB, $29 NBA, $49 NCAA FB** (Non-Live CORE; live and add-ons extra); 10–30% multi-league discount | Commercial tier offered; "unofficial and independent", not league-affiliated | **Recommended start**: cheap, US-centric, covers ES's big four + CFB |
| TheSportsDB | Broad, incl. soccer; livescores every 2 min on paid | $9–20/mo | Commercial terms not stated on the pricing page (unverified) | Backup or logos-and-metadata source |
| API-Sports (api-sports.io) | Many sports incl. American football, baseball, basketball, F1 | Pricing page returned 403 (unverified) | — | Check if F1 or tennis are needed |
| SportsDataIO | Full stack incl. injuries, all US leagues | Sales-gated; the trial is scrambled and not licensed for redistribution | Media plans by quote | Quote if ES grows beyond MSF |
| Sportradar / Stats Perform | Official league data, deepest | Enterprise; third-party estimates €1.3k–$10k+/mo | Official | Only with a broader ES data deal |
| Golf: DataGolf (Scratch Plus membership) / Goalserve ($200/mo PGA live) | PGA leaderboards, SG stats | See left | DataGolf API needs a membership | For majors weeks only |

**How it works in FrameUp:**
- **`netlify/functions/sports-data.js`:** a single adapter with normalised `{games[], boxscore, standings, injuries}`. It caches in memory and in `frameup_sports_cache(key, payload jsonb, fetched_at)`: 60 s live, 1 h otherwise. Provider keys live in server env.
- **Client mapping:** `sports-data-map.js` maps feed fields to template fields, reusing `FrameUpRules.STAT_LABELS` and `brand-kit.js` team IDs.
- **Logos and colours** come from the existing kits, not the feed (brand stays consistent).
- **Lint:** add `stat-source` to the export metadata (`{provider, gameId, fetchedAt}`) so any stat graphic is traceable.

**Cost:** about $100–200 a month for NFL + CFB + MLB + NBA commercial CORE+STATS (est.; get a quote for live and injuries).

**Effort:** M for one sport (NFL Final Score + Stat Line), then +S per sport and template. L for all.

**Risks:**
- **Licence scope:** confirm social graphics redistribution with the vendor in writing.
- **Feed lag** vs TV (near-real-time tiers cost more).
- Team-name mapping errors; add a mapping test like `test-generate-corpus.mjs`.

**Dependencies:** a vendor contract (§8 Q3); the size packs (§4.5) make it shine.

### 4.4 Sports content calendar and planner (Top 10 #4)

**Problem:**
- Planning lives in heads, Slack and spreadsheets.
- Tentpoles (NFL Draft, trade deadlines, Signing Day, Masters, majors, playoffs, the World Series) need packages prepared days ahead.
- Nobody can see "what's covered tomorrow, by whom, with which template".

**Idea: `planner.html`** (Work group in the NAV), with a week and month view.

**Three layers:**
1. **Schedule layer, automatic:**
   - games from the sports-data adapter (§4.3);
   - plus an **ES tentpole list**: a JSON file the editors own, with draft, deadline, signing day and majors dates (verify each season);
   - plus **Trends** spikes (from `/api/trend-design`), pinned to today.
2. **Slots:** a planned post = `{date, time, sport, team, newsletter/channel, template, owner, status}`. Slots link to:
   - a design request (`es_designer_tasks`);
   - a draft (§4.1);
   - an export;
   - a post (§4.2).

   Status: Idea → Assigned → In progress → Ready → Posted.
3. **Suggestions:** for each event, 2–3 suggested slots from rules plus a Haiku call:
   - "NFL Sunday: Final scores ×N, Top performer, Week recap";
   - "MLB trade deadline: Tracker template, Grade the trade";
   - Haiku turns event + ES coverage into one-line angles (reuse the trend-enrich prompt).
   - Cost: about $0.0005 per event, cached per event id (est.).

**Integrations:**
- An `.ics` feed per person (deadlines into Google Calendar), read-only.
- Slack reminders on due slots (§4.7).

**Tables:**
- `frameup_events(id, sport, kind, title, starts_at, source, external_id, meta)`;
- `frameup_slots(id, event_id, due_at, channel, template, owner_email, status, task_id, draft_id, post_id, notes)`.

**Effort:** M (calendar + slots + tentpole JSON); +S for game import once §4.3 exists.

**Risks:**
- A planner nobody updates is worse than none. Make slots fall out of existing actions: a design request creates a slot, and an export with "posted" closes it.
- Don't build a full scheduler (§4.5b).

**Dependencies:** §4.3 for game data (can start with the tentpole JSON alone).

### 4.5 Size packs: one design → every placement (Top 10 #5), and 4.5b direct publishing

**Problem:**
- An IG feed post (1080×1350) usually also needs a 9:16 story or reel cover, an X/Threads landscape image, sometimes a YouTube thumbnail (1280×720) and a newsletter header.
- `index.html` templates are built per size. Repurposing (`ai-strategy` C3) covers the copy, not the layout.

**Idea:**
- Each template declares **layout variants** per aspect (4:5, 9:16, 16:9, 1:1). Same fields, different positions.
- Export offers "Size pack": tick placements, then download a ZIP or copy each.
- **Smart crop** (MediaPipe face focal point, `ai-strategy` C9) positions the photo per aspect.
- A **safe-zone overlay** per platform (IG story UI, Reels caption area).
- Start with the 4 most-used templates (pull counts from `workspace_variant`).

**Effort:** L overall. M per first 4 templates, because layouts must be designed, not computed. Designers own the variants, and the code just maps fields.

**Risks:** automatic reflow looks generic, so keep designer-authored variants.

**4.5b Direct publishing (later, L):**
- **Meta Graph API:** IG, FB and Threads publishing. IG allows **100 API posts per 24 h** per account (carousels count as one; check `content_publishing_limit`).
- **X API:** pay-per-use since Feb 2026, about $0.015 per post and about $0.20 for a post with a link (third-party figures).
- **Beehiiv:** `POST /posts` creates **drafts** (Max/Enterprise plans; status defaults to draft since 2026-08-06), with images by public URL.

**Recommendation:**
- First, **Beehiiv draft creation** for newsletter widgets (S–M if ES is on Max/Enterprise).
- **Copy for IG** (image + caption to the clipboard, deep link to the app) on phones.
- Only build scheduling if ES has no scheduler. If it uses one (Sprout, Later, Buffer), push into it instead: Buffer's new API is on every plan.

### 4.6 Bulk create from a sheet (Top 10 #6)

**Problem:** series content is many near-identical graphics:
- power rankings 1–32;
- "grading every team's draft";
- a 25-player listicle;
- weekly picks per Huddle newsletter (Chiefs, Cowboys, Steelers…);
- newsletter widgets per brand.

Each one is a separate manual edit.

**Idea, a "Bulk" button on any template:**
1. Download a CSV or XLSX whose columns are the template's fields (team, player, line1…, stat labels, photo query or URL).
2. Upload it or paste a Google Sheet link (published CSV).
3. Preview a grid. Lint every row (`_lint-spec.js`: lengths, stat labels, banned words).
4. Fix flagged rows inline.
5. Export a ZIP, and record each row as an export with `metadata.bulk={batchId,row}`.

**Photo column:**
- an ES Image Pool query per row ("Patrick Mahomes"), with the top pick auto-chosen and swappable;
- or a URL.

**Team column:** colours come from `brand-kit.js`.

**AI assist (optional):**
- "Fill the sheet": Haiku drafts blurbs per row from a brief and ES coverage, grounded the same way as Generate.
- Cost: about $0.0005 per row (est.).

**How:**
- Renders with the existing in-browser renderer, sequentially, in a hidden iframe. Generate already does this with `index.html?embed=generate`.
- Headless `/api/render` (see the Bannerbear row in §3) is a later step if server batches are needed.

**Effort:** M.

**Risks:**
- Browser memory on 50 renders: batch in 10s and free the canvases.
- 50 near-identical posts can trip Instagram's originality signals if posted as-is. This is a newsletter and carousel tool, not a spam cannon.

### 4.7 Design Request workflow and two-way Slack (Top 10 #7)

**What exists:**
- `design-request.html` has rich fields (type, publication, channel, publishAt, designDueAt, priority, entities, copy, references).
- Requests go to `es_designer_tasks` (status Backlog/Assigned/Doing/Review/Done, `admin_notes`).
- A Slack webhook (`SLACK_DESIGN_REQUEST_WEBHOOK_URL`) posts the new request.
- Admins manage requests in the Dashboard.

**Gaps:**
- Requesters can't see the status.
- No assignee on the request (only the status).
- No comment thread.
- No deliverable link back.
- Slack is one-way.

**Idea:**
1. **"My requests"** for requesters (RLS already allows own-row reads, migration `20260711013000`): status timeline, due date, and the delivered design (a Gallery link).
2. **Assignee + due + SLA:** the Dashboard kanban gets drag-to-assign. Overdue requests turn amber.
3. **Comments:** `frameup_comments(id, entity_type, entity_id, author_email, body, pin {x,y}?, created_at, resolved_at)`. The same table powers §4.8.
4. **Slack, two-way, via a Slack app (bot token) rather than a webhook:**
   - post the request; **thread updates** on status change and delivery (with the thumbnail);
   - a `/frameup request` shortcut or modal to file a request from Slack;
   - a message action "Make a FrameUp request from this message";
   - a reminder DM to the assignee 2 h before due.
5. **Link deliveries:** exporting from a request-opened editor ties the export to the request (`task.metadata.request_id`) and auto-moves it to Review.

**Effort:** M.

**Risks:** Slack app approval in the ES workspace; tokens server-side only.

**Dependency:** Slack admin (§8 Q6).

### 4.8 Review and approval, comments and version history (Top 10 #8)

**Problem:** a wrong team logo, a misspelt name or a stale stat ships, because there is no review step. Canva and Adobe gate approvals at Enterprise.

**Idea:**
- **"Send for review"** on any draft creates a review link (signed-in ES users). The reviewer sees the canvas, drops pinned comments, and clicks **Approve** or **Request changes**.
- Optional per workspace: "Video Ads and Newsletter exports need approval" (admins set it).
- **Version history:** each cloud draft save (§4.1) above a diff threshold keeps a version (keep 20). "Restore" and "Compare" (side-by-side thumbnails).
- **Pre-export checklist:** combines the planned brand check (`ai-strategy` C2) with the accessibility checks (§4.10). Approved = all green, or a reviewer waived it.

**Tables:**
- `frameup_reviews(id, draft_id, requested_by, reviewer_email, status, decided_at)`;
- `frameup_draft_versions(draft_id, version, design jsonb, created_at, author)`;
- `frameup_comments` (from §4.7).

**Effort:** M.

**Risks:** friction on game nights. Approval must be opt-in per workspace and never block the Social workspace by default.

**Dependencies:** §4.1 cloud drafts.

### 4.9 Asset library v2: rights, tagging, cut-outs, team packs (Top 10 #9)

**What exists:**
- The ES Image Pool searches ES Storage through the private ES MCP (`search_images`), with WordPress media as the fallback (`es-image-search.js`, `ai-images-es-storage.md`).
- Entity-first queries.
- No rights or credit fields reach FrameUp.

**Problem:**
- Agency photos (Getty, Imagn/Reuters, AP, USA Today) are usually **editorial-only**: not for advertising or promotion unless the licence says so (Getty licence, April 2026).
- Video Ads and sponsor creative are promotional uses.
- FrameUp can't tell an editorial-only photo from a cleared one, or show the credit line.

**Idea:**
1. **Rights metadata on every image result:** `source` (agency), `credit`, `licence` (editorial / commercial / owned), `expires_at`, `restrictions`. Pull it from WordPress media fields (caption and credit) or ES Storage metadata (to confirm with the ES tech team).
   - Badge each result.
   - **Block editorial-only images in Video Ads** and sponsor templates.
   - Put the credit into the caption output.
2. **Tags from ES metadata,** not biometrics: the article tags and categories each image was used with (player, team, league) become search facets, plus a "recently used by the team" filter (from export metadata).
   - Skip face recognition: Illinois BIPA-style exposure, and Greenfly-style face tagging needs consent workflows.
3. **Cut-outs:** a "Remove background" button for player cut-outs in templates. Options:
   - **Bria RMBG 2.0 API, about $0.018 per image** (trained on licensed data, commercial-cleared) via fal or Bria.
   - The open RMBG-2.0 weights are **CC BY-NC**, not usable commercially without a Bria agreement.
   - Cache the cut-out PNG in Storage by image id, so each player is cut once.
4. **Team and player packs:** a curated pack per team (logo variants already exist; add approved headshots and a stadium shot), pinned at the top of the pool when a team is detected.
5. **"Find similar":** defer. CLIP embeddings with pgvector are M–L and only worth it above a few thousand images (same reasoning as `ai-strategy` C10).

**Tables:**
- `frameup_assets(id, source_url, storage_path, kind, credit, licence, expires_at, tags text[], cutout_path, added_by, created_at)`, a FrameUp-side cache and index (not a copy of ES Storage).

**Cost:** cut-outs about $0.018 × perhaps 300 a month ≈ $5 a month (est.).

**Effort:** M (rights badges + cut-outs) → L (tags + packs).

**Risks:**
- Rights metadata quality depends on the WordPress and ES Storage data.
- Legal must define the rules (§8 Q7).

### 4.10 Accessibility at export

The planned alt text and captions (`ai-strategy` C1) cover posts. Additions:
- **Contrast check:** text-on-photo contrast against WCAG 4.5:1 (3:1 for large text), sampled from the rendered pixels under each text box. Flag "Text may be hard to read on this photo: add a tint" (Video Ads already has a Tint control). Effort S, $0.
- **Minimum text size** per placement (story vs feed) in lint. Effort S.
- **Caption files:** Reels already makes captions; also export `.srt` and `.vtt` for Video Ads and Reels uploads. Effort S.
- **Alt text in the clipboard and Beehiiv HTML:** the widget "Copy HTML" should include `alt=`. Effort S.

### 4.11 Security and compliance: SSO, roles, audit log, retention

**What exists:**
- An ES-domain signup hook (`restrict_signup_to_es_domain`);
- access requests and approval;
- dashboard roles;
- a 2026-11-15 security pass.

The current sign-in providers are unverified (see the header note).

**Add:**
- **Google sign-in** restricted to the ES Workspace domain, if not already on. Supabase's Google provider plus a check of the `hd` claim in the existing signup hook (the hook already enforces the domain). Full SAML SSO is a Supabase Pro+ feature (about $0.015 per SSO MAU above 50, third-party). Not needed at 15 users. Effort S.
- **Roles beyond admin:** viewer / creator / designer / reviewer / admin, applied to approvals (§4.8), template publishing and AI caps. Effort S–M.
- **Audit log:** `es_designer_activity` already exists. Ensure role changes, access approvals, deletes, template changes and AI cap changes write rows. Add an admin filter. Effort S.
- **Retention:**
  - `previewDataUrl` base64 in task metadata already caused the 30 MB dashboard incident. Move it fully to Storage (partly done in `20261030120000`) and purge the base64 after 30 days.
  - Delete `frameup_ai_usage` raw errors after 180 days.
  - Effort S.
- **Secrets:** keep ES MCP and provider tokens server-only (already the case). Add rotation notes.

### 4.12 AI image tools beyond Generate

| Tool | Model / approach | Cost per use (est.) | Effort | Note |
|---|---|---|---|---|
| Background removal / cut-out | Bria RMBG 2.0 API (fal or Bria) | $0.018 | S | Commercial-safe; cache per image |
| Upscale low-res pool photos | fal Crystal Upscaler about $0.016 per megapixel (third-party) | about $0.03–0.06 | S | Only when the source is under the output size; mark "upscaled" in metadata |
| Smart crop per placement | MediaPipe face detector in the browser (planned C9) | $0 | — | Needed by §4.5 |
| "Fix my design" critique | Haiku vision on one 540px render + lint codes → 3 suggestions with one-click fixes (tint, shorten, swap photo) | about $0.001 | M | Extends planned C2; keep it advisory |
| Headline "pick likelihood" → real prediction | Planned C7 + §4.2 data: logistic model on hook type × template × sport × time → saves per view | $0 | M | Only after about 300 posted designs with metrics |
| Voice brief on phones | Gateway STT (the Scribe/Whisper class already in the Reels research) → Generate brief | about $0.001 per 30 s (est.) | S | Pairs with game-day mode |
| Guardrails for any image generation | Keep the hard rule: no generated athletes or logos; scenes only; a provenance tag in metadata (`ai_generated:true`) and on-image disclosure where a platform requires it | — | S | Matters for Meta "AI info" labels |

### 4.13 Phone "game-day mode"

**Problem:**
- Game nights happen away from desks. The editor at 375px works (spacing pass 2026-11-16), but it is a desktop editor shrunk down.
- Reels' phone Export bug shows how phone paths rot (`launch-readiness` P1 #3).

**Idea:** a `quick.html` PWA view with three taps:
1. Template (Final Score, Stat Line, Quote, Breaking).
2. Fill: the game picker from §4.3, or a voice or typed brief.
3. **Share**: the Web Share API hands the image and caption to the Instagram, X or Slack app.

Plus:
- **Install to home screen** (manifest + service worker caching the shell, which also speeds up desktop);
- **Offline drafts** (IndexedDB already exists).

**Effort:** M.

**Dependencies:** §4.3 (data), §4.1 (cloud drafts).

### 4.14 Admin: north-star view, template leaderboard, cost per export (Top 10 #10)

**What exists:**
- The Dashboard shows exports, active creators, visitors, open requests, activity, review queue, people and AI usage (`fetchAiUsage`).
- `frameup_my_ai_spend` per user.

**Add an "Impact" tab:**
- **Time to export:** from the first edit event of a design session to its export. Needs an `editor_open` / `draft_created` activity event with a session id. `recordActivity` exists, so the client adds two event types.
- **Designs per active creator per week**, the WAU/MAU ratio, and retention cohorts (week 1, 4, 8).
- **AI → export conversion:** Generate runs (`frameup_ai_usage` feature `generate`) vs exports with `metadata.generated`, and the unedited share.
- **AI cost per export** = AI $ in the period / exports that used AI.
- **Template leaderboard:** exports by `workspace_variant`; reuse (the same template by 3+ people); from §4.2, saves per view and clicks.
- **Quality:** lint warnings at export (planned C2), review rejections (§4.8), admin stars (`frameup_design_ratings`).
- **Request SLA:** median request → delivered, and the share on time.

**Effort:** S–M, mostly SQL views plus the existing dashboard components.

### 4.15 Onboarding and help (beyond tours)

Tours, What's new, Guidelines, the FAQ and How FrameUp works exist. Add:
- **"What good looks like":** a Gallery filter "Starred" (admin stars from `frameup_design_ratings`, Phase 3 of the brain), with a one-line "why it works" (planned C8). Effort S once stars exist.
- **Prompt library:** the best Generate briefs (from the corpus, starred) as "Try" chips by sport. Generate already has Try chips, so make them data-driven. Effort S.
- **Template gallery page:** every template with its real thumbnail, sizes, "best for" and last-30-day usage (from §4.14). Effort S.
- **In-product feedback** on each AI result (thumbs plus a reason) feeds `frameup_generate_events` (the brain's Phase 2). Already planned; just make sure it ships.

### 4.16 Performance and reliability (beyond launch-readiness P1/P2)

Launch-readiness already lists painting the shell first and splitting `index.html` (1.0 MB inline). Additions:
- **A service worker** (shared with §4.13) that caches CSS, JS and fonts by `?v=` keys: the second load is near-instant. Effort S–M.
- **A performance budget in CI:** `scripts/` already has tests. Add one that fails if any page's inline payload grows past a budget, or a `?v=` key is stale (the dashboard test already checks keys). Effort S.
- **Image egress:** move newsletter images to the ESP or another CDN (already suggested in the egress entry). Beehiiv's media library or an image CDN removes Supabase quota risk. Effort S–M.
- **Error budgets:** Sentry alerts above 1% of sessions erroring; uptime under 99.5% a week goes to Slack.

### 4.17 Collaboration: team spaces and co-editing

- **Team spaces:** saved filters per desk (NFL, CFB, MLB, Newsletter), shared folders of drafts, "assigned to my desk". Cheap once drafts are in the cloud. Effort S–M.
- **Real-time co-editing:** XL (CRDT, presence, conflict handling inside a 1 MB editor). **Not recommended.** Use review links (§4.8) and duplicate-to-edit instead.

### 4.18 Personalisation and localisation

- **Team variants:** one design × N teams (the Huddle newsletters: Chiefs, Cowboys, Steelers) is bulk create (§4.6) with a "team" column. Covered there.
- **Player-name variants** (spellings, nicknames): add a `player-aliases.json` used by lint and the image search. Effort S.
- **Spanish:** defer (low value for a US-English audience; `ai-strategy` dropped it). Revisit if ES launches Spanish social.

---

## 5. Quick wins (1–3 days each)

| # | Quick win | Why | Touches | Est. days |
|---|---|---|---|---|
| 1 | **Sentry on all pages + functions** (free tier), release = `/api/version` sha, emails hashed | See crashes before users report them | `app-shell.js` include, `netlify/functions/*` wrapper | 1 |
| 2 | **Uptime + Slack alert** for `/`, Generate, `/api/version`, `/api/trend-design` | Know when FrameUp is down on game night | Vercel cron or an external monitor; `SLACK_*` env | 0.5 |
| 3 | **"Posted it? Paste the link"** on export and the Gallery card + UTM on copied links | Starts the performance dataset today, at $0 | New `frameup_posts` table; export dialog; `gallery.html` | 2–3 |
| 4 | **Remove background** button in the photo panel (Bria via the Gateway or fal), cached per image | Player cut-outs are a staple of sports graphics | New `es-image-cutout.js` function; editor photo panel | 2 |
| 5 | **Template leaderboard + time-to-export** on the Dashboard (`editor_open` activity event + SQL view) | Shows which templates earn their keep; baseline for the north star | `dashboard.html`, `dashboard-data.js`, one view | 2–3 |
| 6 | **Request status to Slack thread + "My requests"** for requesters | Closes the loop people ask about most (inferred) | `design-request-submit.js` (store `ts`), new `request-status-notify` function, `design-request.html` | 2–3 |
| 7 | **Contrast check at export** (pixel sample under text boxes) | Readability on busy photos; accessibility | Editor export check (already exists, `editor-basics.md`) | 1–2 |
| 8 | **`alt=` in newsletter widget Copy HTML** (from the widget text) | Accessibility + email clients; trivial | Newsletter widget builder | 0.5 |
| 9 | **Tentpole calendar JSON + "This week in sports"** strip on Home | Planning prompt without building the planner yet | `tours/`-style JSON file + Home strip | 1–2 |
| 10 | **Cloud draft backup** (write-only mirror of IndexedDB autosave; restore on a new device) | Protects work; first step of §4.1 | `frameup-autosave.js`, `frameup_drafts` | 3 |

---

## 6. 90-day roadmap

Assumes one builder agent stream plus Suhail's reviews, and the creative-brain and Reels work continuing in parallel. The phases avoid `index.html` conflicts by putting new UI in new files where possible.

### Days 1–30: "Trust and truth": foundations and the data loop starts

**Build:**
- quick wins 1–3 and 5–8;
- cloud drafts (§4.1, full);
- Beehiiv stats import (§4.2 step 2);
- Google sign-in check and roles (§4.11);
- sports-data vendor trial: MySportsFeeds NFL + CFB (§4.3), prototype only.

**Acceptance criteria:**
- Sentry receives errors from browser and server with release tags. Zero unhandled errors over 1% of sessions for 7 days.
- Uptime alerts fire in a test.
- A draft started on laptop A opens on laptop B within 30 s. Deleting browser data loses nothing saved more than 30 s earlier.
- At least 50% of exports in week 4 have a posted URL. If not, the reminder UX gets reworked.
- Newsletter widgets show per-widget clicks for at least one Beehiiv publication.
- The Dashboard shows time-to-export (median) and the template leaderboard for the last 30 days.

### Days 31–60: "Game day": live data, speed and sizes

**Build:**
- game-day templates for NFL and CFB: Final Score, Stat Line, Standings (§4.3), with "game just ended" nudges;
- size packs for the top 4 templates (§4.5);
- background removal (QW4) wired into the stat and cover templates;
- the phone quick mode for the Final Score and Stat Line (§4.13);
- Design Request two-way Slack (§4.7).

**Acceptance criteria:**
- **Final whistle → exported final-score graphic in ≤ 3 min median**, measured from the feed `final` timestamp to export. That is a baseline plus a target; today it is not measurable.
- Zero hand-typed scores in Final Score exports (`stat-source` present on 100%).
- Size pack: one click produces 4:5, 9:16 and 16:9 with no text outside the safe zones (lint).
- On a 375px phone: template → share sheet in 3 taps, under 60 s.
- Requesters get Slack thread updates on every status change. The "My requests" page loads in under 1.5 s.

### Days 61–90: "Plan and learn": calendar, bulk, review, performance

**Build:**
- the planner (§4.4), with games and the tentpole JSON, slots linked to requests and exports;
- bulk create from CSV/Sheet (§4.6);
- review links, comments and version history (§4.8);
- Instagram Insights import (§4.2 step 3, if Meta access is granted);
- performance in the leaderboard;
- the Generate corpus uses `performance_score`;
- rights badges + the editorial-only block in Video Ads (§4.9 step 1).

**Acceptance criteria:**
- Every tentpole in the next 30 days has at least one slot. At least 70% of exports link to a slot or request.
- A 32-row power-rankings CSV renders 32 lint-clean graphics in under 3 min in the browser.
- Review: a reviewer can comment, approve and restore a version. Video Ads exports require approval when the admin enables it.
- At least 200 posted designs have IG or Beehiiv metrics. The leaderboard ranks templates by saves per 1k views and clicks.
- No editorial-only image can be exported from Video Ads (test).

**Not in the 90 days:**
- direct scheduling (§4.5b);
- find-similar embeddings;
- co-editing;
- localisation;
- headless `/api/render`. Revisit at day 90 with the metrics.

---

## 7. Metrics and instrumentation plan

### North-star metric

**Posted designs per week that were made in FrameUp** ("FrameUp-made posts"), with a quality floor: it excludes designs later flagged or taken down.

**Why this one:**
- It counts real output reaching fans, not clicks inside the tool.
- It rises with adoption, speed and trust together.
- It needs §4.2 step 1 (posted URLs). Until then, use **weekly exports** as the proxy.

### KPIs (targets are suggestions, to be set after a 30-day baseline)

| KPI | Definition | Source (existing → new) | Target at day 90 (est.) |
|---|---|---|---|
| Adoption | WAU / MAU among approved users; % of the social + newsletter team active weekly | `es_designer_presence`, `es_designer_activity` | WAU/MAU ≥ 60% |
| Output | Exports per active creator per week | `es_designer_tasks` (`task_type='exported_design'`) | +30% vs baseline |
| **Time to export** | Median minutes from `editor_open` (or Generate run start) to export, per template | `es_designer_activity` + new events `editor_open`, `draft_created` with `session_id` | −40% vs baseline |
| Game-day speed | Feed `final` → Final Score export, median | `frameup_sports_cache` + export `stat-source` | ≤ 3 min |
| Posting rate | % of exports with a posted URL within 48 h | `frameup_posts` | ≥ 60% |
| Performance | Median saves per 1k views (IG); clicks per send (Beehiiv widgets); by template | `frameup_post_metrics` | Track; leaderboard in use weekly |
| Reuse | Share of exports from templates used by 3+ people; drafts duplicated | tasks + drafts | Track |
| AI usefulness | Generate runs → export rate; % exported unedited (`generated.aiText` = lines) | `frameup_ai_usage`, tasks metadata, `frameup_generate_events` | Run→export ≥ 35% (est.) |
| AI cost per export | AI $ / exports that used AI, weekly | `frameup_ai_usage.cost_usd` + tasks | ≤ $0.05 (est.) |
| Quality | Lint warnings per export; review rejections; avg admin star | lint at export (C2), `frameup_reviews`, `frameup_design_ratings` | Warnings ↓ 50% |
| Requests | Median request → delivered; % on time | `es_designer_tasks` status timestamps (add `status_changed_at` history via activity) | ≥ 85% on time |
| Reliability | Sessions with an error; p75 LCP per page; uptime | Sentry, vitals events, monitor | < 1%; LCP < 2.5 s; ≥ 99.5% |

### Instrumentation to add

1. **Activity events** (client, via the existing `recordActivity`). Each has `meta.session_id` (one per editor tab) and `meta.template`:
   - `editor_open`, `draft_created`, `template_changed`;
   - `export_started`, `export_done`;
   - `size_pack_export`;
   - `bulk_batch {rows, failed}`;
   - `posted_link_added`;
   - `review_requested`, `review_decided`;
   - `game_nudge_shown`, `game_nudge_used`;
   - `vitals {lcp, inp, page}`.
2. **Export metadata:** `session_id`, `slot_id`, `request_id`, `stat_source`, `bulk`, `size`, `ai_used`, `asset_ids`.
3. **Usage logs:** `frameup_ai_usage` already logs feature, model, tokens and cost. Add `run_id` / `task_id` (already recommended in `ai-strategy` B4) so cost per export can be joined.
4. **Views:** `frameup_kpi_weekly` (security definer, admin only), computing the table above. The Dashboard's Impact tab reads it.
5. **Privacy:** no emails in event `meta`, and hash user IDs in Sentry. The activity table already stores the actor email by design (admin-only RLS), so keep that, but don't spread it.

---

## 8. Decisions and questions for Suhail

1. **User interviews.** Can I (or you) do 5 × 20-minute chats: 2 social editors, 1 newsletter editor, 1 designer, 1 requester? The personas in §2 are inferred.
2. **Priority order.** Do you agree with "trust → posted data → game day → planner"? Or is game day (#3) more urgent for this NFL and CFB season, so it moves to days 1–30?
3. **Sports data vendor and budget.** OK to trial MySportsFeeds commercial (about $39–49 per league a month for CORE, more for live, stats and injuries; est. $100–200 a month total)? Which leagues first: NFL + CFB, then MLB in spring? Is the ESPN unofficial JSON acceptable for **internal prototyping only**? I recommend never using it in production.
4. **Where do posts go today?** Which scheduler, if any (Sprout, Later, Buffer, Meta Business Suite, native apps)? This decides integrate vs build for §4.5b. Who is the **Meta Business admin** for Instagram Insights access?
5. **Beehiiv plan.** Which plan are the publications on? The Create Post API is Max/Enterprise; the stats API is broadly available (verify). Can we get a server-side API key?
6. **Slack app.** OK to replace the design-request webhook with a FrameUp Slack app (bot token, slash command, message action)? Who approves apps in the ES Slack?
7. **Image rights.** Who at ES can say which agencies' photos are editorial-only, and whether that data exists in WordPress or ES Storage? Should FrameUp **block** editorial-only images in Video Ads and sponsor creative, or only warn?
8. **Approvals.** Opt-in per workspace? Which workspaces should require review by default: Video Ads (paid), sponsor work, none?
9. **Background removal and upscaling spend.** OK to add Bria cut-outs (about $0.018 each, est. $5–10 a month) under the existing AI caps?
10. **Monitoring.** OK to add Sentry (free, then about $26 a month if needed) and an uptime monitor? Where should alerts go: a new `#frameup-alerts` channel?
11. **Sign-in.** Is Google Workspace sign-in already enabled? I couldn't read `login.html` / `es-auth.js` in this session. If not, should it replace the password sign-in?
12. **Planner ownership.** Who owns the tentpole calendar JSON each season (dates for drafts, deadlines, majors)?

---

## 9. Sources (all accessed 2026-11-17)

**Internal (repo):** `project-docs/ai-edit-log.md`, `launch-readiness.md`, `ai-strategy-and-costs.md`, `generate-creative-brain-research.md`, `generate-ux-plan.md`, `ai-reels-research.md`, `frameup-design-system.md`, `release-tours.md`, `ai-images-es-storage.md`, `family-rollout-brief.md`; `app-shell.js`; `index.html` (grep); `dashboard-data.js`; `frameup-autosave.js`; `site-chrome.js` (Beehiiv publications); `netlify/functions/design-request-submit.js`, `es-image-search.js`, `_es-mcp.js`; `supabase/migrations/*`.

**Design and creation tools:**
- Canva Brand Controls: https://www.canva.com/help/brand-control/
- Canva brand management: https://www.canva.com/solutions/brand-management-tools/
- Canva Content Planner: https://www.canva.com/pro/content-planner/
- Canva AI / Magic Studio overview (Metricool): https://metricool.com/how-to-use-canvas-ai-features-for-social-media/
- Adobe MAX 2026 Express takeaways (Brand Check beta): https://www.adobe.com/express/learn/blog/takeaways-adobe-max-2026
- Adobe Express Business, scale on-brand content: https://business.adobe.com/products/express-business/scale-on-brand-content.html
- Figma Buzz help, bulk create: https://help.figma.com/hc/en-us/articles/31271589645079-Create-marketing-assets-in-Figma-Buzz
- Introducing Figma Buzz: https://www.figma.com/blog/introducing-figma-buzz/
- Figma Config 2026 coverage: https://thenextweb.com/news/figma-config-code-layers-ai-skills-plugins-animations and https://www.techzine.eu/news/devops/144997/figma-introduces-workflows-for-new-development-methods/
- Kittl overview (aitoolsatlas): https://aitoolsatlas.ai/tools/kittl
- Picsart / Canva-alternative roundups (third party): https://flowith.io/blog/picsart-ai-2026-vs-canva-pro-social-media-short-form-video/
- Predis.ai vs Ocoya (Capterra): https://www.capterra.co.uk/compare/1014570/1015235/predisai/vs/ocoya
- Typeface Marketing Orchestration Engine (Mar 2026): https://typeface.ai/blog/typeface-marketing-orchestration-engine
- Typeface agentic platform (Jul 2026): https://www.typeface.ai/blog/how-typefaces-agentic-platform-works-for-enterprise-marketing-teams
- Bannerbear vs Placid (2026): https://www.bannerbear.com/blog/bannerbear-vs-placid/
- Bannerbear vs Templated (2026): https://www.bannerbear.com/blog/bannerbear-vs-templated/
- Box Out Sports score templates: https://www.boxoutsports.com/graphics/tags and https://boxoutsports.com/graphics/multi-format/multi-format-score
- Game-day graphics guide (Krumzi, 2026): https://www.krumzi.com/blog/game-day-graphics

**Sports-specific platforms and peers:**
- WSC Sports (GenAI division): https://www.broadcastnow.co.uk/tech-innovation/wsc-sports-launches-genai-division-and-three-new-products/5194068.article
- Futurism on AI sports video: https://futurism.com/artificial-intelligence/ai-startup-sports-world-cup-video-slop
- Greenfly sports leagues: https://www.greenfly.com/?p=11564
- Greenfly acquires Miro AI (SVG Europe): https://www.svgeurope.org/blog/news-roundup/greenfly-acquires-ai-provider-miro-ai-to-enhance-short-form-content-solutions/
- Minute Media Voltax video: https://minutemedia.com/voltax-video
- Minute Media publisher solutions (beta): https://beta.minutemedia.com/solutions/publishers
- Digiday on House of Highlights: https://digiday.com/media/bleacher-reports-aims-to-turn-house-of-highlights-into-a-business
- B/R HoH social programmer listing: https://www.showbizjobs.com/jobs/bleacher-report-social-programmer-hoh-in-new-york/jid-d96nxk
- FOS, sports designers push back on AI: https://frontofficesports.com/newsletter/sports-designers-push-back-on-ai/
- FOS, sports pushing into AI content despite fan pushback (Oct 2026): https://frontofficesports.com/article/sports-pushing-further-into-ai-content-despite-fan-pushback/
- FOS, On3 graphic designer: https://frontofficesports.com/article/on3-tipton-fawcett-graphic-designer-college-sports-insiders/
- Slate for NFL teams: https://slateteams.com/blog/nfl-squads-use-slate-to-upgrade-real-time-social-media-presence

**Sports data:**
- MySportsFeeds pricing: https://www.mysportsfeeds.com/feed-pricing/
- TheSportsDB pricing: https://www.thesportsdb.com/pricing
- SportsDataIO developers / trial: https://sportsdata.io/developers and https://sportsdata.io/trial
- Sportradar review (sportsapis.dev): https://sportsapis.dev/apis/sportradar
- Sportradar alternative pricing claims (Sportmonks): https://www.sportmonks.com/football-api/alternatives/sportradar/
- ESPN hidden API guide (Zuplo): https://zuplo.com/learning-center/espn-hidden-api-guide
- ESPN API overview (sportsapis.dev): https://sportsapis.dev/espn-api
- DataGolf API access: https://datagolf.com/api-access/v2
- Goalserve golf prices: https://www.goalserve.com/sport-data-feeds/golf-api/prices
- api-sports.io pricing: https://api-sports.io/pricing (returned 403; unverified)

**Publishing and analytics:**
- Instagram content publishing (Meta): https://developers.facebook.com/documentation/instagram-platform/content-publishing
- Instagram media insights (Meta): https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights/
- Instagram Insights updates (Supermetrics): https://docs.supermetrics.com/docs/instagram-insights-updates
- Instagram API rate limits (bundle.social, Aug 2026): https://bundle.social/blog/instagram-api-rate-limits
- X API pricing 2026 (third party): https://postproxy.dev/blog/x-api-pricing-2026 and https://opentweet.io/x-api-pricing
- beehiiv Send API / Create post (Aug 2026): https://www.beehiiv.com/support/article/36759164012439-using-the-send-api-and-create-post-endpoint
- beehiiv post update API: https://developers.beehiiv.com/api-reference/posts/update
- beehiiv post analytics (Pipedream action): https://pipedream.com/apps/beehiiv/actions/get-post-analytics
- Buffer API open (May 2026): https://buffer.com/resources/buffer-api-is-here/
- Buffer legacy API retirement: https://kompozy.io/news/buffer-legacy-api-retirement
- Sprout / Hootsuite / Later pricing comparisons (third party): https://resources.rework.com/tools/social-media/best-sprout-social-alternatives and https://sociallyin.com/blog/sprout-social-vs-hootsuite/
- Instagram originality update (Apr 2026): https://petapixel.com/2026/04/30/new-instagram-policies-target-reposted-content/ and https://tubefilter.com/2026/04/30/instagram-removes-algorithm-recommendations-repost-content-aggregator

**Images, AI tools, infrastructure:**
- Getty Images content licence: https://www.gettyimages.com/license-information
- Getty rights and clearance: https://www.gettyimages.com/rights-and-clearance
- Imagn ethics / Reuters licensing note: https://imagn.com/ethicsPolicy
- Bria RMBG-2.0 model card (CC BY-NC): https://huggingface.co/briaai/rmbg-2.0
- Bria commercial RMBG: https://bria.ai/rmbg-for-commercial-use
- Bria pricing: https://bria.ai/pricing
- fal Bria background remove: https://fal.ai/models/fal-ai/bria/background/remove
- fal best background remover APIs 2026: https://fal.ai/learn/tools/best-background-remover-apis-2026
- fal upscalers: https://fal.ai/learn/tools/image-to-image-upscalers
- Supabase SAML SSO: https://supabase.com/docs/guides/auth/sso/auth-sso-saml
- Supabase Google Workspace SSO: https://supabase.com/docs/guides/platform/sso/gsuite
- Clerk on SSO pricing / `hd` claim: https://clerk.com/articles/auth-platforms-with-sso-and-scim-in-the-base-tier-2
- Sentry pricing (third party, verify at sentry.io/pricing): https://last9.io/blog/sentry-pricing/ and https://toolradar.com/tools/sentry/pricing
