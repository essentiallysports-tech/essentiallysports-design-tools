# Hero audit: the main editor (index.html)

Branch `feature/hero-editor`, 2026-11-18. Walked through as an ES designer on game day: Social Media Cover,
stats and quote templates, the template picker, export, autosave and cloud drafts, shortcuts, at 1440, 1280,
1024 and 375, light and dark. Signed in with a fake Supabase session in localStorage; `/api/*` and Supabase stubbed.

## Findings, ranked by user impact

| # | Finding | Impact | Status |
|---|---------|--------|--------|
| 1 | **Cover pills ran off the canvas.** When staggered lines were wider than the safe area together (long lines plus their random offsets), the group was pinned left and the last pill was cut off at the right edge (measured: right edge 1152 px on a 1080 canvas). It exported that way. | High: broken posts | Fixed (drawPills clamps each pill inside the 50 px safe area, only in the overflow case) |
| 2 | **Save state was invisible.** Autosave and the new cloud drafts only showed status inside the Recent designs dialog. A failed local save (`lastSaveFailed`) was logged to the console and never shown. Ctrl/⌘+S opened the browser's "Save page". | High: trust | Fixed (save chip, failure toast, Ctrl/⌘+S) |
| 3 | **No guideline guardrails in the editor.** Generate checks ES rules; the editor didn't. Hashtags, links, emojis and hype words export silently. A Cover line can shrink to ~40 px and still export. If Acumin fails to load, the canvas silently falls back (`Font fallback active` in a status line nobody sees). | High: off-brand output | Fixed (Brand check in "Before you export") |
| 4 | **Template picker: you need to know the template names.** Search matched names only; nothing says what each template is for; no recent; no keyboard grid; nothing connects the story to the template. | Medium: speed | Fixed (best-for lines, keyword search, Best for this story, Recent, arrow keys, T) |
| 5 | Search matched substrings ("to" matched "pho**to**"). | Low | Fixed (word-prefix matching) |
| 6 | Head-to-Head Stats shows player names only; no team logos. Adding logos changes the ES template's design. | Medium | Owner input |
| 7 | Size packs re-lay out Cover only; every other template is "Fitted" on a blurred backdrop. Re-layout per template needs each template checked at five sizes. | Medium | Not done (next) |
| 8 | YouTube has no Browse picker (three chip options, so a picker adds little). | Low | Left as is |
| 9 | In a hidden/background tab the picker's initial focus is set in requestAnimationFrame, so it doesn't land until the tab is visible. | Low | Left as is |

## Speed (measured, not guessed)
Headless Chrome, warm cache, 5 runs, median, `/api` stubbed (scratchpad `hero/editor/perf.mjs`):

| | DCL | FCP | Longest task | TBT | Heap |
|---|---|---|---|---|---|
| Before | 64 ms | 124 ms | 0 | 0 | 10 MB |
| Before, 4× CPU throttle | 255 ms | 404 ms | 104 ms | 64 ms | 10 MB |
| After, 4× CPU throttle | 229 ms | 404 ms | 99 ms | 54 ms | 10 MB |

The 1 MB page is 212 KB gzipped and parses in one ~100 ms task even at 4× throttle. Lazy-initialising panels inside
the inline script would be a risky refactor for ~50 ms, so it was not done. The 2.3 s first paint seen in the preview
pane came from the hidden pane and the login redirect, not the editor. New files add 19 KB gzipped
(assist 8.4 KB, es-guidelines 7.0 KB, rules 2.2 KB, CSS 1.4 KB).

## Export quality
JPEG at 0.94, `imageSmoothingQuality = 'high'`, 1× / 2× and PNG options in Export settings: sensible. No change.
Exports are byte-identical except the deliberate pill fix (finding 1), which only changes designs whose pills
used to run off the canvas.

## Cost
No AI calls in the editor paths touched; nothing to cut.
