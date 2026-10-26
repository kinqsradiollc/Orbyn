import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  decodeSnapshot,
  encodeSnapshot,
  type PlannerSnapshot,
} from "@orbyn/core";
import { session } from "./session";

// Offline-first storage for the planner: the last data we loaded, kept on the
// device so the app opens straight to it and stays readable when the network
// is slow or gone. The encode/decode rules (versioning, staleness, shape
// checks) live in @orbyn/core and are unit-tested there.

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
  const generation = session.generation,
    owner = session.userId;
  try {
    await serialize(async () => {
      if (
        generation !== session.generation ||
        !owner ||
        snapshot.user?.id !== owner ||
        session.userId !== owner
      )
        return;
      await AsyncStorage.setItem(KEY, encodeSnapshot(snapshot));
    });
  } catch {
    // A full or unavailable store just means no offline cache this time.
  }
}

/** Forget the cached data, e.g. on sign-out. */
export async function clearCache(): Promise<void> {
  const generation = session.generation;
  try {
    await serialize(async () => {
      if (generation === session.generation) await AsyncStorage.removeItem(KEY);
    });
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
  await serialize(async () => {
    try {
      const cached = decodeSnapshot(await AsyncStorage.getItem(KEY));
      if (cached?.user?.id !== owner) return;
      if (
        cached.items.some(
          (item) => item.team_id && !allowed.has(item.team_id),
        ) ||
        cached.teams.some((team) => !allowed.has(team.id))
      )
        await AsyncStorage.removeItem(KEY);
    } catch {
      throw new Error(
        "Unable to clear cached planner data after access changed.",
      );
    }
  });
}
