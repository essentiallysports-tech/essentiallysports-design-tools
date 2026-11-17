# FrameUp Product Design System

The source of truth for FrameUp's website UI. The live values are in the CSS; this document describes them, and `design-system.html` (UI Library, in the profile menu) renders every one of them with the real classes.

| Layer | File | What it owns |
| --- | --- | --- |
| Tokens + buttons + focus | `design-tokens.css` | Colour, type, spacing, radius, elevation, motion tokens; the `@layer es-buttons` button system; the global focus rules; AI gradient tokens |
| Components | `es-ui.css` | Sidebar, search, chips, segmented controls, tabs, fields, menus, cards, stats, badges, tables, tiles, empty states, callouts, palette, Stars ticker, AI usage card |
| Motion | `es-motion.css` + `es-motion.js` (`window.FrameUpMotion`) | Live dot, pulse glyph, refresh spin, steps, check draw, skeleton shimmer, stagger, number tick, sliding tab ink, NEW shine |
| AI family | `ai-studio.css` | `.ais-*`: badge, tag, card ring, prompt surface, gradient text |
| Video Ads | `video-ads.css` | Step rail, Ask AI button and panel, grammar rows, writing checks, swatches, team logo chips, Meta preview |
| Logos | `league-logos.js` (`window.LeagueLogos`), `video-ads-teams.js` (`window.VideoAdsTeams`) | League tiles, team logos and colours |

Exported artwork (posts, thumbnails, newsletter assets, reels, video ads) is not styled by any of this.

## Colour

One brand colour (ES Blue), a black and slate scale for dark mode, light neutrals, and status colours. **No purple in UI chrome** (team colours inside content data are the only exception).

**ES Blue** (`--es-blue-*`): 100 `#E8F2FF` · 200 `#CEE5FE` · 300 `#9DCBFD` · 400 `#54A4FB` · 500 `#0A7DFA` (logo blue) · 600 `#0A6FDE` · 700 `#085EBC`. Cyan accent `--ais-cyan` `#00B3E6` (AI only).

**Black and slate**: `--es-black` `#101114` · `--es-slate-800` `#1F2126` · 700 `#2A2D34` · 600 `#3B4049` · 500 `#5C6373` · 400 `#707A8C` · 300 `#8490A6` · 200 `#98A6BF` · 100 `#BFC8D9` · `--es-white`.

**Neutral roles** (use the role, never the hex):

| Role | Token | Light | Dark (fully dark pages) |
| --- | --- | --- | --- |
| Page canvas | `--es-canvas` | `#F7F7F8` | `#101114` |
| Surface: cards, fields | `--es-bg` | `#FFFFFF` | `#1F2126` |
| Stage around artwork | `--es-stage` | `#EEF0F3` | `#101114` |
| Sunk: tracks, hover | `--es-sunk` | `#F0F2F5` | `#2A2D34` (raised fields) |
| Sidebar | `--es-sidebar-bg` | `#F2F3F5` | `#101114` |
| Line | `--es-line` | `#DFE2E7` | `#2A2D34` |
| Line 2: field and chip outlines (3:1) | `--es-line-2` | `#8A919E` (3.2:1 on white) | `#707A8C` (3.2:1 on Slate 700) |
| Ink | `--es-ink` | `#0E1014` | `#FFFFFF` |
| Ink 2 | `--es-ink-2` | `#3A3F48` | `#BFC8D9` |
| Ink 3: meta, helper | `--es-ink-3` | `#565C67` | `#98A6BF` |

**Brand roles**: `--es-brand` (Blue 500), `--es-brand-fill` (= Blue 600, filled buttons; press = Blue 700), `--es-brand-text` (`#0A62C7` on light, `#9DCBFD` on dark), `--es-brand-soft` (= Blue 100), `--es-brand-tint`.

**Surface**: `--es-surface` (`#FFFFFF`, Slate 800 in dark) for cards, toasts and the ring around status dots. **Placeholder**: `--es-placeholder` `#6E7581` (4.6:1 on white; `#98A6BF` in dark).

**Status**: `--es-good` `#0E7A3D` / `--es-good-soft`, `--es-warn` `#B45309` / `--es-warn-soft`, `--es-bad` `#C42323` / `--es-bad-soft`. On dark surfaces: `--es-good-on-dark` `#4CC985`, `--es-warn-on-dark` `#FCD34D`, `--es-bad-on-dark` `#FF8A8A` (+ `-soft-on-dark` fills); badges and dashboard pills switch to these. Always colour plus a word or icon. The yellow NEW tag (`.es-badge--new`, `#FDF3C8` / `#8A6100`) is for the sidebar only.

**Contrast**: body text 4.5:1, large text and non-text 3:1, in both themes.
- White on Blue 600 is 4.8:1: the blue that takes a white label. White on Blue 500 is 3.9:1 (large text only).
- Blue 400 is for text on dark only: 7.3:1 on Black, 6.2:1 on Slate 800, but 2.6:1 on white.
- Brand text on white 5.9:1; Ink 3 on white 6.7:1; Slate 200 on Slate 800 6.6:1.

## Typography Principle

Hierarchy must be visible before the words are read. Size, weight and colour work together; bold alone is not hierarchy.

FrameUp UI uses two families (15px base). Acumin is only for artwork (posts, ads, templates), never UI chrome. No other family: no mono, Inter or system stacks; `sans-serif` is only the last fallback.

- **Roboto** (`--es-font-ui` / `--es-font-body`): page titles, body, labels, tabs, chips, buttons, nav.
- **Roboto Condensed** (`--es-font-display`): UPPERCASE section titles, big numbers and the editor's workspace and panel titles.

## Semantic Roles

| Role | Token / class | Size | Weight | Family | Notes |
| --- | --- | ---: | ---: | --- | --- |
| Page title (h1) | `--es-type-page-title-*` / `.es-type-page-title` | 36 (28 phone) | 700 | Roboto | Sentence case, line 1.1, -0.02em |
| Kicker | `--es-type-kicker-*` / `.es-type-kicker` | 15 | 400 | Roboto | Above a title, muted |
| Lede | `--es-type-lede-*` / `.es-type-lede` | 15 | 400 | Roboto | Line 1.55, max 70ch. Use sparingly |
| Section title | `--es-type-section-*` / `.es-type-section` | 24 (22 phone) | 800 | Condensed | UPPERCASE, line 1, 0.005em. Optional `.es-pulse-glyph` |
| Eyebrow / small label | `--es-type-eyebrow-*` / `.es-type-eyebrow` | 11 | 600 | Roboto | UPPERCASE, 0.08em, muted |
| Card / item title | `--es-type-card-title-*` / `.es-type-card-title` | 18 | 500 | Roboto | Line 1.3 |
| Body | `--es-type-body-*` / `.es-type-body` | 15 | 400 | Roboto | Line 1.55; a bold lead-in sentence is fine |
| Meta | `--es-type-meta-*` / `.es-meta-list` | 13 | 400 | Roboto | Muted, items joined with " · " |
| Field label / helper | `--es-type-field-label-*`, `--es-type-helper-*` / `.es-field__label`, `.es-field__hint` | 13 / 13 | 600 / 400 | Roboto | Label above the control |
| Tabs | `--es-type-tab-*` / `.es-tabs` `.es-tab` | 15 | 500 | Roboto | Active: primary text + 2px blue underline; count 13 |
| Chips | `--es-type-chip-*` / `.es-chip` | 13 | 500 | Roboto | 10px radius, 1px outline |
| Buttons | `.es-btn` | 14 (13 sm, 15 lg) | 500 | Roboto | See Buttons |
| Sidebar nav / group | `--es-type-nav-*` / `--es-type-nav-group-*` | 14 / 11 | 400 / 600 | Roboto | Compact sidebar sizes |
| Steps | `--es-type-step-*`, `--es-step-circle` / `.es-steps` | 13 | 500 | Roboto | 22px circles; the Video Ads rail uses 24px + 14px labels |
| Big number | `--es-type-number-*` / `.es-stat__value`, dashboard KPI | 36 (32 phone) | 800 | Condensed | Tabular numerals; one style for stats and KPIs |
| Prompt input | `--es-type-prompt-*` | 18 | 400 | Roboto | Big brief box |
| Workspace / panel title (editor) | `--es-type-workspace-title-*`, `--es-type-panel-title-*` | 22 / 18 | 800 | Condensed | Editor and dashboard panels |
| Control value (editor) | `--es-type-control-*` | 15 | 500 | Roboto | Dense editor forms |

## Spacing

A 4px scale: `--es-space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-12` 48. Use the token, not a literal.

Rhythm rules:
- Panel and inspector sections: 20 top and bottom (`--es-section-pad-y`), 16 sides (`--es-section-pad-x`).
- A divider has the same space above and below it, never less than 12.
- Label → control 8. Stacked controls 12. Button row 8. Groups 20–24. Page sections 32–48.
- Cards: 16 / 20 / 24 padding (`--es-card-pad-sm/md/lg`). Fields 40 tall (`--es-field-h`; `.es-input` is 44), 32 small.
- Page gutter 32 (`--es-page-gutter`), 16 on phones (`--es-page-gutter-phone`).

## Radius and elevation

- Radius: 10 chips, buttons, nav items (`--es-radius-chip`) · 12 fields and toasts (`--es-radius-control`) · 16 panels, cards, menus, tables, callouts, empty states (`--es-radius-container`; `--es-radius-card` is an alias) · 999 badges and team chips (`--es-radius-pill`).
- Elevation: hairlines everywhere (`--es-hairline`, restated in dark and in every scope that changes `--es-line`); `--es-shadow-pill` for the selected segment and current nav item; `--es-shadow-soft` on `.es-card`; `--es-shadow-float` only for things that float (menus, toasts, popovers); `--ais-glow` for primary hover and AI surfaces. Dark mode swaps shadows for 1px Slate lines.

## Motion

Tokens: `--es-ease`, `--es-ease-entrance`, `--es-dur` 160, `--es-dur-press` 140, `--es-dur-fill` 200, `--es-dur-step` 300, `--es-dur-progress` 420.

Shared effects (es-motion.css + `window.FrameUpMotion`): `.es-live-dot` (green fresh, `.is-stale` amber, `.is-error` red), `.es-pulse-glyph` (draws once; `FrameUpMotion.glyph()`), `.es-refresh` (icon spins while `aria-busy`; `FrameUpMotion.busy()`), `.es-steps` (ring on the current step), `.es-check` (stroke draws in; `FrameUpMotion.check()`), `.es-skeleton` (blue shimmer), `.es-stagger` (40ms apart, max 8), number tick (`FrameUpMotion.setCount()` / `[data-es-tick]`), sliding `.es-tabs__ink` (automatic on `.es-tabs`), `.es-new-shine[data-es-new-key]` (once per key), press scale .96–.97.

Rules: every effect sits inside `prefers-reduced-motion: no-preference` and is static otherwise; hover motion sits inside `(hover: hover)`; entrances use fill-mode `backwards` so they leave no transform behind.

## Buttons

One source of truth: the `@layer es-buttons` block at the end of `design-tokens.css`. Page CSS sets layout only (display, width, margin, flex). Legacy page classes are mapped onto the same variants.

- **Primary** (`.es-btn--primary`): the single key action on a view. A 1.5px conic rim of ES blues and cyan turning every 5s (`@property --es-rim-angle`). Light: white fill, ink label, a deeper rim. Dark: ES Black `#101114` fill, white label, the bright rim. Hover: brighter rim + `--ais-glow`.
- **One animated primary per view.** Repeats are secondary or `.es-btn--static` (no rim). `.es-btn--still` keeps the look without motion (UI Library specimens only).
- **Secondary** (`.es-btn`): the default for every other action. 1px line, Sunk fill on hover.
- **Tertiary** (`.es-btn--tertiary`, alias `.es-btn--ghost`): transparent, Ink 2; Sunk on hover.
- **Danger** (`.es-btn--danger`): secondary shape, red label and red-tinted line.
- **Sizes**: `.es-btn--sm` 32 · default 40 · `.es-btn--lg` 48. Touch screens grow sm and default to 44. Radius 10, Roboto 500.
- **States**: focus = 2px outline, 2px offset, keyboard only; press = scale .96; disabled = Sunk fill, muted label, no motion; busy (`.is-busy` / `aria-busy`, primary) = the rim keeps turning and `--ais-sheen` sweeps across.
- **Icons**: Lucide, stroke 2, `currentColor`; 16px in small buttons, 18px elsewhere (`--es-icon-sm` / `--es-icon`), 8px from the label. Icon-only buttons (`.es-icon-btn`) need an `aria-label`.
- **Ask AI** (`.va-ask-ai`): its own small button outside the layer; a blue to light-blue trail travels around the outline; tinted fill while `aria-expanded="true"`. One per AI panel.

## Focus and selection

Defined once in `design-tokens.css`:
- Tokens: `--es-focus-color` (`#0A6FDE` light, `#54A4FB` dark), `--es-focus-halo` (3px at 16% light, 22% dark), `--es-focus-outline` (2px solid), `--es-focus-offset` (2px).
- **Fields**: the outline turns ES blue at the same width, plus one halo. No outline ring.
- **Buttons, links, chips, tabs, radios**: keyboard only (`:focus-visible`), one 2px outline with a 2px offset. A mouse click shows nothing.
- Dropdown triggers styled as fields take the field focus, never both.
- **Selected**: segment = white pill on a grey track (Slate 600 in dark); chip = soft blue tint (Blue 100 fill, 1px tint ring, brand text; a gradient tint on AI pages, `.ais-page`); current nav item = white pill with the pill shadow and a blue icon; format cards and swatches = soft blue fill or a 2px ring.

## Forms

- `.es-field` (grid, 8px gap) → `.es-field__label` → `.es-input` / `.es-search` → `.es-field__hint`.
- `.es-input`: white, 1px Line 2 outline, Ink 3 on hover, focus as above, radius 12, 44px tall, 15px text (16px on phones so iOS never zooms). `textarea.es-input` 96px minimum. A native `select.es-input` is fine.
- Placeholders show an example, never the instruction.
- Errors: a red outline (`aria-invalid="true"` on `.es-input` / `.es-select`) plus one sentence (`.es-field__error`) that says how to fix it, linked with `aria-describedby`.
- `.es-select`: a native select with the field outline, radius, focus and a Lucide chevron (`.es-select--sm` 32px).
- Word / character counts (`.va-count`, `.is-over` = warn) sit right of the label. Writing checks (`.va-lint__item`) sit under the field with one fix link; AI auto-fixes (`.va-autofixed`) say what changed.

## Navigation

- **Sidebar** (`.es-sidebar`, built by `app-shell.js` from one nav list): 224px (`--es-sidebar-w`), always open on desktop, a menu on phones. Brand → search launcher (⌘K palette) → categories (`.es-sidebar__section`, 11px `.es-sidebar__label`, a very light 1px line with 12px above and below between categories) → footer.
- AI Studio category: blue → cyan mark, blue icons, a gradient bar on the active item.
- NEW tag: yellow `.es-badge--new` with a one-time shine, **sidebar only** (the phone menu is the sidebar on phones and uses the same markup). The What's new dialog's "New" marks unread changelog entries and stays.
- Current page: `aria-current="page"`, white pill with `--es-shadow-pill` and a blue icon.
- Scroll fade: 24px above the footer, hidden at the end of the list (`.es-sidebar--at-end`).
- AI usage card (`.es-usage[data-state]`): this week's spend against the $20 cap; `ok` blue, `warn` amber from 80%, `over` red at 100%; click for the per-feature breakdown.
- Profile row: initials avatar on a colour picked from the name, name over email, a quiet chevron; the account menu opens upward.
- **Tabs** (`.es-tabs` / `.es-tab`): switch views within a page; counts `.es-tab__count` (`.is-hot` blue); the ink slides.
- **Step rail** (`.va-steps`): 3–5 steps; current filled ink (white in dark), done = blue check and clickable, upcoming outline; phones show "Step N of M" and a bar. `.es-steps` is the compact shared version.
- **Segmented** (`.es-segmented`): 2–4 options that change the same view. More, or different views: tabs.

## Data display

- `.es-card` (head / title / sub / body), `.es-stat` (tile + Condensed number + trend).
- Icon tiles `.es-tile` + `--blue`, `--cyan` (`--purple` is a legacy alias of `--cyan`), `--green`, `--pink`, `--amber`.
- Light islands in dark mode: give a surface that stays light `data-surface="light"` so theme.css does not mute its text.
- KPI cards (dashboard `.dov-kpi`, scoped to the dashboard): eyebrow label, 36px number, delta against the same-length period, sparkline, one meta line; 4 → 2 → 1 columns.
- `.es-table` in `.es-table-wrap`: tabular numbers, row hover, small tertiary actions.
- Badges: `.es-badge` (+ `--brand`, `--good`, `--warn`, `--bad`, `--ink`, `--new`; each has a dark variant), `.ais-badge`, `.ais-tag`. Status = colour + word.
- Meta lines: `.es-meta-list` joins items with " · ".
- Every list has empty (`.es-empty`, says what will appear + first step), loading (`.es-skeleton`, a translucent ink fill so it shows on white and on `.es-empty`) and error (`.es-error-state`: `__icon`, `__title`, `__copy`, one Try again button) states.
- Toasts (`.es-toast`, `.is-error`, `.es-toast-action`): bottom right, about 3s, one optional action.
- `.es-callout` for tips; `.es-menu` floats with `--es-shadow-float`.
- Stars of the week (`.es-ticker`): Home only, medal-ranked, slow scroll, pauses on hover.

## Brand and logos

**Use logos instead of text badges wherever one exists.**
- League tiles: `LeagueLogos.logoFor(sport)` → `{ src, bg, label }`; `.va-league` (20px) or `.is-league` tiles; a flat light tile in both themes; unknown sports get the neutral tile with their own label.
- Team logo chips: `VideoAdsTeams.findTeam()` + `logoFor()` → `.va-team` with `.va-logo` (shared class: `.es-team-logo` / `.es-team-logo--dot` in es-ui.css) (logo on a fixed white circle, 1px line); no logo or a failed load falls back to `.va-logo--dot` (the team's two colours). Never show a broken image.
- Newsletter brand chips: `.va-seg--brand` buttons with a `.va-dot` in the wordmark colour plus the short name.
- ES marks: `brand-logo-blue.svg` on light, `brand-logo-white.svg` on dark and on Blue 600, `assets/brand-logos/*`. Never recolour or stretch.

## AI patterns

- Gradient tokens (global, in `design-tokens.css`): `--ais-gradient` (sweep), `--ais-gradient-fill` (the only one behind white text), `--ais-gradient-stroke` (rings), `--ais-gradient-soft` (tints), `--ais-gradient-text` (dark surfaces) / `--ais-gradient-text-on-light`, `--ais-sheen`, `--ais-glow`, `--ais-glow-strong`. ES blues and cyan only.
- Ask AI panel (`.va-ai`): title + close → quick actions (`.va-ai__act`, 2 columns) → optional context (`.va-ai__context`, folded) → progress (`.va-ai__progress`) → results (`.va-variant` option cards; `.is-applied` = in use) → compose (`.va-compose`).
- Option cards: rings move only on the hovered, focused or selected card. Format cards are a radio group with the real template art; a blue dot marks the ones that fit the brief.
- Detection pills: what the AI found in the brief (who, team with logo, quote, stats); found = soft blue, missing = outline.
- Grammar rows (`.va-gram__item`): field, strike-through → insert, one-line reason, small Fix; fixed rows fade; a clean result is green.

## Layout

- Shell: 224px sidebar + one content column up to 1120px with a 32px gutter (16px phones). Page title 32px from the top.
- Breakpoints: **375** phone (one column, 44px touch targets, 16px field text), **900** the shell switch (fixed sidebar above, phone layout at or below), **1280** laptop (content up to 1120px). No sideways page scroll at any width; wide rows scroll inside themselves.
- Theme: `html[data-theme="dark"]` set by `FrameUpTheme.apply()` (remembered, fires `frameup-theme-change`). Components change colour only, never size or spacing.

## Icons

- Every UI icon comes from Lucide (lucide.dev, ISC licence): 24-unit viewBox, `fill="none"`, `stroke="currentColor"`, stroke width 2, round caps and joins. Copy the paths as they are.
- Two sizes, set in `design-tokens.css`: `--es-icon` (18px) everywhere and `--es-icon-sm` (16px) inside compact controls 32px tall or less. Don't set icon sizes in page CSS.
- Brand marks and artwork are not icons and stay as they are.

## Builder Order

Every inspector follows this order:

1. Workspace title
2. Inspector tab
3. Accordion or panel title
4. Group title when needed
5. Field label
6. Control value
7. Helper or meta text

Adjacent levels must differ in at least two of size, weight and colour.

### Editor inspector (right panel, 2026-11-20)

Rules in the "Inspector redesign" section of `studio-inspector.css`; behaviour in `frameup-inspector.js`. Research: `inspector-research.md`.

- Order: pinned Export bar → selection strip ("Whole design · template" or the selected layer) → Template → Content → Text placement → Brand & colours → Photo → ES Image Pool.
- Block titles: Lucide icon at `--es-icon-sm` + 11px/700 caps eyebrow (0.08em), 44px tall when they fold. The section holding the selected layer gets a blue title and a "Selected" chip.
- Fields: 12px/500 label 6px above, 36px control (`--es-radius-chip`), 14px value, 12px help; 12px between stacked fields, 16px panel gutter, 20px under an open section. Phones: 44px and 16px text.
- Toggles: label left, switch right, no box. 2–7 choices: one segmented control (grey track, white pill). Swatches 40px with a 2px blue ring when chosen.
- Width 370px (1280+) / 320px (below); the left edge resizes 300–440px and is remembered.

## Usage Rules

- One page title or workspace title per screen; page titles in sentence case.
- One animated primary button per view.
- Use panel titles for major regions, not every bordered container; section titles for accordions and meaningful control groups.
- Field labels are compact and quieter than the value they identify; helper text never competes with a label or value.
- Do not use Acumin anywhere in UI chrome; it is for artwork only. No monospace.
- Do not introduce a new font size, colour, radius, shadow or duration when an existing token fits.
- Do not use `font-weight: 800` or `900` as a substitute for picking the right role.
- Letter spacing stays `0` except the page title (-0.02em), section titles (0.005em) and eyebrows (0.08em). Uppercase is for section titles and eyebrows.
- No purple in the UI. Blue 400 and 300 only on dark surfaces.
- Status is never colour alone.
- Logos beat text badges; the yellow NEW tag lives in the sidebar only.
- Focus: use the tokens; never stack an outline and a halo; never remove focus without a replacement.

## Color Roles

- `--es-text-strong`: titles and editable values.
- `--es-text-primary`: section titles and primary body copy.
- `--es-text-secondary`: field labels and supporting UI labels.
- `--es-text-muted`: helper text, descriptions and metadata.
- `--es-text-subtle`: disabled or very low-priority information.

The shared dark theme remaps these semantic colours. Components should not hard-code alternate dark text colours.

## Implementation Rule

New components use the semantic variables and classes above. Existing pages may map their class names to these roles, but page CSS must not redefine the global scale. When a component changes, update `design-system.html` and this document in the same change.
