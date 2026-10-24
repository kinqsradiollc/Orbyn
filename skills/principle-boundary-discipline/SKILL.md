---
name: principle-boundary-discipline
description: "Design validation and error handling at real trust or effect boundaries."
---

# Principle boundary discipline

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Parse external input once at its owner and pass typed values inward. Keep business transformations independent of framework wiring where useful. Retain runtime authority, freshness and persisted-data checks at the relevant effect; a static type cannot prove them. Avoid repeated downstream parsing or unconditional trust in internal callers.

## Decision in practice

Who owns this trust transition?

In an API mutation, parse the payload at the route boundary, load tenant-scoped records, and check authority again at the write. A valid `project_id` shape is not permission to edit that project. Return a deliberate domain error rather than hiding a denied effect in a generic success response.

## Apply and hand off

List each untrusted input and the effect it can reach. Put shape validation at entry and current authority at the effect; distinguish a rejected payload from a denied operation.

Concrete check: Send a well-shaped identifier owned by another tenant: parsing should succeed while the effect is denied. Preserve the legitimate same-tenant path.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [orbyn-backend-design](../orbyn-backend-design/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.
