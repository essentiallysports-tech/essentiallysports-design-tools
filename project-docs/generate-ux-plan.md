# Generate page: stop the guessing (UX plan, 2026-11-17)

Scope: the default Generate view of `generate.html` (`#ais-view-generate`). Trends, Video Ads and the server are out of scope.

## 1. What the generator actually does (audit)

- **Request:** `POST /api/es-generate { brief, formats: [], count: 4 }` (`netlify/functions/es-generate.js`, `generate()`).
  - `formats` is optional. **Empty means the AI picks the templates** (`buildPrompt` lists every template, and `wantsPhoto` is true). So "Auto" needs no server change.
  - With one or more formats, only those templates are offered. A format the facts can't support returns fewer designs, or none.
  - At most 4 designs. Every design comes back with `postType`, `label`, `why` and `alts`; the card already shows `label`.
- **Brief:**
  - Words in quotes, headlines and numbers in the brief are used verbatim.
  - An instruction ("a stats post on…") is written from ES research only.
  - Quotes must be said by the main person. Stats need real stat labels (PTS, YDS, TD, HR…, `FrameUpRules.STAT_LABELS`).
  - A pasted top-N list becomes one Rankings Table or Ranked List.
- **Teams:** the team in the brief wins. Otherwise the team comes from the newest ES coverage, and the colours from the brand kit (`brand-kit.js`, 163 teams).
- **Photos:** Cover, Quote, Long Quote and Player Stats take an ES photo of the main person; the others have no photo.
- **Real ES template art for every format** is already in `assets/template-thumbs/instagram-*.webp` (360×450, 7–27 KB each).
- `frameup_generate_examples` / `_generate-examples.js` holds past team designs for the prompt, as text only, so it has no images to reuse.

## 2. Where people guess today

1. **What do I type?** The box is empty, and the placeholder ("A quote, a stat line or a headline…") reads like three separate options.
2. **Which format?** The eight chips are names only. "Long Quote" vs "Quote", or "Rankings Table" vs "Ranked List", means nothing without seeing them.
3. **Do I have to pick a format?** Nothing says no selection = AI picks. The chips look required.
4. **Will my format work?** Picking Player Stats with no numbers silently returns fewer designs, or "No designs this time".
5. **What will I get?** No count, no preview and no "you can edit these" anywhere before the first run.
6. **Starter prompts** don't say what they produce. They are cut off at about 40 characters, so they look like noise.
7. **The empty state** is a big box that says nothing ("Your designs appear here"). The only way forward is a small link.
8. **Errors** say what went wrong but give no one-click way forward.

## 3. Improvements, ranked by impact

| # | Change | Why it matters | Status |
|---|--------|----------------|--------|
| 1 | **Visual format cards**: the real ES template thumbnail plus its name, as a radiogroup. One caption line under the row describes the selected (or hovered) card. | You see what each format makes, with no paragraphs. | Done |
| 2 | **Auto first and selected by default**: the AI picks (`formats: []`). Each result card already names its format. | The default needs no decision. | Done |
| 3 | **Fit hints**: a dot on the cards that suit what you typed. When the chosen format lacks what it needs, the caption says so ("Works best with a quote in your brief"). | Avoids empty runs. Answers "which format fits?". | Done |
| 4 | **Guided brief**: a two-line placeholder with a real example, and live "ingredient" pills under the box (Who · Quote · Stats, plus List when found). Each pill turns solid with a check and the detected value (team, with the league logo when one exists). | Shows what a good brief has and what was understood. It is cheap and client-side: regex plus `brand-kit.js`, lazy-loaded on first input. | Done |
| 5 | **Expectation line** by the Generate button: "Up to 4 designs · edit any in the editor". | Sets the outcome before the click. | Done |
| 6 | **Starter prompts that show their output**: each one carries a small format tag (Quote + stats, Player stats, Ranked list, Cover hooks), and the four cover different formats. | Turns the examples into a lesson. | Done |
| 7 | **Empty state = live trends**: "Live now", with 3 trend chips (league logo + headline) that fill the brief, and "All trends". Falls back to the plain link when the trends API is down. | Replaces the dead box with something to click. | Done |
| 8 | **Errors with a next step**: a failed run shows "Try again". "No designs" with a chosen format offers "Use Auto". | No dead ends. | Done |
| 9 | Progress steps already exist (Reading ES coverage → Writing → Designing, plus a timer). | Kept as is. | Kept |

**Evaluated and dropped:**
- **A "how it works" 3-icon row.** The format thumbnails plus the expectation line already say it, and Suhail dislikes explainer text.
- **Sample outputs in the empty state.** These would repeat the format thumbnails.
- **"About 10 s" in the expectation line.** There is no measured timing data; the live timer in the progress row is honest instead.

## 4. Deferred

- **Multi-select formats** (the old chips allowed several). The radiogroup makes it one format or Auto. Auto covers the "mix" case, and a single format gives 4 takes on it. Re-add a mix only if editors ask.
- **Player-name detection** beyond a capitalised-name heuristic. There is no client-side player list; the server's ES tag lookup is the real source.
- **Server-side "detected format" echo** (why Auto picked X). Each card's `why` already carries one sentence. Showing it more prominently needs a design pass on the result cards.
- **Measuring real run times**, so a time can go in the expectation line.
