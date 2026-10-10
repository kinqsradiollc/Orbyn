# C4/D1 Tester addendum — 428c7b4d

**Affected mobile retest: PASS.** On the exact frozen candidate, an invalid Source buffer stays on the target after following its object link; the editor shows the local leave-guard message and retains the buffer. A valid dirty-title handoff still saves and opens the launcher. Overall delivery remains pending Reviewer closure in round 1.

## Candidate and fixture

- Exact candidate: `428c7b4d25c32b828a17a35f48fe918c99bda78c` on `codex/c4-docs-parity`, at `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`.
- The branch was clean at test start. Tester changed no product or test source; this addendum and the progress-record update are the only Tester changes.
- The UI test used Expo web at `http://localhost:8081`, the local API at port 18008, and the disposable `orbyn_test` database in `orbyn-c4-postgres-test`. The synthetic QA account was created after the user approved the local signup Terms. Its two Docs and account were deleted; verification returned zero matching rows. The API, Expo web, and test database were stopped.

## Automated results

- `npm run typecheck` passed, including `build:packages` and backend, desktop, and mobile typechecks.
- The focused store, section-navigation, and object-pill caller tests passed **12/12, 0 failed, 0 skipped** (2.37 s):

  `node --import tsx --test --test-concurrency=1 backend/tests/doc-editor-store.unit.test.ts backend/tests/doc-section-navigation.unit.test.ts backend/tests/doc-reference-title-render.unit.test.ts`

## Interactive results

- **Invalid Source object-link handoff — pass.** In the target page, I entered two duplicate block IDs. The editor showed “Invalid or duplicate document block ID.” and disabled Save. I switched to Preview and tapped “Return to launcher.” The page stayed on the target and showed “Save this draft before opening another page.” Switching back to Source showed the same invalid buffer and validation error.
- **Valid dirty-title handoff — pass.** After correcting Source, I changed the title to `C4 R4 Target Drafted`; the page showed Unsaved. Following “Return to launcher” saved the title and opened the launcher. The target’s database row showed the new title, version 5, format 2, and the target block anchor and launcher link.
- The fixed route is visible in `mobile/src/screens/docs/links.tsx:164–167,215–218`: `LinkPillText` reads `DocNavigationContext` and passes its `onAppLink` handler into `openObject`. The structured editor’s existing guarded handler receives the link.
- No offline network emulation was run for this addendum. The b556bac6 offline attempt remains inconclusive as recorded in the prior report. Web behavior was not rerun because this correction changes mobile navigation only; the prior source-equivalent web results remain applicable.

## Disposition and limits

The b556bac6 mobile object-pill guard finding is closed by this exact-candidate retest. The affected mobile checks pass; Reviewer closure remains pending. No merge, push, deployment, or overall checkpoint acceptance is claimed. This was Expo web interaction evidence, not installed iOS or Android validation. No exhaustive retest, desktop-app check, routine Visual Check, or visual/accessibility audit was performed.
