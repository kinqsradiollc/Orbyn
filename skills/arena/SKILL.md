---
name: arena
description: "Compare competing design or implementation sketches when a consequential choice cannot be resolved cheaply from existing evidence."
---

# Arena

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

State the artifact and a few observable criteria before generating alternatives.
Use at most two candidates initially, each with its own output path and rationale.
When parallelism helps, use in-task subagents. Otherwise compare sequentially.
Follow [coordination](../../docs/agents/coordination.md) for user-requested project
sessions; candidate comparison alone does not authorize new chats. Never launch
hidden CLI model sessions or recursive tournaments.

Give candidates the same task and constraints without steering them to a preferred
answer. Read their artifacts. Judge against requirements and maintainability, not
model reputation or agreement count. Retain one coherent design and incorporate
only compatible improvements. Do not average incompatible assumptions.

Record the selected approach, useful alternatives, rejected ideas and remaining
uncertainty. Verify the synthesized artifact under the task's authorized scope;
candidate agreement is not correctness evidence. Stop when the decision is made.
