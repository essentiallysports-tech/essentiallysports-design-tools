# League logo sources

Used by `league-logos.js` (`LeagueLogos.logoFor()`). The Figma file "ES Design Team Files"
(`ZtArAy8Oa52pOF92FPl7Zo`) has team colour pills and ES sub-brand marks but no league logos
(checked 2026-11-17: pages "Logos" and "All Sports Color Pills, Icons & Vectors", plus a
library search for NFL / MLB / PGA Tour / NCAA). So the league marks come from Wikimedia.

Each file was downloaded on 2026-11-17 and only cleaned: editor metadata, comments, titles
and fixed width/height removed, inline `style` fills turned into `fill` attributes. Paths and
colours are unchanged.

| File | Sport id | Mark | Source |
| --- | --- | --- | --- |
| `nfl.svg` | `nfl` | NFL shield | https://upload.wikimedia.org/wikipedia/en/a/a2/National_Football_League_logo.svg |
| `mlb.svg` | `mlb` | MLB batter logo | https://upload.wikimedia.org/wikipedia/commons/a/a6/Major_League_Baseball_logo.svg |
| `cfb.svg` | `cfb` | NCAA disc | https://upload.wikimedia.org/wikipedia/commons/d/dd/NCAA_logo.svg |
| `golf.svg` | `golf` | PGA Tour logo | https://upload.wikimedia.org/wikipedia/en/7/77/PGA_Tour_logo.svg |
| `tennis.svg` | `tennis` | Tennis ball icon | Drawn for FrameUp. Tennis stories cover both ATP and WTA, so no single tour logo fits. |
| `sports.svg` | `others`, unknown | Trophy icon | Drawn for FrameUp (neutral fallback). |

The NFL and PGA Tour marks are hosted on English Wikipedia as non-free logos; they are
trademarks of their leagues and are used here only to label sports in an internal tool.
