import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  decodeSnapshot,
  encodeSnapshot,
  type PlannerSnapshot,
} from "@orbyn/core";
import { session } from "./session";

// Offline-first storage for the planner: the last data we loaded, kept on the
// device so the app opens straight to it and stays readable when the network
// is slow or gone. The encode/decode rules live in @orbyn/core.

const KEY = "orbyn-planner-cache";
let writes = Promise.resolve();
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const result = writes.then(run);
  writes = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
type CacheLocks = {
  request<T>(name: string, run: () => Promise<T>): Promise<T>;
};
/** Web storage is shared by tabs; a module's queue alone cannot protect it.
 * Without Web Locks optional persistent caching is disabled: no shared-key
 * reads or writes, including clears/purges. Native keeps its existing queue. */
function cacheOperation<T>(run: () => Promise<T>, unavailable: T): Promise<T> {
  return serialize(() => {
    if (Platform.OS !== "web") return run();
    const locks = (globalThis as { navigator?: { locks?: CacheLocks } })
      .navigator?.locks;
    if (typeof locks?.request !== "function")
      return Promise.resolve(unavailable);
    // Default exclusive mode covers the complete read/modify/write transaction.
    return locks.request(KEY, run);
  });
}

/** The last saved snapshot, or null when there's none, it's stale, or corrupt. */
export async function loadCache(): Promise<PlannerSnapshot | null> {
  try {
    const read = async () => decodeSnapshot(await AsyncStorage.getItem(KEY));
    // Preserve native startup reads; web reads participate in origin ordering.
    return await (Platform.OS === "web" ? cacheOperation(read, null) : read());
  } catch {
    return null;
  }
}

/** Save the current planner data for next time. Best-effort; never throws. */
export async function saveCache(snapshot: PlannerSnapshot): Promise<void> {
  const generation = session.generation,
    owner = session.userId;
  try {
    await cacheOperation(async () => {
      // Recheck after acquiring both the module queue and any origin lock.
      if (
        generation !== session.generation ||
        !owner ||
        snapshot.user?.id !== owner ||
        session.userId !== owner
      )
        return;
      await AsyncStorage.setItem(KEY, encodeSnapshot(snapshot));
    }, undefined);
  } catch {
    // A full or unavailable store just means no offline cache this time.
  }
}

/** Forget the cached data, e.g. on sign-out. */
export async function clearCache(): Promise<void> {
  const generation = session.generation;
  try {
    await cacheOperation(async () => {
      if (generation === session.generation) await AsyncStorage.removeItem(KEY);
    }, undefined);
  } catch {
    // Nothing to do if the store is unavailable.
  }
}

/** Revoke the saved snapshot for this owner even if another account signs in
 * while the purge is queued. Serialized older writes cannot resurrect it. */
export async function purgeCacheTeams(ids: readonly string[]): Promise<void> {
  const owner = session.userId;
  if (!owner) return;
  const allowed = new Set(ids);
  try {
    await cacheOperation(async () => {
      const cached = decodeSnapshot(await AsyncStorage.getItem(KEY));
      if (cached?.user?.id !== owner) return;
      if (
        cached.items.some(
          (item) => item.team_id && !allowed.has(item.team_id),
        ) ||
        cached.teams.some((team) => !allowed.has(team.id))
      )
        await AsyncStorage.removeItem(KEY);
    }, undefined);
  } catch {
    throw new Error(
      "Unable to clear cached planner data after access changed.",
    );
  }
}
