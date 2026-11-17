# Generate · Creative: audit (2026-11-19, branch feature/gen-creative)

Owner feedback after the hero round: "This is not what I want. I want it to make new things, get more creative, not just put an image with text on it." Brief tried: "LPGA Tour season ends with $2 million prize and PGA Tour season ends with 100 players earning cards. Sport: Golf" (Hype, Die-hard, Directions first).

## What the live Generate did (ranked by impact)
1. **No visual idea.** Every design was the Cover template; only the pill text changed. The director could only pick a template, words, team and photo (`es-guidelines.js` directorLines: "no free-form layouts").
2. **Same photo on all four.** `generate()` picks one photo for the main person and reuses it on every photo template; a brief with no named person used the top ES story image (the PGA TOUR sign) four times.
3. **One story, not two.** `readBrief` has no idea of stories: "LPGA ... and PGA ..." is one brief, so LPGA got nothing of its own.
4. **No number treatment.** "$2 million" and "100" are not game stats, so `mapSlides` / the director route them to a Cover hook: the number becomes a pill word.
5. **Off-brief headline.** "LIV Golf is dead. Now what?" came from ES research (the writer may use research facts). ES coverage does support it (17 Nov: "LIV Golf's collapse into Chapter 11 liquidation"), and the card cited it, but it is not the brief's story.
6. **Generic director note.** `directorNote` falls back to `STRONG_BY_TYPE` lines ("A clear hook on a real story") when the reviewer gives nothing specific.
7. **Cost waste.** The art-director review scores text only; it never sees the design, so it cannot catch a bad composition.

## What Creative changes
- Composed designs from 14 archetypes (frameup-compose.js), checked by an ES gate in code.
- Stories split in code; directions spread across them; different archetype, focal element and photo per design.
- Numbers only by fact id; headline digits must be facts; off-brief names need a cited ES story (the LIV angle is dropped unless cited).
- Vision art director sees 2-3 renders per idea, picks one, applies one whitelisted fix, writes a specific note.

## Still open
- Lightweight layer editor (move / resize) and "Open in editor" for composed designs: next phase (see the edit log).
- Real cut-outs and AI concept art need the gen-assets service (feature/gen-assets) and its keys.
