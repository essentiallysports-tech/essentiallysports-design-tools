# FrameUp: instructions for Claude

## Mandatory UI Quality Assurance

After every task that changes the frontend UI, run a visual QA pass before marking the task complete.
Use the frontend-visual-qa skill and browser automation to inspect the actual rendered website.

### Required checks

1. Check horizontal and vertical overflow.
2. Detect clipped text, images, buttons, and containers.
3. Check spacing, padding, margins, and alignment consistency.
4. Verify typography hierarchy and text wrapping.
5. Check visual consistency of icons, buttons, cards, colors, and border radii.
6. Check responsive layouts at 375px, 768px, 1024px, and 1440px.
7. Detect overlapping elements, broken navigation, and misplaced components.
8. Check hover, focus, loading, and empty states where relevant.
9. Check accessibility basics, including contrast and touch target sizes.
10. Inspect screenshots visually rather than relying only on code analysis.

### Fix and recheck

- Automatically fix clear UI defects introduced by the current task.
- Re-render the affected pages after fixes.
- Repeat until no known critical or major layout defects remain.
- Do not redesign unrelated sections or change intended styling.
- Do not deploy or push changes without permission.

### Completion requirements

Do not declare a frontend task complete until visual QA has run successfully.
Provide a short report containing:

- Viewports tested
- Issues discovered
- Issues fixed
- Remaining issues, if any
- Screenshots or test evidence

### How to run it in this setup

- "frontend-visual-qa" is not installed as a skill here. Use the installed `design-review` skill (`/design-review`) with the built-in browser tools (`mcp__Claude_Browser__*`): open the page on the local server (http://localhost:8937 skips login; http://localhost:8934 is the normal preview), resize to 375 / 768 / 1024 / 1440, screenshot, and read the page structure.
- The browser pane may be hidden, which pauses CSS animations and transitions. Before screenshots or style checks, inject `*{animation:none!important;transition:none!important}`, or pages are measured mid-fade.
- Check light and dark mode (`FrameUpTheme.apply('dark')`).
- Keep screenshots in `.claude/shots/` (git-excluded).
