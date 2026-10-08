# Full retained C1 review — round 2

Cycle C1-full-2026-10-08. Round **2/3**, persisted before substantive review on
8 October 2026. Source `1a92a2c091e42d350e3b029bf57e932c630b4487`, branch
`codex/c1-production-checkpoint`, checkout
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
Full round-2 review completed. Reviewer inspected code/ADR/existing evidence only;
no tests, builds or product/test edits. Full acceptance remains open for E2; E1 is removed by user disposition.
Original report committed by Builder in3cb6d402; independently verified D1 closure
was committed and pushed in86c522f2. E1 scope closure is recorded below; E2 remains open.

## Decision

**Current disposition: E1 excluded by explicit user scope; E2 remains OPEN.**
Web preview qualifies shared web/desktop UI. The historical packaged Electron
startup failure is preserved, not relabelled as repaired or passing. No remaining
product-code defect is identified within the retained reviewed scope. Do not promote the product or
claim completed-C1 pause under the current full-acceptance workflow yet. This is
round2/3, not a requirement to consume round3; verified evidence can close these
round2 items without another full review.

## Scope and method

Applied current user overrides: no iOS builds/Android-specific verification;
shared mobile source/types and Expo-web parity remain. Live OpenAI cache and live
accepted-vendor embedding measurements are approved follow-ups; existing Matilda
baseline plus deterministic/runtime evidence is the C1 basis. At the initial
round-2 review, Electron and genuine enlargement remained required. The later
explicit user disposition removes separate Electron QA and accepts web preview
for shared web/desktop UI; genuine enlargement remains E2. No expanded vendor/model
purchase matrix, full-app U1 sweep or new universal screen-reader certification
gate is imposed. SIWC/account OAuth delivery remains C2/M1.

Read consolidated handoff, final Tester report, twelve-group readiness record,
retained ADR/embedding contract and execution workflow, prior round1 closure,
entrypoint/recovery and twenty-provider inventory, runtime qualification and QA040
closure. Inspected final consent-label/test delta, catalog/probe/embedding controls,
embedding catalog hook, managed snapshot/resolver/fallback paths, guarded embedding
writes/failure backoff and relevant authority/catalog/access/control test assertions.
Prior round1 source/evidence review is retained for unchanged implementation. This
is full requirement reconciliation with risk-based code inspection, not a claim to
have reread every file or personally executed tests/pixel checks.

Independent Git comparison of244abc21→1a92a2c0 shows no changes to backend/src,
migrations, packages or root/backend/desktop/mobile manifests and lockfile; only
the new catalog-accessibility test and revised embedding-controls test differ in
backend/tests. Both are included in Tester's current208/208. The supplied triple-dot
comparison receipt is therefore corroborated here with endpoint comparison.
Candidate HEAD/status are exact1a92a2c0 and clean. No commands executed tests/builds.

Tester current evidence:208/208, zero failure/skip/cancel, workspace types and
production build exit0. Retained full4337/4337 belongs to244abc21; operational69/69
and three independent migration1/1 receipts retain their original source/DB
provenance. No new full aggregate is inferred. Matilda proves only its six fixed
checks/latency, not cache costs, general quality or vendor entitlement.

## Full retained C1 disposition

| Group | Inspected basis and current disposition |
| --- | --- |
| Managed/BYO/personal authority | `providers/managed-authority.ts`, `resolve.ts`, `user-choice.ts`, entrypoint/recovery map and retained authority/process suites. Immutable settings/provider generation, fail-closed legacy snapshots and explicit pre-stream fallback remain intact. Local contract supported; former Electron gate E1 subsequently excluded by user disposition. |
| Saved independent connections/credentials | `modules/ai/admin.ts`, current client callbacks, catalog-authority tests and QA039 scoped CRUD/default/key evidence. Independent same-kind rows, revision checks and masked credentials retained. API/tests establish functional behavior beyond the browser subset; no blanket duplicate CRUD screenshot matrix required. |
| Catalog/manual/default/stale response | Catalog/probe tests in208, reviewed callback fences, QA037/038/039. Draft/manual selections and prior catalogs survive scoped failure/retry; stale results withheld. No new defect found. |
| Generation formats/inventory | Twenty-kind saved-row adapter inventory, retained full protocol/fallback/redirect evidence and Matilda baseline. Supports local implementation; unsupported transports remain explicit. No broad vendor certification claim. |
| Reasoning/cache | Model-aware controls, stable-prefix mapping, usage validation and evaluator tests in208. Live economics correctly deferred by user; no unmeasured cost/savings claim. |
| Truthful usage/private separation | Retained full isolation/usage evidence and current control tests; prior scoped positive/large/unknown/loading/error/retry records. Missing/contradictory counters remain unknown; no bill/quota inference. |
| Independent embedding recipient/consent | Both SemanticSetup clients, embedding catalog hook, admin pre/post-probe revisions; QA040 full accessible-name correction and three current regressions. Displayed recipient/exclusions equal switch name. Consent resets on model/provider/revision change; actual AT behavior unverified. |
| Dimensions/replacement/reindex/search | Retained real vector69 and synthetic3D→7D runtime. Old measurements deleted/requeued and current generation/document provenance enforced; configured exact strategy is not a live query-plan claim. |
| Consent/source/access races | `search/embedding-state.ts`, semantic guards and access-race fixtures. Success/failure apply only with current config, provider, page visibility/version and queue revision; newer work is retained. Local contract supported. |
| Migration/worker/recovery | Separate stock/vector/legacy/late/mixed-version receipts plus real worker expiry/restart. No duplicate migration run required solely for unchanged source. |
| Failure/status/retry/off | Sanitized persisted backoff and scheduled retry, current client error/recovery, runtime revalidation/off cleanup and word search with provider stopped. Earlier pending runtime operations are now evidenced; no longer listed as blockers. Post-off authority additionally relies on unchanged integration tests, not an invented measured call count. |
| Cross-client | Current shared/mobile types and desktop build; desktop-web and Expo8083 evidence identified separately, QA040 DOM closure source equivalent. Native iOS/Android verification excluded. E1 subsequently excluded by user disposition; genuine enlargement remains E2. |

## Open evidence items and Builder guidance

### R2-E1 — Historical pending interaction gate; subsequently excluded

Relevant paths: `desktop/` source-bound packaged artifact and final Tester report,
section “Browser evidence and Electron gate”. The unsigned artifact is matched to
unchanged desktop source and app.asar hash; packaging alone cannot establish the
C1 controls work inside Electron. Computer Use is reported waitingOnApproval,
not denied and not passed.

Builder should obtain the result of the **already assigned bounded** capability/
control/draft/restart check from Visual Check, with artifact identity, target API,
actual actions and observed state after restart. Preserve the current no-provider/
key/default/consent mutation and no-inference limits. Tester should reconcile
which applicable C1 desktop persistence/recovery outcomes are covered by this
result versus unchanged source/backend/process tests. A draft restart check must
not be reported as a saved-provider switch/revocation/secure-storage test. Do not
extend into C2 OAuth/plan-delivery qualification. If the bounded result leaves a
specific C1 platform outcome unsupported, name that outcome and obtain its evidence
or an explicit user disposition, rather than expanding into a generic sweep.
No product fix is prescribed without a reproduced defect.

### R2-E2 — Genuine enlargement remains unevidenced

Relevant contract: retained ADR affected-surface large-text acceptance and UI
skill's200% enlargement criterion; evidence QA034/QA040 and final Tester limitations.
Normal-scale320/390 captures and viewport/DPR changes cannot establish enlarged
text usability. Unsupported exposed zoom controls and historical permission denial
explain the gap but do not waive the retained requirement.

Builder should provide supported source-qualified enlargement evidence for the
specific C1 provider/consent/control flow through the authorized Visual owner, or
obtain an explicit user scope disposition. Reuse existing layout evidence outside
that named risk. Do not repeat blocked operations, bypass denied tools or launch
automatic broad captures. Until evidence or explicit disposition exists, this gate
remains open. No reproduced clipping/overlap defect is asserted.

### R2-D1 — Reconcile readiness/status documentation before delivery

Candidate `docs/reviews/c1-builder-readiness-2026-10-08.md` still says no formal
handoff, source0fe6b087 and consent closure pending; the later final handoff/Tester
report establish1a92a2c0, completed Tester checks and QA040 closure. Primary
current-state likewise retained pending-Tester prose when round2 began.
Builder should update current summaries to reference exact final handoff,208/208,
retained source-scoped4337/69/migration receipts, QA040 closure, current2/3 and E1/E2.
Keep old receipts as history. Expected verification is a consistent read-through
of current index/readiness/report links; documentation-only reconciliation needs
no test/build/visual run. This is record accuracy, not a product-code finding.

## Closure and ownership

R1-001/002/003 remain closed; QA040001 is closed for DOM accessible-name association
on equivalent final mobile source. Actual assistive-technology announcement timing
is a stated limitation, not an inferred failure. QA039 stopped; no StageB sweep is
requested. Live measurements and excluded mobile-native work are not blockers.

Return one consolidated response for E1/E2/D1. Builder owns any discovered code
fixes; Tester owns qualification. Reviewer may close evidence within round2 after
inspection. Reports/status only were written and left uncommitted in primary;
no source edits, tests, builds, merge/push/deployment or next-stage work performed.


## R2-D1 closure — 8 October 2026

**D1 closed** after read-only inspection of documentation commit3cb6d402 and the
current primary index/readiness/handoff records. Their current summaries identify
frozen1a92a2c0, completed208/type/build qualification, source-scoped4337/69 and
migration/runtime receipts, QA040001 closure, review2/3 and unresolved E1/E2.
The indexed consolidated handoff now exists in primary. Its admission-time1/3
wording and earlier preparation receipts are historical; current summaries identify
the completed round2 decision. Earlier3cc delivery is explicitly separated from
the unpromoted final candidate. Report header now records full review completed.

This is documentation-only same-round closure. E1 remains waitingOnApproval;
E2 requires genuine enlargement evidence or explicit human disposition. The
pending question is not a waiver. No tests/builds/source edits/visual requests,
new full review, counter increment, product promotion or full C1 acceptance.


## Historical R2-E1 startup defect — 8 October 2026 (subsequently repaired/excluded)

**Historical P1 at the failed artifact: packaged desktop could not start its renderer.**
The correction request below records that earlier state; subsequent recovery and
user scope disposition supersede it as a current C1 blocker. Read-only inspection of
`/tmp/orbyn-c1-electron-isolated-launch-20261008.log` confirms
`ERR_MODULE_NOT_FOUND: Cannot find package 'lib0'` imported by
`Orbyn.app/Contents/Resources/app.asar/node_modules/yjs/dist/yjs.mjs`.
The old source-bound artifact usedf7a48abf; relevant desktop source was unchanged
at1a92a2c0. Builder reports the renderer never opens. This is now a concrete
packaging/runtime defect, not merely unavailable interaction evidence.

Builder owns correction of desktop production dependency inclusion/package rules;
ensure the shipped Yjs runtime dependency graph is complete. Add an appropriate
packaged-artifact regression that resolves/loads required dependencies from the
artifact rather than the development checkout. Freeze one complete revised candidate.
Tester must verify its packaged startup in isolation and record exact source,
artifact identity, terminal outcome and renderer readiness, plus impact-based
regressions. Packaging exit0 alone cannot close this failure. Resume the existing
bounded E1 interaction check only on the repaired, verified artifact; no broad sweep.

Prior code-ready conclusion is suspended. Source freeze is reopened by Builder;
Reviewer makes no product/test changes and runs no tests/builds/launches. Existing
unaffected evidence remains historical/source-scoped. Retain round2/3: inspect
Builder's batched fix and Tester receipts for same-round closure. No new full
review, reset, promotion or full approval. E2 explicit human disposition remains
pending and is not inferred from silence.


## R2-E1 scope closure — 8 October 2026

**E1 closed by explicit user disposition, not verification.** Read current
`AGENT.md`, `docs/agents/coordination.md`, `docs/agents/ui-ux.md` and
`docs/reviews/checkpoint-workflow.md`: shared web/desktop UI is qualified through
web preview; separate desktop-app visual, packaging and runtime checks are excluded
unless the user requests them again. Expo web remains the mobile app renderer.

The missing-lib0 launch error and all artifact/preparation receipts remain
historical evidence. The [Builder recovery receipt](c1-electron-package-recovery-2026-10-08.md)
subsequently records a clean lockfile dependency reinstall with no source/lockfile
change, lib0/Yjs present in the new archive and actual isolated renderer startup
without the prior module-load error. This is documented startup repair, not an
Electron interaction or broader native-capability pass. No further E1 launch/build/test/visual job is required
for retained C1. Builder reports the owned QA app stopped; Reviewer did not launch
or stop an app. The earlier E1 correction requirement is superseded only for the
current acceptance scope, without erasing the observed defect.

D1 remains closed. E2 genuine200% enlargement evidence or explicit user disposition
remains pending; this desktop scope change does not settle E2. Counter stays2/3,
no new full review. Only the primary report was edited; no tests/builds/product
changes. Full C1 acceptance and promotion remain withheld until E2 is resolved
and the final retained source/evidence is reconciled.


### Historical recovery clarification — 8 October 2026

Read `c1-electron-package-recovery-2026-10-08.md`. New artifact archive hash
`b5dd4e4450722625d7f448ccc5252b12b2ee22301a935e672776b4fc21e782e2`
contains lib0.2.119/Yjs13.6.33; Builder records main44923/renderer44928 startup
on unchanged1a92a2c0 with a clean isolated profile and no module-load error.
The original failure arose from the borrowed dependency installation and remains
historical. Recovery receipt is Builder evidence inspected by Reviewer, not a
Reviewer launch or test. GUI/control/draft/restart interaction was not established
by process startup; separate Electron QA was later excluded by the user.
E1 is closed by scope, E2 remains open, round2/3 unchanged. No new full review,
tests/builds or product edits; only report wording reconciled.
