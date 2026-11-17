# Hero audit: Generate (2026-11-19, branch feature/hero-generate)

Scope: `generate.html` (Generate view), `netlify/functions/es-generate.js` and its helpers
(`_creative-director.js`, `_lint-spec.js`, `_onbrand.js`, `_generate-examples.js`,
`_direction-memory.js`), `es-guidelines.js`, `frameup-spec.js`.
Method: a code walk-through of a game-day job ("box score in, carousel out"), the existing tests, and the
server paths with mocked network. The live browser pass could not run (see "Not verified").

## Findings, ranked by user impact

| # | Finding | Impact | Status |
| --- | --- | --- | --- |
| 1 | The two new templates (Player Stat Line, Team Record) exist in the editor but Generate cannot make them; a box score lands in Player Stats (3 numbers) and the rest is thrown away. | High | Fixed |
| 2 | A number can move to the wrong label ("30 PTS 9 AST" written as 9 PTS): the checker only asks whether each number appears somewhere. | High (trust) | Fixed: stat-pair check |
| 3 | No ES photo = an empty grey slot on Cover / Quote / Player Stats, and the only way out is the editor. The photo panel has no search. | High | Fixed: team graphic + ES photo search |
| 4 | No way to post the results as a carousel: each design opens or downloads one at a time (5 designs = 5 trips to the editor). | High | Fixed: Open as carousel, Download all (.zip) |
| 5 | "I like this idea but as a stats card" needs a full new run (new brief, new directions). | Medium | Fixed: Same idea, new template |
| 6 | Live trends in the empty state only fill the brief; a second click is needed, and the brief loses the team. Quick chips show no trends unless ES MCP has a trending tool. | Medium | Fixed: one-click trend, labelled brief, trend chips |
| 7 | Keyboard: no shortcut to the brief, directions need Tab + Space each, Make needs Tab to reach. | Medium | Fixed: `/`, `1`–`4`, Ctrl/⌘ + Enter |
| 8 | Cost: "Try again", "More like this" and every re-run repeat the photo-pick vision call and the ES MCP image search for the same person. | Low–medium (cost, latency) | Fixed: 30 min pick cache, 15 min image-search cache |
| 9 | Bring it on-brand maps a final score or a long stat line to a Cover / Player Stats. | Low | Fixed: maps to Team Record / Player Stat Line |
| 10 | Directions are not streamed; the first design still waits for the whole run (research + writer + review). | Medium | Not done: needs a streaming adapter on Vercel; noted for the owner |
| 11 | Card previews paint one at a time in a single hidden editor frame. | Low | Unchanged (the frame is serial by design) |

## Output quality notes
- Prompt: added rules and a gold example for the new templates (labels kept with their numbers, opponent only when stated, records copied exactly).
- Checker: spelled-out labels (POINTS, MINUTES PLAYED) map to codes; a record or score must be in the brief or research; a number paired with a different label in the brief is an error (repaired once, else dropped).
- Guideline gate: both templates are ES templates; stats-style cards without a team get the "pick the team" note.

## Not verified
- The browser pass (light/dark, 1440/1280/1024/375, screenshots). The preview tooling refused to start the
  `br-hero-generate` server (5-server limit reached by other branches' servers) and a manual server was blocked.
  Logic is covered by `scripts/test-generate-hero.mjs`; the UI needs a visual check before merge.
