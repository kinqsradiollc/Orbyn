import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  decodeSnapshot,
  encodeSnapshot,
  type PlannerSnapshot,
} from "@orbyn/core";

// Offline-first storage for the planner: the last data we loaded, kept on the
// device so the app opens straight to it and stays readable when the network
// is slow or gone. The encode/decode rules (versioning, staleness, shape
// checks) live in @orbyn/core and are unit-tested there.

const KEY = "orbyn-planner-cache";

/** The last saved snapshot, or null when there's none, it's stale, or corrupt. */
export async function loadCache(): Promise<PlannerSnapshot | null> {
  try {
    return decodeSnapshot(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Save the current planner data for next time. Best-effort; never throws. */
export async function saveCache(snapshot: PlannerSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, encodeSnapshot(snapshot));
  } catch {
    // A full or unavailable store just means no offline cache this time.
  }
}

/** Forget the cached data, e.g. on sign-out. */
export async function clearCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to do if the store is unavailable.
  }
}
