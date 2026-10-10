# C4/D1 preliminary closure inspection — round 1/3

**Preliminary disposition: corrections required; no final acceptance.** Inspected clean candidate `907f45bdcb548934a6de2f5210a101b9d4d18854` on `codex/c4-docs-parity`, `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`, against `1b76c6c3`. Read the original review and `c4-d1-tester-r2-45a80ca.md`. The Tester report's filename does not advance the formal review counter: this remains **1/3**. Exact-907f browser qualification is pending.

## Addressed portions

- **R1:** Explicit `sourceInvalid` survives title changes and successful older save receipts. Save refuses invalid source. The new store assertions directly cover both original cases; Tester reports matching web/Expo interactions passed on `45a80ca`.
- **R2:** Outbox and cache now serialize writes and expose awaited rejection-capable receipts. The mobile editor checks edit generation before acknowledging a queued draft. Delayed/rejected persistence and cache reopen assertions are meaningful. A failed-network/invalid-source combination remains unsafe, below.
- **R3:** Both editors now provide fragment context and forward initial targets. App-level page fetches use `getDocForEditor`, addressing the Tester's format-2 HTTP 409. Cross-page links inspect state after saving and refuse dispatch on remaining dirty/error/conflict/invalid state. Same-page links stay within the draft. These later routing changes still need the exact-candidate retest.

## Remaining R1/R2 correction — P1: Offline failure can acknowledge an invalid Source buffer's old tree

Locations: `packages/api-client/src/doc-editor-store.ts:269–275`; `mobile/src/screens/docs/StructuredDocEditor.tsx:145–178,219–232`.

Sequence: start a valid save; enter invalid Source while that request is pending; let the request reject with an offline error. The store's catch replaces the validation error with the offline error while retaining `sourceInvalid=true`. Mobile then queues `session.document` (the last valid tree, not the invalid source), captures its edit generation after the invalid input, clears the offline error and sets `offlineQueued=true`. Back/close checks `source && error`, not `sourceInvalid`, and accepts that queued flag. Leaving destroys the unpersisted invalid buffer. This is a source-established failing path; Reviewer did not execute it.

**Correction:** Preserve independent source validity through failed receipts as well as successful ones. Do not acknowledge the last valid tree as the whole current draft when a source buffer is invalid. Check `sourceInvalid` in offline fallback/acknowledgment and in the leave guard before and after awaited work, independently of error text. Either retain the invalid buffer durably with its own explicit recovery semantics or require correction/discard before leaving.

**Verification:** Defer a save, type duplicate anchors, reject the save offline, then exercise queue completion and Back/close. Assert no saved acknowledgment or permitted exit can discard the invalid buffer. Repeat with invalid typing during persistence. Add a caller-level regression: current persistence tests and the successful-receipt store test do not cover this combination.

## Remaining R3 correction — P2: Missing initial mobile targets are silent

Location: `mobile/src/screens/docs/StructuredDocEditor.tsx:502–510`.

The initial target is processed only by a leaf whose index equals `docFragmentIndex`. A missing fragment returns null and matches no leaf, so `goToFragment` never runs and its new target-specific message is never shown. Opening a cross-page link to a deleted heading therefore silently opens at the default position, unlike clicking the same missing fragment after opening the page.

Resolve the initial target once the complete document is ready; report a missing target explicitly. Use layout readiness only to delay scrolling to an existing target. Tester should include a missing initial fragment as well as same-page missing fragments in the bounded R3 retest.

## Evidence and limits

Tester reports **91/91** targeted ownership/persistence tests, **2/2** section-navigation tests and workspace typecheck passed on `45a80ca`. This supplies the previously missing ownership receipts. Web restore used the Orbyn modal; invalid-source/title recovery and same-page fragments passed. Preserve the reported cross-page failure and unproven dirty-navigation case until exact-907f evidence supersedes them. Later changes are client routing/navigation; shared store and persistence test source is unchanged.

No tests/builds, browser actions, database access or product/test edits performed by Reviewer. This preliminary note does not approve integration. Routine visual/native exclusions remain unchanged; deployment is user-owned.
