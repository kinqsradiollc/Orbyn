# Mobile guide

The mobile app lives in `mobile/` and is the `@orbyn/mobile` workspace of the monorepo. It shares
types, validation, and the API client with the web app through `@orbyn/core` and
`@orbyn/api-client`.

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

## Quick capture with Siri / Shortcuts

The app registers the `orbyn://` URL scheme, and opening `orbyn://add?text=<your task>` adds a task
from the text (via `POST /items/quick`) and refreshes. No native extension is needed:

1. In the **Shortcuts** app, add an **Open URL** action with `orbyn://add?text=Buy%20milk` (or use
   an **Ask for Input** / dictation step and put its result in the `text` query value).
2. Name the Shortcut (e.g. "Add to Orbyn") and, on iOS, add it to Siri — then say it to capture a
   task hands-free.

The person must already be signed in on the device. On-device behaviour is verified by hand; the
link parser (`parseAddDeepLink` in `@orbyn/core`) is unit-tested. Home-screen widgets and an Apple
Watch app are separate native targets and are not part of this.

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
