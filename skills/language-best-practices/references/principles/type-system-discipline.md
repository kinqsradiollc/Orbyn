# Type system discipline

For a TypeScript schema or caller change, load
[TypeScript guidance](../typescript.md) as the owner.
This principle explains the design choice; the owner covers runtime validation,
derived types and migration of affected producers and consumers.

Model state variants explicitly, derive from authoritative schemas and handle variants exhaustively. Validate external and persisted data at runtime; static types do not prove authorization or freshness. Use semantic IDs where they prevent real confusion. Keep unavoidable casts local and justified; avoid ceremony that makes callers harder to read.

## Decision in practice

Which invalid combination should fail before runtime?

Represent a run as a discriminated union so a completed result cannot also require a pending answer. Parse external JSON into that type with the owning schema, then keep permission checks at the effect. An `as` assertion cannot validate a persisted payload or tenant access.

For another implementation language, use its [local language guide](../../SKILL.md)
and the consuming project's contract owner. Preserve valid-state and runtime
validation principles without requiring TypeScript syntax or schema libraries.

## Apply and hand off

State the invalid combination that should be impossible and the runtime boundary that can still receive it. Keep parsing, exhaustive handling and authority checks distinct.

Concrete check: A completed result can require an output while a waiting result requires a question. Validate persisted JSON before assigning either variant; a cast proves neither the shape nor access rights.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [TypeScript guidance](../typescript.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [type system discipline](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-type-system-discipline/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
