# FrameUp Video Ads: which new ad styles to add

> **Update 2026-11-18 (owner decision):** Stat Card and Quote Card were removed from Video Ads. The live styles are Simple, Condensed, Highlight, Today's 3 and Us vs Them. The Stat Card and Quote Card sections below are kept as research history only.

*Research only, 2026-11-17 (agent `ad-styles-research`). No product code, git, env or config was changed. Estimates are marked **(est.)**. Anything I could not check is marked **(unverified)**.*

Inputs:
- Suhail's Figma board "Growth-ADs". **I could not open it** (see §2).
- The FrameUp ad rating pack (`frameup-ad-rating-engine.zip`) and its port in `netlify/functions/_ad-rating.js`.
- The current Video Ads code.
- `project-docs/ai-reels-research.md`.
- A web market scan. The Meta Ad Library itself returned HTTP 403 to automated access, so ad data comes from mirrors of it (§3).

---

## 1. Executive summary

**Today:** Video Ads has 3 copy styles: Simple, Condensed and Highlight. All three are the same layout: a centred block of text over a clip, then a white CTA pill and "Unsubscribe anytime". They differ only in how the headline is set.
- The renderer can already draw a background with no clip: a photo with Ken Burns motion, or an animated gradient (`drawFrame` `source: {kind:'image'|'generated'}`).
- But the copy is **static**. The same `ops` are drawn on every frame, and no element has its own timing.
- The reels research (§3) says paid Meta ads should **not** use downloaded league clips. That makes styles which carry the message without footage the priority.

**What the market shows** (§3):
- Newsletter acquisition ads are moving towards "ugly" or native formats: text over video, lo-fi UGC, mock-ups of social posts, real testimonials.
- **1440** ([runneth/Motion library](https://runneth.com/library/1440)), the closest model for a free daily email aimed at older readers, leads with three formats:
  - **Us vs Them** split screens (25% of its ads);
  - screen recordings;
  - static-to-video hybrids.
- **Morning Brew** runs about 67% video ([AdManage mirror of the Meta Ad Library, data 2026-11-17](https://admanage.ai/ad-library/morning-brew)). Its headlines lean on verified social proof ("Trusted by millions…") and "Subscribe for Free".

**Recommendation:** add the 10 styles below, in 3 phases. Scores are my concept ratings, using the real rubric weights from the pack (20/20/15/15/10/10/5/5). No caps apply if each style is built as specified. Verdict bands: 8.5 or more = "Launch a test", 7.2–8.4 = "Revise first". These are **pre-build estimates, not model reviews**. Run the real `_ad-rating` reviewer on every prototype.

| Rank | Style | One-line idea | Score (est.) | Footage | Effort | Phase |
|---|---|---|---|---|---|---|
| 1 | **Stat Card** | One verified number fills the frame, with one line of context, then the free offer | **8.7** | None | M (S after the motion base) | 1 |
| 2 | **Today's 3** | "3 things NFL fans need to know today": three real headlines appear one by one, then "We send this every morning. Free." | **8.6** | None | S–M | 1 |
| 3 | **Us vs Them** | "Your feed" (crossed out) vs "The Huddle" (ticked): the 1440 top format, in ES voice | **8.6** | None | M | 1 |
| 4 | **Quote Card** | A verbatim, attributed coach or player quote in big condensed type, then the offer | **8.5** | None (licensed photo optional) | S | 1 |
| 5 | **Newsletter Preview** | "Inside tomorrow's issue": a real email card (subject + 3 bullets) scrolls slowly | **8.6** | None | M | 2 |
| 6 | **Matchday Preview** | A scoreboard plate for this week's big game (teams, fixed kickoff time), "Get the preview Saturday morning" | **8.6** | None | M | 2 |
| 7 | **Reader Voice** | A real reader's quote, used with permission (name, city, "reader since") | **8.6** | None | S (reuses Quote) | 2 (blocked on data) |
| 8 | **Top 3 Countdown** | #3 → #2 → #1 storylines or rankings, with a fixed "free daily email" strip | **8.2** | None | M | 3 |
| 9 | **Fan Note** | A lo-fi "note" list in the brand's voice ("Things I stopped doing since I get ES Dugout") | **8.1** | None | S | 3 |
| 10 | **This or That** | Two teams or picks, "Who you got?", with "Get our pick tomorrow, free" | **8.1** | None | M | 3 |

For comparison, the current styles (est., over a clip): Simple 8.2, Condensed 8.4, Highlight 8.5. Their weak points are the 55+ readability of body text over moving footage and the simplicity score (up to 95 words).

**Build these 3 first:**
1. **Stat Card.** The highest score. The number guard (`numberTokens`) already exists and is reusable. It works for all three brands without footage, and it's the strongest stop-scroll hook that stays honest.
2. **Today's 3.** It shows what the newsletter *is* (curation), so it scores highest on headline/offer, the 20% factor. The Trends feed already supplies real `related` headlines.
3. **Us vs Them.** It is 1440's most-used format, it needs no sports data at all, and it can run all season.

The 4th Phase 1 slot goes to **Quote Card** (S effort, reuses the same layout code).

**One shared base is needed first:** time-aware ops (each op gets an entrance window), so styles can reveal items in sequence. This is about 1–2 days (est.), and it also gives the 3 existing styles optional kinetic-type reveals.

**How styles should be chosen** (§5):
- Ask AI first filters styles by the data available: a number in the facts unlocks Stat Card, a quote in the notes unlocks Quote Card.
- It then ranks them by a learned score: exports, little editing, rating-engine score, and later real Meta cost per signup, with the rubric score as the prior.
- It recommends 1 style with a one-line reason, plus 2 alternatives.
- Export can produce a 3-style **variant grid**, named so Meta results can be joined back to the style later.

---

## 2. What Suhail's Figma board shows

### 2.1 Access result
All three Figma MCP calls on the file `tdkkcAqkxHbZ3rwZJf3Olh` (`get_metadata` on node `312:286`, `get_screenshot` on node `312:286`, and `get_metadata` on the file root) failed with the same error:

> `Looks like you don't have edit access to this file. The file owner can share it with you and make you an editor.`
> (Figma Debug UUIDs: f3be1cfa-bde6-4961-a99a-91ce5fe1ed78, ae6f8821-237b-4ebe-8d36-2b29888e2863, c36ebff6-5bb8-4997-99d5-f9cd5206c1c5)

The Figma MCP server needs **edit** access, not view access, to read a file ([Figma MCP rate limits & access](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)). **Decision for Suhail:** add the connected Figma account as an editor on Growth-ADs. Or duplicate the board into a file that account owns, or export the frames as PNGs into the repo. Then §2 can be redone from the board itself.

### 2.2 What I could still reconstruct, indirectly
The repo encodes Suhail's ES ad templates from the **ES Design Team Figma file (ADS page)**. That is a different file from Growth-ADs, but it is his work:
- `video-ads-render.js` header and `video-ads-brands.js`:
  - three 9:16 "NFL-ad-with-logo" frames and three 9:16 CFB frames, one per copy style;
  - 4:5 versions with the logo at y 55–63;
  - "Black Bottom" / "Navy Bottom" fade ads (the clip fades into a solid colour just above the headline);
  - brand highlight colours (The Huddle #CC3333 with white text, CFB #D7A343 with black text);
  - a white CTA with a red mail icon (Acumin Black 51.7px);
  - "Unsubscribe anytime" (Roboto SemiBold 24.9px).
- Edit log, 2026-11-15: the renderer was "matched to the Figma 9:16 NFL/CFB frames"; the old background presets were dropped.

**Patterns in what we built:**
- One layout, centred copy, footage as the hook.
- The CTA names the newsletter ("SIGN UP THE HUDDLE").
- A risk-reducing line under the CTA.

**Gaps compared with the market** (to be checked against the board once it's readable):
- No style shows the **product itself**: the email, its sections, a real issue.
- No **comparison** or **social-proof** format.
- No **data-led** card: stat, schedule, ranking.
- No **sequenced** reveal. The copy is one static block, so a viewer must read up to 95 words over moving video.
- Every style assumes a **clip**, which the footage findings make risky for paid ads.

---

## 3. Market scan

### 3.1 What wins for newsletter-signup ads (sources dated)

| Finding | Source (accessed 2026-11-17) |
|---|---|
| About "70% of the winning creative formats right now are ugly ads": text over video (Puck; Morning Brew's Revenue Brew), lo-fi UGC, mock-ups of social posts (Reddit threads, Stories), authentic testimonials. Claimed at an invite-only roundtable, with no data shared **(unverified)** | [Newsletter Growth Memo, "Make your ads uglier"](https://www.newslettergrowthmemo.com/p/make-your-ads-uglier) |
| Newsletter FB/TikTok formats: memes, founder images, **notes-app screenshots**, carousels of top stories, press features, **testimonial screenshots**, authority/social proof. "When you include social proof, be specific" | [SparkLoop: grow your newsletter with FB & TikTok ads](https://sparkloop.app/blog/how-to-grow-your-newsletter-with-fb-and-tiktok-ads) |
| **1440** (free daily email, a "calm, unbiased" position close to ES's 55+ readers): top formats **Us vs Them 25%**, Screen Recording 12%, Static-to-Video Hybrid 8%. Bold type on flat red/black/white blocks; lo-fi text-over-video; CTAs "SIGN UP FOR 1440", "SUBSCRIBE FOR FREE →"; social proof "over 4.5 million Americans". Snapshot "refreshed 5 months ago" (about 2026-06, est.) | [runneth.com/library/1440](https://runneth.com/library/1440) |
| 1440's hooks address "12 core problems", so don't write every ad as if every reader wants the same thing | [beehiiv: 1440 top ads breakdown](https://www.beehiiv.com/resources/1440-top-ads-breakdown) |
| **Morning Brew**: 150 live ads, 67% video. Headlines "Trusted by millions. Actually enjoyed by them too." (110 ads, longest 269 days), "Find out why 2.7 million people read this daily", "Subscribe for Free". CTAs Subscribe / Sign up. Data 2026-11-17 | [AdManage mirror of the Meta Ad Library](https://admanage.ai/ad-library/morning-brew) |
| Morning Brew's early win: an Instagram Stories ad of a fake chat-room conversation, about $0.10 CPA (as reported; old, **unverified**). Its TikTok Spark Ads with creators: about 28% of subscribers engaged | [search summary of beehiiv / casestudies.com](https://www.casestudies.com/company/tiktok-for-business/case-study/gaining-thousands-of-newsletter-subscribers-with-organic-creatives-and-strategic-targeting) |
| Identity-based hooks beat "get smarter" generic pitches (agency claim, **unverified**) | [beehiiv experts: Adsora](https://www.beehiiv.com/experts/adsora) |
| Constant creative testing as the main lever (126k+ subscribers for Nice News, agency claim) | [beehiiv experts: BetterLetter](https://www.beehiiv.com/experts/betterletter) |

**Sports newsletters specifically:**
- I found no public creative data for The Athletic, Front Office Sports, Bleacher Report, The Ringer, Pro Football Network, On3, 247Sports or Huddle Up acquisition ads.
- The Meta Ad Library returned **HTTP 403** to both WebFetch and the browser pane.
- The AdManage and Opus mirror pages for these brands returned 404.
- FOS's own advertising page claims 800k+ newsletter subscribers ([advertising.frontofficesports.com](https://advertising.frontofficesports.com)).
- Huddle Up is sports-business, not NFL ([huddleup.substack.com/about](https://huddleup.substack.com/about)). It is not a creative reference for "The Huddle".
- **To close this gap,** someone logged in should search the Ad Library by hand, filter to video, and screenshot the results into the Growth-ADs board. Suggested searches: "newsletter" + NFL / college football / MLB, and the names of the sports publishers above.

### 3.2 Platform and audience rules that shape the styles

| Rule | Source |
|---|---|
| Design for sound off (Meta research, as reported: sound-off-ready ads performed 4.8× better) **(secondhand)** | [Social Media Today](https://www.socialmediatoday.com/news/Meta-Shares-Key-Video-Ad-Tips/638814/) |
| Hook in the first 3 s; brand early. The 44%/23% figures cited are **unverified** | [Brandwatch](https://www.brandwatch.com/blog/facebook-video-ads-best-practices/), [cinerads 2026](https://www.cinerads.com/blog/meta-ads-video-creative-best-practices) |
| **Reels/Stories ad safe zone (1080×1920):** top about 14% (269 px), **bottom about 35% (672 px)**, up to 40% with disclaimers, sides about 6% (65 px). Ads Manager has a safe-zone overlay. Third-party sources; check against Meta's Ads Guide | [Hopper HQ](https://www.hopperhq.com/blog/instagram-reel-size/), [adkit Meta safe zones](https://adkit.so/tools/safe-zones/meta), [admanage safe-zone checker](https://admanage.ai/instagram-reels-safe-zone) |
| Text-in-image limit gone; heavy text may still reduce delivery (est.). "Flexible format" moved into Advantage+ creative and Flexible Media (2026-03, **unverified**) | [benly 2026 specs](https://benly.ai/learn/ad-creative/meta-ads-creative-specs-2026), [Meta Marketing API: Advantage+ creative](https://developers.facebook.com/documentation/ads-commerce/marketing-api/creative/advantage-creative/get-started) |
| Older readers: WCAG 4.5:1 contrast minimum, and most older people lose contrast sensitivity. Body text 16 px or more on screen (≈ 44 px on our 1080-wide canvas at 390-pt phone width); sources disagree on size | [W3C WAI older users draft](https://www.w3.org/WAI/EO/Drafts/sites-older-users/Overview.html), [Smashing Magazine](https://smashingmagazine.com/2019/11/online-environments-older-users) |
| 1 in 5 adults 50+ decided against a brand over age stereotypes in its ads (AARP figure, cited secondhand) | [inBeat](https://inbeat.agency/blog/advertising-to-seniors) |
| Facebook is still the top social news platform: 38% of adults overall, about 36% of 50–64, about 27% of 65+ (2025-08) | [Pew Research chart](https://www.pewresearch.org/chart/news-consumption-on-social-media-sites-by-age/) |
| Sound-off: 85% of Facebook video watched without sound (old figure, **unverified**). Kinetic text and captions recommended | [DesignRush](https://www.designrush.com/best-designs/video/trends/facebook-video-ad-examples) |
| Native and creator-style creative beats polished brand spots on cold audiences (agency consensus, **unverified**) | [Chatterbuzz 2026](https://www.chatterbuzzmedia.com/blog/ugc-ads-that-convert/), [ManyPixels 2026](https://www.manypixels.co/blog/marketing-design/ad-design-trends-styles) |

**Two findings for our current build:**
1. `SIZES['9x16'].safe.bottom` is **420 px**. The Reels-ad guidance above is about 672 px. In the centred 9:16 stack, the CTA sits around y 1300–1450 (est., depending on copy length). That can fall under Meta's caption and CTA overlay in Reels ad placements.
   - **Recommendation:** new styles use a **content band of y 270–1250** on 9:16.
   - Check one export with the Ads Manager safe-zone overlay before changing the existing styles.
2. "Unsubscribe anytime" is drawn at **24.9 px**, about 9 pt on a 390-pt phone (est.). That is below every 55+ guideline above, and it is a trust line.
   - **Recommendation:** at least 34 px in new styles.

### 3.3 Patterns to borrow (and to avoid)
- **Borrow:**
  - Show the product: a curation list or an email preview.
  - Comparison (Us vs Them).
  - One big fact (a stat).
  - A verified social-proof line.
  - A lo-fi native look.
  - The CTA states "free" plus the newsletter name.
  - Bold type on flat colour blocks.
- **Avoid for ES:**
  - Fake chat or UGC mock-ups that pretend to be real people. This fails the rubric's trust factor and Meta's misleading-content rules.
  - Unverified counts ("Join 1M fans") unless Suhail supplies the verified number.
  - Engagement CTAs ("Comment your pick") that replace the signup action. That triggers the rubric's 7.5 cap.

---

## 4. Style catalogue

### 4.0 Conventions for every new style
- **Fonts:**
  - Acumin Pro Condensed (Black/Bold, plus the `boost` stroke the renderer already uses) for display text;
  - Roboto Medium/Bold for body;
  - Roboto Condensed Bold for labels and eyebrows.
- **Colours:** white, black, navy #252D47, and each brand's `accent` / `highlight` / `wordmark` colours. No purple.
- **Minimum sizes (1080-wide canvas):**
  - display 72 px or more;
  - body 44 px or more (46–50 preferred);
  - labels 38 px or more;
  - the unsubscribe line 34 px or more.
- **Contrast:** 4.5:1 or better against the tint/gradient. Check it with `luminance()`, which already exists.
- **Safe areas:**

  | Size | Content band | Margins | Logo |
  |---|---|---|---|
  | **9:16** | y 270–1250 | sides 62; also keep interactive-looking elements out of the right 120 px below y 1000 (Reels action rail) | stays at `logoTop` 107 |
  | **4:5** | inside top 110 / bottom 90 | side 60 | as today |
  | **1:1** | inside top 90 / bottom 70 | side 56 | as today |

- **Background:**
  - Default is `source: generated` (an animated gradient in brand or team colours) or `image` (a photo with Ken Burns motion; licence permitting).
  - A clip is optional, and only where the footage decision allows it.
- **Motion (shared base):** each op gets `anim: { at, dur, kind: 'fade'|'rise'|'scale'|'wipe'|'strike'|'tick', out? }`.
  - **Frame 0 already shows the hook**: no fade from black. The rating reviewer samples early frames, and Meta's 3-second rule applies.
  - Ease-out 0.25–0.4 s; nothing spins.
  - The CTA is fully visible by 40% of the duration and holds to the last frame, so the loop and the last frame show the full ad.
  - Still duration: the default 8 s (`STILL` 5–15 s).
- **CTA:** the existing white pill with the mail icon and the brand CTA ("SIGN UP THE HUDDLE"), plus an offer line that says **free**.
- **Facts:**
  - Numbers, quotes and headlines must come from the moment, the clip text or the editor's notes. That is the existing `factsText` rule, extended per style below.
  - Social-proof numbers come only from a new `verifiedClaims` per brand, filled in by Suhail.

Rubric weights: headlineOffer 20, cta 20, readability55Plus 15, trust 15, stopScroll 10, audienceFit 10, simplicity 5, placementFit 5. **Total = Σ(score × weight) / 100**, rounded to 1 decimal; then caps apply. All scores below are **(est.)**.

---

### S1. Stat Card ("By the numbers")
- **Idea:** one verified number is the whole hook, for example ".412" or "6 straight". One line says what it counts, then "Get numbers like this in The Huddle, free every morning."
- **When to use it:**
  - The moment or the notes contain a number: a record, a streak, a stat line.
  - Big news days with a crisp fact.
- **Brands:** all three. MLB is especially strong (a stats culture).
- **Layout:**

  | Size | Eyebrow | Number | Label | Offer | CTA |
  |---|---|---|---|---|---|
  | 9:16 | y≈400, Roboto Condensed Bold 40 uppercase, brand highlight colour, tracking 0.06em ("BY THE NUMBERS" or the team name) | Acumin Condensed Black 360 px, fitted to at most 956 px wide, min 220; white; cap top ≈ 470 | Roboto Bold 56, at most 2 lines, y≈880. Then a 6×120 px accent rule | Roboto Medium 49, at most 2 lines | top ≈ 1090; unsub 34 px |
  | 4:5 | (as 9:16) | 300 px | Roboto Bold 50 | (as 9:16) | stack centred at y 675 |
  | 1:1 | dropped when space is tight | 250 px | 1 line | 1 line, 46 | (as 9:16) |

- **Motion:**
  - 0.0 s: the number is visible at its true value, with a scale punch 1.12→1.0 (0.4 s). **No count-up from 0 by default**, so no frame ever shows a wrong number.
  - 0.3 s: the label rises 24 px.
  - 1.2 s: the offer line.
  - 1.6 s: the CTA rises 30 px.
  - Then it holds.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `stat` | 10 chars or fewer, **an exact token from factsText** |
  | `statLabel` | 10 words or fewer; must say what is counted |
  | `offer` | 16 words or fewer; includes "free" |
  | `source` | 6 words or fewer, optional; only if it's in the notes |
  | `cta` | |

- **Prompt change:** "Write the stat style only when a number appears in the facts. Copy it exactly. If there isn't one, return `{"skip":"no number"}`." Validation reuses `numberTokens` and also requires `stat` ∈ facts.
- **Footage:** none.
- **Rubric:**

  | Factor | Score | Why |
  |---|---|---|
  | Headline/offer | 8 | The number hooks; the offer is the 2nd line, so less instant than Today's 3 |
  | CTA | 9 | Existing signup pill plus "free" |
  | 55+ readability | 9.5 | Giant number, few words |
  | Trust | 8 | A real, sourced number; the risk is a stale stat |
  | Stop-scroll | 8.5 | |
  | Audience fit | 9 | |
  | Simplicity | 9 | One focal point |
  | Placement fit | 9 | All inside y 270–1250 |
  | **Total** | **8.7** | **Launch a test** |

- **Effort:** M including the motion base (S on its own). New layout function `layoutStat()` in `video-ads-render.js`, plus a fit-to-width loop for the number.
- **Data:** the number from the moment or notes now; a stats feed later (Phase 3).
- **Risks:**
  - A wrong or outdated stat damages trust. Keep the source line, and never compute derived stats.
  - Team marks in paid ads (see the reels research §3.1).

### S2. Today's 3 (headline briefing)
- **Idea:** "3 things NFL fans need to know today." Three real, short headlines appear one by one. Then "We send this every morning. Free." It shows the newsletter's value: curated, calm, complete.
- **When to use it:** any day with 3 or more live stories for the sport. This is the default when there is no single big moment.
- **Brands:** all three.
- **Layout:**

  | Size | Title | Rows | Offer + CTA |
  |---|---|---|---|
  | 9:16 | Acumin Condensed Black 84, at most 2 lines, y≈320 | 3 rows from y 560 to 1060. Each row: a 72 px brand-accent disc with a white digit (Roboto Condensed Bold 44), then the headline in Roboto Bold 50, at most 2 lines; 44 px between rows | y 1100–1250 |
  | 4:5 | 72 | Roboto Bold 46 | |
  | 1:1 | 64 | each headline 7 words or fewer (1 line); or 2 rows plus "+1 more in the newsletter" | |

- **Motion:**
  - The title is visible at t 0.
  - Rows enter at 0.4 / 1.1 / 1.8 s (fade + rise 20 px, 0.35 s).
  - The CTA at 2.6 s, then holds.
  - Duration 8–10 s.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `title` | 9 words or fewer |
  | `items[3]` | 9 words or fewer each (7 for 1:1); each must restate a story in the Trends `related` titles or the notes |
  | `offer` | 12 words or fewer |
  | `cta` | |

- **Prompt change:** "Rewrite the given stories plainly and calmly. No rumours as facts, no 'Breaking'." The existing BANNED rules apply.
- **Footage:** none.
- **Rubric:**

  | Factor | Score | Why |
  |---|---|---|
  | Headline/offer | 9 | It shows the product |
  | CTA | 9 | |
  | 55+ readability | 8.5 | More words, but each one is short |
  | Trust | 8.5 | Real stories, calm tone |
  | Stop-scroll | 7.5 | No single big visual |
  | Audience fit | 9 | |
  | Simplicity | 7.5 | Three items |
  | Placement fit | 8.5 | |
  | **Total** | **8.6** | |

- **Effort:** S–M. A row layout plus staggered entrances.
- **Data:** Trends already returns `related` titles per moment (`trendInput`). Headlines expire after about 48 h, so stamp ads with a "use by" date (est.).
- **Risks:** stale or unconfirmed stories. Use only Trends items with real pubDates (Trends already enforces this).

### S3. Us vs Them
- **Idea:** "Your feed" vs "The Huddle". The top panel lists what fans put up with (rumours, hot takes, 6 apps); each item is struck through. The bottom panel lists what ES gives; each item is ticked. This is 1440's #1 format ([runneth](https://runneth.com/library/1440)), in the ES voice.
- **When to use it:** evergreen, all season. Good for testing positioning, and for cold audiences.
- **Brands:** all three.
- **Layout:**
  - **All sizes stacked** (not side by side) so the text can stay large on phones.

  | Size | "Them" panel (top) | "Us" panel (bottom) | CTA |
  |---|---|---|---|
  | 9:16 | y 280–740, Slate-grey (#2A2F3A at 80%) card; label "YOUR FEED" in Roboto Condensed Bold 40; 3 items in Roboto Medium 46, with a 6 px brand-accent strike line | y 770–1100, brand-colour card; the brand logo as the label; 3 items in Roboto Bold 48, each with a white tick | y≈1130 |
  | 4:5 | 2 items | 2–3 items | |
  | 1:1 | 2 items, 44 px | 2 items, 44 px | |

- **Motion:**
  - Both labels are visible at t 0.
  - Strikes wipe across at 0.6–1.4 s (staggered).
  - Ticks pop in at 1.6–2.4 s.
  - The CTA at 2.8 s.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `themLabel` | 3 words or fewer |
  | `them[2–3]` | 5 words or fewer each; generic, **never a named outlet or person** |
  | `us[2–3]` | 6 words or fewer each; **must come from `verifiedClaims`** (e.g. "One email every morning", "Free", "Unsubscribe anytime") |
  | `offer` | 10 words or fewer |
  | `cta` | |

- **Prompt change:** add `verifiedClaims` to `contextLines`. "Claims about the newsletter may only restate these."
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 9 |
  | CTA | 9 |
  | 55+ readability | 8.5 |
  | Trust | 8 (comparative framing can feel salesy) |
  | Stop-scroll | 8.5 |
  | Audience fit | 8.5 (less sport-specific) |
  | Simplicity | 8 |
  | Placement fit | 8 (tight at 1:1) |
  | **Total** | **8.6** |

- **Effort:** M. Two cards, plus new `strike` and `tick` ops.
- **Data:** new `verifiedClaims: []` per brand in `video-ads-brands.js`, approved by Suhail.
- **Risks:**
  - Comparative or disparaging claims: keep "Them" generic.
  - Unverified "5-minute read" claims: the rubric prompt already forbids them.

### S4. Quote Card
- **Idea:** a verbatim quote from a coach or player after the game, in big condensed type, with attribution and context. Then "Every word that matters, in The Huddle. Free."
- **When to use it:** pressers, viral soundbites, retirement or record moments.
- **Brands:** all three.
- **Layout (9:16):**
  - A decorative opening quote mark: Acumin Black 260 px in the brand highlight colour, at 35% opacity, y≈330.
  - The quote: Acumin Condensed Bold 76, white, left-aligned, at most 4 lines, from y≈470.
  - Attribution: Roboto Condensed Bold 40 uppercase, "— NAME, AFTER SUNDAY'S WIN".
  - Context/offer: Roboto Medium 46. CTA at about 1120.
  - Optional speaker photo: a 180 px circle, **licensed photo only, never AI-made**.
  - 4:5: quote 68. 1:1: quote 60, at most 3 lines.
- **Motion:**
  - The full quote is visible at t 0.
  - Optional key-phrase highlight sweep (brand highlight box, reusing the Highlight style's box op) at 0.4–1.2 s.
  - Attribution at 0.6 s; CTA at 1.4 s.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `quote` | 22 words or fewer, **must be a verbatim substring of the notes or clip text** (new guard) |
  | `speaker` | |
  | `context` | 8 words or fewer |
  | `offer` | 12 words or fewer |
  | `cta` | |

  If no quote is supplied: skip. The model never writes a quote.
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 7.5 (the quote leads, the offer comes second) |
  | CTA | 9 |
  | 55+ readability | 9 |
  | Trust | 8 (sourced) |
  | Stop-scroll | 8.5 |
  | Audience fit | 9 |
  | Simplicity | 8.5 |
  | Placement fit | 9 |
  | **Total** | **8.5** |

- **Effort:** S.
- **Risks:**
  - Misquotes.
  - **Implied endorsement** in a paid ad (right of publicity; NIL for CFB). Use the "said, after…" framing, never "X reads The Huddle".
  - The photo licence must cover paid use (reels research §3.1).

### S5. Newsletter Preview ("Inside tomorrow's issue")
- **Idea:** show the product. A white email card shows the brand logo and name, a real subject line and 3 real section headlines, and scrolls gently. "This lands in your inbox every morning. Free."
- **When to use it:** evergreen. Strongest for cold audiences who don't know what the newsletter is.
- **Layout (9:16):**
  - Headline: Acumin Condensed Black 80, "What's in your inbox tomorrow", y≈300.
  - Email card:
    - x 80–1000, y 430–1110, radius 24, soft shadow;
    - a "From" row with the logo and name in Roboto Bold 40;
    - subject in Roboto Bold 50;
    - 3 bullets in Roboto Medium 44 (**44 px minimum inside the card**).
  - **No phone or iOS chrome** (no Apple UI marks).
  - CTA at about 1140.
  - 4:5: card y 170–1010. 1:1: subject plus 2 bullets.
- **Motion:**
  - The card is visible at t 0.
  - It translates −60 px over the whole duration (Ken Burns style).
  - The bullets' highlight wipes in at 0.5 / 0.9 / 1.3 s; CTA at 1.6 s.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `headline` | 8 words or fewer |
  | `subject` | 10 words or fewer |
  | `bullets[3]` | 8 words or fewer each |
  | `offer` | 12 words or fewer |
  | `cta` | |

  Subject and bullets come from a **real recent issue**.
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 9 |
  | CTA | 9 |
  | 55+ readability | 8.5 (text inside the card) |
  | Trust | 9 (the real product) |
  | Stop-scroll | 7 |
  | Audience fit | 8.5 |
  | Simplicity | 8 |
  | Placement fit | 8.5 |
  | **Total** | **8.6** |

- **Effort:** M.
- **Data:** the latest issue's subject and section headlines.
  - Source to be decided: paste by hand, or pull from the newsletter platform. A beehiiv connector exists in this workspace, but **I didn't check whether the ES newsletters are on beehiiv (unverified)**.
- **Risks:** a preview that doesn't match the real newsletter is an LP/product mismatch (it can trigger the rubric's 6.5 cap once LPs are inspected).

### S6. Matchday Preview
- **Idea:** a scoreboard plate for this week's big game, for example "Ohio State vs Michigan · SAT 12:00 ET". Then "Get the preview in Saturday's Essentially CFB. Free."
- **When to use it:** midweek before rivalry or playoff games, and for MLB series.
- **Brands:** all three; strongest for CFB.
- **Layout (9:16):**
  - Eyebrow "THIS WEEK" (Roboto Condensed Bold 40).
  - Plate y 460–900: two team blocks in team colours (`video-ads-teams.js` already has team colours), team names in Roboto Condensed Bold 60, "VS" in Acumin 90.
  - Fixed kickoff row: Roboto Bold 50, "SATURDAY · 12:00 PM ET".
  - Offer at 49; CTA at about 1100.
  - Team logos only if counsel clears them for paid ads. **Default: names and colours.**
  - 4:5 and 1:1: the plate shrinks to 80%.
- **Motion:**
  - The plate is visible at t 0.
  - The team blocks slide 40 px inwards (0–0.5 s); the kickoff row flips in at 0.6 s; CTA at 1.4 s.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `home`, `away`, `kickoff` | from data, not the model |
  | `headline` | 8 words or fewer, optional |
  | `offer` | 14 words or fewer |
  | `cta` | |

  **Use the fixed date and time, never "in 2 days"**: an ad that runs for days would turn a relative countdown false.
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 8 |
  | CTA | 9 |
  | 55+ readability | 9 |
  | Trust | 8.5 |
  | Stop-scroll | 8 |
  | Audience fit | 9 |
  | Simplicity | 8.5 |
  | Placement fit | 8.5 |
  | **Total** | **8.6** |

- **Effort:** M.
- **Data:** a schedule (manual entry in Phase 2; a schedule feed later).
- **Risks:**
  - A wrong kickoff time.
  - League or team marks.
  - Ads that run after the game: give it an auto "use by" date.

### S7. Reader Voice (verified testimonial)
- **Idea:** a real reader's words, for example "I read The Huddle with my coffee every morning." — Dave, Ohio, reader since 2024.
- **Why:** testimonials are a top newsletter format ([SparkLoop](https://sparkloop.app/blog/how-to-grow-your-newsletter-with-fb-and-tiktok-ads), [Newsletter Growth Memo](https://www.newslettergrowthmemo.com/p/make-your-ads-uglier)), and peers telling peers suits 55+ readers.
- **Layout:** the Quote Card layout. Quote in Roboto Bold 58 (warmer than condensed), the reader line in Roboto Condensed Bold 40, **no stars and no fake avatars**.
- **Motion:** as Quote Card.
- **Copy shape:**
  - `quote`, `name`, `place` and `since` all come from a consented testimonial record.
  - The model may only trim to 22 words or fewer with an ellipsis, never reword.
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 8 |
  | CTA | 9 |
  | 55+ readability | 9 |
  | Trust | 9 (only if real) |
  | Stop-scroll | 7.5 |
  | Audience fit | 9 |
  | Simplicity | 8.5 |
  | Placement fit | 9 |
  | **Total** | **8.6** |

- **Effort:** S render, plus a small testimonials store.
- **Blocked on:** collecting real quotes with written permission.
- **Risks:** an invented testimonial would be deceptive, so **never generate one**.

### S8. Top 3 Countdown
- **Idea:** "#3 … #2 … #1": a ranking, Heisman race or storyline list. Each item gets a full-frame card, then the offer card. People stay for #1.
- **Layout:**
  - Persistent top strip below the logo: "THE HUDDLE · FREE DAILY NFL EMAIL" in Roboto Condensed Bold 38. This keeps the offer clear all the way through and avoids the rubric's "unclear offer" 7.0 cap.
  - Rank numeral: Acumin Black 300.
  - Item: Roboto Bold 56, at most 2 lines.
  - The last card is the standard offer and CTA.
- **Motion:** each card for 2.2 s with a hard cut and a scale punch; offer card at about 7 s; total 10–12 s.
- **Copy shape:**

  | Field | Limit |
  |---|---|
  | `title` | 8 words or fewer |
  | `items[3]` | 8 words or fewer each, from facts |
  | `offer` | |
  | `cta` | |

- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 7.5 |
  | CTA | 8.5 (it arrives late) |
  | 55+ readability | 8.5 |
  | Trust | 8 |
  | Stop-scroll | 8 |
  | Audience fit | 9 |
  | Simplicity | 7 |
  | Placement fit | 8.5 |
  | **Total** | **8.2** (Revise first) |

  The rating reviewer samples a few frames, so the CTA must also show on the strip, as a small pill, from 0 s.
- **Effort:** M (scene sequencing).
- **Risks:** rankings presented as fact. Label them "ES power ranking" or "our list".

### S9. Fan Note (lo-fi)
- **Idea:** a lo-fi "note" in the brand's voice: "Things I stopped doing since I get ES Dugout: 1. Checking 5 apps for the lineup…"
- **Why:** the "ugly", native-looking format the newsletter sources report as winning.
- **Layout:**
  - A warm off-white paper card (#FFF9EC) taking most of the frame;
  - a generic "Notes" header (not iOS UI);
  - items in Roboto Medium 50, black;
  - a hand-drawn-style underline in the brand accent colour;
  - signed "— the ES Dugout team" (**not a fake fan**);
  - the CTA under the card.
- **Motion:** lines "type" in at 0.3–2.0 s; CTA at 2.4 s.
- **Copy shape:** `title` 8 words or fewer; `items[3–4]` 8 words or fewer each; `offer`; `cta`.
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 8 |
  | CTA | 8.5 |
  | 55+ readability | 8 |
  | Trust | 7 (lo-fi reads less "brand") |
  | Stop-scroll | 8.5 |
  | Audience fit | 8.5 |
  | Simplicity | 8 |
  | Placement fit | 8.5 |
  | **Total** | **8.1** |

- **Effort:** S.
- **Risks:** looking like a fake personal post. The sign-off fixes this.

### S10. This or That
- **Idea:** two teams or two choices, split in team colours, "Who you got?". Then "Get our pick in tomorrow's Huddle. Free."
- **Layout:**
  - Two stacked halves (y 280–700 and 720–1100) in team colours, each with the team name in Acumin 96;
  - a "VS" disc in the middle;
  - the offer and CTA at about 1130.
- **Motion:** the halves slide in from opposite sides (0–0.4 s), the VS pops at 0.5 s, the CTA at 1.2 s.
- **Copy shape:** `question` 6 words or fewer; `a`, `b` (from data); `offer`; `cta`.
  - **The CTA stays signup.** A "Comment your pick" CTA would be `articleClickMismatch`/`missing` → capped at 7.5.
- **Footage:** none.
- **Rubric:**

  | Factor | Score |
  |---|---|
  | Headline/offer | 7 |
  | CTA | 8 |
  | 55+ readability | 8.5 |
  | Trust | 8 |
  | Stop-scroll | 9 |
  | Audience fit | 9 |
  | Simplicity | 7.5 |
  | Placement fit | 8 |
  | **Total** | **8.1** |

- **Effort:** M.
- **Risks:**
  - Player likeness.
  - Any betting overtone. No odds or lines, and no FanDuel/DraftKings-style visuals beyond layout ideas.

### Also considered (not ranked)
- **Broadcast lower-third (est. 8.1, S):** a TV-style name bar over a clip or photo. It's familiar to 55+ viewers, but the bottom-third position collides with the Reels UI. Better as a variant of Condensed than as its own style.
- **Kinetic type:** a word-by-word reveal. Ship it as a **motion preset for every style**, including the existing 3, not as a style of its own.
- **"Join N fans" badge:** a component any style can show, **only** when `verifiedClaims` has the number.
- **UGC talking head:** needs real people on camera, so it's out of scope for a canvas renderer. Revisit with ES talent (reels research, v3).

---

## 5. How styles should be chosen

### 5.1 Ask AI recommends a style per brief
1. **Eligibility (deterministic, no model call).** Build a list of facts from the brief:

   | Fact in the brief | Unlocks |
   |---|---|
   | `hasNumber` (from `numberTokens(factsText)`) | Stat Card |
   | `hasQuote` (a quoted string in the notes or clip text) | Quote Card |
   | `relatedCount ≥ 3` | Today's 3 |
   | `hasMatchup` | Matchday Preview |
   | a fresh `latestIssue` | Newsletter Preview |
   | `verifiedClaims ≥ 2` | Us vs Them |
   | a consented testimonial | Reader Voice |
   | `hasClip` + the footage policy allows paid use | the existing clip styles |

2. **Ranking.** Score each eligible style:
   - the rubric prior (§4 estimates, replaced by real `_ad-rating` means once there are any);
   - plus the learned style score for this brand (§5.3);
   - plus a small bonus for styles not exported in the last 7 days for this brand (variety; est. weight).
3. **Output.**
   - 1 recommended style + 2 alternatives, each with a 1-line "why" (e.g. "There's a verified number (.412), and Stat Card has the most exports for ES Dugout").
   - The copy call then asks for 3 angles in the chosen style (`wantStyle`). That path already exists.

### 5.2 A/B "variant grid" export
- On the Export step: "Make a test set". Pick 2–3 styles × 1–2 angles × sizes (default: 3 styles × 1 angle × 9:16 and 4:5 = 6 files).
- **File names carry the test keys:** `{brand}_{style}_{angle#}_{size}_{yyyymmdd}_{grid4}`, for example `huddle_stat_a1_9x16_20261118_k3f2`. Put the same name in the Meta ad name, so results can be joined back later with no tooling.
- Log one `export` event per file with `{ style, gridId, angle, size }`, plus a `grid_created` event.
- Optionally run `_ad-rating` on each variant and show the scores side by side. The pack's rule applies: a gap of 0.3 or less is a "near-tie; A/B test" (`compareCreativeScores`).

### 5.3 How the learning loop learns which styles win
Today `_ad-learning.js` gives few-shot examples (the last 5 exports for the brand) and up to 6 rules (from check failures and consistent edits). It has no notion of style performance. Proposed, in order of signal quality:

| Signal | Where from | Weight (est.) |
|---|---|---|
| **Real Meta results** (cost per completed signup, link CTR, LP CVR) | Imported later as a CSV from Ads Manager, joined on the ad name from §5.2 | Highest; it overrides the others once n ≥ 2,000 impressions per variant (est. threshold) |
| **Rating engine score** (`frameup_ad_ratings`, rubric v1.0.0) | `_ad-rating.js` on the exported frames | Medium; the prior |
| **Exports** of a style per brand (chosen and finished) | `export` events (`payload.style` is already logged) | Low–medium |
| **Edit distance** after `copy_applied` (heavy rewrites suggest a poor style or copy fit) | `copy_edited` before/after | Low |
| **Abandons** (style picked, no export) | a new `style_selected` event | Low |

- **Method:** a per-brand Beta/Thompson-sampling style score.
  - Rating-engine means set the prior; export/edit signals nudge it; imported Meta CAC dominates once it exists.
  - Keep it explainable in the UI ("Stat Card: 4 exports, avg rating 8.6, no Meta data yet").
  - **Never show a predicted CTR or CAC** (pack rule).
- **Lessons per style:** `lessonsFor` should filter `examples` by the requested style, so a Stat Card prompt sees past Stat Cards. `deriveRules` should add style-specific rules, for example "Stat Card headlines over 10 words were always trimmed".
- **The rating prompt must learn the new styles.** `_ad-rating.js` `SYSTEM_PROMPT` currently says the ad is "a trending sports clip … under a dark scrim" with "styles: simple, condensed … highlight". It needs a per-style description and the no-footage backgrounds. Otherwise the reviewer will mark the new styles down as "missing clip".
- **Storage:**
  - No new table is needed for events: the `payload` jsonb already holds `style`.
  - Add `gridId` and `angle`.
  - Meta results need one new table later, `frameup_video_ad_results`: ad_name, date range, impressions, link clicks, LP views, signups, spend. Keep it separate from the ratings, as the pack's brief §8 requires.

---

## 6. Rollout plan

### Phase 1: about 1 week (est.), 4 styles plus the motion base
| Day | Work |
|---|---|
| 1–2 | **Motion base:** `anim` on ops; `drawOps(ctx, ops, logo, t)`; `drawFrame` passes `t` (the clip time or `StillClip.currentTime`); export already draws every frame. A per-size content-band option (`bandBottom` 1250 on 9:16). Unsub ≥ 34 px in new styles. |
| 2–3 | **Stat Card** + **Quote Card** (shared single-focus layout). |
| 3–4 | **Today's 3** + **Us vs Them** (rows, strike and tick ops). `verifiedClaims` in the brands file. |
| 5 | Copy server: per-style schemas, prompt lines, guards (stat ∈ facts, quote ⊂ facts, items from related, claims from `verifiedClaims`), `skip` handling. Ask AI eligibility + recommendation. Style picker art for 7 styles. Rating prompt updated. Tests. |

**Files to touch:**
- `video-ads-brands.js`: `STYLES` gains `{ fields, needsFootage:false, sizes }` per style; `verifiedClaims`; `contentBand`.
- `video-ads-render.js`: the `anim` timeline, `layoutStat`, `layoutQuote`, `layoutList`, `layoutVersus`, the `strike` and `tick` ops.
- `video-ads.js`, `video-ads.html`, `video-ads.css`:
  - the style picker;
  - per-style field editors (the Copy step);
  - the recommended-style chip;
  - `t` passed into the draw call;
  - events with `style` everywhere.
- `netlify/functions/video-ads.js`:
  - `STYLES`, `COPY_SYSTEM` style lines;
  - `checkVariant` and `autoFix` per style;
  - `contextLines` + `verifiedClaims`;
  - the recommendation endpoint (no model call).
- `netlify/functions/_ad-learning.js`: `style_selected` in `EVENT_TYPES`; style-filtered examples.
- `netlify/functions/_ad-rating.js`: the SYSTEM_PROMPT style/background description. **The weights, caps and `RUBRIC_VERSION` stay as they are.**
- Tests: `scripts/test-video-ads-render.mjs`, `test-video-ads.mjs`, `test-ad-learning.mjs`, `test-ad-rating.mjs`.
- `tours/updates.json` (What's new). Cache keys bumped site-wide.

**Acceptance criteria (Phase 1):**
- [ ] Each new style renders at 9:16, 4:5 and 1:1 with all copy inside the content band. On 9:16 the CTA bottom is at y ≤ 1250, checked by test across short and long copy.
- [ ] Every text op is 44 px or more except labels (38 or more) and the unsubscribe line (34 or more). No font outside Acumin / Roboto / Roboto Condensed; no purple; contrast 4.5:1 or better against the default tint (test with `luminance`).
- [ ] Frame 0 shows the hook element fully; the CTA is fully visible by 40% of the duration and on the last frame.
- [ ] Stat Card refuses (skip) when there is no number in the facts; a stat not in the facts fails the check. Quote Card refuses an invented quote. Us vs Them "us" items come only from `verifiedClaims`.
- [ ] All styles export with an animated-gradient or photo background (no clip) on Chrome and Safari; the MP4/WebM path is unchanged.
- [ ] `_ad-rating` on one export of each new style returns valid JSON with no "missing clip" weakness. Record the scores in the edit log; target 8.5 or more (est.).
- [ ] Ask AI shows 1 recommended style + 2 alternatives with a reason; with no number and no quote, Stat and Quote are not offered.
- [ ] Events carry `style` (and `gridId` when there is one); `lessonsFor` returns style-matched examples.
- [ ] The existing 3 styles render pixel-identical when `anim` is absent (regression test).

### Phase 2: weeks 2–3 (est.)
- Newsletter Preview, Matchday Preview, Reader Voice.
- The variant-grid export with the naming convention.
- `style_selected` and `grid_created` events.
- Data inputs: the latest-issue source, a manual schedule form, and a consented testimonials list.
- Acceptance: a grid export of 3 styles × 2 sizes in one click; file names parse back to style/angle/size; schedule ads carry a "use by" date.

### Phase 3: weeks 4–6 (est.)
- Top 3 Countdown, Fan Note, This or That.
- The kinetic-type preset for all styles.
- The Meta results CSV import + `frameup_video_ad_results`, and the Thompson-sampling style score in Ask AI.
- Optional stats/schedule feeds.
- Acceptance: the imported CSV joins on ad name with 95% or more matched rows (est.); style scores shown with their n and inputs; no forecasted CTR/CAC anywhere.

### Decisions needed from Suhail
1. **Figma access:** give the connected Figma account edit access to Growth-ADs (or export the frames as PNGs), so the board can be compared against this plan.
2. **Phase 1 picks:** Stat Card, Today's 3, Us vs Them, Quote Card. Agree, or swap one?
3. **Verified claims per newsletter:** subscriber count (if any), send cadence and time, "free", "unsubscribe anytime", read time. Only these can appear in Us vs Them or a social-proof badge.
4. **Footage policy for paid ads** (carried over from the reels research §3.3): should no-footage styles become the default for paid exports?
5. **Photos, names and quotes of athletes in paid ads,** and whether the ES image licence covers paid social video. Until that's answered, the default is no faces.
6. **9:16 bottom safe zone:** move all styles to the 35% (y 1250) band after one Ads Manager overlay check?
7. **Newsletter Preview source:** paste by hand, or connect the newsletter platform?
8. **Reader testimonials:** who collects them, with written consent?
9. **Results import:** OK to adopt the ad-name convention in Meta now, so CAC per style can be joined later?

---

## 7. Sources (all accessed 2026-11-17)
- Figma MCP access rules: https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/
- Newsletter Growth Memo, "Make your ads uglier": https://www.newslettergrowthmemo.com/p/make-your-ads-uglier
- SparkLoop, newsletter FB/TikTok ads: https://sparkloop.app/blog/how-to-grow-your-newsletter-with-fb-and-tiktok-ads
- 1440 ad library summary (Runneth/Motion; refreshed about 5 months before access): https://runneth.com/library/1440
- beehiiv, 1440 top ads breakdown: https://www.beehiiv.com/resources/1440-top-ads-breakdown
- AdManage, Morning Brew (Meta Ad Library mirror, data 2026-11-17): https://admanage.ai/ad-library/morning-brew
- beehiiv experts, Adsora: https://www.beehiiv.com/experts/adsora · BetterLetter: https://www.beehiiv.com/experts/betterletter
- Morning Brew TikTok case study: https://www.casestudies.com/company/tiktok-for-business/case-study/gaining-thousands-of-newsletter-subscribers-with-organic-creatives-and-strategic-targeting
- Front Office Sports advertising page: https://advertising.frontofficesports.com
- Huddle Up about page: https://huddleup.substack.com/about
- Social Media Today, Meta video ad tips: https://www.socialmediatoday.com/news/Meta-Shares-Key-Video-Ad-Tips/638814/
- Brandwatch, Facebook video ad best practices: https://www.brandwatch.com/blog/facebook-video-ads-best-practices/
- Cinerads, Meta creative best practices 2026: https://www.cinerads.com/blog/meta-ads-video-creative-best-practices
- Hopper HQ, Reel size and safe zones 2026: https://www.hopperhq.com/blog/instagram-reel-size/
- adkit, Meta safe zones: https://adkit.so/tools/safe-zones/meta
- AdManage, Reels safe-zone checker: https://admanage.ai/instagram-reels-safe-zone
- benly, Meta creative specs 2026: https://benly.ai/learn/ad-creative/meta-ads-creative-specs-2026
- Meta Marketing API, Advantage+ creative: https://developers.facebook.com/documentation/ads-commerce/marketing-api/creative/advantage-creative/get-started
- W3C WAI, older users (draft): https://www.w3.org/WAI/EO/Drafts/sites-older-users/Overview.html
- Smashing Magazine, older users: https://smashingmagazine.com/2019/11/online-environments-older-users
- inBeat, advertising to seniors: https://inbeat.agency/blog/advertising-to-seniors
- Pew, news on social media by age (2025-08): https://www.pewresearch.org/chart/news-consumption-on-social-media-sites-by-age/
- DesignRush, Facebook video ad examples: https://www.designrush.com/best-designs/video/trends/facebook-video-ad-examples
- Chatterbuzz, UGC ads 2026: https://www.chatterbuzzmedia.com/blog/ugc-ads-that-convert/
- ManyPixels, ad design trends 2026: https://www.manypixels.co/blog/marketing-design/ad-design-trends-styles
- Internal: `frameup-ad-rating-engine.zip` (README, scoring.ts, AI_REVIEW_PROMPT.md, FRAMEUP_CODEX_BRIEF.md), `netlify/functions/_ad-rating.js`, `_ad-learning.js`, `video-ads.js` (server), `video-ads-render.js`, `video-ads-brands.js`, `project-docs/ai-reels-research.md` §1–3.
- Not reachable: Meta Ad Library (HTTP 403 to WebFetch and the browser pane); AdManage/Opus mirror pages for The Athletic, FOS and 1440 (404).
