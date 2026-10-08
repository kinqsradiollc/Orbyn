# Full ADR checkpoint workflow

Updated 8 October 2026. Canonical agent roles are in `AGENT.md`. Follow the
retained ADR contract and `adr-execution-order.md`; currently complete all C1,
then honor the user's requested pause before C2/M1.

## Implement → Test → Review

1. **Builder implements the full checkpoint.** Reconcile every retained requirement,
   including applicable backend, shared packages and all clients. Use development
   checks to catch defects; do not repeat formal full-suite handoffs for each feature.
   Builder is the software engineer and owns all product/test-code changes,
   including fixes from review and testing. Record missing external/native gates.
2. **Builder freezes and hands off a candidate.** Include cycle ID, exact checkout,
   branch and commit, scope/acceptance matrix, changed files, run instructions,
   evidence links and known gaps. All required code must be committed. One session
   owns writes at a time; no competing edits or duplicate full test runs.
3. **Tester qualifies that commit.** Run appropriate focused/regression/build/runtime
   checks and coordinate required visual evidence. Publish a Markdown report with
   exact source, commands, terminal results, failures and unverified acceptance gates.
   Tester owns formal execution and reports failures to Builder for correction;
   Tester does not patch product/test source. Test retries
   are recorded but do not consume a review round or erase failures.
4. **Reviewer reviews the tested candidate.** Before beginning, persist the next
   round number in the shared current-state artifact: round 1, 2 or 3. Review code,
   full ADR coverage and test/visual evidence. Publish a Markdown report naming the
   commit, round, findings and acceptance decision. Reviewer is review-only:
   inspect code and existing evidence, but never modify product/test source or
   run tests, unit tests or builds. Review reports/status decisions are permitted.
   Each finding guides Builder with file/location, reproduction or reasoning,
   expected behavior and verification needed; do not take coding ownership.
   Three rounds is a ceiling, not a required sequence: approve in round 1, 2 or 3
   when the evidence supports the decision.
5. **Builder fixes → Tester retests → Reviewer inspects.** Builder implements and
   commits the requested fixes, then freezes the revised candidate for Tester.
   Prior results remain historical; Tester records what was rerun and why.
   Reviewer inspects the revised diff and Tester receipts to close existing findings
   within the same round; Reviewer does not execute verification commands.
   Another full review is not automatically required.
   Record the revised commit, retest evidence and closure decision in that round's
   report. A newly initiated full candidate review consumes the next numbered
   round; do not relabel full reviews as closure to bypass the limit. A round-3
   closure still requires verified fixes; unresolved findings require escalation,
   not an unrecorded fourth review.
6. **Close only on evidence.** All required gates, test results and review findings
   must be resolved before full checkpoint acceptance. Record commit/main/push
   separately from production deployment. Code-review approval can precede full
   checkpoint acceptance; required external/native/visual gates remain open until
   evidenced. After round 3, unresolved work remains
   open: record it and report the blocker to the user. Do not advance, waive gates,
   restart the counter under a new cycle ID or claim completion to meet the limit.
   Further review cycles require explicit user direction.

## Visual review cadence

Visual review is **on demand**, not a continuous task or an automatic gate for
every checkpoint. Builder requests Orbyn Visual Check only when a material
layout/interaction change, reproduced visual defect or explicit user request
needs rendered evidence. Functional provider CRUD, persistence, routing, worker
recovery and backend races primarily use tests/API/runtime evidence. Request a
browser check only for their specific visible risk, not their entire test matrix.

- **Justify and bound the request.** Name the changed surface, concrete visual
  risk and finite cases. Use a stable candidate and settled preview. Default to
  one representative web and one mobile-browser case for a shared UI change;
  add widths, themes, overlays or enlarged text only when the change affects
  them or an explicit requirement needs that evidence. No Cartesian matrix.
- **One short batch by default.** Do not request screenshots per edit, commit,
  test run or checkpoint. Reviewer and Tester reuse the same report. A second
  batch needs a named failed/new visual risk and only its affected cases.
  Do not expand an active assignment to unrelated screens or new stages.
- **Finish and return to building.** Stop when the requested cases are checked,
  record findings and untested limits, restore only owned fixture state and
  return the evidence. No repeated login/navigation/captures to fill speculative
  gaps. Missing mandatory evidence remains recorded for a deliberate later
  qualification decision; it does not automatically launch another sweep.
- **Reuse valid evidence.** Record relevant source/runtime equivalence. A new
  commit or documentation change alone does not invalidate earlier UI evidence.
  Backend/docs-only changes need no screenshots unless a concrete visible
  behavior changed. Tests do not prove layout, and screenshots do not prove
  API authority, persistence, billing or native behavior.
- **Respect ownership and tool limits.** One batch/fixture owner at a time;
  do not rebuild or mutate fixtures underneath inspection. On preview/account/
  permission failure, record it and settle requests. No repeated refresh loop
  or alternate browser/port/export workaround for a security restriction.

Visual Check writes one source-qualified Markdown report with viewport, theme,
findings, captures or export limits. Separate browser rendering, accessible markup,
actual assistive-technology and installed-native evidence. Builder reviews it;
Reviewer requests only specific missing/invalidated cases. Stage Tracker reports
coverage without initiating screenshots. This protocol supersedes earlier blanket
visual-matrix instructions: retain explicit user/ADR acceptance requirements,
without treating every functional scenario as a fresh visual assignment.

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
