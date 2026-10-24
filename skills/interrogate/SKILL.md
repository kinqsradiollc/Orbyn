---
name: interrogate
description: "Challenge a specified design, patch or claim for concrete correctness, ownership and evidence gaps. Use for adversarial review, not every routine edit."
---

# Interrogate

Follow the consuming project's instructions first. Use [Orbyn Engineering policy](../../AGENTS.md) and [host/model guidance](../../docs/agents/model-policy.md) where applicable; load only relevant references.

Pin the candidate and intended contract. Inspect the changed code and affected
callers using [review criteria](../../docs/agents/review.md). Look for scenarios
that falsify the claim, especially lost authority, stale state, partial failures,
concurrency, cleanup and incomplete verification.

The lead may use an independent in-task reviewer for a distinct unresolved risk
under [coordination](../../docs/agents/coordination.md), within the task's shared
child limit. Assigned reviewers inspect their candidate directly without further
delegation. Follow assigned read-only limits and the model policy. Neither
multiple models nor a majority vote establishes correctness.

Deduplicate findings and independently check them. Classify concrete defects,
evidence gaps, optional improvements and dismissed claims. Every actionable item
needs a location, scenario, impact and correction direction. Do not auto-apply
changes during a review-only task. Return a supported verdict and its limitations.

## Review the failure that matters

For an approval change, ask whether a revoked user or stale client can still apply it and whether a retry duplicates the effect. Return a concrete reproducing state and affected owner. Missing native evidence is an evidence gap; it is not automatically a source-code defect.

When challenging a module refactor, inspect what callers must know, which
complexity is hidden, whether the seam reflects actual variation, and whether
behavior checks survive the internal reorganization. Identify a concrete caller
or failure scenario; a preferred vocabulary or file count is not a finding.
