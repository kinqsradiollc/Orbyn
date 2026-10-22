# Orbyn product design profile

This consumer-owned guide preserves the Orbyn conventions previously carried in
the shared UI skill. It defines design intent, not a claim that every surface
already conforms. Use [UI/UX](ui-ux.md), current components and the user's scope
alongside the portable [UI rules](../../skills/orbyn-ui-design/references/design-rules.md).

## Tokens and appearance

The current owners are `packages/core/src/presentation.ts`,
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
acceptance. Record checks of changed flows under [delivery](delivery.md).
