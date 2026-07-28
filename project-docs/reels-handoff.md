# Reels Workspace — AI Handoff

**Read this before touching anything Reels-related.** This is a snapshot of *current state* — for the
full chronological history of every change and why, see [ai-edit-log.md](ai-edit-log.md). For the
original product/competitor research, see [reels-workspace-plan.md](reels-workspace-plan.md).

Last updated: 2026-07-28.

## Where things stand right now

A working MVP exists at `reels.html`, linked as the 4th workspace card on `index.html`'s homepage and
in the nav dropdowns of `index.html`/`how-it-works.html`. It has **not been visually verified in a
browser by the assistant** — this page (like every workspace page) is gated by real Supabase login,
which can't be exercised against the local `python3 -m http.server` preview (no Node/`netlify dev` in
this environment), and bypassing the auth gate to check has been explicitly declined twice already (see
log). **Everything here has been verified by Suhail logging in and reporting back**, not independently
confirmed. Assume anything not explicitly called out as "Suhail confirmed" is unverified in a real
browser.

Confirmed bugs found this way, since fixed:
- Uploaded video showed nothing (canvas painted a decoded-less frame → looked like the empty state) —
  fixed by forcing a seek and waiting for the `seeked` event before revealing the canvas, plus added a
  loading spinner and error state.

## Architecture decisions already made (don't re-litigate these)

- **Own top-level page** (`reels.html`), not a route inside `index.html`'s shared canvas-editor SPA.
  That SPA (`.app[data-workspace]`) is one shared canvas/state model across Instagram/YouTube/Newsletter
  in a ~15k-line file — a video timeline is different enough that bolting it on risked breaking the
  existing workspaces. Matches how `how-it-works.html`/`dashboard.html` already sit outside it.
- **Client-side render/export** — `canvas.captureStream(30)` + `MediaRecorder`, no server-side render
  job. Confirmed by Suhail over the alternative (ffmpeg-style render service), specifically because this
  repo has zero video infrastructure today and a server-side path would be new infra, not an extension.
- **Team colors come from `brand-kit.js`** — extracted verbatim from `index.html`'s existing `BRAND_KIT`
  (163 teams, 8 leagues: NFL/NBA/MLB/CFB/CBB Men+Women/WNBA/WNBA Unrivaled, + 4 tennis surfaces). This is
  a **live duplicate** of `index.html`'s inline copy right now, not a shared single source — `index.html`
  was intentionally not touched to consume the external file, to avoid risk to the main app. Follow-up:
  point `index.html` at `brand-kit.js` once this is confirmed stable, so there's one source of truth.
  Known gap: no Golf or NASCAR entries in `BRAND_KIT` (team-sports only) — those two newsletters
  (Essentially Golf, Lucky Dog on Track) have no team-color option today.
- **No manual color/position controls — prompt-only restyling.** This was a deliberate UX correction
  (Suhail, after linking Riverside 2.0): captions/lower-thirds get styled/repositioned *only* via the
  contextual prompt box, not dropdowns or manual x/y fields. Caption **text and timing** are the
  exception — those stay manually editable (typing + timeline drag), matching Instagram's Reel editor.
- **No standalone "Prompt" tab.** Only two tabs: Captions, Lower Thirds. The restyle prompt box appears
  contextually — under a selected caption's detail card, or under a placed lower third — never as its
  own persistent panel.

## What's real vs. stubbed — check this before claiming something "works"

| Feature | Status |
|---|---|
| Video upload, canvas preview, playback/scrub | Real, but core-loop only tested by static code review, not a browser |
| Caption auto-generation | **Stub.** Chunks the clip into ~2.6s segments with placeholder text ("Caption 1 — tap to edit"). Not real speech-to-text. |
| Caption timeline (select, drag-to-retime) | Real logic (pointer events, no library), unverified in-browser |
| Caption text/timing manual edit | Real |
| Lower-third templates (6) + placement | Real |
| Restyle prompt (recolor by team name, reposition by keyword) | **Local heuristic only.** Regex-matches a team name against `brand-kit.js`; keyword-matches top/bottom/left/right/center. Not Claude/MCP-backed — see plan §3 for the intended architecture (Claude tool-use calling `search_images` via ES's existing MCP integration, plus `brand-kit.js` data). |
| Export (`captureStream` + `MediaRecorder` → `.webm`) | Real logic, **never tested against an actual recorded clip** |

## Immediate next steps, in likely priority order

1. **Get real browser verification.** Someone with login access needs to actually upload a clip,
   generate captions, drag timeline edges, place a lower third, use the prompt box, and export — and
   report back what breaks. Nothing past "the code looks internally consistent" has been confirmed.
2. **Decide a transcription provider** (plan §7, open question 2) to replace the caption-generation stub
   with real speech-to-text.
3. **Decide the Claude/MCP wiring** for the prompt box (plan §3) — needs a Netlify/Vercel function and
   an API key decision; currently 100% client-side heuristic.
4. **De-duplicate `brand-kit.js`** vs. `index.html`'s inline `BRAND_KIT` once the standalone file is
   confirmed stable, so team-color data has one source of truth.
5. Decide whether Golf/NASCAR need `BRAND_KIT` color entries added, or stay generic-styled.

## How to resume work here

- Repo: fresh clone at `/Users/suhailquraishi/Downloads/AI Meet/essentiallysports-design-tools`, origin
  = `essentiallysports-tech/essentiallysports-design-tools` directly (not a fork) — pushes go straight
  to the live site.
- Local preview: `python3 -m http.server 8935` (config `design-tools` in the sibling session repo's
  `.claude/launch.json` — preview tooling reads from there, not this repo's own launch.json).
- Standing rules (from `ai-edit-log.md`): always give a local preview link before pushing; "push" means
  commit + push straight to `main`; "roll back" means revert to the commit before the last push; no
  unrequested extra work.
- Last rollback point before the whole Reels feature: `506e2cd` (see log for exact commits since).
