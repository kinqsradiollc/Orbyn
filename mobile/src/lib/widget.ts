import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";
import { buildGlance, type Item } from "@orbyn/core";
import { deviceTimeZone } from "./planning";

// Hand the home-screen widget (and, later, the Watch) a compact "glance" of
// today through the shared App Group container. buildGlance is in @orbyn/core
// and unit-tested; here we just write it and ask iOS to refresh the widget.
// ExtensionStorage safely no-ops when there's no native module (Expo Go, the
// Metro bundle in CI), so this is always safe to call.

const APP_GROUP = "group.com.orbyn.planner";
const KEY = "glance";
const storage = new ExtensionStorage(APP_GROUP);

/** Publish the current items as the widget glance. iOS only; never throws. */
export function publishGlance(items: Item[]): void {
  if (Platform.OS !== "ios") return;
  try {
    const glance = buildGlance(items, { timeZone: deviceTimeZone() });
    storage.set(KEY, JSON.stringify(glance));
    ExtensionStorage.reloadWidget();
  } catch {
    // No shared storage available: the widget keeps whatever it last had.
  }
}
