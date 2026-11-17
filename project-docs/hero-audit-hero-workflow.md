# Hero audit: team workflow (Home, Gallery, Dashboard, Requests, sidebar, tours)

Branch `feature/hero-workflow`, based on `6cde4b7`. Walked through as an ES designer on a game day and as an admin, with every API and Supabase call stubbed (headless Chrome on `file://`). Findings are ranked by user impact. ✅ = fixed on this branch, ⏳ = left for later.

## 1. Friction, dead ends and confusing states (highest impact first)

1. ✅ **Home is a launcher, not a start.** You see the hero carousel, local "Jump back in" and four workspace cards. Your open requests, drafts saved to your account, what the team just exported and today's trends each live on a different page. **Fix:** a "Today" block with quick actions (Generate, Video Ads, Reels Studio, Request a design) and four cards: Trending now (pick a sport, remembered), My requests, Team exports and My drafts.
2. ✅ **Requests: the next action is buried.** A designer has to read the status, open the Status select, pick the next value, then press Save. Requesters can't tell whether anything is expected of them. **Fix:** a "Next step" bar above the details (claim / choose a designer / start / attach / send for review / mark done / ask for a change), driven by `L.nextStep()`. It only offers moves the rules allow. A "Your move" badge marks those requests in the list.
3. ✅ **Dashboard: numbers but no "so what".** Overdue and unassigned requests, pending access, bug reports and error spikes sit in five separate panels further down the page. **Fix:** a "Needs attention" strip at the top of Overview. Each item counts real rows and links to the view that fixes it; when nothing needs action it says "Nothing urgent".
4. ✅ **Gallery: no way to narrow by person or posted state, and filters vanish on reload.** Search matched any single substring, so "masters scheffler" found nothing. **Fix:**
   - every-word search;
   - a Created-by select and Posted / Not posted yet chips;
   - filters kept in the URL, so a view is shareable;
   - a Clear filters button;
   - `/` to focus search and Esc to clear it.
5. ✅ **Gallery: no way to reuse a good post.** **Fix:** "Make another like this" in the viewer. It opens Generate with a brief built only from the post's own fields (title, template, team, sport) and `autorun=0`, so there is no AI cost until the user presses Generate.
6. ✅ **Gallery "no results" was a dead end.** It suggested "Create a post" when filters hid everything. **Fix:** "Clear filters" instead, and "Load more" when there are unloaded pages.
7. ✅ **Sidebar NEW tags never expire.** Generate and Gallery (shipped 22 Oct) still said New. My requests (shipped 17 Nov) had no tag. **Fix:** each item has an `added` date and the tag shows for 14 days.
8. ✅ **Requests go stale in a background tab.** **Fix:** the list refreshes when you come back after 60 s or more, unless you are typing.
9. ✅ **Requests: arrow keys did nothing in the list.** **Fix:** Up and Down now move through it.
10. ✅ **Requests: "due soon" looked the same as "due next week".** **Fix:** a "Due soon" label within 24 hours.
11. ✅ **Admin who filed a request saw "With Kim" on it while it was in review,** not "check it". **Fix:** staff see their own requests from the requester's side while in review.
12. ✅ **Tours were out of date.** They didn't mention Reels Studio, My requests, Today or Needs attention. **Fix:** updated the welcome tour (still within the 90-character step limit) and added a release note.

## 2. Performance and duplicate calls

1. ✅ **Presence heartbeat ran about 4 times in the first 6 s of every page view.** At boot, pageshow, focus, es:auth-ready and the 1.8 s timer each fired a profile upsert, a presence upsert and a pending flush. Measured on Gallery: **8 writes before, 2 after.** Now one beat runs at a time, a beat within 10 s of a successful one is skipped, and route or sign-in changes still force one.
2. ✅ **Dashboard live sync (every 30 s) also upserted presence and flushed,** duplicating the 20 s heartbeat. Tab switches re-fetched the roughly 1 MB task list even right after a sync. **Fix:** `refreshCloudDashboardData({ presence: false })` and a 10 s minimum gap.
3. ✅ **Today panel loads after first paint** (`requestIdleCallback`) and only while Home is on screen. Each source has a session cache of 2–10 min, so going to an editor and back costs no requests.
4. ⏳ The dashboard still re-reads the full task list every 30 s. Fetching only rows newer than `updated_at` would cut most of that traffic. This needs a merge path in `dashboard-data.js` and is worth its own change.
5. ⏳ `tours/updates.json` is fetched with `cache: 'no-cache'` on every page. It is a 304 each time and cheap, but still a request.

## 3. Design-system consistency

- ✅ New UI uses only tokens, `.es-btn`, `.es-chip`, `.es-select`, `.es-badge`, `.es-tile` and `.es-skeleton`, in Roboto / Roboto Condensed only. It has no purple and works in dark mode.
- ✅ One animated primary per view on Requests: the Next-step action is primary and "Save changes" became secondary.
- ✅ Every new list has its own loading (skeleton), empty (says what will appear and the first step) and error state (with Try again).
- ⏳ "Jump back in" (es-ui.css) and "Choose a workspace" are 8 px apart in width at 1280. This is older than this branch.
- ⏳ Gallery and dashboard dark mode still use some hard-coded hex values (`#1f1f1f`, `#151515`) instead of slate tokens. These are older than this branch.

## 4. AI cost

There is no new AI call on this branch. Every "Design this" and "Make another like this" link passes `autorun=0`, so Generate waits for a click; it was **$0 per run before and is still $0 after**. Trends on Home read the free, server-cached `GET /api/trend-design` (no enrichment).

## 5. Accessibility

Today, Next step and Needs attention:
- each use a real `button` or `a`;
- show state as colour plus an icon plus words;
- use `aria-live` / `aria-busy` on lists that load;
- keep the keyboard focus outline.

Scrolling respects reduced motion, and the gallery `/` shortcut is announced with `aria-keyshortcuts`.
