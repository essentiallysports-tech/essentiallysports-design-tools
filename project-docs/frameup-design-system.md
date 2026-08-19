# FrameUp Product Design System

This document is the source of truth for FrameUp product UI. The live CSS tokens are in `design-tokens.css`.

## Typography Principle

Hierarchy must be visible before the words are read. Size, weight, and color work together; bold text alone is not hierarchy.

FrameUp uses two type families:

- **FrameUp Acumin**: display, page, and workspace titles only.
- **Roboto Condensed**: panels, sections, labels, controls, buttons, and compact product UI.
- **Roboto**: longer body copy, descriptions, helper text, and status messages.

## Semantic Roles

| Role | Token/class | Size | Weight | Color | Use |
| --- | --- | ---: | ---: | --- | --- |
| Display | `--es-type-display-*` / `.es-type-display` | 48 | 900 | Strong | Rare branded display text |
| Page title | `--es-type-page-title-*` / `.es-type-page-title` | 36 | 900 | Strong | One title per standalone page |
| Workspace title | `--es-type-workspace-title-*` / `.es-type-workspace-title` | 24 | 800 | Strong | Active builder or dashboard name |
| Panel title | `--es-type-panel-title-*` / `.es-type-panel-title` | 18 | 800 | Strong | Major editor panel or timeline |
| Section title | `--es-type-section-title-*` / `.es-type-section-title` | 15 | 800 | Primary | Accordion and grouped control title |
| Field label | `--es-type-field-label-*` / `.es-type-field-label` | 12 | 700 | Secondary | Label directly above or beside a control |
| Control value | `--es-type-control-*` / `.es-type-control` | 14 | 500 | Strong | Inputs, selects, menus, and editable values |
| Body | `--es-type-body-*` / `.es-type-body` | 14 | 400 | Primary | Explanatory copy that users need to read |
| Helper | `--es-type-helper-*` / `.es-type-helper` | 12 | 400 | Muted | Hints, empty states, descriptions, and statuses |
| Meta | `--es-type-meta-*` / `.es-type-meta` | 11 | 600 | Muted | Counts, timestamps, source labels, and badges |

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
- Do not use Acumin for fields, buttons, descriptions, or long text.
- Do not introduce a new font size when an existing semantic role fits.
- Do not use `font-weight: 800` or `900` as a substitute for selecting the correct role.
- Letter spacing stays at `0` in product UI. Uppercase is reserved for short status/meta labels.

## Color Roles

- `--es-text-strong`: titles and editable values.
- `--es-text-primary`: section titles and primary body copy.
- `--es-text-secondary`: field labels and supporting UI labels.
- `--es-text-muted`: helper text, descriptions, and metadata.
- `--es-text-subtle`: disabled or very low-priority information.

The shared dark theme remaps these semantic colors. Components should not hard-code alternate dark text colors.

## Implementation Rule

New components should use the semantic variables or utility classes from `design-tokens.css`. Existing pages may map their established class names to these roles, but page-specific CSS must not redefine the global scale.
