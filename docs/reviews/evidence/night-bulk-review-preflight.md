# Known night bulk additions select Review before mutation — 5 October 2026

The422a5a9b full local run ended2840 pass,1 failure,0 skips. The75-task
Overnight review test timed out after Checking the plan before applying. The
old path executed ordinary private additions inside a savepoint before its
runtime aggregate count rolled them back into one Review proposal.

The checker now counts known plain titled create_tasks entries across steps.
More than the existing AGENT_BULK_LIMIT selects the existing night Review path
before running capability steps. Argument validation, source visibility,
destination checks and the whole-plan Review flow remain active. Quick-add
lines may resolve to habits/skips, so they retain runtime aggregate checks.
No count limit, task count, polling interval, test deadline or assertion changed.

- New checker regression failed on unchanged source:
  /tmp/orbyn-night-bulk-preflight-baseline.log.
- Repaired regression passed, including51/75 review and50 below-limit behavior:
  /tmp/orbyn-night-bulk-preflight-fixed.log.
- Backend typechecks passed: /tmp/orbyn-night-bulk-preflight-types.log.
- Serial recovery/night safety/Agenda runtime/permission/signed catalog cohort
  passed53/53,0 failures/skips, terminal0:
  /tmp/orbyn-top3-review-agenda-catalog.log. The unchanged75-task process test
  completed in911ms and verified no tasks persisted and the proposal was pending.

The cohort also contains separate uncommitted Agenda changes; its result does
not qualify an isolated commit or complete the ADR. Re-run focused and full
local/CI on the extracted PR head before promotion. Retain previous timing
failures; this finding does not explain every earlier intermittent timeout.
