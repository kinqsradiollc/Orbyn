# C1 round-1 repair retest

Cycle `C1-full-2026-10-08`, 8 October 2026. Local retest complete, review counter **1/3**.
Local executable retest PASS; full C1 acceptance remains OPEN. Preserve failed attempt aa10d566
in `c1-full-2026-10-08-test-r1.md`; this report appends independent repair evidence.

## Frozen candidate and execution ownership

Clean candidate verified before execution:
`244abc21c464d19c379bf0ebaf5d431f4f8e344d`, branch
`codex/c1-full-completion`, checkout
`/Users/anhdang/.codex/worktrees/c1-perplexity-embeddings/Orbyn`.
Reviewer relinquished source writes; Tester owns fixtures/execution and has not
modified product/test source. Read Reviewer round1 report, full contract audit
and its next checks; retained qualification plan and ADR still govern scope.

Full test inventory is466 files, with names/SHA256 hashes saved to
`/tmp/orbyn-tester-244abc21-test-inventory.json`. No reduced glob or duplicate
full run. Node22.16.0/npm11.4.0 environment retained.

## Final run receipts

| Check | Exact command | Handle / state | Log |
| --- | --- | --- | --- |
| Full backend | `npm test` | PASS4337/4337,zero failures/skips/cancellations; session3610/PID78380 terminal exit0/signal:null | `/tmp/orbyn-tester-244abc21-full.log` |
| Workspace types | `npm run typecheck` | PASS session68245 terminal exit0 | `/tmp/orbyn-tester-244abc21-types.log` |
| Production build | `npm run build`, sequential after types | PASS session68245 terminal exit0 | `/tmp/orbyn-tester-244abc21-build.log` |
| Focused client/control/evaluator | `npx tsx --test --test-concurrency=1` seven files below | PASS202/202, zero failures/skips/cancellations, session79386 exit0 | `/tmp/orbyn-tester-244abc21-focused.log` |
| Mobile packaging | iOS/Android export | PASS both platforms, session95673 exit0 | `/tmp/orbyn-tester-244abc21-mobile-export.log` |

Focused files under `backend/tests/`: `admin-ai-probe.unit.test.ts`,
`admin-ai-catalog.unit.test.ts`, `embedding-controls.unit.test.ts`,
`embedding-model-catalog.unit.test.ts`, `ai-model-controls.unit.test.ts`,
`provider-runtime-inventory.unit.test.ts`, `managed-controls-evaluation.unit.test.ts`.

Full launcher `/tmp/orbyn-tester-244a-run.cjs` internally reads Docker credentials,
sets TEST_DATABASE_URL and writes protected logs with terminal PID/start/end/
exit/signal JSON. It never prints connection strings or tokens. New stock DB
`orbyn_tester_244a_full_test` in `orbyn-adr-qualification-20261007` on55436,
server-marked `orbyn.environment='test'`; QA `orbyn_ui_preview` untouched.
Earlier Tester and Builder DBs, original providers and Visual Check fixtures
remain intact. No application/vendor call or preview restart by Tester.

## Changed-file relevance and retained database receipts

Git delta aa10d566→244abc21 changes only two client files, two extracted callback
unit-test files and review/tracking documents. Backend/src, all shared packages,
backend/migrations, all operational embedding integration files, legacy upgrade,
late-install and maintenance upgrade files are byte-identical by Git comparison.
No relevant runtime/schema/fixture dependency changed. Accordingly no new
operational/upgrade run is justified solely by the commit number.

Retain these **aa10d566 executions on unchanged source**, explicitly not newly
rerun244abc21 receipts:

| Receipt | Result | Original protected log |
| --- | --- | --- |
| Separate operational embedding/vector cohort |69/69, exit0, zero skips/cancellations | `/tmp/orbyn-tester-aa10d566-vector.log` |
| Fresh pre218 legacy consent/vector upgrade |1/1, exit0 | `/tmp/orbyn-tester-aa10d566-upgrade.log` |
| Independent stock→vector late extension |1/1, exit0 | `/tmp/orbyn-tester-aa10d566-late.log` |
| Fresh mixed-version258 maintenance upgrade |1/1, exit0 | `/tmp/orbyn-tester-aa10d566-maintenance.log` |

Fixture separation, actual storage/search/races/retry and migration provenance
remain in the original Tester report. Changes to client controls require current
focused tests, final types/build/exports and delegated rendered evidence. Revised
full inventory retests managed/BYO/personal authority, budgets/team/MCP, catalogs,
provider protocols/reasoning/cache, usage, worker/deployment and all other normal
backend regressions. No unchanged-source receipt closes a live/native/UI gate.

## Required acceptance and repair closure

R1-001 harness dependency/retired-row/list-refresh fixes now have independent
full/focused passing terminal results. Reviewer closure is still required.
R1-002 loading/busy/status and R1-003 inline error/retry need revised-source
rendered/accessibility evidence from Orbyn Visual Check; Builder coordinates it.
Tester will read supplied evidence and accurately distinguish Markdown review
from independent pixel inspection. No duplicate browser fixture/session initiated.

Mandatory full C1 gates remain: real authorized provider/model and accepted live
embedding recipient/dimensions/reindex; configured OpenAI cache/latency/cost/quality
benchmark with declared budget/baseline/quality rubric; genuine200% text
 enlargement; installed Electron/iOS/Android selection/storage/restart/revocation
and keyboard behavior; full current rendered management/default/key/catalog,
usage and embedding enabled/error/recovery matrix. Handoff states evaluation
key/model absent; no paid probe or Matilda substitution. Missing evidence is open,
never passed. Developer fixture passes and exports do not prove installed/native
or vendor/plan/billing acceptance.

## Acceptance boundary

Review stays1/3 through retest. No source correction by Tester, acceptance waiver,
main merge/push/deployment, C2 advancement or finished-C1 pause. All local execution is now terminal, with final closure below. No duplicate
full run or source edits occurred. Reviewer may close existing findings after retest within round1. A newly
initiated full candidate review requires persisting the next round; Tester leaves
the counter1/3.

## Historical early terminal receipts

Independent focused202/202 and sequential types/build exit0 confirmed. Backend compiled file `backend/dist/modules/ai/admin.js` mtime19:45:50 Melbourne; no Tester compilation remains. Earlier seven web probe failures do not reproduce in the focused final-source run or early full-run probe cases. Full run remains live session3610 and is not yet acceptance.

## Unchanged-source comparison receipt

`/tmp/orbyn-tester-244abc21-retained-source.json` records matching Git object IDs for20 relevant instruction/runtime/schema/package/lockfile/setup/integration paths across aa10d566 and244abc21. All match. Mobile export terminal session95673 exit0 confirms both platforms package at the repaired source; actual installed acceptance stays open.

## Historical visual cadence update during retest

Read primary AGENT.md and checkpoint-workflow.md following workflow-doc commit f2cb3d93. Use one stable-candidate impact-based visual batch, target failed/affected cases and retain explicitly equivalent evidence; no screenshot request per edit/test/commit. No duplicate browser work by Tester. Documentation-only update does not alter frozen244abc21 runtime/test evidence.

QA038 currently records initial web account/Admin loading and owner-reported429 diagnosis; no loading/error-fix recheck completed at that observation. Source244abc21 verified, unchanged aa10 backend/runtime owner-confirmed. Revised feedback closure remains pending. Report path: `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-038-c1-round1-catalog-2026-10-08/visual-analysis.md`. This is a delegated Markdown read, not independent pixel or assistive-technology acceptance.

## Content guidance received during retest

Read primary AGENT.md content rule and skills/orbyn-content-design/SKILL.md following main78249b5f. Apply task/state/action hierarchy, concise nearby error/retry, accessible labels and visible consent/consequences when assessing existing batched evidence. Full values/user content/text scaling preserved; length targets are guidance, not test thresholds. No fixture rename, frozen-source edit or screenshot sweep for this documentation change.

## Terminal retest closure — 8 October 2026, 19:59:38 Melbourne

Full regression4337/4337 PASS, fail0/skipped0/cancelled0/todo0, exit0/signal:null,
session3610/PID78380. Started08:44:31.542 UTC, ended08:59:38.410 UTC
(19:44:31–19:59:38 Melbourne); backend TAP898696.903ms, launcher wall907868ms
including package builds. Terminal receipt:
`/tmp/orbyn-tester-244abc21-full.log.terminal.json`. No test retry was needed.
The eight additional full tests compared with aa10's4329 account for the revised
probe refresh/retired-row and catalog feedback cases; prior seven failures now
pass. Historical failed aa10 report/logs remain preserved.

Independent focused202/202, workspace typechecks, complete shared/backend/web
build and iOS/Android exports all exit0. Backend emitted the retained chunk-size
warning; packaging warnings did not fail export. Operational vector69/69 plus
three independent migration1/1 receipts are retained on byte-identical relevant
source, not counted as fresh retest executions.

Final checkout clean at244abc21c464d19c379bf0ebaf5d431f4f8e344d, branch unchanged;
all466 full-test SHA256 hashes match. Tester made no product/test edit, preview
restart, visual fixture mutation, vendor request or merge/push/deployment.
Report is saved uncommitted in primary repository, ready for tested-source
handoff. Review counter remains1/3. Closure of existing findings may stay within round1;
a newly initiated full candidate review requires persisted2/3.

## Latest delegated visual evidence read at terminal closure

QA038 now includes settled web-session recovery, consolidated slow loading and
503 inline retry, retained-form503→empty→success recovery. Frontend244abc21
independently identified; runtime is owner-confirmed unchanged aa10 API.
Changed-file review supports reusing only unchanged shared control/theme/shell
evidence from QA037. Tester read the Markdown; inline screenshots were inspected
by Visual Check, not Tester, and exported originals remain unavailable.

| Finding / gate | Latest scoped evidence | Remaining |
| --- | --- | --- |
| R1-001 probe harness | Focused202/202 and full4337/4337 on repaired SHA | Locally verified; Reviewer closure required |
| R1-002 / QA037002 loading | Visible Loading models label confirmed in representative narrow/short/theme cases | Mobile busy semantics and duplicate visible copy remain separate findings |
| R1-003 / QA037003 inline error |503 error/retry now visible at initiating card; drafts retained; explicit empty/success recovery clears old error | Retained loaded-catalog failure and final recovery batch still pending in latest read; no full closure inferred |
| QA038001 P3 | Mobile-browser pending document lacks aria-busy; disabled control and polite live text exist | Reviewer must assess/fix appropriate rendered busy semantics; actual screenreader/native behavior untested |
| QA038002 P3 | Mobile loading label plus separate visible Loading models sentence duplicates progress copy | Reviewer content-design fix/assessment needed; no new screenshot sweep |
| Wide capture | Measured1280×800 frame/crop inconsistent | Reliable wide evidence still unavailable; no product overlap failure inferred |
| Genuine200%/native/live | No new evidence | Mandatory gates remain open |

Local executable qualification of the repair is **PASS**. Full C1 checkpoint
acceptance remains **OPEN**, with two new scoped visual findings and outstanding
management/default/key/usage/embedding rendered completeness, installed/native,
genuine enlargement and authorized live-provider/cache/embedding evidence.
No approval/waiver inferred from absent credentials, devices or browser controls.
Continue the existing impact-based Visual batch, target affected cases and
retain source-qualified evidence; no duplicate full test run or screenshot
sweep merely for workflow/content documentation changes.

## Review ceiling clarification — 8 October 2026

Read canonical AGENT.md and checkpoint-workflow.md at primary workflow commit8eea1512. Three rounds is a ceiling, not a required sequence. Scoped fixes, Tester retests and closure of existing findings can finish in the same round; approval may occur in round1/2/3 when supported. A newly initiated full candidate review consumes the next numbered round and cannot be disguised as closure. No silent reset/fourth review. Code-review approval does not waive mandatory full-checkpoint acceptance gates. Current counter stays1/3, candidate244abc21 stays frozen, no product edit or new test/screenshot run caused by this documentation update. Earlier wording that implied retest automatically required round2 is superseded by this clarification.

## Visual cadence and QA-039 handoff state — 8 October 2026

Read current primary AGENT.md, checkpoint-workflow.md and UI design skill at
main94284ab7. Visual checks are on demand for material layout/interaction risk,
reproduced visual defects or explicit user requests. Functional CRUD, persistence,
routing, worker and race acceptance uses tests/API/runtime evidence. Do not treat
remaining acceptance records as automatic repeated screenshot requests. One
short bounded batch covers requested changed-flow cases; reuse valid source and
runtime evidence, record limits, then stop. This does not waive unresolved
mandatory acceptance or justify an unsupported completion claim.

QA-039 is still pending: QA independently verified source244abc21, but web
redirects to login and mobile shows a cached account. Account/runtime authority
is unresolved; no new provider, default, credential or consent mutation has been
made. The report identifies only the isolated safe StageA cases: active-backup
cleanup and default-off verification as needed, then record existing evidence
and stop. No Tester interaction with its fixture. Embedding StageB is not started
and is out of scope for this visual batch. Existing QA-038 findings and QA-039
authentication limitation are documented; do not launch another visual sweep for
the docs-only change or the test completion.

## Revised candidate retest — mobile catalog busy semantics

Date: 8 October 2026. Exact clean source:
`3ccf8f578d3e355238ee55478e7d5e02b2b68b67`, branch
`codex/c1-full-completion`, checkout
`/Users/anhdang/.codex/worktrees/c1-perplexity-embeddings/Orbyn`.
Review counter remains1/3. Product/test source remained frozen during this
independent qualification; Tester made no source edits.

### Scope and source impact

Delta from tested candidate244abc21 is six files: mobile AdminAi and shared
mobile SmallAction busy/accessibility prop handling; one new rendered-markup
unit test; three review/current-state documents. Functional busy state now maps
to actual React Native Web `aria-busy`; one visible action label carries the
loading text and its live region announces progress. The added test uses the
installed React Native Web renderer and retains a native-facing accessibility
state assertion.

Backend source, shared packages, desktop, migrations, package/lockfiles,
operational vector and migration test files are unchanged. In particular, Git
object IDs match244abc21 for `backend/src`, `packages`, `backend/migrations`,
package files and every previously qualified vector/upgrade/late-install/
maintenance cohort. Reported integrity check: `git diff --check` pass; working
tree clean after commands at exact3cc SHA.

### New terminal receipts

| Check | Exact command | Result | Log |
| --- | --- | --- | --- |
| Targeted cross-client/catalog/provider regression | `npx tsx --test --test-concurrency=1 backend/tests/admin-ai-catalog-accessibility.unit.test.ts backend/tests/admin-ai-catalog.unit.test.ts backend/tests/admin-ai-probe.unit.test.ts backend/tests/embedding-controls.unit.test.ts backend/tests/embedding-model-catalog.unit.test.ts backend/tests/ai-model-controls.unit.test.ts backend/tests/provider-runtime-inventory.unit.test.ts backend/tests/managed-controls-evaluation.unit.test.ts` |205/205, zero failures/skips/cancellations, exit0,5951ms | `/tmp/orbyn-tester-3ccf8f57-focused.log` |
| Workspace typechecks | `npm run typecheck` | PASS exit0: package build, backend, desktop and mobile typechecks | `/tmp/orbyn-tester-3ccf8f57-types.log` |
| Mobile platform packaging | `npx expo export --platform ios --platform android --output-dir /tmp/orbyn-tester-3ccf8f57-native-export` from `mobile/` | PASS exit0; iOS and Android bundles emitted | `/tmp/orbyn-tester-3ccf8f57-mobile-export.log` |
| Whitespace / freeze | `git diff --check`; `git rev-parse HEAD`; `git status --short` | PASS; HEAD remains3ccf8f578d3e355238ee55478e7d5e02b2b68b67 and no dirty files | terminal |

The205 include the new rendered accessibility cases and prior round1
probe/catalog/control/evaluation focused cohort. The new test verifies actual
RN Web serialization of pending/idle `aria-busy`, single visible loading text,
polite live region, disabled pending action, native-facing busy state, error,
retry label and preserved manual model. This qualifies renderer markup only;
actual device accessibility tree, screen reader announcement and installed
native behavior remain untested.

### Retained broad evidence

The preceding exact candidate244abc21 independently passed full backend
4337/4337, focused202/202, workspace typechecks/build and both mobile exports.
That full backend regression remains valid for3cc because backend product source,
fixtures and dependencies are byte-identical. It did not include this newly added
three-case accessibility test; those three cases passed in the targeted205/205
run above. No automatic15-minute backend rerun was warranted for this isolated
mobile-only correction.

The separate69/69 operational embedding cohort and the fresh legacy upgrade,
late-extension and maintenance upgrade1/1 each remain evidence from their
recorded source244/aa10 and independently owned databases. Backend/runtime/schema,
fixtures, migrations and package-lock paths are unchanged at3cc, so those
receipts remain applicable without relabeling them as new runs. Original receipt
logs, fixture identities and source equivalence are documented in this report's
244 retest section and initial qualification report. No database was accessed in
this3cc check. No live provider, managed OpenAI cache evaluation or accepted live
embedding recipient was used.

### Visual and acceptance boundaries

No additional visual request or screenshot was made: the changed behavior is
functionally covered by the rendered React Native Web test and no new layout
change was introduced. QA-038's prior candidate report remains relevant for
loading/error states where its source equivalence applies; mobile `aria-busy`
rendering gap is directly addressed by the new markup test. Its real
assistive-technology behavior is not inferred. QA-039 remains a separate,
isolated visual batch with unresolved login/runtime identity; no Tester fixture
or StageB interaction occurred.

Local code/retest results support closure of the mobile markup finding within
round1 after Reviewer records the decision. They do not complete C1. Remaining
live provider/model and cache benchmark, live embedding recipient, authorized
management/default/credential interaction where not otherwise evidenced,
installed Electron/iOS/Android, actual screen reader and required enlarged-text
acceptance stay open. Visual cadence is on demand; these records do not trigger
automatic repeated screenshots. No merge/push/deployment, C2 advancement or
review-counter change is claimed.

## Role ownership clarification — 8 October 2026

Read updated canonical AGENT.md and checkpoint-workflow.md at main commit
a5e5028a. Builder (software engineer) owns every product and test-source fix.
Tester owns formal execution and report writing, and returns defects to Builder;
Tester does not patch code. Reviewer is review only: inspect code/evidence and
publish actionable findings; do not edit product/test source or run tests/builds.
Reviewer may write review reports and decisions, then inspect Tester receipts to
close findings. Existing round1 evidence and the3cc full/focused results remain
valid. Counter remains1/3; no code edit or test/build rerun was caused by this
documentation update. Any future repair must come from Builder in a newly frozen
candidate before Tester verifies it.

## QA-039 finalized status correction — 8 October 2026

Supersedes the earlier **QA-039 handoff state** paragraph, which described the
initial login-blocked snapshot before the batch continued. Preserve that initial
observation as history; it is no longer the current state. Read the finalized
source-qualified report:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-039-c1-management-embedding-2026-10-08/visual-analysis.md`.

Visual Check subsequently signed into the isolated synthetic QA account on both
clients and recorded scoped management/default/key/catalog/manual-model actions.
The active backup/default state was safely returned to default-off and confirmed
by the owner's API8010 cleanup readback at09:22:52UTC. Search stayed off and
embedding consent stayed null; provider identities were retained. The initial
browser cleanup action timed out, so the owner performed and reported safe API
cleanup. This is the final state for that visual batch, not a live Tester query.

The backup row remains; deleting the active backup was not checked. The full CRUD
matrix and broader management/security races remain unqualified by browser
observations. Browser theme/viewport reset remains unresolved after the CUA
timeout. Embedding StageB was never started in this visual batch. Later separate
owner API/worker embedding qualification is not browser consent or StageB evidence.
Wide/native/genuine200%-text and complete C1 acceptance remain open. QA039 states
that its visual work stopped with requests quiescent and no pending provider or
consent mutation. No further screenshots, browser retries, tests or builds were
needed for this report freshness correction.
