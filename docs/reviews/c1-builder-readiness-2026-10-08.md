# C1 Builder readiness

Status: **preparation, no formal handoff**. Review counter remains **1/3**.
Latest Builder code candidate: `10d3d1e3` on `codex/c1-production-checkpoint`
(native Android capture Gradle correction); preparation receipt commit
`f74ecc5c`. This source delta is not qualified or promoted to main.
Scope: all retained C1 requirements, not just the latest fixes. Product source
at main `e6c4c75b` is equivalent to `3ccf8f57` for product/test/dependency paths.
The current rules require full readiness before one Test → Review handoff.

## Full state inventory

The implementation and planned checks are indexed in
`c1-full-2026-10-08-handoff.md` and
`c1-full-2026-10-08-qualification-plan.md`. Their earlier handoff status,
counter and preview ownership are historical; this record and
`adr-current-state.md` govern current readiness.

| Requirement group | Builder preparation remaining before formal handoff |
| --- | --- |
| Managed/BYO/personal authority | Retain the complete entrypoint/recovery matrix; prepare permitted live-provider and installed recovery inputs. |
| Saved independent connections | Carry CRUD, enable/disable, credential testing, account/revision changes and persistence into the single platform plan. |
| Catalog/manual/default | Retain large/slow/empty/error, keyboard and stale-response coverage; prepare current native artifacts. |
| Generation wire formats | Retain all adapter fixtures; identify the actual authorized live model separately from fixtures. |
| Reasoning/cache | Obtain authorized OpenAI evaluation model/key and bounded benchmark configuration; Matilda baseline is not OpenAI cache economics. |
| Usage | Carry positive/large/unknown/loading/error/retry states and private separation; preserve uncertainty about billing and plans. |
| Independent embedding recipient | Identify authorized live embedding provider/model and prepare explicit recipient/revision consent. Local synthetic proof stays distinct. |
| Dimensions/replacement | Retain pgvector/dimension/reindex fixtures and the completed synthetic 3D→7D replacement receipt. |
| Consent/document/access races | Retain ownership/visibility/edit/delete/revoke and in-flight revision fixtures; include installed-client recovery. |
| Migration/worker | Retain isolated upgrade/late-install fixtures and operational restart receipts, with explicit fixture ownership. |
| Failure/status/retry | Retain persistent backoff and completed synthetic failure/retry/restart/off/exact-search receipts; prepare platform interactions. |
| Cross-client behavior | Prepare source-bound Electron/iOS/Android packages and available device targets. Reuse valid browser evidence; request visuals only for a specific unresolved material risk. |

## Preparation ownership

Builder owns source fixes, packages and prerequisites. Tester waits for the whole
ready candidate; Reviewer waits for consolidated Tester evidence. No new review
round or formal test run is initiated by this document.

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
not a release or a Tester handoff. iOS/Android prerequisites remain open.

Live provider/cache/embedding configuration is a pending external prerequisite.
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
target are still required. The detailed retained commands/results are in
`docs/reviews/c1-native-package-preparation-2026-10-08.md` on the candidate branch
at `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
No formal Tester/Reviewer job or extra visual batch was dispatched.
