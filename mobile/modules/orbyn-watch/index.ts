import { requireOptionalNativeModule } from "expo-modules-core";

// Phone side of the Apple Watch bridge. The native module (ios/) sends the
// glance to the Watch over WatchConnectivity, because watchOS can't read the
// phone's App Group. requireOptionalNativeModule returns null when the native
// module isn't present (Expo Go, the Metro bundle in CI), so this is safe to
// import and call anywhere — it simply no-ops until a dev/prod build.

type OrbynWatchModule = { send: (glance: string) => void };

const native = requireOptionalNativeModule<OrbynWatchModule>("OrbynWatch");

/** True when a build actually has the native Watch bridge. */
export const hasWatchBridge = native != null;

/** Send the glance JSON to the Watch. iOS-only; never throws. */
export function sendGlanceToWatch(glanceJson: string): void {
  try {
    native?.send(glanceJson);
  } catch {
    // No bridge (Expo Go / CI) or a transient failure: the Watch keeps its last.
  }
}
