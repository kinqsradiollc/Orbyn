---
name: rea-analysis-optimization
description: "Optimize a measured REA analysis bottleneck while preserving evidence and resource ownership; scoped to REA."
---

# Optimize a completed REA investigation

Use this for REA analysis cost, not ordinary application performance or test-suite
speed. Read the consuming checkout's instructions and current implementation;
[how](../how/SKILL.md) owns tracing unfamiliar source. This local procedure does
not require an upstream webpage or authorize target execution, tests or edits
outside the task. Route suite costs to [REA CI audit](../rea-ci-tests-audit/SKILL.md).

## Define the task and oracle

State the analyst question and facts needed to finish it. Pin source revision,
artifact digest, provider/tool versions, architecture/options, detail and allowed
workload. Include a representative large input and a small/empty case when
measurement is authorized. Preserve an unchanged baseline in an isolated checkout.

Choose correctness evidence independent of the proposed optimization: known
fixture facts, independently mapped bytes or a verified producer interpretation.
Two adapters sharing the same decoder are not independent oracles. Preserve
same-address alternatives, unresolved relationships, coverage and evidence IDs.
If source, artifacts or runtime are unavailable offline, produce a bounded
measurement plan and mark measurements unrun; do not invent before/after numbers.

## Find the owning cost

Trace the public CLI/MCP path through admission, producer work, decoding, lookup,
projection, serialization, retention and cleanup. Measure phases relevant to the
completed task, including extra discovery/query calls. Smaller replies can leave
CPU and peak memory unchanged. Fix incorrect or missing facts before comparing
performance across different coverage.

Prefer eliminating repeated interpretation or scanning at its owner. Push
selection to the earliest capable boundary, reuse validated immutable facts when
appropriate, and avoid a new cache/index without a demonstrated cost. For reuse,
define key, owner, invalidation, retained size and lifetime. Include result-affecting
bytes, engine/schema/options and mapping; revalidate live state before calling it
current. Partial, cancelled or transient failures need their own retry policy.

Preserve independent caller cancellation and one shared producer's ownership.
A cancelled waiter must not corrupt peers. Bound process-family memory and retained
state, not just the parent's heap. Keep capacity charged until work and cleanup
settle; a guard-stopped investigation is incomplete. Use the shared
[evidence and recovery method](../reverse-engineer-anything/references/evidence-and-recovery.md)
when retaining partial observations or unresolved resources.

## Compare and stop

When authorized, compare equivalent completed tasks on the baseline and candidate.
Separate fresh sessions, warm caches and OS cache conditions. Include total and
phase time, CPU, peak process-family memory with accounting method, coverage,
resource stops and cleanup. Retain failed attempts and inspect the payload's exit
status, not only the profiler's. Token claims need discovery, arguments, responses,
retries and continuations; label estimates separately from observed model usage.

Return the bottleneck, owning change or justified no-change decision, correctness
oracle, measured scope, before/after evidence and limits. Stop when the demonstrated
cost is resolved or further benefit is speculative. See the
[worked example](references/worked-example.md) and shared
[source record](../reverse-engineer-anything/references/source-record.md).
