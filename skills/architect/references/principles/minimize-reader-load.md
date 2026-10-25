# Minimize reader load

Trace where values originate and who changes them. Collapse wrappers that add no boundary, shrink mutable scope and derive state instead of synchronizing duplicates. Keep useful separation around effects and authority. Judge clarity by whether a maintainer can follow the contract, not an arbitrary file or function count.

## Decision in practice

Can a maintainer explain where this value changes?

For a reviewable proposal, keep its lifecycle in the shared domain owner and render the current state directly. Avoid a second local status plus effects that continually synchronize it. Keep separate presentation state, such as an expanded panel, local to the view.

## Apply and hand off

Follow one value from creation through mutation and use. Collapse duplicate interpretations while keeping useful effect and authority boundaries explicit.

Concrete check: Derive a displayed operation status from the domain result. Retain local expanded/collapsed state because presentation state has a different owner and lifetime.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [minimize reader load](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-minimize-reader-load/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
