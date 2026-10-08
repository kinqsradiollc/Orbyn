# Full C1 Reviewer report — round 1

Cycle `C1-full-2026-10-08`, 8 October 2026. **Round 1/3; C1 remains open.**
Reviewed tested source `aa10d566d5c11b8e3c1aa06063e60c4799c12e54`, branch
`codex/c1-full-completion`, checkout
`/Users/anhdang/.codex/worktrees/c1-perplexity-embeddings/Orbyn`.
Primary current-state recorded 1/3 before handoff. Reviewer took sole product/test
write ownership; Builder and Tester stopped source edits. Revised source is the
commit containing this report (resolve its exact SHA from Git before retesting).
This report does not accept the revised candidate without Tester and visual proof.

## Findings and corrections

| ID | Priority | Finding at tested source | Correction / closure requirement |
| --- | --- | --- | --- |
| R1-001 / Tester F1 | P2 | Seven web probe tests omit `loadRequest` from the extracted callback context. Six reject before their deferred resolver is created; the missing-revision case also throws. Full regression fails 7/4329. | Supplied the actual ref in both contexts; retained every previous model/receipt/revision/unmount assertion. Added list-refresh invalidation on web and retired-row invalidation on mobile. Focused pass; Tester must rerun the full inventory. |
| R1-002 / QA037002 | P3 | Both clients disable actions during catalog loading without explicit progress feedback. | Per-provider pending state, Loading models… label, polite status announcement; web aria-busy and mobile accessibility busy state. Authority fences retained. Delegated rendered/accessibility recheck pending. |
| R1-003 / QA037003 | P3 | Catalog failure appears in a global alert outside the initiating scrolled provider card. | Persistent generic inline error and Retry loading models at the card on both clients. Retry clears the error, keeps prior catalog/manual model, and only current callbacks can publish feedback. Global sanitized reporting retained. Delegated failure/recovery recheck pending. |
| R1-004 | Acceptance gap | Full C1 lacks required live provider/cache/embedding, enlarged text, installed-client and complete browser management/embedding evidence. | Concrete remaining checks below. These fixes cannot close full checkpoint acceptance. |

QA037001 single-duration correction has a delegated scoped aa10 browser/local
fixture pass (web320 Dark, mobile320 Light). Reviewer read the report, not its
inline pixels; original screenshots are not exported. No independent pixel
acceptance is claimed. Development QA037 source/runtime caveats remain historical.

New catalog callback tests execute the actual extracted handlers: pending state,
current failure, stale revision/unmount failure, prior-catalog preservation,
error clearing and successful retry without writing the model draft. Errors shown
inline are fixed safe copy, not raw upstream payloads. Stale outcomes cannot clear
another lifecycle's pending state. Web list reload resets feedback; mobile provider
revision effect resets feedback. No backend safety fence or test assertion removed.

## Full contract audit and evidence boundaries

Reviewed the retained ADR (A2/A3, provider administration and cross-client additions),
embedding audit, execution order, full handoff/qualification plan, Tester terminal
report, entrypoint recovery matrix, provider runtime inventory and acceptance ledger.
Inspected candidate delta since4735e714, client catalog/probe/embedding controls,
managed snapshot/resolution/fallback code, semantic batch/storage/queue guards and
setup's pre/post-probe revision checks. This is a requirement and targeted code
review, not a claim to have individually reread all466 test files. Tester supplied
the complete inventory and matching freeze hashes.

Original requirements come from `devday-2026-implementation-review.md` and its
incorporated `embedding-provider-audit-2026-10-01.md`. Later handoff and qualification
plans organize evidence; they cannot add a waiver or substitute fixtures for
original functioning-client, native or real-provider requirements. Full SIWC
account/OAuth delivery belongs to C2/M1; C1 still must preserve personal/managed
boundaries and qualify applicable installed-client selection/recovery. Whole-app
U1 remains later scope, while C1's changed surfaces require their own U1 checks.

| Retained C1 requirement | Round-1 assessment | Exact remaining qualification |
| --- | --- | --- |
| A2 managed/BYO/personal discrimination, budgets/team/MCP compatibility | Captured managed snapshot uses settings/provider generations, not secrets; job recovery refuses unprovable old identities. Explicit personal fallback resolves captured managed identity. Full suite outside F1 passed; no additional bypass found in inspected paths and entrypoint reconciliation. | Revised full suite; actual installed selection/restart/revocation and authorized live recipient proof. C3/C6-wide delivery is not inferred. |
| Multiple connections, duplicate kinds, custom endpoints and credential management | Twenty-kind inventory and fixture adapters retained. Backend revisions and redirect fences remain; UI management exists. Browser CRUD/default/key-change matrix is incomplete. | Two same-kind synthetic rows; create/edit/name/endpoint/key replacement/removal, enable/disable, cancel/delete; read-back persistence and masked credentials; both clients and security boundaries. |
| Actual catalogs/manual models/defaults and stale authority | Pagination/protocol fixture evidence exists; list-generation/model/receipt fences preserved. Harness correction and new callback tests pass. | Current-source large/slow/empty/503/retry, selected/manual/unavailable model; account/permission/revision changes while pending; explicit default read-back and no automatic replacement. Live catalog/model support remains separate. |
| A3 Sol/model-aware capabilities, wire formats and selected model | Responses/Messages/compatible/Azure/Zen/Perplexity inventory and test evidence retained; no default-forcing change in this round. | Current fixture suite and permitted real model/transport capability probe. Vendor model availability/plan entitlement cannot be inferred from inventory. |
| Reasoning/cache controls, stable prefix and usage observations | Managed evaluator uses fixed inert repeated prefix and records observed usage/latency; controls and focused evaluator tests pass. Its exact-marker check is a narrow functional quality check. | Authorized current model, declared workload/baseline/repetitions/quality rubric/spend bound; measured cache hits/writes/input/output, latency and cost basis. No measured savings or general quality claim yet. |
| Truthful owner usage and personal exclusion | Existing usage/isolation/regression evidence retained; QA037 receipts remain fixed local ping evidence. | Current-source positive/large/unknown/loading/error/retry and owner isolation, browser + installed clients. Counters are not plan bills or remaining quota. |
| Independent embedding recipient/model, capability and explicit destination consent | Both clients send displayed embedding revision and configuration generation. Setup rejects stale/missing recipient proof before probe and rechecks under locks after probe. | Rendered enable/consent/reset/revalidation/error flows on dedicated pgvector preview; live explicitly accepted recipient/model proof. |
| Dimension validation, replacement/reindex and search provenance | Real vector fixture69/69 includes3072 dimensions/replacement; no truncation. Storage uses current config/doc generation and exact strategy is described as migration-managed. | Current client status/dimension/reindex flow, larger real accepted model matrix; do not claim runtime query-plan inspection from a configured label. |
| Consent/source/access races and queue acknowledgement | Semantic batches recheck source/config/access; guarded writes and conditional queue revision acknowledgement retain newer work. Tester69/69 covers permission/keep-out/delete/config races. | Revised-source receipt equivalence; rendered revision-change/reset/recovery; production/client combinations remain unverified. No need to repeat unchanged DB cohorts merely to inflate totals. |
| Mixed-version/stock/vector/late-install and independent worker | Tester separate69/69 and fresh legacy/late/maintenance1/1 each pass, with marked isolated DB provenance. Existing deployment/process tests passed within failed full run. | Revised full run; operational worker start/stop/restart/readiness on dedicated preview where missing. Production deployment is user-owned, not a C1 merge claim. |
| Persistent sanitized failure/backoff/status/retry | Failure state, retry schedule and newer-work fences exist; operational retry cohort passes. Worker liveness is displayed separately from measured/failed pages. | Enabled/pending/failed/waiting/healthy recovery and explicit refresh/retry on both rendered clients, preserving consent/source authority. |
| C1 responsive/themes/keyboard/nested overlays/enlargement/native parity | Types/build/export pass on aa10; QA037 normal-scale selected cases pass with provenance limitations; two feedback defects fixed locally this round. | Reliable320/390/768/1280 web,320/390 mobile-browser, short/landscape, themes, menus/picker keyboard/focus; genuine200% text and installed Electron/iOS/Android flows. Exports are packaging only. |

## What external prerequisites actually block

No demonstrated external prerequisite blocks implementing the identified local
catalog fixes or running deterministic authority/embedding tests. They block
verification of real provider/model eligibility, accepted live recipient behavior,
cache economics, real enlarged rendering and installed storage/recovery. Missing
credentials/devices/tool support are evidence gaps, not proof that code is correct
or incorrect. No new provider adapter is justified solely because access is absent.
A real qualification failure may reveal additional implementation work later.

The handoff reports no managed OpenAI evaluation key/model in checked env files;
Reviewer did not extract credentials or perform paid calls. Required next inputs:
authorized provider/model/destination and benchmark budget; accepted live embedding
recipient; supported genuine zoom/text enlargement control; installed builds/devices
with OS/source identity. These inputs remain mandatory. No permission is inferred
from a relayed message. No cross-chat message was sent in this round: direct human
messaging authorization in this chat is not established by Builder's instruction.

## Next executable checks and visual handoff

Tester takes the exact revised committed source, records inventory/freeze hashes,
and reruns `npm test` against an exclusively owned marked stock test DB. Run the
client-focused cohort below and workspace types/build/mobile packaging as appropriate.
Embedding/backend product source did not change in this round: prior separate
integration results remain aa10 evidence, not new-source runs. Tester decides and
records whether unchanged-source hashes justify retaining them or rerunning.

Visual work goes to Orbyn Visual Check with the revised SHA and owner-confirmed
API8008/client5174/8083 provenance. Builder can prepare runtime-only fixtures once
source freezes; do not mutate the existing QA037 row/default/consent underneath QA.

1. **Feedback recheck:** local250-model fixture only; delay4.5s, then503, empty,
   success. Both clients320/390 Light/Dark, reliable wide web frame. Scroll to
   provider action; manual draft and prior catalog survive. Pending label/status
   and busy semantics present; inline failure/retry visible; retry clears failure,
   success clears loading; no stale success/error after refresh/revision/unmount.
   Record accessible roles/live-region attributes separately from an actual
   screen-reader announcement test (not implied by screenshots).
2. **Management/default/key checks:** dedicated disposable account/fixture with
   two same-kind connections and synthetic keys. Create/save, reload, edit name,
   endpoint and synthetic key, cancel edit, remove key, disable/re-enable, test,
   select manual/unavailable model, choose explicit managed default, reload,
   switch to second connection, delete active connection with confirmation then
   verify assistant off. Record before/after GET settings/provider rows with no
   key payload. Restore only owned fixture state. Never alter original QA providers
   or use the current ping fixture as a real workspace default.
3. **Embedding enabled/error checks:** separate marked pgvector preview and
   synthetic pages/account, deterministic HTTP embeddings and independently owned
   measuring worker. Select independent provider/model, accept displayed destination,
   enable, verify measured dimensions/exact mode and pending→indexed; pause worker,
   show offline/pending; set provider failure, show sanitized failed count/retry;
   restore success and wait for scheduled retry. Replace dimension/model and verify
   cleanup/requeue; change provider revision between consent and click/in-flight,
   verify409/reset/revalidation; turn off, verify no later calls. Keep generation
   default separate and word search working. Capture status/error/loading on both
   clients/themes; stop owned worker and restore/remove only owned synthetic data.
4. **Interaction matrix:** full Tab/ShiftTab, model search→last item, Escape/menu
   focus return, safe cancel, narrow/short/landscape and wide expanded/collapsed
   panes, genuine enlargement. Installed platform checks need actual build/OS/
   device/version and secure-storage restart/revoke behavior. Do not silently reduce
   this to screenshot containment or bundle exports.

## Local repair validation and decision

- Initial repaired probe/catalog callbacks:42/42, zero fail/skip/cancel, exit0;
  `/tmp/orbyn-reviewer-r1-client-focused.log`.
- Expanded final client/control/inventory/evaluator cohort:202/202, zero
  fail/skip/cancel, exit0; `/tmp/orbyn-reviewer-r1-expanded-focused.log`.
  Command: `npx tsx --test --test-concurrency=1` with
  `admin-ai-probe.unit.test.ts`, `admin-ai-catalog.unit.test.ts`,
  `embedding-controls.unit.test.ts`, `embedding-model-catalog.unit.test.ts`,
  `ai-model-controls.unit.test.ts`, `provider-runtime-inventory.unit.test.ts`,
  `managed-controls-evaluation.unit.test.ts` under `backend/tests/`.
- Final workspace `npm run typecheck`: PASS exit0, `/tmp/orbyn-reviewer-r1-final-types.log`.
- `npm run build`: PASS exit0, `/tmp/orbyn-reviewer-r1-build.log`; final accessibility markup was completed during that run, so final `npm run build -w desktop` independently passed exit0, `/tmp/orbyn-reviewer-r1-final-web-build.log`. Backend/shared source unchanged. Existing large-chunk warning only.
- `git diff --check` passes. Complete primary Tester report copied unchanged;
  current-state top reconciled while preserving candidate history; ledger appended.

**Decision: request changes / retest; no full C1 acceptance.** R1-001/002/003
are implemented but await independent Tester and rendered verification. Preserve
failed4322/4329 as historical evidence. Shared counter stays1/3; next formal review
requires tested-source handoff and persisted2/3. Maximum3 rounds, no silent reset
or fourth review. No merge/push/deploy/C2 advancement or finished-C1 pause.

## Same-round evidence closure — 8 October 2026, 20:13 Melbourne

Evidence-only follow-up within **round1/3**, applying canonical workflow
clarification8eea1512: verified fixes may close existing findings in the same
round. Earlier text implying that every retest automatically requires round2 is
superseded. No new full candidate review, product/test edit or counter increment.
Candidate remains clean frozen `244abc21c464d19c379bf0ebaf5d431f4f8e344d` on
`codex/c1-full-completion`; Reviewer independently checked Git HEAD/status.
Only this primary report is appended; the frozen source checkout is unchanged.

Read `c1-full-2026-10-08-retest-r1.md` and final consolidated QA038 evidence at
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-038-c1-round1-catalog-2026-10-08/visual-analysis.md`.
Independently inspected terminal TAP tails: full4337/4337 and focused202/202,
zero failures/skips/cancellations. Tester records terminal exit0/signal:null,
all466 test hashes matching, workspace types/build and both mobile exports pass.
Prior aa10 failed attempt remains historical; no new test run by Reviewer.
Unchanged operational69/69 and separate migration1/1 receipts remain explicitly
aa10 executions on equivalent relevant source, not freshly executed244a results.

| Finding | Evidence closure | Remaining limitation/correction |
| --- | --- | --- |
| R1-001 / Tester F1 | **Closed for the harness defect and added lifecycle assertions.** Independent full/focused repaired-source results verify all seven former failures plus added refresh/retired-row coverage. | Does not qualify every installed/provider race or full C1. |
| R1-002 / QA037002 | **Visible loading feedback verified; partial closure only.** Delegated representative narrow/short/theme browser cases show Loading models… while disabled, retained drafts/catalog, then idle. Web rendered aria-busy and polite status markup verified by Visual Check; mobile polite live text exists. | Full pending accessibility correction remains open as QA038001: mobile browser exposes no aria-busy despite the source accessibilityState. QA038002 duplicate visible mobile progress remains open. Actual screen-reader announcement/native behavior is untested. |
| R1-003 / QA037003 | **Closed for the scoped inline failure/retry defect.** QA038 final retained-form503→empty→success→retained-catalog503→success sequence verifies nearby persistent error/retry, cleared old errors after explicit successful retry, preserved manual drafts and prior loaded picker/helper. | Rendered prior-state retention does not re-enumerate every catalog entry or prove stale authority races. Callback stale/error tests supply separate local evidence; no new full visual matrix inferred. |
| R1-004 | **Open.** No full C1 acceptance or overall code-review approval from this closure. | Remaining management/default/credential, enabled/error/consent/status embedding evidence; reliable wide captures, genuine enlargement, installed clients and authorized live-provider/cache/embedding qualification. |

QA038001 and QA038002 remain **P3 open findings**. The missing rendered busy
attribute is a browser markup gap, not proof that all assistive technology fails
to announce progress. The duplicate visible Loading models sentence is confirmed
by delegated short-height mobile inspection and matches the source's visible
live-region Text; future correction must preserve an accessible announcement
without duplicate visible copy. No correction is made before explicit source
ownership handoff. These are not hidden by closing the original visible-feedback
portion of R1-002.

Visual conclusions here are a review of **delegated Markdown evidence**, not
personal pixel inspection. QA independently identified frontend244abc21; APIaa10
runtime/source equivalence is owner-confirmed and backend product is unchanged.
Original images are inline-only with export limitations. Reliable wide frames
were excluded due to capture inconsistency; no overlap defect or pass inferred.
Historical shared-control/theme evidence can be reused only under recorded relevant
source/runtime equivalence. No new screenshots requested; ongoing StageA/B batches
retain their single fixture owner and cover specific missing cases.

**Decision:** close R1-001 and scoped R1-003; verify the visible-feedback portion
of R1-002 while its accessibility/content follow-ups remain unresolved. Round1/3
stays open for those findings and R1-004 acceptance gaps. No full C1 approval,
main merge/push/deployment, C2 advancement or completed-C1 pause. Three rounds
remains a ceiling; any later new full review must persist the next number, while
verified closure of existing findings need not consume another round.


## Same-round QA038001/002 scoped repair — 8 October 2026

Explicit sole source ownership was handed to Reviewer for these two existing
R1-002 follow-ups only. No new full review, counter remains1/3. Clean starting
source244abc21. Builder performs runtime/API qualification on unchanged compiled
backend without source edits/builds; Tester waits for this repair freeze.

The installed React Native Web0.21.2 createDOMProps maps `aria-busy` but does not
map this `accessibilityState.busy`. AdminAi now supplies both native-facing busy
state and supported `aria-busy`. SmallAction accepts an optional Text live-region
prop; the catalog action's existing label carries the polite announcement instead
of a separate visible Loading models sentence. Other SmallAction consumers retain
their default behavior. No hidden text layout, font scaling restriction, callback
or provider-authority change. Native-facing live-region props remain present;
actual screen-reader announcement timing and installed behavior are unverified.

Changed files:
- `mobile/src/screens/AdminAi.tsx`: supported busy prop, one visible progress label.
- `mobile/src/components/SmallAction.tsx`: optional live-region forwarding to label.
- `backend/tests/admin-ai-catalog-accessibility.unit.test.ts`: actual ProviderRow /
  SmallAction markup through installed RN Web View/Text/Pressable renderer, with
  unrelated controls/motion isolated; native-facing state/announcement props also
  checked. Pending/idle/error cases verify busy true/false, single progress text,
  polite live label, disabled action and retained retry/manual draft.
- Review/current-state/ledger documentation only otherwise.

Pre-fix new test on244abc21:1pass/2fail, exit1; actual renderer confirms absent
busy markup. Log `/tmp/orbyn-reviewer-r1-a11y-before.log`; preserve failure.
After repair:205/205 across the prior seven-file202 cohort plus new three cases,
zero failure/skip/cancel, exit0; `/tmp/orbyn-reviewer-r1-a11y-focused.log`.
Command: `npx tsx --test --test-concurrency=1` with
`admin-ai-catalog-accessibility.unit.test.ts` plus the seven earlier focused files.
Mobile `npm run typecheck -w mobile`: exit0,
`/tmp/orbyn-reviewer-r1-a11y-mobile-types.log`. Scoped Prettier and diff checks pass.
No backend/web build or duplicate full regression by Reviewer; product change is
mobile-only and Tester records impact-based retest on the revised committed source.

Revised candidate is this containing commit oncodex/c1-full-completion in the
c1-perplexity-embeddings checkout; exact SHA returned in handoff and primary state.
Source frozen and Reviewer relinquishes writes for Tester after commit.
QA038001/002 are implemented and locally verified, **not independently closed**.
Use on-demand rule94284ab7: if rendered recheck is needed, one bounded mobile
pending-state check for these named defects only; no management/embedding sweep.
No cross-chat messages sent by Reviewer. Builder can coordinate from its authorized
chat. R1-004 and required live/native/enlargement gates stay open; no full C1
approval, main merge/push/deployment or counter increment.

## Same-round final QA038001/002 closure — 8 October 2026

Review-only evidence closure on `3ccf8f578d3e355238ee55478e7d5e02b2b68b67`,
branch `codex/c1-full-completion`, c1-perplexity-embeddings checkout. Read the exact
244abc21→3ccf8f57 product/test diff and independent Tester report
`c1-full-2026-10-08-retest-r1.md`, including its final QA039 status correction.
Git inspection confirms clean source at3cc. No tests, builds, product/test edits
or browser actions performed by Reviewer. Only this primary report is appended.

**QA038001 closed for missing mobile-browser busy markup.** AdminAi supplies
`aria-busy={catalogLoading}` alongside native-facing accessibilityState. Tester's
205/205 includes actual installed React Native Web serialization of true/false
busy state from the real ProviderRow and SmallAction source, with unrelated
controls/motion isolated. This directly verifies the property-mapping defect;
it does not demonstrate a live device accessibility tree or announcement timing.

**QA038002 closed for duplicate visible loading copy.** The separate loading Text
was removed. SmallAction forwards the optional polite live-region prop onto its
existing label. The independent renderer cases verify exactly one pending loading
string, no pending string when idle, and polite live-region serialization on the
label. Existing error/retry/manual-model assertions pass. Other SmallAction callers
leave the new optional prop unset. No provider-authority callback changed.

Tester records205/205, zero failures/skips/cancellations and exit0, workspace
typechecks and iOS/Android exports passing. Retained full4337/4337 is explicitly
the244abc21 execution on unchanged backend/dependency/fixture source; the three
new accessibility tests were separately executed within205/205. Do not relabel
these as a new full4340 run. Earlier aa10 failures and pre-fix markup reproduction
remain historical evidence. Packaging does not establish installed interaction.

R1-002 is now closed for the original visible-loading defect and its two scoped
markup/content follow-ups. R1-001 and scoped R1-003 closures stand. Actual screen
reader behavior, including whether the busy ancestor defers announcements until
idle, and installed-native accessibility behavior remain unverified; serialization
alone does not prove those outcomes. No automatic visual sweep is requested.
QA039 is finalized/stopped; its final cleanup and limited management observations
remain separate evidence, and embedding StageB was not performed.

**Decision:** existing local round-1 correction findings R1-001/002/003 are closed
within round1/3. R1-004 and mandatory full C1 acceptance gaps remain open, including
live-provider/cache/embedding, genuine enlargement and applicable installed-client
verification. This scoped closure is not a new full review or full C1 approval.
No counter increment, main merge/push/deployment or next-stage advancement.

## Scoped main-promotion recommendation — 8 October 2026

This is a round1 closure/promotion decision using the already reviewed frozen
`3ccf8f578d3e355238ee55478e7d5e02b2b68b67` candidate and subsequent receipts,
not a newly initiated full review. Counter stays1/3. Reviewer inspected Git
HEAD/clean status, candidate commit/file inventory, retained ADR A2/A3 and provider/
mobile acceptance sections, embedded reindex contract, current workflow and
`c1-full-2026-10-08-runtime-qualification.md`. No tests/builds/source edits.

**Recommendation: approve main integration of the qualified local C1 checkpoint
at3ccf8f57.** Scope is provider reload/retry lifecycle, catalog loading/error/retry
feedback, mobile busy/live-label correction, configured embedding search-strategy
reporting and single-duration test receipts, with associated tests/evidence.
There is no remaining identified code defect in this reviewed scope that blocks
its integration. R1-001/002/003 are closed; independent205/205, workspace types and
mobile exports support the final mobile revision. Broader4337/4337 and production
build evidence belong to244 with recorded relevant source equivalence, not a
new3cc full run. This recommendation does not certify every retained C1 requirement.
The ADR explicitly permits integrating ready scoped checkpoints while recording
external limits; the execution order permits only qualified scopes on main.

Builder should preserve the tested product/test content when integrating and
retain newer main instructions, historical failed receipts, latest same-round
closure and current open-gate status when reconciling documentation. The candidate
contains historical role/counter wording that must not overwrite canonical
review-only roles or same-round closure policy. A product conflict/resolution that
changes behavior requires Tester impact assessment and verification; a clean
scoped merge alone is not new merged-source runtime evidence. No merge is performed
or claimed by Reviewer.

### Remaining mandatory C1 requirements, with their actual scope

| Contract basis | Still required for full C1 completion | Concrete prerequisite / next action |
| --- | --- | --- |
| ADR A3 acceptance | Real permitted managed probe and cache cost/latency/quality evaluation against the current baseline, with supported selected model/options and honest observed usage. | Authorized compatible managed account/key/model and permission for the bounded workload; declare baseline/quality rubric and cost basis. Existing fixture evaluator and Matilda baseline do not substitute. No requirement to benchmark every possible model is invented. |
| Provider administration and incorporated embedding contract | Actual supported adapter/capability qualification and accepted independent embedding recipient/model, safe dimensions/reindex and unavailable/revoked behavior where existing evidence is missing. | Authorized recipient/model for remaining live proof; use existing twenty-kind fixture inventory, operational69/69 and source-equivalent migrations/races. A catalog is not entitlement. Do not turn this into a requirement to buy every vendor account or test every model combination. |
| Mandatory mobile parity and affected-surface acceptance | Applicable C1 provider/settings flows on installed iOS/Android, with persistence, failure/recovery and keyboard/accessibility behavior; applicable desktop-client behavior where browser equivalence cannot establish it. | Candidate installed builds/devices and appropriate accounts. Exports do not prove interaction. Full SIWC OAuth/account execution delivery remains C2/M1; it is not a new C1 blocker. |
| ADR affected-surface large-text/responsive/interaction requirements | Explicit unresolved enlarged-text and relevant responsive/keyboard/overlay evidence for C1 surfaces. | Supported genuine enlargement/device settings and reliable evidence for the specific missing risk. Existing equivalent QA037–039 evidence is reusable. No full-app U1 sweep, Cartesian browser matrix or automatic embedding StageB batch is required by this recommendation. |
| Embedding word-search, disable/revalidation and operational contract | Finish or reconcile remaining actual runtime assertions: post-revalidation indexing, turn-off/no resumed disclosure and ordinary word search. | The runtime report at this read explicitly leaves these operations pending. Builder completes owned fixture cleanup and records normal API/worker receipts; Tester reconciles existing applicable tests. This is an evidence task, not an identified code defect or a requirement for a screenshot. |

The new actual API/worker sequence supports independent3D indexing, sanitized503
backoff and scheduled recovery,7D replacement/requeue, real heartbeat expiry and
worker restart, and stale/in-flight revision409/revalidation. It uses synthetic
content and a local recipient with unchanged compiled244 backend. It cannot close
live-recipient or installed-client gates. Its pending cleanup/word-search items
must not be described as already passed. QA039 is finalized/stopped; retained
functional CRUD/default/key observations and API/tests should be reconciled before
calling anything a missing requirement. Failure to perform active-backup deletion
in that browser batch alone is not an invented requirement to repeat the whole
CRUD matrix; existing deletion tests/API evidence may satisfy the behavior.

A separate real screen-reader session remains unverified. The original contract
requires appropriate accessibility; the specific missing busy-markup and duplicate
copy defects are closed by the actual renderer evidence. Do not introduce a new
universal screen-reader certification gate merely because a test cannot prove all
assistive-technology behavior. Preserve this limitation accurately for applicable
installed/enlarged interaction acceptance.

**Full C1 remains incomplete.** Scoped main integration is recommended; calling
C1 complete and taking the user's conditional completed-C1 pause is not supported
until the mandatory gaps above are resolved. Missing external access is a concrete
verification prerequisite, not a waiver and not proof of an implementation defect.
No full approval, merge/push/deployment or C2 advancement is claimed here.
