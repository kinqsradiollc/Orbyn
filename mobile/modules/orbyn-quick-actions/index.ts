import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

// The app icon's quick actions, as the orbyn:// links they open. On iOS the
// native module (ios/) passes on the one chosen; on Android each quick
// action is an app shortcut that opens its link directly, so it arrives
// through Linking like any other link. requireOptionalNativeModule returns
// null where the native module isn't built in (Android, the web, Expo Go,
// CI), so this is safe to import and call anywhere — it simply finds
// nothing until a build that has it.

declare class OrbynQuickActionsModule extends NativeModule<{
  onQuickAction: (event: { url: string }) => void;
}> {
  takeInitial(): string | null;
}

const native =
  requireOptionalNativeModule<OrbynQuickActionsModule>("OrbynQuickActions");

/** The quick action that opened the app, once; null when there was none. */
export function takeInitialQuickAction(): string | null {
  try {
    return native?.takeInitial() ?? null;
  } catch {
    return null;
  }
}

/** Hear about each quick action chosen while the app runs. */
export function onQuickAction(listener: (url: string) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener("onQuickAction", (e) => listener(e.url));
  return () => sub.remove();
}
