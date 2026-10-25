# Exercise a disposable multi-suite pipeline

Use for an authorized execution/capacity evaluation of the
[bulk CI method](../../orbyn-ci-design/references/bulk-failures.md) and
[release verifier](../../orbyn-ci-design/references/release-verification.md).
The agent completes these steps; the human need not invoke every helper.
These deterministic fixtures make no model/provider calls and do not deploy.

## Real tests and controlled correction

The original [pipeline lab](../scripts/pipeline_lab.py) creates a new local Git
project, three source revisions and immutable reports. It refuses an existing
destination or a symlinked/nonexistent parent. Use a physical existing parent:

```sh
python3 skills/orbyn-skill-creator/scripts/pipeline_lab.py create --root /work/new-pipeline-lab --tests-per-suite 1000
```

It runs actual stdlib `unittest` cases through three suites (unit, integration,
contract), three named environments (test, uat, vt), and two instances: 18 matrix
slots. At 1,000 cases/slot there are 18,000 executions per source phase and 54,000
overall. The build artifact is this tiny fixture's exact product-source bytes.
It is not a production package, VM environment, network dependency or deployment.

- Baseline contains a known source defect at one input boundary.
- Broken candidate retains it, introduces a negative-total regression and simulates
  an unavailable dependency in integration tests. The errors come from actual
  testcase execution, not manufactured success/failure counters.
- Fixed candidate corrects the source and restores the controlled dependency flag.
  The controller deliberately applies these known fixture changes; this does not
  show that a model independently diagnosed or repaired them.

The lab preserves a dirty tracked note and ignored output, actual source commits,
raw normalized reports, runner receipts, plans, local artifact bytes, release
policy and stage records. It never sends a reply, pushes, merges or syncs a consumer.
Keep the whole lab in ignored local output or approved artifacts.

```sh
python3 skills/orbyn-ci-design/scripts/ci_evidence.py analyze --plan /work/new-pipeline-lab/broken-plan.json --output /work/new-pipeline-lab/broken-analysis
python3 skills/orbyn-ci-design/scripts/ci_evidence.py verify-release --plan /work/new-pipeline-lab/fixed-plan.json --policy /work/new-pipeline-lab/fixed-policy.json --evidence /work/new-pipeline-lab/fixed-stages.json --artifact /work/new-pipeline-lab/fixed-artifact.bin --output /work/new-pipeline-lab/fixed-analysis
```

The broken analysis must exit 1, retain every failure and report blockers. The
fixed release evidence must exit 0 with both readiness fields true. Check the
actual artifact/report hashes, notes/output and Git dirty status too. Preserve
both analyses; do not rerun into an existing output directory.

At 1,000 cases/slot, the broken candidate has 6,000 integration errors, 4,800
assertion failures and 7,200 passes. Comparison identifies 2,400 existing,
7,200 new and 1,200 changed failure symptoms. Fixed candidate has 18,000 passes
and resolves the baseline's 3,600 failing cases. These are fixture expectations;
report only observed results after running them.

## Inject evidence faults

Copy the small plan/stage metadata into a fresh evaluation scenario without
overwriting the original. Alter one factor at a time, retaining report history:
missing slot/report, corrupt hash, duplicate identity, lost retry attempt,
latest cancelled run, zero/all-skipped selection, removed baseline tests,
wrong artifact/config/run identity, absent stage, stale/future evidence.
The analyzer/verifier must refuse readiness for each relevant fault. A fail/pass
retry must retain its earlier failure and block undispositioned instability.
Do not add a waiver merely to obtain a green result.

The root library's `tests/test_ci_evidence.py` exercises these boundaries and
skills-only packaging. That development file is not required in a consumer;
the packaged helpers and this method run without root docs/tools or a network.

## Capacity is a separate experiment

Use generated normalized records to measure ingestion/query costs beyond the
small application fixture. They are not actual application test executions:

```sh
python3 skills/orbyn-skill-creator/scripts/pipeline_lab.py stress --root /work/new-capacity-lab --records-per-cohort 500000 --failure-every 10
python3 skills/orbyn-ci-design/scripts/ci_evidence.py analyze --plan /work/new-capacity-lab/plan.json --output /work/new-capacity-lab/analysis
python3 skills/orbyn-ci-design/scripts/ci_evidence.py failures --database /work/new-capacity-lab/analysis/evidence.sqlite > /work/new-capacity-lab/all-failures.jsonl
```

This produces 1,000,000 indexed records across baseline/candidate, with 50,000
candidate failures in 1,000 exact symptom groups. Analysis must exit 1, not become
ready because the top-cluster summary is limited to 20. Verify counts in SQLite
and the streaming export. Use `--failure-every 0` for an all-pass control.

Record exact helper revision/hashes, Python/platform, records/messages/slots,
wall time, fresh-process peak RSS and database size. Separate input generation
from analyzer timing. Include scale points, errors and resource limits. Do not
infer million-job, maximum-byte, concurrent-writer, hosted-provider or general
agent qualification from million-row throughput. A single local run is an observed
capacity point, not a portable performance guarantee or statistical benchmark.

For a live agent evaluation, freeze guidance, inputs, rubric, resource bounds and
baseline/candidate conditions before calls under the [evaluation protocol](evaluations.md).
The lab and ordinary CI never invoke a model automatically. Do not label a helper
test or controller-applied correction as a live Codex/Claude result.
