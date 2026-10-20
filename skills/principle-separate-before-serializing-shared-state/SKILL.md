---
name: principle-separate-before-serializing-shared-state
description: "Prevent concurrent writers from corrupting a shared artifact or state object."
---

# Principle separate before serializing shared state

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Give independent workers separate owned paths or records. When one shared object is a real invariant, use a transaction, lock, compare-and-swap or single owner. Conventions alone are not concurrency control. Distinct worktrees may isolate files while shared databases or generated artifacts still need coordination.
