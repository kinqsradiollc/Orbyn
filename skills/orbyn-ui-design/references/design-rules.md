# Portable UI design rules

These are implementation and review rules, not a claim that the current app
already meets them. Standards and research behind them are in [research](research.md).

## Project style and accessibility

Resolve the consuming project's design guide through its optional
[context map](../../orbyn-setup/references/project-context.md), then inspect its
shared tokens and controls. Keep palette, typography, density, motion, navigation
and branded patterns in that guide. Example values from another product are not
defaults for this one. These rules describe interaction and evidence boundaries.

- Use the project's text roles and font scaling. Prefer flexible heights and
  wrapping; change the layout when text grows instead of shrinking it to fit.
- Use weight, spacing and placement to establish hierarchy. Preserve readable
  contrast in supported themes and visible keyboard focus. A chosen type scale
  is not proof of accessibility compliance.
- Retain semantic status and user-selected colors. Keep selection, expansion,
  hover and focus visually distinct under the project's theme.
- Apply the product's motion policy and reduced-motion behavior. Preserve useful
  progress and state feedback; added animation needs a task purpose.
- Reuse shared field and button tokens. Check platform text-input behavior at
  the actual font size; do not change every body label to solve an input issue.

## Layout, panels, and overlays

- Check density as well as fit. At the agreed narrow task width, navigation
  and section chrome must leave useful room for the setting being changed. Fitting an oversized control is not sufficient acceptance.
- Use compact single-line section headers and existing control heights. Reduce
  redundant card wrappers, accumulated gaps, and decorative padding before
  reducing readable text or touch targets. Never scale the entire desktop layout
  into a narrow window. Enlarged text may legitimately require taller rows.
- When adding size containment, inspect descendant dialogs and fixed overlays.
  Keep viewport overlays outside contained layout roots or use pane measurement;
  verify the open dialog after navigation and panel changes.
- Measure the main pane after navigation and secondary panels consume space.
  Breakpoints must work with sidebars expanded, collapsed, and open together.
- If panes cannot fit, turn secondary navigation into a drawer or switch between
  panes. Do not leave a thin sliver of the active task behind multiple sidebars.
- In flex/grid layouts, allow content to shrink with `min-width: 0` and use
  `minmax(0, 1fr)` where appropriate. Wrap actions or stack them on narrow views.
  Long labels, URLs, and model names must not set the width of the whole page.
- Keep ordinary content within the pane. Confine necessary two-dimensional
  scrolling to code, tables, boards, calendars, or diagrams with meaningful axes;
  their surrounding toolbar, labels, and prose still reflow.
- Keep the consuming product's settings route, modal or sheet conventions. Preserve
  unsaved-change guards, deep links, and return-to-previous-screen behavior.
- Bound dialogs/dropdowns to the visible viewport; content scrolls within a
  bounded region. Keep header, Close, and necessary actions reachable at short
  heights, under safe-area insets, and with the keyboard open.
- One active overlay controls focus. Nested pickers close before the parent;
  background controls must not intercept input. Web dialogs need an accessible
  name, contained focus, dismissal, and focus return to a sensible opener.
  If that opener becomes hidden or is removed, use a visible logical return target.
  Recheck both Close and Escape when navigation is closing or the viewport changes;
  a target visible during a transition may become hidden immediately after focus.
- Preserve visible keyboard focus without drawing two competing borders around
  the same search field. A sticky header, footer, or composer must not obscure
  the focused control. Test the actual focus ring instead of removing outlines.
- Reuse theme/radius tokens and the project's shared fields, buttons, menus and
  platform controls. Avoid local palette literals and unrelated CSS overrides.
  Check final styles with shared CSS loaded; a local rule can lose to a later
  generic rule. Source-only checks must not substitute for computed styles/pixels.
- Keep adequate pointer/touch targets without inflating text or entire cards.
  Use the project's platform target standard. Reserve the target in layout,
  with a smaller visual mark inside when appropriate. Use hit expansion only where surrounding
  space prevents collisions; compact chips and adjacent actions must remain
  separately reachable.

## Content and actions

- A document editor starts with a writing surface. Do not put repeated Edit,
  Comment and assistant action rows under every paragraph. Use contextual block
  tools, replace rendered text in place while editing, and keep source optional.
  Review the default note's reading rhythm and actual typing flow; consistent
  button dimensions alone do not qualify a document layout.

- Put the task, current state, and main action first. Use a brief helper only
  where it changes the person's decision; reveal advanced details on demand.
- Default to a clear label and, only when needed, one short helper sentence.
  Do not put product tutorials or repeated paragraphs on task/settings cards.
  Put optional setup, developer, and background explanation behind a named
  disclosure or help link; keep material consent and consequences visible.
- Empty states say what is missing and offer the relevant action. Avoid slogans,
  greeting essays, large decorative cards, and repeating the same explanation.
- Remove duplicate buttons for the same action in one context. Rare management
  actions belong in the existing more menu. Keep frequent actions discoverable.
- Button labels describe outcomes: Connect ChatGPT, Refresh usage, Review changes.
  Keep error copy specific, actionable, and free of raw server/provider secrets.
- Loading, empty, disabled, offline, error, and success are distinct states.
  Preserve drafts/selections on retries; avoid layout jumps and fake progress.

## AI interactions

- Represent the implementation's actual states and work ownership. Conversation,
  durable jobs and background agents may have separate lifecycles; idle is not
  evidence of continuous work. Keep outputs and last activity attributable.
- Label suggestions and provide a source/context reason when known. Keep edit,
  dismiss and review available. Never fabricate personalized explanations,
  citations, confidence numbers, capabilities or completed work.
- Separate a suggestion, approval and applied change. Bind approval to the
  current request/version and preserve authority, cancellation and recovery.
- Show supported connection/provider states and material consent at the decision
  point. A pending connection must not appear successful. Disclose recipients
  and fallback where they affect the user's choice.
- Treat unavailable usage as unknown, not zero. Observed tokens are not billing
  or entitlement. Put technical detail in a disclosure unless needed to decide.

## Acceptance for a changed feature

Select representative states for the agreed risk, not every axis automatically.
User exclusions and [project instructions and scope](../../orbyn-workflow/references/project-policy.md#scope-and-evidence) take precedence. This
is a menu of checks, not a new requirement for native builds, enlarged text or repeated visual sweeps:

When visual checks are authorized, select the cases relevant to the changed flow.
This is a reference menu, not a mandatory sweep. Native checks require explicit
scope; keep unperformed cases unverified.

| Axis          | Candidate checks                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Width/height  | Web 320/390/768/1280; mobile browser 320/390; short window and landscape where relevant                                  |
| Containers    | Expanded/collapsed main nav, secondary panel, nested picker/dialog, actual pane width                                    |
| Density/UX    | Useful task space at 320×740; concise copy; clear first action; complete, cancel, recover and return without losing work |
| Appearance    | Light/Dark at normal settings; enlarged text/zoom only when in scope                                                     |
| Content       | Empty/populated, long/localized labels, large catalogs, selected/manual values                                           |
| Network/state | Loading, offline/error, retry, success, disabled, stale/revoked where relevant                                           |
| Interaction   | Pointer, Tab/Shift+Tab, Escape, focus return, scroll-to-last-item, keyboard visible                                      |
| Platforms     | Browser checks; installed desktop/iOS/Android only when requested; native gaps stay explicit                             |

At 320 CSS px, ordinary horizontal prose must not need horizontal scrolling;
if an accessibility resizing audit is requested, include its agreed zoom/text
settings and record any distinct behavior. Do not silently restore excluded checks.
Check increased text spacing and accessible names/roles as appropriate. Screenshots
establish visible containment only; interaction and accessibility need their own
checks. This matrix does not replace a full accessibility audit.

An authorized visual report should record source ref, URL, viewport, theme,
state/actions, image path or inline capture ID, inspected outcome, severity,
reproduction, and unverified scope. Separate confirmed defects from capture/DPR
errors. Acceptance requires the changed flow to remain readable, reachable, and
free of unintended clipping/overlap, with supported feature parity preserved.
Record excessive chrome, repeated explanations, and unnecessary steps as UX
defects even when all boxes fit. Resize through intermediate widths and near
breakpoints; passing a few fixed screenshots does not prove every size works.

## Conversation workspace

Follow the project's composer placement and growth policy. Keep attachment and
action controls reachable while the transcript and long input scroll. Preserve
independent drafts, selections and history across panes; keyboard commands belong
to the focused pane or its active dialog. On narrow widths, switch panes without
losing work. Connection rows should expose relevant identity, status and consent.

## Working pane ownership

Keep content lifetime separate from visible placement. Hidden working panes
retain their drafts but yield focus and global shortcuts. Remember a connected,
visible last-focused child for each pane; restore it on explicit pane switching,
with a safe container fallback. Global chrome and temporary dialogs need explicit
command ownership. Repeated search focuses its existing surface without clearing
query or selection. Adapt tool groups to actual pane width, using container rules
before adding measurement-driven priority collapse.

## Selection and search recovery

Keep chosen object IDs separate from their visible names and resolve them against
current data. A typed ambiguous name requires an explicit choice; never select
the first object silently. Show useful space/project context where names repeat.
An explicit Personal choice must remain personal even if a team has that name.
Clear choices when the typed filter no longer matches. Read failures need Retry
and must not look like an empty result. Bind results to the current query and
retain that query when opening a result fails. Validate search length visibly
rather than searching a silently shortened prefix. Deferred menu actions belong
to their opening/account and execute at most once; cancel timers on teardown.

### Action styling coverage

Give new actions the appropriate shared primary, secondary, text or icon control
style. Bare buttons still receive the global themed fallback at zero specificity;
feature selectors may override it. Audit nested block actions, menu items,
recovery buttons and source toolbars as well as the main page toolbar. A class
name or source inventory is not rendered acceptance: inspect the affected actions
in both themes and at the narrow task width in the agreed visual batch.

Apply the project's action sizes and text roles consistently across button
variants, including segmented controls and recovery actions. Let long labels
wrap and preserve separate hit areas. Check density and readable content as well
as color before calling an action group consistent.

### Document workspaces

Keep the document toolbar visible while source and result scroll independently.
Collapse secondary libraries before reducing the writing area. A source/result
split belongs to the document viewport, with a keyboard-operable divider; on a
phone use explicit Source and Preview views. Do not embed the main editor inside
a code block or make a full PDF page the default typing preview. Assess readable
content, hierarchy, and space to work in the rendered product; functional controls
and containment alone do not establish a successful design.
