# Trends board UI audit (trends-ui, 2026-11-18)

Scope: `generate.html?view=trends`, list and cards layouts, 1440 / 1280 / 1024 / 375, light and dark.
Source: Suhail's two screenshots ("please fix this UI", "pls fix UI and user experience") plus a
local run with the stored feed. Ranked by user impact.

| # | Finding | Fix |
|---|---------|-----|
| 1 | Row actions overflowed and were clipped at the right edge; the Video ad icon appeared on some rows only, so every icon after it shifted. | One fixed set in fixed slots (`TrendsLogic.rowActions`). Video ad is disabled in place with the reason. The action column has a constant width; "⋯" takes the overflow under 800px of list width. |
| 2 | Cards were ~250–430px tall: 112–180px media, a full-width storyline bar, an empty "Headline ideas" box, and a tall stacked action column. | ~170–190px at 1280. 96px media, the storyline as an inline toggle, ideas hidden until they exist, and the actions in one row at the bottom. |
| 3 | Icons had no labels or tooltips; only "Design post" was named. | Every action has a label (visible on wide cards, otherwise a tooltip plus a screen-reader label) and its shortcut. |
| 4 | Every card wore a blue outline (`.is-pick` ring plus the always-on AI rim), so nothing read as selected. | Quiet border and a hover lift. The blue ring marks only the open kit; keyboard focus gets the focus ring. |
| 5 | The toolbar was crowded: mixed 32/36/44px controls and an orphaned keyboard icon. | 40px controls. Layout and shortcuts form one group. AI angles and Refresh are both secondary, and their labels fold into tooltips when the toolbar is narrow. |
| 6 | Headings were too big (22px condensed caps), and "See all 16" was clipped. | ES section-title scale. "See all" can't shrink. |
| 7 | Filter chips had heavy counts, and Shortlist sat apart behind a divider. | Light 12px counts. Shortlist is a normal filter chip, and its count shows only when it is above 0. |
| 8 | Crest images from Wikipedia "photos" were cropped (`object-fit: cover`). | `isLogoImage` shows SVG and "logo" files whole, on a padded tile. |
| 9 | The meta line wrapped with a dangling "·". | Each separator travels with the item after it. Under 460px only spacing is used. |
| 10 | The why-now stats line was link blue but not clickable. | Secondary ink. |

Not changed: the AI cost (the same single `[data-ai]` path; no new call sites), the feed, and the post kit contents.
Bundle (unminified): trends-view.js +7.7 KB, trends.css +7.6 KB, trends-logic.js +1.8 KB.
