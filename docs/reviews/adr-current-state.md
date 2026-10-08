# ADR implementation tracker

Updated 8 October 2026. Follow the full contract in
[the implementation review](devday-2026-implementation-review.md) and
[the top-down execution order](adr-execution-order.md).
Detailed qualification and historical failures remain in
[the C1 acceptance ledger](c1-acceptance-ledger.md).

**Active stage: C1. No entire ADR stage is complete.**
Latest delivered product checkpoint: chat maintenance provider authority, merged
and pushed as a5d2274f. Frozen full4286/4286, focused103/103, actual migration258
upgrade1/1 and backend types/build pass. Memory and chat compaction now retain
captured owner/provider/model authority and recovery identity. Reopening/pinning
revokes compaction without counting a failed attempt. Deployment pauses the old
notifier before migration. The earlier f5445544 full failure remains recorded;
its corrected re-entry assertion passes in the final full suite. See
[the maintenance receipt](c1-chat-maintenance-authority.md).

Next C1 checkpoint: [managed entrypoint usage](c1-entrypoint-usage-and-availability.md).
The branch now corrects missing observed usage receipts for managed Agenda
briefs and hosted maintained pages. Focused125/125 and backend types/build pass;
after disk recovery, frozen15c4a8e3 full4300/4300 passes. The subsequent copy/privacy
correction passes UI/legal15/15, both client types and web build. QA-033 accepts corrected positive
usage rendering on web/mobile browser320/1280, both themes. Product2f6c7f82 is
qualified for scoped integration; receipt below will record main delivery.
After those are qualified and integrated,
correct the independently reproduced global-provider availability gate affecting
all five personal automation scanners. No next-stage implementation has begun.

Compact Settings density/copy/focus checkpoint7260db93 remains qualified by its
full4262/4262, focused31/31, desktop types/web build and scoped QA-030 review.
QA-031 enlarged-text acceptance remains open: pinch magnification is insufficient
and native Codex app control was denied. Docker restoration/cleanup is recorded
in accad117; Docker and the active stock PostgreSQL fixture are healthy.
Production deployment is unconfirmed.

Embedding discovery, exact mobile model search and provider redirect protection
were merged as2fd8e14d, from candidateab01bcc8. That source's fresh full4246/4246
passes with zero skips/cancellations; focused170/170,
catalog/inventory10/10, vector repeat34/34, workspace types/backend/web builds
and scoped web/mobile browser review pass. Remaining C1 gates below stay open.

Settings checkpoint dbcf8c84, containing compact navigation c69f342f and a narrow
Theme control correction, is merged as994d6de3. Focused23/23, desktop types and
web build pass; frozen full4250/4250 passes, zero failures/skips/cancellations,
exit0,815595ms. Promoted application/test source matches the tested candidate.
Parent c69f342f independently passed4248/4248, vector69/69, upgrade1/1 and
late-install1/1; these are not results from the newer source.
The user now authorizes Visual Check's analysis. Its delegated normal-scale
recheck accepts Theme containment on web320/390/1280 and mobile-browser320/390,
Light/Dark. Root reviewed its report; exported originals remain unavailable.
Overall Settings UX is not accepted. The new checkpoint corrects duplicate
search focus, excessive narrow chrome/rows and Connected agents copy in scoped
browser review and is integrated on main. 200% enlargement and
native acceptance remain unverified. The researched repository skill covers UI and
UX task flows, concise copy, density, recovery and cross-client acceptance.
The local test container stopped and lost its temporary DB; the owned preview DB
and disposable admin were restored. Fresh login works; usage counters are zero.
Historical positive/error/overflow images remain unreviewed. Details:
[current usage/Settings review](c1-managed-usage-visual-review.md).

Current C1 Settings UX checkpoint d672fc50 is merged as7260db93. It uses
the available phone modal space, compact padding/rows, one search-focus outline,
and concise Connected agents copy with optional help on web/mobile. QA-028 accepts
scoped portrait density/copy/single-focus improvements on parent5e69d4eb but found
narrow dismissal focus loss and poor landscape task space. Parent full4254/4254
passes; it is not delivered independently. The corrected candidate adds visible
navigation focus return, height-aware navigation and backdrop specificity fixes.
Parent38558c8a focused29/29, both client types and web build pass. Its frozen full
regression finished4260/4260, exit0, zero failures/skips/cancellations (812881ms).
QA-029 is complete: phone modal space, landscape content height
and Close focus return pass in the inspected scope; narrow Escape still returns
focus to BODY. Root reviewed the report. Follow-up d672fc50 skips a closing
sidebar as a focus target and passes31/31 focused checks, desktop types and web build on the
frozen source. QA-030's resumed internal-browser review accepts independent
narrow Search/Close Escape and Close Enter, settled-sidebar dismissal, wide
expanded/collapsed and wide-to-narrow return, and nested-picker Escape. Normal
Theme/search containment and mobile help spot-checks pass. Root reviewed its
delegated report; enlarged/native and full Settings acceptance remain open.
QA-030's initial attempt could not open Settings because preview account data
failed to load while Docker/PostgreSQL were unavailable.
Approval initially failed with disk-full ENOSPC; space recovered and the scoped
freeze succeeded. The user subsequently authorized Docker restoration and
unused Orbyn container cleanup. Docker is healthy,21 unused stopped containers
were removed with persistent volumes retained, and the disposable preview DB/admin
were restored: health200/register201/me200 admin. See
[the recovery receipt](docker-restoration-2026-10-08.md).
Fresh full d672fc50 regression finished4262/4262 in a separate marked test database,
exit0, signal:null, zero failures/skips/cancellations,794219ms. The scoped Settings
checkpoint is integrated; next are the remaining C1 provider/embedding/cache/client
acceptance gates in their recorded order. No C2 work or
full-stage completion is claimed.

## Historical checkpoint log

Entries below retain the state at their recorded checkpoint. The current summary
above and completion-gate tables control present status; an older "running" or
"latest" statement is not a current execution or delivery claim.

The controls/usage checkpoint is merged and pushed to main as `9a869240`.
The requested CodeHype badge is pushed to main; revised hero placement is `7e28f2bc`.
The C1 catalog checkpoint is merged and pushed to main as `8ab6c822`; provider controls and manual-model preservation were inspected in web/mobile browser captures.
The reviewed embedding-consent checkpoint is merged and pushed as `43fa8f57`.
The C1 indexing failure/retry checkpoint and its inference/deployment/UI prerequisites are merged and pushed as `d4da3d41`. Full3786/3786, focused47/47, migration/runtime checks and scoped browser review pass.
The pagination/inventory checkpoint is merged and pushed as `07edbcc5`: full3806/3806, separate inventory61/61.
Anthropic JSON fallback is merged and pushed as `eb493433`: full3880/3880,
focused145/145, backend build and compiled loop pass.
Together catalog repair is merged and pushed as `22f24742`: adapter46/46, route cohort63/63,
inventory61/61, backend build and compiled check pass. Full frozen regression
passes3894/3894, zero failures/skips/cancellations, exit0.
OpenCode selected-model transport source `890d42ce` is merged and pushed as
`2186dcb9`: focused335/335,
backend build and three compiled durable-loop protocol cases pass. Full regression
passes4044/4044 with zero failures/skips, workspace types/web build and separate
pgvector47/47 pass. Main and origin matched after fast-forward/push.
Embedding access-race and dedicated CI coverage is merged/published as
`c5dcc19c`:6/6 new checks and combined53/53 locally, zero skips, with unchanged
backend source. Remote CI initially52/53 failed because the new job omitted
the backend build required by the compiled-process fixture. The prerequisite
correction passes build and53/53 locally; corrected remote acceptance is pending.
The corrected dedicated embedding CI run37656656011 passes all five jobs,
including53/53 vector checks. Credential-test generation/model authority is
merged and pushed as47d35a07: route49/49, client27/27, workspace types/builds,
and full4083/4083 pass.
Native Perplexity embeddings are merged and pushed as6ece8866: explicit
signed-int8 decoding, reviewed1024/2560 widths, custom compatible float behavior,
adapter37/37, runtime67/67 and dedicated vector54/54 pass. Frozen full regression
passes4112/4112, zero failures/skips/cancellations, exit0,849290ms.
Native Perplexity catalog/generation routing is merged/pushed asf71ef338.
Compiled baseline1/3 →3/3, protocol/control/inventory cohort287/287 and backend
build pass. Full frozen regression4142/4142 passes with zero failures/skips/
cancellations, exit0,800029ms. Serialized actual-loop recovery preserves its
function signature/call id and does not repeat completed tool execution.
These are inert fixtures, not live account qualification.
Both preview servers now serve the C1 qualification checkout at5174/8083;
API8008 was refreshed from main1438b0bd; authenticated /me and /ai/providers
return200 with the same four saved providers. Authorized same-origin browser captures
now work; root inspected scoped empty-model/disabled-test crops on both clients
in both themes. These do not establish full-surface or current-backend acceptance.
Searchable picker candidateae099454 is committed locally, not merged: provider
search on both clients, bounded100-result web model search, manual value and
hidden-provider preservation, and viewport containment. Focused61/61, all three
workspace typechecks, backend/web builds pass. Fresh full regression and frozen
browser capture review were started. That initial full run finished4141/4153,
12fail: the new mobile type size and11 test-fixture pool-lifecycle failures.
Root also confirmed empty-popup clipping at320px. Corrected local source54f53b8c
and test-only693066d5 pass corrected73/73 and Teams23/23, workspace typechecks
and web build. Fresh full regression and corrected browser recaptures are now
completed: full4155/4155, zero failures/skips/cancellations, exit0,791435ms.
Root inspected corrected web320 Light/Dark and mobile320/390 originals, keyboard
return-to-Name, lower-list reachability and a credential-safe1280px wide crop.
That crop is not full-surface acceptance; native keyboard/installed clients remain
open. Picker and test-lifecycle correction are qualified for scoped main delivery.
Scoped picker/test-lifecycle delivery is merged and pushed as1438b0bd; main
and origin/main matched, and unrelated primary changes were preserved.
C1 remains active; no premature pause or C2 work.
The additional successful indexing access-race/recovery tests pass in the
current56/56 vector cohort, plus independent upgrade1/1 and late-install1/1.
No backend product source change or live-recipient acceptance is implied.
Access-race/recovery test delivery is merged/pushed as9921c086. Current
management/edit crops in both themes were inspected; positive receipt/catalog
interaction captures are now assigned against a disposable local inert provider.
Standalone cache-report estimate candidate23773ee6 passes focused5/5 and
backend types/build; its frozen full regression passes4158/4158, zero failures/skips/cancellations,
exit0. Live OpenAI cache
observations and costs remain unverified. The positive local-provider visual
batch is active; root rejected a blank mobile crop, reviewed its replacement, and confirmed
an exact-match mobile model filter defect. Isolated correctiona8ad5a8e passes
52/52 focused checks and types; corrected browser capture/integration is pending.
Current local combined candidate5466bc1c includes embedding model discovery
checkpoint1941fe13 and the pending mobile exact-match search correction. The
embedding catalog route is fenced to its independent recipient revision, labels
unclassified candidates honestly and preserves manual models and consent.
Focused discovery/catalog/client tests122/122, final workspace typechecks and
backend/web builds pass. Frozen full regression5466bc1c terminated early with exit7 and no final TAP
summary;18 existing component-harness imports failed. Test-only correction
15301fbd passes the expanded154/154 cohort; the isolated native-clock file passes
10/10. Disk space recovered to1.7GiB. Corrected source d498febd now has a fresh
full regression finished4226/4227, one missing administrator-route inventory
classification (exit1), zero skips/cancellations. Its own marked test database
and log are retained; no full pass or main
feature delivery is claimed. Both previews now serve that
candidate on the existing5174/8083 origins. Authenticated inert catalog loading
returns250 candidates, matching revision, with semantic search stillOFF.
The human restored Chrome availability; original corrected mobile and new
embedding UI captures have been requested from Orbyn Visual Check. Root inspected the mobile embedding and generation samples in both themes.
The no-match embedding strip defect is corrected locally with145/145 selected
regressions and mobile typecheck passing; its before/after component checks
reproduce the defect. Corrected no-match and web captures are pending. The Dark
generation no-match notice was clipped in its v2 original and requires recapture.
Candidate promotion remains pending. The latest delivered product checkpoint remains e3c68493; tracking docs
advance separately. The feature source is still local, not shipped.
Next: remaining provider/embedding/cache/client acceptance gates.
The user requested a pause after completing C1, before C2/M1.
Wider embedding/native/full-stage acceptance remains open.
Production deployment is unconfirmed; the user deploys main manually.
User/character changes and unmerged work remain preserved.

## C1 completion gates

This is the current C1 checklist; historical ledger rows describe earlier source.
A passing fixture or sampled view does not close its named external/native gate.

| C1 requirement                           | Implemented / qualified evidence                                                                                         | Open acceptance                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Managed, BYO and personal authority      | Immutable job choice, private/managed isolation and explicit fallback/provenance checkpoints on main                     | Complete entry-point/recovery matrix and actual permitted provider acceptance                  |
| Multiple independent saved connections   | All20 kinds resolve from saved rows; duplicate-kind/custom destinations, enabled/revised/deleted catalog fencing covered | Current-source browser/native management and credential-test interactions                      |
| Catalogs and manual/default preservation | Main pagination, Together array normalization, bounded validation and revision fencing; manual draft checks              | Remaining vendor default availability, large/slow/error catalog, keyboard and native switching |
| Generation wire formats                  | Main native Responses/Messages, Zen and Perplexity Agent recovery; compatible/Azure/Matilda fixtures                     | Broader actual supported-model qualification                                                   |
| Reasoning and caching                    | Supported controls/persistence/request mapping and observed usage on main                                                | Permitted OpenAI cache/latency/cost/quality benchmark; unsupported models remain explicit      |
| Usage honesty and separation             | Native/compatible usage counters, unknown values and private exclusion covered                                           | Positive/overflow/error client states; no inferred billing or plan entitlement                 |
| Independent embedding recipient          | Provider-bound consent and displayed revision fences on main43fa8f57                                                     | Live accepted embedding connection and full operational/client matrix                          |
| Vector dimensions and replacement        | Flexible pgvector storage,3072-dimension Azure fixture, replacement/requeue and old-result rejection                     | Broader authorized model/dimension runtime matrix                                              |
| Consent/document/visibility races        | Pre-click/in-flight provider, A→B→A, edits, disable, keep-out and queue-revision tests                                   | Remaining ownership/permission/recovery acceptance                                             |
| Migration and worker deployment          | Legacy upgrade, late extension, idempotence and profile lifecycle checks                                                 | Wider mixed-version/operational acceptance; production deployment is user-owned                |
| Indexing failure/status/retry            | Sanitized persistent backoff, newer-work fencing and healthy-page progress on maind4da3d41                               | Real enabled/error/loading client interactions and native review                               |
| Responsive and native clients            | Scoped web wide/narrow, mobile browser390 and earlier controls/zero-usage samples reviewed                               | Remaining full-surface coverage, large text/keyboard/overlays and installed-native acceptance  |

Finish these gates, record final C1 evidence and main delivery, then pause with the
remaining ADR table. C2/M1 stays queued until the user resumes after that pause.

## Full retained scope

✓ means a named checkpoint is implemented/qualified; ✗ means remaining work.
A completed checkpoint does not complete its entire stage.

| Order                  | Stage                            | Done                                                                                                                                                                                                                                                                                                                                       | Still required                                                                                                                                                                                                                    |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — ACTIVE             | C1 providers/models/embeddings   | ✓ Managed/personal isolation, selected routing, native Responses recovery, queued managed authority. ✓ Supported reasoning/cache controls, all managed response-format usage, embedding consent correction, responsive provider controls/menu/zero-usage review on main. ✓ Fenced indexing retries/status and measuring-worker deployment. | ✗ Complete connection/model inventory and multi-provider matrix; embedding consent/reindex/runtime/client matrix; permitted OpenAI cache economics and remaining live-provider qualification.                                     |
| 2                      | C2/M1 ChatGPT connections/models | ✓ Desktop protected credentials, executor/catalog/default and explicit fallback/provenance foundations; authenticated GET /models and PUT /models/default. Native OAuth/recovery follow-ups remain candidate.                                                                                                                              | ✗ Standalone web connection without desktop dependency; installed iOS/Android connection/storage/recovery; eligible inference, verified plan and truthful usage; account/catalog/default switching and revocation across clients. |
| 3                      | C3 Background/Overnight          | ✓ Separate lanes/profiles, characters, activity, rules/ownership, budgets and reflection foundations.                                                                                                                                                                                                                                      | ✗ All write paths/races/revocation; independent idle/running/waiting/stopped recovery; collaboration/reflection results; budget accounting and cross-client/native acceptance.                                                    |
| 4                      | C4/D1 Docs                       | ✓ Structured storage/API/editor foundations and selected Markdown/Mermaid/export/privacy checkpoints. Complete-tree/task/editor activation remains candidate.                                                                                                                                                                              | ✗ Normal editor ownership, remaining flat writers/task identity, collaboration, full CommonMark/GFM/code/math/Mermaid/media/link/anchor/footnote/import/export/privacy matrix and web/native checks.                              |
| 5                      | C5 pages/publication/channels    | ✓ Block bindings/jobs, comments, publication boundaries and separate Slack/Teams installation/outbox/reply/lifecycle foundations.                                                                                                                                                                                                          | ✗ Human-edit conflicts/source revocation/public consent; authorized real channel delivery/exact-question replies; tenant/lifecycle/reconnect and both-client acceptance.                                                          |
| 6                      | C6 separate plugin backend       | ✓ Separate service/principal/grants, managed inference broker/permissions, launch context/UI/import/reconnect foundations.                                                                                                                                                                                                                 | ✗ Real host OAuth/UI/account switching/reconnect; production configuration; managed/BYO execution; authorized security scan and triage.                                                                                           |
| Throughout; final gate | U1 whole-app UI                  | ✓ Settings modal, assistant/agent separation, selected Home/navigation/task controls. ✓ Current C1 provider controls/management and zero-usage states inspected on wide/narrow web and320/390 mobile browser, Light/Dark.                                                                                                                  | ✗ Every-page web/desktop/mobile matrix, positive/overflow/error/loading states, collapsed/nested panels, keyboard/large text and native acceptance. Browser checks do not prove installed-native parity.                          |
| Last                   | Integration/cleanup              | ✓ Qualified scoped checkpoints pushed to main, latest product7260db93; unrelated local changes preserved.                                                                                                                                                                                                                                          | ✗ Qualify/promote remaining retained scope; reconcile branches/worktrees; remove only safe merged work after full acceptance.                                                                                                     |

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

## Current implementation checkpoint — C1 provider inventory and pagination

1. Consent/reindex authority and persistent sanitized indexing failure/retry
   checkpoints are on main (`43fa8f57`, `d4da3d41`). Wider runtime/native coverage
   remains open; see their evidence rather than treating them as full C1 acceptance.
2. Audit all 20 configured provider kinds across catalog, dispatch, controls and
   embeddings. [The current inventory](c1-provider-runtime-inventory.md) separates
   source contracts, fixture qualification and live evidence.
3. Anthropic catalog pagination omission is reproduced locally: first page only
   returns `b` where the complete result is `a,b`. Qualified checkpoint follows same-endpoint
   cursors with one eight-second budget, bounded pages and sanitized whole-catalog
   failure. Focused adapter checks pass34/34; route/provider cohort passes49/49.
   Backend types/build pass; full frozen regression passes3806/3806,
   zero failures/skips/cancellations, exit0. Independent saved-row
   dispatch/catalog/embedding/agent checks pass61/61 across all20 kinds; these are
   fixtures and do not establish live vendor qualification.
4. Current runtime repair: Anthropic JSON fallback now locally preserves the
   Messages endpoint, native usage, truncation and authority. Reproduced suite
   initially5pass/5fail; expanded protocol/provider/recovery cohort passes145/145
   and backend build passes. Full frozen regression passes3880/3880, zero
   failures/skips/cancellations, exit0,756874ms. Merged/pushed as `eb493433`.
5. Keep remaining live-provider/OpenAI cache gates explicit. Matilda's fixed
   baseline does not qualify OpenAI cache economics. Promote this checkpoint only
   after qualification, then continue remaining C1 gates before C2/M1.
6. Pause after completing C1 and provide the remaining-work table. After a user
   resume, continue C2/M1 → C3 → C4/D1 → C5 → C6 → U1/integration/cleanup in order.

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

## Active corrected C1 candidate

Local source81e807ee repairs the administrator-route inventory omission and
rejects provider redirects before credentials or request text reach a subsequent
destination. Its actual compiled Anthropic reproduction now records one saved
recipient request and zero redirect-target requests, with a sanitized actionable
error. It also cancels streaming redirect response bodies. Focused170/170,
workspace typechecks and final backend/web builds pass. A fresh frozen full
regression is running; `/tmp/orbyn-c1-redirect-final-full-20261008.log`.

Root accepted the corrected mobile Light/Dark no-match samples and complete
Dark generation notice crop from d498febd; mobile source is unchanged in81e807ee.
Root's first wide web crop found native browser styling on the new Load catalog
button;81e807ee applies Orbyn's secondary style. Refreshed wide/narrow Light/Dark
web captures are assigned. The preview API8008 is compiled81e807ee and all three
preview origins return200. This feature remains local, unpromoted; latest main
product checkpoint is e3c68493. Tracking documentation advances independently.

### 8 October: terminal discovery regression and resumed Chrome evidence

C1 remains active. Frozen product81e807ee full regression finished4245/4246,
exit1, no skips/cancellations. The sole failure is the generated MCP route
summary after the new embedding-catalog admin exclusion (290→291). Candidate
document regeneration changes only those summary counts; configured catalog/
route inventory follow-up passes10/10, exit0. Initial follow-up omitted the test
DB and failed bootstrap; its log is retained separately. The full failure is
not relabelled as a new full passing run. Runtime product is unchanged.

Chrome capture resumes through Orbyn Visual Check. Root inspected original
narrow Light/Dark true zero-result and selected249 states and wide Dark
selected249: manual model preservation and horizontal containment pass these
scoped browser states. The catalog action uses the expected secondary styling.
Exact-search interaction and the completed capture manifest remain pending.
Candidate product is still local and unpromoted; no whole ADR stage completes.
Continue C1 retained gates, then pause before C2 as requested.

### Scoped visual acceptance and corrected full run

Root has completed81e807ee scoped web catalog review: wide/narrow last249
search, true-zero/manual preservation in both themes and corrected secondary
styling. Mobile's accepted d498febd presentation remains unchanged. Keyboard,
full-surface/native and wider C1 acceptance remain open. The temporary inert
provider was removed via API with four original rows and AI settings unchanged;
its owned server is stopped. No vendor calls or indexing occurred in the batch.

Fresh full regression for candidateab01bcc8 is live on the distinct marked
orbyn_c1_catalog_final_20261008_test database, tool session75238. Log:
/tmp/orbyn-c1-catalog-final-full-20261008.log. Keep product frozen until terminal;
do not infer a passing full result from current progress. Feature promotion waits
for its terminal evidence. Continue remaining C1 gates before the requested pause.

### Qualified catalog checkpoint merged — 8 October

Candidateab01bcc8 fresh full finishes4246/4246, zero failures/skips/cancellations,
exit0,834682.892583ms. Log /tmp/orbyn-c1-catalog-final-full-20261008.log;
terminal receipt /tmp/orbyn-c1-catalog-final-full-terminal-20261008.json.
This supersedes the generated-document failure for the corrected checkpoint,
without rewriting its earlier4245/4246 receipt. Candidate source was frozen.

Actual merge2fd8e14d has no conflicts. The unrelated mobile/app.json SHA1 remains
dacd602172347441f2fd92f16d8772b3ba1ef7a8 before/after; other unrelated dirt is
preserved. Root-scoped browser acceptance is recorded separately. Positive usage
mobile/overflow captures continue; broader C1 acceptance remains unfinished.
User deploys main manually; no production rollout is claimed.
