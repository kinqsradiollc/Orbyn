# ADR implementation tracker

Updated 8 October 2026. Follow the full contract in
[the implementation review](devday-2026-implementation-review.md) and
[the top-down execution order](adr-execution-order.md).
Detailed qualification and historical failures remain in
[the C1 acceptance ledger](c1-acceptance-ledger.md).

**Active stage: C1. No entire ADR stage is complete.**
The controls/usage checkpoint is merged and pushed to main as `9a869240`.
The requested CodeHype badge is pushed to main; revised hero placement is `7e28f2bc`.
The C1 catalog checkpoint is merged and pushed to main as `8ab6c822`; provider controls and manual-model preservation were inspected in web/mobile browser captures.
The reviewed embedding-consent checkpoint is merged and pushed as `43fa8f57`.
The next C1 indexing failure/retry checkpoint is committed locally as `d77c1b76`: focused47/47 pass; sampled web/mobile component layouts are reviewed. A full-run Agenda lock regression was corrected as `a1a1d773` (broader44/44 and controlled race pass); corrected full regression14318 passed3786/3786. Real mobile captures found a disclosure outline/text overlap; the spacing correction and19focused checks pass, with recapture pending. No main promotion yet.
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

## Next implementation checkpoint — C1 embedding consent/reindex matrix

1. Catalog validation, displayed-revision authority and manual selection checkpoint
   is on main8ab6c822 (delivery docs66d0c733); broader live inventory stays open.
2. Embedding reviewed-destination consent race reproduced and corrected locally
   ind4cd4273. Focused pgvector48 pass/one stock-only skip; separate stock20/20.
   Shared/backend builds and both client types pass. Full frozen regression completed as session87929:3781/3781, zero failures/skips/cancellations, exit0.
   Root inspected QA022 web wide/narrow and mobile320/390 OFF controls; manifest
   confirms source/viewport metadata. Web production build passes. Scoped main
   promotion completed43fa8f57; wider enabled/error/native matrix stays open.
3. Next: implement persistent sanitized indexing failure/retry status and isolate
   failed pages so healthy queued pages proceed; follow the embedding audit order.
   Complete the remaining embedding consent/validation/reindex/search/client matrix.
   Keep live provider/OpenAI cache gates explicit; Matilda does not support the
   OpenAI-specific cache benchmark and does not waive that retained requirement.
4. Promote each qualified C1 checkpoint, then continue C2/M1 → C3 → C4/D1 → C5
   → C6 → final U1/integration/cleanup. Do not jump ahead or mark C1 complete early.

Orbyn Visual Check captures originals and a Markdown manifest only. This session
inspects images, owns findings/implementation and records acceptance.

## Current C1 catalog checkpoint — merged and pushed

| Requirement                 | Evidence                                                                                                                                                                                                                                                                                                                         | Remaining gate                                                |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Catalog response validation | Malformed catalogs/error envelopes produce sanitized provider errors; valid catalogs deduplicate/sort. Initial 10/11 failures reproduced, fixed.                                                                                                                                                                                 | Wider live-provider catalog matrix.                           |
| Preserve model choice       | Web read-only refresh preserves saved/manual choice; mobile saved settings sync only clean state. Actual callback tests pass, including both exact revision call sites.                                                                                                                                                          | Broader native switching matrix.                              |
| Connection authority        | Pre-dispatch expected generation check plus post-network re-read reject endpoint/key/options/enable changes, A→B→A and deletion with409. Independent same-kind rows, metadata/no-op edits and legacy calls retain behavior. No row lock spans network I/O.                                                                       | Remaining execution/embedding inventory matrix.               |
| Regression                  | Full frozen inventory implementation:3767/3767, zero failures/skips/cancellations, exit0,878544ms. Later server revision/client contract changes independently qualified50/50.                                                                                                                                                   | Full ADR stage acceptance remains open.                       |
| Builds/runtime              | Shared build, backend build, desktop/mobile types pass. Compiled revision probe returns409 and `staleCatalogAccepted:false`; external requests0. QA API restarted and healthy on8008.                                                                                                                                            | Wider production/native runtime matrix.                       |
| Visuals                     | Root inspected QA020 hero wide/narrow and footer; QA020 narrow Admin zoom100 recaptures; QA021 wide provider controls and mobile320/390 controls/manual draft. Controls are contained; manual draft remains after one catalog request per client. Wide full-page sticky-header/sidebar compositing is not whole-page acceptance. | Native, whole-page and wider live catalog matrix remain open. |
| Delivery                    | Catalog checkpoint merged by fast-forward and pushed as8ab6c822. Root mobile/app.json hash and unrelated local changes are preserved. Badge relocation is pushed as7e28f2bc.                                                                                                                                                     | Production deployment remains unconfirmed.                    |

Evidence:

- `/tmp/orbyn-c1-inventory-full-20261007.log` — terminal3767/3767.
- `/tmp/orbyn-c1-catalog-authority-before-20261007.log` — nine cases reproduce missing guards.
- `/tmp/orbyn-c1-catalog-authority-after-fixed-20261008.log` — terminal50/50.
- `/tmp/orbyn-c1-catalog-revision-compiled-20261008.log` — compiled409, no stale catalog.
- `/tmp/orbyn-c1-catalog-revision-backend-build-20261008.log` and desktop/mobile type logs.

The first post-fix test cohort was49/50: its schema-validation assertion wrongly
expected400 rather than Orbyn's422. Corrected the test and separately covered400
for malformed JSON; final50/50 includes401/403/404/409/422/429 boundaries.
The earlier full run does not include the later server revision implementation;
its focused and compiled evidence are explicitly separate. Matilda live evidence
belongs to the earlier usage checkpoint and does not qualify OpenAI cache economics.

Current capture directory:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/`.
QA020 hero wide1278×900, narrow390×844 and clean-footer wide originals were
inspected by this session. Initial narrow Admin and clipped416px wide files are
invalid acceptance evidence. The verified narrow recaptures use390×844 CSS,
DPR2 and zoom1. QA021 mobile320×740/390×844 originals show contained controls.
Web and mobile preserve `qa-manual-model` after the single catalog request;
reloading returns the saved web model `matilda`. No option was selected, saved,
tested or used for inference. The web selector appeared without a visible error;
its options were not opened, so the actual catalog contents remain unverified.
Wide full-page images have sticky-header/sidebar compositing artifacts; only
provider-control containment/manual state is accepted from them. No whole-page
or installed-native acceptance is claimed.
Capture-only manifest: `QA-021-c1-catalog-capture-manifest.md` in that directory.
