# C1 consolidated Tester qualification — 1a92a2c0

Cycle `C1-full-2026-10-08`, 8 October 2026. This report records the formal
Tester run against the consolidated C1 candidate. Review counter remains **1/3**.

**Disposition:** Current-source focused tests, workspace typechecks and production
build pass. C1 acceptance remains open pending the bounded Electron interaction
check now assigned to Visual Check, followed by Reviewer disposition. This report
does not claim the unexecuted check or any explicitly unavailable capability.

## Frozen source and test selection

- Checkout: `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`
- Branch: `codex/c1-production-checkpoint`
- Candidate before and after execution: `1a92a2c091e42d350e3b029bf57e932c630b4487`
- Initial and final worktree status: clean; Tester made no product or test edits.
- Runtime: Node `v22.16.0`, npm `10.9.2`.

Compared with `3ccf8f578d3e355238ee55478e7d5e02b2b68b67`, product/test changes
are limited to `mobile/src/screens/SemanticSetup.tsx`,
`backend/tests/embedding-controls.unit.test.ts`, and the Android capture module's
Gradle configuration. iOS/Android packaging and Android-specific checks are
excluded by the user's current C1 scope.

Impact checks confirmed that `backend/src`, `backend/migrations`, `packages`,
root/workspace package manifests and lockfile are byte-identical to
`244abc21c464d19c379bf0ebaf5d431f4f8e344d`. The only backend test-file deltas
from that full-suite source are the added
`backend/tests/admin-ai-catalog-accessibility.unit.test.ts` and the updated
`backend/tests/embedding-controls.unit.test.ts`; both are included in the current
208-case focused run. The mobile UI and targeted-test source match `0fe6b087`.
Desktop source and package manifests match artifact source `f7a48abf`.

Commands were `git diff --quiet 244abc21c464d19c379bf0ebaf5d431f4f8e344d HEAD -- backend/src backend/migrations packages package.json package-lock.json backend/package.json`,
`git diff --name-status 244abc21c464d19c379bf0ebaf5d431f4f8e344d HEAD -- backend/tests`,
`git diff --name-status 0fe6b087 HEAD -- mobile/src backend/tests`, and
`git diff --name-status f7a48abf632157d368ac8e75e22117b42c8c581e HEAD -- desktop package.json package-lock.json`.
The last two emitted no file changes; the backend test comparison listed only
the two files described above.

## Current-source execution

| Check | Command | Result | Log |
| --- | --- | --- | --- |
| Cross-client/catalog/control/evaluator cohort | `npx tsx --test --test-concurrency=1 backend/tests/admin-ai-catalog-accessibility.unit.test.ts backend/tests/admin-ai-catalog.unit.test.ts backend/tests/admin-ai-probe.unit.test.ts backend/tests/embedding-controls.unit.test.ts backend/tests/embedding-model-catalog.unit.test.ts backend/tests/ai-model-controls.unit.test.ts backend/tests/provider-runtime-inventory.unit.test.ts backend/tests/managed-controls-evaluation.unit.test.ts` | **208/208 pass**, 0 fail/cancel/skip, exit 0; 5.58 s | `/tmp/orbyn-tester-1a92a2c0-focused.log` |
| Workspace typechecks | `npm run typecheck` | **PASS**, exit 0; builds shared packages and typechecks backend, desktop and mobile | `/tmp/orbyn-tester-1a92a2c0-typecheck.log` |
| Production build | `npm run build` | **PASS**, exit 0; builds shared packages, backend and desktop/web | `/tmp/orbyn-tester-1a92a2c0-build.log` |
| Whitespace/freeze | `git diff --check`; compare exact source paths; `git status --short --branch` | **PASS**; HEAD unchanged and candidate worktree clean | Terminal receipt in this run |

The production build emitted the existing Vite large-chunk warning. It produced
no build failure. The full `npm test` command was not repeated: the retained
4,337-case result below covers byte-identical backend implementation and
dependencies, while both changed/new backend test files were exercised in the
current 208-case run. No current-candidate full-suite aggregate is claimed.

## Retained source-scoped evidence

| Evidence | Original result and source | Why it remains applicable; boundary |
| --- | --- | --- |
| Full backend regression | `npm test`: 4,337/4,337, zero failures/skips/cancellations, exit 0 at `244abc21`; `/tmp/orbyn-tester-244abc21-full.log` | Current backend implementation, migrations, shared packages and dependency manifests are byte-identical. Current test-file deltas are separately covered above; this is not a new full-suite run on `1a92a2c0`. |
| Focused predecessor cohort | 205/205 at `3ccf8f57`; `/tmp/orbyn-tester-3ccf8f57-focused.log` | Superseded for the current focused surface by 208/208 above. |
| Operational pgvector and migration cohorts | 69/69 operational; legacy upgrade 1/1; late extension 1/1; mixed-version maintenance upgrade 1/1. Original logs: `/tmp/orbyn-tester-aa10d566-vector.log`, `...-upgrade.log`, `...-late.log`, `...-maintenance.log` | Backend/runtime/schema, relevant fixtures and dependencies remain unchanged. These are prior isolated marked-database executions, not new `1a92a2c0` runs. No QA database was reset or accessed by Tester. |
| Worker/runtime behavior | `docs/reviews/c1-full-2026-10-08-runtime-qualification.md`, compiled backend `244abc21`; marked database `orbyn_c1_visual_20261008_test` | Real synthetic 3D indexing, 503 persistent failure/backoff and scheduled recovery, 7D replacement, worker expiry/restart, stale-revision 409/revalidation, off cleanup and ordinary word search while the local provider was stopped. API/worker evidence; not browser-consent or live-vendor proof. |
| Matilda baseline | Six fixed checks passed at the named historical source; `/tmp/orbyn-c1-matilda-baseline-20261007.json` | Confirms those six fixed output/arithmetic/state checks and recorded latency only. Zero provider counters and unknown cache writes do not establish zero cost, cache savings, general quality, billing or OpenAI cache behavior. |

## Retained C1 requirement matrix

| Requirement group | Evidence applied to this candidate | Disposition and boundary |
| --- | --- | --- |
| Managed/BYO/personal authority and entrypoints | Retained full backend suite and entrypoint/recovery matrix; current focused provider probe/control tests | Backend authority evidence remains applicable by exact source match. Electron persisted selection/restart/recovery is still pending the bounded check below. |
| Independent saved connections and credentials | Retained backend/provider tests; scoped QA-039 web/mobile observations | QA-039 observed create/cancel/edit, synthetic-key replacement/removal, enable/disable and explicit default readback in selected cases. It did not complete the full two-client CRUD/delete/default/security matrix. No live key or real inference claim. |
| Catalog, manual model, default and stale response | Current 208-case catalog/probe cohort; QA-037/038 scoped loading, empty, 503/retry and recovery evidence; QA-039 model/default observations | Current callbacks and lifecycle regressions pass. Browser captures are scoped, not a complete all-viewports interaction sweep. |
| Generation protocols and provider inventory | Retained full regression and 20-provider runtime inventory fixtures; Matilda six-check baseline | Fixture coverage does not certify every vendor/model's current eligibility or availability. Matilda is not broad provider qualification. |
| Reasoning and cache controls | Current controls/evaluator tests and retained wire-format evidence | OpenAI cache economics, measured cache hits/writes, equivalent-workload cost, latency and quality were not measured; these are approved follow-ups and are not C1 blockers under the current override. |
| Truthful usage and private separation | Retained owner/private isolation and usage regressions; current control/evaluator cohort | No plan entitlement, remaining quota, billed cost or savings are inferred from provider counters. |
| Independent embedding recipient and consent | Current embedding controls; QA-040 Expo-web consent evidence; deterministic runtime receipt | QA-040-001 DOM closure at `0fe6b087` confirms the full visible consent sentence is also the switch accessible name. Actual screen-reader announcement is untested. The approved live accepted-vendor embedding measurement was not run and is a follow-up, not a C1 blocker. |
| Dimensions, replacement, reindex and search | Retained 69-case vector cohort and synthetic 3D-to-7D runtime sequence | Synthetic storage/search/replacement and cleanup are evidenced. No live accepted-provider dimension matrix is claimed. |
| Consent, document and access races | Retained backend and 69-case access/revision/queue-acknowledgement tests; QA-040 consent DOM check | Deterministic backend evidence applies to unchanged source. No production data or QA consent was changed by Tester. |
| Migration, worker and recovery | Retained isolated legacy/late-install/maintenance fixtures and actual worker stop/expiry/restart receipt | Prior isolated receipts remain source-scoped; no new database fixture was needed for this client-only delta. |
| Failure, status and retry | Retained 503/backoff/retry runtime; QA-038 client retry evidence; current focused catalog tests | Synthetic failure and client feedback are evidenced in their recorded scopes; no live-vendor failure or billing behavior is inferred. |
| Cross-client behavior | Current shared mobile types/build; delegated QA-037/038/039/040 reports for desktop web and Expo mobile renderer | Desktop web and Expo-web are browser evidence. The source-bound Electron interaction is pending below. Native iOS builds and Android-specific verification are excluded. Genuine 200% enlargement and actual assistive-technology behavior remain unverified. |

## Browser evidence and Electron gate

Tester read the delegated Markdown reports; no screenshots were exported or
independently pixel-inspected in this run. QA-037/038/039 reports contain scoped
desktop-web and Expo-web cases, with their source, viewport, theme and capture
limitations recorded in those reports. The relevant QA-039 and QA-040 reports:

- `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-039-c1-management-embedding-2026-10-08/visual-analysis.md`
- `/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-040-embedding-consent-bounded-2026-10-08/visual-analysis.md`

QA-040 used Expo web at `http://127.0.0.1:8083/`, the mobile app renderer, at
390x740 Light for the mobile consent/status cases; its bounded DOM closure is
source `0fe6b087`, whose mobile UI source matches this candidate. The report
records web 320x740 pre-enable readability, a mobile enabled/status/off case,
and the accessible-name closure. Captures are inline-only (`savedPath:null`).
These are mobile-browser results, not native proof.

The unsigned Electron package is
`/tmp/orbyn-c1-desktop-source-package-unsigned-20261008/mac-arm64/Orbyn.app`.
Its manifest records source `f7a48abf632157d368ac8e75e22117b42c8c581e`, clean
source, build/package exit 0, app.asar SHA256
`63e9a0a4269c80d8edec44a5d35ea14082d27fbf7df6df7a51b68ebefd30645f`, and
`formalQualification:false` / `nativeInteractionsVerified:false`. Desktop source
and package manifests are unchanged between that source and `1a92a2c0`, so the
artifact is source-bound for this candidate. It had not previously been launched.

Builder assigned Visual Check one bounded Electron capability/control/draft/
restart check using this artifact and the isolated QA account. The assignment
prohibits changes to saved providers, model/default, keys or consent and prohibits
inference. Visual Check owns the QA UI fixture; Tester has made no settings
mutations. Its Computer Use request is currently **waiting on approval**, not
denied or terminal. No retry or bypass was attempted. Record the result here
before closing this gate.

## Explicit exclusions and unresolved limits

- No iOS build, Android-specific job, native export or device interaction was run,
  per the user's C1 scope change. Shared mobile typechecks and Expo-web parity
  remain in scope and were checked as described above.
- Genuine 200% enlargement is unsupported by the exposed internal-browser
  capability. No prohibited alternate route, pinch/viewport/DPR substitution or
  screenshot claim was used.
- Actual screen-reader announcement/navigation was not tested.
- OpenAI cache economics and live accepted-vendor embedding measurements were
  not run. Current scope permits the Matilda baseline plus deterministic/runtime
  evidence for C1; vendor/cost unknowns remain explicit follow-ups.
- Electron capability/control/draft/restart evidence is pending Visual Check;
  persisted saved-provider switch, revocation and secure-storage recovery are not
  inferred from that bounded draft check. Retained backend/process tests cover
  their own deterministic authority/recovery contracts.
- No current-candidate full `npm test` run is claimed. The 4,337-case receipt is
  retained only for exact unchanged backend implementation/dependency source;
  current changed test files have their own 208/208 current-source run.
- No merge, push, deployment, C1 stage completion or C2/M1 advancement is claimed.

**Tester result:** current-source executable checks pass and retained backend/
runtime evidence is source-applicable. Whole C1 remains open pending the Electron
result and Reviewer disposition of the remaining cross-client coverage and the
genuine 200% capability limitation. Review counter remains 1/3; Tester execution
does not consume a review round.
