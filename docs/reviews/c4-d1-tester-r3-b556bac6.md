# C4/D1 Tester execution report — b556bac6

**Disposition: HOLD.** The exact candidate passes focused store, replay, and fragment tests, workspace typecheck, and the tested web/Expo web cross-page fragment flows. A mobile object-link still bypasses the structured editor’s leave guard: an invalid Source draft is discarded when its cross-page link is followed. This blocks acceptance.

## Candidate and fixture

- Exact candidate: `b556bac61702e01dfeafecd5e8fe22cd3c2d40f8` on `codex/c4-docs-parity`, at `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`.
- The source worktree was clean before Tester documentation changes. Tester changed no product or test source; this report and the delivery-record update are the only Tester changes.
- Runtime checks used the disposable `orbyn-c4-postgres-test` container and `orbyn_test` database, with the test environment marker, plus the local API, desktop Vite preview, and Expo web preview. No production database or external account was used.
- The synthetic QA account and its two Docs were deleted. Database verification returned zero matching user and Doc rows. The API, Vite, Expo web, and disposable database services were stopped.

## Automated results

- `npm run typecheck` passed on this candidate. It ran `build:packages` and typechecked backend, desktop, and mobile.
- The focused store, offline replay, and section-navigation run passed **14/14, 0 failed, 0 skipped** (2.46 s):

  `node --import tsx --test --test-concurrency=1 backend/tests/doc-editor-store.unit.test.ts backend/tests/doc-offline-replay.unit.test.ts backend/tests/doc-section-navigation.unit.test.ts`

- These checks cover source validation retention, in-flight and offline receipts, durable replay behavior, and fragment handling. They do not cover the mobile object-link Pressable’s route through the editor leave guard.

## Interactive results

- **Web cross-page and initial fragments — pass.** Structured links opened the target page at its heading and explicit block. With 42 introductory paragraphs before the target, the requested heading/block was brought into view below the opening viewport. A missing cross-page target opened the target page and showed “This heading or line is no longer in the page.”
- **Web dirty-draft handoff — pass.** The edited source marker was saved before the return link opened the launcher. The disposable database showed the marker in the target’s format-2 content tree.
- **Expo web cross-page and initial fragments — pass.** Heading and explicit-block links opened the target and scrolled to the requested content. A missing cross-page target opened the page and showed the target-specific missing-line message.
- **Expo web valid dirty-title handoff — pass.** The target title changed from Unsaved to Saved when following the launcher link. The target reopened with the new title; database state showed format 2, version 7, and the original target content marker.
- **Expo web invalid Source handoff — fail (P1).** On the target, Source was replaced with a duplicate-block-ID buffer. The editor showed “Invalid or duplicate document block ID.” and Save was disabled. After returning to Preview, tapping the object link “Return to launcher” opened the launcher without a leave warning. Reopening the target showed the last saved source, not the invalid buffer. The saved target tree remained intact, but the unsaved invalid source buffer was lost.
- The route bypass is visible in `mobile/src/screens/docs/links.tsx`: `LinkPillText` calls `openObject`, which calls `openAppUrl` directly. That path bypasses `DocNavigationContext` and the validation/dirty-state check in `mobile/src/screens/docs/StructuredDocEditor.tsx:204–223`. The inline Markdown link’s accessibility name was “Open page Return to launcher.”
- **Offline edge — inconclusive on its own.** With browser network emulation offline, the link click stayed on the target, but the visible missing-target alert was stale from the earlier missing-link check; the expected leave-guard message did not appear. Restoring the network and repeating the invalid-source sequence navigated to the launcher and lost the buffer, confirming the guard bypass online. Network emulation was restored before cleanup.

## Remaining qualification

Route mobile object links through the same guarded handoff as other structured-editor links, or otherwise preserve the invalid Source draft and refuse navigation. Add a caller-level regression for the object-link path, then retest that exact candidate. The issue keeps C4/D1 on HOLD; no acceptance, merge, push, or deployment is claimed.

Per the user’s exclusions, this execution did not include an installed desktop-app check, iOS or Android device/build validation, exhaustive 200% retest, routine Visual Check, screenshot-based visual qualification, or keyboard and assistive-technology audit. Browser and Expo web interaction results do not establish native-device behavior.
