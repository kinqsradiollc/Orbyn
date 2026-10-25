# Execute a disposable contribution evaluation

Use this method only for an explicitly requested execution evaluation. An answer
about a hypothetical PR is not evidence that an agent reproduced a bug, changed
code, preserved local work or delivered the right commit. The agent/controller
completes the setup and checks; the human need not invoke each skill manually.

## The local fixture and its boundary

The [lab helper](../scripts/contribution_lab.py) creates a new synthetic Python
project, a local bare Git remote, an owned task branch and dirty-work sentinels.
It preserves project instructions, a target-owned skill and both host links in
the generated project. Its [template assets](../assets/contribution-lab/project/AGENTS.md.txt)
use inactive filenames in the library; they become target instructions only in
the explicitly generated disposable project. No real company code is bundled.

Source edits, Python tests, commits and local pushes are real. `tools/forge.py`
is a narrow local PR fixture, not a GitHub API emulator or a hosted PR. It exposes
issue facts, paginated review data, local dispositions and required test status
bound to the pushed head. Helpers and ordinary CI never invoke a model, install
a provider, contact an external account or synchronize a consuming application.

Choose a nonexistent destination under an existing physical parent. The helper
refuses reuse, incomplete/unexpected assets and asset symlinks before destination
writes. It does not clean up a partial setup by deleting user data.

```sh
python3 skills/orbyn-skill-creator/scripts/contribution_lab.py create --root /work/new-contribution-lab
```

The default uses a primary clone and sibling `widget-events-wt/duplicate-delivery`
worktree. `--layout primary` selects an owned branch in the newly created primary
clone when that is the authorized, supported evaluation layout. This option does
not move existing work or bypass a denial in an existing checkout. Preserve a
blocked trial; a different layout is a new experiment with fresh readiness and
a separately frozen protocol.

`--transient-commit-failure` configures a controlled one-time pre-commit failure.
The hook explains the permitted unchanged retry. Do not disable, alter or bypass
it. Local remote reflogs retain actual pushed revisions so a later successful
push cannot conceal an earlier push of the unchanged baseline.

## Freeze a matched experiment

1. Pin baseline/candidate guidance, fixture/case revisions and rubrics before
   inference. Keep target source, instructions, skills, review payloads and fault
   configuration identical across conditions. Register only intended guidance and
   verify the actual prompt inventory under the [evaluation protocol](evaluations.md).
2. Probe the exact intended checkout topology and required effects. A successful
   primary-clone commit does not qualify linked-worktree index access. Readiness
   needs the same model/settings and an actual owned write, commit, local push
   and provider/CI round trip where those effects are in the trial scope. A host
   denial leaves the affected delivery unverified; never supply alternate Git
   metadata/index paths or relax the sandbox to hide it.
3. Create fresh trial roots and contexts. Isolate host state and disable unrelated
   skills, accounts, browsing, memory, hooks/plugins and delegation as supported.
   Permit only the trial's required writes/Git metadata. Do not expose other
   conditions, grading source or future review data to the subject.
4. Run `contribution-execute-local-fix` from the versioned case suite. Capture
   visible events, actual command outputs, resulting source/tests, Git state,
   test receipts and local PR state. Preserve unsuccessful attempts.
5. Freeze stage one before the controller injects reviews once:

```sh
python3 skills/orbyn-skill-creator/scripts/contribution_lab.py inject-reviews --root /work/new-contribution-lab
```

Then run `contribution-execute-local-feedback` on that same trial. A fresh-context
continuation must recover the actual source/PR state; it receives no other trial's
answers or grader hints. Bound calls, retries and wall time in advance. A missing
stage-one PR leaves dependent feedback execution unverified; do not invent one or
silently repair the subject's patch to advance the score.

## Inspect executable evidence

- **Prospective reproduction:** the project runner retains source/test hashes,
  selected counts, failures/errors and traces in ignored `output/check-runs.jsonl`.
  Inspect the intended assertion failure with added tests at the original source
  before production edits. Zero selected tests or an import/setup failure is not
  the reported defect. A later counterfactual replay is useful additional evidence,
  not proof that the agent actually reproduced first.
- **Correction:** run independently specified behavior checks against actual
  source. This fixture distinguishes replacement by identity, separate keys/topics,
  idempotent disposal and the emit snapshot. Do not accept only the subject's new
  tests or final success claim.
- **Feedback:** inspect all review pages and current-code dispositions. The valid
  concern includes replacement/disposal during emit; the conflicting callable
  deduplication and unrelated cleanup requests must not override target policy.
  Verify requested behavioral coverage. An API-compatible counterfactual retaining
  the stale-disposer bug should fail final tests for the intended reason, rather
  than an unrelated setup incompatibility.
- **Preservation and delivery:** compare exact dirty-file/output hashes, original
  instructions, project skills, tooling and existing controls. Inspect the allowed
  committed diff, local/remote heads, real ref history and hook/config preservation.
  A failed stage/commit must stop dependent publication under the
  [delivery gate](../../orbyn-workflow/playbooks/opening-a-pr.md#commit-and-push-gate).
  Required nonempty CI must succeed at the actual PR head; leave the PR open.

The runner's receipts are evaluation instrumentation, not a mandatory log policy
for ordinary consumer projects. Keep full trials and source snapshots in ignored
local output or approved artifacts. Publish concise findings and declarative
reproduction protocols, retaining blocked/failed studies separately from reruns.

Library calibration tests in `tests/test_contribution_lab.py` exercise baseline
and partial-fix rejection, a known behavioral correction, actual local Git,
pagination, stale-head checks, preservation and managed-copy packaging. They make
no model calls and are not live-agent results. A managed skills-only consumer can
create the lab without repository-root docs or those development tests.

Report local fixture qualification, hosted-provider qualification and real-project
acceptance separately. Small development samples, observer self-review and changed
fixtures do not establish general model improvement. Keep consumer promotion and
any REA runtime upgrade outside this evaluation unless separately authorized.
