# Laziness protocol

Aim for less maintenance work. Remove proven unused paths, collapse unnecessary wrappers and consolidate decisions at one owner. Prefer a small coherent fix over layers built for hypothetical reuse. Do not delete checks, compatibility or evidence just to reduce line count.

## Decision in practice

Which maintained path can disappear without losing the contract?

If three wrappers only rename a request field, consolidate interpretation in the transport owner and migrate its callers. Keep a wrapper that enforces authority, cancellation or recovery. Fewer lines are not useful when a real boundary becomes implicit.

## Apply and hand off

Inventory maintained paths and what contract each enforces. Remove a path only after its callers and compatibility obligations have an owner.

Concrete check: A pass-through wrapper can disappear when callers migrate. A wrapper enforcing authorization or cleanup needs that enforcement transferred before removal.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [laziness protocol](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-laziness-protocol/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
