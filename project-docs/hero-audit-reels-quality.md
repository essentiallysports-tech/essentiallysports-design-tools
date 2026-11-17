# Hero audit: Reels Studio output (feature/reels-quality, 2026-11-18)

Scope: what the reel looks like and which clips it uses (`reel-render.js`, `reel-styles.js`,
`reel-formats.js`, `reel-lint.js`, the clip picker, the server). The page UI belongs to
`feature/reels-ui`. Method: rendered all four styles with the same plans and assets before and
after (offline harness over `ReelRender.drawFrame`, frame sheets and MP4s in the scratchpad
`hero/reels-quality/`), compared with the two published ES reels, and ran the real page with a
sign-in shim and stubbed APIs.

## Findings, by impact

1. **The logo was wrong.** Classic drew a 76x65 mark top-left; the other styles drew a 64x64
   blue box with "ES" typeset in Acumin (not the mark); end cards drew a 168x143 scaled mark and
   "ESSENTIALLYSPORTS" in Roboto Condensed instead of the wordmark. The video guide (VB-02, SM-02,
   BL-05/06) says: the ES mark, fixed size, top-right, 50 px clear space, never re-typeset. No
   check caught any of it.
2. **Clip choice was naive.** One clip pool per reel; each beat took the first unused clip whose
   post text shared a word with the beat. No look at what is on screen, recency, quality or
   source within the pool; every clip played from 0.4 s, whatever the beat needed.
3. **Motion was flat.** Beats faded out and the next faded in (an empty moment between beats),
   words rose 32 px with the same curve as panels, bar and card values did not count, the dot
   ranking ring grew from the centre with no leader to its callout.
4. **No finish.** No grain, vignette or light; frames looked like flat vector slides next to the
   published reels.
5. **Contrast and colour.** White team names on light team tiles (Steelers gold); the reel's own
   team never coloured the data that names it; the stat beat drew a made-up two-colour "logo"
   disc when no team logo loaded.
6. **Captions near the app UI.** Caption lines could run to x 996, under the like / share rail.
7. **Frame 0.** The hook's later words were still below their mask on frame 0 (the cover).
8. **Clip audio.** (Owner, 2026-11-18) Clip sound must be off by default, opt-in only; music
   should read the shared audio library.

## What changed (before -> after)

| Area | Before | After |
| --- | --- | --- |
| ES mark | text "ES" in a box / top-left 76x65 / scaled 168x143 | official vector mark (paths from `assets/brand-logos/essentiallysports-mark.svg`), 122x104, top-right of the safe zone, every frame, drawn last, black on ES-blue backgrounds |
| End card | typeset "ESSENTIALLYSPORTS" | official wordmark 417 px (Essentially Golf on golf reels) |
| Logo check | none | lint `logo` (critical): missing, scaled, moved, crowded clear space, non-official file |
| Clips | first unused clip with a shared word | per-beat ranking (subject, recency, quality, source), vision judge on sampled frames (Gemini 3.8 Flash, Haiku fallback), best segment per beat, no reuse while a fitting clip is free |
| Transitions | fade out, fade in | push (Explainer), wipe with ink bar (Series), lift and flip (Countdown), cross-fade + light leak (Classic) |
| Type | rise 32 px | headline words rise out of a mask (out-expo), highlight sweeps in after the word lands, tracked labels, tighter leading |
| Data | static values | bar and versus values count up, dot ring sweeps with a leader line, team colour on the reel's own team |
| Finish | none | vignette, film grain, light leaks on dark looks at beat changes only (max 16%), soft shade under pictures |
| Captions | up to 912 px wide | 820 px measure clear of the right rail, karaoke pop on the spoken word |
| Clip audio | never mixed | muted by default; "Original clip audio" adds it at -12 dB, -26 dB under the voice |
| Music | `reels-music.json` | `audio-library.json` first, then `reels-music.json`; licence object or text; rights checks unchanged |

## Cost

- Clip judge: about $0.004 per 3 clips, about $0.01 per reel (8 clips x 3 frames at 320 px),
  hard cap $0.10 per reel, cached per clip URL (7 days in the browser, 6 h on the server),
  logged as `reels-clip-judge`, behind `aiSpendGate` and the hourly limit. Shown in the cost
  estimate. No AI: the free heuristic ranks the clips.
- Everything else in this branch is free (drawn in the browser).

## Left for later

- Real-footage sheets: the harness uses synthetic clips and photos (no league footage
  downloaded); check the vision judge on real X clips after deploy.
- The ES mark sits at the top-right of the platform safe zone (y 288), not 50 px from the frame
  edge: the top 270 px are under the Reels / TikTok / Shorts UI. This matches the published ES
  reels; confirm with the design team.
