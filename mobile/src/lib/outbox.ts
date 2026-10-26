import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isOfflineError,
  mergeEdit,
  newId,
  queueChange,
  resolvePageSave,
  waitingPageSave,
  type Doc,
  type PageSave,
  type Habit,
  type HabitInput,
  type Item,
  type ItemDetail,
  type ItemInput,
  type OutboxEntry,
  type OwnedOutboxEntry,
  type OutboxOp,
} from "@orbyn/core";
import { OrbynClient } from "@orbyn/api-client";
import { client } from "./api";
import { session, subscribeSession } from "./session";
import { errorText } from "./errors";
import { rememberPage } from "./pageCache";

/**
 * Changes made on this phone, kept in order until the server has them.
 *
 * Every change is saved for its account before trying the server. With no
 * connection it stays queued, shown as if it had happened, and sent when the signal is
 * back — in the order it was made, each with its own key, so a change that
 * is sent twice (the phone lost the answer) happens once.
 *
 * A change the server refuses stays in the queue as "needs you". An edit that
 * meets an edit made elsewhere keeps both when they touch different things,
 * and asks when they don't. Nothing is dropped without the person choosing.
 */
const KEY = "orbyn-outbox-v2";
const LEGACY_KEY = "orbyn-outbox-v1";
type Recovery = { raw: string; reason: string };
type Saved = { version: 2; entries: OwnedOutboxEntry[]; recovery: Recovery[] };
type State = {
  entries: OutboxEntry[];
  syncedAt: string | null;
  sending: boolean;
  offline: boolean;
  recovery: { count: number; reason: string } | null;
  storageError: string | null;
};
let state: State = {
  entries: [],
  syncedAt: null,
  sending: false,
  offline: false,
  recovery: null,
  storageError: null,
};
let saved: Saved | null = null;
let loaded: Promise<void> | null = null;
let generation = 0;
let writeTail: Promise<void> = Promise.resolve();
const listeners = new Set<(s: State) => void>();
let onSent: () => void = () => {};
const changed = () => new Error("The account changed. Reopen this view.");

function set(patch: Partial<State> = {}) {
  state = {
    ...state,
    ...patch,
    entries: (saved?.entries ?? []).filter(
      (entry) => !!session.token && entry.owner_id === session.userId,
    ),
  };
  for (const listener of listeners) listener(state);
}
let recoverySignature = "";
function recoveryState() {
  const count =
    saved?.recovery.reduce((n, entry) => {
      try {
        const value: unknown = JSON.parse(entry.raw);
        return n + (Array.isArray(value) ? value.length : 1);
      } catch {
        return n + 1;
      }
    }, 0) ?? 0;
  const reason =
    "These saved changes have no verified account. They will not sync automatically.";
  if (!count) return null;
  const signature = JSON.stringify(saved?.recovery ?? []);
  if (state.recovery && signature === recoverySignature) return state.recovery;
  recoverySignature = signature;
  return { count, reason };
}
function storageFailure(error: unknown) {
  set({
    storageError: "Couldn't save changes on this device. Retry before leaving.",
    sending: false,
  });
  return error;
}
function persistStrict() {
  if (!saved)
    return Promise.reject(new Error("Saved changes have not loaded."));
  const snapshot = JSON.stringify(saved);
  const work = writeTail.then(() => AsyncStorage.setItem(KEY, snapshot));
  writeTail = work.catch(() => {});
  return work.then(
    () => set({ storageError: null }),
    (error: unknown) => {
      throw storageFailure(error);
    },
  );
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && !!value;
function validEntry(value: unknown): value is OwnedOutboxEntry {
  if (
    !object(value) ||
    !text(value.owner_id) ||
    !text(value.key) ||
    !text(value.queued_at) ||
    !Number.isFinite(Date.parse(value.queued_at)) ||
    !Number.isSafeInteger(value.attempts) ||
    Number(value.attempts) < 0 ||
    !["pending", "failed"].includes(String(value.state)) ||
    !object(value.op)
  )
    return false;
  if (
    value.delivery !== undefined &&
    (!object(value.delivery) ||
      typeof value.delivery.credential_hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.delivery.credential_hash) ||
      !text(value.delivery.started_at) ||
      !Number.isFinite(Date.parse(value.delivery.started_at)))
  )
    return false;
  if (value.uncertain !== undefined && typeof value.uncertain !== "boolean")
    return false;
  if (value.error !== undefined && typeof value.error !== "string")
    return false;
  if (
    value.conflict !== undefined &&
    (!object(value.conflict) ||
      !Array.isArray(value.conflict.fields) ||
      !value.conflict.fields.every(text) ||
      !object(value.conflict.theirs) ||
      !text(value.conflict.theirs.id) ||
      typeof value.conflict.theirs.version !== "number" ||
      typeof value.conflict.theirs.title !== "string")
  )
    return false;
  const op = value.op;
  switch (op.type) {
    case "item.create":
      return object(op.input) && typeof op.input.title === "string";
    case "item.update":
      return (
        text(op.id) &&
        object(op.base) &&
        typeof op.base.version === "number" &&
        object(op.body)
      );
    case "item.delete":
      return text(op.id) && typeof op.version === "number";
    case "item.post":
      return text(op.id) && object(op.body);
    case "habit.create":
      return object(op.body);
    case "habit.update":
      return text(op.id) && object(op.patch);
    case "habit.delete":
    case "booking.approve":
      return text(op.id);
    case "booking.decline":
    case "booking.cancel":
      return text(op.id) && typeof op.reason === "string";
    case "booking.reschedule":
      return text(op.id) && text(op.start_at);
    case "booking.note":
      return text(op.id) && typeof op.note === "string";
    case "doc.save":
      return (
        object(op.save) &&
        text(op.save.id) &&
        typeof op.save.title === "string" &&
        Array.isArray(op.save.content) &&
        object(op.save.base) &&
        typeof op.save.base.version === "number" &&
        Array.isArray(op.save.base.content)
      );
    default:
      return false;
  }
}
function decode(raw: string | null): Saved {
  const empty: Saved = { version: 2, entries: [], recovery: [] };
  if (!raw) return empty;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  // Never downgrade or overwrite a format this binary does not understand.
  if (object(value) && value.version !== undefined && value.version !== 2)
    throw new Error("These saved changes need a newer version of Orbyn.");
  if (
    object(value) &&
    value.version === 2 &&
    Array.isArray(value.entries) &&
    value.entries.every(validEntry) &&
    Array.isArray(value.recovery) &&
    value.recovery.every(
      (r: unknown) =>
        object(r) && typeof r.raw === "string" && typeof r.reason === "string",
    ) &&
    new Set(
      value.entries.map(
        (entry: OwnedOutboxEntry) => `${entry.owner_id}:${entry.key}`,
      ),
    ).size === value.entries.length
  )
    return value as Saved;
  return {
    ...empty,
    recovery: [{ raw, reason: "Unrecognized saved changes" }],
  };
}

/** Load all owners, exposing only the current account's commands. Fail closed on storage errors. */
export function loadOutbox(): Promise<void> {
  if (loaded) return loaded;
  loaded = (async () => {
    // In-memory changes whose last write failed must be saved, never replaced by an older disk copy.
    if (saved) {
      await persistStrict();
      return;
    }
    const raw = await AsyncStorage.getItem(KEY);
    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    const next = decode(raw);
    const marker = JSON.stringify({ migrated: 2 });
    if (
      legacy &&
      legacy !== marker &&
      legacy !== "[]" &&
      !next.recovery.some((entry) => entry.raw === legacy)
    )
      next.recovery.push({ raw: legacy, reason: "Account unknown" });
    // Persist the full recovery copy BEFORE replacing the old reader's array.
    await writeTail;
    const snapshot = JSON.stringify(next);
    await AsyncStorage.setItem(KEY, snapshot);
    if ((await AsyncStorage.getItem(KEY)) !== snapshot)
      throw new Error("Could not verify the saved recovery copy. Retry sync.");
    await AsyncStorage.setItem(LEGACY_KEY, marker);
    saved = next;
    set({ recovery: recoveryState(), storageError: null });
  })().catch((error: unknown) => {
    loaded = null;
    set({
      storageError:
        error instanceof Error ? error.message : "Couldn't read saved changes.",
    });
    throw error;
  });
  return loaded;
}
export const outboxState = () => state;
export function subscribeOutbox(listener: (s: State) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function noteOffline() {
  set({ offline: true });
}
export function noteOnline() {
  set({
    offline: false,
    ...(state.entries.length ? {} : { syncedAt: new Date().toISOString() }),
  });
}
export function whenSent(listener: () => void) {
  onSent = listener;
}

/** Explicit discard affects this account only; sign-out retains its pending work. */
export async function clearOutbox() {
  const owner = capture();
  await loadOutbox();
  assertCurrent(owner);
  generation++;
  cancelRetry();
  saved!.entries = saved!.entries.filter(
    (entry) => entry.owner_id !== owner.userId,
  );
  set({ syncedAt: null, offline: false, sending: false });
  await persistStrict();
}
export async function recoveryCopy() {
  await loadOutbox();
  return JSON.stringify(saved!.recovery, null, 2);
}
export async function discardRecovery() {
  const owner = capture();
  await loadOutbox();
  assertCurrent(owner);
  const previous = saved!.recovery;
  saved!.recovery = [];
  try {
    await persistStrict();
    set({ recovery: null });
  } catch (error) {
    saved!.recovery = previous;
    set({ recovery: recoveryState() });
    throw error;
  }
}

type Owner = {
  token: string;
  userId: string;
  sessionGeneration: number;
  generation: number;
};
function capture(): Owner {
  if (!session.token || !session.userId)
    throw new Error("Sign in to sync changes for this account.");
  return {
    token: session.token,
    userId: session.userId,
    sessionGeneration: session.generation,
    generation,
  };
}
function current(owner: Owner) {
  return (
    owner.token === session.token &&
    owner.userId === session.userId &&
    owner.sessionGeneration === session.generation &&
    owner.generation === generation
  );
}
function assertCurrent(owner: Owner) {
  if (!current(owner)) throw changed();
}
class UncertainDeliveryError extends Error {}
class PendingDeliveryError extends Error {
  status = 503;
}
const RECEIPT_WINDOW_MS = 23 * 60 * 60_000;
async function sealDelivery(key: string, owner: Owner) {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    owner.token,
  );
  assertCurrent(owner);
  const entry = saved!.entries.find(
    (e) => e.owner_id === owner.userId && e.key === key,
  );
  if (!entry) throw changed();
  if (entry.delivery) {
    const age = Date.now() - Date.parse(entry.delivery.started_at);
    if (
      entry.delivery.credential_hash !== hash ||
      age < 0 ||
      age >= RECEIPT_WINDOW_MS
    )
      throw new UncertainDeliveryError(
        "This change may already be saved. Check the result before retrying.",
      );
    // A prior seal write may have failed. The SDK may retry its transport;
    // an in-memory marker is never a durable receipt to start a network call.
    await persistStrict();
  } else {
    await bump(
      entry,
      {
        delivery: {
          credential_hash: hash,
          started_at: new Date().toISOString(),
        },
      },
      owner,
    );
  }
  assertCurrent(owner);
}
function ownedClient(owner: Owner, key: string) {
  return new OrbynClient({
    baseUrl: client.baseUrl,
    getToken: () => {
      assertCurrent(owner);
      return owner.token;
    },
    // The transport may retry after awaiting. Fence the actual network call too.
    fetch: async (...args) => {
      assertCurrent(owner);
      const write = !!args[1]?.method && args[1].method !== "GET";
      if (write) {
        await sealDelivery(key, owner);
        client.noteExternalMutation();
      }
      const response = await fetch(...args);
      if (
        write &&
        current(owner) &&
        response.status >= 400 &&
        response.status < 500
      ) {
        if (response.status === 409) {
          const body = await response
            .clone()
            .json()
            .catch(() => null);
          assertCurrent(owner);
          if (
            body?.message === "That change is still being made. Try again soon."
          )
            throw new PendingDeliveryError(body.message);
        }
        // A definite rejection can be attempted after reauthentication. An
        // unknown/network outcome keeps its original credential namespace.
        const entry = saved!.entries.find(
          (e) => e.owner_id === owner.userId && e.key === key,
        );
        if (entry) await bump(entry, { delivery: undefined }, owner);
      }
      return response;
    },
  });
}
async function enqueue(op: OutboxOp, owner: Owner, key = newId()) {
  assertCurrent(owner);
  const entries = queueChange(
    state.entries,
    {
      key,
      op,
      queued_at: new Date().toISOString(),
      attempts: 0,
      state: "pending",
    },
    new Set(
      [...reservations, ...inFlight.values()]
        .filter((v) => v.owner.userId === owner.userId)
        .map((v) => v.key),
    ),
  ).map((entry) => ({ ...entry, owner_id: owner.userId }));
  saved!.entries = [
    ...saved!.entries.filter((entry) => entry.owner_id !== owner.userId),
    ...entries,
  ];
  set();
  await persistStrict();
  assertCurrent(owner);
  return key;
}
function remove(entry: Pick<OutboxEntry, "key">, owner: Owner) {
  assertCurrent(owner);
  saved!.entries = saved!.entries.filter(
    (e) => !(e.owner_id === owner.userId && e.key === entry.key),
  );
  set();
}
/** A creation receipt supplies the exact causal version, never a freshly fetched one. */
function acknowledge(entry: OutboxEntry, owner: Owner, result: unknown) {
  assertCurrent(owner);
  if (
    entry.op.type === "item.create" &&
    object(result) &&
    text(result.id) &&
    typeof result.version === "number" &&
    Number.isSafeInteger(result.version) &&
    result.version > 0
  ) {
    const created = result as unknown as Item;
    if (entry.op.input.id && created.id !== entry.op.input.id)
      throw new Error(
        "The server returned another task. Review this change before retrying.",
      );
    saved!.entries = saved!.entries.map((pending) => {
      if (pending.owner_id !== owner.userId || pending.delivery) return pending;
      if (
        pending.op.type === "item.update" &&
        pending.op.id === created.id &&
        pending.op.base.version === 0
      )
        return {
          ...pending,
          op: {
            ...pending.op,
            base: { ...pending.op.base, ...created },
            body: { ...pending.op.body, version: created.version },
          },
        };
      if (
        pending.op.type === "item.delete" &&
        pending.op.id === created.id &&
        pending.op.version === 0
      )
        return { ...pending, op: { ...pending.op, version: created.version } };
      return pending;
    });
  }
  remove(entry, owner);
}

async function bump(
  entry: OutboxEntry,
  patch: Partial<OutboxEntry>,
  owner: Owner,
) {
  assertCurrent(owner);
  saved!.entries = saved!.entries.map((e) =>
    e.owner_id === owner.userId && e.key === entry.key ? { ...e, ...patch } : e,
  );
  set();
  await persistStrict();
  assertCurrent(owner);
}

/** The latest version of an item the server has, for a change made before it existed. */
async function currentVersion(id: string, client: OrbynClient) {
  return (await client.getItem(id)).version;
}

/** Send one change, as the key it was queued with. */
async function sendCommand(
  op: OutboxOp,
  key: string,
  owner: Owner,
): Promise<unknown> {
  assertCurrent(owner);
  const client = ownedClient(owner, key);
  switch (op.type) {
    case "item.create":
      return client.once(key, () => client.createItem(op.input));
    case "item.update": {
      if (
        !op.base.version &&
        (Object.hasOwn(op.body, "project_id") ||
          Object.hasOwn(op.body, "stage_id"))
      )
        throw new Error(
          "This task has no confirmed creation version. Review and discard this pending change, then reopen the task before reapplying its placement.",
        );
      // Made before the server had the item: edit whatever it has now.
      const version = op.base.version || (await currentVersion(op.id, client));
      return client.once(key, () =>
        client.updateItem(op.id, { ...op.body, version }, op.scope ?? {}),
      );
    }
    case "item.delete": {
      const version = op.version || (await currentVersion(op.id, client));
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
    case "doc.save": {
      // Read current authority before replay; complete-format edits retain
      // their nested owner while legacy edits keep their existing merge path.
      const now = op.save.document
        ? await client.getDocForEditor(op.save.id)
        : await client.getDoc(op.save.id);
      const next = resolvePageSave(op.save, now);
      const saved = await client.once(key, () =>
        next.document
          ? client.updateDocForEditor(
              op.save.id,
              {
                title: next.title,
                document: next.document,
                version: next.version,
              },
              { ticksFrom: op.save.base.version },
            )
          : client.updateDoc(op.save.id, {
              title: next.title,
              content: next.content,
              version: next.version,
            }),
      );
      assertCurrent(owner);
      void rememberPage(saved);
      return saved;
    }
  }
}

// A direct mutation and a background flush may meet the same durable command.
// Share that request within the session, and never coalesce new edits into it.
const reservations = new Set<{ owner: Owner; key: string }>();
const inFlight = new Map<
  string,
  { owner: Owner; key: string; result: Promise<unknown> }
>();
function perform(op: OutboxOp, key: string, owner: Owner) {
  assertCurrent(owner);
  const id = `${owner.sessionGeneration}:${owner.generation}:${owner.userId}:${key}`;
  const existing = inFlight.get(id);
  if (existing) return existing.result;
  const result = sendCommand(op, key, owner)
    .then((value) => {
      if (current(owner)) client.noteExternalMutation();
      return value;
    })
    .finally(() => {
      inFlight.delete(id);
    });
  inFlight.set(id, { owner, key, result });
  return result;
}

const status = (e: unknown) => (e as { status?: number }).status;

/**
 * Do a change now, or queue it when there's no connection. Resolves with the
 * server's answer, or null when it was queued. Refusals still throw, as
 * they would without the queue.
 */
export async function run<T>(op: OutboxOp): Promise<T | null> {
  op = JSON.parse(JSON.stringify(op)) as OutboxOp;
  const owner = capture();
  await loadOutbox();
  assertCurrent(owner);
  const waiting = state.entries.length > 0;
  const reservation = waiting ? null : { owner, key: newId() };
  if (reservation) reservations.add(reservation);
  try {
    const key = await enqueue(op, owner, reservation?.key);
    if (waiting) {
      void flush().catch(() => {});
      return null;
    }
    const entry: OutboxEntry = {
      key,
      op,
      queued_at: new Date().toISOString(),
      attempts: 0,
      state: "pending",
    };
    try {
      const result = (await perform(op, key, owner)) as T;
      assertCurrent(owner);
      acknowledge(entry, owner, result);
      await persistStrict();
      assertCurrent(owner);
      set({ offline: false, syncedAt: new Date().toISOString() });
      return result;
    } catch (error) {
      if (!current(owner)) throw changed();
      if (isOfflineError(error) || (status(error) ?? 0) >= 500) {
        set({ offline: true });
        return null;
      }
      if (status(error) === 401) {
        pause(owner);
        throw error;
      }
      await bump(
        entry,
        {
          state: "failed",
          error: errorText(error),
          uncertain: error instanceof UncertainDeliveryError,
        },
        owner,
      );
      throw error;
    }
  } finally {
    if (reservation) reservations.delete(reservation);
  }
}

let flushing: { owner: Owner; work: Promise<void> } | null = null;
let wait = 5_000;
let retry: ReturnType<typeof setTimeout> | null = null;
let pausedGeneration: number | null = null;
function cancelRetry() {
  if (retry) clearTimeout(retry);
  retry = null;
  wait = 5_000;
}
function pause(owner: Owner) {
  if (current(owner)) {
    pausedGeneration = session.generation;
    cancelRetry();
  }
}
subscribeSession(() => {
  generation++;
  cancelRetry();
  pausedGeneration = null;
  set({ sending: false, syncedAt: null, offline: false });
});

/** One flush per session; a stale flush may finish but cannot change the new session's queue. */
export function flush(): Promise<void> {
  if (
    !session.token ||
    !session.userId ||
    pausedGeneration === session.generation
  )
    return Promise.resolve();
  if (flushing && current(flushing.owner)) return flushing.work;
  const owner = capture();
  const work = (async () => {
    await loadOutbox();
    assertCurrent(owner);
    await persistStrict();
    assertCurrent(owner);
    set({ sending: true });
    let sent = false;
    try {
      while (state.entries.length) {
        assertCurrent(owner);
        const entry = state.entries[0];
        if (entry.state === "failed") break;
        const reservation = { owner, key: entry.key };
        reservations.add(reservation);
        try {
          await persistStrict();
          assertCurrent(owner);
          const result = await perform(entry.op, entry.key, owner);
          assertCurrent(owner);
          acknowledge(entry, owner, result);
          await persistStrict();
          sent = true;
        } catch (error) {
          if (!current(owner)) return;
          if (isOfflineError(error) || (status(error) ?? 0) >= 500) {
            set({ offline: true });
            await bump(entry, { attempts: entry.attempts + 1 }, owner);
            retry = setTimeout(() => {
              if (current(owner)) void flush().catch(() => {});
            }, wait);
            wait = Math.min(wait * 2, 300_000);
            return;
          }
          if (status(error) === 401) {
            pause(owner);
            return;
          }
          if (
            entry.op.type === "doc.save" &&
            status(error) === 409 &&
            entry.attempts < 3
          ) {
            const attempts = entry.attempts + 1;
            await bump(
              entry,
              {
                attempts,
                delivery: undefined,
                key: `${entry.key.replace(/-m\d+$/, "")}-m${attempts}`,
              },
              owner,
            );
            continue;
          }
          if (entry.op.type === "item.update" && status(error) === 409) {
            if (await settle(entry, owner)) sent = true;
            if (pausedGeneration === owner.sessionGeneration) return;
            continue;
          }
          if (entry.op.type === "item.delete" && status(error) === 404) {
            remove(entry, owner);
            await persistStrict();
            continue;
          }
          await bump(
            entry,
            {
              state: "failed",
              error: errorText(error),
              uncertain: error instanceof UncertainDeliveryError,
            },
            owner,
          );
          break;
        } finally {
          reservations.delete(reservation);
        }
      }
      assertCurrent(owner);
      wait = 5_000;
      if (sent || !state.entries.length)
        set({
          ...(sent ? { offline: false } : {}),
          ...(state.entries.length
            ? {}
            : { syncedAt: new Date().toISOString() }),
        });
    } finally {
      if (current(owner)) {
        set({ sending: false });
        if (sent) onSent();
      }
    }
  })().catch((error: unknown) => {
    if (current(owner)) throw error;
  });
  const active = {
    owner,
    work: work.finally(() => {
      if (flushing === active) flushing = null;
    }),
  };
  flushing = active;
  return active.work;
}

/**
 * An edit made offline met a newer version. Merge what doesn't overlap and
 * send it; ask about what does. True when it went through.
 */
async function settle(entry: OutboxEntry, owner: Owner): Promise<boolean> {
  const client = ownedClient(owner, entry.key);
  if (entry.op.type !== "item.update") return false;
  const op = entry.op;
  try {
    const theirs = await client.getItem(op.id);
    assertCurrent(owner);
    const { body, conflicts } = mergeEdit(op.base, op.body, theirs);
    if (conflicts.length) {
      await bump(
        entry,
        {
          state: "failed",
          error: "Changed on another device",
          conflict: { fields: conflicts, theirs },
        },
        owner,
      );
      return false;
    }
    await client.once(`${entry.key}-merged`, () =>
      client.updateItem(op.id, body, op.scope ?? {}),
    );
    remove(entry, owner);
    await persistStrict();
    return true;
  } catch (e) {
    if (!current(owner)) return false;
    if (status(e) === 401) {
      pause(owner);
      return false;
    }
    await bump(
      entry,
      {
        state: "failed",
        error: errorText(e),
        uncertain:
          e instanceof UncertainDeliveryError ||
          !!saved!.entries.find(
            (pending) =>
              pending.owner_id === owner.userId && pending.key === entry.key,
          )?.delivery,
      },
      owner,
    );
    return false;
  }
}

/**
 * The person's choice for a change that needs them. "mine" sends it over
 * what's there now; "retry" tries it again as it was; "drop" lets it go.
 */
export async function resolve(
  key: string,
  choice: "mine" | "retry" | "drop",
  binding = { userId: session.userId, generation: session.generation },
) {
  const owner = capture();
  if (
    binding.userId !== owner.userId ||
    binding.generation !== owner.sessionGeneration
  )
    throw changed();
  await loadOutbox();
  assertCurrent(owner);
  const entry = state.entries.find((e) => e.key === key);
  if (!entry) return;
  if (choice === "drop") {
    remove(entry, owner);
    // An already accepted request may complete; its response cannot undo this choice.
    generation++;
    cancelRetry();
    set({ sending: false });
    await persistStrict();
  } else if (
    choice === "mine" &&
    entry.op.type === "item.update" &&
    entry.conflict
  ) {
    const theirs = entry.conflict.theirs;
    await bump(
      entry,
      {
        key: `${entry.key}-mine`,
        state: "pending",
        delivery: undefined,
        uncertain: false,
        error: undefined,
        conflict: undefined,
        op: {
          ...entry.op,
          base: theirs,
          body: { ...entry.op.body, version: theirs.version },
        },
      },
      owner,
    );
  } else
    await bump(
      entry,
      {
        key: `${entry.key}-r${entry.attempts + 1}`,
        state: "pending",
        delivery: undefined,
        uncertain: false,
        error: undefined,
      },
      owner,
    );
  await flush();
}

// ---- the changes the app makes --------------------------------------------

/**
 * A page edit made with no connection (SHR-03): kept on the phone and sent
 * when the signal is back, merged into whatever the page became meanwhile.
 */
export async function savePageOffline(save: PageSave, account = session.token) {
  save = JSON.parse(JSON.stringify(save)) as PageSave;
  const owner = capture();
  if (account !== owner.token) throw changed();
  await loadOutbox();
  assertCurrent(owner);
  await enqueue({ type: "doc.save", save }, owner);
  set({ offline: true });
}

/** The edit waiting to be sent for a page, to show it with the page. */
export const waitingSave = (id: string): PageSave | null =>
  waitingPageSave(state.entries, id);

/** Whether a page has an edit waiting on this phone. */
export const pageWaiting = (doc: Pick<Doc, "id">) => !!waitingSave(doc.id);

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
) =>
  run<ItemDetail>({ type: "item.post", id: item.id, title: item.title, body });

export const createHabit = (body: HabitInput) =>
  run<Habit>({ type: "habit.create", body });
export const updateHabit = (
  id: string,
  name: string,
  patch: Partial<HabitInput>,
) => run<Habit>({ type: "habit.update", id, name, patch });
export const deleteHabit = (id: string, name: string) =>
  run<void>({ type: "habit.delete", id, name });

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
