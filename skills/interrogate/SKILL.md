---
name: interrogate
description: "Challenge a specified design, patch or claim for concrete correctness, ownership and evidence gaps. Use for adversarial review, not every routine edit."
---

# Interrogate

Follow [repository policy](../../AGENTS.md) and [model/agent policy](../../docs/agents/model-policy.md). Use only relevant references.

Pin the candidate and intended contract. Inspect the changed code and affected
callers using [review criteria](../../docs/agents/review.md). Look for scenarios
that falsify the claim, especially lost authority, stale state, partial failures,
concurrency, cleanup and incomplete verification.

Use one independent in-task reviewer where useful; add a second only for a distinct
unresolved risk. Follow assigned read-only limits and the model policy. Neither
multiple models nor a majority vote establishes correctness.

Deduplicate findings and independently check them. Classify concrete defects,
evidence gaps, optional improvements and dismissed claims. Every actionable item
needs a location, scenario, impact and correction direction. Do not auto-apply
changes during a review-only task. Return a supported verdict and its limitations.
