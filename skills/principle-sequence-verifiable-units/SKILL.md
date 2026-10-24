---
name: principle-sequence-verifiable-units
description: "Order a multi-part change so failures are localized and delivery is understandable."
---

# Principle sequence verifiable units

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Choose coherent units based on dependency and risk, with authorized evidence at each meaningful boundary. Capture a baseline where it matters. Do not require a full build per file or rebase a dirty checkout automatically. Keep final cross-unit requirements visible; local successes do not prove the integrated result.

## Decision in practice

Can a failure be assigned to one reversible boundary?

For a stored-schema change, introduce compatible reading before switching writers, then retire the old format after consumers move. Attach a check and recovery route to each meaningful step. Do not split a coupled type/caller change into intermediate commits that cannot be understood or recovered.

## Apply and hand off

Choose boundaries that retain a useful invariant and recoverable state. Give each meaningful unit an entry condition, artifact, authorized check and next dependency.

Concrete check: Introduce a compatible reader before switching writers. Do not create an intermediate commit with a changed shared type and knowingly broken owned callers merely to make smaller commits.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [orbyn-plan](../orbyn-plan/SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.
