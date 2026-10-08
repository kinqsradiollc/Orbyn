# Current scope update — 8 October 2026

The user removed iOS builds and Android-specific verification from C1. Their
runtime/device/disk prerequisites no longer gate acceptance; do not repeat native
mobile packaging or Android-specific jobs. Shared mobile code/types and mobile
browser checks remain in scope. Historical native preparation receipts below are
retained, not active requirements. The user also approved live OpenAI cache and live embedding qualification as
follow-up measurements. The existing Matilda baseline plus deterministic/runtime
evidence can qualify C1, with unknown cost/vendor outcomes reported honestly. Full-checkpoint Test → Review and counter1/3 remain.

# C1 Builder readiness

Status: **Complete retained candidate frozen; consolidated Tester qualification active**.
Review counter remains **1/3**.
Frozen full candidate: `1a92a2c0` (contains product correction `0fe6b087`) on `codex/c1-production-checkpoint`
in `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
It includes the retained full C1 implementation, prior capture-module repair,
and QA-040-001 mobile consent accessible-name correction. The latter passes
34 focused development tests and awaits consolidated Tester qualification.
No product subset is promoted before full C1 acceptance.

## Full state inventory

The implementation and test plan remain indexed in
`c1-full-2026-10-08-handoff.md` and
`c1-full-2026-10-08-qualification-plan.md`. Earlier sources, counters and
native/live prerequisites in those historical records are superseded by the
current scope override. This record and `adr-current-state.md` govern readiness.

| Requirement group | Current preparation / qualification |
| --- | --- |
| Managed/BYO/personal authority | Full entrypoint/recovery matrix and immutable snapshot suites ready for consolidated qualification. |
| Saved independent connections | CRUD, enable/disable, credential testing, revisions and persistence fixtures plus QA039 scoped browser evidence available. |
| Catalog/manual/default | Large/slow/empty/error, keyboard and stale-response coverage available; retain QA037/038 and 205-case retest limits. |
| Generation wire formats | All20 saved-kind fixtures available; actual authorized Matilda six-call baseline remains distinct from mocks. |
| Reasoning/cache | Control/wire tests available. Actual OpenAI cache economics are an approved follow-up; do not infer savings from zero counters. |
| Usage | Positive/large/unknown/loading/error/retry evidence available, with private separation and billing uncertainty. |
| Independent embedding recipient | Revision-bound consent fixtures and QA040 scoped browser flow available; accessible name fixed and QA040001 independently closed in Expo web DOM. Live accepted vendor probe is an approved follow-up. |
| Dimensions/replacement | pgvector fixtures and actual synthetic3D→7D replacement/deletion/requeue receipt available. |
| Consent/document/access races | Ownership/visibility/edit/delete/revoke and in-flight revision suites available. |
| Migration/worker | Independent upgrade/late-install fixtures and operational restart receipts available. |
| Failure/status/retry | Synthetic persistent backoff, scheduled recovery, heartbeat expiry/restart, off cleanup and exact-search receipts available. |
| Cross-client behavior | Shared mobile types and Expo web preview; web/Electron source-bound artifact available. iOS builds/Android verification excluded. Genuine200% tool limitation and unexecuted Electron interaction must remain explicit for Tester/Reviewer disposition. |

QA040 cleanup is verified in the marked isolated database: search off, consent
null, queue/vectors/failures zero. Owned measuring worker stopped. Expo8083
now serves the corrected candidate; web5174/API8010 retain unchanged relevant
source. No vendor requests or native jobs are needed for the label recheck.

## Preparation ownership

Builder owns source fixes, packages and prerequisites. Tester waits for the whole
ready candidate; Reviewer waits for consolidated Tester evidence. The consolidated handoff is `c1-consolidated-final-handoff-2026-10-08.md`
on the frozen candidate. Tester now owns formal qualification; Reviewer waits
for its report, with the next full review recorded as2/3 before it begins.

The read-only installed inventory is in
`c1-installed-qualification-readiness-2026-10-08.md`: existing packages cannot
be attributed to the current source, Android has no connected device, and the
paired physical iPhone's inventory request timed out. Builder is preparing a
source-bound Electron artifact in the clean
`codex/c1-production-checkpoint` worktree. The primary checkout's user-owned
`mobile/app.json` changes remain untouched.

### Desktop prerequisite prepared

Builder rebuilt shared packages, built the desktop renderer with the isolated
QA API `http://127.0.0.1:8010`, then packaged an unsigned macOS arm64 Electron
app. Both build and final packaging exited **0**. The initial build used stale
shared dist files and failed; rebuilding the shared packages resolved those
errors without source changes. An unnecessary signing attempt was terminated
(exit143), then local-only packaging explicitly disabled signing.

- Clean source: `f7a48abf`, `codex/c1-production-checkpoint`; product tree
  identical to main `e6c4c75b`/`3ccf8f57`.
- App: `/tmp/orbyn-c1-desktop-source-package-unsigned-20261008/mac-arm64/Orbyn.app`.
- Manifest: `/tmp/orbyn-c1-desktop-source-package-unsigned-20261008/source-manifest.json`.
- Archive SHA256: `63e9a0a4269c80d8edec44a5d35ea14082d27fbf7df6df7a51b68ebefd30645f`.
- All172 checked dist/preload/Electron files match the source-bound archive.
- Logs: `/tmp/orbyn-c1-desktop-package-build-20261008.log` and
  `/tmp/orbyn-c1-desktop-package-unsigned-20261008.log`.

Packaging reported the default icon and unresolved dependency-discovery warnings.
This artifact has not been launched or installed; runtime correctness, native
interaction and persistence remain unqualified. It is a local QA prerequisite,
not a release or a Tester handoff. Historical iOS/Android prerequisites are excluded by the current user scope.

Live OpenAI cache and accepted embedding measurements are approved follow-ups.
No fabricated vendor, installed-device, text-enlargement or full-C1 acceptance
is recorded. C2 remains unstarted and the pause stays conditional on full C1.

### Mobile preparation outcome

Builder generated both native projects from tracked app configuration. iOS
prebuild and CocoaPods installation succeeded; both simulator build destinations
failed because Xcode requires the missing watchOS26.5 runtime for the embedded
Watch app. Android prebuild succeeded, then a real assembly attempt found the
capture module's legacy Expo Gradle setup omitted `compileSdk`. Builder migrated
that module to the current Expo plugin on the C1 branch. The revised assembly
passed configuration and reached compilation/bundling, but stopped for disk
capacity (exit143); no mobile package or native acceptance is claimed.
Retained-log inspection also confirms the capture module's Kotlin/Java compile,
library bundling and manifest tasks completed; this scopes the repair evidence
without turning an interrupted APK build into a pass.

Builder removed only its own new native build outputs, recovering space from
390MiB to1.9GiB. More free disk, the missing runtime and an Android execution
target were required for that historical attempt; they no longer gate C1. The detailed retained commands/results are in
`docs/reviews/c1-native-package-preparation-2026-10-08.md` on the candidate branch
at `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
No formal Tester/Reviewer job or extra visual batch was dispatched.
