# Hero audit: Trends (2026-11-18, branch `feature/hero-trends`)

Method: read `generate.html` (Trends view), `netlify/functions/trend-design.js` and its tests, then pulled one
real feed through the function locally (Google News + Trends RSS, 84 stories, 17 Nov 2026) and walked it as a
social editor on a busy morning: "what should we post right now?". Ranked by user impact.

## P0: the board does not answer "what do we post now?"
1. **The same story fills a sport.** 7 of 14 Golf cards were Bryson DeChambeau / DP World Tour, 5 of 14 NFL cards
   were "Power Rankings Week 11", 3 Tennis cards were Zverev. Title-similarity merging only catches near-identical
   headlines, so editors scroll past repeats and the 2nd-best story is hidden.
2. **No cross-sport answer.** "All" is six sport sections in a fixed order (Golf first). The most important story
   of the morning can sit at the bottom of the MLB section. There is no "post this first" list.
3. **No sense of momentum.** Every card shows age only. "7 sources in 3 hours" and "1 source, 20 hours ago" look the
   same; nothing says rising or hot.
4. **No ES relevance per brand.** The Huddle, Essentially CFB and ES Dugout editors can't narrow to their newsletter.

## P1: the job takes too many steps
5. **No post kit.** To post a story an editor needs a headline, a template, a photo and (for video) a hook. Today:
   hover a card (AI), pick a headline, Generate picks a template, then search for a photo in the editor by hand,
   and write the reel hook from scratch. 6+ steps and 3 tools.
6. **No Reels hand-off.** Reels Studio accepts a trend (`frameup.reelMoment.v1`), but Trends has no "Make a reel".
7. **Rule-based headline ideas are often junk**: "The Athletic", "Here's When He'll Play Next",
   "Alex Eala/Instagram Story)", "Dan Campbell", "Georgia Leads the Way" (fragments, source names, bare names).
8. **Noise on the board**: a video game ("MLB The Show 27"), "How Much Do MLB Baseball Operations Jobs Pay?",
   "Where to Watch every NCAAF game", "Photo Galleries", "Prospects Chat", "Expert picks… fantasy golf".
9. **Misfiled stories**: NFL stories in Others ("Dan Campbell…", "Derrick Henry on 10 carries", "Jets QB Geno
   Smith"), a CFB one too ("Arch Manning…"). The classifier gives "QB" and coaches almost no weight.
10. **"Saved" is a dead end**: kept per browser, but can't be shared or handed to a teammate.

## P2: speed, density, keyboard
11. **One density only**: big cards (≈190 px each). 30+ stories = long scroll; no compact list.
12. **No keyboard flow**: Tab walks every link and button on every card (≈9 stops per card).
13. Freshness is only a green "12m ago"; the 20-minute amber dot is the only staleness cue.

## Cost waste
14. **AI fires on hover.** Resting the pointer 600 ms on a card (or tabbing through it) calls the AI. Scanning the
    board with a mouse triggers calls nobody asked for; keyboard users trigger one per card they tab through.
15. **AI cache is short-lived**: server 45 min per instance, browser sessionStorage only. The same story's angles are
    bought again after a reload in a new tab or after 45 min, though the story text (and its id) has not changed.
16. **No check on invented numbers** in AI copy: the prompt asks, but nothing validates.

## Design-system / a11y gaps
- Hard-coded dark colours in the toolbar instead of tokens.
- Action column buttons wrap awkwardly at 1024; the "Video ad" link only exists for 3 sports, so rows don't align.
- Save toggle reads "Save"/"Saved" but the filter says "Saved" (fine), no way to bulk act.

## Kept (works well, don't break)
Zero AI calls on load; instant first paint from the last feed; honest "Updated X min ago"; per-card skeletons;
48 h / 24 h freshness cutoffs; league and team logos; Video Ads hand-off; URL-addressable sport filters.
