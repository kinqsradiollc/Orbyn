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

For substantial investigation, the owning lead delegates bounded source questions
to named native Orbyn Investigators under the [workflow](../orbyn-workflow/SKILL.md).
Pass file pointers and ask for a compact source-cited result. Keep at most two
children active, with no recursive delegation; a child traces its assigned path
directly. Narrow explanations stay direct. The lead inspects the evidence,
reconciles contradictions and owns the final explanation. Explain the mechanism first, then critique only if requested.
Use [why](../why/SKILL.md) when intent cannot be established from source.

Return the answer, the few source locations needed to verify it, and meaningful
unknowns. Avoid annotated dumps and unsupported historical explanations.
