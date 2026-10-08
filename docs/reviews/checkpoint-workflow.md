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
