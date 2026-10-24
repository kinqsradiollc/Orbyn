---
name: architect
description: "Design data shapes, interfaces, ownership and module boundaries for substantive features or refactors; use for code organization, vertical modules and shared-code extraction."
---

# Architect

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Read the relevant [stack boundaries](../../docs/agents/stack.md). Use
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
