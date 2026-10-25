# Offline CI evidence format, version 1

The consumer owns the provider adapter, expected matrix and release policy.
The [bulk method](bulk-failures.md) owns interpretation; JSON values are data,
never shell code. All paths below are synthetic. Use Python 3.11+.

## Plan and reports

`plan.json` is a JSON object with `schema_version: 1`, nonempty `repository`,
boolean `inventory_complete`, `baseline`, `candidate`, `slots` and `runs`.
Each cohort has `revision` (full lowercase 40/64 hex commit) and
`artifact_sha256` (64 lowercase hex digits, no `sha256:` prefix).
The baseline can have a different revision/artifact; comparison configuration
must match the same slot. A failed historical baseline does not excuse a failing
candidate. Missing historical evidence is incomplete comparison, not a pass.

Each slot has unique `id`, plus `suite`, `environment`, `instance`, `variant`,
`shard`, `config_sha256` and positive `min_tests`. The five dimensions must also
be unique. Every slot is required in this contract; represent only the project's
required matrix and record optional lanes separately. There are no inferred wildcard
slots or silent required-to-optional conversions. Set minimums from maintained
selection policy, not from a suspiciously reduced observed run.

Each run entry represents one complete job attempt:

```json
{
  "cohort": "candidate",
  "slot": "uat/linux/integration/1",
  "attempt": 1,
  "run_id": "provider-job-123-attempt-1",
  "status": "success",
  "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "artifact_sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "config_sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "path": "reports/job-123.jsonl",
  "sha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
}
```

Values above are illustrative, not a runnable receipt. `run_id` is globally unique
within the plan. Attempt integers start at 1 and retain contiguous history for
each cohort/slot. Status is `success`, `failure`, `cancelled`, `timed_out` or
`pending`. Missing reports/status are blockers, including an invalid newest attempt.
Each report is one complete normalized attempt for its slot; when a runner emits
several files for one job, the adapter streams them into that attempt and verifies
the complete input list first. Preserve raw files and conversion receipts.

Report paths are relative to the plan directory and must resolve inside it.
The analyzer hashes the exact streamed report bytes and validates cohort revision,
artifact and slot configuration before accepting any rows. An invalid/duplicate
row rolls back the entire report. Hashes detect drift; they do not authenticate
untrusted assertions about runs, tests or permissions.

Normalized UTF-8 JSONL has one object per test, including passes/skips:

```jsonl
{"test_id":"Checkout[EUR]/reject-negative-total","status":"passed"}
{"test_id":"Checkout[EUR]/replace-discount","status":"failed","failure_type":"AssertionError","message":"expected 20, observed 25"}
```

Status is `passed`, `failed`, `error` or `skipped`. Failures/errors require nonempty
`failure_type` and bounded `message`; a stable `test_id` includes meaningful
parameterization and is unique within that slot/attempt. Different slots/attempts
retain separate rows. Avoid mutable timestamp/path/worker IDs in test identity.
Only use normalization justified by the runner contract; changing an assertion
value must not disappear into a fingerprint. Additional fields do not establish
authority or alter the evidence gate. Unknown test states fail validation.

## Release inputs

`verify-release` re-analyzes the raw plan/reports; it never trusts an edited
summary's ready flag. Add `stage_runs` to the plan: a map from stage environment
to the expected current aggregate stage run ID. Every job in a stage still needs
its report; an aggregate success cannot replace missing matrix slots.

The consumer's release policy is a JSON object with:

- `schema_version: 1`, `repository`, `revision`, `artifact_sha256`, all matching
  the candidate, and nonempty `target_environment` identifying the assessed target.
- `max_age_seconds`: integer 1..604800, chosen by the project.
- `required_stages`: nonempty unique list of objects containing `environment`,
  `config_sha256` and expected `run_id`. Each must match the plan's stage mapping
  and configuration of its covered slots. Stages may execute in parallel;
  this helper does not model ordered deployment transitions.

Stage evidence is a JSON array with exactly one record per required stage. Each
record has those three stage fields plus `repository`, `revision`,
`artifact_sha256`, `analysis_plan_sha256`, `conclusion` and `completed_at`.
Only `success` is accepted. `completed_at` is an ISO timestamp with timezone,
not in the future and not older than policy at actual verification time.
The plan digest binds the complete expected matrix and attempt inventory.
The verifier hashes the actual `--artifact` file and compares its bytes too.

The output distinguishes `ci_evidence_ready` and `release_evidence_ready`.
Neither means deployed, approved or authenticated by a hosted provider. A valid
release-evidence result requires both CI and stage checks. Malformed policy/input
exits with an error; it cannot produce a successful release result.

For runnable original inputs, use the
[disposable pipeline lab](../../orbyn-skill-creator/references/pipeline-execution.md).
Real reports, policy and provider-specific adapters stay in the consumer, outside
the portable library's catalog, exports and synchronization.
