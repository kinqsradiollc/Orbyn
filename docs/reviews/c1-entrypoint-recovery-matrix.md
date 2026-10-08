# C1 entrypoint and recovery reconciliation

Reviewed 8 October 2026 at main2158ab4d; application/test source is the qualified
scanner candidatefed13851. This is a code-and-existing-test reconciliation, not a
new live-provider or installed-client run. Full4322/4322 on that unchanged source
includes the `.test.ts` files below. Separate integration scripts are not claimed
as part of that full run.

## First-party text entrypoints

Paths below are relative to `backend/src`; test names are relative to
`backend/tests`. Inspect actual assertions when extending any row.

| Entry | Recipient and source authority | Recovery boundary | Existing executable evidence |
| --- | --- | --- | --- |
| Interactive assistant and durable lead/specialists | `modules/ai/agent/run.ts` resolves `providers/user-choice.ts` against immutable job and managed snapshots; protocol adapters retain the selected recipient. | Durable operation IDs, saved completed output, fail-closed unknown completion, exact approvals and cancellation. | `chatgpt-inference-broker.test.ts`, `managed-provider-authority.test.ts`, `assistant-process-recovery.test.ts` |
| Goal, idea, routine, delegated task and Overnight admission | Five worker queries use `assistantProviderAdmissionSql` before claims/limits; all enqueue through the same captured assistant pipeline. | Offline personal binding can queue; no implicit managed fallback; existing bounded claims/retry/night limits. | `personal-scanner-admission.test.ts` (22 cases), `assistant-workers.test.ts`, `assistant-tasks.test.ts`, `assistant-night-shift.test.ts` |
| Docs and Study text helpers | `modules/ai/docs.ts` and `study.ts` call `completePageFeature` → `completeFeature`; bounded source revisions, visibility and first-party permission. | One-shot owned job; no automatic unknown-outcome replay; late changed source cannot publish accepted output. | `page-feature-private.test.ts`, `feature-capture-project.test.ts` plus Docs/Study route tests |
| Project and capture suggestions | `modules/ai/routes.ts` project route and `capture.ts` use `completeFeature`; team/page boundaries and session-only personal inference. | Proposal-only results; changed sources discarded; API keys cannot borrow personal plan authority. | `feature-capture-project.test.ts` |
| Existing recording transcript summary | Text uses `completeFeature` with file/page identity. Personal choice cannot silently send audio to managed transcription. | Existing audio path is explicitly unsupported for personal plan transcription. No new voice feature is in this ADR. | `feature-capture-project.test.ts`, `page-feature-private.test.ts`, `recording-feature-shape.unit.test.ts` |
| Interactive Agenda | `providers/agenda-call.ts` captures owned facts, originating session and provider/model authority before dispatch. | Source/session/model changes reject late output; fallback requires consent and confirmed pre-stream failure. | `agenda-brief-provider.test.ts`, `agenda-private.test.ts`, `agenda-source-fence.test.ts` |
| Scheduled Agenda | `worker/agenda-summaries.ts` uses `resolveUserAi` and its saved operation under scheduled run authority. | Explicit scheduling permission; offline undisclosed work defers; worker replacement retains operation; revoked permission blocks disclosure. | `agenda-scheduled-runtime.test.ts`, `agenda-schedule-permission.test.ts` |
| Maintained pages, hosted and personal | `docs/maintenance-model.ts` resolves the origin's captured managed selection; `maintenance-inference.ts` binds the owned companion job to exact parent lease. | Staged output reused; reserved/disclosed unknown work cannot restart; source change holds output; observed usage persists even when output is invalid. | `maintained-page-consumer.test.ts`, `managed-provider-authority.test.ts` |
| Memory extraction and old-chat compaction | `providers/chat-maintenance.ts` captures owner choice, personal model and managed recipient; sources rechecked before derived writes. | Encrypted completed output reused, unknown outcome not replayed, bounded confirmed-invalid retry, exact lease ownership, retained operation identity. | `chat-maintenance-authority.test.ts`, existing worker tests; separate upgrade receipt in `c1-chat-maintenance-authority.md` |

## Separate contracts; do not fold into user-plan routing

| Surface | Inspected boundary | Remaining qualification |
| --- | --- | --- |
| Admin provider Test | `modules/ai/admin.ts` requires `ai:manage`, targets the selected saved provider/model and generation revision, and sends a fixed ping. It does not borrow an owner's plan. | Remaining saved-connection/catalog client matrix and permitted live provider tests. |
| Managed cache evaluator | `providers/evaluation.ts` explicitly requires managed OpenAI Responses, sends fixed inert input, and returns observed counters. | Real authorized OpenAI cache/latency/cost/quality evidence; Matilda baseline is not equivalent. |
| Semantic embeddings | `search/semantic.ts` uses accepted independent embedding configuration and revision/source guards. | Live accepted recipient, dimensions, reindex/recovery and client matrix remain the separate C1 embedding gate. |
| Plugin inference | Separate `plugin/provider-policy.ts` validates a captured server-owned grant, exact managed connection/model and allowance; excludes first-party private hooks. | Full host/backend integration remains C6. Existing plugin tests do not close C6. |

## Review method and result

Reviewed callers of `complete`, `completeFeature`, `completePageFeature`,
`resolveUserAi`, `resolveAi` and embedding/transcription adapters across modules
and workers. Remaining direct `resolveAi` uses are the existing managed audio
path and the captured hosted-page path, plus the resolver itself; the five global
scanner gates and old maintenance bypass were removed by the delivered fixes.
Admin/evaluation direct adapter calls intentionally use their own explicit target.

Inspected test assertions cover personal signed output, explicit fallback,
revocation, changed source/model, unknown completion, lease loss and selected
recovery cases. This review found no additional first-party text routing bypass.
That is an audit result, not proof of every race combination, vendor entitlement,
mobile background execution or installed OAuth/keystore behavior.

The locally exercised first-party entrypoint routing/recovery mapping is now
reconciled. Remaining C1 work proceeds to the saved-connection/catalog client
matrix, followed by permitted live-provider/cache, embedding operational and
remaining cross-client/native acceptance. Keep enlarged-content blockerQA034
visible. Do not advance C2 or mark C1 complete on this reconciliation alone.
