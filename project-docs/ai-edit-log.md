# AI Edit Log

Running handoff log for edits made to this site by any AI assistant (Claude or otherwise).
**Read this file first** before making changes, so you know what's in progress, what's finished,
and what's still uncommitted.

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
