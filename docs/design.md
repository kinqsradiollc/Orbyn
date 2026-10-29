# Orbyn product design

These conventions define design intent, not proof that every surface conforms.
Use current components and source tokens alongside the engineering workspace
guidance in [CONTRIBUTING](../CONTRIBUTING.md).

## Tokens and appearance

The current owners are `packages/core/src/theme/presentation.ts`,
`desktop/src/styles/global.css` and `mobile/src/theme/index.ts`. Inspect current
source before changing them. Keep neutral light/dark surfaces and the restrained
blue accent; preserve semantic statuses and user-selected calendar/tag colors.

| Text role | Base size | Use                                                  |
| --------- | --------- | ---------------------------------------------------- |
| Caption   | 11        | Brief metadata; essential instructions use body text |
| Small     | 13        | Secondary labels and compact chrome                  |
| Body      | 15        | Content, rows and descriptions                       |
| Title     | 18        | Section titles and ordinary mobile work screens      |
| Heading   | 24        | Deliberate page/document headings                    |
| Display   | 36        | Marketing hero or deliberate summary number          |

Web fields use `--control-fs` and height tokens; phone/coarse field text uses its
16px role to avoid iOS focus zoom. Native uses `typeScale` and `fonts.*` with
system font scaling. Do not shrink text or cap scaling to hide overflow.

Web actions use `--button-h`, `--button-fs` and `--button-line-h`:
36px/13px/20px on desktop and 44px/15px/20px on phone/coarse pointers. Native
`controls.tap` is 44pt. Keep visual marks inside usable, noncolliding targets.
Reuse shared `Select`, `DateField`, buttons and menus; avoid local literal styles.

Routine content appears immediately. Remove ornamental stagger, hover lift and
press shrink while retaining meaningful progress and state feedback. Disclosure
headings stay neutral on hover; expansion, selection and focus remain distinct.

## Product surfaces

- Settings stays a compact modal on web/desktop and follows existing native
  sheet/navigation conventions. Prefer grouped rows and separators to nested
  raised cards; preserve unsaved guards, deep links and return paths. At 320×740,
  the chrome must leave useful space for the setting being changed.
- Center the empty Chat/Work composer in its remaining pane, then dock it at the
  bottom once conversation begins. Both start compact and grow to roughly four
  text lines before internal scrolling. Keep attachments, model and send controls
  outside that scroll region; respect enlarged text and short windows.
- Work chooses a project in its conversation workspace. Preserve saved history,
  project visibility, pinning and existing sweep/pinned exemptions. Paired panes
  retain independent drafts and scroll state. Switch panes at narrow widths.
- Reuse the Library layout inside and outside documents. Document source/result
  views keep independent scrolling, a visible toolbar and a keyboard-operable
  divider; phones use Source and Preview views. Preserve settled selection menus
  and source/error-location semantics. The main editor remains a writing surface.
- Keep connected external agents distinct from Background/Overnight work.
  Assistant is the conversational workspace; character configuration belongs to
  Background/Overnight and must not block ordinary chat. These workers retain
  separate identities, runs, activity and outputs, with factual state labels.
- Connect ChatGPT exposes actual pending, success and error states. Distinguish
  personal ChatGPT, workspace/BYO providers, embeddings and MCP; do not imply
  unsupported hosted OAuth or infer billing/entitlement from token observations.

These choices include the owner's four-line composer preference. Historical
reference inspections informed them but do not establish rendered or native
acceptance. Record checks of changed flows under [verification](verification.md).

## Interaction conventions

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
Follow the outer workspace for review coordination. Builds and DOM dimensions alone
do not establish usable visuals. Keep failed/blocked states and evidence limits.
A blocked browser origin is not permission to retry through another transport.

## Planner workspace layout

The `refactor/ui-ux-polish` candidate keeps the established palette and type roles.
Home gives the daily agenda and active work the main column, with upcoming work
and planning in a quieter secondary column. Phones use one sequence. Summary
metrics are compact; agenda entries use separators rather than nested cards.
Optional hubs follow daily work while retaining saved order and visibility.

Task lists omit empty progress bars and duplicate effort estimates. Board columns
keep readable widths with local scrolling. Project portfolios use aligned grids
on wide screens and separated rows on phones. Document collections retain distinct
selection, open, filing and favorite actions; folder and duplicate-tag labels
identify personal/team scope. Compact Study metrics stay paired.

New desktop sessions start in the established icon rail, preserving remembered
widths. Phone task checkboxes and create controls retain 44px targets. Assistant
starter prompts wrap in two columns and multiline composers stay bounded.

Browser inspection, source/component tests, native exports and installed-device
evidence remain separate. The [redesign work record](work/ui-ux-polish.md) records
fixtures, exercised contracts and platform qualification limits.

## Connections and collection controls

Collection search fields use one outer surface/focus ring and a 44px control
height (`--collection-control-h`); embedded inputs remain transparent in both themes. Align companion
collection actions to that height. Compact global command search is a navigation
control with its own header sizing.

Connections projects API-owned graph nodes from shared 3D positions, with explicit
orbit, zoom/reset and selection controls. Keep full names and direct navigation in
selection/list views, use sparse collision-aware captions, preserve page scrolling
on touch, and do not run decorative idle rotation. A project graph occupies its own
full-width section; editable metadata remains grouped beside the main work.

## Appearance across routes

Use the shared Light/Dark switch in the public header, sign-in navigation,
workspace header and Settings. It changes one device preference and updates
other open Orbyn tabs. System preferences migrate once to their resolved theme;
later operating-system changes do not alter the explicit choice. Public content
inherits the palette, including previews and first paint. Keep the desktop public
navigation centred with equal side columns; header actions share 44px targets.

Apply appearance changes atomically. Suppress transitions while committing the
new palette, then restore ordinary hover/press behavior after it has painted;
rows must not interpolate old-theme surfaces against a new-theme background.
