---
name: reflect
description: "Review the current task for reusable lessons when requested, and update only the authorized workflow or skill scope."
---

# Reflect

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Use the current conversation and its artifacts. Do not scan unrelated chat
histories or private workspace transcripts. Identify the failed assumption,
working correction and evidence that the lesson generalizes.

Prefer a small structural fix to another universal rule. Keep one-off preferences
local to the task. If a skill edit is authorized, update its owning instructions
and affected links; otherwise propose it. Do not write persistent memory or send
tracker/chat messages without the required direct user authorization.

An in-task reviewer can assess a specific difficult lesson; a mandatory panel is
unnecessary. Return the applied change or proposal with evidence and limits.
