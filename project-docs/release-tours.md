# Release tours: what to do on each push

FrameUp shows people what changed after every update, with no hand-built tour.
One file, `tours/updates.json`, feeds both the **What's new** panel (sidebar →
Help → What's new) and the **What's new tour** (a toast on the next page load:
"Show me" walks through the change on the real page).

## On every push (about two minutes)

1. Draft the note from your commits:

   ```sh
   node scripts/add-release-note.mjs                 # commits since the last note
   node scripts/add-release-note.mjs --title "Gallery filters"
   node scripts/add-release-note.mjs --dry-run       # print only
   ```

   It adds an entry at the top of `tours/updates.json` with `"draft": true`.
   Commit subjects shaped `Area: change` are grouped into one item per area,
   and a page is guessed from the area (Generate → `generate.html`, …).
2. Edit the entry: one short title, one line of text per item, plain words.
   Delete housekeeping items.
3. Optional, but it's what makes the tour point at things: give an item a
   `target` (CSS selector of the new control) and its `page`. Use stable ids or
   `data-*` attributes. Without a target the step is a centred card.
4. Delete `"draft": true`, commit `tours/updates.json` with the change, push.

That's all. On their next page load, everyone who hasn't seen that entry gets
the toast; "Show me" runs the generated tour; the panel shows the note with a
"Show me" button.

If nobody writes a note, the deploy is still noticed: `/api/version` reports
the live commit, and people see a one-line "FrameUp was updated: <commit
subject>" card (once per deploy) linking to What's new. Write commit subjects
people can read.

## Entry format

```json
{
  "id": "2026-11-20-gallery-filters",
  "date": "2026-11-20",
  "title": "Gallery filters",
  "commit": "abc1234",
  "items": [
    { "title": "Filter by workspace", "text": "Show only Social, YouTube or Newsletter.",
      "page": "gallery.html", "target": "#gallery-filter" }
  ],
  "templates": [["newsletter", "ig-new-template"]]
}
```

- Newest first. `id` starts with the date and never changes once pushed
  (it's how "seen" is remembered).
- `route` (optional): a hash on that page, e.g. `"#instagram"` for the editor.
- `templates` (optional): `[workspace, dropdown value]` pairs tagged "New" in
  the editor's template dropdowns and picker for 30 days.
- `commit`: HEAD when the note was written; the CLI reads commits after it.
- `draft: true` entries are ignored by the app.

## Who sees what

Nothing starts on its own; people are always asked, and every step has
"Skip tour", a close button and Esc.

- **New to FrameUp** (per person, keyed by a hash of the signed-in email, or
  the device): a small "Welcome to FrameUp" choice: **Take the tour** /
  **Not now**, plus **Don't show again**. "Not now" asks once more on a later
  day, then stops. Notes up to that day count as seen.
- **Already using FrameUp** (this browser has FrameUp data from before): a
  quiet corner card, once, with the same three choices. Their next visit gets
  the What's new toast for the newest note.
- **Later visits**: the toast for the newest unseen note, if it's under 30
  days old. "Show me" or "Not now" both mark it seen.
- **Any time**: **Tours** in the profile menu opens a picker with every tour
  (Welcome, Generate, Trends, Video Ads, Editor, latest What's new); a tour
  for another page opens that page and starts there. Also the "?" on
  Generate / Trends / Video Ads / the editor, the Tours button in What's new,
  and "Tours" in ⌘K search.
- Pages inside frames (Generate renders designs in a hidden editor iframe)
  never offer, toast or resume a tour.
- Testing: `FrameUpTours.reset()` in the console forgets your tour history;
  `FrameUpTours.openPicker()` / `FrameUpTours.startWelcome()` replay.

## Files

| File | What |
| --- | --- |
| `frameup-tour.js` / `.css` | The engine: spotlight, card, keyboard, multi-page resume. Step fields are documented at the top of the JS. |
| `tours/tours.js` | Welcome, Generate, Trends, Video Ads and Editor tours, as data. |
| `tours/updates.json` | Release notes (this workflow). |
| `tours/updates.js` | Manifest comparison, the generated tour, the toast, the deploy check. |
| `tours/tour-launcher.js` | When tours open, and the menu / "?" / search entry points. |
| `api/version.js`, `netlify/functions/version.js` | `{ sha, message, deployedAt }` for signed-in users. |
| `scripts/add-release-note.mjs` | The CLI above. |
| `scripts/test-tour.mjs` | Tests. |

## Adding or changing a page tour

Edit `tours/tours.js`. Keep each step to a title and one line. Point at stable
selectors; a missing target is skipped, so a renamed class silently drops a
step: check the tour after UI changes (`FrameUpTour.start('generate')`).
New pages also need the five include lines after `app-shell.js` (see any page).
