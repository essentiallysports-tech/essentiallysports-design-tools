# Inspector (right panel) research

For: the engineer redesigning FrameUp's right-hand template properties panel (text fields, selects, swatches, sliders, toggles, photo upload, export).
Date: 2026-11-18. Method: web research on official docs and help centres, plus framework source docs where design-system pages render only in JavaScript.

Marking convention: numbers with no tag are documented in the cited source. "(observed)" means measured or seen in shipping products and not documented. "(inferred)" means a recommendation drawn from the sources, not stated by them.

Source caveats: Figma, Apple and Material 3 pages are partly JavaScript-rendered. Where the canonical page could not be read, the Material numbers come from Google's own Android component docs, which implement the M3 tokens. No official Framer, Kittl or Notion documentation describes panel metrics, so those entries are observational. Photoshop Quick Actions are documented mainly by a third-party tutorial.

---

## 1. Structure

**Selection drives the panel.** Every tool studied rebuilds the inspector from the current selection:
- Sketch's Inspector shows settings for the selected layers or the active tool, and hides or shows controls by context. Its fixed section order is Prototyping, Alignment, Layer, Layout, Style (opacity, fills, borders, shadows), Selection colors, Export. https://www.sketch.com/docs/designing/the-interface/the-inspector/
- Figma's Design tab edits the selected objects. With nothing selected it still shows the file's local styles and variables, the canvas background colour, and whole-page export. https://help.figma.com/hc/en-us/articles/360039832014
- Apple's macOS guidance says an inspector shows the current selection and updates when the selection changes. A static info view that does not track selection should be a normal window, not a panel. https://developer.apple.com/design/human-interface-guidelines/panels
- Photoshop's Properties panel changes its contents by layer type. Quick Actions (Remove Background, Select Subject, crop, trim) appear for pixel layers, and convert-to-frame or convert-to-shape actions appear for type layers. https://www.photoshopessentials.com/?p=30393 (third-party tutorial)
- Kittl's help routes per-element settings (text spacing, shadows, texture settings, alignment) to the right panel after selection. https://help.kittl.com/editing-and-design/text-settings-editing

**Make section order predictable.** Sketch and Figma both use a fixed top-to-bottom order of position or alignment, then layout, then appearance, then export. Figma's UI3 regrouped properties "to match more modern workflows". https://www.figma.com/blog/our-approach-to-designing-ui3/ The forum backlash about moving W/H away from X/Y shows that reordering is expensive once users have learned an order. https://forum.figma.com/share-your-feedback-26/ui3-feedback-3058/index8.html

**Collapsible groups.** Webflow's Style panel lets you expand or collapse each section, expand or collapse all of them (Alt/Option+S), or use a Focus mode that keeps only one section open (Alt/Option+Shift+S). https://help.webflow.com/hc/en-us/articles/33961362040723 Webstudio puts a dot on a section header when any property inside it has a value set, so a collapsed section still shows that it has been changed. https://docs.webstudio.is/university/foundations/style-panel Persisting collapse state per section, per user, is standard practice (inferred). Webflow users ask for default expand or collapse states on component property groups. https://wishlist.webflow.com/

**Set-value indicators.** Webflow colour-codes labels: blue means set on this element, orange means inherited, and clicking a blue indicator resets the value. https://help.webflow.com/hc/en-us/articles/33961362040723 For FrameUp, the equivalent is "changed from template default" plus a per-field reset (inferred).

**Contextual toolbar versus panel.** Canva opens photo editing by selecting an image and choosing Edit in the toolbar above the design, and the toolbar's options change with the selected element. https://www.canva.com/help/image-editor/ Adobe Express shows a toolbar on text selection (duplicate, copy style, delete) and keeps text styling in a side panel. https://helpx.adobe.com/express/web/create-and-customize-text/add-text.html Express users complain that the contextual task bar cannot be moved or hidden. https://community.adobe.com/t5/adobe-express-bugs/please-get-rid-or-relocate-this-menu-bar/idi-p/15569709 Illustrator's equivalent can be moved, pinned, reset or hidden. https://helpx.adobe.com/my_en/illustrator/desktop/get-started/learn-the-basics/contextual-task-bar-overview.html Pattern: put frequent one-click actions in a contextual bar and detailed properties in the panel. Any floating bar must be dismissible.

**Pinned primary actions.** Sketch and Figma put Export as the last section of the inspector. For a template tool where export is the goal, keep export in a footer that is always visible, with the property sections scrolling above it (inferred from Apple's Done/Cancel pairing guidance and common practice; observed in Canva, where Share/Download sits in the top bar).

---

## 2. Controls

- **Two-column rows: label, then control.** Figma made labels central to UI3. A minimal-label approach was dropped for accessibility, and visible labels now match the screen-reader aria-labels. Where a single noun label is ambiguous, a tooltip adds direction (for example "vertical padding"). https://www.figma.com/blog/our-approach-to-designing-ui3/ Recommended label column: 72–96px, left-aligned, with the control filling the rest of the row (observed in Figma, Framer and Webflow). Allow labels to wrap or truncate with a tooltip. Figma users report cropped component-property names, which is one reason the panel was made resizable. https://help.figma.com/hc/articles/23954856027159
- **Inline numeric fields.** Figma, Sketch and Framer accept arithmetic in fields, and Figma applies relative math to mixed selections (for example "Mixed + 24"). https://buttondown.com/joeyabanks/archive/baseline-16-everything-to-know-about-multi/ Drag-to-scrub on the field label or icon, with Shift for a 10x step, is a de facto standard (observed in Figma, Framer and Photoshop). Arrow keys step by 1, and Shift+Arrow steps by 10 (observed).
- **Choose the control by its job.** Apple's panel guidance prefers simple controls, such as sliders and steppers, over text fields or multi-step choices in panels. https://developer.apple.com/design/human-interface-guidelines/panels Figma tried a toggle, an icon button and a menu for Clip content. The dropdown added a click and slowed people down, so Figma went back to a checkbox. https://www.figma.com/blog/our-approach-to-designing-ui3/ Rule: use a checkbox or toggle for booleans, segmented controls for 2–5 options, and a select for 6 or more (segment threshold inferred).
- **Sliders always paired with a value field.** Material's slider uses a 16dp track, a 4x44dp thumb and a 48dp minimum touch target. Its value label floats by default, and step size snaps to stops. If a separate text view shows the value, link the two for screen readers with `labelFor`. https://github.com/material-components/material-components-android/blob/master/docs/components/Slider.md In a dense desktop panel, use a slider plus a 40–56px numeric input on the same row (observed in Figma, Kittl and Canva effects).
- **Swatches.** Sketch's Selection colors section lists the colours in a selection, grouped by type and sorted by frequency. Hovering a colour highlights the layers that use it, and clicking it updates all of them. https://www.sketch.com/docs/designing/the-interface/the-inspector/ For brand templates, show the brand palette first, then recent colours, then a custom picker (inferred). Use 20–24px swatch chips on desktop (observed) and 44pt or 48dp hit areas on touch (Apple/Material minimums).

---

## 3. Density and type

- **Grid.** Material's density scale steps component height by 4dp per level (0, -1, -2, -3), and denser components should get larger margins. https://material.io/design/layout/applying-density.html A 4px base with 8px rhythm suits a desktop inspector (inferred).
- **Control height.** Use 24px inputs inside 32px rows in pro tools (observed in Figma UI3), and 32–36px for a less expert audience (inferred). FrameUp users are editors rather than designers, so 32px controls and 36–40px rows are a reasonable midpoint (inferred).
- **Type.** Use 11–12px for field labels and values and 11px semibold for section headers in Figma UI3 (observed). Linear moved to Inter and Inter Display, and worked to align labels, icons and buttons on a small surface, but publishes no sizes. https://linear.app/now/how-we-redesigned-the-linear-ui Recommendation: 12px labels, 12–13px values and 12–13px semibold section titles, never below 11px (inferred).
- **Section spacing.** Use 12–16px horizontal padding, 8px between rows, 12–16px between sections, and a 1px divider or a header with no divider (observed in Figma, Sketch and Webflow).
- **Panel width.** Figma's properties panel is resizable, and help notes this helps with long component names. https://help.figma.com/hc/articles/23954856027159 A community report gives a 225–500px resize range for Figma's left panel. https://forum.figma.com/suggest-a-feature-11/launched-horizontal-scroll-the-layers-panel-31277 The right panel's default width is about 240px (observed). A third-party spec derived from Material says side sheets should be no narrower than 320dp; the official Material side-sheet doc gives no width. https://kds.koder.dev/en-US/reference/components-sheets.html Recommendation for FrameUp: default 300px, minimum 260px, maximum 420px (inferred). Text-heavy templates need more width than geometry controls do.
- **Density with hierarchy.** Linear's 2024 redesign aimed to reduce visual noise while increasing hierarchy and density. https://linear.app/changelog/2024-03-20-new-linear-ui Notion settings use a similar list of label/description rows with the control right-aligned (observed).

---

## 4. States

- **Empty or no selection.** Do not show a blank panel. Figma shows document-level settings (canvas background, local styles and variables, page export) when nothing is selected. https://help.figma.com/hc/en-us/articles/360039832014 For FrameUp, show template-level properties (format/size, theme, export) plus a short hint such as "Select a layer to edit it" (inferred).
- **Mixed values.** Show "Mixed" in the field. Typing a value applies it to every selected item, and arithmetic applies relative to each item. https://buttondown.com/joeyabanks/archive/baseline-16-everything-to-know-about-multi/ Checkboxes and toggles use an indeterminate state (WAI-ARIA `aria-checked="mixed"`; observed in Figma and Sketch).
- **Disabled.** Keep the row visible but disabled when the reason is temporary, such as a locked layer, and give a tooltip explaining why. Hide the row only when the property never applies to this selection type, as Photoshop and Sketch do (inferred from their contextual behaviour).
- **Help and tooltips.** Visible labels carry the meaning. Tooltips add precision and must match the accessible name. https://www.figma.com/blog/our-approach-to-designing-ui3/ Webflow's indicators are clickable and explain where a value comes from. https://help.webflow.com/hc/en-us/articles/33961362040723

---

## 5. Interaction

- **Keyboard.** Tab order follows the visual order: section by section, top to bottom, and left to right within a row (inferred, WCAG 2.4.3). Sliders follow the APG pattern: arrows step by one, Page Up/Down make larger jumps, Home/End go to the minimum and maximum, and focus sits on the thumb. Use `aria-valuetext` when the raw number is not meaningful. https://www.w3.org/WAI/ARIA/apg/patterns/slider/ Section headers are disclosure buttons that toggle with Enter or Space and carry `aria-expanded` (APG disclosure pattern). Webflow adds global shortcuts for collapse-all and Focus mode. https://help.webflow.com/hc/en-us/articles/33961362040723
- **Escape and Enter.** In numeric fields, Enter commits and Escape reverts (observed in Figma and Sketch). Commit changes live on input for sliders and swatches, and on blur or Enter for text, and coalesce each change into a single undo step (inferred).
- **Resize and hide.** Figma moved panels from floating back to fixed because floating panels slowed people down and cramped the canvas on small screens, but kept them resizable. https://www.figma.com/blog/our-approach-to-designing-ui3/ Figma can also minimise all of the UI at once to free the canvas. https://help.figma.com/hc/articles/23954856027159 Apple recommends standard show/hide controls and a View-menu command, and says not to hide side panes by default. https://developer.apple.com/design/human-interface-guidelines/sidebars Persist the panel width per user (inferred).
- **Search within properties.** Webstudio offers search with next/previous match in its advanced CSS editor. https://docs.webstudio.is/university/foundations/style-panel Framer exposes properties through its Cmd+K command menu (observed). For FrameUp's longer templates (10 or more fields), a filter box at the top of the panel is worth adding (inferred). Otherwise skip it.

---

## 6. Mobile

- **The panel becomes a bottom sheet.** Apple: detents are large (full) and medium (about half). Include a grabber on any resizable sheet. The grabber cycles detents when tapped and works with VoiceOver. Support swipe to dismiss, and confirm first if there are unsaved changes. Use nonmodal sheets for supplementary controls that affect the view behind them. https://developer.apple.com/design/human-interface-guidelines/sheets
- **Material:** bottom sheet max width 640dp. The drag-handle view needs at least a 48dp touch area, and you should leave 48dp clear at the top for it. Half-expanded ratio defaults to 0.5. The states are collapsed, half-expanded, expanded and hidden. The handle works with TalkBack and Switch Access, where tapping toggles between expanded and collapsed. https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md and https://developer.android.com/reference/kotlin/androidx/compose/material3/BottomSheetDefaults The visible handle pill is 32x4dp (third-party, matches M3 tokens). https://kds.koder.dev/en-US/reference/components-sheets.html
- **Side sheets.** Material's standard side sheet shares the screen and is placed at the `end` edge, while the modal version adds a scrim. Coplanar side sheets are not recommended for narrow screens. https://github.com/material-components/material-components-android/blob/master/docs/components/SideSheet.md
- **For FrameUp mobile.** Use a nonmodal sheet with detents at about 40% (peek, so the canvas stays visible) and about 90% max height, a 32x4px grabber in a 48px hit zone, one section per view or a horizontal tab strip of sections, and export pinned in the sheet footer (percentages inferred). Canva and Adobe Express mobile both show a bottom tool strip that opens sheets per tool (observed).

---

## Top 10 standards to apply

1. Build the panel from the selection, and with nothing selected show template-level settings instead of an empty panel (Figma help, Sketch Inspector, Apple HIG Panels).
2. Keep one fixed section order (content, layout, style, effects, export) across all templates (Sketch Inspector, Figma UI3 blog).
3. Make sections collapsible with remembered state, a collapse-all shortcut and a dot when a collapsed section has non-default values (Webflow Style panel, Webstudio).
4. Give every control a visible text label that matches its aria-label, and use tooltips only to add detail (Figma UI3 blog).
5. Use label/control rows with a 72–96px label column, 32px controls (inferred), 12px labels and nothing below 11px (observed in Figma, Linear).
6. Pair every slider with a numeric input, and support arrow, Page Up/Down and Home/End keys (Material Slider, WAI-ARIA APG).
7. Use a checkbox or toggle for booleans, segmented controls for 2–5 options and a select beyond that, and avoid adding clicks for frequent settings (Figma UI3 blog, Apple HIG Panels).
8. Show "Mixed" for differing multi-select values, apply typed values or arithmetic to all selected items, and add a per-field reset to the template default (Figma multi-edit, Webflow indicators).
9. Keep the panel docked rather than floating, resizable (about 260–420px, inferred) with the width persisted, and hideable, with export pinned in a footer (Figma UI3 blog, Apple HIG Sidebars).
10. On mobile, turn the panel into a nonmodal bottom sheet with medium and large detents, a grabber with a 48dp hit area, a 640dp max width and swipe to dismiss (Apple HIG Sheets, Material BottomSheet).

---

## How FrameUp applies it (feature/inspector, 2026-11-20)

| # | Standard | In FrameUp |
|---|---|---|
| 1 | Selection drives the panel | Done. A strip under Export says "Whole design · <template>" or the selected layer; picking a layer opens its section, scrolls to it and marks it "Selected" (`frameup-inspector.js`, reading `FrameUpEditorUI.selectedLayers()`). Template settings stay visible with no selection. |
| 2 | One fixed section order | Kept (index.html already orders Template → Content → Text placement → Brand & colours → Photo → ES Image Pool on every workspace). Every block now starts with the same icon + caps title. |
| 3 | Collapsible, remembered, collapse-all | Done: remembered per workspace (existing `frameup.studioSections.v2`) plus a Collapse all / Expand all button. The "non-default value" dot is not built (needs per-template defaults). |
| 4 | Visible labels | Kept; scrub labels get a tooltip that only adds detail. |
| 5 | Rows, 12px labels, ~32px controls | 12px/500 labels, 36px controls (FrameUp's own Video Ads size, between the 32px desktop norm and 44px touch), stacked label-above-field for text (the panel is 300–440px, too narrow for a 72–96px label column plus a long headline field); toggles and stat rows are true one-line rows. |
| 6 | Number input + keys | X / Y / Zoom: drag the label to scrub (Shift ×10); the field keeps arrow keys. |
| 7 | Toggle / segmented / select | Layout and stat-count chips are now one grey-track segmented control; toggles are label-left, switch-right with no box. |
| 8 | Mixed / per-field reset | Partly: multi-select shows "N layers selected" and marks each section. No multi-layer property editing exists to show "Mixed". |
| 9 | Docked, resizable, export pinned | Done: drag (or ←/→ on the focused edge) 300–440px, remembered as `frameup.inspector.width`, double-click resets; 370px at 1280+ and 320px below. Export stays pinned at the top (already a FrameUp convention, kept rather than moved to a footer). |
| 10 | Bottom sheet on mobile | The existing sheet (grip, detents, tabs) is kept; fields grow to 44px with 16px text so iOS does not zoom. |
