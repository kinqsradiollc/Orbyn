# C1 native package preparation

Builder preparation only. No formal Tester handoff, review round, visual batch,
installed interaction or C1 acceptance is started by these commands.

## Source and ownership

Clean starting product source: `f7a48abf`, branch
`codex/c1-production-checkpoint`. This product tree matched main `b8e8ed4f`.
The primary checkout's user-owned `mobile/app.json` stays untouched. Native
projects were generated from the tracked configuration in this separate tree;
Expo prebuild reported no package.json changes. Generated watch/widget resources
are build inputs, not newly authored product changes.

Shared packages and diagram assets were built before native packaging. The QA
API environment is `EXPO_PUBLIC_API_URL=http://127.0.0.1:8010`. Android devices
will require an explicitly established `adb reverse tcp:8010 tcp:8010` route
when executing the eventual local qualification; this is not a hosted build.

## iOS preparation

- `npx expo prebuild --platform ios --no-install`: exit0.
- `pod install`: exit0, dependency/toolchain warnings retained in the log.
- Xcode Release simulator build with signing disabled: exit70 for both the
  existing iPhone SE destination and the generic simulator build destination.
- Both attempts fail because the app embeds an Apple Watch app and Xcode
  requires the missing watchOS26.5 runtime. No app feature/target was removed to
  produce a narrower substitute.
- Logs: `/tmp/orbyn-c1-ios-prebuild-20261008.log`,
  `/tmp/orbyn-c1-ios-pods-20261008.log`,
  `/tmp/orbyn-c1-ios-build-20261008.log`,
  `/tmp/orbyn-c1-ios-build-generic-20261008.log`.
- Exact terminal commands/results are in the corresponding build `.state.json`
  files. No iOS package or installed acceptance is claimed.

## Android implementation correction

The initial current-source `:app:assembleRelease` preparation fails (exit1)
because `orbyn-capture` has no `compileSdk`. Its legacy
`ExpoModulesCorePlugin.gradle` setup does not apply SDK defaults on the installed
Expo toolchain. Builder migrated this module to `expo-module-gradle-plugin`,
matching installed first-party Expo modules. The installed plugin applies the
default SDK versions, Kotlin and core dependencies; these responsibilities are
not duplicated through hard-coded SDK values in the module.

Initial log: `/tmp/orbyn-c1-android-build-20261008.log`. Revised build uses
`:app:assembleRelease --no-daemon --max-workers=2
-PreactNativeArchitectures=arm64-v8a`; log/terminal receipt:
`/tmp/orbyn-c1-android-build-plugin-20261008.log` and `.state.json`.
Revised execution is still in progress at this preparation record. Do not claim
an APK, native behavior or full build pass from configuration progress.

Both build wrappers stop their own process group if available disk drops below
1.2GiB. Terminal results must be read before retrying. The Android package uses
the generated local debug signing configuration and one QA architecture; it
must not be presented as a production distribution package.

## Remaining complete-checkpoint preparation

Obtain the required iOS runtime and enough disk for native builds, source-bound
mobile packages, and a connected/emulated Android device. Keep all retained C1
success/error/recovery/authority and persistence scenarios in the consolidated
test plan. Live OpenAI/cache and independent accepted embedding inputs remain
missing: a names-only check found no related configured variables in root
`.env` or `.env.production` on this turn. Fixture evidence does not waive those
gates. Tester and Reviewer continue waiting for full readiness.
