# Generate v3: style research (gen-looks)

Purpose: make Generate design like the ES social team, with more variety in layouts and tones. Style inspiration only: no specific design, logo or artwork is copied.

## 1. The ES Figma board

Source: file `ZtArAy8Oa52pOF92FPl7Zo`, node `2335:229` (74 posts, 1080x1350).

Row crops at about 0.4 scale are in `scratchpad/figma-refs/looks/row-*.png`:

| Row | Section |
|---|---|
| 6827, 6880 | Lifestyle |
| 8812, 8816 | Listicle |
| 10752 | Grid |
| 12874 | Bar graph |
| 14996, 16431 | Stats post |
| 18337 | Cover image |
| 20243, 21728 | Quotes |
| 12049, 13749, 15449, 16984, 18684, 20181, 21678, 23175 | Extra posts |

What the board does, section by section:

- **Highlight boxes.** Every headline sits in boxes: one solid box per line, the lines stepped left and right (staggered), all in condensed caps.
  - Box colours: white with team-colour type, team colour with white type, or black.
  - Key words are set in a second colour inside the box ("PERFECT TIMING" in orange on brown, "EUROPE" in red).
- **Stats posts.** These carry the most character.
  - A huge white stat at the top ("25-2", "1000+", "500 / 150"), with its label in small condensed caps tucked under the number's end.
  - The player is cut out and overlaps the number, so the head sits in front of the digits.
  - Behind the player is the same photo, blurred and toned in the team colour.
  - The team colour rises from the foot, and the headline box ("HISTORY", "RECORD ALERT!") sits over the player's waist.
  - Variant: a framed column of 2-3 stats (13 PTS / 9 AST / 4 MVP) next to the player.
- **Cover images.** A full-bleed action photo with a team-colour gradient at the bottom and 3-4 staggered highlight-box lines. "SWIPE >>" sits bottom-right, and the ES mark moves top-left on carousel covers.
- **Quotes.**
  - A full-bleed portrait with the quote in white boxes and black type, quote marks, and a context line.
  - A dual-portrait checkerboard: two photos, two light quote panels and name tags.
  - A light quote card across the foot of a photo.
- **Listicles.** Light grey paper with a fine grain.
  - A black condensed title, a 4px rule, and small column heads.
  - Each row has a team-colour rank square, a team logo, the name in two lines, a value in team colour, and a headshot sitting on the row line.
  - Lists run as carousel slides 1-5, 6-10 and so on.
- **Grids.** Square headshot tiles on team-colour backgrounds, each with a rank tag and a name tag (the 30-player grid and the dream line-up).
- **Bar graphs.** Light paper and a boxed title. Bars in a thin outlined track, with the value inside the bar and a season tag at the bar's end. Black-and-white cut-outs stand at the foot.
- **Extra posts.**
  - Tweet cards over a blurred, dimmed photo.
  - A stat composite: a logo tile with the team name, then a grid of numbers with small label tags under each, and the coach large on the right.
  - Lineage and timeline slides, and a carousel cover followed by white data slides.
- **Lifestyle.** A photo with a light card (a Spotify-style lyric card): softer, editorial and less shouty.
- **Tones on the board.** Vivid team colour (OKC orange and blue, Lakers purple and gold), dark cinematic (Doc Rivers on black and green), and light paper for lists and data. The board is not all dark navy.

## 2. External variety

Pinterest needs a login, so it was not used. Sources:

| Source | Takeaway |
|---|---|
| [ScoreVision: top 4 trends for sports graphics 2025-26](https://blog.scorevision.com/top-4-trends-for-sports-graphics-2025-2026) | Heavy condensed type; retro halftone textures; neon glow; isolated athletes with shadows and outlines. Shadow and rim on cut-outs went in; neon was skipped (already in v2). |
| [Impersonal Foul: inside the sports media graphic design complex](https://www.impersonalfoul.com/p/inside-the-sports-media-graphic-design) | Breaking-news posts are bold sans headlines over one strong photo; rule-of-thirds posters; photo collages put together by a producer. This led to the cover and collage looks. |
| [Graphic Design Junction: experimental sports posters](https://graphicdesignjunction.com/2026/09/creative-sports-posters-experimental-typography/) | Treat the athlete, type and negative space as one composition; condensed type reads as speed. This led to the magazine split and the light stat card (white space). |
| [Box Out Sports player-stat templates](https://boxoutsports.com/graphics/key-player/player-stats-clean) ("Clean", "Trading card", "Flex blur") | Clean light stat cards; a blurred copy of the same photo behind the player. The blurred own-photo field behind every cut-out comes from this. |
| Behance sports portfolios ([Gibson Graphics, NBA/WNBA social](https://www.behance.net/GibsonGraphics), [Rob Jordan, NFL social](https://www.behance.net/RobJordan), [Lange Creative, Rams gameday](https://www.behance.net/langecreative)) | Players breaking out of frames and panels; framed photo cards; strong team-colour fields. This led to the frame-break look (registered cut-out). |
| [Stats Perform: football graphics trends](https://www.statsperform.com/resource/top-football-graphics-trends-a-visual-guide/) | Could not be read (403). Listed for completeness. |
| [WSC Sports: 9 ways sports brands use graphics](https://wsc-sports.com/blog/industry-insights/9-creative-ways-sports-brands-utilize-graphics-and-effects-in-social-media/) | Templates per content type, a recognisable house style, and data-led carousel slides. This supports the ES-category families. |

## 3. What was built from it

All of this is in `frameup-compose.js`, under "Generate v3 looks".

**17 looks**, each tagged with its ES family:

| Family | Looks |
|---|---|
| stats | stat-stack, stat-column, record-alert, light-stat |
| cover | cover-boxes, frame-break, split-panel |
| quote | quote-boxes, quote-card, quote-duo |
| grid | headshot-grid |
| listicle | ranked-table |
| bar-graph | bar-race |
| extra | post-card, stat-sheet, print-collage |
| lifestyle | editorial-feature |

**7 tone families:** light, paper, vivid, dark, duotone, editorial and esblue.
- Each is built from the team colours, and every role is contrast-checked.
- Each look declares the tones it supports.

**Cut-out craft:**
- The blurred own-photo field behind the subject.
- A team-colour rim light on dark fields, and a ground shadow.
- The number sits behind the head.
- Frame break: the cut-out is drawn over its own photo at the same scale and position, so only the head and shoulders rise out of the frame.
- Athletes are never mirrored.
