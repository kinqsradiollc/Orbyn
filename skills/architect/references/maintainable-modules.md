# Maintainable modules across languages

Use this when a change exposes repeated caller decisions, unclear ownership or
unstable public boundaries. Read the actual import/build graph, representative
callers and supported versions first. Directory names and function length do not
establish a useful module boundary.

## Put a responsibility behind the interface

Write one ordinary call and one failed/interrupted call. Identify the knowledge
the caller must supply: ordering, validation, identity, transactions, cleanup,
error interpretation and compatibility. A useful owner absorbs a coherent subset
of that burden. A pass-through that changes names alone often adds navigation
without hiding complexity; a small adapter enforcing authority can be valuable.

Separate pure domain decisions from effect wiring where the project benefits.
Do not create interfaces for every class or copy one architecture into every
language. Go packages, Rust modules/crates, Python packages, JVM/.NET assemblies
and JavaScript modules enforce different visibility and compatibility rules.
Use the relevant local language reference before selecting an enforcement tool.

## Preserve change boundaries

- Keep one authoritative representation of a lifecycle. Derive presentation
  state; do not synchronize independent copies of the same domain status.
- Put public schema/error meanings at the actual interface. Keep framework and
  vendor details behind the effect adapter when callers should not depend on them.
- Introduce a seam for a demonstrated variation, effect or ownership boundary.
  Avoid a generic strategy/plugin framework for one concrete implementation.
- For a dependency cycle, trace the shared decision before adding a barrel file
  or service locator. Move that decision to its real owner, then migrate callers.
- Record compatibility for published packages, released clients and stored data.
  A monorepo search cannot inventory consumers outside the repository.

## A small review table

| Question                       | Useful evidence                           | Warning sign                                      |
| ------------------------------ | ----------------------------------------- | ------------------------------------------------- |
| What does the module own?      | One invariant and real callers            | Callers repeat hidden ordering rules              |
| What may depend on it?         | Public entrypoint and import direction    | UI/vendor code imported into the domain           |
| How does it fail?              | Stable error meaning and cleanup owner    | Catch-all success or silent partial effect        |
| What can change independently? | A real variation or deployment boundary   | One package per directory with no independent use |
| How will migration finish?     | Caller inventory and retirement condition | Permanent duplicate internal models               |

Return the selected boundary, representative usage, trade-off and migration
order. Check source dependencies and authorized behavior at that boundary; a
clean dependency graph alone does not prove runtime behavior. Small clear edits
retain their scope rather than triggering a redesign.

[The polyglot example](../examples/polyglot-contract.md) connects Python, Go and
SQL without turning a language style preference into an architecture mandate.

## Evidence basis

Reviewed 24 October 2026. The [Go module guide](https://go.dev/doc/modules/layout)
and [Rust API guidelines](https://rust-lang.github.io/api-guidelines/checklist.html)
illustrate language-specific visibility and public API concerns. This local
method and its examples are independently authored; the links are update pointers.
