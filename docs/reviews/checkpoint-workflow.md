# Full ADR checkpoint workflow

Updated 8 October 2026. Canonical agent roles are in `AGENT.md`. Follow the
retained ADR contract and `adr-execution-order.md`; currently complete all C1,
then honor the user's requested pause before C2/M1.

## Implement → Test → Review

1. **Builder implements the full checkpoint.** Reconcile every retained requirement,
   including applicable backend, shared packages and all clients. Use development
   checks to catch defects; do not repeat formal full-suite handoffs for each feature.
   Record missing external/native gates without reducing scope.
2. **Builder freezes and hands off a candidate.** Include cycle ID, exact checkout,
   branch and commit, scope/acceptance matrix, changed files, run instructions,
   evidence links and known gaps. All required code must be committed. One session
   owns writes at a time; no competing edits or duplicate full test runs.
3. **Tester qualifies that commit.** Run appropriate focused/regression/build/runtime
   checks and coordinate required visual evidence. Publish a Markdown report with
   exact source, commands, terminal results, failures and unverified acceptance gates.
   Failed tests return to the write owner for correction and retesting. Test retries
   are recorded but do not consume a review round or erase failures.
4. **Reviewer reviews the tested candidate.** Before beginning, persist the next
   round number in the shared current-state artifact: round 1, 2 or 3. Review code,
   full ADR coverage and test/visual evidence. Publish a Markdown report naming the
   commit, round, findings, fixes and acceptance decision. Reviewer may fix defects
   within the checkpoint after taking sole write ownership from Builder.
5. **Retest every revised candidate.** Commit fixes and return the new source to
   Tester. Prior results remain historical; Tester records what was rerun and why.
   Review the verified revision in the next numbered round. A final round-3 fix
   still requires Tester verification and Reviewer closure of that round's findings;
   new unresolved findings require escalation, not an unrecorded fourth review.
6. **Close only on evidence.** All required gates, test results and review findings
   must be resolved before full checkpoint acceptance. Record commit/main/push
   separately from production deployment. After round 3, unresolved work remains
   open: record it and report the blocker to the user. Do not advance, waive gates,
   restart the counter under a new cycle ID or claim completion to meet the limit.
   Further review cycles require explicit user direction.

## Visual review cadence

Visual review is a checkpoint gate, not a task after every edit. Builder sends
one consolidated request to Orbyn Visual Check once the candidate UI and compiled
API are stable, package builds are complete, preview reloads have settled, and
fixture ownership is agreed. Code/unit/type checks can run during implementation
without repeatedly opening screens. Do not change fixtures underneath a live
visual batch or trigger package rebuilds that disrupt its account/session.

- **Choose cases by impact.** List changed flows, affected shared controls, known
  defects and required acceptance states before requesting captures. Layout or
  typography changes need affected narrow/wide/short-height and enlarged-text
  cases; theme changes need both themes; behavior changes need the relevant
  success/loading/error/recovery, draft, keyboard and overlay paths. Shared shell
  or token changes need representative affected surfaces across both clients.
- **Batch evidence.** Cover distinct layout boundaries and meaningful states,
  rather than every combination of viewport, theme and action. Use the smallest
  matrix that proves the changed scope, retaining all explicit ADR requirements.
  Capture images at meaningful checkpoints or reproduced defects; do not export
  duplicate unchanged frames or repeat login/navigation for each assertion.
- **Target rechecks.** After fixes, rerun failed cases and flows affected by the
  fix. Repeat the wider matrix only when shared layout/navigation/styles or
  runtime behavior changed enough to invalidate it. Do not rerun visual checks
  merely because tests, documentation or commit metadata changed.
- **Reuse honestly.** Link prior reports and record relevant UI/shared-control/
  runtime source equivalence, viewport/state and limitations. A different SHA
  alone does not invalidate unchanged visual evidence; matching screenshots
  alone do not establish functional equivalence. New or changed states still
  need evidence. Backend-only changes that alter visible status/errors require
  affected-flow checks; purely invisible backend or prose-doc changes do not.
- **Stop churn.** If the preview, account or fixture fails, record the failure,
  notify its owner and settle requests. Resume after confirmed recovery with one
  explicit retry. Do not repeatedly refresh, rebuild, restart or capture the same
  blocked screen. Permission/export restrictions remain in force.

Visual Check writes one source-qualified Markdown report per batch, appending
rechecks and retaining failures. Separate browser rendering, accessible markup,
actual assistive-technology behavior and installed-native evidence. Builder
reviews the delegated evidence; Tester references it instead of duplicating
browser work; Reviewer requests only specific missing or invalidated cases.
Stage Tracker reports evidence coverage without initiating repeat captures.
Unverified required states remain open: this cadence reduces duplicate work,
not the full ADR scope or its acceptance standard.

## Shared record and handoffs

`docs/reviews/adr-current-state.md` is the current cycle index; its linked acceptance
ledger retains the detailed history. Update both as applicable at each handoff:

| Field | Required value |
| --- | --- |
| Cycle and scope | Stable cycle ID and full ADR checkpoint |
| Phase and owner | Implementation, testing, review, retesting, accepted or blocked; sole write owner |
| Candidate | Exact checkout, branch and committed source |
| Review counter | 0/3 before review; persist 1/3, 2/3, 3/3 before each round |
| Evidence | Tester/Reviewer Markdown reports, visual reports, terminal results |
| Remaining work | Unresolved findings and native/external gates |
| Delivery | Candidate, main merge, confirmed push, deployment separately |

Use cycle-specific report names such as `c1-full-2026-10-08-test-r1.md` and
`c1-full-2026-10-08-review-r1.md` under `docs/reviews/`. Preserve prior reports;
append a dated retest/closure entry rather than replacing failures with passes.
Tester and Reviewer wait for the exact candidate handoff before starting formal
qualification. Stage Tracker reads these files to report status; Builder need not
duplicate routine status tables. Messaging still requires user authorization.
