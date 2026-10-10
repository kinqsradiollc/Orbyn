# C4/D1 delivery record

Started 10 October 2026 from pushed main `6410c65c` on
`codex/c4-docs-parity`. Builder owns implementation until the complete stage
is frozen for Test → Review. Review round: **1/3**. Production deployment is
user-owned.

| Area               | Implemented on this branch                                                                                                                                                                                                                                                                      | Qualification still required                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Complete ownership | Versioned format 2 creation, reads/writes, leaf and structure operations, extraction, linking, clipping, checklist/task state, history snapshots and restore retain the container tree. Legacy clients receive only the supported projection. | Tester checks the frozen candidate, including auth, conflict and history paths. |
| Normal editor      | New pages begin in format 2 on web and mobile. Both clients open full ownership and use one title/content revision with source and preview, serialized saves, live revision reconciliation and explicit conflict retention. Mobile queues a failed offline save; navigation waits for a save or queue receipt. | Tester report and functional client checks where available. |
| Page actions       | Structured web editor has comments, history preview/restore and version-fenced export. Mobile keeps the existing comments/history sections and offers export, move and library actions.                                                                                                         | Confirm rendered layout and keyboard behavior where permitted.                                     |
| D1 content         | Existing Markdown, reference, frontmatter, math, code and restricted Mermaid renderers and export adapters are retained. Source/preview shares one draft; web source ranges map to preview blocks.                                                                                              | Tester selects the required syntax, diagram, malformed input and export checks for this candidate. |

Builder diagnostics so far: `npm run typecheck` passed for shared packages,
backend, desktop and mobile. Focused structured storage/editor/source/export/
Markdown/Mermaid/math run: **115 passed, 0 failed, 0 skipped** against the
disposable `orbyn_test` database. The candidate is not yet accepted or on main.

Explicit user exclusions: no separate desktop-app check, installed iOS or
Android build, or exhaustive 200% retest. The user stopped routine Visual
Check; no browser screenshot result is claimed here.

Tester execution record for the superseded `c270a9bc` candidate: see
[`c4-d1-tester-r1-c270a9bc.md`](./c4-d1-tester-r1-c270a9bc.md). The later
exact-candidate execution is recorded below.

Reviewer round 1 decision on `1b76c6c3`: **changes required**. Report:
[`c4-d1-review-r1.md`](./c4-d1-review-r1.md).
Open findings: invalid-source validation cleared by unrelated edits/receipts;
mobile offline acknowledgment without durable, draft-specific persistence;
missing structured-editor fragment navigation. The report also identifies
targeted test receipts and the pending confirmation-dialog interaction check.
Builder corrected all three findings in source and added store/storage regressions.
Full workspace typecheck and 52 targeted checks pass on the working revision.
Tester owns the final source-exact execution, including the app-dialog interaction
now that the user has approved local QA sign-in. Reviewer owns closure. No
main-integration acceptance yet.

## Tester execution — 45a80ca

Tester retested the exact frozen candidate `45a80ca14a0de54148e804111642f38c1257aed4`.
The focused ownership and durable-receipt suites passed 91/91, workspace typecheck
passed, and section-navigation tests passed 2/2. The History restore modal and
same-page fragment navigation passed on the available web surfaces. R1 invalid
source recovery passed interactively on web and Expo web. **Disposition: HOLD**
because cross-page structured-document links with a fragment still return HTTP
409 on both surfaces and do not open the initial target. The complete execution
record, remaining limits, and cleanup evidence are in
[`c4-d1-tester-r2-45a80ca.md`](./c4-d1-tester-r2-45a80ca.md). No acceptance,
merge, push, or deployment is claimed.

## Builder correction after the 45a80ca hold

The web and mobile deep-link entry points now read format 2 Docs with the
editor-capable API before opening a cross-page fragment. The structured editors
show a concise in-page message for a missing target instead of sending that
navigation result to the generic global error handler. Full workspace typecheck
passed after these edits. The revised candidate still needs Tester's focused
web and Expo web cross-page, initial-target, and missing-target retest, followed
by Reviewer closure; it is not yet accepted for main.
