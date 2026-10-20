---
name: figure-it-out
description: "Plan and execute an authorized large migration or cross-cutting task with measurable completion criteria and a concise evidence trail."
---

# Figure it out

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Use [orbyn-plan](../orbyn-plan/SKILL.md) to establish or revise the execution plan
and [stack ownership](../../docs/agents/stack.md) to place changes.

Define a checkable end state, exclusions and the largest unresolved risk. Inventory
the actual units before planning. Sequence by dependency and risk, using coherent
units that can be inspected without leaving ambiguous ownership.

Choose evidence and reversible recovery for each unit. Use existing tools before
building automation; create a small reusable helper when repetition or reliable
checking justifies it. Follow the user's verification scope.

For each unit: state the hypothesis, make the change, inspect the result, retain
useful evidence and correct disproven assumptions. Do not repeat an unchanged
failed attempt without a new explanation. Delegate only independent bounded work
to in-task subagents; the parent owns integration.

Use [show-me-your-work](../show-me-your-work/SKILL.md) for decisions that matter
later. Revisit the full checklist at the end. Report verified, unverified and
blocked parts without silently reducing the requested outcome.
