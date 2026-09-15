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

Press `i` for the iOS simulator or `a` for an Android emulator. The default
`EXPO_PUBLIC_API_URL=http://localhost:8008` works for simulators when the backend runs via Docker
Compose on the same machine.

### Physical device

1. Find your computer's LAN address, for example `192.168.1.20`.
2. Set `EXPO_PUBLIC_API_URL=http://192.168.1.20:8008` in `mobile/.env`.
3. Publish the API on all interfaces: set `API_BIND=0.0.0.0` in the root `.env` and add the LAN
   origin to `CORS_ORIGINS` if you also serve the web app from it, then `docker compose up -d`.
4. Restart `npx expo start` so the new env is bundled, and open the project in Expo Go or a
   development build.

## Push notifications

Push reminders need a real Expo push token, which requires:

- an EAS project id in `EXPO_PUBLIC_EAS_PROJECT_ID` (create one with `npx eas init`), and
- a development build or store build. Expo Go can receive pushes on Android but not reliably on
  iOS, so use `npx eas build --profile development` for iOS testing.

Flow inside the app:

1. After login, the app asks for notification permission and calls
   `Notifications.getExpoPushTokenAsync`.
2. It registers the token with `POST /devices` and caches it in secure storage.
3. The backend worker sends reminders to Expo's push API and stores the ticket, then checks the
   receipt after 15 minutes. Tokens reported as `DeviceNotRegistered` are removed automatically.
4. On logout the app calls `DELETE /devices` so the phone stops receiving reminders for that
   account.

If your Expo account has "enhanced push security" enabled, set `EXPO_ACCESS_TOKEN` in the root
`.env` so the worker can authenticate.

## Build and release

```bash
cd mobile
npx eas login
npx eas init                       # writes the project id into app.json
npx eas build --profile preview    # internal distribution build
npx eas build --profile production
npx eas submit --profile production
```

Profiles are defined in `eas.json`. Bundle identifiers are `com.orbyn.planner` on both platforms;
change them in `app.json` before publishing under your own organization.

## Type checking

```bash
npm run typecheck -w mobile
```
