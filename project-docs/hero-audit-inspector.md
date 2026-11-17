# Hero audit: the editor's right panel (inspector)

Date: 2026-11-18 · Branch `feature/inspector` (from live main `1503d36`) · Agent: inspector
Scope: the right-hand settings panel in `index.html` for Social Media (`#instagram`),
YouTube (`#youtube`) and Newsletter (`#newsletter`). Research: `inspector-research.md`.
Screenshots: scratchpad `hero/inspector/before/` and `after/`.

## What a designer hits on a game day (before), by impact

1. **The panel ignores the selection.** Picking Logo, Text or Background Image in
   Layers (or on the canvas) changed nothing on the right. You had to know Logo
   lives under "Brand & Colors" and scroll for it. Every pro tool rebuilds or at
   least points the inspector at the selection (Figma, Sketch, Photoshop, HIG).
2. **No hierarchy.** Section titles (15px bold "Content", "Brand & Colors") had the
   same weight as field labels ("Post Type", "Text On Design", 13px bold) and as the
   photo block's "Add a background image". Nothing said where one group ends.
3. **Looks like a different product from Generate / Video Ads.** Those pages use
   small caps section titles ("FRAME", "TINT", "STYLE"), grey-track switchers with a
   white pill, 36px controls. The editor used 40–48px boxed toggles, outlined chip
   buttons with heavy black or solid blue selected states (YouTube Layout, stat
   count 1–7), and 54px swatches with a black ring.
4. **Toggles in boxes.** "Quote Mode" sat in a bordered 44px box; "Black swipe
   arrow" did not. Same control, two looks.
5. **Fixed 370px column at every width.** At 1024 the canvas bar collapsed to
   "Cover" and the canvas controls overlapped; no way to make the panel narrower or
   wider.
6. **Photo block had no title** ("Add a background image" read as a heading for the
   whole panel) and the empty state was plain text plus a button.
7. **Dark mode gaps** in the newer controls (strip text, empty-state titles, logo
   slot border) once restyled; the old ones were fine.
8. **Long sections, no shortcut to fold them all**; arrow keys did nothing between
   section titles.
9. **X / Y / Zoom** needed typing; no drag-to-scrub like Figma / Framer.
10. **Phone:** fields under 44px in places and 15px text (iOS zooms on focus below
    16px). The bottom sheet itself (grip, detents, tabs) was already good.

Not problems: Export / Copy link were already pinned at the top; section open state
was already remembered per workspace (`frameup.studioSections.v2`); the phone
bottom sheet already had detents.

## Fixed in this branch (after)

See `ai-edit-log.md` (2026-11-20 entry) and the release note `2026-11-20-inspector`.
Exports byte-identical (20 cases), no state or render change.

## Left for the owner

- Search within properties: skipped. The longest panel has five sections; a filter
  box would cost more than it saves today. Worth it if templates keep growing.
- Per-field "reset to template default" and "Mixed" values for multi-select: the
  editor has no multi-layer property editing, so the strip says "N layers selected"
  and marks each layer's section instead.
- The locked newsletter widgets ("Locked · view only") show disabled fields with no
  sentence saying why or what still works (Copy HTML does).
