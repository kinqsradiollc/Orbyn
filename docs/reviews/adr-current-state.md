# ADR implementation tracker

Updated 7 October 2026. Follow the full contract in
[the implementation review](devday-2026-implementation-review.md) and
[the top-down execution order](adr-execution-order.md).
Detailed qualification and historical failures remain in
[the C1 acceptance ledger](c1-acceptance-ledger.md).

**Active stage: C1. No entire ADR stage is complete.**
The controls/usage checkpoint is merged and pushed to main as `9a869240`.
The requested public homepage CodeHype badge is pushed to main as `98a9394f`.
The next C1 catalog checkpoint is local and undergoing regression qualification.
Production deployment is unconfirmed; the user deploys main manually.
User/character changes and unmerged work remain preserved.

## Full retained scope

✓ means a named checkpoint is implemented/qualified; ✗ means remaining work.
A completed checkpoint does not complete its entire stage.

| Order                  | Stage                            | Done                                                                                                                                                                                                                                                                     | Still required                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — ACTIVE             | C1 providers/models/embeddings   | ✓ Managed/personal isolation, selected routing, native Responses recovery, queued managed authority. ✓ Supported reasoning/cache controls, all managed response-format usage, embedding consent correction, responsive provider controls/menu/zero-usage review on main. | ✗ Complete connection/model inventory and multi-provider matrix; embedding consent/reindex/runtime/client matrix; permitted OpenAI cache economics and remaining live-provider qualification.                                     |
| 2                      | C2/M1 ChatGPT connections/models | ✓ Desktop protected credentials, executor/catalog/default and explicit fallback/provenance foundations; authenticated GET /models and PUT /models/default. Native OAuth/recovery follow-ups remain candidate.                                                            | ✗ Standalone web connection without desktop dependency; installed iOS/Android connection/storage/recovery; eligible inference, verified plan and truthful usage; account/catalog/default switching and revocation across clients. |
| 3                      | C3 Background/Overnight          | ✓ Separate lanes/profiles, characters, activity, rules/ownership, budgets and reflection foundations.                                                                                                                                                                    | ✗ All write paths/races/revocation; independent idle/running/waiting/stopped recovery; collaboration/reflection results; budget accounting and cross-client/native acceptance.                                                    |
| 4                      | C4/D1 Docs                       | ✓ Structured storage/API/editor foundations and selected Markdown/Mermaid/export/privacy checkpoints. Complete-tree/task/editor activation remains candidate.                                                                                                            | ✗ Normal editor ownership, remaining flat writers/task identity, collaboration, full CommonMark/GFM/code/math/Mermaid/media/link/anchor/footnote/import/export/privacy matrix and web/native checks.                              |
| 5                      | C5 pages/publication/channels    | ✓ Block bindings/jobs, comments, publication boundaries and separate Slack/Teams installation/outbox/reply/lifecycle foundations.                                                                                                                                        | ✗ Human-edit conflicts/source revocation/public consent; authorized real channel delivery/exact-question replies; tenant/lifecycle/reconnect and both-client acceptance.                                                          |
| 6                      | C6 separate plugin backend       | ✓ Separate service/principal/grants, managed inference broker/permissions, launch context/UI/import/reconnect foundations.                                                                                                                                               | ✗ Real host OAuth/UI/account switching/reconnect; production configuration; managed/BYO execution; authorized security scan and triage.                                                                                           |
| Throughout; final gate | U1 whole-app UI                  | ✓ Settings modal, assistant/agent separation, selected Home/navigation/task controls. ✓ Current C1 provider controls/management and zero-usage states inspected on wide/narrow web and320/390 mobile browser, Light/Dark.                                                | ✗ Every-page web/desktop/mobile matrix, positive/overflow/error/loading states, collapsed/nested panels, keyboard/large text and native acceptance. Browser checks do not prove installed-native parity.                          |
| Last                   | Integration/cleanup              | ✓ Qualified scoped checkpoints pushed to main, latest9a869240; unrelated local changes preserved.                                                                                                                                                                        | ✗ Qualify/promote remaining retained scope; reconcile branches/worktrees; remove only safe merged work after full acceptance.                                                                                                     |

Voice, computer-use product features and speculative Decisions remain excluded.
Computer-use tools may capture QA. MCP/plugin authority and personal ChatGPT
provider credentials remain separate.

## Just completed: C1 controls/usage checkpoint

| Gate                                  | Result                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full backend regression               | ✓ Adapter freezebf3dfef1:3736/3736, zero failures/cancellations/skips, exit0,901157ms; terminal session79617. Backend module source unchanged in promoted follow-ups.                         |
| Final legal/management/adapter cohort | ✓ 47/47; covers later mobile management and privacy wording changes independently.                                                                                                            |
| Types/builds                          | ✓ Shared packages/backend build; desktop/mobile types; web production build; scoped formatting.                                                                                               |
| Runtime                               | ✓ Compiled Matilda/JSON job completes, saves owner counters, leaves missing cache writes unknown and clears completed state. Owner/privacy/API isolation checks retained.                     |
| Embeddings                            | ✓ Migration256 stock upgrade/repeat plus separate12/12 pgvector setup/search/upgrade/late-install checks; generation-only controls preserve consent and connection changes invalidate it.     |
| Live Matilda                          | ✓ Fixed baseline6/6 exact-marker/arithmetic/state checks, latency519–899ms. Reported token counters are zero, cache writes unknown; no measured savings/costs, general quality or plan proof. |
| Visual review                         | ✓ Root inspected QA016–018 originals. Header bleed and mobile inline management/icon crash corrected; refreshed menu and lower controls contained. Zero-usage Settings reviewed.              |
| Main delivery                         | ✓ 9a869240 merged/pushed. Production deployment remains unconfirmed.                                                                                                                          |

Evidence logs: `/tmp/orbyn-adr-full-main-bf3dfef1-20261007.log`,
`/tmp/orbyn-c1-final-privacy-ui-focused-20261007.log`,
`/tmp/orbyn-c1-compatible-compiled-usage-fixed-20261007.log`,
`/tmp/orbyn-c1-matilda-baseline-20261007.json`.
QA manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-018-capture-manifest.md`.
Acceptance comes from this session's image inspection, not the capture session's findings.

## Next implementation checkpoint — C1 connection/model inventory

1. Audit independent same-kind connections and model/catalog selection on backend,
   shared contracts, desktop/web and mobile; trace every managed entry point.
2. Reproduce and correct disabled/deleted/revised connection, stale catalog,
   manual model entry and duplicate-provider behavior; qualify authority/fallback
   boundaries without retargeting saved work.
3. Complete the embedding consent/validation/reindex/search/client matrix.
   Keep live provider/OpenAI cache gates explicit; Matilda does not support the
   OpenAI-specific cache benchmark and does not waive that retained requirement.
4. Promote each qualified C1 checkpoint, then continue C2/M1 → C3 → C4/D1 → C5
   → C6 → final U1/integration/cleanup. Do not jump ahead or mark C1 complete early.

Orbyn Visual Check captures originals and a Markdown manifest only. This session
inspects images, owns findings/implementation and records acceptance.

## Current C1 catalog checkpoint — local, not promoted

| Requirement                         | Current evidence                                                                                                                                                                                                     | Remaining gate                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Catalog response validation         | Malformed catalogs and HTTP-200 error envelopes become sanitized provider errors; valid compatible/named catalogs deduplicate and sort. Initial reproduction: 1/11 passed, 10 failures; fixed focused cohort: 35/35. | Full backend regression running against a fresh marked test database.                            |
| Catalog refresh preserves selection | Web refresh no longer replaces an unlisted saved/manual model with the first catalog item. Actual callback regression tests cover current, revised and deleted connections.                                          | Wider provider/client inventory matrix.                                                          |
| Stale result handling               | Web discards revised/deleted connection results and older list loads; mobile clears catalogs on revision and discards revised/unmounted results. Connection tests use the same revision guards.                      | Concurrent external edits and server-side catalog revision authority matrix.                     |
| Mobile saved model updates          | Clean model state follows active saved settings; manually entered drafts remain intact.                                                                                                                              | Broader cross-client switching and native interaction matrix.                                    |
| Existing provider routes            | 5/5 provider integration tests passed with local HTTP stand-ins; no real provider inference used.                                                                                                                    | Full regression and runtime matrix.                                                              |
| Visual acceptance                   | No layout/CSS change in this checkpoint. Direct browser preview remains blocked by a saved Browser Use permission.                                                                                                   | Current screenshot acceptance remains unverified; no alternate surface used to bypass the block. |

Focused log: `/tmp/orbyn-c1-inventory-focused-20261007.log`.
Provider integration log: `/tmp/orbyn-c1-inventory-provider-integration-20261007.log`.
Full regression log: `/tmp/orbyn-c1-inventory-full-20261007.log`.
Do not treat a started full run as a passing result. Matilda live evidence belongs
to the earlier controls/usage checkpoint and does not qualify OpenAI cache economics.
