# Hero audit: Video Ads (2026-11-18)

Walked through `video-ads.html` as an ES designer on a game day ("I need 3 ads for The Huddle today"),
locally at 1280 / 375, light and dark, with a stubbed sign-in and stubbed `/api/*`. Ranked by user impact.

## Main job, measured before
"3 ads for The Huddle, 3 sizes each" (9 MP4s) with today's page:

| Step | Clicks |
| --- | --- |
| Pick The Huddle | 1 |
| Ask AI → Write 3 options → Use option 1 | 3 |
| Next: Clip → (tab) → Find clips → Use clip (or Animate) | 3–4 |
| Next: Export → tick 4:5 + 1:1 → tick rights → Export | 5 |
| Back to Copy → Ask AI → Use option 2 → Export step → Export | 5 |
| Same again for option 3 | 5 |
| **Total** | **≈ 22–23 clicks, 3 real-time recording passes** (3 × the ad length, e.g. 3 × 8 s = 24 s of recording plus waits) |

The page remembered nothing between sessions: brand, sizes, style, tint and safe-zone choice reset every visit.

## Findings (highest impact first)

### P0: the main job is slow
1. **No way to make a daily set.** Three angles × three sizes means three trips through all three steps and three
   exports. The "Export 3 styles" test set varies the *style*, not the *angle*, so it doesn't answer "3 ads today".
2. **Nothing is remembered per brand.** Every visit starts on Essentially CFB, 9:16 only, Highlight, black tint.
   A Huddle editor re-picks brand, sizes and style each time.
3. **The suggestion pushes placeholder claims.** With no clip yet, the suggestion card says "Suggested: Us vs Them"
   for every brand, and Us vs Them runs on claims the owner has not approved (`claimsApproved: false`). The
   classic styles lose 0.4 for "no clip", so the unapproved style wins by default. Trust risk.

### P1: quality and trust
4. **No pre-export check.** `/api/ad-rating` (rubric in `_ad-rating.js`: offer clarity, CTA, 55+ readability, trust…)
   and its browser helper `video-ads-rating.js` exist but the page never calls them. Editors export blind.
5. **Copy prompt doesn't target the rubric.** `COPY_SYSTEM` says "warm, punchy" but nothing about 55+ readability
   (short words, short sentences), trust (no clickbait questions, no superlatives without a source) or the offer
   (a free *newsletter*, what you get, unsubscribe anytime). Option cards show no signal of which option is clearest.
6. **Copy options look alike.** "Write 3 options" without a style asks for one simple, one condensed, one highlight,
   so the three differ by layout more than by angle.
7. **Meta preview is one approximation.** 9:16 always shows as a Reel; there is no Story view (progress bars,
   no action rail, CTA sticker) and no Feed view of a 9:16 (Meta crops it to 4:5, hiding the top and bottom).
   4:5 / 1:1 can't be checked in Stories/Reels (Meta letterboxes them on a blurred fill).
8. **Us vs Them claims are hard-coded.** Only a code change can edit or approve them; no admin path.

### P2: clip step
9. **Clip results can't be previewed.** The only way to see a clip is to download it into the ad ("Use clip"),
   which takes seconds and replaces the current clip.
10. **No hint about clip length vs the ad.** A 90 s clip and a 6 s clip look the same; the duration badge is small
    and there is no "fits a 6–15 s ad" signal.
11. Best result isn't called out (results are ranked best first, but nothing says so).

### P2: export
12. **Real-time only, one pass per copy.** A daily set means three passes. All targets of one copy already record
    in one pass; different copies could too.
13. **The rights box shows before there is any clip**, and the disabled Export button doesn't say why.
14. No estimate of how long the export takes ("Records in real time" only).

### P3: polish, accessibility, cost
15. Grammar check runs on the `light` tier (`openai/gpt-oss-20b`), not Haiku; the brief asks for Haiku only.
16. The chat system prompt embeds the per-ad context, so it can never be cached; `COPY_SYSTEM` (~515 tokens) is
    sent uncached on every copy call. Room to make the static part ≥ 1,024 chars and mark it cacheable.
17. The copy endpoint recomputes identical requests (same brief, same style) at full cost; no response cache.
18. Steps rail sub-labels are good; the Export step has no "what's left" summary for a set of files.
19. `aria-live` on the whole Ask AI output can over-announce; acceptable, left as is.

### Cost per run, before
- Write 3 options: 1 Haiku call (sometimes 2 with a retry), ≈ $0.0009–$0.0018.
- Grammar: 1 gpt-oss-20b call, ≈ $0.0001 (10-min cache).
- Rating: never called from the page.
- Daily set of 3 ads: 1–3 copy calls depending on how often the editor regenerates.
