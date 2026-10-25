---
name: architect
description: "Design data shapes, interfaces, ownership and module boundaries for substantive features or refactors; use for code organization, vertical modules and shared-code extraction."
---

# Architect

Follow the consuming project's instructions and requested scope; use the
[portable defaults](../orbyn-workflow/references/project-policy.md) only where guidance is missing.

Read the relevant [stack boundaries](../orbyn-workflow/references/project-policy.md#stack-and-ownership). Use
[orbyn-research](../orbyn-research/SKILL.md) for a consequential external unknown
and [orbyn-plan](../orbyn-plan/SKILL.md) when the design needs a delivery sequence.

Trace the current design with [how](../how/SKILL.md). Write the caller's usage
first, then the necessary types, owner, interfaces and lifecycle. Include authority,
concurrency, failure, recovery and compatibility when the task affects them.

Compare plausible alternatives where the choice is consequential. A small sketch
is sufficient when an established pattern fits. Use [arena](../arena/SKILL.md)
only when competing candidates would settle a real uncertainty; do not launch a
model panel for every function boundary.

Choose the smallest coherent design and explain its trade-off. For substantial
implementation, the lead delegates against the selected design under the
[workflow](../orbyn-workflow/SKILL.md), reviews the returned diff and performs
authorized verification. Route repeated design friction back into the contract.
A child implements its owned scope directly; a design-only request ends with the
design. Keep sketches out of
production code unless they are being completed in the same delivery.
Repeated escape hatches or duplicated state interpretation mean reconsider the
owner/type design. Fix that source of complexity instead of adding wrappers.
Record a durable rationale only when future maintainers need the decision.

## Code organization and module boundaries

When caller burden or shallow wrappers motivate a refactor, list everything a
caller must know: inputs, invariants, ordering, failures and lifecycle. Compare
that burden with the behavior hidden by the module. Remove a pass-through when
it adds no useful boundary; retain an owner whose removal would spread complexity
across callers. Place seams around actual variation and effects, then verify
behavior through that interface when authorized. Use the project's vocabulary;
create a glossary or durable rationale only for a real recurring ambiguity.

For questions about where code belongs, cross-feature imports or shared-code
extraction, use [vertical code organization](references/vertical-codebase.md).
Group code by the functionality it owns within existing stack boundaries. Use
callers and change history to justify that grouping; folder names alone do not
establish independence. Specify public entry points, private internals and allowed
dependency directions before moving files. Prefer an incremental change using
existing enforcement over a new workspace or a package for every directory.

Return the proposed owner map, import contract, trade-off and scoped migration /
verification plan. Explaining an existing import path belongs to `how`; a small
clear fix does not require an architecture redesign. This skill request does not
authorize reorganizing a consuming application.

## Cross-stack handoff

For a proposal-approval feature, specify the durable proposal state, authenticated apply operation, stale-version behavior and shared result shape before designing the buttons. Return a contract the API, web and mobile owners can implement without inventing their own lifecycle. A model sketch is sufficient only when it answers those ownership questions.

## Worked example

[Reviewing a proposed change](examples/proposal-approval.md) shows a synthetic
input, ownership contract, recovery behavior and a tempting failure. Reuse the
reasoning shape with the consuming project's actual owners.

[Organizing a task editor](examples/vertical-task-editor.md) demonstrates functional
cohesion, a public interface and shared ownership without merging client/server
or platform boundaries.

## Technology choice versus interface design

When language/framework/storage choice is unresolved, use
[stack selection](../orbyn-stack-selection/SKILL.md) for constraint/evidence comparison,
then own interfaces and lifecycle here. An established project's bounded feature
usually retains its stack. Pair implementation with the relevant
[language reference](../language-best-practices/SKILL.md), preserving FFI/transport
encoding, ownership and failure contracts across polyglot boundaries.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

## Maintainability and polyglot interfaces

For caller complexity, dependency cycles or API longevity, use [maintainable modules](references/maintainable-modules.md). The [Python/Go/SQL example](examples/polyglot-contract.md) connects one contract across language boundaries without imposing a framework.

## Essential design rules

Choose authoritative data, ownership and lifecycle before adding logic. Simplify
the affected design before extending it; remove needless indirection without losing
required behavior. Integrate new requirements into that design, and encode a
demonstrated recurring failure at the boundary that can prevent it. Compare
concrete alternatives only for consequential uncertainty. Migrate controlled
callers and retire the old API once compatibility evidence permits it.

Conditional methods with worked checks:
[foundations](references/principles/foundational-thinking.md),
[subtraction](references/principles/subtract-before-you-add.md),
[simplification](references/principles/laziness-protocol.md),
[reader load](references/principles/minimize-reader-load.md),
[coherent redesign](references/principles/redesign-from-first-principles.md),
[structural prevention](references/principles/encode-lessons-in-structure.md),
[alternatives](references/principles/exhaust-the-design-space.md), and
[API retirement](references/principles/migrate-callers-then-delete-legacy-apis.md).
Read only the method needed for the current decision.

For cross-team, independently released or quantitatively constrained systems,
use [large changes](references/large-changes.md). Name measured/required/assumed
constraints, distinguish code and organizational ownership, pilot a complete slice,
then migrate resumable batches. Never infer deployed adoption from local edits.

For durable transitions, return the migration owner's concrete writer/admission
contract in the design, including stale-writer rejection and current-writer
controls. A link to migration guidance alone is not the deliverable.
For a new service or materially changed operating envelope, use
[service readiness](references/service-readiness.md); small internal changes
retain their existing operating contract.
