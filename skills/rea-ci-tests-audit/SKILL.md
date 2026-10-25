---
name: rea-ci-tests-audit
description: "Audit REA test and CI quality when specifically requested; does not run REA qualification for unrelated Orbyn changes."
---

# Audit REA checks and their evidence

Use this local procedure for an explicit REA CI/test assessment. Ordinary application
CI belongs to [CI design](../orbyn-ci-design/SKILL.md); a single product regression
does not require a suite audit. Read the target's local contribution/testing rules.
An audit request does not itself authorize source mutation, a security scan,
publication or engine installation. Execute checks only within the requested scope.

## Establish what actually runs

Pin baseline/candidate revisions, workflow revision, toolchain, host prerequisites,
command and selected tests. Preserve other work in its checkout. A historical pass
belongs to its executed revision. If offline history or runtime is missing, assess
available source/logs and label the missing baseline or lane explicitly.

Trace workflow triggers and path selection through job dependencies, package
scripts, test discovery, fixture generation, subprocesses, artifacts and final gates.
Include runtime registration or generated data absent from import graphs. Check
positive and negative selection paths: required cases should be discovered once
per intended configuration; intentional platform repeats are separate coverage.
A missing explicit test or required report must not become a green zero-test lane.
Optional provider lanes may skip with their prerequisites and missing evidence named.

## Establish a finding

For each suspicious pass/failure, name the expected observable behavior, producer,
consumer and independent oracle. Determine whether a mock reaches the production
boundary it claims to exercise. Preserve intentionally malformed fixture families
and their intended rejection. In an authorized disposable copy, a controlled
failure/mutation can establish whether an assertion or gate detects the regression;
do not modify another session's checkout or weaken the oracle to get green.

Separate reproduced defects, supported costs, hypotheses and unavailable evidence.
For a failing candidate, compare a clean baseline with the same command and conditions
before attributing it. A passing retry does not establish a fix; retain the original
failure and retry only to test a specific transient explanation. Distinguish
fake-provider, boundary and real-engine evidence. Use
[evidence and recovery](../reverse-engineer-anything/references/evidence-and-recovery.md)
for partial observations, timeouts and cleanup.

## Assess cost and deliver

Measure equivalent completed coverage before recommending optimization. Separate
setup/build, execution, instrumentation, dependency waits and runner scheduling.
Prefer removing proven duplicate preparation to deleting distinct assertions.
Preserve malformed input, cancellation, cleanup, identity, permission, capacity
and meaningful concurrency cases where relevant. Cached historical provider success
does not qualify a new runtime, permissions or engine contents.

If fixes are authorized, change the owning boundary and verify affected consumers
and meaningful negative cases. Do not suppress failures, blanket-retry, raise all
timeouts or prune checks solely to make CI green. Full suites are justified by
broad risk or unresolved discovery, not every documentation correction.

Return revision, scope, reproduction, observed/expected result, consequence,
recommended correction and check limitations for each finding. Distinguish local
runs from hosted current-head CI and main verification. Stop at the authorized
assessment/fix; publishing issues, merging or running native providers needs its
own scope. See the [worked example](references/worked-example.md) and
[source record](../reverse-engineer-anything/references/source-record.md).
