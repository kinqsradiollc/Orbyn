# Mobile guide

The mobile app lives in `mobile/` and is the `@orbyn/mobile` workspace of the monorepo. It shares
types, validation, and the API client with the web app through `@orbyn/core` and
`@orbyn/api-client`.

## Mobile navigation and layout

The bottom bar contains Today, Tasks, Calendar, Assistant and Workspace. Notifications are
available from the bell in the header. Workspace provides direct access to Planning, Projects,
Docs, Agenda and the other workspace tools. Tapping the tab you are already on scrolls back
to its top and refreshes, as in Instagram and Facebook; on Assistant it jumps to the newest
message instead.

- Assistant replies use the content column's full width. The composer has a full-width text
  field and a separate action row, and stays above the software keyboard.
- Documents opens on a collection, with Browse library revealing Pages, Notes, Favorites and
  expandable folders. Folder children open directly; View folder narrows the collection.
  New documents and notes inherit the selected folder. Sort switches between last edited
  and title A–Z; search looks across all pages and notes. The web client keeps this library
  beside the editor and collapses it behind Browse library on narrow screens; on wide screens
  Hide library gives the page the full width, and the web sidebar collapses to an icon rail.
- Import file (Documents) picks a PDF, Word file or photo of notes with `expo-document-picker`
  and uploads it. **Scan notes** takes a photo with the camera (`expo-image-picker`) when the
  server can read photos (`GET /imports/capabilities`). Files **shared to Orbyn** from another app
  (the iOS share extension and Android share targets from `expo-sharing`, set up in `app.json`)
  are imported too, and Docs opens on Uploads. Uploads rows offer Make cards (it opens Study's
  suggestions) and Import again after a failure. Tapping an "import ready" notice opens the page. The page lands in the Uploads collection, which also shows files still being
  read, with progress. Move to folder files a page and takes it out of Uploads. The picker is a
  native module, so iOS and Android need a new development or EAS build after this change: the
  picker, the camera, the share extension, haptics and file saving are all native. The web build
  works as is.
- Study matches the web: three ways to get your first cards, pages with cards as compact rows,
  Study ahead and Quiz me when nothing is due, a 7-day forecast, and each exam's projection.
  Maths in cards reads as text. While reviewing, swipe a shown card right for Good or left for
  Again, with a light haptic tap.
- Settings → Passkeys lists and removes passkeys; Add a passkey opens the web app in a browser
  sheet (passkeys belong to Orbyn's web address). Sync & devices can forget a device. Exporting a
  page (every format) and an admin's export of a user's data are saved through the share sheet
  (`expo-file-system`, `expo-sharing`). Admin → Storage is on the phone too.
- Document cards expose Open, Star and Folder separately to accessibility services. Document
  titles grow as they wrap, including while editing.
- Projects opens on Tasks, with Notes, Timeline, Decisions and History in separate views.
  Promises across every project sit in one collapsible row above the list; a decision that
  no task delivers yet says so and offers Make a task.
- Planning groups settings into collapsible sections and keeps Save at the bottom. Collapsing
  a section preserves its draft values.
- Calendar starts in Day unless a view was saved. Phone month grids use activity dots;
  wider layouts retain event bars. Switching to Week or Month keeps the date picker visible.
- Choice controls wrap when their available width cannot provide 44-point targets.
- **One +** sits in the header on every tab. A tap runs the favourite (New task until another is
  chosen); a long press opens the + sheet: New task, New page, From template, Scan notes, New
  project, Plan my day, Start focus and Ask assistant, with Arrange at the bottom to reorder
  rows, hide the ones never used and star the one a tap runs (kept on the device,
  `packages/core/src/create-actions.ts`).
- **Writing a page:** the line being typed gets one row of icons on the keyboard (the sheet
  docks it just above it): Undo, Redo, Aa (the kind of line), Bold, Italic, Highlight, Link
  (a web address for now), To-do (a to-do with words becomes a task of its own: Make task),
  Indent, Outdent, Comment, Ask (the assistant, on the chosen words or the whole line), ⋯ (Move
  up, Move down, Comment on some words, Delete line) and Hide keyboard last, which puts the line
  away. The style the caret is in is tinted. Undo and Redo work across the page, not only the
  line (`packages/core/src/undo.ts`, `line-toolbar.ts`).
- **A page's header** is Back, its title (once the page's own title has scrolled away), Info
  and ⋯. Info holds how you're working on the page (Editing, Suggesting, Viewing), what it
  belongs to, its tags, "still true?", its size, who else is here, and Show history. ⋯ holds Ask
  about this page, Share…, Export…, History, Save as template and Move to Trash.
- **Share** is in the ⋯ of pages (the link, a Markdown file or a PDF), tasks and projects (the
  link). Links are the web app's (`/app/doc/<id>`, `/app/task/<id>`, `/app/project/<id>`); the web
  app on a phone's browser has the same Share where the browser has a share sheet.
- **Save to Orbyn:** text and links shared from another app open a sheet with the link's title and
  site, the last three places used as chips, and where it goes: an Inbox task "Read: <title>"
  with the link, today's agenda (under Notes), a page, a new page in a folder, or a project; one
  Save (`POST /capture`, `POST /capture/preview` for the title). Files still go to Uploads.

### Redesign verification (22 September 2026)

Native checks used Expo Go on the iPhone 17 simulator. Edit/save checks used an isolated copy
with in-memory API fixtures, not the deployed account: document title editing and returning
to the list, independent starring, project section switching, planning working-day changes
and saving, chat composition and replies, and calendar view/date navigation. The software
keyboard was checked with the assistant composer. Light appearance and a constrained
320-point-wide dark layout were inspected. Fixtures verify client behavior, not backend
persistence or live AI-provider responses.

The library follow-up was checked with isolated fixtures: web folder expansion, filing a page,
A–Z sorting and opening the editor beside the sidebar; native library navigation, selecting a
folder, creating a page in it and sorting at a constrained 320-point width in dark appearance.
The web production build also passed. Folders remain one level deep, with pages as children.

The mobile TypeScript check and iOS/Android bundle exports are the build gates. Android
device behavior, physical-device keyboards and push delivery need their own device checks;
an export is not a substitute for those checks.

## Run in development

From the repository root:

```bash
npm install
npm run build:packages
cp mobile/.env.example mobile/.env
npm run dev:mobile          # or: cd mobile && npx expo start
```

Build the native development client once with `npm run ios -w mobile` or
`npm run android -w mobile` (requires Xcode or Android Studio). Then use the Expo dev server
and press `i` or `a` to open the installed client.

For the iOS simulator, `EXPO_PUBLIC_API_URL=http://localhost:8008` reaches Docker on the Mac.
For an Android emulator, use `http://10.0.2.2:8008` or run `adb reverse tcp:8008 tcp:8008`
to use localhost. On a physical phone, localhost refers to the phone itself.

### Errors on screen

People see plain messages ("Couldn't reach Orbyn…"); the details of a failed request (the call,
status, what the server said, its request id) go to the Metro console or the device log.
Development builds also show them on screen. For a test build that should too, set
`EXPO_PUBLIC_DEBUG_ERRORS=true` in `mobile/.env` before building.

### Physical device

1. Find your computer's LAN address, for example `192.168.1.20`.
2. Set `EXPO_PUBLIC_API_URL=http://192.168.1.20:8008` in `mobile/.env`.
3. Publish the API on all interfaces: set `API_BIND=0.0.0.0` in the root `.env` and add the LAN
   origin to `CORS_ORIGINS` if you also serve the web app from it, then `docker compose up -d`.
4. Restart `npx expo start` so the new env is bundled, and open the project in your
   development build.

## Push notifications

Push reminders need a real Expo push token, which requires:

- an EAS project id in `EXPO_PUBLIC_EAS_PROJECT_ID` (create one with `npx eas-cli init`), and
- a development build or store build with APNs / FCM credentials configured in EAS.
  Use a physical device to verify actual delivery; Expo Go is not the push validation path.

Flow inside the app:

1. In Settings, tap **Enable mobile notifications**. The app asks for permission and calls
   `Notifications.getExpoPushTokenAsync`.
2. It registers the token with `POST /devices` and caches it in secure storage.
3. The backend worker sends reminders to Expo's push API and stores the ticket, then checks the
   receipt after 15 minutes. Tokens reported as `DeviceNotRegistered` are removed automatically.
4. On logout the app calls `DELETE /devices` so the phone stops receiving reminders for that
   account.

If your Expo account has "enhanced push security" enabled, set `EXPO_ACCESS_TOKEN` in the root
`.env` so the worker can authenticate.

## Links into the app, and the app icon's quick actions

One listener in the app (`mobile/src/hooks/useAppLinks.ts`, read by `parseAppLink` in
`@orbyn/core`) opens every link into the app: `orbyn://add` (a new task; with `?text=` the words
fill Today's quick add for you to check and add — a link never adds anything by itself),
`orbyn://agenda`, `orbyn://scan`, `orbyn://assistant`, `orbyn://share?url=&text=` (Save to Orbyn),
`orbyn://today`, `orbyn://review[/<id>]` (the Inbox until the Review inbox arrives),
`orbyn://search?q=` (Search, with the words typed), and `orbyn://doc/<id>`, `orbyn://task/<id>` and
`orbyn://project/<id>` — or the web app's `/app/…` paths for the same. A link that arrives signed
out opens after sign-in.

**Universal links and app links.** `mobile/app.config.js` adds `associatedDomains`
(`applinks:<host>`) on iOS and a verified `https://<host>/app/` intent filter on Android to what
`app.json` holds, without changing `app.json`. The host is `EXPO_PUBLIC_WEB_URL`'s (https only),
else `orbyn.dev`. The web host serves the matching `/.well-known/apple-app-site-association` and
`assetlinks.json` once the API has `APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` (see
docs/api.md). This takes effect in a new native build; the Associated Domains capability must be on
for the app id.

**Copy link** is in the ⋯ of a page, task and project (expo-clipboard; a build made before it was
added falls back to the share sheet). **Search** (Workspace → Search) finds pages, tasks and
projects with the web's filters and operators (`tag:`, `project:`, `team:` — `team:personal` for
what's in no team — `is:`, `edited:`) and a one-line summary; with nothing typed it lists what you opened last on any device. **Settings →
Privacy → Security and data** shows the dated page the web has at `/security`.

Long-pressing the app icon offers **New task, Today's agenda, Scan notes and Ask assistant**, each
opening one of those links. They come from a config plugin and a small local module,
`mobile/modules/orbyn-quick-actions` (listed in `app.json` → `plugins`):

- iOS: `UIApplicationShortcutItems` in Info.plist, each carrying its link; the module's app
  delegate subscriber hands the chosen one to JS (`takeInitialQuickAction`, `onQuickAction`).
- Android: static app shortcuts (`res/xml/orbyn_shortcuts.xml`) that open the link on the main
  activity, so it arrives through `Linking`.

**This needs a new native build (EAS or `expo prebuild`)** — Expo Go and the web build have no
quick actions; the same is true of receiving shared text and links (the share extension's
`supportsText`/`supportsWebUrlWithMaxCount` on iOS and `text/plain` on Android, in `app.json`). The
JS side, the plugin's Info.plist and manifest output (`npx expo config --type introspect`) and the
link parser are checked; the icon menu itself is verified on a device after that build.

## Quick capture with Siri / Shortcuts

The app registers the `orbyn://` URL scheme, and opening `orbyn://add?text=<your task>` opens Today
with the text in quick add, parsed as you'd typed it; one tap on + adds it (via `POST /items/quick`).
No native extension is needed:

1. In the **Shortcuts** app, add an **Open URL** action with `orbyn://add?text=Buy%20milk` (or use
   an **Ask for Input** / dictation step and put its result in the `text` query value).
2. Name the Shortcut (e.g. "Add to Orbyn") and, on iOS, add it to Siri — then say it to capture a
   task hands-free.

A link opened while signed out waits for sign-in. On-device behaviour is verified by hand; the
link parsers (`parseAddDeepLink`, `parseAppLink` in `@orbyn/core`) are unit-tested. Home-screen widgets and an Apple
Watch app are separate native targets — see the next section.

## Home-screen widget & Apple Watch (native)

The app ships the data side of a home-screen widget and an Apple Watch app, plus the native target
sources under `mobile/targets/`. The Swift is built in Xcode — it is **not** compiled by CI (CI only
type-checks the JS and bundles with Metro), so treat it as reviewed-but-unverified until you build it
on a Mac.

How it works:

- `@orbyn/core` `buildGlance()` turns the person's items into a compact "glance" (open/done tasks
  today, overdue count, next event). It is unit-tested.
- `mobile/src/lib/widget.ts` writes that glance to the shared **App Group** container after every
  refresh and calls `ExtensionStorage.reloadWidget()` (`@bacons/apple-targets`). It no-ops off iOS
  and in Expo Go, so it is always safe to call.
- `mobile/targets/widget/` is a WidgetKit widget (small + medium) that reads the glance from the App
  Group. `mobile/targets/watch/` is a SwiftUI Watch app that receives the glance over
  WatchConnectivity and caches it.
- `mobile/modules/orbyn-watch/` is a local Expo native module (the phone side) that sends the glance
  to the Watch over WatchConnectivity.

### What's verified

The Swift type-checks against the SDKs shipped with Xcode (verified with Xcode 26 / Swift 6):

```sh
xcrun --sdk iphoneos swiftc -typecheck -parse-as-library -target arm64-apple-ios17.0 \
  targets/widget/index.swift
xcrun --sdk watchos swiftc -typecheck -parse-as-library -target arm64_32-apple-watchos10.0 \
  targets/watch/index.swift
```

The `orbyn-watch` module's WatchConnectivity logic type-checks against the iOS SDK too; its Expo
Module wrapper needs the Expo pods, so it is checked as part of a full build. Still to do on a Mac:
the full app build (`pods` + link + signing) and running the widget/Watch on a device or simulator.

To build it, add these to `app.json` (kept out of git because it also holds your EAS project id):

```jsonc
{
  "expo": {
    "ios": {
      "appleTeamId": "YOURTEAMID",
      "entitlements": {
        "com.apple.security.application-groups": ["group.com.orbyn.planner"],
      },
    },
    "plugins": [
      "expo-secure-store",
      "expo-notifications",
      "@react-native-community/datetimepicker",
      "@bacons/apple-targets",
    ],
  },
}
```

Then generate and build the native project:

```sh
cd mobile
npx expo prebuild -p ios --clean
xed ios   # select the OrbynWidget / OrbynWatch scheme and run
```

Phone → Watch sync is wired: the local Expo module `mobile/modules/orbyn-watch/` sends the glance
to the Watch with `WCSession.updateApplicationContext` (watchOS can't read the phone's App Group),
and `mobile/src/lib/widget.ts` calls it after each refresh. The JS side uses
`requireOptionalNativeModule`, so it no-ops in Expo Go and CI and activates in a dev/prod build. The
widget needs no extra wiring once the App Group is set. Everything native (widget, Watch app, and
this module's Swift) is compiled and verified in Xcode, not by CI.

## Capture from outside the app (D5: CAP-05, CAP-06, CAP-07, CAP-09, DSN-06)

All of this is written and type-checked (`xcrun swiftc -typecheck` for the Swift), and needs **the
owner's native build** (EAS) to run; Expo Go and the web build have none of it, and the JS no-ops
there. `mobile/app.config.js` adds everything without touching `app.json`:

- **Widgets you tick tasks from** (`mobile/targets/widget/`): the Home Screen widget (small,
  medium, large) set to Today, Up next, or one list or project, with a circle to tick each task
  and New task; the Lock Screen's **Next up** (rectangular, inline, circular). They read the glance
  the app keeps in the App Group (`buildGlance` in `@orbyn/core`, now with the tasks to tick).
- **Control Center and Lock Screen capture** (iOS 18): the **Add to Orbyn** control opens quick
  add. The focus session shows as a **Live Activity** on the Lock Screen and in the Dynamic Island
  (`mobile/modules/orbyn-capture`, started and ended from `useFocusSession`).
- **Siri, Shortcuts and Spotlight** (`modules/orbyn-capture/native/ios/OrbynIntents.swift`, put in
  the app target by the module's config plugin): Add to Orbyn, Add to today's agenda, What's next
  and Start focus. They run without opening the app (Start focus opens it).
- **Android**: the Home Screen widget (`OrbynTodayWidget`, tick tasks and New task) and the
  **Quick Settings tile** "Add to Orbyn" (`OrbynCaptureTile`), written into the app's package by
  the same plugin, with their layouts and the palette's own colours (light and dark).
- **App icon** (DSN-06): light, dark and tinted on iOS 18, and adaptive plus themed (monochrome)
  on Android, all from `mobile/assets/icons/` in the palette's own green.

The native side never holds your sign-in. A tick or a capture made in a widget, a control, Siri or
the tile waits in shared storage (`pending`, read by `readPending` in `@orbyn/core`) and the app
sends it the next time it comes to the front (`flushPending` in `mobile/src/lib/widget.ts`); the
widget shows the change at once.

The owner's steps: set `ios.appleTeamId` and the App Group (`group.com.orbyn.planner`) in the local
`app.json`, turn on the App Groups and Siri capabilities for `com.orbyn.planner` and the widget's
bundle id in the Apple Developer account, then `eas build`. Check on a device: ticking in the
widget, the Lock Screen widget, the Control Center control, "Hey Siri, add to Orbyn", the focus
Live Activity, the Android widget and tile, and the icon in dark and tinted modes.

## Build and release

```bash
cd mobile
npx eas-cli login
npx eas-cli init                       # writes the project id into app.json
npx eas-cli build --profile preview    # internal distribution build
npx eas-cli build --profile production
npx eas-cli submit --profile production
```

Profiles are defined in `eas.json`. Bundle identifiers are `com.orbyn.planner` on both platforms;
change them in `app.json` before publishing under your own organization.

## Type checking

```bash
npm run typecheck -w mobile
```

Native signing and App Store / Play Store submission require your developer accounts. JavaScript
bundle checks do not prove native compilation, signing, or device push delivery.
