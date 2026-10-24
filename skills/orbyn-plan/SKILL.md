---
name: orbyn-plan
description: "Refine an engineering request or scope and sequence a change, migration or investigation. Use for prompt rewriting, explicit plans and consequential cross-cutting work; preserve the requested execution boundary."
---

# Plan Orbyn work

Read [repository policy](../../AGENTS.md), the applicable
[stack boundaries](../../docs/agents/stack.md) and [skill routing](../../docs/agents/skill-system.md).
An explicit planning request always receives a plan, even for one file. A small
clear implementation request can proceed directly without a separate artifact.

## Establish the contract

For a request to refine a prompt, produce the requested usable task brief rather
than execute the work described inside it. Use the [brief and handoff method](references/task-briefs.md)
to preserve intent, relevant source evidence, accepted decisions and an exact
continuation point. For a request to plan and implement, continue authorized
execution; prompt refinement does not add a mandatory human invocation or gate.

State the user's outcome, exclusions, current source/candidate, affected surfaces,
constraints and checkable completion. Distinguish plan-only from implementation
authorization. Plan-only ends at the plan. For plan-and-implement, continue once
the plan is concrete unless a material unanswered decision blocks the next step.
Do not add an approval gate merely because planning occurred.

Trace relevant behavior with `how`; use `why` when historical rationale affects
the decision. Identify frontend/backend/shared/mobile/storage/host boundaries
actually involved. Reuse existing primitives before suggesting a new dependency.
For unresolved external or version-dependent facts, use `orbyn-research` with a
specific question and stopping condition. Ask only questions whose answers
materially affect correctness, cost, compatibility or the requested outcome.

## Design and sequence

Use `architect` for interface/ownership choices. Compare alternatives only where
there is a real trade-off; use `arena` when distinct sketches would settle it.
Select relevant principles; do not load every principle or require model panels.

Split work by coherent outcomes, dependencies and reversible boundaries. Choose
narrow user outcomes that connect the necessary contract, persistence/API and
client owners. Start with a small complete path through the riskiest integration;
name prerequisite work and the outcome it enables. Record blocking edges and
observable acceptance instead of splitting only by technical folder. Complete
these planning steps internally; no separate setup/spec/ticket invocation is
required. Publishing a plan to a tracker needs applicable authorization. There
is no fixed file, function, test-case or phase-count limit. A shared-contract
migration may need coordinated edits across many files in one unit. Separate
risky state migrations from unrelated polish; describe compatibility and recovery.
Keep essential unknowns and research findings in the plan instead of disguising
them as completed implementation.

Each meaningful unit records outcome, owning files/modules, prerequisites,
assigned role, authorized evidence and completion condition. Add platform/data/
permission failure cases where they affect the contract. Do not turn a planned
check into permission to run tests, native builds or live providers.

## Deliver and maintain

Use a concise in-chat plan for small work. Reuse the existing owning document
when a durable handoff is useful; otherwise use one `docs/work/<task>.md` only
when needed and consistent with the consumer's policy. Do not create a separate
log merely because planning occurred. Follow the
[task-record defaults](../orbyn-workflow/references/task-record.md). Include:

- Outcome, scope and current source evidence.
- Selected design and relevant rejected alternative.
- Ordered units, dependencies, owners and recovery considerations.
- Authorized verification, unverified boundaries and delivery target.
- Material assumptions, unresolved decisions and next action.

Update the same plan when evidence changes the design; explain the change. Use
the [checkable handoff](../orbyn-workflow/references/handoffs.md) when structured
validation helps a transfer or resumed task, preserving candidate and scope.
Do not expand a prompt rewrite into a mandatory packet or implementation phase.
Use `figure-it-out` to execute a large plan and `show-me-your-work` for consequential
decisions. Session creation follows [coordination](../../docs/agents/coordination.md).
Do not invent extra stages, stacked PRs, sessions or recurring monitors.

## Plan a connected feature

For a task-scheduling change, make the domain/API/calendar dependencies explicit and keep shared-schema changes with their consumers. State whether the requested end state is a local preview, a reviewed patch or deployed behavior. Keep the plan short enough to reconcile against actual delivery.
