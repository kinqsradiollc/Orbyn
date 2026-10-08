# Orbyn UX rules

Apply these to the changed flow within the agreed task scope. They cover
behavior and information architecture as well as appearance. Research sources
and the distinction between external guidance and local choices are in
[research](research.md).

## Task and navigation

- Define a concrete outcome: change a preference, connect a provider, write a
  document, review a proposal, or schedule work. Avoid designing a page around
  everything the implementation can do.
- Map entry → action → feedback → result, plus cancel, failure, and return. Keep
  names and locations stable across clients; adapt presentation to the platform.
- Give frequent tasks a direct, visible path. Menus hold rare management actions;
  primary actions must not require guessing an icon or reading a tutorial.
- Preserve the current document/chat, draft, selected category, and relevant
  scroll position when opening and closing Settings or temporary panels.
- Search must lead to the actual setting, reveal its containing section, and
  leave a clear route back. Empty results offer a useful next step.
- Reduce duplicate actions and unnecessary steps. Keep steps that protect an
  informed decision, a destructive action, or a meaningful review boundary.

## Copy and progressive disclosure

- Show the label, current value/state, and relevant action. Add one short helper
  sentence only if it answers a likely question or prevents a mistake.
- Optional explanations belong in a specifically named disclosure, such as
  "How connections work". A help link is separate from the field's hint text.
- Essential consent, sharing scope, consequences, and recovery instructions stay
  near their action. Do not hide them simply to meet a copy or density target.
- Remove repeated benefit statements, welcome essays, and lists of example apps
  from routine settings. Empty states need a short fact and a next action.
- Use product distinctions consistently: ChatGPT provider connections supply
  inference; Connected agents/MCP grant access to Orbyn. Background and Overnight
  are separate work surfaces. Avoid a shared ambiguous "Connect AI" action.

## Forms, state, and recovery

- Prefer safe defaults and suitable input types; keep labels visible. Validate
  actionable field errors next to the field and preserve entered values.
- Distinguish invalid input from unavailable service, revoked access, missing
  permission, or provider outage. Explain the relevant next action briefly;
  do not ask a person to edit a correct field to solve a server problem.
- Show pending feedback when an action begins, prevent accidental duplicate
  submission, and make the saved/result state observable. A toast alone must not
  conceal a persistent failure or replace the current connection/run status.
- A retry retains work and cannot silently change the provider, recipient, model,
  or authority. If the consequence changes, require the appropriate fresh choice.
- Cancel, Back, Close, Undo, and disconnect must have predictable effects. Preserve
  unsaved-change guards and explain irreversible consequences before commitment.
- On mobile, use familiar back navigation, sheets, safe areas, keyboard types,
  and reachable actions. Native input/keyboard checks remain separate from browser
  emulation; parity means equivalent outcomes, not identical screen composition.

## AI experience

- Let people edit or dismiss suggestions and continue manually when AI is wrong
  or unavailable. Existing work must remain accessible after a provider failure.
- Show useful provenance and the actual reason for waiting. Keep uncertain or
  unavailable plan/usage information distinct from a verified zero value.
- Preserve approval, review, cancellation, and ownership boundaries as specified
  in the agreed task requirements. Convenience must not turn a suggestion into an authorized write.
- Keep contextual suggestions in a stable location; do not rearrange primary
  navigation or change settings based on inferred preferences without a choice.

## Acceptance beyond screenshots

For the changed feature, record an outcome, not just an opened screen:

| Check               | Evidence to record                                                             |
| ------------------- | ------------------------------------------------------------------------------ |
| Find and complete   | Starting point, actions, observable result, confusing or duplicate steps       |
| Cancel and return   | Draft/selection retained, correct destination, restored focus where applicable |
| Fail and recover    | Specific error, reachable next action, no work loss or duplicate side effects  |
| Narrow and enlarged | Actual viewport/scale, usable task space, keyboard/overlays, no trapped action |
| Equivalent clients  | Same supported task and authority on web/desktop/mobile; explicit native gaps  |

Ask Orbyn Visual Check for the authorized interaction review and Markdown report.
Use plain task goals for exploratory review rather than giving away every click;
give exact steps for a known defect's recheck. Agent walkthroughs are expert QA,
not evidence from representative human participants. Where user testing is done,
record completion, errors, assistance, and time without claiming a universal
usability score. Do not collect new analytics or personal data implicitly.
