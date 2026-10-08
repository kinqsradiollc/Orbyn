# Full retained C1 review — round 2

Cycle C1-full-2026-10-08. Round **2/3**, persisted before substantive review on
8 October 2026. Source `1a92a2c091e42d350e3b029bf57e932c630b4487`, branch
`codex/c1-production-checkpoint`, checkout
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
Full round-2 review completed. Reviewer inspected code/ADR/existing evidence only;
no tests, builds or product/test edits. Retained C1 scope is accepted within round2 under the final user dispositions.
Original report committed by Builder in3cb6d402; independently verified D1 closure
was committed and pushed in86c522f2. E1/E2 scope closures and final acceptance are recorded below.

## Decision

**APPROVED: retained C1 checkpoint at
`1a92a2c091e42d350e3b029bf57e932c630b4487`, round2/3.**
All identified retained-scope findings are resolved. D1 is verified closed;
E1 separate Electron QA and E2 genuine200% testing are excluded by explicit user
disposition, not reported as passes. Shared web preview and Expo-web evidence,
current208/type/build and retained source-equivalent regression/runtime evidence
support acceptance. Builder may integrate this tested candidate into main and
then honor the user's pause before C2/M1. Merge/push/deployment are not performed
or confirmed by this review decision. Historical decisions below retain their
original scope and are superseded by the final closure where stated.

## Scope and method

Applied current user overrides: no iOS builds/Android-specific verification;
shared mobile source/types and Expo-web parity remain. Live OpenAI cache and live
accepted-vendor embedding measurements are approved follow-ups; existing Matilda
baseline plus deterministic/runtime evidence is the C1 basis. At the initial
round-2 review, Electron and genuine enlargement remained required. The later
explicit user disposition removes separate Electron QA and accepts web preview
for shared web/desktop UI. The final user instruction also excludes200% testing
from C1; E2 is closed by disposition, not measurement. No expanded vendor/model
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


## Final retained C1 acceptance — 8 October 2026, round2/3

**E2 closed by explicit user disposition: “dont need to test 200%”.** Read the
updated canonical AGENT.md and checkpoint-workflow scope override recording that
instruction. Genuine200% remains untested, not passed. Earlier E2 pending/blocking
statements are historical and superseded. E1 separate app QA is already excluded;
D1 correction is verified. No remaining identified mandatory gate in the user's
retained C1 scope is open.

Reviewed final consolidated Tester report including fresh-install impact receipts:
clean exported1a92a2c0 and matching lockfile, workspace types and production build
exit0,208/208 after required shared packages were built. The initial fresh focused
attempt failed its generated-package prerequisite and is preserved as such; it is
not relabelled a product assertion failure or erased. Retained4337/4337, vector69
and independent migration receipts apply only through recorded unchanged-source
comparison. Actual synthetic indexing/replacement/failure/recovery/off/word-search
receipts and source-qualified web/Expo consent/catalog/usage evidence complete the
retained local evidence basis. Candidate HEAD is exact1a92a2c0 with clean status
at this closure. Reviewer inspected evidence only; no new execution.

Final finding disposition:
- R1-001/002/003: independently verified scoped corrections closed.
- QA040001: full recipient/exclusion consent accessible-name association closed.
- R2-D1: current-record reconciliation verified closed.
- R2-E1: removed from C1 by explicit desktop=web acceptance scope; historical
  missing-lib0 package failure and Builder startup recovery remain documented.
- R2-E2: removed from C1 by explicit instruction;200% is untested.

**Approve retained C1 completion and candidate main integration.** This is closure
of the existing round2 assessment, not a new full review or counter reset. Builder
owns integration and must preserve tested product content and canonical scope/
role instructions while reconciling documentation. If integration changes product
behavior, Tester determines necessary impact verification before delivery is
claimed. Record actual merge/main/push identifiers separately. After delivery,
pause before C2/M1 as requested; production deployment remains the user's action.

Acceptance does not claim native iOS/Android verification, separate Electron GUI
qualification, genuine200% or actual screen-reader behavior. Live OpenAI cache
and accepted-vendor embedding measurements remain approved follow-ups with costs,
cache benefits and vendor behavior unknown. Matilda evidence is limited to its
six recorded checks. These exclusions/limits are disclosed, not substituted with
fabricated passes. No broader ADR completion is asserted.

Only this primary review report was changed, left uncommitted for Builder delivery.
No source/test edits, tests/builds, app launches or visual sweep by Reviewer.
