# Prove it works

Inspect the actual output, candidate and terminal results. Choose checks within user/session authorization. Static inspection, builds, mocked tests, browser behavior and live-provider evidence establish different things. Record missing evidence; no self-report or majority vote is proof. Documentation needs links and provenance checks, not product builds.

## Decision in practice

Which observation would falsify this completion claim?

An API check can establish authorization; a web preview can establish a rendered flow; a native device check can establish platform behavior. Choose the layer named by the claim and preserve the exact candidate. Report a missing device/provider check explicitly rather than laundering a mock into acceptance evidence.

## Apply and hand off

Attach each completion claim to an observation at the relevant layer and exact candidate. Record the terminal result, excluded checks and what the observation cannot establish.

Concrete check: HTML generation proves source production. Render inspection establishes a visible layout; neither establishes a successful upload to the social platform.

Return the changed invariant, its owning location and the observation or evidence
gap. The [workflow](../../SKILL.md) owns completion claims;
[CI design](../../../orbyn-ci-design/SKILL.md) owns repeatable pipeline evidence. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [prove it works](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-prove-it-works/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
