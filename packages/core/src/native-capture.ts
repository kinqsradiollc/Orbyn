/**
 * Capture from outside the app (CAP-05, CAP-06, CAP-07, CAP-09): widgets you
 * tick tasks from, Lock Screen and Control Center capture, Siri and
 * Shortcuts, and Android's widget and Quick Settings tile.
 *
 * The native side never holds the account's sign-in. A tick or a capture
 * made in a widget, a control or a Siri action waits in the app's shared
 * storage (an App Group on iOS, the app's own preferences on Android), and
 * the app sends it the next time it runs (it checks whenever it comes to
 * the front). The widget shows the change at once, from the same storage.
 * This file reads that queue back safely: anything malformed is dropped.
 */

/** Where a capture goes. */
export type CaptureTo = "inbox" | "agenda";

/** A task typed or said outside the app ("Add to Orbyn"). */
export type PendingCapture = {
  /** Unique per capture, so one sent twice is made once. */
  id: string;
  text: string;
  to: CaptureTo;
  at: string;
};

/** A task ticked in a widget. */
export type PendingTick = { item: string; at: string };

export type PendingQueue = { captures: PendingCapture[]; ticks: PendingTick[] };

/** The shared storage keys the native side and the app agree on. */
export const NATIVE_KEYS = {
  glance: "glance",
  pending: "pending",
} as const;

/** The most a queue holds, so a stuck app can't grow it without end. */
export const PENDING_MAX = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isoOrNow = (v: unknown) =>
  typeof v === "string" && !Number.isNaN(Date.parse(v))
    ? new Date(v).toISOString()
    : new Date(0).toISOString();

/** The queue as stored, read back: bad entries dropped, repeats made one. */
export function readPending(raw: string | null | undefined): PendingQueue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    return { captures: [], ticks: [] };
  }
  const obj = (parsed ?? {}) as { captures?: unknown; ticks?: unknown };
  const captures: PendingCapture[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(obj.captures) ? obj.captures : []) {
    const v = c as Partial<PendingCapture>;
    const text = typeof v.text === "string" ? v.text.trim().slice(0, 500) : "";
    const id = typeof v.id === "string" ? v.id.slice(0, 64) : "";
    if (!text || !id || seen.has(id)) continue;
    seen.add(id);
    captures.push({
      id,
      text,
      to: v.to === "agenda" ? "agenda" : "inbox",
      at: isoOrNow(v.at),
    });
  }
  const ticked = new Set<string>();
  const ticks: PendingTick[] = [];
  for (const t of Array.isArray(obj.ticks) ? obj.ticks : []) {
    const v = t as Partial<PendingTick>;
    const item = typeof v.item === "string" ? v.item.toLowerCase() : "";
    if (!UUID.test(item) || ticked.has(item)) continue;
    ticked.add(item);
    ticks.push({ item, at: isoOrNow(v.at) });
  }
  return {
    captures: captures.slice(-PENDING_MAX),
    ticks: ticks.slice(-PENDING_MAX),
  };
}

/** What's left after some were sent: the ones not sent yet stay. */
export function withoutSent(
  queue: PendingQueue,
  sent: { captures: string[]; ticks: string[] },
): PendingQueue {
  return {
    captures: queue.captures.filter((c) => !sent.captures.includes(c.id)),
    ticks: queue.ticks.filter((t) => !sent.ticks.includes(t.item)),
  };
}

/**
 * The Siri and Shortcuts actions (CAP-07), as the native App Intents name
 * them. A backend test checks the Swift file lists the same.
 */
export const SIRI_ACTIONS = [
  { id: "add-task", phrase: "Add to Orbyn" },
  { id: "add-agenda", phrase: "Add to today's agenda in Orbyn" },
  { id: "whats-next", phrase: "What's next in Orbyn" },
  { id: "start-focus", phrase: "Start focus in Orbyn" },
] as const;
