import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isOfflineError,
  mergeEdit,
  newId,
  type HabitInput,
  type Item,
  type ItemInput,
  type OutboxEntry,
  type OutboxOp,
} from "@orbyn/core";
import { client } from "./api";
import { errorText } from "./errors";

/**
 * Changes made on this phone, kept in order until the server has them.
 *
 * Every change tries the server first. With no connection it is queued
 * instead, shown at once as if it had happened, and sent when the signal is
 * back — in the order it was made, each with its own key, so a change that
 * is sent twice (the phone lost the answer) happens once.
 *
 * A change the server refuses stays in the queue as "needs you". An edit that
 * meets an edit made elsewhere keeps both when they touch different things,
 * and asks when they don't. Nothing is dropped without the person choosing.
 */
const KEY = "orbyn-outbox-v1";

type State = {
  entries: OutboxEntry[];
  /** When the queue was last found empty after a send: "in sync". */
  syncedAt: string | null;
  sending: boolean;
  /** The last send stopped for want of a connection. */
  offline: boolean;
};

let state: State = {
  entries: [],
  syncedAt: null,
  sending: false,
  offline: false,
};
const listeners = new Set<(s: State) => void>();
let loaded: Promise<void> | null = null;
/** Told after a send lands, so the lists re-read the server. */
let onSent: () => void = () => {};

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

function persist() {
  void AsyncStorage.setItem(KEY, JSON.stringify(state.entries)).catch(() => {});
}

/** Read the queue saved on the phone. Safe to call more than once. */
export function loadOutbox() {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      const saved = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
      if (Array.isArray(saved) && saved.length)
        set({ entries: [...saved, ...state.entries] });
    })
    .catch(() => {});
  return loaded;
}

export const outboxState = () => state;

export function subscribeOutbox(listener: (s: State) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A read failed for want of a connection: say so beside the queue. */
export function noteOffline() {
  if (!state.offline) set({ offline: true });
}

/** A read reached the server: online, and in sync if nothing is waiting. */
export function noteOnline() {
  set({
    offline: false,
    ...(state.entries.length ? {} : { syncedAt: new Date().toISOString() }),
  });
}

export function whenSent(listener: () => void) {
  onSent = listener;
}

/** Forget everything waiting: signing out, or starting over. */
export async function clearOutbox() {
  set({ entries: [], syncedAt: null, offline: false });
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

function enqueue(op: OutboxOp, key = newId()) {
  set({
    entries: [
      ...state.entries,
      {
        key,
        op,
        queued_at: new Date().toISOString(),
        attempts: 0,
        state: "pending",
      },
    ],
    offline: true,
  });
  persist();
}

/** The latest version of an item the server has, for a change made before it existed. */
async function currentVersion(id: string) {
  return (await client.getItem(id)).version;
}

/** Send one change, as the key it was queued with. */
async function perform(op: OutboxOp, key: string): Promise<unknown> {
  switch (op.type) {
    case "item.create":
      return client.once(key, () => client.createItem(op.input));
    case "item.update": {
      // Made before the server had the item: edit whatever it has now.
      const version = op.base.version || (await currentVersion(op.id));
      return client.once(key, () =>
        client.updateItem(op.id, { ...op.body, version }, op.scope ?? {}),
      );
    }
    case "item.delete": {
      const version = op.version || (await currentVersion(op.id));
      return client.once(key, () =>
        client.deleteItem(op.id, version, op.scope ?? {}),
      );
    }
    case "item.post":
      return client.once(key, () => client.postItemUpdate(op.id, op.body));
    case "habit.create":
      return client.once(key, () => client.createHabit(op.body));
    case "habit.update":
      return client.once(key, () => client.updateHabit(op.id, op.patch));
    case "habit.delete":
      return client.once(key, () => client.deleteHabit(op.id));
    case "booking.approve":
      return client.once(key, () => client.approveBooking(op.id));
    case "booking.decline":
      return client.once(key, () => client.declineBooking(op.id, op.reason));
    case "booking.cancel":
      return client.once(key, () =>
        client.cancelBookingAsHost(op.id, op.reason),
      );
    case "booking.reschedule":
      return client.once(key, () =>
        client.rescheduleBooking(op.id, op.start_at),
      );
    case "booking.note":
      return client.once(key, () => client.setBookingNote(op.id, op.note));
  }
}

const status = (e: unknown) => (e as { status?: number }).status;

/**
 * Do a change now, or queue it when there's no connection. Resolves with the
 * server's answer, or null when it was queued. Refusals still throw, as
 * they would without the queue.
 */
export async function run<T>(op: OutboxOp): Promise<T | null> {
  await loadOutbox();
  // Something is already waiting: this one waits behind it, to keep order.
  if (state.entries.length) {
    enqueue(op);
    void flush();
    return null;
  }
  const key = newId();
  try {
    const result = (await perform(op, key)) as T;
    set({ offline: false, syncedAt: new Date().toISOString() });
    return result;
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    enqueue(op, key);
    return null;
  }
}

let flushing: Promise<void> | null = null;
let wait = 5_000;
let retry: ReturnType<typeof setTimeout> | null = null;

/**
 * Send what's waiting, oldest first. Stops at the first change that can't go
 * (no connection, or one waiting for the person) so the order holds.
 */
export function flush(): Promise<void> {
  flushing ??= (async () => {
    await loadOutbox();
    set({ sending: true });
    let sent = false;
    try {
      while (state.entries.length) {
        const entry = state.entries[0];
        if (entry.state === "failed") break;
        try {
          await perform(entry.op, entry.key);
          set({ entries: state.entries.slice(1) });
          persist();
          sent = true;
        } catch (e) {
          if (isOfflineError(e) || (status(e) ?? 0) >= 500) {
            set({ offline: true });
            bump(entry, { attempts: entry.attempts + 1 });
            // Try again later, waiting longer each time up to five minutes.
            if (retry) clearTimeout(retry);
            retry = setTimeout(() => void flush(), wait);
            wait = Math.min(wait * 2, 300_000);
            return;
          }
          if (status(e) === 401) return;
          if (entry.op.type === "item.update" && status(e) === 409) {
            if (await settle(entry)) sent = true;
            continue;
          }
          // Gone already is as good as done for a delete.
          if (entry.op.type === "item.delete" && status(e) === 404) {
            set({ entries: state.entries.slice(1) });
            persist();
            continue;
          }
          bump(entry, {
            state: "failed",
            error: errorText(e),
          });
          break;
        }
      }
      wait = 5_000;
      if (sent || !state.entries.length)
        set({
          ...(sent ? { offline: false } : {}),
          ...(state.entries.length
            ? {}
            : { syncedAt: new Date().toISOString() }),
        });
    } finally {
      set({ sending: false });
      if (sent) onSent();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

function bump(entry: OutboxEntry, patch: Partial<OutboxEntry>) {
  set({
    entries: state.entries.map((e) =>
      e.key === entry.key ? { ...e, ...patch } : e,
    ),
  });
  persist();
}

/**
 * An edit made offline met a newer version. Merge what doesn't overlap and
 * send it; ask about what does. True when it went through.
 */
async function settle(entry: OutboxEntry): Promise<boolean> {
  if (entry.op.type !== "item.update") return false;
  const op = entry.op;
  try {
    const theirs = await client.getItem(op.id);
    const { body, conflicts } = mergeEdit(op.base, op.body, theirs);
    if (conflicts.length) {
      bump(entry, {
        state: "failed",
        error: "Changed on another device",
        conflict: { fields: conflicts, theirs },
      });
      return false;
    }
    await client.once(`${entry.key}-merged`, () =>
      client.updateItem(op.id, body, op.scope ?? {}),
    );
    set({ entries: state.entries.filter((e) => e.key !== entry.key) });
    persist();
    return true;
  } catch (e) {
    bump(entry, {
      state: "failed",
      error: errorText(e),
    });
    return false;
  }
}

/**
 * The person's choice for a change that needs them. "mine" sends it over
 * what's there now; "retry" tries it again as it was; "drop" lets it go.
 */
export async function resolve(key: string, choice: "mine" | "retry" | "drop") {
  const entry = state.entries.find((e) => e.key === key);
  if (!entry) return;
  if (choice === "drop") {
    set({ entries: state.entries.filter((e) => e.key !== key) });
    persist();
  } else if (
    choice === "mine" &&
    entry.op.type === "item.update" &&
    entry.conflict
  ) {
    const theirs = entry.conflict.theirs;
    bump(entry, {
      key: `${entry.key}-mine`,
      state: "pending",
      error: undefined,
      conflict: undefined,
      op: {
        ...entry.op,
        base: theirs,
        body: { ...entry.op.body, version: theirs.version },
      },
    });
  } else
    bump(entry, {
      key: `${entry.key}-r${entry.attempts + 1}`,
      state: "pending",
      error: undefined,
    });
  await flush();
}

// ---- the changes the app makes --------------------------------------------

/** Create an item, named here so later changes can point at it offline. */
export const createItem = (input: Partial<ItemInput> & { title: string }) =>
  run<Item>({ type: "item.create", input: { ...input, id: newId() } });

export const updateItem = (
  base: Item,
  body: ItemInput & { version: number },
  scope?: { scope: "this" | "following" | "all"; occurrence?: string },
) => run<Item>({ type: "item.update", id: base.id, base, body, scope });

export const deleteItem = (
  item: Item,
  scope?: { scope: "this" | "following" | "all"; occurrence?: string },
) =>
  run<void>({
    type: "item.delete",
    id: item.id,
    version: item.version,
    title: item.title,
    scope,
  });

export const postItemUpdate = (
  item: Pick<Item, "id" | "title">,
  body: { status?: Item["status"]; progress?: number; body?: string },
) => run({ type: "item.post", id: item.id, title: item.title, body });

export const createHabit = (body: HabitInput) =>
  run({ type: "habit.create", body });
export const updateHabit = (
  id: string,
  name: string,
  patch: Partial<HabitInput>,
) => run({ type: "habit.update", id, name, patch });
export const deleteHabit = (id: string, name: string) =>
  run({ type: "habit.delete", id, name });

export const approveBooking = (id: string, who: string) =>
  run({ type: "booking.approve", id, who });
export const declineBooking = (id: string, who: string, reason: string) =>
  run({ type: "booking.decline", id, who, reason });
export const cancelBooking = (id: string, who: string, reason: string) =>
  run({ type: "booking.cancel", id, who, reason });
export const rescheduleBooking = (id: string, who: string, startAt: string) =>
  run({ type: "booking.reschedule", id, who, start_at: startAt });
export const setBookingNote = (id: string, who: string, note: string) =>
  run({ type: "booking.note", id, who, note });
