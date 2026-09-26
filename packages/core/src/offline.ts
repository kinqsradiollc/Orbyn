import type { PlannedFeed, TodayList } from "./today.js";
import type { Item, Notice, Tag, TaskList, Team, User } from "./types.js";

// Offline-first support: the app keeps the last planner data it loaded so it
// can open instantly — and stay readable — when the network is slow or gone.
// This module is the pure, storage-agnostic core: it encodes a snapshot to a
// string and decodes it back, refusing anything corrupt, too old, or from a
// different app version rather than letting stale data crash a screen.

/** Everything a planner screen needs to render without the network. */
export type PlannerSnapshot = {
  items: Item[];
  user: User | null;
  notices: Notice[];
  teams: Team[];
  lists: TaskList[];
  tags: Tag[];
  /** Planned time by task ("Planned 9:15", status chips); null when not loaded. */
  planned?: PlannedFeed | null;
  /** The Today list; null when not loaded. Only shown on the day it's for. */
  today?: TodayList | null;
};

/** Bump when the snapshot shape changes, so old caches are ignored. */
export const SNAPSHOT_VERSION = 1;

/** How long a cached snapshot may be shown before it's considered too stale. */
export const SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

type Envelope = { v: number; savedAt: number; data: PlannerSnapshot };

const EMPTY: PlannerSnapshot = {
  items: [],
  user: null,
  notices: [],
  teams: [],
  lists: [],
  tags: [],
  planned: null,
  today: null,
};

/** Serialize a snapshot for storage, stamped with the version and time. */
export function encodeSnapshot(
  data: PlannerSnapshot,
  now = Date.now(),
): string {
  const envelope: Envelope = { v: SNAPSHOT_VERSION, savedAt: now, data };
  return JSON.stringify(envelope);
}

const isArray = Array.isArray;

/** A parsed value is a usable snapshot only if every collection is present. */
function looksLikeSnapshot(d: unknown): d is PlannerSnapshot {
  if (!d || typeof d !== "object") return false;
  const s = d as Record<string, unknown>;
  return (
    isArray(s.items) &&
    isArray(s.notices) &&
    isArray(s.teams) &&
    isArray(s.lists) &&
    isArray(s.tags) &&
    (s.user === null || (typeof s.user === "object" && s.user !== null))
  );
}

/** The planned feed, when a stored value looks like one. */
const plannedOf = (v: unknown): PlannedFeed | null =>
  v && typeof v === "object" && isArray((v as PlannedFeed).tasks)
    ? (v as PlannedFeed)
    : null;

/** The Today list, when a stored value looks like one. */
const todayOf = (v: unknown): TodayList | null =>
  v &&
  typeof v === "object" &&
  isArray((v as TodayList).rows) &&
  isArray((v as TodayList).unfinished) &&
  typeof (v as TodayList).day === "string" &&
  typeof (v as TodayList).timezone === "string"
    ? (v as TodayList)
    : null;

/**
 * Decode a stored snapshot, or null when it's missing, corrupt, from another
 * app version, or older than `maxAgeMs`. Filling the gaps this way means a bad
 * cache is simply skipped — the app loads from the network as if it were the
 * first run — instead of throwing.
 */
export function decodeSnapshot(
  raw: string | null | undefined,
  opts: { now?: number; maxAgeMs?: number } = {},
): PlannerSnapshot | null {
  if (!raw) return null;
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? SNAPSHOT_MAX_AGE_MS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const env = parsed as Partial<Envelope>;
  if (env.v !== SNAPSHOT_VERSION) return null;
  if (typeof env.savedAt !== "number" || now - env.savedAt > maxAge)
    return null;
  if (!looksLikeSnapshot(env.data)) return null;
  // Normalize to exactly the known keys, so extra stored fields don't leak.
  return {
    ...EMPTY,
    items: env.data.items,
    user: env.data.user,
    notices: env.data.notices,
    teams: env.data.teams,
    lists: env.data.lists,
    tags: env.data.tags,
    // Added later: a snapshot saved without them still decodes.
    planned: plannedOf(env.data.planned),
    today: todayOf(env.data.today),
  };
}
