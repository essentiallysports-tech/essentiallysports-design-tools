# Editor basics (Nov 2026)

Safety nets and conveniences added to the editor (Social Media, YouTube,
Newsletter). Each lives in its own file and calls the editor's existing
functions, so templates, rendering and exports are unchanged (checked pixel by
pixel against the previous version: 32 designs identical).

| What | File | Notes |
|---|---|---|
| Autosave + restore | `frameup-autosave.js` | IndexedDB `frameup-editor` (`records` / `images`) |
| Recent designs + reopen from Gallery | `frameup-designs.js` | clock button next to Undo / Redo |
| Template picker with previews | `frameup-templates.js` | "Browse" next to Post Type / Newsletter Asset |
| Shortcuts + export options | `frameup-extras.js` | `?` lists shortcuts; options button next to Export |
| What's new + "New" tags | `app-shell.js` (`WHATS_NEW`) | sidebar, Help |
| Check before export | `index.html` (`getExportIssues`, `confirmExportIssues`) | Export and Copy link |
| Spell check | `index.html` (`spellcheck` on fields) | words on; numbers, codes, links off |

## Autosave
- Saves every design state (5 Social slides, 3 YouTube variations, Newsletter
  incl. infographic edits, Reels) and the HTML widget forms, 0.9 s after a
  change (`render()` / `renderWidgetPreview()` call `FrameUpAutosave.schedule()`),
  and when the tab is hidden or closed. Uploaded photos are stored as files once
  each; web photos stay links.
- Restores on load through the same steps as Undo, then shows "Restored your
  work from …" with **Start fresh** (only when there is real content, not after
  just browsing templates). Undo starts clean after a restore.
- A save that can't be restored is dropped and the page reloads once into a
  clean editor. Saves older than 30 days are ignored. Off inside Generate's
  hidden preview frame.
- Two tabs open at once: the last one to save wins.

## Recent designs and Gallery reopen
- At export (the moment Export is pressed) the design on screen is captured:
  - on this device with photos, key `design:task-design-<export id>`, last 30;
  - in the export record as `metadata.design` (text, settings, web photo links,
    about 8 KB, no uploaded files). Never written to the browser's local
    task/design caches (5 MB localStorage).
- Opening goes onto an empty Social slide if the current one has content; one
  Undo goes back. A shared design says which uploaded photos to add again.
- Gallery: "Open in editor" uses the device copy if there is one, otherwise the
  shared copy via `get_frameup_gallery_design`.
- **Gallery stays Social Media only for now** (Suhail, 2026-11-11). Team-wide
  reopen and YouTube / Newsletter in the Gallery would need a read-only database
  function (`get_frameup_gallery_design`) and a wider `list_frameup_gallery`;
  the draft SQL is kept outside the repo. Until then "Open in editor" works for
  posts exported on the same browser, and `fetchGalleryDesign` returns nothing.

## Template picker
- Previews: `assets/template-thumbs/<workspace>-<value>.webp` (made from each
  template with the sample photos, 360 px wide). A template without one shows
  its name. HTML widgets show a live mini copy instead.
- New template: add its preview image (render it with sample content and save
  as webp), or it shows its name until you do. Social groups are listed in
  `PICKERS` in `frameup-templates.js`; Newsletter uses the dropdown's groups.

## What's new
- Add an entry at the top of `WHATS_NEW` in `app-shell.js` (new `id`, date,
  short items). `templates: [[workspace, value]]` puts a "New" tag on those
  templates for 30 days. Bump `app-shell.js?v=` on every page.

## Export options
- `frameup.exportOptions.v1` in localStorage: PNG instead of JPG, double size.
  Off by default. Only JPG → PNG is offered, so transparent headers never turn
  black. Applied in `renderExportImage()` via `applyExportOptions()`.

## Round 2 (Nov 2026)
- **Icons**: one family everywhere (outlined, rounded ends, stroke 1.8, 24 grid).
  New icons should use `stroke-width="1.8"`.
- **Right panel sizes**: `editor-polish.css` (desktop only, loaded last):
  44px text boxes / dropdowns / main buttons, 36px small buttons, 40px chips.
- **Tabs Content · Photos · Style** (desktop): each folding section has
  `data-studio-tab` (`STUDIO_SECTION_TABS` in index.html: layout + brand →
  style, images → image, everything else → content). Photos also shows the
  canvas photo tools and the ES Image Pool search (the old "ES Image Pool" tab;
  `setStudioInspectorMode('ai')` lands on Photos). A tab with nothing in it
  hides; with one tab left the bar hides. Templates that hide the tab bar
  (HTML widgets, infographics without a main photo) always show their form.
  Phones keep their own Content / Media / Format / Brand / More sheets.
- **⌘K**: pages add groups with `FrameUpShell.addPaletteSource(q => [{ label,
  items: [{ label, hint, keywords, icon, run | href }] }])`. The editor adds
  Actions (frameup-extras.js), Templates (frameup-templates.js) and Recent
  designs (frameup-designs.js); groups with the same label merge.
- **Home "Jump back in"**: `#home-recent`, filled by frameup-designs.js.
- **Phone menu**: built from `NAV` in app-shell.js (`buildMobileNav`); the old
  `.navbar` links stay in the HTML but are hidden on phones.
- **Template names**: Section Header (Left / Centred), Video FI (Play Button),
  Tag FI (Corner Label), Trivia, Headline List (Big Numbers / Simple). The
  Dashboard records names with each export, so older exports keep the old names.
- Kept on purpose (not dead): the embedded Design Request form in index.html
  (still wired to scripts), `.photo-drop` (foreground photo boxes),
  `.post-type-options` (ticker Up/Down).
