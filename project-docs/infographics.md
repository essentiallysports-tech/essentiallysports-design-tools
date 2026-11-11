# Newsletter infographics

Each infographic is an editable template under **Newsletter → Newsletter Asset**,
named "<Something> FI". People type their own text, swap photos (drag on the
canvas or use Zoom / Left-right / Up-down), then Export or Copy link.

## How it works

- `infographic-templates.js` holds one entry per infographic: frame size,
  `exportScale`, background, and a list of layers. Every newsletter FI exports at
  **960 × 640** (as do Video FI and Tag FI). Designs drawn at 960 × 640 in Figma
  use that frame at 1× (coordinates copy straight across); the older designs are
  640 × 426.67 at `exportScale` 1.5. A Figma frame with another shape must be
  laid out to fill the frame (extend photos, move bottom elements down).
  Layers can carry `shadow`, and `flowAfter`/`flowGap` place a layer right after
  another one's drawn width (result pills, a unit after a number). The format is documented at the top of the file. That file is the
  only thing that changes when an infographic is added.
- Images live in `assets/infographics/` as `.webp`: logos, badges, icons and
  composed static backgrounds. Every people-photo slot uses the same two sample
  photos (`sample-tennis.webp`, `sample-golf.webp`), placed by the `person()`
  helper so the face lands at the same spot in each slot and heads line up side
  by side. Video FI and Tag FI show the same samples until a photo is uploaded.
- The engine in `index.html` (search "NEWSLETTER INFOGRAPHICS") registers each
  template as asset `ig-<id>`, draws its layers, and builds the panel:
  - one collapsible card per `group` (ordered by `groups`) when there are two or
    more groups, otherwise a flat list; the card header shows the photo and name;
  - text layers that share an `id` share one field (e.g. column labels on every card);
  - short fields of one kind (`maxLength` ≤ 24, labels like "Stat 1/2/3") sit side
    by side; `labelFrom` labels a field with another field's value (stat → column name);
  - photo slots get Replace / Reset, with Zoom / Left-right / Up-down behind "Adjust";
    clicking a photo on the canvas opens its card.
  Text shrinks to fit, then ends in "…".
- Edits (text, photos, positions) are part of the design state, so Undo / Redo
  covers them. Typed text is also remembered per browser (localStorage); photos are not.
- A template's images load when it is first opened; Export waits until they have.
- `draft: true` shows a template only on localhost.

## Adding infographics from Figma (the usual way)

Suhail shares a Figma link (section or frame). With the Figma MCP tools:

1. `get_metadata` on the node to list the frames, then `get_design_context` on
   each frame for positions, fonts, colours and image URLs.
2. **Only visible images matter.** Images stacked under the top image in a
   slot are leftovers, so skip them. The top visible image becomes the slot's
   placeholder, with its box (`x, y, w, h`, rotation). Figma's `object-cover`
   means cover fit. An image with no `object-cover` (e.g. `object-bottom`) is
   stretched to its box, so use `anchor: 'fill'`.
3. Masks and slanted panels: download the mask SVG and use its path as the
   photo's `points`. A flipped or rotated vector: apply the CSS transform
   (translate, rotate, scale, then skew) to the points, around the element
   centre. A white edge = `path` with `outside: true`.
4. Static backgrounds made of several layers (textures, gradients): compose
   them once in the browser into one `.webp` at 2×.
5. Download assets with curl (the URLs expire), convert to `.webp` (max 1280px)
   in the browser pane, and save them through the scratchpad save-server.
6. **Check against Figma:** `get_screenshot` of each frame, then render each
   template at 1× in the editor and difference them (scratchpad tools
   `cmp` / `zoomCmp`). Calibrate text with `baseline` /
   `box.baselineFromBottom`, and `font.scaleX` when the design font is more
   condensed than Acumin Post.
7. Preview locally; push only when Suhail says push.

## Fonts

The site has Acumin Post (condensed black, the default), Acumin Pro Condensed
Local (bold) and Acumin Pro Condensed Web (regular). Anything else falls back to
a system font unless it is added to `fonts/` and `@font-face`.

## Current templates (Figma "ES Design Team Files")

Section 2070:145: Three Player Slant FI, Two Player Slant FI, Two Photo Split
FI, Four Photo Sequence FI, Headline Photo FI.

Section 2188:941 (golf cards, 960 × 640): Player Season Stats FI, Weekend
Winners FI, Tournament Fields FI, Defending Champion FI, Player Quote FI, Three
Panel Collage FI, Two Up Collage FI.

## Brands

Every infographic FI follows the **Newsletter Brand** picker (shown on all FIs).
Templates never hard-code brand colours; they use tokens resolved from the
brand in `NEWSLETTER_BRANDS` (index.html, "INFOGRAPHIC BRAND THEME"):

| Token | Meaning |
|---|---|
| `theme.primary` / `theme.onPrimary` | brand colour and the text on it (pills, rings, accents) |
| `theme.ink` | deep shade of the brand for headings and numbers |
| `theme.strong` | brand colour if it reads on white, else ink (accent text) |
| `theme.bg` | shared light grey background (same for all brands) |
| `theme.card`, `theme.muted`, `theme.rule`, `theme.photoBg`, `theme.shadow` | neutrals |

Add `@0.4` for transparency (`theme.ink@0`). SVG icons can be recoloured with
`recolor: { "#003008": "theme.ink" }`. A colour-choice field
(`type: "swatches"`, `brandOption: true`) offers Brand colour, Brand second (the brand's second pill colour) and a
Social sport's variations (e.g. Tennis). To add a brand, add it to
`NEWSLETTER_BRANDS` once; every FI picks it up.

FI colours come from each brand's `fi` palette (primary + text, second + text,
ink), copied from the Newsletter Hub pills (essentiallysports.com/newsletter-hub)
and each newsletter's page. Brands without `fi` fall back to the header colours
(`background` / `foreground`).