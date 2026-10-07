# ADR implementation tracker

Updated 7 October 2026. This is the current state, not the historical sequence.
Detailed evidence remains in [C1 acceptance ledger](c1-acceptance-ledger.md) and
Git history. The complete retained contract is
[the implementation review](devday-2026-implementation-review.md); follow
[the execution order](adr-execution-order.md) from top down.

**Active stage: C1. No entire ADR stage is complete.** Main is `3c8feb40`.
The latest qualified product checkpoint on main is managed provider authority
`bdc87260`; production deployment is unconfirmed. The user deploys main manually.

## Full retained scope

| Order | Stage | Completed checkpoints | Required before stage completion |
| --- | --- | --- | --- |
| 1 — ACTIVE | C1 providers/models/embeddings | Managed/personal isolation, selected-provider routing, independent provider/embedding foundations, Responses native-tool/recovery repair and queued managed-provider authority on main. | Finish reasoning/cache controls and managed usage qualification, permitted live cost/latency/quality evaluation, multi-provider and embedding consent/reindex/runtime/UI matrix. |
| 2 | C2/M1 ChatGPT connections/models | Desktop OAuth/protected credentials, executor/catalog/default contracts, authenticated GET /models and PUT /models/default, explicit fallback/provenance foundations. Native OAuth/recovery changes remain candidate. | Standalone web connection without desktop dependency; installed iOS/Android connection/storage/recovery; real eligible inference; verified plan and truthful usage; account/catalog/default switching and revocation on every client. |
| 3 | C3 Background/Overnight | Separate lanes/profiles, characters, activity, rules/ownership, budgets and Overnight reflection foundations. | Every write path/race/revocation; independent idle/running/waiting/stopped recovery; collaboration/reflection results; budget accounting and cross-client/native acceptance. |
| 4 | C4/D1 Docs | Structured storage/API/editor foundations and selected Markdown/Mermaid/export/privacy checkpoints on main. Complete-tree/task/editor activation follow-ups remain candidate. | Normal editor ownership, remaining flat writers/task identity, collaboration, full CommonMark/GFM/code/math/Mermaid/media/link/anchor/footnote/import/export/privacy matrix and web/native checks. |
| 5 | C5 pages/publication/channels | Block bindings/jobs, comments, publication boundaries and separate Slack/Teams installation/outbox/reply/lifecycle foundations. | Human-edit conflicts/source revocation/public consent; real authorized channel delivery/exact-question replies; tenant/lifecycle/reconnect and both-client acceptance. |
| 6 | C6 separate plugin backend | Separate service/principal/grants, managed inference broker/permissions, launch context/UI/import/reconnect foundations on main. | Real host OAuth/UI/account switching/reconnect; production configuration; managed/BYO execution; authorized security scan and triage. |
| Throughout; final gate | U1 whole-app UI | Settings modal, assistant/agent separation and selected Home/navigation/task controls. Main c2476119 fixes confirmation typography; inspected 320/390 browser screenshots. | Every-page web/desktop/mobile matrix, themes, narrow/collapsed/nested panels, keyboard/large text/loading/errors. QA010 provider actions and QA011 long identity belong to current C1 work. Browser checks do not prove native parity. |
| Last | Integration/cleanup | Qualified scoped checkpoints on main; user/character changes preserved. | Qualify/promote every retained scope; reconcile branches/worktrees; remove only safe merged work after full acceptance. |

Voice, computer-use product features and speculative Decisions remain excluded.
Computer-use tools may capture QA. MCP/plugin authority and personal ChatGPT
provider credentials remain separate.

## Active checkpoint: reasoning/cache controls, usage and embedding consent

| Item | Current evidence | Remaining gate |
| --- | --- | --- |
| Backend/shared/both-client controls | Implemented and committed in candidate; main-based product freeze `66f7a5f2`. | Complete UI/runtime acceptance and main promotion. |
| Managed usage/privacy | Owner-only session route; nullable observed counters, opt-out, bounded retention and both-client loading/retry/cancellation coverage. | Signed-in visual acceptance and live observed-provider evidence. |
| Embedding consent correction | Migration256 preserves acceptance when only reasoningEffort/cacheMode/cacheRetention changes. Endpoint/key/API-version/enablement changes still invalidate it; old invalidated consent is not revived. | Refreshed full regression. |
| Latest focused qualification | Fresh main-based database: 29/29 passed, zero skips/failures. Backend typecheck passed. | Does not replace full regression or real provider calls. |
| Upgrade qualification | Local preview255→256 and a repeat pass; all three providers' embedding/generation revision pairs preserved. | No production deployment claimed. |
| Earlier full regression | Exact-main `c082d93e`: 3722/3722 passed, zero skips/failures, terminal exit0. | Predates migration256; cannot qualify the latest correction. |
| Refreshed full regression | Frozen `66f7a5f2`, marked `orbyn_full_main_66f7a5f2_test`, live session88045. | Inspect terminal result; no passing result claimed yet. |
| Visual review | Chrome original JPEG capture calibration accepted; one dark390 cache-menu state accepted. | Signed-in controls/actions/usage screenshots across web/mobile/themes; local updated Terms confirmation pending. |
| Live evaluation | Fixed six-call non-personal cache/latency harness prepared and mocked tests passed. | Configure authorized managed test credential/model. No real cache economics, general quality or plan entitlement established. |
| Integration | Qualification branch committed; main stays `3c8feb40`. | Merge only after sufficient current-checkpoint qualification. |

Logs:

- `/tmp/orbyn-main-c1-66f7a5f2-focused-20261007.log`
- `/tmp/orbyn-main-c1-66f7a5f2-types-20261007.log`
- `/tmp/orbyn-c1-256-preview-upgrade-20261007.log`
- `/tmp/orbyn-adr-full-main-66f7a5f2-20261007.log` (live; no terminal pass)

## Next actions

1. Finish this C1 checkpoint: refreshed full regression, signed-in screenshots
   inspected by this session, permitted live evaluation and scoped integration.
2. Complete the remaining C1 provider/embedding matrix before moving to C2/M1.
3. Continue C2/M1 → C3 → C4/D1 → C5 → C6 → final U1/integration/cleanup.

Orbyn Visual Check captures screenshots and a Markdown manifest only. This session
inspects images, diagnoses issues, implements changes and records acceptance.
Native/provider/channel/host gates stay explicit; they are not waived by typechecks
or fixture tests. User/character changes and unmerged work remain preserved.
