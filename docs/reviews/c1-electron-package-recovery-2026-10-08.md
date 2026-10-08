# C1 Electron package recovery — 8 October 2026

Frozen product source1a92a2c0, owned candidate codex/c1-production-checkpoint in
`/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`.
E1 remains open; no acceptance or main product promotion.

## Reproduction and actual state

QA041 Computer Use selection timed out but did launch the old source-bound QA
artifact. Process43217 and children used the default desktop profile. Builder
stopped only that artifact, without UI login/settings actions, then launched the
same binary with isolated `/private/tmp/orbyn-c1-electron-isolated-profile-20261008`.
Process43666 and child commands confirmed the temporary browser profile.

Isolated stderr contains `ERR_MODULE_NOT_FOUND`: package `lib0` imported by
`app.asar/node_modules/yjs/dist/yjs.mjs`. Main/GPU/network processes existed but
no renderer. Builder stopped the broken isolated process. The Computer Use timeout
is recorded separately in QA041; it is not a permission denial or UI proof.

Original package log already warned unresolved paths for lib0 and several other
production dependencies. Inspection found owned candidate node_modules/lib0/yjs
borrowed symlinks to the character worktree. A lockfile `npm ci --prefer-offline`
replaced the dependency installation and exited0. No source or lockfile change.

## Recovery execution

Shared build, desktop renderer build targeting isolated API8010 and unsigned
macOS arm64 directory packaging completed sequentially from the unchanged
candidate, all exit0. No signing/publishing/native mobile export or iOS/Android verification.
Archive inspection confirms lib0.2.119/yjs13.6.33 present. SHA256:
`b5dd4e4450722625d7f448ccc5252b12b2ee22301a935e672776b4fc21e782e2`.
Actual clean-profile startup creates main44923 and renderer44928; no module-load
error in isolated launch log. GUI behavior remains unverified. Manifest:
`/tmp/orbyn-c1-desktop-clean-package-20261008/source-manifest.json`.

Logs: `/tmp/orbyn-c1-isolated-dependency-install-20261008.log`,
`/tmp/orbyn-c1-clean-desktop-shared-build-20261008.log`,
`/tmp/orbyn-c1-clean-desktop-renderer-build-20261008.log`,
`/tmp/orbyn-c1-clean-desktop-package-20261008.log`.
New output: `/tmp/orbyn-c1-desktop-clean-package-20261008`.

Visual Check stopped after the failed old-artifact selection. The newly rebuilt,
startup-qualified artifact is now assigned for only the existing bounded C1
control/draft/restart case. Tester receives the whole unchanged source plus
clean-installed environment and artifact for consolidated impact qualification. No provider/default/key/consent
mutation or vendor request. E2 genuine enlargement disposition remains pending.
