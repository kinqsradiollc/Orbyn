import { requireOptionalNativeModule } from "expo-modules-core";

// Capture from outside the app (CAP-05..07, CAP-09), the app's side. On
// Android the glance and the queue of ticks and captures live in the app's
// preferences, reached through this module; on iOS they live in the App
// Group, reached through @bacons/apple-targets' ExtensionStorage, and this
// module runs the focus session's Live Activity. requireOptionalNativeModule
// returns null where the module isn't built in (Expo Go, the web, CI), so
// every call here is safe anywhere and simply does nothing there.

type OrbynCaptureModule = {
  setGlance?: (json: string) => void;
  getPending?: () => string | null;
  setPending?: (json: string) => void;
  takeOpen?: () => string | null;
  startFocus: (title: string, endsAtMs: number) => void;
  updateFocus: (endsAtMs: number, paused: boolean) => void;
  endFocus: () => void;
};

const native = requireOptionalNativeModule<OrbynCaptureModule>("OrbynCapture");

const safely = <T>(run: () => T, fallback: T): T => {
  try {
    return run();
  } catch {
    return fallback;
  }
};

/** Android: hand the widget the glance. */
export const setAndroidGlance = (json: string) =>
  safely(() => native?.setGlance?.(json), undefined);

/** Android: the ticks and captures waiting to be sent, as stored. */
export const androidPending = (): string | null =>
  safely(() => native?.getPending?.() ?? null, null);

export const setAndroidPending = (json: string) =>
  safely(() => native?.setPending?.(json), undefined);

/** Android: a link a native action asked the app to open, once. */
export const takeAndroidOpen = (): string | null =>
  safely(() => native?.takeOpen?.() ?? null, null);

/** The focus session on the Lock Screen and in the Dynamic Island (iOS). */
export const startFocusActivity = (title: string, endsAt: Date) =>
  safely(() => native?.startFocus(title, endsAt.getTime()), undefined);

export const updateFocusActivity = (endsAt: Date, paused: boolean) =>
  safely(() => native?.updateFocus(endsAt.getTime(), paused), undefined);

export const endFocusActivity = () =>
  safely(() => native?.endFocus(), undefined);
