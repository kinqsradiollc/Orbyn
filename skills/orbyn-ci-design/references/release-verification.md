# Verify the evidence for promotion

Use after bulk diagnosis/correction or when assessing release readiness. The
agent obtains already-authorized project evidence and evaluates the existing
release policy. Do not ask for repeated approval of routine checks covered by the
task; missing production authority remains a distinct boundary.

1. Resolve the intended repository, source revision, built artifact digest and
   target environment. Inspect the consumer's current release policy and required
   stage matrix. Environment names such as UAT/VT are project data, not fixed
   universal meanings. A green PR or local suite alone is not release evidence.
2. Collect complete current job/report data and preserve failed attempts using
   [bulk analysis](bulk-failures.md). Verify the candidate or merge-queue revision
   actually tested. A rebuild with different bytes is a new artifact requiring
   its own qualification, even if its source commit is unchanged.
3. Bind each required stage to repository, exact source, artifact, configuration,
   current aggregate run identity, complete analysis plan and completion time.
   Reject absent/cancelled/skipped, stale, future, duplicated or conflicting
   evidence. Confirm provider pagination and status semantics outside the helper.
4. Verify the actual artifact to be promoted; keep raw inputs/receipts in approved
   project output. The local helper assesses a new immutable evidence snapshot:

```sh
python3 skills/orbyn-ci-design/scripts/ci_evidence.py verify-release --plan /work/run/plan.json --policy /work/run/release-policy.json --evidence /work/run/stages.json --artifact /work/run/build.bin --output /work/run/release-analysis
```

5. Inspect `release_evidence_ready`, all blockers and the actual command exit.
   Exit 0 is evidence readiness only. Match the provider's required rules and
   existing deployment authorization before an external effect. Do not infer
   approval, authenticated attestations or production access from local JSON.
   Consume this gate in an already-authorized pipeline that fails on nonzero exit;
   a soft-failure or warning-only integration is not a release gate.
6. Re-evaluate after a new head, artifact/configuration change, retry or stage
   result. Observe real deployment health and recovery only within authorized
   scope. Report evidence-ready, promoted, deployed and production-healthy as
   separate states. This helper has no deploy, rollback or approval command.

Record rollback artifact/procedure, migration compatibility and operating owner
in the consumer's existing release guide. The portable verifier does not validate
those procedures or simulate a production rollout. If the project needs ordered
stage transitions, sign-offs, exception expiries or a canary, preserve its existing
orchestration rather than claiming a parallel evidence set enforces that order.

Do not weaken a required test, discard the original failed attempt or promote
despite unknown evidence simply to achieve a one-attempt-green target. Baseline
failures and infrastructure problems need diagnosis and disposition; neither is
automatic permission to waive the candidate's required checks.

Independently authored guidance reviewed 25 October 2026 against
[GitHub environment protection](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments)
and [artifact digest validation](https://docs.github.com/en/actions/tutorials/store-and-share-data).
Provider behavior must be checked for the actual consumer. The local instructions
are usable without following these attribution/update links.
