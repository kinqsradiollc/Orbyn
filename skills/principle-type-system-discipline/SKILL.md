---
name: principle-type-system-discipline
description: "Use types to express valid states and prevent meaningful contract mistakes."
---

# Principle type system discipline

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Model state variants explicitly, derive from authoritative schemas and handle variants exhaustively. Validate external and persisted data at runtime; static types do not prove authorization or freshness. Use semantic IDs where they prevent real confusion. Keep unavoidable casts local and justified; avoid ceremony that makes callers harder to read.

## Decision in practice

Which invalid combination should fail before runtime?

Represent a run as a discriminated union so a completed result cannot also require a pending answer. Parse external JSON into that type with the owning schema, then keep permission checks at the effect. An `as` assertion cannot validate a persisted payload or tenant access.
