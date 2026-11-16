# FrameUp Product Design System

This document is the source of truth for FrameUp product UI. The live CSS tokens are in `design-tokens.css`.

## Typography Principle

Hierarchy must be visible before the words are read. Size, weight, and color work together; bold text alone is not hierarchy.

FrameUp UI uses two families (2026-11-15 type scale, 15px base). Acumin is only for artwork (posts, ads, templates), never UI chrome. No other family: no mono, Inter or system stacks; `sans-serif` is only the last fallback.

- **Roboto** (`--es-font-ui` / `--es-font-body`): page titles, body, labels, tabs, chips, buttons, nav.
- **Roboto Condensed** (`--es-font-display`): UPPERCASE section titles, big numbers and the editor's workspace/panel titles.

## Semantic Roles

| Role | Token / class | Size | Weight | Family | Notes |
| --- | --- | ---: | ---: | --- | --- |
| Page title (h1) | `--es-type-page-title-*` / `.es-type-page-title` | 36 (28 phone) | 700 | Roboto | Sentence case, line 1.1, -0.02em. White on dark, ink on light |
| Kicker | `--es-type-kicker-*` / `.es-type-kicker` | 15 | 400 | Roboto | Above a title, muted (Slate 200 dark / ink-2 light) |
| Lede | `--es-type-lede-*` / `.es-type-lede` | 15 | 400 | Roboto | Line 1.55, max 70ch, secondary colour. Use sparingly |
| Section title | `--es-type-section-*` / `.es-type-section` | 24 (22 phone) | 800 | Condensed | UPPERCASE, line 1, 0.005em. Optional `.es-pulse-glyph` |
| Eyebrow / field label | `--es-type-eyebrow-*` / `.es-type-eyebrow` | 11 | 600 | Roboto | UPPERCASE, 0.08em, muted |
| Card / item title | `--es-type-card-title-*` / `.es-type-card-title` | 18 | 500 | Roboto | Line 1.3 |
| Body | `--es-type-body-*` / `.es-type-body` | 15 | 400 | Roboto | Line 1.55; a bold lead-in sentence is fine |
| Meta | `--es-type-meta-*` / `.es-meta-list` | 13 | 400 | Roboto | Muted, items joined with " · " |
| Tabs | `--es-type-tab-*` / `.es-tabs` `.es-tab` | 15 | 500 | Roboto | Active: primary text + 2px ES-blue underline; count 13px |
| Chips | `--es-type-chip-*` / `.es-chip` | 13 | 500 | Roboto | Pill or 10px radius, 1px outline |
| Prompt input | `--es-type-prompt-*` | 18 | 400 | Roboto | Big brief/prompt box |
| Buttons | `--es-type-button-*` / `.es-btn` | 15 | 500 | Roboto | See Buttons |
| Sidebar nav / group | `--es-type-nav-*` / `--es-type-nav-group-*` | 15 / 12 | 400 / 600 | Roboto | Group labels muted |
| Steps | `--es-type-step-*`, `--es-step-circle` / `.es-steps` | 13 | 500 | Roboto | 22px numbered circles, active fills Blue 600 |
| Workspace / panel title (editor) | `--es-type-workspace-title-*`, `--es-type-panel-title-*` | 22 / 18 | 800 | Condensed | Editor and dashboard panels |
| Field label (editor) / helper / control | `--es-type-field-label-*`, `--es-type-helper-*`, `--es-type-control-*` | 13 / 13 / 15 | 600 / 400 / 500 | Roboto | Dense editor forms |

## Buttons

- **Primary** (`.es-btn--primary`, plus the page main actions listed in design-tokens.css): ES Black #15161A fill in both themes, white 15/500 label, a 1.5px conic rim of ES blues + cyan turning every 5s (`@property --es-rim-angle`; without @property the rim is still). Hover: brighter rim + `--ais-glow`. Active: scale(.98). Focus: 2px blue outline, 2px offset (Blue 600 on light, Blue 400 on dark). Disabled: slate fill, no motion. Busy (`.is-busy` / `aria-busy`): `--ais-sheen` sweep. 40px min height (44px touch), 12px radius.
- **One animated primary per view.** Extra primaries use `.es-btn--static` (still rim) or the secondary style.
- **Secondary** (`.es-btn`): transparent, 1px `--es-btn-outline` (3:1 on the page), primary text, Slate 800 / sunk hover.
- **Ghost**: text only. **Danger**: red outline.

## Motion

Shared in `es-motion.css` + `es-motion.js` (`window.FrameUpMotion`), all static with reduced motion: `.es-live-dot`, `.es-pulse-glyph`, `.es-refresh` (spins while `aria-busy`), `.es-steps` (ring on change), `.es-check` (stroke draws in), `.es-skeleton`, `.es-stagger` (40ms, max 8), `FrameUpMotion.tick()` / `[data-es-tick]`, chip/tab press .97, sliding `.es-tabs__ink`, `.es-new-shine` (once).

## Builder Order

Every inspector follows this order:

1. Workspace title
2. Inspector tab
3. Accordion or panel title
4. Group title when needed
5. Field label
6. Control value
7. Helper or meta text

Adjacent levels must differ in at least two of these three properties: size, weight, color.

## Usage Rules

- Use one page title or workspace title per screen.
- Use panel titles for major regions, not every bordered container.
- Use section titles for accordions and meaningful control groups.
- Field labels are compact and quieter than the value they identify.
- Control values remain dark enough for fast scanning and editing.
- Helper text must never compete with a label or value.
- Do not use Acumin anywhere in UI chrome; it is for artwork only.
- Do not introduce a new font size when an existing semantic role fits.
- Do not use `font-weight: 800` or `900` as a substitute for selecting the correct role.
- Letter spacing stays at `0` except the page title (-0.02em), section titles (0.005em) and eyebrows (0.08em). Uppercase is for section titles and eyebrows.

## Color Roles

- `--es-text-strong`: titles and editable values.
- `--es-text-primary`: section titles and primary body copy.
- `--es-text-secondary`: field labels and supporting UI labels.
- `--es-text-muted`: helper text, descriptions, and metadata.
- `--es-text-subtle`: disabled or very low-priority information.

The shared dark theme remaps these semantic colors. Components should not hard-code alternate dark text colors.

## Icons

- Every UI icon comes from Lucide (lucide.dev, ISC licence): 24-unit viewBox, `fill="none"`, `stroke="currentColor"`, stroke width 2, round caps and joins. Copy the icon's paths as they are; don't draw new ones.
- Two sizes only, set in `design-tokens.css`: `--es-icon` (18px) everywhere, and `--es-icon-sm` (16px) inside compact controls 32px tall or less (chips, small buttons, badges). Don't set icon sizes in page CSS.
- Brand marks (ES logo, social network logos) and artwork drawn inside designs are not icons and stay as they are.

## Implementation Rule

New components should use the semantic variables or utility classes from `design-tokens.css`. Existing pages may map their established class names to these roles, but page-specific CSS must not redefine the global scale.
