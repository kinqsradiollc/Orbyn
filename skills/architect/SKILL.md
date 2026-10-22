---
name: architect
description: "Design data shapes, interfaces and ownership for substantive features or refactors before implementation."
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

## Cross-stack handoff

For a proposal-approval feature, specify the durable proposal state, authenticated apply operation, stale-version behavior and shared result shape before designing the buttons. Return a contract the API, web and mobile owners can implement without inventing their own lifecycle. A model sketch is sufficient only when it answers those ownership questions.

## Worked example

[Reviewing a proposed change](examples/proposal-approval.md) shows a synthetic
input, ownership contract, recovery behavior and a tempting failure. Reuse the
reasoning shape with the consuming project's actual owners.
