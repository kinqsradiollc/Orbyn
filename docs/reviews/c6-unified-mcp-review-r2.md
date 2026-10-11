# Unified MCP review — round 2/3

Candidate: `bc43d9d58865d0c74f3c402f61063143c279a758`, base `e5bdc161`, branch `codex/c6-file-viewer`, checkout `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.

**Final local checkpoint decision: approve `8f99272c66101734f0536405ad5bb68f5122e60b` for main integration under existing checkpoint authorization. U2-R1–U2-R4 closed within round 2/3.** Runtime source is unchanged from `3a7b6069`; the final commit adds the requested editor regression assertions. Full C6 canonical-host acceptance remains open. Earlier findings and interim decisions below are retained as history, superseded by this local decision.

## Final evidence and closure — 11 October 2026

Read `c6-unified-mcp-tester-r2-8f99272c-2026-10-11.md` and independently checked all six saved log summaries in `/tmp/orbyn-c6-r2-8f99272c-tests/`: **58 passed, 0 failed, 0 skipped**. The report records backend typecheck exit 0, an exact detached checkout, a fresh marked disposable database migrated through 266, database cleanup and clean test source. No Reviewer test execution was performed.

| Finding | Closure evidence |
| --- | --- |
| U2-R1 | Result/editor identity is kept together while dirty, refreshing or unresolved; switching is explicit. Executed fixtures cover queued replacement, read-only/error replacement and delayed responses. |
| U2-R2 | Submitted document/revision/anchor/content/ID are immutable; unknown retries preserve the request. Refresh locks competing actions, with executed cases for blocked mutation during refresh, failed-read control restoration, rejected snapshot preservation, conflicts and delayed saves. |
| U2-R3 | Canonical first delivery and replay now share durable job decoration. The actual canonical protocol fixture verifies returned import resource, cursor/replay identity, opposite-recipient refusal and revoked access; legacy service/import regressions also pass. |
| U2-R4 | Preview clipping is block-based, local clipping disables editing, pagination and edit limits are explicit, and continuation/source paths are exposed. Executed tests cover oversized anchored content, pagination and the 100-anchor limit. |

The baseline remains **157 passed / 3 failed / 0 skipped** on `bc43d9d5`. Corrected generated-script syntax, cursor expiry and authored-style palette checks now pass in the affected batch. Baseline workspace types and configuration/deploy-preflight receipts retain their candidate provenance; configuration paths are unchanged through the final freeze. Do not sum overlapping results or label every historical suite freshly executed on the final candidate.

This is sufficient local code/test evidence for the owner-deployable checkpoint. The six editor cases execute the shipped script in a DOM stand-in; they do not prove rendered Markdown/Mermaid, sandbox/CSP behavior in a real host, layout, focus or actual host interactions. Visual Check records no local host harness and preserves a bounded post-deployment plan. Those limits are accepted as outstanding external qualification, not passing visual evidence.

Builder may integrate/push the exact accepted checkpoint under existing authorization; the owner then deploys. Full C6 still requires canonical `/mcp` host discovery/consent, negotiated previews and readable fallback, Docs edit/conflict/proposal behavior, supported host files and mentions, account switching/reconnect/revocation and live managed/BYO behavior. Existing legacy `/plugin` reads qualify only that legacy path. This decision performs no merge/push/deployment, grants no new production interaction permission, waives no external case and does not start U1 or reset the review counter.

## Same-round correction inspection — 9235d02e

### Subsequent source correction — 3a7b6069

Inspected `3a7b6069f38ba77fa566eb43c89ddd88703cbb9e`, including the refresh-lock change from `b642a1f0`. Refresh now locks the draft/line and competing action controls, guards Review/Submit/discard/repeated refresh, and queues host replacement results while preserving the visible original document. Applying the refreshed revision retains the queued replacement for explicit switching. This addresses the residual U2-R2 source race described below. **All four findings now have source corrections, but remain pending matching retest; no formal closure yet.**

Read the retained baseline Tester report `c6-unified-mcp-tester-r2-bc43d9d5-2026-10-11.md`: 157 passed, 3 failed, 0 skipped across 17 serial files; workspace types and reported configuration checks passed. The failures are the generated RESULT script's invalid syntax, a cursor fixture missing its future expiry, and a palette assertion inspecting embedded Mermaid literals. The correction's `String.raw` preserves script escape sequences, the cursor now supplies an explicit future expiry, and palette checking is scoped to authored CSS while existing resource/CSP assertions remain. These fixture changes are proportionate; passing execution is still required. Preserve the original three failures rather than retroactively declaring the baseline green.

The current executable editor tests cover delayed save, unknown retry, revision recovery and queued document replacement. The updated replacement assertion reflects the intentional keep-until-discard behavior. For the residual refresh race specifically, the focused retest should also assert the input/select locks and that invoking Review/Submit while the refresh promise is pending cannot enqueue a mutation, with controls restored correctly after a failed refresh. Those assertions are not present in the inspected four editor fixtures. This is a targeted closure-evidence request for U2-R2, not a new source defect or review round.

The baseline Tester report defers actual rendered canonical host behavior to post-deployment qualification. No browser/host rendering pass is inferred from the executable card fixture; retain that limitation explicitly in any local checkpoint decision. Production canonical acceptance remains open.

Inspected frozen correction `9235d02e8d1a17dafa0d2b0d6ff60d4812a5bd81`. U2-R1, U2-R3 and U2-R4 have appropriate source corrections: dirty/unresolved state keeps its visible document until explicit discard; canonical first/replayed imports share durable job decoration with the legacy route; whole-block preview bounds now report local clipping, pagination and edit limits, with continuation and clipping-based edit disabling. These findings await matching Tester evidence before closure. The new executable card fixtures improve on script syntax assertions, but remain simulated DOM evidence rather than browser rendering.

**U2-R2 remains changes required — P1 residual refresh/submission race.** At `backend/src/modules/mcp-server/apps.ts:351–363`, Refresh captures `kept=draft.value` and disables only Refresh. While fetch is pending, the user can still type, choose another line, or Review and Submit. `doc` remains the same object for all these actions, so the `doc!==current` guard does not reject the delayed fetch. Its `resetEditor()` can overwrite a newer draft with `kept`, or clear an already submitted operation. The subsequent save response then fails the operation-identity guard and is ignored, losing the receipt/retry state despite a possible committed write/proposal. This is the same immutable-request/recovery finding, not a new formal round.

Builder: treat revision refresh as part of the editor state machine. Either lock editing, line selection, Review and Submit for the bounded fetch, or invalidate the refresh by a draft/selection/submission generation and preserve the newest state. Never clear an in-flight or unresolved submitted tuple when applying a refresh response. Preserve explicit discard/switch behavior and restore controls on failure without enabling actions belonging to a different state.

Focused regression additions: (1) start refresh, type newer text, complete refresh; (2) start refresh, Review/Submit, complete refresh before save succeeds or loses its response; (3) selection change during refresh. Assert no lost draft, no lost operation ID, the same retry payload, and no duplicate proposal. Existing tests cover switching to another document during refresh but not these same-document interleavings.

Matching correction retest and bounded Visual report were not yet available at this inspection. Do not use Builder's backend typecheck or the previous candidate's execution as closure evidence for this batch. All original findings below remain historical context for the same round.

## U2-R1 — P1: result replacement can leave the editor bound to the previous document

Location: `backend/src/modules/mcp-server/apps.ts:320–324` and `:331–333`.

`render()` replaces the visible title/body for every host result, but initializes `doc`, revision, line options and edit eligibility only when `!doc`. After editable document A, a subsequent result for document B displays B while Submit still calls `edit_doc` for A. A read-only or error result also does not clear the previous editor. Keeping a draft is necessary, but silently retaining its mutation target under a different displayed document is unsafe.

Builder: bind preview, editor and in-flight requests to an explicit document/revision identity. On a different result, preserve the old draft separately with a visible identity and a deliberate keep/discard/switch action; never show B with A's active edit controls. Recheck edit eligibility on every replacement and ignore stale async completions for another identity.

Verification: deliver editable A then editable B, read-only B, an error and a refreshed revision of A into the same card; assert the visible identity matches every mutation target, draft switching is explicit, and delayed A responses cannot change B's state.

## U2-R2 — P1: save lifecycle loses the immutable retry request

Location: `backend/src/modules/mcp-server/apps.ts:327–340`.

The textarea remains editable during save; its input handler clears `operation` and hides Submit. If the call's outcome then becomes unknown, the original operation ID is gone despite the message claiming it was kept. Independently, after an unknown outcome with no typing, Review is re-enabled and unconditionally creates a new UUID. Re-reviewing and submitting the same proposal can bypass `client_ref` replay protection and create a second pending proposal (the document revision need not change for a proposal). Success also hides Submit and disables Review even when the user typed a newer draft during the request. Conflicts make the field read-only without a revision-refresh/rebase action; dirty state has no explicit discard path.

Builder: retain an immutable submitted tuple (document, revision, anchor, content, operation ID) independently of the editable draft. Retry unknown outcomes with exactly that tuple/ID; do not allow Review to replace an unresolved operation. Either lock input during submission or separately retain subsequent edits with truthful status. Provide an explicit revision refresh/review and keep/discard recovery path without losing the draft. Do not report newer text as recorded when only the earlier snapshot succeeded.

Verification: delayed success with typing, committed proposal with lost response, repeat Review after uncertainty, conflict/rebase and switching lines with a dirty draft. Assert one proposal/write, the same retry ID and payload, and a usable recovery path. Script parse/regex checks alone do not exercise this state machine.

## U2-R3 — P2: canonical import calls do not create the advertised reconnect resource

Location: `backend/src/modules/mcp-server/server.ts:609–628` and `:763–790`; `backend/src/capabilities/files.ts:197–207`.

Canonical `start_import` now marks its source as connector-owned, and `/mcp` implements reading `orbyn://plugin-job/...`. However, its tool-call path never calls `trackPluginImport` or returns a job resource link. The sole job insertion is in `trackPluginImport`, currently reached through the auxiliary/legacy route's `trackResult`. A normal canonical MCP caller therefore gets the ordinary import handle but no durable job row/URI for the new reconnect flow. Existing `list_imports` polling does not establish the claimed unified job-resource contract.

Builder: share the durable import-result decoration with canonical protocol dispatch. Preserve the ordinary upload result, add the authorized job handle/resource, and make replay recover the same job without starting another import. Keep grant/audience/cursor checks on every read. Ensure tracking failure after import commit can recover on retry.

Verification: actual `/mcp` `tools/call(start_import)` followed only by its returned resource URI; observe progress, reconnect cursor and replay identity. Check a different grant and `/plugin` credentials cannot read the canonical job. Do not qualify this solely by calling the auxiliary HTTP route or a cursor codec.

## U2-R4 — P2: document preview truncation is neither fully recorded nor surfaced

Location: `backend/src/modules/mcp-server/result-preview.ts:27–48`; generic card rendering in `apps.ts`.

The helper slices source at 60,000 characters but reports only `metadata.truncated`. Fetch normally paginates whole blocks, and can include a first block larger than the nominal page budget; local clipping can therefore happen without the metadata flag. Additionally, the card never reads `preview.truncated`, so even ordinary paginated previews look complete. The first 100 anchored blocks are offered without any explanation of that editing limit. This is a confirmed metadata/presentation defect; no destructive partial-block edit was reproduced by Reviewer.

Builder: distinguish source pagination, local clipping and edit-list bounds; show a concise partial-preview state and a usable continuation/open-source path. Offer edits only for complete, stable anchored blocks at the verified revision. Prefer explicit block boundaries over arbitrary character cuts; disable editing when completeness cannot be established. Preserve the full authorized fallback result subject to its existing output limits.

Verification: ordinary paginated fetch, a single oversized paragraph/code block, more than 100 anchors and a truncated source ending inside a block. Assert truthful partial status, safe edit eligibility, stable anchors and retained source/continuation.

## Other inspected boundaries and outstanding evidence

The shared OAuth resolver still checks exact resource kind and resource value; canonical inference is OAuth-only, separately switched and owner-permissioned. Job authority is rechecked at claim/dispatch/result boundaries, and paused canonical queued jobs are retained. The new inference test covers consent, opposite-recipient refusal, pause/read/resume, an inert HTTP adapter and idempotent receipt reuse. These are appropriate assertions; execution results remain Tester-owned.

Compose loads the shared private env file for backend services; the explicit integration worker flag is not the only way the MCP process receives it. Gateway routing keeps `/mcp` protocol and `/mcp/*` auxiliaries separate and does not redirect bearer requests. Kubernetes worker deployment remains excluded. Static Mermaid rendering is isolated in a sandboxed child frame using the local bounded/sanitized runtime; actual rendering under the host CSP and narrow layout still require the requested bounded Visual evidence.

The new unit suite exercises listing/opt-out, input bounds, preview metadata, cursor separation and script syntax. It does not execute the generic card's document mutation lifecycle. Admin UI opt-out also is not proof of per-host extension negotiation; Tester should identify capable/unsupported host behavior and retained protocol compatibility evidence explicitly. No remote canonical host result is claimed before owner deployment.

Reviewer performed read-only source, test-source and instruction inspection. No tests/builds, scans, browser operations, database mutations or product/test edits were performed. Tracker/Visual-owned dirty reports were preserved. Builder should batch the source corrections, freeze one revised candidate and obtain affected Tester/Visual evidence for same-round closure; do not silently start round 3.
