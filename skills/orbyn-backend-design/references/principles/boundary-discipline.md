# Boundary discipline

Parse external input once at its owner and pass typed values inward. Keep business transformations independent of framework wiring where useful. Retain runtime authority, freshness and persisted-data checks at the relevant effect; a static type cannot prove them. Avoid repeated downstream parsing or unconditional trust in internal callers.

## Decision in practice

Who owns this trust transition?

In an API mutation, parse the payload at the route boundary, load tenant-scoped records, and check authority again at the write. A valid `project_id` shape is not permission to edit that project. Return a deliberate domain error rather than hiding a denied effect in a generic success response.

## Apply and hand off

List each untrusted input and the effect it can reach. Put shape validation at entry and current authority at the effect; distinguish a rejected payload from a denied operation.

Concrete check: Send a well-shaped identifier owned by another tenant: parsing should succeed while the effect is denied. Preserve the legitimate same-tenant path.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [orbyn-backend-design](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [boundary discipline](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-boundary-discipline/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
