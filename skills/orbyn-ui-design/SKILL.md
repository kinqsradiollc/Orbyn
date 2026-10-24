---
name: orbyn-ui-design
description: "Design, implement, or review Orbyn UI and UX across web, desktop, and mobile: task flows, concise copy, responsive layouts, overlays, and AI interactions. Use for visible product flows; not backend-only work."
---

# Orbyn UI and UX Design

Apply Orbyn Engineering's UI approach to the target product: make its task flow easy
to scan and operate at real window sizes. Use the agreed palette and
shared components. Compact default text must remain readable and grow with user
accessibility settings.

For social announcement graphics, product screenshot compositions and feed
mockups, use [social-preview](../social-preview/SKILL.md), with
[social-content](../social-content/SKILL.md) for the post. This skill owns changes
to the product UI itself; a promotional mockup is not an implemented screen.

## Read before designing

- Read `AGENTS.md` and the agreed task scope; preserve scope and stage order.
- For product copy and information hierarchy, read
  `skills/orbyn-content-design/SKILL.md`; keep detailed content rules there.
- Read [design rules](references/design-rules.md) for typography, layout, copy,
  AI behavior, and the visual acceptance matrix.
- Read [UX rules](references/ux-rules.md) when changing navigation, task steps,
  forms, onboarding, feedback, recovery, or explanatory content.
- Read [research](references/research.md) when choosing or revising a rule. It
  distinguishes accessibility requirements, research guidance, and Orbyn choices.
- Inspect the owning screen and shared controls before adding a local override.
  Resolve token/component owners from the consuming project's stack guide and
  manifests. In Orbyn's application these are `packages/core/src/presentation.ts`,
  `desktop/src/styles/global.css`, and `mobile/src/theme/index.ts`; other projects
  use their own owners. Never create these paths to fit the skill.

## Resolve product direction

Read the consuming checkout's design/brand pointers in its optional
[project context](../orbyn-setup/references/project-context.md), then inspect the
actual token and component owners. Preserve its agreed palette, type scale,
density, navigation and motion policy. This library supplies no universal blue
accent, modal layout or pixel scale. When a guide is absent, use the existing
interface and the user's brief; record unsettled choices before a broad redesign.

Read [prototyping guidance](references/prototypes.md) when an interactive sketch
would resolve a design question. Use `orbyn-research` for unknown platform or
accessibility requirements; do not replace existing product tokens with a foreign
host's theme or tool APIs.

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

Apply the on-demand cadence in `AGENTS.md`: no automatic visual sweep for every
change or checkpoint. Prefer authorized tests/API evidence for functional behavior
and reuse valid prior UI evidence. For a material layout/interaction risk or reproduced
visual defect, inspect the relevant flow when authorized. If an independent
visual role is requested, use the session/subagent topology in
[coordination](../../docs/agents/coordination.md). Give that inspector the candidate checkout/ref,
URLs, exact states, viewport sizes, themes, and a Markdown report destination.
Specify whether its assignment is capture-only or includes analysis, following
the user's current authorization. Report delegated pixel review as delegated;
do not label it personal inspection.

Choose only cases relevant to the named risk; do not expand into a full matrix
of unchanged states or screens. Stop when those cases are checked. Verify actual CSS viewport,
zoom, and screenshot provenance before diagnosing a cropped or scaled image.
Passing builds, DOM dimensions, and screenshot metadata alone do not prove a
usable layout. Review density, discoverability, and task completion as well as
containment. Browser review does not prove installed-native behavior.

Fix reproduced problems and request a targeted recheck. Retain failed attempts
and unverified states. If browser permission or export is rejected, report the
blocked action and use an allowed handoff; do not bypass it through another
browser, port, transport, or indirect export. Integrate a scoped checkpoint only
when its acceptance evidence supports it; do not claim the whole task complete.

## Worked example

[Recovering a failed save](examples/failed-save.md) applies a consuming project's
style and draft/conflict contract without claiming an unperformed visual check.

## Async flow ownership

For fetch/save/search or subscription changes, use [asynchronous state and recovery](references/async-state.md). Preserve request identity, stale-result handling, drafts, current scope and cleanup in the actual framework.
