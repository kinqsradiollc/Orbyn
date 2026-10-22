---
name: principle-separate-before-serializing-shared-state
description: "Prevent concurrent writers from corrupting a shared artifact or state object."
---

# Principle separate before serializing shared state

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Give independent workers separate owned paths or records. When one shared object is a real invariant, use a transaction, lock, compare-and-swap or single owner. Conventions alone are not concurrency control. Distinct worktrees may isolate files while shared databases or generated artifacts still need coordination.

## Decision in practice

Which resources are actually shared?

Two worktrees isolate files, but can still race on one database, export directory or QA account. Give workers separate fixtures and output paths. Where a shared row is the invariant, use a transaction/version condition and assign cleanup ownership; a chat message is not a lock.
