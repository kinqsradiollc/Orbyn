---
name: how
description: "Trace source behavior, data flow, ownership and module boundaries before explaining or changing an unfamiliar subsystem."
---

# How

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

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

## Trace a request through its effect

A useful source explanation can follow a screen action → client method → API handler → authorization → transaction → response → rendered state. Stop at the relevant boundary and return those anchors. For an asynchronous path, identify who persists the work and who owns its terminal result.

For a difficult bug, seek the smallest authorized repeatable signal for the
user's exact symptom. Pin material inputs, source and timing where practical;
vary one consequential factor and retain failed attempts. Separate observations
from hypotheses. If runtime access is unavailable, continue bounded source
tracing and name the missing check without claiming a reproduction.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.
