# Encode lessons in structure

Identify the common cause before generalizing a correction. Prefer a type, schema, existing lint rule or runtime invariant where it actually enforces the property. Keep judgment in focused guidance. Do not write personal memory, trackers or organization-wide rules without authorization, or make unrelated cleanup part of every fix.

## Decision in practice

Can the owning representation rule out the recurring error?

If a conversation can show both “waiting” and “completed”, replace independent booleans with a lifecycle union at the shared contract. Update serializers and consumers together. A repeated warning in a prompt is weaker than a representation that cannot encode the contradictory state.

When that contract is a TypeScript schema, load
[TypeScript guidance](../../../language-best-practices/references/typescript.md) to carry the fix
through runtime validation, shared types and callers. For other stacks, use the
consuming project's schema owner; this principle does not choose a language.

For another implementation language, use its [local language guide](../../../language-best-practices/SKILL.md)
and the consuming project's contract owner. Preserve valid-state and runtime
validation principles without requiring TypeScript syntax or schema libraries.

## Apply and hand off

Write the recurring invalid state and identify the representation that permits it. Move the invariant into that owner and migrate its producers and consumers together.

Concrete check: Replacing two lifecycle booleans requires updating persisted readers as well as the type. Keep a compatibility path for old stored data until it is deliberately retired.

Return the changed invariant, its owning location and the observation or evidence
gap. Carry execution through [architect](../../SKILL.md) when relevant. This
principle refines that task; it does not create another mandatory phase.

## Source and license

Adapted from Lauren Tan's pstack [encode lessons in structure](https://github.com/cursor/plugins/blob/74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12/pstack/skills/principle-encode-lessons-in-structure/SKILL.md),
revision `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`.
Orbyn adaptations and worked examples retain the [original MIT notice](LICENSE.txt).
