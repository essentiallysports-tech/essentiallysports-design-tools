# Hero audit: Home "Today" (branch feature/home-today, 2026-11-19)

Owner's screenshot + the same page with stubbed data (1440/1280/1024/375, light/dark).
Ranked by user impact.

1. **Dead space, broken grid.** Requests are paused (`FEATURES.requests=false`), which hides the
   4th quick action and the "My requests" card. The 2-column grid then leaves an empty 4th slot,
   a void under Team exports and an empty column beside My drafts.
2. **No "what should I make" answer.** Trends are a list of four truncated rows with one generic
   "Design this" link. No heat, no age, no Reel / Video ad hand-off, no pick of the day.
3. **Truncated titles.** One-line ellipsis cut most trend headlines mid-name.
4. **Wrong sport.** "Notre Dame Basketball" filed under College Football: the server classifier
   scored the school name (cfb, weight 4) and never saw "basketball" (not a rule word).
5. **Drafts are half the story.** Only account drafts (no thumbnails); "Jump back in" (designs on
   this browser) is a separate section further down; Reels Studio projects are not shown at all.
6. **Team exports are mute.** Six bare thumbnails, no title / who / when, nothing about how the team
   is doing this week.
7. **Weak hierarchy.** Greeting is a time-of-day word only ("WORKING LATE"); the subtitle is a
   static description; every card has the same weight.
8. **Small things.** Tool tiles don't say what you were doing in them; skeletons are the same
   two bars everywhere; "Request a design" empty state still links to a paused page.

Cost: Home makes no AI calls (unchanged). Trends come from the free cached feed.

## What changed (see ai-edit-log 2026-11-19 "Home Today mission control")
- Start here spotlight (Trends' own ranking), 3 hand-offs; Create launchers with continue hints;
  Trending rows with sport, Hot/Rising, age, reach, 2-line titles, Post / Reel / Ad;
  Continue across tools (merges "Jump back in"); Team exports with captions; Team this week.
- Layout by container queries: 2 columns ≥ 860px of its own width, a balanced 2-up middle row
  600-859px, one column below. No holes when requests are off.
- Classifier: college name + another sport word → Others (score ≥ 6 so the CFB search hint can't
  pull it back). Test cases added.
