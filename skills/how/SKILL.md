---
name: how
description: "Trace source behavior, data flow, ownership and module boundaries before explaining or changing an unfamiliar subsystem."
---

# How

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Anchor the question in an entry point and follow its real callers, state and
effects. Record inputs, validation, authority, transitions, persistence, output,
errors and cleanup where relevant. Inspect types and configuration alongside code.

Start with a focused search, then read the smallest files needed to complete the
path. Separate source-derived behavior from runtime observations. A filename or
comment alone does not establish execution. Missing links stay explicit.

For a large independent slice, use an in-task explorer subagent with file pointers
and one question; ask for a compact source-cited result. Do not delegate a simple
function explanation. Explain the mechanism first, then critique only if requested.
Use [why](../why/SKILL.md) when intent cannot be established from source.

Return the answer, the few source locations needed to verify it, and meaningful
unknowns. Avoid annotated dumps and unsupported historical explanations.
