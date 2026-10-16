# Orbyn UI design rules

These are implementation and review rules, not a claim that the current app
already meets them. Standards and research behind them are in [research](research.md).

## Typography and density

Use the shared scale by role at normal text settings:

| Role    | Current base size | Use                                                         |
| ------- | ----------------- | ----------------------------------------------------------- |
| Caption | 11                | Brief metadata/counts; essential instructions use body text |
| Small   | 13                | Secondary labels and compact chrome                         |
| Body    | 15                | Content, rows, descriptions                                 |
| Title   | 18                | Card/section title                                          |
| Heading | 24                | Screen heading                                              |
| Display | 36                | Public landing hero or a deliberate summary number          |

- Mobile work screens normally use an 18px title; 24px remains available for
  document titles and deliberate page headings. Web phone input text uses its
  separate 16px control role.
- Use weight, spacing, and placement before adding another large heading. Reserve
  display text for the main marketing message; avoid it in settings and toolbars.
- Web fields use `--control-fs` and height tokens; coarse/narrow web field
  text is 16px to avoid iOS focus zoom. Do not enlarge every label/body paragraph to that field size.
  Do not reduce fields below the existing token to compensate for poor layout.
- Native uses `typeScale` and `fonts.*`; preserve system font scaling. Do not
  disable scaling or impose a blanket font-size cap to conceal overflow.
- Prefer flexible heights and wrapping. Enlarge the container or change layout
  when accessibility text grows. Never shrink text until a failing row fits.
- Keep contrast readable in both themes; low-emphasis text still needs contrast.
  The scale is a product convention, not proof of WCAG compliance.

## Motion and appearance

- Use neutral light/dark surfaces and the agreed restrained blue accent. Keep
  status colors semantic and user-selected calendar/tag colors intact.
- Routine screen/list content appears immediately. No ornamental stagger, hover
  lift or press shrink. Keep useful loading/progress and brief state feedback.
- Group settings as compact rows with separators; avoid raised cards inside cards.
- Disclosure headings keep a neutral background on hover. A subtle icon change
  can indicate the pointer; reserve filled states for actual selection and keep
  a clear keyboard focus outline. Hover must not resemble an expanded or selected section.

## Layout, panels, and overlays

- Check density as well as fit. At normal 320×740 settings, the header, search,
  category selector, and section chrome must leave useful room for the setting
  being changed. Fitting an oversized control is not sufficient acceptance.
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
- Settings remains a modal on web/desktop, using compact category navigation on
  narrow widths. Native uses the existing sheet/navigation conventions. Preserve
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
- Reuse theme/radius tokens, `Select`, `DateField`, shared buttons, menus, and
  native controls. Avoid local palette literals and unrelated CSS overrides.
  Check final styles with shared CSS loaded; a local rule can lose to a later
  generic rule. Source-only checks must not substitute for computed styles/pixels.
- Keep adequate pointer/touch targets without inflating text or entire cards.
  Native `controls.tap` is 44pt. Reserve the target in layout, with a smaller
  visual mark inside when appropriate. Use hit expansion only where surrounding
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

## AI interactions in Orbyn

- Assistant is the conversational workspace. Character configuration belongs to
  Background/Overnight agents, following the agreed task requirements; it must not block ordinary chat.
- Background and Overnight have distinct identities, runs, activity, and outputs.
  Show actual Idle/Queued/Running/Waiting/Stopped/Failed states and last activity;
  animate only supported active states. Describe collaboration without implying
  they share a runtime or work continuously while idle.
- Label AI suggestions and give a brief source/context reason when known. Keep
  edit, dismiss, and review available. Do not fabricate personalized quotes,
  pattern explanations, citations, confidence numbers, or completed work.
- Separate a suggestion, approval, and applied change. Review binds to the exact
  current request; stale cards cannot authorize a later action. Styling must
  preserve backend authority and cancellation/recovery behavior.
- Connect ChatGPT has a clear entry action and visible pending/success/error
  states. Capability and platform limitations must reflect implementation; never
  advertise unsupported hosted OAuth or manufacture a successful connection.
- Distinguish personal ChatGPT, workspace/BYO providers, embeddings, and MCP.
  Show selected recipient/model and explicit fallback where it affects choices.
  Keep material document-sharing consent visible before enabling embeddings.
- Display verified plan/usage only when supported. Unknown usage is unavailable,
  not zero. Token observations are not billing, remaining quota, or entitlement.
  Put essential scope/consent near the action; place technical detail in disclosure.

## Acceptance for a changed feature

Select representative states for the agreed risk, not every axis automatically.
User exclusions and `AGENT.md` take precedence; this is a menu of checks, not a
new requirement for native builds, enlarged text or repeated visual sweeps:

| Axis          | Representative checks                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Width/height  | Web 320/390/768/1280; mobile browser 320/390; short window and landscape where relevant                                  |
| Containers    | Expanded/collapsed main nav, secondary panel, nested picker/dialog, actual pane width                                    |
| Density/UX    | Useful task space at 320×740; concise copy; clear first action; complete, cancel, recover and return without losing work |
| Appearance    | Light/Dark at normal settings; enlarged text/zoom only when included in the agreed check                                 |
| Content       | Empty/populated, long/localized labels, large catalogs, selected/manual values                                           |
| Network/state | Loading, offline/error, retry, success, disabled, stale/revoked where relevant                                           |
| Interaction   | Pointer, Tab/Shift+Tab, Escape, focus return, scroll-to-last-item, keyboard visible                                      |
| Platforms     | Shared web/desktop browser and Expo web; installed desktop/iOS/Android only when explicitly requested                    |

At 320 CSS px, ordinary horizontal prose must not need horizontal scrolling;
if an accessibility resizing audit is requested, include its agreed zoom/text
settings and record any distinct behavior. Do not silently restore excluded checks.
Check increased text spacing and accessible names/roles as appropriate. Screenshots
establish visible containment only; interaction and accessibility need their own
checks. This matrix does not replace a full accessibility audit.

Visual Check's Markdown report should record source ref, URL, viewport, theme,
state/actions, image path or inline capture ID, inspected outcome, severity,
reproduction, and unverified scope. Separate confirmed defects from capture/DPR
errors. Acceptance requires the changed flow to remain readable, reachable, and
free of unintended clipping/overlap, with supported feature parity preserved.
Record excessive chrome, repeated explanations, and unnecessary steps as UX
defects even when all boxes fit. Resize through intermediate widths and near
breakpoints; passing a few fixed screenshots does not prove every size works.

## Conversation workspace

- Center the empty Chat/Work composer in the remaining pane. After a conversation
  starts, dock it to that pane's bottom and scroll the transcript independently.
- Keep Chat and Work at the same compact initial input height. Allow only a little
  growth (currently four text lines), then scroll the input internally. Keep the
  attachment, model and send controls outside that scrolling text region. Respect
  text scaling and short-window constraints; do not expand the composer over replies.
- Work selects a project inside the conversation workspace. Preserve saved session
  history, project visibility, pinning and the existing sweep/pinned exemptions.
- Paired panes have independent drafts, selection and scrolling. Keyboard commands
  operate in the focused pane; dialogs and pickers temporarily own those commands.
  At narrow widths, switch visible panes while preserving their mounted work.
- Connections use compact identity/status rows. Open account and permission detail
  in a focused surface; retain essential scope and consent at the decision point.

Reference: the bounded 13 October inspection in
`docs/reviews/chatgpt-reference-2026-10-13.md`. Its desktop observations inform these
choices but do not prove Orbyn usability or long-list/mobile/split-pane behavior.
The four-line input cap is the owner's Orbyn preference; the observed ChatGPT Work
composer allowed more growth.

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

Routine web actions use `--button-h`, `--button-fs` and `--button-line-h`:
32px/13px/20px for desktop,44px/15px/20px for phone/coarse-pointer controls.
Keep primary, secondary, text and icon actions aligned; segmented groups include
border/padding in their outer height. Use the token for per-feature minimums,
not unconditional44px overrides. Long labels can wrap; hero/presentation controls
may be deliberately larger. Verify density as well as color before calling an
action group consistent.

### Document workspaces

Keep the document toolbar visible while source and result scroll independently.
Collapse secondary libraries before reducing the writing area. A source/result
split belongs to the document viewport, with a keyboard-operable divider; on a
phone use explicit Source and Preview views. Do not embed the main editor inside
a code block or make a full PDF page the default typing preview. Assess readable
content, hierarchy, and space to work in the rendered product; functional controls
and containment alone do not establish a successful design.
