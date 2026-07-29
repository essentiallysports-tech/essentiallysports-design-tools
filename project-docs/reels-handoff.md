# Reels Workspace — AI Handoff

**Read this before touching anything Reels-related.** This is a snapshot of *current state* — for the
full chronological history of every change and why, see [ai-edit-log.md](ai-edit-log.md). For the
original product/competitor research (now partly superseded, see below), see
[reels-workspace-plan.md](reels-workspace-plan.md).

Last updated: 2026-07-29.

## Read this first: Reels has been worked on by more than one session

This session built the original Reels MVP (2026-07-28: stub captions, local-heuristic prompt,
client-side-only). Between one push and the next, **someone else — unclear exactly who, possibly
Suhail directly, possibly another AI session reading this same handoff doc — pushed 15 commits that
substantially rewrote it**: real speech-to-text (`netlify/functions/es-video-intelligence.js`, Groq
Whisper / OpenAI / ES MCP with fallback), a proper 4-step "Reels Studio" flow (Upload → Speech
Recognition → Transcript Review → Brand Styling), SRT export, and a real backend-connected AI prompt
(`applyIntelligence()`, not a local heuristic).

**Before doing anything else, run `git fetch && git log --oneline origin/main -20`** and compare
against local `main` — do not assume local history is current. This bit the previous session: it had a
local unpushed fix, `git push` was rejected, and reconciling required checking each fix against the new
code individually rather than merging blind. See the 2026-07-29 log entries for exactly how that went.

## Where things stand right now

`reels.html` — "Reels Studio" — is the 4th workspace card on `index.html`'s homepage, linked from the
nav dropdowns of `index.html`/`how-it-works.html`. It has **never been opened in a real browser by any
AI session** — it's gated by real Supabase login, which can't be exercised against the local
`python3 -m http.server` preview (no Node/`netlify dev` here), and bypassing that gate has been declined
multiple times. All verification described below used a throwaway QA harness (own scratch dir, deleted
after use) that loads the real `reels.css`/`reels.js`/`brand-kit.js` directly with **no auth code
included at all** — not a stripped copy of the gated page — so the login gate itself has never been
touched or bypassed.

Confirmed bugs found this way, since fixed:
- Uploaded video showed nothing — `drawImage` on a video with no decoded frame yet paints nothing.
  Fixed by seeking and waiting for `seeked` before revealing the canvas.
- That same seek forced `currentTime = 0` exactly, which is a no-op in some browsers and never fires
  `seeked` — leaving the workspace permanently stuck thinking no video had loaded (this was the actual
  cause of "captions aren't being generated"). Fixed with a non-zero offset + timeout fallback. Found
  and fixed **twice**, independently, in both the original stub code and the rewritten code — same bug,
  same fix, carried across the rewrite.
- MP4 export: `MediaRecorder` output was WebM-only. Now prefers real `video/mp4` (H.264/AAC) where the
  browser supports it, honestly falling back to WebM otherwise (not mislabeling a WebM file as `.mp4`).
  Verified producing a real non-empty MP4 blob against the *actual current* rewritten export function,
  which also does something the original MVP didn't: merges the original clip's audio track into the
  canvas capture (`createCaptionedExportStream`).
- The original local-heuristic prompt matcher required the *entire* prompt to equal/contain the *entire*
  official team name, so "make it Lakers colors" never matched "Los Angeles Lakers". **This is now moot**
  — the rewrite replaced the local heuristic with a real backend call, and its own local fallback
  matcher (`findBrandCandidates`) already handles this correctly (splits the prompt into words, matches
  against sport+team+variation combined) — arguably better than the original fix would have been.

## Architecture decisions — which ones still hold, which don't

Still holding:
- **Own top-level page** (`reels.html`), not a route inside `index.html`'s shared canvas-editor SPA —
  unchanged by the rewrite.
- **Client-side canvas rendering + `MediaRecorder` export** — unchanged, though export got more
  sophisticated (original-audio-track merging, MP4 preference).
- **Team colors from `brand-kit.js`** (163 teams, 8 leagues, extracted verbatim from `index.html`'s
  `BRAND_KIT`) — still the source the rewrite's brand controls and prompt fallback both read from.
  Still a live duplicate of `index.html`'s inline copy, still not de-duplicated. Still no Golf/NASCAR
  entries (team-sports only).

**Superseded by the rewrite** (documented here so nobody "fixes" this back per the old decision):
- ~~No manual color/position controls — prompt-only restyling~~ — the rewrite brought back a manual
  Sport/Team dropdown and a palette-swatch row (`reels-sport-select`, `reels-team-select`,
  `reels-palette-row`) in the "Brand Styling" step, alongside the AI prompt box, not instead of it.
- ~~No standalone Prompt tab~~ — the rewrite uses an explicit 4-step flow (Upload → Speech Recognition →
  Transcript Review → Brand Styling) rather than the original's two-tab (Captions / Lower Thirds)
  layout with a contextual-only prompt. The AI prompt (`reels-intel-prompt` / `applyIntelligence()`)
  lives in the Brand Styling step.
- ~~Caption generation is a stub~~ — real speech-to-text now exists via
  `netlify/functions/es-video-intelligence.js`, with a live status probe
  (`refreshSpeechBackendStatus()`) that reports whether Groq/OpenAI/ES-MCP transcription is actually
  configured. This was the single biggest open item in the original plan and appears to be solved.

## What's verified vs. not

| Area | Status |
|---|---|
| Video upload → real frame renders | **Verified** (QA harness, both the original and rewritten code) |
| MP4 export with real audio-track merging | **Verified** — real non-empty MP4 blob, correct codecs |
| Real speech-to-text transcription | **Not verified by any AI session.** The rewrite's own status probe reported "Groq Whisper captions... ES MCP is connected" when checked, suggesting it may already be live, but the actual transcription call itself (hitting their deployed Vercel backend) was not exercised — out of scope for verifying the two fixes above, and depends on external live infrastructure/API keys this session has no visibility into. |
| Backend-connected AI prompt (`applyIntelligence`) | **Not verified.** Same reasoning — depends on the live backend. |
| The real gated `reels.html` page itself (login, nav, real resolution) | **Never opened by any AI session.** Everything above was tested via a throwaway harness with no auth code. |

## Immediate next steps

1. **Get real gated-page verification** — someone with login access should click through the actual
   `reels.html`, especially the real speech-to-text and `applyIntelligence` prompt, since those depend
   on live backend infrastructure no AI session here can see into.
2. **De-duplicate `brand-kit.js`** vs. `index.html`'s inline `BRAND_KIT` — still not done, still a live
   duplicate.
3. Decide whether Golf/NASCAR need `BRAND_KIT` color entries, or stay generic-styled.
4. **Before starting any new Reels work, `git fetch` first** — see the top of this doc.

## How to resume work here

- Repo: fresh clone at `/Users/suhailquraishi/Downloads/AI Meet/essentiallysports-design-tools`, origin
  = `essentiallysports-tech/essentiallysports-design-tools` directly (not a fork) — pushes go straight
  to the live site.
- Local preview: `python3 -m http.server 8935` (config `design-tools` in the sibling session repo's
  `.claude/launch.json` — preview tooling reads from there, not this repo's own launch.json).
- Standing rules (from `ai-edit-log.md`): always give a local preview link before pushing; "push" means
  commit + push straight to `main`; "roll back" means revert to the commit before the last push; no
  unrequested extra work; **fetch before assuming local history is current** (new, learned the hard way).
