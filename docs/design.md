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
32px/13px/20px on desktop and 44px/15px/20px on phone/coarse pointers. Native
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
