---
name: principle-outcome-oriented-execution
description: "Complete an agreed migration without accumulating temporary compatibility debt."
---

# Principle outcome oriented execution

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Define the target contract and explicit verification boundaries. Transitional breakage must be isolated, reversible and compatible with the delivery scope. Avoid leaving two internal models indefinitely. Preserve public availability and data; required checks cannot be replaced by an intended future fix.

## Decision in practice

What remains before the new contract truly owns the path?

For a service extraction, track routing, callers, persisted state, deployment wiring and removal of the obsolete handler. A green new service does not finish the migration while the old writer remains active. Name the remaining unit rather than describing the target design as delivered.
