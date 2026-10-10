# C4/D1 review — round 1/3

**Decision: changes required.** Three source findings and the evidence gaps below remain open. This is the first formal review of the complete C4/D1 candidate; fixes and targeted closure may remain within round 1/3. Not accepted for main integration.

Candidate: `1b76c6c375c4a42a875c696ea4a65ff02eab7718`, branch `codex/c4-docs-parity`, `/Users/anhdang/.codex/worktrees/c3-agent-platform/Orbyn`, base `6410c65c`. Product source matched the requested HEAD. The candidate had an existing modified progress record and untracked Tester report, preserved during review.

## R1 — P1: Title edits clear source validation and permit draft loss

**Location:** `packages/api-client/src/doc-editor-store.ts:144–150`, `changeSource`, and the successful `save` receipt publication.

`changeSource` correctly retains an invalid buffer while leaving the last valid tree in the session. However, `changeTitle` unconditionally clears the shared error. Enter source containing duplicate anchors (the existing store test's invalid example), then change the title. The title makes the session dirty and clears the only save guard for the invalid source. Autosave sends the old valid tree plus the new title; its receipt clears `source` when no later edit occurred. The invalid text disappears without correction or explicit discard. Both new editors use this store. A successful earlier in-flight receipt also unconditionally clears a newer source error, so error ownership is not confined to the title handler.

**Expected/correction:** Source validity must remain attached to the exact source buffer independently of transport/title errors. A title edit or older save receipt must not certify an unparsed buffer or discard it. Either refuse the combined save until source is valid, or save the title while explicitly retaining the invalid buffer and its validation state. Preserve newer local errors/buffers across receipts.

**Tester verification:** Add store-level regressions for invalid source → title change → save, and invalid source entered while an earlier save is in flight. Assert the buffer/error remain visible, no invalid buffer is silently replaced, and correction or explicit discard restores normal saving. Check the shared behavior through web and Expo web when performing the targeted client retest.

## R2 — P1: Mobile offline acknowledgment is not a durable, draft-specific receipt

**Location:** `mobile/src/screens/docs/StructuredDocEditor.tsx:103–155`; dependency `mobile/src/lib/outbox.ts:61–63,391–394`; `mobile/src/lib/pageCache.ts` persistence.

The editor awaits `savePageOffline` and `rememberPage`, then sets `offlineQueued=true`, displays “Saved on this phone,” and allows navigation. Neither awaited API awaits its underlying AsyncStorage write: the outbox's `persist()` and page-cache persistence are fire-and-forget and swallow failures. If storage rejects or the app closes before persistence completes, navigation can remove the sole recoverable copy despite the reported saved state. The new editor makes a durable navigation guarantee that these APIs do not supply.

The acknowledgment also uses the captured `draft` without checking it against the current session after the awaits. Typing during queue/cache work can reset the flag, then the older completion sets it true again; the leave guard accepts that flag for the newer unsaved draft.

**Expected/correction:** Provide an awaited, failure-reporting durable page-save receipt, serialize persistence as necessary, and bind acknowledgment to the exact draft/edit generation stored. Keep newer typing dirty and navigation blocked until that generation is durably queued or remotely saved. Do not clear the error or show saved status on storage failure. Scope any outbox API change carefully to preserve other callers.

**Tester verification:** Delay and reject AsyncStorage writes; verify no saved acknowledgment/navigation before successful persistence. Type again during a delayed queue receipt and verify the newer draft is retained and queued before leaving. Reopen after a simulated restart to prove the accepted draft is recoverable. Pure ownership-merge tests do not cover this persistence boundary.

## R3 — P2: New normal editors omit in-page link navigation

**Location:** `desktop/src/features/docs/StructuredDocEditor.tsx` preview/`BlockView` integration; `mobile/src/screens/docs/StructuredDocEditor.tsx` preview/`DocBody` integration and wrapper in `mobile/src/screens/docs/DocEditor.tsx:3165`.

Neither structured editor supplies `DocNavigationContext`, although the legacy editors and existing Source/Preview components do. For `[jump](#heading)` or a named block fragment, mobile `Inline.tsx:70–72` takes its no-context error path (“Open this page to follow its heading link”) while the page is already open. Web falls back to a native fragment URL, but the structured preview renders `data-block-id`/container paths rather than matching native anchor IDs, and `BlockView` headings have no such IDs. Therefore the source may round-trip and export correctly while normal in-page navigation fails. The wrapper also drops the existing initial-block navigation props when selecting the structured editor.

**Expected/correction:** Connect the structured owner to existing fragment resolution, scrolling/highlighting and application-link navigation, including initial block targets. Resolve against the complete current draft and preserve its unsaved state. Reuse established navigation behavior in both clients rather than relying on DOM hash behavior.

**Tester verification:** In web and Expo web, follow heading-slug and explicit-block links inside nested content, open a page at an initial block target, and verify the target is reached without losing a dirty draft. Include duplicate headings and a missing-target response. Parser/export tests alone do not establish this client behavior.

## Evidence and coverage

Read `c4-d1-progress.md` and `c4-d1-tester-r1-c270a9bc.md`, inspected changed server ownership/write/history paths, shared session/store/merge/extraction/offline logic and client integrations. The storage boundary keeps structured writes explicit; extraction/merge use the versioned writer, and history/reads retain the complete tree with privacy projection. No additional security blocker identified in those inspected paths. The findings above concern activation/recovery integration rather than the underlying nested representation.

The retained focused log confirms **115/115 passed, zero failures/skips** on `c270a9bc`. Tester reports workspace typecheck passed there and desktop/mobile typechecks passed after the dialog correction. The diff from `c270a9bc` to `1b76c6c3` changes only web/mobile confirmation handling, so the prior unchanged server/shared results remain applicable. The **124/124** supplemental batch is explicitly not an exact-candidate receipt; retain that limitation.

**E1 — targeted evidence pending:** Complete the already requested final-revision Orbyn-dialog interaction retest when its consent gate is resolved. Source inspection confirms use of `useConfirm`/`ActionSheet`; it is not a rendered interaction pass. Also provide execution receipts for the newly added ownership suites absent from the listed focused and supplemental commands: `doc-add-to-page-format`, `doc-container-append`, `doc-container-controls`, `doc-content-extract`, `doc-content-merge`, `doc-content-operations`, `doc-editor-session`, `doc-merge-format`, and `home-reflection-format`. Existing retained exact/source-equivalent receipts can satisfy this; otherwise run these targeted suites alongside affected fix regressions. This is qualification of changed behavior, not a request for an exhaustive aggregate rerun.

The reported Expo Pressable traces remain an unadjudicated observation; no speculative blocker is assigned. Reviewer ran no tests/builds, accessed no QA database, and edited no product/test code. Routine Visual Check, separate desktop-app checks, native iOS/Android builds and exhaustive retesting remain excluded/untested. Production deployment is user-owned. No merge, push or deployment is claimed.
