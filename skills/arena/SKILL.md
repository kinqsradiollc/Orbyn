---
name: arena
description: "Compare competing design or implementation sketches when a consequential choice cannot be resolved cheaply from existing evidence."
---

# Arena

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

State the artifact and a few observable criteria before generating alternatives.
Use at most two candidates initially, each with its own output path and rationale.
The owning lead uses named native Orbyn Architect/Engineer assignments under the
[workflow](../orbyn-workflow/SKILL.md), with disjoint candidate paths. Keep at most
two active children across the task; compare sequentially when slots are occupied.
A child forbidden delegation compares sketches directly within its owned scope.
Follow [coordination](../../docs/agents/coordination.md) for user-requested project
sessions; candidate comparison alone does not authorize new chats. Never launch
hidden CLI model sessions or recursive tournaments.

Give candidates the same task and constraints without steering them to a preferred
answer. The lead reads every returned artifact and its rationale. Judge against requirements and maintainability, not
model reputation or agreement count. Retain one coherent design and incorporate
only compatible improvements. Do not average incompatible assumptions.

Record the selected approach, useful alternatives, rejected ideas and remaining
uncertainty. The lead reviews the synthesized diff and performs authorized proportional
verification;
candidate agreement is not correctness evidence. Stop when the decision is made.
