---
name: principle-make-operations-idempotent
description: "Design commands and workers that tolerate retries, crashes and duplicate delivery."
---

# Principle make operations idempotent

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Define operation identity and the state transitions before effects. Use idempotency keys, transactional claims or reconciliation where the actual system needs them. Separate unknown external outcomes from safe retries. Check partial completion, restarts and cleanup ownership; a reused PID alone does not prove process identity.
