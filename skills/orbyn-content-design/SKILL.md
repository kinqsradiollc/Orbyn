---
name: orbyn-content-design
description: Write and arrange concise Orbyn product content, labels, status, errors and help across web, desktop and mobile. Use for visible interface copy and content hierarchy; preserve user-authored documents and messages.
---

# Orbyn Content Design

Make the next action understandable at a glance. Routine Orbyn screens must not
read like product documentation or a generated essay. Use with the layout skill
at `skills/orbyn-ui-design/SKILL.md`; follow the agreed task scope and `AGENT.md`.

## Decide what belongs on screen

- Start with the person's task. Show its name, useful current value/state and
  relevant action. Delete copy that repeats the heading, describes an obvious
  control or advertises benefits during the task.
- Add a helper only when it resolves ambiguity or prevents an error. Prefer one
  short sentence. Put optional mechanisms, examples and troubleshooting details
  behind specifically named help, such as “How search works”.
- Keep recipient, sharing scope, cost/fallback choices, approval and destructive
  consequences visible where the decision happens. Concision cannot conceal a
  material consequence or turn uncertain usage into a verified amount.
- Separate information by purpose: identity/title, status/value, action, optional
  detail. Avoid several equal-weight paragraphs or a card inside another card
  just to explain a single setting.
- Routine Settings/Admin/task surfaces need no welcome essay, motivational quote,
  feature list or marketing footer. Public landing pages can tell the product
  story; they still need deliberate sections rather than repeated benefit prose.

## Write concise, specific copy

Use sentence case, familiar terms and concrete verbs. As local starting targets,
aim for labels of 1–4 words, headings of 2–6 words and helpers around 12–18 words.
These are editing prompts, not hard limits: clarity and consequences take priority.
Check the actual narrow layout and translations instead of enforcing word counts
with tests or clipping text.

- Buttons name the outcome: “Add provider”, “Connect ChatGPT”, “Retry”. Context
  must identify the target when several actions exist; icon-only actions need
  accessible names. Keep vocabulary consistent across clients.
- Status gives the fact: “Off”, “Connected”, “Loading models…”, “Waiting for you”.
  Do not show the same progress sentence in several visible places. Keep needed
  live-region announcements accessible without creating duplicate visual copy.
- Errors give the problem and a useful next step near the initiating action.
  For example: “Couldn't load models. Try again.” Preserve drafts. Put request
  IDs and technical diagnostics in a revealable detail, not the headline.
- Empty states give a short fact and one useful action: “No providers yet” with
  “Add provider”. Avoid generic promises such as “Give your ideas a home”.
- Keep ChatGPT inference providers distinct from MCP/Connected agents. Keep
  interactive chat distinct from Background and Overnight. Short labels must
  not collapse these different destinations into “Connect AI”.

## Present real content and long values

- Do not rewrite or delete a person's document, task title, provider name or
  message to meet UI copy targets. Keep the full value available through wrapping,
  expansion or its detail view; never rely on hover alone on touch devices.
- Essential values such as selected model, recipient and quota must remain
  identifiable. A shortened display needs an accessible route to the full value
  and must not make two choices indistinguishable.
- Use badges or a compact metadata line for provider kind and state instead of
  embedding every detail in the title. Avoid repeated labels when context already
  names the field. Never show secret/token fragments as decorative metadata.
- QA fixtures should have short realistic display names, such as “Test provider”.
  Store “inert”, ownership, no-vendor-call guarantees and cleanup identifiers in
  fixture receipts/reports, not a long UI title. Preserve existing fixture identity
  and do not rename it during an active visual batch without coordination.
- On narrow screens, prioritize the task over explanatory text and repeated
  branding. Reflow controls and use existing text roles; do not shrink fonts,
  disable text scaling or clip content to disguise excess copy.

## Review within the existing visual batch

Before handoff, remove repetition and read only the visible headings, values and
actions: the task should still make sense. Check that optional help is discoverable
and essential information stays visible. Give Orbyn Visual Check specific content
risks in the stable-candidate batch; do not start another screenshot sweep solely
because this skill or documentation changed. Evaluate scanability and task space,
not just whether all boxes fit. Preserve the full agreed acceptance requirements.

## Research basis

Reviewed 8 October 2026. GOV.UK's [text-input guidance](https://design-system.service.gov.uk/components/text-input/)
supports short direct labels, visible field labels and relevant hints. Its
[details guidance](https://design-system.service.gov.uk/components/details/)
supports disclosing help needed by some users while keeping generally necessary
information visible. The word targets, fixture names and signed-in copy choices
above are Orbyn conventions, not standards imposed by those sources.
