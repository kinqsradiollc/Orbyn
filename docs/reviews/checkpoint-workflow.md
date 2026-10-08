# Delivery workflow

Applies to features, fixes, refactors and documentation changes. The delivery unit
is the complete scope agreed for the task, not a particular project milestone.
Use [roles](../agents/coordination.md), [development](../agents/development.md) and
[review criteria](../agents/review.md). Keep active project plans and exceptions
in their own records.

## Implement → Test → Review

1. **Builder completes the agreed scope.** Include applicable success, empty,
   loading, error, recovery, authority and client behavior. Prepare needed fixtures
   and instructions. Development diagnostics are allowed; avoid formal handoffs
   of individual fixes or incomplete feature states.
2. **Builder freezes a candidate.** Record checkout, branch, commit, requirements,
   changed files, verification plan, prerequisites and known limitations.
3. **Tester verifies that candidate.** Choose checks proportionate to the change:
   tests, types, builds and runtime evidence as applicable. Write commands, source,
   terminal results, failures and untested requirements in one Markdown report.
   Tester reports defects to Builder; no product/test-source edits.
4. **Reviewer assesses code and evidence.** Inspect requirement coverage, code
   quality, security, test assertions and Tester results. Give Builder prioritized,
   specific findings with expected behavior, correction guidance and verification.
   Reviewer writes reports/decisions but does not code or execute tests/builds.
5. **Builder fixes the batch → Tester retests → Reviewer closes findings.** Freeze
   the complete revision. Retest affected behavior and explain retained evidence.
   Reviewer inspects the revised diff and receipts; do not restart a full review
   merely to close verified fixes.
6. **Builder delivers accepted work.** Resolve all retained requirements/findings
   before claiming completion. Record actual merge, push and deployment separately.
   Respect the requested stop, deployment owner and cleanup scope.

Documentation-only work uses appropriate document/link/format checks; do not
start product test suites, native builds or visual sweeps simply for rule changes.
Choose a coherent delivery scope for small fixes; do not manufacture a large
project milestone or new acceptance gates.

## Review limit

Maximum **3 full review rounds**, not three mandatory rounds. Persist the cycle
and next round before each full review; approval can happen in any round.
Verified closure can finish the existing round. A newly initiated full review
consumes the next round; never relabel it as closure to bypass the limit.

After round3, unresolved findings stay open. Report them and obtain user direction;
do not silently reset the cycle, start a fourth round or waive requirements.
Test retries do not consume review rounds or erase failed attempts.

## Handoff record

| Field          | Record                                                                                  |
| -------------- | --------------------------------------------------------------------------------------- |
| Scope          | Task/cycle ID, full agreed requirements and explicit exclusions                         |
| Candidate      | Exact checkout, branch, committed source and changed files                              |
| Phase / owner  | Implementing, testing, reviewing, retesting, accepted, blocked or paused; current owner |
| Readiness      | Required fixture/runtime/input available; executable instructions                       |
| Review counter | Current round0–3 and prior findings/closure                                             |
| Evidence       | Tester/Reviewer reports, applicable runtime/visual receipts and limits                  |
| Delivery       | Candidate, main merge, confirmed push and deployment as separate facts                  |
| Next action    | Remaining findings/dependencies, next owner or requested pause                          |

Keep task-specific records under `docs/reviews/` or the agreed artifact location.
Link reports from the task's status record; preserve earlier failures and sources.
Older green checks apply only with relevant source/dependency equivalence. A partial
TAP log, intent to merge or observation timeout does not prove completion.

## On-demand visual evidence

- Request **Orbyn Visual Check** only for material UI/interaction changes,
  reproduced visual defects or an explicit user check. Name the concrete risk,
  candidate, URL/renderer, finite cases and expected report location.
- Use shared web preview and Expo web mobile preview. Narrow web alone is not the
  mobile renderer. Do not add excluded native/enlargement jobs.
- Default to one bounded batch; reuse valid evidence. Extra cases need an unresolved
  or newly introduced visual risk. No sweep per edit, test run or documentation change.
- One owner controls the fixture. Do not rebuild/mutate it during inspection.
  Report capability/permission/export limits without bypassing restrictions.
- Stop after the requested cases, restore only owned state and return one Markdown
  report with source, viewport, theme, findings and captures/export limits.
  Separate browser rendering, DOM accessibility and actual native/assistive behavior.
- Tests do not prove layout; screenshots do not prove API authority, persistence
  or billing. Missing required evidence stays visible until obtained or explicitly
  removed by the user.
