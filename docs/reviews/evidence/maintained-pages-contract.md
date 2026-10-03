# Maintained-page block contract

## Current implementation

Shared helpers capture selected block IDs and positions in page order, bound to
the current page version. Persisted snapshots contain identities only, not copied
private page text. Duplicate IDs, absent/moved targets, stale versions and writes
outside the saved target set fail. Updates retain untouched block objects and
order; no implicit insert/delete or expansion into human blocks. Input uses the
existing validated document block schema and100-target bound.

Seven focused tests pass in `/tmp/orbyn-maintained-pages-final-focused.log`;
shared package builds and all workspace typechecks pass. This
code is not a runnable maintained-page feature and is not ready for main promotion.

## Required next implementation

1. Persist owner/agent/routine/binding revisions with exact selected block metadata;
   constrain access to the intersection of current user rights, page access,
   assistant grant scope, workspace policy and action rules. A caller-supplied
   snapshot cannot replace the server's saved binding.
2. Capture current binding/consent before provider work; enqueue IDs/revisions,
   not copied document text. Limit model context to authorized source material.
   Recheck permissions, source version and target placement on resume/apply.
3. Apply through document history/comment/file/link checks and conditional saves,
   preserving human blocks. Existing saveDoc also syncs linked task ticks: those
   side effects need scoped task authorization and explicit target fencing.
   Update binding baseline only after a successful agent-owned update; human
   changes invalidate it rather than silently refreshing authority.
4. Add explicit schedule creation, pause/resume, current status and review in both
   clients. Respect separate Background/Overnight runtimes and existing budgets.
5. Add scoped @orbyn comment jobs/replies, edit/delete/retry deduplication and
   private-comment/source restrictions. No external messages without consent.
6. Prove real concurrent saves, deleted/moved blocks, grant/page revocation and
   cross-user/team isolation with real API tests; then full local/CI and signed-in
   web/iOS/Android flows.

Whole A5/C1–C6/M1/D1/U1 remains unfinished. Existing Slack/Discord webhooks do not
complete the retained Slack/Teams OAuth, signed replies or durable outbox scope.
No voice/computer-use product additions, deployment or cleanup.

## Storage and management API — 4 October

Migration219 persists owner/assistant identity, selected block IDs/positions and
page version, a binding revision, instruction and validated schedule. Snapshots
store no copied page text. Composite grant ownership prevents cross-account
bindings. Creation is bounded to100 per account and rejects overlapping target
ownership under the page lock. Bindings default to paused.

Management routes GET/POST `/docs/:id/maintenance` and PUT/DELETE
`/docs/:id/maintenance/:bindingId` authenticate app sessions and remain excluded
from external MCP tools. Reads expose only the current person's bindings, even
on a shared page. Create/update intersect the current assistant grant with page,
project, team and membership policies under locks. Edits require both binding and
page revisions; rebinding after a human edit is explicit. Stopping maintenance
remains possible when the assistant is suspended, using the same owner/page and
binding-revision checks. Both clients have typed API-client methods; no UI yet.

Fresh context is selected-block-only and projects links against current user,
grant and AI-exclusion policies. It rejects stale/moved/deleted targets. Linked
private or AI-excluded labels are redacted without hiding unrelated blocks.

Focused storage, real HTTP management, core contract, route inventory and catalog
checks28/28 pass in `/tmp/orbyn-maintained-page-management-focused4.log`, no skips
or cancellations. All workspace typechecks pass in
`/tmp/orbyn-maintenance-management-types.log`. Initial route tests failed fixture
column and expected denial-code mistakes; corrected to canonical team membership
semantics, retaining strict401/403/400/422/429 and concurrent200/409 coverage.

This branch includes current mainfdaf13e2. It is not a production-ready A5 feature:
no scoped model job, schedule consumer, guarded document application, scoped
@orbyn reply flow or client consent/review UI is wired. No PR/main promotion is
claimed. Complete those pieces and signed-in cross-client acceptance before
main qualification; do not silently call the metadata endpoints a working routine.

## Guarded application — 4 October (runtime not yet wired)

The server-only apply helper rereads owner/grant/page/block authority under locks,
checks the binding receipt and pause state, validates replacements against saved
IDs and positions, and applies current trust and typed action rules. Approval
cannot override a deny rule. Ask/suggest work is held rather than saved silently.
No client route can supply an approved helper option.

Document saves now support server-only block ownership: task ticks, hidden-label
processing and file authorization run on the selected blocks, while unrelated
human blocks remain unchanged in storage. A selected checkbox's task receives
independent current grant/source, membership, permission, trust and action-rule
checks. Task authority is refreshed after its membership/project locks are
acquired. Refusal rolls back the page and binding together. Successful saves use
normal version history/comment/suggestion/file checks, then advance the binding
baseline within the same transaction. Concurrent stale receipts cannot save twice.

Focused25/25 pass in `/tmp/orbyn-maintained-page-apply-focused.log`. Existing Docs,
editing and assistant-Docs plus binding/API/core/inventory/catalog regressions
118/118 pass in `/tmp/orbyn-maintained-page-save-regressions.log`, no skips or
cancellations. All workspace typechecks pass in
`/tmp/orbyn-maintained-page-save-final-types.log`. This is an internal apply path,
not a completed schedule or UI feature; full qualification is still required.

Next implementation must connect saved binding/rule revisions to durable claims,
provider context, staged results and review/resume. It must never substitute the
general workspace agent's context for selected-block context or let a newly
refreshed principal erase the revision captured by an earlier approval. Then wire
both client selection/consent/schedule/status/review and scoped @orbyn comments.

## Durable scoped job path — 4 October (consumer not wired)

Migration220 stores job references to the binding, its revision, page revision,
original assistant rule revision and owner/grant identity. Queue rows contain no
instruction or copied page text. One active job owns a binding, and one schedule
occurrence/revision queues once. Due time advances atomically with insertion.
Schedule exhaustion is separate from pausing, so the final occurrence can finish.

Lane-specific claims use row locks and unique leases. A dead worker's lease can
be replaced; its later staging, completion or failure cannot affect the new
worker. Lease checks run before loading source context and are repeated under
lock. Context, staging, review/resume and save recheck current page/block/grant
rights and the rule revision captured when queued. A deny rule holds work before
context is returned to a model worker. Generated replacements and token estimates
are bounded and staged once; recovery can reuse them without another model call.

Approval uses a unique waiting ID, an owner check and the original source/rule
revision. A stale card cannot answer later work. Explicit approval starts a fresh
worker retry allowance while retaining the staged result, source revisions and
budget counter. Binding edits cancel in-flight work and clear output; expired
night/review work and invalid references release the schedule. Completed/failed/
cancelled rows retain90days and waiting reviews7days through the existing sweeper.
Page save, binding advancement and job completion share one transaction.

Initial queue/storage/API checks28/28 passed; retention/core checks43/43 passed.
Final Docs, assistant Docs/rules/lanes/workers, storage/API/core and retention
regressions159/159 pass in `/tmp/orbyn-page-runs-release-regressions.log`, no skips
or cancellations. All workspace types are rechecked for this checkpoint.

| Remaining implementation            | Required proof                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect producer and model consumer | Due scanning, bounded selected-block prompt only, provider failure/cancel/restart, staged-result reuse; current account/default model selection must be respected.                                |
| Integrate Overnight work            | Existing serialized night queue, ten-run limit, reflection reservation, shared token accounting and morning results must include page jobs. Internal lane/deadline tests alone do not prove this. |
| Web/desktop and mobile controls     | Explicit block selection, schedule/consent, pause/ended status, generated preview and unique-card review/resume; current access controls on all reads.                                            |
| Scoped @orbyn comments              | Comment edit/delete/retry dedup, scoped job and reply permissions, private comment/source restrictions.                                                                                           |
| Production qualification            | Full local/CI, migrations and signed-in web/manual/iOS/Android acceptance. No PR/main promotion of this unfinished path.                                                                          |

The general routine runner was deliberately not reused for model context: its
whole-workspace overview would expand a selected-block binding's context. The
scoped consumer must still use shared provider/trust/lane/budget infrastructure.
No new voice/computer-use product feature, deployment or cleanup.
