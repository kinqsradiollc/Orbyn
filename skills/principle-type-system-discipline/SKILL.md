---
name: principle-type-system-discipline
description: "Choose types that express valid states and prevent contract mistakes. For shared TypeScript schema changes, pair this principle with typescript-best-practices."
---

# Principle type system discipline

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

For a TypeScript schema or caller change, load
[typescript-best-practices](../typescript-best-practices/SKILL.md) as the owner.
This principle explains the design choice; the owner covers runtime validation,
derived types and migration of affected producers and consumers.

Model state variants explicitly, derive from authoritative schemas and handle variants exhaustively. Validate external and persisted data at runtime; static types do not prove authorization or freshness. Use semantic IDs where they prevent real confusion. Keep unavoidable casts local and justified; avoid ceremony that makes callers harder to read.

## Decision in practice

Which invalid combination should fail before runtime?

Represent a run as a discriminated union so a completed result cannot also require a pending answer. Parse external JSON into that type with the owning schema, then keep permission checks at the effect. An `as` assertion cannot validate a persisted payload or tenant access.

For another implementation language, use its [local language guide](../language-best-practices/SKILL.md)
and the consuming project's contract owner. Preserve valid-state and runtime
validation principles without requiring TypeScript syntax or schema libraries.
