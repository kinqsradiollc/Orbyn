---
name: reflect
description: "Review the current task for reusable lessons when requested, and update only the authorized workflow or skill scope."
---

# Reflect

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Use the current conversation and its artifacts. Do not scan unrelated chat
histories or private workspace transcripts. Identify the failed assumption,
working correction and evidence that the lesson generalizes.

Prefer a small structural fix to another universal rule. Keep one-off preferences
local to the task. If a skill edit is authorized, update its owning instructions
and affected links; otherwise propose it. Do not write persistent memory or send
tracker/chat messages without the required direct user authorization.

The lead may assign an in-task reviewer for a specific difficult lesson under
[coordination](../../docs/agents/coordination.md); children assess their owned slice
directly. A mandatory panel is unnecessary. Return the applied change or proposal
with evidence and limits.

## A useful lesson is bounded

For a failed sync, identify whether the cause was stale baseline, shared write ownership or an unsafe path. Repair that owner when authorized. Do not add a generic “always double-check everything” rule or turn one interrupted run into a permanent extra approval phase.
