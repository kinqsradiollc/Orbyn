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
