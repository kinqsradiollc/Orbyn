# UI and UX

Read the [UI skill](../../skills/orbyn-ui-design/SKILL.md) for layout and interaction,
and the [content skill](../../skills/orbyn-content-design/SKILL.md) for visible copy.
Use existing shared components and tokens; inspect the current screen before
adding an override. Preserve drafts, selection, focus, permissions and run states.

Orbyn's palette, type scale, controls, composer and navigation choices live in the
consumer-owned [design profile](design-profile.md). Shared skill updates preserve
that profile; current source and the requested task determine implementation.

## Product conventions

- Keep one clear action per outcome. Remove duplicate controls, competing toolbars
  and explanations of obvious actions. Put rare management actions in the existing
  overflow menu. Icon-only controls need accessible names and keyboard focus.
- Use the current accent, neutral surfaces, text roles and spacing tokens. Do not
  introduce a new palette or shrink text to hide layout problems. Filled/bordered
  controls need padding and consistent heights; mobile touch targets remain usable.
- Respond to the actual pane width. Preserve user-selected sidebar widths; opening
  another pane must not reset them. Align pane/tab headers and avoid duplicate
  gutters. Keep primary work usable with a compact navigation rail and secondary
  panels. Hover labels also need keyboard and touch alternatives.
- Reuse one Library layout inside and outside documents. Keep source and preview
  together where requested and retain synchronization/error location semantics.
  Selection menus appear after selection settles, not while dragging.
- Keep settings compact, statuses factual and error recovery close to the action.
  Separate connected external agents from Background/Overnight work. Do not put
  implementation details in routine product flows.

For a full redesign, assess every screen family and shared surface: layout,
style, spacing, positions, copy, states and interactions. Keep a coverage ledger;
shared token changes alone do not establish that every layout has been reviewed.

## Scoped visual evidence

When visual verification is authorized, preview shared web/desktop UI in the web
app and mobile UI through Expo web. Record the actual URL, source revision,
viewport, zoom, theme and checked states; browser evidence does not establish
native integration behavior. Do not require native builds unless in scope.

Inspect changed flows and concrete risks, not a matrix of unchanged screens.
Independent inspection is optional unless requested; choose the session/subagent
arrangement from [coordination](coordination.md). Builds and DOM dimensions alone
do not establish usable visuals. Keep failed/blocked states and evidence limits.
A blocked browser origin is not permission to retry through another transport.
