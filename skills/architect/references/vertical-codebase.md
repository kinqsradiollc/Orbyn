# Organize code around an owned capability

Use this reference when designing repository structure, reducing cross-feature
coupling or deciding whether code should stay local or become shared. Start with
the consuming project's actual stack, import graph and constraints. A request to
explain the current layout needs source findings, not a reorganization.

## Find the owner before choosing the folder

Inspect the relevant entry points, callers, tests and recent changes. Identify
the capability, its consumers and who owns its state and effects. Propose a
functional grouping when related code is repeatedly changed or understood
together. Routes can suggest a starting point; they are not proof that everything
used on a page belongs to that page. Mark an inferred grouping as a hypothesis
when history or callers are unavailable.

Keep a capability's components, hooks, query helpers and local types close when
they share that owner. A local `components/` subfolder can still be useful; the
problem is unrelated capabilities sharing an unrestricted global bucket. A small
existing layout may need no new directory. Choose names that explain the work.

Preserve runtime, deployment and platform boundaries. A fullstack capability may
have corresponding API, web and mobile modules connected by a shared contract;
it does not require moving all implementations into one package. Shared domain
schemas stay with their canonical owner. UI organization never moves authority
checks out of the service or persistence boundary.

## Make coupling explicit

For each affected module, name its supported public entry points and consumers,
private details, and allowed dependency directions. A directory move improves
navigation but cannot prevent another feature from importing a private helper.
Avoid cycles and imports from domain contracts into client implementations.

Use the project's existing import rules or package interfaces when they can
enforce the contract. Separate packages are appropriate when their ownership,
distribution or build isolation justifies the cost. Do not add a monorepo tool,
workspace or blanket barrel file solely to implement this guidance. Check actual
resolver and bundler behavior before claiming that an interface is enforced.
Import restrictions support maintainability; they are not an authorization or
security isolation boundary.

## Extract a capability, not a miscellaneous bucket

Keep a helper local while only its owner needs it. Before extraction, identify
actual consumers, common semantics, an owner and a stable interface. Two similarly
shaped helpers with different behavior may remain separate. A shared capability
can have its own public interface; a generic design system owns reusable visual
primitives, while business behavior remains with the relevant capability.

Explain the cost: local implementations may duplicate work, shared interfaces
require coordination, and package boundaries add build/configuration work. Choose
the smallest boundary that makes likely changes easier to reason about.

## Return a reviewable design

Provide an owner/path map, the public API and private details, allowed imports,
one relevant rejected alternative and its trade-off. If implementation is in
scope, plan one capability at a time: inventory callers, move related files,
update imports and remove the obsolete path after callers migrate. Account for
route discovery, lazy loading, aliases, assets, tests, mocks and external API
compatibility where affected. Avoid an indefinite second implementation or a
repository-wide folder rename without evidence that it solves the problem.

Select checks for the affected contract and authorization: inspect callers and
the import graph, use existing boundary/type/build checks where applicable, and
verify changed behavior when executable changes are authorized. Record which
checks ran. Static links, a proposed layout or a clean typecheck alone do not prove
runtime behavior, independent modules or better agent performance.

See the [synthetic task-editor example](../examples/vertical-task-editor.md).

## Reviewed inspiration and attribution

Dominik (TkDodo), [The Vertical Codebase](https://tkdodo.eu/blog/the-vertical-codebase),
published 13 April 2026; reviewed 24 October 2026. The article informed the focus
on functional cohesion and explicit public interfaces. This reference and example
are independently written for Orbyn Engineering. No article text, code or images
were imported; its website's copyright remains with the author. This citation is
reviewed inspiration, not an MIT license grant or a claim of author endorsement.
The architect skill's existing source attribution and license remain applicable.
