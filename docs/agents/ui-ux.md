# UI and UX rules

## UI and UX Conventions

- **Design skill:** read `skills/orbyn-ui-design/SKILL.md` for UI/UX changes.
  Its rules cover task flows, concise copy, compact layout, recovery and acceptance.
- **Content skill:** read `skills/orbyn-content-design/SKILL.md` when writing or
  arranging product copy. Routine screens show the task, current state and action;
  optional explanations go behind named help. Remove repeated headings, marketing
  filler and technical QA wording. Keep essential consent/consequences visible
  and preserve user-authored content. Shorten copy before shrinking its text.
- **Compact and readable:** use shared text roles; reserve display headings for deliberate
  hero content. Keep user text scaling enabled and reflow layouts instead of shrinking text.
- **No unintended overlap:** adapt to the remaining pane width, wrap or stack controls,
  and collapse secondary panels before they obscure the main task. Verify open overlays,
  short heights, long labels, both themes and enlarged text in the changed flow.
- **Brief copy, usable space:** use a label and only a necessary short helper.
  Put optional explanations behind disclosure; keep consent/consequences visible.
  Review density and task completion at narrow sizes, not just whether boxes fit.

- **Colours:** never change the palette. Use theme tokens (`var(--color-*)` on web, `colors.*` on mobile); no colour literals in new code.
- **Corners:** web uses the radius scale in `desktop/src/styles/global.css` — `--radius-xs` (4, bars and marks), `--radius-sm` (8, controls), `--radius-md` (12, cards and panels), `--radius-lg` (16, dialogs), `--radius-pill`. Mobile uses `radii.input` / `radii.card` / `radii.pill` (and `radii.check` for checkboxes). No raw pixel radii.
- **Controls are ours, not the browser's:** `Select` (`components/Select.tsx`) instead of `<select>`, `DateField` (`components/DateField.tsx`) instead of `<input type="date|time|datetime-local">`. Bare fields, checkboxes and radios are styled at zero specificity in `global.css`; a switch is a checkbox with `role="switch"` and `className="ai-switch"`. Mobile switches set `trackColor={{ true: colors.accent }}`.
- **Managing things lives behind ⋯:** rename, delete, leave and similar rare actions go in a menu beside the title (`MoreMenu` on mobile, a bottom action sheet; small toolbar icons on web), never as a row of buttons over the content.
- **Mobile type is light, like the web:** `fonts.semibold` renders at 500 and `fonts.bold` at 600; controls are drawn at 34pt and reach 44pt through `hitSlop`. Selected chips are a soft accent tint, not a solid fill.
- **Spacing:** anything with a border or fill has inner padding — nothing touches its box's edge. Siblings that repeat (chips, pickers, rows) share one height and line up.
- **Room to work:** the web sidebar collapses to an icon rail (⌘\\, remembered per browser); the Docs library can be hidden for a full-width page. On mobile, tapping the tab you're on scrolls to the top and refreshes.
- **Verify material UI changes with targeted preview checks** on affected web
  (5174) and mobile web (8083) surfaces, following the on-demand cadence above.
  Unchanged screens and purely functional/API changes need no visual rerun.
