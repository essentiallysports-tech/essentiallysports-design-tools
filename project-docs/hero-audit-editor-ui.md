# Hero audit: editor UI (Social Media, YouTube, Newsletter) and the Layers panel

Branch `feature/editor-ui` (on top of `feature/hero-editor`), 2026-11-19. Walked through as an ES designer making
ten posts on game day: Cover, Player Stat Line, Team Record and quotes on Social Media; all three YouTube layouts and
Quote Mode; Video FI, Tag FI, Section Header, Feature Image and the HTML widgets on Newsletter. 1440, 1280, 1024 and
375, light and dark. Signed in with a fake Supabase session in localStorage; `/api/*` and Supabase stubbed.

## Findings, ranked by user impact

| # | Finding | Impact | Status |
|---|---------|--------|--------|
| 1 | **Layers panel was a list of four words.** No type, no content, no thumbnail; nothing selected; clicking a row did nothing; the drop target was a whole tinted row (where does it land?); no keyboard at all; it re-rendered on every canvas render, so focus was lost. | High | Rebuilt (see below) |
| 2 | **YouTube had no layers** although its standard thumbnails draw the same four cover layers (and the swipe button never draws there). | High | Panel on YouTube (not Quote Mode), swipe row left out, collapsed to a rail below 1440 px so the 16:9 canvas keeps its room |
| 3 | **YouTube's timestamp corner was invisible.** Headlines placed bottom-right export under the video length, and nothing said so. Small-size legibility could only be judged by squinting. | High | Safe zones overlay, a red dot on the button, a "Before you export" nudge, and a Small size preview (246 px search, 168 px Up next) |
| 4 | **No "what am I editing" anywhere on the canvas.** The template name and size only live in the inspector dropdown; on phones the header said "FrameUp / Newsletter" whatever the asset. | Medium | Format chip in the top bar (click: change template; YouTube: jumps to Layout) and the phone header kicker |
| 5 | **Newsletter: Copy link vs Copy HTML was unexplained.** "Copy link" didn't say it uploads the image; widgets' Export on phones said "Export" but copied HTML; widget link fields had no labels. | Medium | "Copy image link", a one-line "what you get, where to paste it" under the buttons, phone button says Copy HTML, labels on widget fields |
| 6 | **Carousel slides: switch only.** No way to duplicate a slide to make a variant, move one, or clear one; the 5-slot model hid this. | Medium | ⋯ menu: Duplicate to next empty slide, Move left / right, Clear (undoable) |
| 7 | Instagram profile grid crops 4:5 posts to 3:4; nothing showed what gets cut. | Medium | Safe zones on Social Media shade the cut sides and draw the ES 50 px margin |
| 8 | Zoom "100%" means "fit the stage", but nothing says so and there's no shortcut. | Low | Tooltip "Fit to screen", Shift+1; added to the ? shortcut sheet with the layer keys |
| 9 | Upload / ES Image Pool appear three times on an empty Cover (empty-state card, dock, inspector). | Low | Left: the dock copy is the one people use once a photo is in. Owner call |
| 10 | Inspector density and grouping: sections already collapse (Content open, Text Placement / Brand closed), Export and its options are pinned at the top. Spacing and field styles are consistent after the earlier polish passes. | Low | No change needed |
| 11 | The 5-slot carousel can't grow beyond 5 slides. | Low | Not changed (data model; saved drafts assume 5). Owner input |

## Layers panel: before → after
- **Rows:** type icon (or the photo thumbnail / the pill colours as "Aa"), name, and a second line with what's in
  it (the first headline line, the photo file name, the brand, Off / Empty / Hidden).
- **Rename:** double-click, Enter or F2. Stored in the existing `label` field, so saved designs load unchanged.
- **Selection:** click; Shift-click for a range; ⌘/Ctrl-click to add. Selected layers get a thin outline and name tag
  on the canvas (DOM overlay). Clicking the canvas selects the layer under the pointer (text first). Selecting the
  background also opens its crop handles.
- **Reorder:** drag with a line where it will land; ⌘] / ⌘[ one step, ⌘⇧] / ⌘⇧[ to front / back; Alt+↑/↓ in the
  list. Multi-selections move as a block. Every change goes through the existing undo history.
- **Visibility / lock:** eye and lock on hover/focus/selection, always visible when on; H and L keys; a toggle on a
  selection applies to all of it.
- **Grouping:** the background row expands to show what travels with it (team colour fade; on YouTube the player
  cut-outs, which open their image tool). No new data model.
- **Filter:** shows from 7 layers (word-prefix on name, type, "hidden", "locked"), with a "no match" empty state.
  Cover has 4 layers, so it stays hidden today; the panel is ready for longer lists.
- **Empty states:** rows say "No photo yet", "Empty" or "Off" instead of looking identical to filled layers; a filter with no match offers Clear filter. Templates without cover layers still hide the column (a message there would only take canvas room); the empty-state markup is ready if the owner wants it shown.
- **Placement:** drag the right edge (200–360 px) or ←/→ on the handle; double-click resets. Width and
  collapsed/open are remembered per browser (collapsed per workspace).
- **Keyboard and screen readers:** listbox with multi-select, roving focus, ↑/↓/Home/End, Space, Esc, live
  announcements ("Text moved forward").
- **Phones:** the More sheet lists the layers with ↑ ↓, lock and eye.

## Exports
Byte-identical. 15 cases (5 Social Media incl. a reordered/hidden-layer Cover, 4 YouTube, 4 Newsletter images, 2
Newsletter HTML widgets) hashed before and after with a seeded `Math.random` (the pill stagger is random):
`renderExportImage()` PNG bytes and `buildActiveWidgetHtml()` strings. All equal. Nothing in
`frameup-editor-ui.js` draws on the design canvas (asserted in the test).

## Speed
Headless Chrome, 4× CPU throttle, warm cache, 7 runs, median; both sides served the same way. See the edit log
entry for numbers. The stylesheet loads at the end of the body so it doesn't block first paint.

## Cost
No AI calls added or touched.
