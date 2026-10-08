---
name: orbyn-ui-design
description: "Design, implement, or review Orbyn UI and UX across web, desktop, and mobile: task flows, concise copy, responsive layouts, overlays, and AI interactions. Use for visible product flows; not backend-only work."
---

# Orbyn UI and UX Design

Make Orbyn easy to scan and operate at real window sizes. Keep its palette and
shared components. Compact default text must remain readable and grow with user
accessibility settings.

## Read before designing

- Read `AGENT.md` and the active ADR checkpoint; preserve scope and stage order.
- Read [design rules](references/design-rules.md) for typography, layout, copy,
  AI behavior, and the visual acceptance matrix.
- Read [UX rules](references/ux-rules.md) when changing navigation, task steps,
  forms, onboarding, feedback, recovery, or explanatory content.
- Read [research](references/research.md) when choosing or revising a rule. It
  distinguishes accessibility requirements, research guidance, and Orbyn choices.
- Inspect the owning screen and shared controls before adding a local override.
  Current tokens live in `packages/core/src/presentation.ts`,
  `desktop/src/styles/global.css`, and `mobile/src/theme/index.ts`.

## Design and implement

1. State the person's main task, starting state, and observable success. Map the
   steps, cancellation, failure, and return path before arranging controls.
2. Use existing text roles, spacing, and controls. Reduce competing headings,
   repeated actions, and explanatory copy before changing font sizes.
3. Adapt to the actual content width: collapse secondary panels, stack forms,
   or use a drawer. Keep every action reachable without squeezing the main task.
4. Preserve data and authority: drafts, selections, permissions, approvals,
   consent, and backend run states must survive visual changes.
5. Implement feature parity in web/desktop and mobile, with platform-appropriate
   navigation and controls. Record any authorized platform limitation explicitly.

## Review and delivery

Send visual work to **Orbyn Visual Check**. Give it the candidate checkout/ref,
URLs, exact states, viewport sizes, themes, and a Markdown report destination.
Specify whether its assignment is capture-only or includes analysis, following
the user's current authorization. Report delegated pixel review as delegated;
do not label it personal inspection.

Use the matrix in the rules for the changed feature. Verify actual CSS viewport,
zoom, and screenshot provenance before diagnosing a cropped or scaled image.
Passing builds, DOM dimensions, and screenshot metadata alone do not prove a
usable layout. Review density, discoverability, and task completion as well as
containment. Browser review does not prove installed-native behavior.

Fix reproduced problems and request a targeted recheck. Retain failed attempts
and unverified states. If browser permission or export is rejected, report the
blocked action and use an allowed handoff; do not bypass it through another
browser, port, transport, or indirect export. Integrate a scoped checkpoint only
when its acceptance evidence supports it; do not claim the whole ADR complete.
