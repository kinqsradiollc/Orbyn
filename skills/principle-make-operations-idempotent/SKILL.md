---
name: principle-make-operations-idempotent
description: "Design commands and workers that tolerate retries, crashes and duplicate delivery."
---

# Principle make operations idempotent

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Define operation identity and the state transitions before effects. Use idempotency keys, transactional claims or reconciliation where the actual system needs them. Separate unknown external outcomes from safe retries. Check partial completion, restarts and cleanup ownership; a reused PID alone does not prove process identity.

## Decision in practice

What does a repeated request mean after an unknown outcome?

Persist an operation key before an external effect and record the returned receipt. A timeout is an unknown result, not proof nothing happened. Reconcile with the provider before issuing a second effect; a database transaction alone cannot make a remote action exactly once.
