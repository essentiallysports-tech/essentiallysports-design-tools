# Player Stat Line and Team Record / Score (Social Media templates)

Two 4:5 (1080 x 1350) Social Media post types, added 2026-11-18. Data models live in
`social-stat-templates.js` (`window.ESStatTemplates`, UMD, tested by
`scripts/test-stat-templates.mjs`). Drawing, controls and wiring are in `index.html`
(search for `player-stat-line` / `team-record`).

| Dropdown value | Label | Draw function | State key | Fields container |
| --- | --- | --- | --- | --- |
| `player-stat-line` | Player Stat Line | `drawPlayerStatLinePost` | `state.playerStatLineData` | `#player-stat-line-fields` |
| `team-record` | Team Record / Score | `drawTeamRecordPost` | `state.teamRecordData` | `#team-record-fields` |

The photo is the editor's main background image (`state.photo`, with the usual move and zoom
image tools). Fonts: Acumin Pro Condensed Bold (`Acumin Pro Condensed Local`) for names, numbers
and labels, Acumin Pro Condensed Regular (`Acumin Pro Condensed Web`) for the opponent line and
the Team Record subline. The ES logo mark and the ESSENTIALLYSPORTS wordmark follow the brand-logo
switch (ES / Golf / W) like every other Social template.

## Player Stat Line state (`state.playerStatLineData`)

```js
{
  schemaVersion: 1,
  firstName: 'LUKA',          // <= 18 chars, stored upper case
  lastName: 'DONCIC',         // <= 24 chars
  opponent: 'V/S THE SUNS',   // <= 32 chars; the whole line, prefix included
  statCount: 7,               // 1-7: how many of the 7 slots are shown
  stats: [                    // always 7 slots: { id, value (<= 7 chars), label (<= 18 chars, upper case) }
    { id: 'stat-1', value: '36', label: 'MINUTES PLAYED' },
    ...
  ],
  logo: {                     // see "Logos" below
    mode: 'auto' | 'library' | 'upload' | 'none',
    src: '', id: '', name: '', colors: [],
  },
  boxColor: '',               // '' = team colour; '#RRGGBB' = override
  textColor: '',              // '' = team colour; '#RRGGBB' = override
  numberColor: '#F2E8D5',     // the cream of the reference numbers
}
```

Layout: the first visible stat sits alone on its row, then rows of three
(`ESStatTemplates.playerStatLine.statRows`). Rows are anchored to the bottom (the last label ends
132 px above the bottom edge), so fewer stats leave more photo above them. Slots past `statCount`,
and slots with neither value nor label, are skipped.

Label colours: `resolveLabelColors(data, teamPair)`. Overrides win; otherwise the logo's team
colours (`FrameUpLogos.teamColors`: box = secondary, text = primary, falling back to black or white
text when the pair is under 3:1), else the colour card's Sport + Team palette.

### Prefilling from game data (for `feature/sports-calendar`)

Build the object and normalise it; never write partial objects:

```js
state.postType = 'player-stat-line';               // or set the dropdown and dispatch 'change'
state.playerStatLineData = ESStatTemplates.playerStatLine.normalizeData({
  firstName: 'Luka', lastName: 'Doncic', opponent: 'V/S THE SUNS',
  statCount: 7,
  stats: [{ value: '36', label: 'MIN' }, { value: '43', label: 'PTS' } /* ... */],
  logo: { mode: 'auto' },                           // or a library pick, below
});
syncStatTemplateControls('player-stat-line');
render();
```

To pin a team logo: `const e = FrameUpLogos.findTeam('Los Angeles Lakers', 'nba');` then
`logo: { mode: 'library', src: FrameUpLogos.srcFor(e), id: e.id, name: e.short, colors: e.colors }`.
Numbers must come from the game data; the sample values only exist as placeholders.

## Team Record / Score state (`state.teamRecordData`)

```js
{
  schemaVersion: 1,
  record: '10-0',            // <= 12 chars (record or score, e.g. '31-28')
  subline: '',               // optional, <= 40 chars, e.g. 'UNDEFEATED SEASON'
  logo: { mode: 'auto', ... },
  ringColor: '',             // badge outline; '' = the team's primary colour
  recordColor: '#FFFFFF',
}
```

With a subline the badge and record move up 34 px and the subline sits above the wordmark.

## Logos

`logo.mode`:
- `auto` (default): the logo of the colour card's Sport + Team, looked up in the logo library
  (`FrameUpLogos.findTeam(state.team, state.sport)`).
- `library`: a pick from the logo library (`src` is `assets/logos/...` or an ESPN CDN URL).
- `upload`: the person's own file (a data URL; also kept in their "My uploads" list).
- `none`: no tile (Player Stat Line) or no badge (Team Record).

Allowed `src` values are checked by `ESStatTemplates.isLogoSource`. Export waits for the logo to
load (`isStatTemplateLogoLoading`, checked through `isBrandLogoLoading`).

## Not in Generate (yet)

Generate (AI Studio) does not produce these two post types. Adding them cleanly touches the AI
schema and prompts, so it was left out of this change. Steps when it is wanted:
1. `netlify/functions/es-generate.js`: add both types to the spec schema (`fields` for each) and to
   the type summaries.
2. `netlify/functions/_creative-director.js`: add to `POST_TYPES`, `STATS_TYPES`, and a fit rule
   (a player plus 3-7 numbers; a team plus a record or score).
3. `netlify/functions/_lint-spec.js`: field lists and length limits (the `LIMITS` above).
4. `netlify/functions/_generate-examples.js`: names, families and an example each.
5. `generate.html`: a format card each (around the Head-to-Head card) and the summary line.
6. `frameup-spec.js`: add to `SUPPORTED` and an `applyLines` case that builds the objects above.
7. Re-run `scripts/test-es-generate*.mjs`, `test-lint-spec.mjs`, `test-generate-examples.mjs`.
