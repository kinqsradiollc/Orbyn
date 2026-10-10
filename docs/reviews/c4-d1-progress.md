# C4/D1 delivery record

Started 10 October 2026 from pushed main `6410c65c` on
`codex/c4-docs-parity`. Builder owns implementation until the complete stage
is frozen for Test → Review. Review round: **0/3**. Production deployment is
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
