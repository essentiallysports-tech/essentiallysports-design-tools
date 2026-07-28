# Reels Workspace — Product & Technical Plan (draft)

Status: **MVP built, uncommitted.** Written 2026-07-28 after a competitor scan and a pass through this
repo's existing workspace architecture; a first working slice now exists at `reels.html` (see
`project-docs/ai-edit-log.md` for what's actually implemented vs. still stubbed). Not pushed yet.

**UX correction (2026-07-28, after seeing Riverside 2.0):** the original draft below described a
tabbed UI with a persistent "Prompt" tab and manual add-caption/sport-team-color controls. Suhail
corrected this after pointing at [Riverside 2.0](https://riverside.com/blog/riverside-2-0), which adds
"professional animated overlays directly in the editor, and tweak them with a prompt" — i.e. the prompt
is contextual to a placed element, not a standalone tool. The corrected flow, now built:
- Captions are **auto-generated** (one click), then edited on a timeline — segments you tap to select,
  drag the edges to retime, matching [how Instagram's Reel editor already works](https://sendshort.ai/guides/add-subtitles-reels/)
  (tap a caption → a timeline appears with a draggable duration bar).
- There is **no separate Prompt tab.** A contextual "restyle with a prompt" box appears only once a
  caption exists (selected on the timeline) or a lower third has been placed — and it's the *only* way
  to restyle/reposition those elements now (manual sport/team/color dropdowns and manual x/y controls
  were removed in favor of prompt-driven styling, per "edit those without manual intervention").
  Caption **text and timing** stay manually editable (typing + drag), matching Instagram's own editor —
  only the *styling* moved to prompt-only.

## 1. What we're building

A fourth FrameUp workspace (alongside Social Media, YouTube Assets, Newsletter Assets) for short-form
vertical video ("Reels"): drop in a clip, get auto-captions styled in team colors, drop in ready-made
lower thirds, and use natural-language prompts to adjust either — powered by ES's internal Claude/MCP
setup for the "smart" parts (team lookups, prompt-to-style translation).

Two features requested specifically:
1. **Caption Maker** — auto-transcribe, let the user edit the text, and color captions by team (same
   idea as the team-accent-color pattern already used in the listicle workspace).
2. **Lower Thirds** — a library of ready-made lower-third templates, insertable in one click, with a
   prompt box ("make it Lakers purple and gold, move it to the top") that edits the placed graphic.

## 2. Competitor landscape (why these two features, and what "good" looks like)

Auto-caption tools in 2026 converge on the same core feature set: word-by-word or karaoke-style
timing, 90%+ transcription accuracy, and deep style control (font, color, stroke, shadow, case,
position) — [OpusClip](https://captions.ai/overview), [Kapwing](https://www.kapwing.com/subtitles/caption-generator),
[VEED](https://www.veed.io/tools/auto-subtitle-generator-online/video-caption-generator), and
[Choppity](https://www.choppity.com/tools/free-video-caption-generator/) all ship preset styles
("Hormozi-style" bold yellow keyword emphasis, karaoke highlight, pop-on) that are fully recolorable.
[Submagic](https://www.submagic.co/vs/capcut-vs-opus-pro) differentiates by shipping exact style
replicas of specific creators, which is the same instinct behind "color captions by team" — a
recognizable, on-brand preset rather than a blank style panel.

Lower-thirds tooling splits into two camps:
- **Template pickers** — [VEED](https://www.veed.io/create/text-video-maker/lower-third-maker),
  [Simplified](https://simplified.com/video-maker/lower-third), and
  [FlexClip](https://www.flexclip.com/learn/add-lower-third-to-video.html) all offer a gallery of
  pre-built graphics you drop in and fill with text.
- **Prompt-to-overlay generators** — [Video Effect Vibe](https://videoeffectvibe.com/blog/ai-video-overlay-maker)
  is the closest existing analogue to what's being asked here: describe the overlay in plain English
  ("cinematic lower third with a gold accent line and typewriter reveal") and it generates a transparent
  overlay. [OpusClip](https://www.opus.pro/blog/best-lower-thirds-generators-template-packs) also
  auto-styles and positions lower thirds as part of its caption pipeline.

Takeaway: nobody in this space treats "recolor to a specific team's brand" as a first-class preset the
way ES's own listicle/quote workspaces already do — that's a genuine differentiator here, not a feature
to copy from a competitor. The prompt-driven editing pattern (Video Effect Vibe) is worth following
closely since it's the most literal match for what was asked.

## 3. What "ES Claude MCP" already is in this repo (so the plan reuses it, not reinvents it)

This repo already has one MCP integration, used by the "AI Images" button in the Social Media workspace
(`index.html`, `netlify/functions/es-image-search.js`, documented in
[project-docs/ai-images-es-storage.md](ai-images-es-storage.md)):

- `mcp.essentiallysports.com/mcp` is ES's internal MCP server, OAuth (PKCE) authenticated, exposing a
  `search_images` tool (`type="agency"` — the non-watermarked internal media bucket).
- The Netlify/Vercel function calls MCP directly (JSON-RPC over HTTP) with a stored access/refresh
  token — there's no LLM in that loop today, it's a direct tool call, not an agent.
- There's a public WordPress-media fallback when MCP isn't configured/reachable, and the frontend shows
  which path served the result (`ES Storage` vs `ES media fallback`).

For Reels, "AI" needs to do more than fetch an image — it needs to interpret a free-text prompt
("Lakers purple and gold", "move the lower third to the top-left") and turn that into concrete style
changes. That's a genuine LLM reasoning step, not a lookup, so the architecture should be:

```
Prompt box → Netlify/Vercel function → Claude (Messages API, tool use)
                                          ├── existing tool: search_images (via ES MCP) — team logos/photos
                                          ├── existing data: BRAND_KIT (index.html) — team color palette lookup, no new tool needed
                                          └── new tool: apply_style(target, patch) — returns a style diff
                                        → frontend applies the returned style patch to the caption/lower-third layer
```

Claude is the reasoning layer; MCP (existing `search_images`, plus whatever ES's MCP server exposes
that we haven't used yet) supplies ES-internal data Claude can't know on its own. This mirrors the
image-search function's existing structure (private-path-with-public-fallback), so it's consistent with
how the rest of the site already handles AI features rather than a bespoke new pattern.

## 4. Team colors already exist — reuse `BRAND_KIT`, don't rebuild it

Correction to the first draft of this plan: I initially flagged team colors as a gap. They're not —
`index.html` already embeds a `BRAND_KIT` array (~line 7855) with **163 teams across 8
sports/leagues** (CBB Men: 12, CBB Women: 25, CFB: 14, MLB: 30, NBA: 30, NFL: 31, WNBA: 13, WNBA
Unrivaled: 8), each with a `primary` color set (`background`/`foreground`/`mist`) plus a 4-way
`palette` of background/foreground swap combinations. This already powers the "Brand & Colors" panel's
Sport/Team dropdowns and the "Pill & Text" swatches (`#sport-select`, `#team-select`, plus helpers
`getSportsList()`, `getTeamsForSport(sport)`, `findBrandKit(sport, team)` around `index.html:8336`).

For Reels, this means:
- **No new team-color dataset to build.** The caption-maker's "color by team" feature is a direct
  consumer of `findBrandKit(sport, team).primary` — same lookup the existing Brand & Colors panel
  already does.
- **Reuse the same Sport → Team dropdown UI pattern** for consistency, rather than inventing a new
  team picker for Reels.
- Claude's tool-use loop (§3) doesn't need a `get_team_colors` tool calling out to MCP — it can just be
  handed the relevant `BRAND_KIT` entry directly (or a tool that reads this same static array), since
  it's already bundled client-side, not a private ES-internal lookup.
- Coverage gap to flag: no golf or NASCAR entries in `BRAND_KIT` today (it's team-sports only), which
  matters since two of the newsletters we just added to the ticker are Essentially Golf and Lucky Dog on
  Track (NASCAR). Worth deciding whether those need color entries added before Reels ships, or whether
  those verticals fall back to a generic style with no team-color option.

## 5. The harder technical question: this site has never done video

Every existing workspace (`index.html`'s canvas-based editors, confirmed at `index.html:13376`) renders
to a plain `<canvas>` 2D context and exports a still image. There is no video decode, timeline, or
encode pipeline anywhere in this codebase today. Two of the three core Reels needs — "drop in a clip"
and "auto-transcribe it" — are net-new capabilities, not extensions of existing code:

- **Transcription**: needs either a server-side call to a speech-to-text API (e.g. Whisper via an
  Anthropic/OpenAI-adjacent provider, or an ES-internal equivalent if one exists) or a client-side
  model. Given everything else AI-shaped in this repo goes through a Netlify function, a
  `netlify/functions/es-transcribe.js` calling out to a hosted Whisper-class API is the consistent
  choice — not something to run in-browser.
- **Timeline + caption sync + lower-third overlay compositing**: needs an actual video editing surface
  (play/pause, scrub, layer stack), which is a different UI paradigm than the current single-canvas
  editors. Two build paths:
  1. **Client-side, canvas + `<video>` + MediaRecorder** — draw the video frame plus caption/lower-third
     layers onto a canvas each frame, record the canvas stream out. Keeps everything in-browser and
     consistent with the site's current "no backend rendering" pattern, but MediaRecorder's format
     support and performance on longer clips is a real risk to validate early.
  2. **Server-side render job** (e.g. an ffmpeg-based render function/queue) — more reliable output
     quality and format control, but is a genuinely new piece of infrastructure (a job queue, storage
     for uploaded/rendered video) that nothing else in this repo has, and Netlify functions have
     execution-time limits that make long-clip rendering there risky.
  Given the scale of everything else in this repo (client-heavy, Netlify functions only for
  auth/search/small API calls), **recommend starting with path 1 for an MVP** and only reaching for a
  render service if MediaRecorder proves insufficient for real clip lengths/quality.

## 6. Proposed MVP scope (cut for a first working version)

To avoid scope creep into "build a video editor," the MVP should deliberately not try to do everything
competitors do:

- Single clip upload (no multi-clip timeline/trimming in v1 — assume the user brings an already-cut
  clip, matching how Submagic positions itself vs. Opus Clip's long-form-to-clips extraction).
- Auto-transcribe → editable caption list → one of a small set of preset caption styles, each
  recolorable by team (start with a handful of styles, not 100+ presets like VEED).
- A small fixed library of lower-third templates (5–10 to start, matching the newsletter-strip logo set
  we just shipped as a natural first content source) — click to place, drag to reposition.
- The prompt box edits **existing placed elements** (recolor, reposition, restyle) rather than
  generating novel graphics from scratch — much lower risk than true prompt-to-image generation, and
  matches "you can just prompt and it will change the thing" as described.
- Export: burn captions/lower-thirds into the video and download — no publishing/scheduling in v1.

## 7. Open questions for Suhail before scoping build work

1. `BRAND_KIT` has no golf or NASCAR entries (team-sports only) — do those verticals need color entries
   added, or is a generic non-team style fine for them in v1?
2. Is there an existing transcription provider ES already has a relationship/API key with, or is this
   an open choice?
3. Client-side (MediaRecorder) vs. server-side (render job) — given this repo has zero video
   infrastructure today, which one are you more willing to invest in building out?
4. Should Reels reuse `BRAND_KIT` as-is (163 teams, 8 leagues) for v1, or scope down to the sports the
   newsletter ticker already covers (NFL, CFB, NBA, Golf, NASCAR) to keep the caption-style testing
   surface smaller at launch?
5. Where does this live in the nav — a 4th `frame-card` next to Social Media/YouTube/Newsletter, or its
   own top-level page like `how-it-works.html`?

## Sources

- [Text to Video AI with Auto-Captions: 2026's Top Tools](https://resource.digen.ai/text-to-video-ai-auto-captions-2026-3/)
- [Top 7 AI Captioning Tools for Better Video Engagement in 2026](https://www.intelligenthq.com/top-7-ai-captioning-tools-for-better-video-engagement-in-2026/)
- [Kapwing AI Caption Generator](https://www.kapwing.com/subtitles/caption-generator)
- [VEED AI Caption Generator](https://www.veed.io/tools/auto-subtitle-generator-online/video-caption-generator)
- [Choppity Free Video Caption Generator](https://www.choppity.com/tools/free-video-caption-generator/)
- [Captions.ai Overview](https://captions.ai/overview)
- [Ultimate Auto Caption Tool Comparison: CapCut vs Premiere Pro vs Submagic vs OpusClip](https://www.toolify.ai/ai-news/ultimate-auto-caption-tool-comparison-capcut-vs-premiere-pro-vs-submagic-vs-opusclip-110161)
- [Submagic: CapCut vs Opus Clip compared](https://www.submagic.co/vs/capcut-vs-opus-pro)
- [Submagic vs Opus Clip 2026](https://viral.day/en/blog/submagic-vs-opus-clip-which-ai-video-editor-is-better-in-2026)
- [10 Best Lower-Thirds Generators & Template Packs (2026) — OpusClip](https://www.opus.pro/blog/best-lower-thirds-generators-template-packs)
- [VEED Lower Third Maker](https://www.veed.io/create/text-video-maker/lower-third-maker)
- [Simplified Lower Third Maker](https://simplified.com/video-maker/lower-third)
- [FlexClip Lower Third Generator](https://www.flexclip.com/learn/add-lower-third-to-video.html)
- [Video Effect Vibe — AI Video Overlay Generator](https://videoeffectvibe.com/)
- [Video Effect Vibe: AI video overlay maker blog](https://videoeffectvibe.com/blog/ai-video-overlay-maker)
