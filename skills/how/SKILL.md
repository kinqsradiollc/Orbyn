---
name: how
description: "Trace source behavior, data flow and dependency impact across code, build and runtime boundaries; reproduce and reduce defects before explaining or changing an unfamiliar subsystem."
---

# How

Follow the consuming project's instructions and requested scope; use the
[portable defaults](../orbyn-workflow/references/project-policy.md) only where guidance is missing.

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

For a requested review explanation or onboarding help, use the
[coaching and review method](../orbyn-workflow/references/engineering-scope.md#onboarding-and-review-that-transfer-understanding).
Explain the concrete failure and smallest correction; pair the failure check with
a legitimate normal-path control (for cleanup, exactly-once release and preserved
result/exception). Do not claim to inspect a patch that was not supplied.

## Trace a request through its effect

A useful source explanation can follow a screen action → client method → API handler → authorization → transaction → response → rendered state. Stop at the relevant boundary and return those anchors. For an asynchronous path, identify who persists the work and who owns its terminal result.

For a difficult bug, seek the smallest authorized repeatable signal for the
user's exact symptom. Pin material inputs, source and timing where practical;
vary one consequential factor and retain failed attempts. Separate observations
from hypotheses. If runtime access is unavailable, continue bounded source
tracing and name the missing check without claiming a reproduction.
Use the [reproduction and reduction method](references/reproduction.md) to pin
the environment, confirm real runner selection and choose a behavioral oracle.
Keep reproduction-only scope distinct from an authorized repair.

For many CI failures, use [pipeline diagnosis](references/pipeline-diagnosis.md)
after the CI owner validates the complete report matrix. Preserve separate source,
test, dependency and environment hypotheses; a symptom cluster is not a confirmed
root cause. Reproduce a discriminating case and controls before correcting its owner.

## Operational method

Use the [local operating method](references/operating-method.md) for the execution
sequence, concrete failure case, expected result and stopping condition. It is
Orbyn-authored guidance; historical source notices remain in provenance.

## Investigation rules and large repositories

Reproduce or label the diagnosis source-derived; trace the first producer of an
invalid state before repairing consumers. Preserve user data. Keep searches bounded,
retain only decision-relevant anchors and record unresolved edges. Use the
[root-cause method](references/principles/fix-root-causes.md) and
[context method](references/principles/guard-the-context-window.md) for concrete checks.
For unfamiliar or cross-package work, use the [impact map](references/impact-map.md):
include build/generator/configuration and runtime registration edges, existing
review/operational owners and deployed consumers only where relevant. Stop when
the decision is supported; a local caller search does not prove deployment coverage.
