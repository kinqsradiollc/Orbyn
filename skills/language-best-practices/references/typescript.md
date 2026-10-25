# TypeScript: schemas, states and callers

Follow the consuming project's instructions first. Use [project instructions and scope](../../orbyn-workflow/references/project-policy.md#scope-and-evidence) and [host configuration](../../orbyn-workflow/references/project-policy.md#delegation-and-host-configuration) where applicable; load only relevant references.

Use this guide through language-best-practices for TypeScript contract changes, including
repeated illegal states. [Type-system discipline](principles/type-system-discipline.md)
supports state design; [structural learning](../../architect/references/principles/encode-lessons-in-structure.md)
supports preventing a demonstrated recurrence. The language owner carries the
change through the schema and its callers.

## Resolve the compiler and runtime

Inspect package manifests, the lockfile, tsconfig inheritance, project references
and the actual emitter/runtime. Preserve the supported compiler, strictness,
module format and resolution mode. A bundler successfully stripping types does
not establish that a type-check ran. Prefer the project's configured check command;
passing individual files to tsc can bypass the intended project configuration.

Use strict checking where the project contract requires it. Do not change compiler
options across the repository as a side effect of an ordinary fix. Check null,
indexed-access and optional-property assumptions against the actual options;
newer syntax and stronger checks require the supported target, not an imagined
latest TypeScript. An ambient declaration can describe an API without making it
exist in the deployed runtime.

## Represent valid states

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
[development](../../orbyn-workflow/references/project-policy.md#development-resources).

## Keep public types and modules deliberate

Let local inference do useful work, while making exported or cross-package
contracts deliberate. Use a generic when it preserves a real relationship
between inputs and outputs; avoid type-level frameworks or broad type assertions
that hide an unresolved domain decision. Utility types do not automatically make
an internal persistence object a safe public response.

Distinguish type-only dependencies from runtime imports using the project's
supported syntax and emitter rules. Match package exports, ESM/CommonJS behavior
and consumer resolution; a tsconfig path alias alone does not rewrite a runtime
import. Keep declarations compatible with supported consumers and do not import
application code into shared types to repair a cycle.

## One contract across clients

When changing a run’s result shape, update the owning runtime schema, derived shared types, transport and web/mobile consumers together. Keep platform-only presentation state separate. Exhaustive handling should expose an unhandled lifecycle variant without forcing the domain layer to import application components.

## Runtime and polyglot boundaries

For JavaScript runtime, cancellation and resource-lifecycle effects, use only the
[JavaScript reference](javascript.md) when
relevant. Other languages route through [language guidance](../SKILL.md).
This reference owns the TypeScript-specific schema/type guidance; do not translate its specific
schema-library examples into a mandatory dependency for another language.

## Local contract example

Use the [TypeScript contract guide](typescript-contracts.md) for an original
lifecycle example, unknown-input handling, runtime effects and caller migration.

## Evidence to return

Report the actual compiler/configuration, owning schema and affected callers,
plus authorized check results and remaining runtime limits. For a new union
variant, check an exhaustive consumer; for untrusted input, check the real
parser's rejection and legitimate path. A type-check cannot prove tenant access,
database compatibility, rendering or cancellation of an unsupported effect.

Original additions reviewed 24 October 2026 against the TypeScript handbook's
[narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html),
[strict configuration](https://www.typescriptlang.org/tsconfig/strict.html) and
[module contracts](https://www.typescriptlang.org/docs/handbook/modules/reference.html).
These are update pointers; this guide and its example remain usable offline.
The retained adapted guidance's [source notice](typescript-LICENSE.txt) continues
to apply; the consolidation does not claim exclusive original authorship.
