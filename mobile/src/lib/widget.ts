import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";
import {
  buildGlance,
  NATIVE_KEYS,
  readPending,
  withoutSent,
  type Item,
  type PendingQueue,
} from "@orbyn/core";
import { client } from "./api";
import { deviceTimeZone } from "./planning";
import { sendGlanceToWatch } from "../../modules/orbyn-watch";
import {
  androidPending,
  setAndroidGlance,
  setAndroidPending,
  takeAndroidOpen,
} from "../../modules/orbyn-capture";

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

/** List names, so a widget can be set to one list (CAP-06). */
let listNames: { id: string; name: string }[] = [];
export function setGlanceNames(lists: { id: string; name: string }[]) {
  listNames = lists.map(({ id, name }) => ({ id, name }));
}

/** Publish the current items as the widget glance. Never throws. */
export function publishGlance(items: Item[]): void {
  if (Platform.OS === "android") {
    try {
      setAndroidGlance(
        JSON.stringify(
          buildGlance(items, { timeZone: deviceTimeZone(), lists: listNames }),
        ),
      );
    } catch {
      // No widget module in this build.
    }
    return;
  }
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
      lists: listNames,
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

// ------------------------------------------- ticks and captures waiting ---

/** The queue widgets, controls, Siri and the tile left for the app. */
function pendingNow(): PendingQueue {
  if (Platform.OS === "ios")
    return readPending(storage.get(NATIVE_KEYS.pending));
  if (Platform.OS === "android") return readPending(androidPending());
  return { captures: [], ticks: [] };
}

function savePending(queue: PendingQueue) {
  const json = JSON.stringify(queue);
  if (Platform.OS === "ios") {
    if (queue.captures.length || queue.ticks.length)
      storage.set(NATIVE_KEYS.pending, json);
    else storage.remove(NATIVE_KEYS.pending);
  } else if (Platform.OS === "android") setAndroidPending(json);
}

/**
 * Send what was ticked in a widget or said to Siri while the app was away
 * (CAP-05..07, CAP-09): each tick as the task done, each capture as a task
 * (or a line on today's agenda). What can't be sent yet stays for next
 * time; a task that's gone or no longer yours is dropped. Returns how many
 * went, so the app can refresh when any did. Never throws.
 */
export async function flushPending(): Promise<number> {
  let queue: PendingQueue;
  try {
    queue = pendingNow();
  } catch {
    return 0;
  }
  if (!queue.captures.length && !queue.ticks.length) return 0;
  const sent = { captures: [] as string[], ticks: [] as string[] };
  const zone = deviceTimeZone();
  for (const c of queue.captures) {
    try {
      if (c.to === "agenda")
        await client.capture({
          text: c.text,
          to: { kind: "agenda" },
          timezone: zone,
        });
      else await client.quickAdd(c.text, zone);
      sent.captures.push(c.id);
    } catch (e) {
      // Offline: try again next time. Refused for good: drop it.
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500) sent.captures.push(c.id);
    }
  }
  for (const t of queue.ticks) {
    try {
      await client.postItemUpdate(t.item, { status: "done" });
      sent.ticks.push(t.item);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500) sent.ticks.push(t.item);
    }
  }
  try {
    // Read again: a tick made while these were sending stays.
    savePending(withoutSent(pendingNow(), sent));
  } catch {
    // Nothing to write to.
  }
  return sent.captures.length + sent.ticks.length;
}

/** A link a Siri action or the tile asked the app to open, once. */
export function takeNativeOpen(): string | null {
  try {
    if (Platform.OS === "ios") {
      const link = storage.get("open");
      if (link) storage.remove("open");
      return link;
    }
    if (Platform.OS === "android") return takeAndroidOpen();
  } catch {
    // No shared storage in this build.
  }
  return null;
}
