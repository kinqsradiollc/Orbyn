# C1 installed-client qualification readiness

Date: 8 October 2026. Read-only capability and artifact audit for the C1
provider/settings selection, persistence and recovery requirements. This is not
formal qualification, an application launch, device interaction, screenshot
review or acceptance decision. No tests, builds, installs or preview changes were
performed in this audit.

## Target and handoff boundary

Requested qualified product source: main 519a72d4f7d77b44ff2b4a6c50d39bd1ff22d746
(doc: record C1 code delivery and runtime qualification). The product tree at
that source is the previously qualified 3ccf8f57 tree; 519a72d4 records
qualification/runtime docs. The user's current canonical workflow says Builder
must first implement all C1 states and prepare all qualification prerequisites,
then issue one consolidated formal Tester → Reviewer handoff. C1 is in Builder
preparation; review counter remains 1/3. This audit only records available
installed-client capability. It does not start a per-state handoff.

The primary checkout has pre-existing local changes: mobile/app.json,
.codex-cleanup-backups/, .freebuff/, ISSUE_TEMPLATE/,
PULL_REQUEST_TEMPLATE.md, agent-workflow.html, dependabot.yml, and
mobile/modules/orbyn-capture/android/.gradle/. The mobile/app.json diff adds
local Expo owner/project metadata. These files were left untouched; resolve and
record the effective app configuration when Builder prepares the eventual
source-bound native package.

## Device and artifact inventory

| Platform | Artifact/device found | Identity and state | Readiness |
| --- | --- | --- | --- |
| iOS simulator | Installed bundle Orbyn.app in simulator container 5B57F1D8-7251-4FD7-9800-32AEF6241189 on simulator UDID A166A84A-7389-4FAB-9EA8-8EADAD1D54E3 | Device name “Orbyn native models narrow QA”, iPhone SE (3rd generation), iOS 18.5 runtime, currently Shutdown. Bundle id com.orbyn.planner, version 1.0.0/build 1. Files show Oct 6 timestamps; the app has Orbyn.debug.dylib and Expo Dev Launcher. | Existing development shell only; exact JS/app source SHA is unknown. Not usable to qualify 519a72d4 without the candidate JS/runtime and matching native source. |
| iOS physical | Xcode reports paired iPhone 17 Pro Max, UDID 9F45C570-2F24-515F-B96D-6503675475F1, state available (paired) | Read-only devicectl device info apps --bundle-id com.orbyn.planner timed out with CoreDevice transport NWError 60; installation and app source on this device remain unknown. Other listed iPhone 15 Pro Max and iPad devices report unavailable. | Potential device after connectivity is restored and app/version/source are verified. No app was launched or changed. |
| Android | No APK/AAB found in the project build outputs; adb devices -l lists no devices. No androidTest/test/java suite found under mobile. | No connected Android device or emulator reported. | No existing Android artifact/device to run. |
| macOS Electron | Packaged app at desktop/release/mac-arm64/Orbyn.app | Bundle id com.orbyn.planner, version 1.0.0; app.asar and executable dated Sep 15. mdfind found this repository bundle only; /Applications/Orbyn.app and ~/Applications/Orbyn.app are absent. No Orbyn Electron process was found. | Stale package with no recorded source SHA; not a current installed candidate. Do not treat it as C1 evidence. |

Xcode 26.6 (build 17F113) is available. mobile/ios/build contains only
generated/autolinking and generated/ios, not an app product. Xcode lists the
Orbyn app scheme and CocoaPods schemes, but no OrbynTests target/scheme or
.xctestplan was found. The simulator app's Expo.plist says
EXUpdatesEnabled=false; its bundle contains no main.jsbundle or .hbc.
Therefore it does not identify or contain the JavaScript product source. The
source project's last project.pbxproj change is Sep 25; that does not establish
the binary's complete build source. mobile/package.json offers expo run:ios
and expo run:android, which build/install; it has no test script. Running those
commands would create new native artifacts, not use a current source-identified
install.

## Existing functional automation and limits

The qualified backend/focused test receipts remain available: full backend
4337/4337 on the 3ccf8f57 product tree, focused mobile/catalog/provider checks,
workspace typechecks and iOS/Android Expo exports. They establish the recorded
server/shared/client source checks and packaging for their source; exports do
not identify an installed app and are not native interaction evidence.

Relevant automated code checks include:

- backend/tests/admin-ai-management.unit.test.ts evaluates extracted mobile
  handlers with mocked confirmations/client calls; its iOS case mocks the
  native Alert helper. It does not launch an app or exercise iOS hardware.
- backend/tests/mobile-provider-model-search.unit.test.ts evaluates the mobile
  source model-search/provider row with a simulated component tree.
- backend/tests/admin-ai-catalog-accessibility.unit.test.ts renders through
  React Native Web and checks serialized web accessibility props, not installed
  iOS/Android accessibility or secure storage.
- backend/tests/managed-provider-authority.test.ts tests backend authority and
  recovery behavior, not native settings persistence.

These tests support source/API behavior; none drives an installed client through
provider choice, persistence across app restart, revocation or secure storage.
No Detox, Maestro, Appium, XCTest UI target or Android instrumentation harness
was found. The mobile session utility calls expo-secure-store, but this audit
found no device test proving its Keychain/Keystore persistence for the C1 flow.

## Can an installed functional check run now?

No check can be honestly attributed to the requested C1 source with the current
artifacts. The simulator bundle is an Expo development shell without its JS
bundle or a source manifest, the simulator is shut down, the paired physical
phone cannot currently answer the filtered app-inventory request, Android has no
device or package, and the only Electron package predates C1. Running or
reconfiguring any one of these would not resolve its unknown code identity.

For later consolidated readiness, Builder must provide source-bound iOS and
Android artifacts (commit/source manifest and build identity), an accessible
booted simulator or connected device for each intended platform, the isolated QA
account/API and safe provider fixture, and a defined way to exercise save/reload,
app restart, account/provider switch and revocation while checking settings and
secure-storage behavior. Resolve the local Expo config delta as part of that
handoff. If no installed UI automation is added, label a supported manual device
session accurately; do not present a bundle export, Metro/web preview, simulator
build or SSR rendering as installed-device proof.

No further native action was taken. C1 remains under Builder's whole-checkpoint
preparation; the requested pause before C2/M1 remains conditional on completing
and qualifying all C1 requirements.
