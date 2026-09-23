import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";
import { buildGlance, type Item } from "@orbyn/core";
import { client } from "./api";
import { deviceTimeZone } from "./planning";
import { sendGlanceToWatch } from "../../modules/orbyn-watch";

// Hand the home-screen widget (and, later, the Watch) a compact "glance" of
// today through the shared App Group container. buildGlance is in @orbyn/core
// and unit-tested; here we just write it and ask iOS to refresh the widget.
// ExtensionStorage safely no-ops when there's no native module (Expo Go, the
// Metro bundle in CI), so this is always safe to call.

const APP_GROUP = "group.com.orbyn.planner";
const KEY = "glance";
const storage = new ExtensionStorage(APP_GROUP);

type Upcoming = { title: string; start_at: string; all_day: boolean };
/** Subscribed events for the next two days, read at most every 15 minutes. */
let upcoming: { at: number; events: Upcoming[] } = { at: 0, events: [] };
const UPCOMING_MS = 15 * 60_000;

async function subscribedSoon(): Promise<Upcoming[]> {
  if (Date.now() - upcoming.at < UPCOMING_MS) return upcoming.events;
  const from = new Date();
  const to = new Date(from.getTime() + 2 * 86_400_000);
  const cal = await client.calendar(from.toISOString(), to.toISOString());
  upcoming = { at: Date.now(), events: cal.external ?? [] };
  return upcoming.events;
}

/** Publish the current items as the widget glance. iOS only; never throws. */
export function publishGlance(items: Item[]): void {
  if (Platform.OS !== "ios") return;
  // Classes and shifts from subscribed calendars count as the next event too.
  void subscribedSoon()
    .catch(() => upcoming.events)
    .then((external) => write(items, external));
}

/** Signed out: forget the subscribed events and empty the widget. */
export function clearGlance(): void {
  upcoming = { at: 0, events: [] };
  if (Platform.OS === "ios") write([], []);
}

function write(items: Item[], external: Upcoming[]) {
  try {
    const glance = buildGlance(items, {
      timeZone: deviceTimeZone(),
      external,
    });
    const json = JSON.stringify(glance);
    storage.set(KEY, json);
    ExtensionStorage.reloadWidget();
    // Also push it to the Apple Watch (no-ops without the native bridge).
    sendGlanceToWatch(json);
  } catch {
    // No shared storage available: the widget keeps whatever it last had.
  }
}
