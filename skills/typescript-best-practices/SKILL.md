---
name: typescript-best-practices
description: "Design and edit TypeScript data models and boundaries using precise types, existing schemas and explicit lifecycle handling."
---

# Typescript best practices

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Use discriminated unions for meaningful state variants and exhaustive handling
where new variants must trigger review. Prefer `unknown` for untrusted input;
parse with the owning runtime schema before relying on types. Derive shared types
from core schemas rather than maintaining parallel definitions.

Use `satisfies` to check literals without unsafe widening. Narrow before casting;
keep unavoidable interoperability assertions local and explain the invariant.
Brand identifiers when mixing them would cause a real class of bugs, not as a
blanket rewrite. Avoid optional-field bags that admit contradictory states.

Preserve cancellation, cleanup and authority checks near effects. Internal static
types do not establish tenant access or freshness of stored data. Keep helpers
and parameter objects where they clarify callers, not to satisfy arbitrary size
rules. Match repository Prettier and dependency direction in
[development](../../docs/agents/development.md).

## One contract across clients

When changing a run’s result shape, update the owning runtime schema, derived shared types, transport and web/mobile consumers together. Keep platform-only presentation state separate. Exhaustive handling should expose an unhandled lifecycle variant without forcing the domain layer to import application components.
