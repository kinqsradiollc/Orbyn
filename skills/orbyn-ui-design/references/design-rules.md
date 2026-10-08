# Orbyn UI design rules

These are implementation and review rules, not a claim that the current app
already meets them. Standards and research behind them are in [research](research.md).

## Typography and density

Use the shared scale by role at normal text settings:

| Role | Current base size | Use |
| --- | --- | --- |
| Caption | 11 | Brief metadata/counts; essential instructions use body text |
| Small | 13 | Secondary labels and compact chrome |
| Body | 15 | Content, rows, descriptions |
| Title | 18 | Card/section title |
| Heading | 24 | Screen heading |
| Display | 36 | Public landing hero or a deliberate summary number |

- Use weight, spacing, and placement before adding another large heading. Reserve
  display text for the main marketing message; avoid it in settings and toolbars.
- Web fields use `--control-fs` and height tokens; current coarse/narrow field
  text is 18px. Do not enlarge every label/body paragraph to that field size.
  Do not reduce fields below the existing token to compensate for poor layout.
- Native uses `typeScale` and `fonts.*`; preserve system font scaling. Do not
  disable scaling or impose a blanket font-size cap to conceal overflow.
- Prefer flexible heights and wrapping. Enlarge the container or change layout
  when accessibility text grows. Never shrink text until a failing row fits.
- Keep contrast readable in both themes; low-emphasis text still needs contrast.
  The scale is a product convention, not proof of WCAG compliance.

## Layout, panels, and overlays

- Check density as well as fit. At normal 320×740 settings, the header, search,
  category selector, and section chrome must leave useful room for the setting
  being changed. Fitting an oversized control is not sufficient acceptance.
- Use compact single-line section headers and existing control heights. Reduce
  redundant card wrappers, accumulated gaps, and decorative padding before
  reducing readable text or touch targets. Never scale the entire desktop layout
  into a narrow window. Enlarged text may legitimately require taller rows.
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
- Preserve visible keyboard focus without drawing two competing borders around
  the same search field. A sticky header, footer, or composer must not obscure
  the focused control. Test the actual focus ring instead of removing outlines.
- Reuse theme/radius tokens, `Select`, `DateField`, shared buttons, menus, and
  native controls. Avoid local palette literals and unrelated CSS overrides.
- Keep adequate pointer/touch targets without inflating text or entire cards.
  Native `controls.tap` is 44pt; compact controls keep a reachable hit area whose
  expansion does not collide with neighboring targets.

## Content and actions

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
  Background/Overnight agents, following the ADR; it must not block ordinary chat.
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

Inspect representative states, not just a clean empty page:

| Axis | Required checks |
| --- | --- |
| Width/height | Web 320/390/768/1280; mobile browser 320/390; short window and landscape where relevant |
| Containers | Expanded/collapsed main nav, secondary panel, nested picker/dialog, actual pane width |
| Density/UX | Useful task space at 320×740; concise copy; clear first action; complete, cancel, recover and return without losing work |
| Appearance | Light/Dark, normal and 200% web text/zoom; native enlarged text settings |
| Content | Empty/populated, long/localized labels, large catalogs, selected/manual values |
| Network/state | Loading, offline/error, retry, success, disabled, stale/revoked where relevant |
| Interaction | Pointer, Tab/Shift+Tab, Escape, focus return, scroll-to-last-item, keyboard visible |
| Platforms | Browser checks plus affected installed desktop/iOS/Android flows; native gaps stay explicit |

At 320 CSS px, ordinary horizontal prose must not need horizontal scrolling;
also check 1280 at 400% zoom for reflow and 200% enlargement for text resizing.
If these settings produce different behavior, record and fix the failing state.
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
