# ES Designer Brand & Design Guide

Last updated: July 1, 2026

Use this file as the design system reference for ES Designer and the EssentiallySports design tools website. It is written so another designer, developer, or AI assistant can recreate the same visual language without guessing.

## 1. Brand personality

ES Designer should feel:

- Sports-media native
- Bold and editorial
- Fast, clean, and production-ready
- Blue-led, crisp, and high contrast
- Spacious but not empty
- Tool-like, but still polished and premium

The visual language is not playful SaaS pastel. It is a strong internal creative system for a sports media company. The UI should feel like a professional design cockpit: clear cards, strong typography, bright action buttons, and unmistakable ES blue.

## 2. Core brand colors

Use these colors as the source of truth.

| Token | Hex | Use |
| --- | --- | --- |
| ES Navy | `#033162` | Primary text, headings, logo text, deep brand surfaces |
| ES Bright Blue | `#0A7DFA` | Primary CTA, selected states, active nav, export/download buttons |
| ES Blue Hover | `#0A6FDE` | Hover/active state for primary buttons |
| Border Blue | `#B5D8FD` | Card borders, input borders, inactive pills |
| Strong Border Blue | `#8CB9E8` | Stronger borders and secondary outlines |
| Pale Canvas Blue | `#F2F8FF` | Canvas placeholder/background panels |
| Soft Canvas Blue | `#F1F8FF` | Alternate pale background |
| Accent Light | `#E8F2FF` | Selected light states, hover backgrounds |
| Tag Blue 01 | `#B5D8FD` | Tag/pill border |
| Tag Blue 02 | `#DAEBFE` | Soft tag fill |
| Tag Blue 03 | `#E6F2FE` | Card tags, soft badges |
| Tag Blue 04 | `#EFF4F9` | Muted tags |
| White | `#FFFFFF` | Page/cards/buttons/canvas text contrast |
| Near Black | `#06111F` | Login/body text when not using ES navy |
| Muted Blue Gray | `#7997B8` | Secondary labels, helper text |
| Login Muted | `#8FA3B8` | Login page helper text |
| Success Green | `#2E7D32` | Success status |
| Soft Green Fill | `#EAF6EE` | Positive tags |
| Soft Cream | `#FFF6E6` | Upcoming/warning tags |

### Color usage rules

- Primary action = `#0A7DFA` background with white text.
- Primary text/headings = `#033162`.
- Inactive controls = white fill, `#B5D8FD` border, navy text.
- Active controls = blue fill, white text.
- Hover on primary = `#0A6FDE`.
- Do not introduce random blues. Stay in the ES blue family unless using team/newsletter colors.
- Keep most UI backgrounds white. Use pale blues only for canvas zones, soft cards, or selected states.

## 3. Typography

### Primary display/post font

Use Acumin Condensed styling for titles and canvas/post text.

Available local files:

- `fonts/acumin-pro-condensed-bold.otf`
- `fonts/acumin-pro-condensed-regular.woff2`

CSS naming currently used:

```css
--font-display: 'Acumin Post', 'Acumin Pro Condensed', 'Arial Narrow', sans-serif;
--font-post: 'Acumin Post', 'Acumin Pro Condensed', 'Arial Narrow', sans-serif;
--font-title: 'Acumin Pro Condensed Local', 'Arial Narrow', sans-serif;
```

Use Acumin/Acumin-like condensed bold for:

- Homepage hero/workspace titles
- Login title
- Guideline titles
- Canvas text pills
- Quote/post headline text
- Stats numbers and stats labels
- Newsletter tags such as “TENNIS”

### UI font

Use Roboto Condensed for interface controls.

```css
--font-ui: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
--font-heading: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
```

Use Roboto Condensed for:

- Buttons
- Form labels
- Inputs
- Dropdowns
- Navigation
- Card metadata
- Helper text
- Status messages

### Typography rules

- Headings should be heavy, condensed, and confident.
- UI labels should be condensed, readable, and medium/bold.
- Avoid regular Roboto for big headings.
- Avoid loose, rounded, playful fonts.
- Use uppercase for canvas/post labels and bold CTA labels where appropriate.
- Keep line height tight for display text, comfortable for body text.

Suggested scale:

| Element | Font | Weight | Notes |
| --- | --- | --- | --- |
| Page hero title | Acumin Condensed | 700-900 | Large, navy, tight line-height |
| Workspace/card title | Acumin Condensed | 700-900 | Navy |
| Section title | Acumin Condensed | 700-900 | Similar weight to workspace titles |
| UI button | Roboto Condensed | 700-800 | Clear, bold |
| Form label | Roboto Condensed | 700 | Navy |
| Helper/body | Roboto Condensed / Roboto | 400-500 | Muted blue-gray |
| Canvas headline | Acumin Condensed | 900 | Usually uppercase |

## 4. Logo usage

Primary assets:

- `brand-logo-blue.svg`
- `brand-logo-white.svg`
- `es-rounded-logo.webp`
- `favicon.ico`
- `favicon.svg`

Rules:

- Use the full blue ES logo on white or pale backgrounds.
- Use the white logo on dark/navy/footer backgrounds.
- Preserve original logo proportions. Do not stretch.
- In generated social canvases, the ES mark is usually top-right.
- When a Swipe Button is present in social creatives, the ES logo may move top-left depending on the template.
- Keep logo sizes consistent and deliberate; do not make it decorative clutter.

## 5. Layout principles

The ES Designer UI uses:

- white pages
- generous margins
- card-based sections
- pale blue canvas/preview blocks
- strong blue primary actions
- thin light-blue borders
- crisp corners, not overly rounded blobs

### Page structure

Recommended high-level page layout:

```text
Header / nav
Hero or page title
Main content cards / workspace shell
Canvas or preview area
Controls panel
Footer
```

### Spacing

General rules:

- Use comfortable whitespace, but avoid huge empty top gaps.
- Controls should feel grouped and aligned.
- On laptop screens, important CTAs and canvas controls should be visible without excessive scrolling.
- Align upload buttons and history controls with the canvas bottom when possible.

Suggested spacing:

| Use | Value |
| --- | --- |
| Small gap | 8px |
| Standard gap | 12px-16px |
| Card inner padding | 24px-36px |
| Section spacing | 48px-80px |
| Large hero spacing | 80px-120px max |

## 6. Radius, borders, and shadows

Current CSS tokens:

```css
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 12px;
--button-radius: 8px;
--shadow-sm: 0 19px 28px rgba(0,0,0,0.01);
--shadow-md: 0 15px 27px rgba(0,0,0,0.1);
--shadow-lg: 0 15px 27px rgba(0,0,0,0.1);
--shadow-soft: 0 20px 60px rgba(3, 49, 98, 0.10);
```

Rules:

- Buttons: `8px` radius.
- Inputs/cards: `6px-12px` radius.
- Avoid very large pill-like radii except toggles or special badges.
- Borders are usually `1px` or `1.5px` in `#B5D8FD`.
- Use subtle shadows sparingly. The brand is cleaner with border-first surfaces.

## 7. Buttons and CTAs

### Primary button

Use for major actions: Submit Request, Upload Image, Export/Download, Login.

Style:

- Background: `#0A7DFA`
- Hover: `#0A6FDE`
- Text: white
- Radius: `8px`
- Font: Roboto Condensed, bold
- Height: generous, usually `48px-76px` depending on context
- Optional icon on left/right
- Slight shadow is allowed for hero/upload CTAs

Example CSS:

```css
.primary-cta {
  background: #0A7DFA;
  color: #FFFFFF;
  border: 1.5px solid #0A7DFA;
  border-radius: 8px;
  font-family: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
  font-weight: 800;
  letter-spacing: 0;
}

.primary-cta:hover {
  background: #0A6FDE;
  border-color: #0A6FDE;
}
```

### Secondary button

Style:

- Background: white
- Border: `#8CB9E8` or `#B5D8FD`
- Text: `#033162`
- Hover text/border: `#0A7DFA`
- Radius: `8px`

### Tool pills / mode buttons

Inactive:

- white fill
- light blue border
- navy text

Active:

- ES bright blue fill
- white text
- no visual ambiguity

## 8. Forms and inputs

Form style:

- White background.
- Light blue border `#B5D8FD`.
- Active/focus border `#0A7DFA`.
- Navy text.
- Roboto Condensed labels.
- Clear required markers.
- Large click/tap targets.

Input fields should not feel gray/default-browser. They should look like part of the ES blue UI system.

Validation/status:

- Errors: red text.
- Success: `#2E7D32`.
- Keep messages plain and direct.

## 9. Cards

Card style:

- White fill.
- Light blue border.
- Radius `10px-12px`.
- Optional soft shadow.
- Strong Acumin/Roboto Condensed title.
- Muted blue-gray metadata.
- Primary CTA at bottom where relevant.

Login feature cards:

- Large stacked/scrolling cards are acceptable.
- Keep imagery crisp and web-optimized.
- Use ES blue/pale blue accents, not random gradients.

Workspace cards:

- Show a preview image.
- Use clear title and one CTA.
- Card previews should be `.webp`.

## 10. Canvas/post design rules

The exported creative designs use a stronger editorial style than the UI.

### General canvas rules

- Keep canvas dimensions exact per format.
- Use high contrast: black/dark image areas, white text, strong red/blue/team-color pills.
- Use Acumin Condensed Bold for main post text.
- Keep the ES logo consistently placed.
- Avoid accidental text stretching.
- Text pills must resize dynamically based on text length.
- Preserve left/right/top/bottom padding in pills.

### Social media canvas

Common format:

- Instagram feed-style vertical canvas.
- Black/dark photo background or image composition.
- ES logo at top-right unless a specific template moves it.
- Headline pill near bottom.
- Stats layouts use large numbers and compact labels.

Text pill behavior:

- Dynamic width based on measured text.
- Strong fill color, often red/team color.
- White text for dark/strong fill.
- Padding must be balanced on all sides.

Stats post behavior:

- Numbers: very large, white, Acumin Condensed Bold.
- Labels: uppercase, smaller, bold.
- Dividers: thin white/gray lines.
- Single entity bottom title pill must grow/shrink with text.

### Newsletter canvas

Newsletter asset types:

- Feature Image
- Section Header
- Video FI
- Tag FI

Video FI:

- Size: `900 × 675`.
- Background image fills canvas.
- Play button centered.
- Play button inner circle uses newsletter brand color at low opacity.
- White play icon.

Tag FI:

- Size: `900 × 675`.
- Background image fills canvas.
- Editable text pill on top.
- Pill:
  - white fill
  - `#AAD1FA` stroke
  - ES navy text
  - Acumin Condensed Bold
  - no rounded corners unless specifically requested
  - padding similar to Figma reference: more horizontal than vertical

Section Header:

- Strong editorial label.
- Newsletter brand color drives emphasis.
- Keep text aligned and export-safe.

## 11. Newsletter brand colors

Newsletter-specific assets can use their own brand palette. Current known mappings include:

| Newsletter | Background | Foreground |
| --- | --- | --- |
| EssentiallySports | `#0A7DFA` | `#FFFFFF` |
| Essentially CFB | `#C9A874` | `#762222` |
| Essentially Dunk | `#263F7A` | `#FFFFFF` |
| Essentially Golf | `#008F05` | `#FFFFFF` |
| Break Point | `#DFFB35` | `#133A58` |
| Buckeye Daily | `#C70837` | `#FFFFFF` |
| Essentially MMA | `#D90606` | `#FFFFFF` |
| Essentially Athletics | `#0E8CC3` | `#FFFFFF` |

Rules:

- Newsletter brand color can override accent elements inside newsletter exports.
- Keep the UI shell itself ES blue/white.
- For Video FI, use the newsletter background color as a low-opacity overlay inside the play circle.

## 12. Image and asset rules

- Prefer `.webp` for raster images.
- Prefer `.svg` for logos and icons.
- Keep assets optimized and web-friendly.
- Avoid large raw `.jpg`/`.png` in production unless required temporarily.
- Use descriptive filenames.
- Do not stretch or distort preview artwork.
- Maintain correct aspect ratios:
  - Social/Instagram feed: vertical feed creative.
  - YouTube thumbnail: `1280 × 720`.
  - Newsletter Video FI / Tag FI: `900 × 675`.

## 13. Motion and interaction

Motion should feel clean, not theatrical.

Good motion:

- Soft hover lift for cards.
- Smooth accordion expand/collapse.
- Subtle stacked-card scrolling on login/product sections.
- Button hover color transition.

Avoid:

- Bouncy playful motion.
- Excessive rotation.
- Long delays.
- Animations that block tool usage.

Suggested timing:

- Fast UI: `160ms-220ms`.
- Page/card transitions: `280ms-450ms`.
- Use ease-out or a smooth cubic-bezier.

## 14. Footer and nav style

Navigation:

- White background.
- Blue accent underline/border.
- Navy labels.
- Active/hover states use ES blue.

Footer:

- Dark/navy or strong branded section.
- Use white ES logo.
- Social icons should remain compact and aligned.
- Footer text can be muted/light, but readable.

## 15. Accessibility and responsiveness

Rules:

- Keep color contrast strong, especially blue text on pale backgrounds.
- Buttons and inputs need large touch targets.
- Do not rely only on color for active state; use fill/border/weight too.
- Laptop screens matter as much as large desktops.
- Canvas + toolbar + upload controls should be visible without awkward scrolling where possible.
- Avoid tiny text on exported graphics.

## 16. Do / Don’t

### Do

- Use ES navy and ES bright blue consistently.
- Use Acumin Condensed Bold for major display and canvas text.
- Use Roboto Condensed for UI controls.
- Keep cards white with blue borders.
- Make primary CTAs bold and blue.
- Keep generated assets high-contrast and sports-editorial.
- Preserve canvas aspect ratios exactly.
- Use `.webp` assets.

### Don’t

- Don’t use generic purple SaaS gradients.
- Don’t use rounded bubble UI everywhere.
- Don’t introduce random fonts.
- Don’t make the UI gray/default-browser.
- Don’t stretch logos or images.
- Don’t let text pills have fixed width when text changes.
- Don’t change one workspace’s state in a way that leaks into another.
- Don’t add huge whitespace above login/home sections.

## 17. AI-ready branding prompt

Copy this block into another AI when asking it to create or modify ES Designer pages:

```text
Design this for ES Designer by EssentiallySports.

Use a bold sports-media internal-tool aesthetic: crisp, editorial, blue-led, professional, and high contrast. The UI should feel like a polished creative production cockpit, not a playful SaaS dashboard.

Brand colors:
- ES Navy: #033162 for headings, primary text, and logo-like text.
- ES Bright Blue: #0A7DFA for primary CTAs, active states, selected controls, and export/upload buttons.
- ES Blue Hover: #0A6FDE.
- Light Border Blue: #B5D8FD for cards, inputs, inactive buttons.
- Strong Border Blue: #8CB9E8 for stronger outlines.
- Pale Canvas Blue: #F2F8FF / #F1F8FF for canvas placeholders and soft panels.
- Accent Light: #E8F2FF for selected/hover backgrounds.
- White: #FFFFFF.
- Muted blue-gray: #7997B8 / #8FA3B8 for secondary text.

Typography:
- Use Acumin Pro Condensed Bold or a close condensed bold fallback for page titles, workspace titles, guideline titles, canvas/post text, stats numbers, and big editorial labels.
- Use Roboto Condensed for UI controls, buttons, forms, nav, labels, helper text, and metadata.
- Headings should be bold, condensed, navy, and tight.

Components:
- Primary buttons: #0A7DFA background, white text, 8px radius, bold Roboto Condensed, hover #0A6FDE.
- Secondary buttons: white background, #B5D8FD/#8CB9E8 border, #033162 text.
- Cards: white fill, light blue border, 10-12px radius, subtle shadow only when needed.
- Inputs: white fill, #B5D8FD border, #033162 text, #0A7DFA focus border.
- Active pills/tabs: blue fill with white text. Inactive: white fill, light blue border, navy text.

Layout:
- Use clean white space but avoid excessive empty top padding.
- Keep controls grouped and aligned.
- On laptop screens, important canvas controls and upload buttons should be visible without awkward scrolling.
- Use .webp for raster assets and .svg for logos/icons.

Canvas/export creative style:
- Use Acumin Condensed Bold for all major canvas text.
- Keep ES logo proportions intact.
- Text pills must dynamically resize with text and keep balanced top/right/bottom/left padding.
- Social graphics should feel bold, black/dark/high-contrast, with ES logo placement consistent.
- Newsletter Video FI and Tag FI are 900x675.
- Video FI: background image + centered play button; play circle uses newsletter brand color at low opacity.
- Tag FI: background image + editable white pill with #AAD1FA stroke and #033162 Acumin text.

Avoid:
- Generic SaaS gradients, random purple palettes, playful rounded bubble UI, default gray browser styling, stretched logos, or fixed-width text pills.
```

## 18. CSS starter tokens

Use this CSS token block when creating a new ES Designer page:

```css
@font-face {
  font-family: 'Acumin Pro Condensed Local';
  src: url('../fonts/acumin-pro-condensed-bold.otf') format('opentype');
  font-style: normal;
  font-weight: 700;
  font-display: swap;
}

:root {
  --es-white: #FFFFFF;
  --es-navy: #033162;
  --es-black: #06111F;
  --es-blue: #0A7DFA;
  --es-blue-hover: #0A6FDE;
  --es-border: #B5D8FD;
  --es-border-strong: #8CB9E8;
  --es-canvas: #F2F8FF;
  --es-canvas-soft: #F1F8FF;
  --es-accent-light: #E8F2FF;
  --es-muted: #7997B8;
  --es-muted-login: #8FA3B8;
  --es-success: #2E7D32;
  --es-tag-blue-01: #B5D8FD;
  --es-tag-blue-02: #DAEBFE;
  --es-tag-blue-03: #E6F2FE;
  --es-tag-blue-04: #EFF4F9;
  --es-cream: #FFF6E6;
  --es-green-soft: #EAF6EE;
  --font-ui: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
  --font-heading: 'Roboto Condensed', 'Roboto', Arial, sans-serif;
  --font-display: 'Acumin Pro Condensed Local', 'Acumin Pro Condensed', 'Arial Narrow', sans-serif;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --button-radius: 8px;
  --shadow-soft: 0 20px 60px rgba(3, 49, 98, 0.10);
  --shadow-md: 0 15px 27px rgba(0, 0, 0, 0.10);
}
```

