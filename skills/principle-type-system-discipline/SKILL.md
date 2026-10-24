---
name: principle-type-system-discipline
description: "Choose types that express valid states and prevent contract mistakes. For shared TypeScript schema changes, use the TypeScript reference in language-best-practices."
---

# Principle type system discipline

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

For a TypeScript schema or caller change, load
[TypeScript guidance](../language-best-practices/references/typescript.md) as the owner.
This principle explains the design choice; the owner covers runtime validation,
derived types and migration of affected producers and consumers.

Model state variants explicitly, derive from authoritative schemas and handle variants exhaustively. Validate external and persisted data at runtime; static types do not prove authorization or freshness. Use semantic IDs where they prevent real confusion. Keep unavoidable casts local and justified; avoid ceremony that makes callers harder to read.

## Decision in practice

Which invalid combination should fail before runtime?

Represent a run as a discriminated union so a completed result cannot also require a pending answer. Parse external JSON into that type with the owning schema, then keep permission checks at the effect. An `as` assertion cannot validate a persisted payload or tenant access.

For another implementation language, use its [local language guide](../language-best-practices/SKILL.md)
and the consuming project's contract owner. Preserve valid-state and runtime
validation principles without requiring TypeScript syntax or schema libraries.

## Apply and hand off

State the invalid combination that should be impossible and the runtime boundary that can still receive it. Keep parsing, exhaustive handling and authority checks distinct.

Concrete check: A completed result can require an output while a waiting result requires a question. Validate persisted JSON before assigning either variant; a cast proves neither the shape nor access rights.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [TypeScript guidance](../language-best-practices/references/typescript.md) when relevant. This
principle refines that task; it does not create another mandatory phase.
