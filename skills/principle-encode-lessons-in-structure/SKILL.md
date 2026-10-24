---
name: principle-encode-lessons-in-structure
description: "Prevent a demonstrated recurring error at its owning boundary."
---

# Principle encode lessons in structure

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Identify the common cause before generalizing a correction. Prefer a type, schema, existing lint rule or runtime invariant where it actually enforces the property. Keep judgment in focused guidance. Do not write personal memory, trackers or organization-wide rules without authorization, or make unrelated cleanup part of every fix.

## Decision in practice

Can the owning representation rule out the recurring error?

If a conversation can show both “waiting” and “completed”, replace independent booleans with a lifecycle union at the shared contract. Update serializers and consumers together. A repeated warning in a prompt is weaker than a representation that cannot encode the contradictory state.

When that contract is a TypeScript schema, load
[typescript-best-practices](../typescript-best-practices/SKILL.md) to carry the fix
through runtime validation, shared types and callers. For other stacks, use the
consuming project's schema owner; this principle does not choose a language.
