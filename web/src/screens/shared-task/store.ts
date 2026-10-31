import { PlannerItemStore } from "@orbyn/api-client";
import {
  dayBounds,
  hasTeamPermission,
  itemBody,
  type ColumnChange,
  type EditScope,
  type Item,
  type ItemInput,
  type PlannedFeed,
  type PlannerPrefs,
  type Status,
  type Tag,
  type TaskList,
  type Team,
} from "@orbyn/core";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { messageOf } from "../../lib/resource";
import { client, getToken, onToken, setToken } from "../../lib/session";
import { useToast } from "../../ui/kit";

export type EditOptions = { scope?: EditScope; occurrence?: string };

export type Planning = {
  phase: "loading" | "ready" | "error";
  error: string;
  teams: Team[];
  lists: TaskList[];
  tags: Tag[];
  prefs: PlannerPrefs | null;
  feed: PlannedFeed | null;
};

const EMPTY: Planning = {
  phase: "loading",
  error: "",
  teams: [],
  lists: [],
  tags: [],
  prefs: null,
  feed: null,
};

/** How long a deleted item can still be taken back. Matches the kit's toast. */
export const UNDO_MS = 6000;
const POLL_MS = 30_000;

const items = new PlannerItemStore(client, getToken);
const listeners = new Set<() => void>();
const patches = new Map<string, Partial<Item>>();
const hidden = new Set<string>();
let planning = EMPTY;
let shown: Item[] = [];

const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

function recompute() {
  shown = items
    .getSnapshot()
    .filter((item) => !hidden.has(item.id))
    .map((item) => {
      const patch = patches.get(item.id);
      return patch ? { ...item, ...patch } : item;
    });
  emit();
}
items.subscribe(recompute);

const setPlanning = (next: Partial<Planning>) => {
  planning = { ...planning, ...next };
  emit();
};

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const keep = <T>(current: T, next: T) => (same(current, next) ? current : next);
const statusOf = (e: unknown) => (e as { status?: number }).status;

let refreshRun = 0;

/**
 * Reads the planner. A background refresh that fails leaves what is showing.
 * Only the newest run for the current account may publish.
 */
export async function refreshPlanner(force = false) {
  const token = getToken();
  if (!token) return;
  const run = ++refreshRun;
  const owned = () => run === refreshRun && getToken() === token;
  const [teams] = await Promise.allSettled([client.listTeams()]);
  if (!owned()) return;
  const teamIds =
    teams.status === "fulfilled" ? teams.value.map((t) => t.id) : undefined;
  const scope =
    teams.status === "fulfilled" ? JSON.stringify([...teamIds!].sort()) : null;
  const { from, to } = dayBounds(new Date());
  const [read, lists, tags, prefs, feed] = await Promise.allSettled([
    items.refresh(scope, force, teamIds),
    client.listLists(),
    client.listTags(),
    client.getPlannerPrefs(),
    client.planned({ from: from.toISOString(), to: to.toISOString() }),
  ]);
  if (getToken() !== token) return;
  if (run !== refreshRun) return;
  if (
    [teams, read, lists, tags, prefs].some(
      (r) => r.status === "rejected" && statusOf(r.reason) === 401,
    )
  ) {
    setToken("");
    return;
  }
  setPlanning({
    teams:
      teams.status === "fulfilled"
        ? keep(planning.teams, teams.value)
        : planning.teams,
    lists:
      lists.status === "fulfilled"
        ? keep(planning.lists, lists.value)
        : planning.lists,
    tags:
      tags.status === "fulfilled"
        ? keep(planning.tags, tags.value)
        : planning.tags,
    prefs:
      prefs.status === "fulfilled"
        ? keep(planning.prefs, prefs.value)
        : planning.prefs,
    feed:
      feed.status === "fulfilled"
        ? keep(planning.feed, feed.value)
        : planning.feed,
    phase:
      read.status === "fulfilled"
        ? "ready"
        : planning.phase === "ready"
          ? "ready"
          : "error",
    error:
      read.status === "rejected"
        ? messageOf(read.reason, "Couldn't load your tasks.")
        : "",
  });
  if (read.status === "rejected") throw read.reason;
}

const quiet = (force = false) => refreshPlanner(force).catch(() => undefined);

onToken(() => {
  refreshRun++;
  for (const pending of deletes.values()) clearTimeout(pending.timer);
  deletes.clear();
  patches.clear();
  hidden.clear();
  items.reset();
  planning = EMPTY;
  recompute();
  if (getToken() && live > 0) void quiet(true);
});

let live = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const onVisible = () => {
  if (document.visibilityState === "visible") void quiet();
};

/** Keeps the planner fresh while something on screen shows it. */
function useLivePlanner() {
  useEffect(() => {
    if (live++ === 0) {
      void quiet(planning.phase !== "ready");
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void quiet();
      }, POLL_MS);
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      if (--live === 0) {
        clearInterval(timer);
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);
}

/** Every item this person can see, kept fresh, with local changes applied. */
export function useItems() {
  useLivePlanner();
  return useSyncExternalStore(subscribe, () => shown);
}

const derive = (state: Planning) => ({
  ...state,
  listById: new Map(state.lists.map((l) => [l.id, l])),
  tagById: new Map(state.tags.map((t) => [t.id, t])),
  plannedById: new Map((state.feed?.tasks ?? []).map((t) => [t.item_id, t])),
  canWrite: (item: Pick<Item, "team_id">) =>
    canWriteIn(state.teams, item.team_id),
  canWriteIn: (teamId: string | null | undefined) =>
    canWriteIn(state.teams, teamId),
  retry: () => refreshPlanner(true),
});
let derived = { from: EMPTY, value: derive(EMPTY) };
const derivedPlanning = () => {
  if (derived.from !== planning)
    derived = { from: planning, value: derive(planning) };
  return derived.value;
};

/** Teams, lists, tags, planner preferences and today's sessions. */
export function usePlanning() {
  useLivePlanner();
  return useSyncExternalStore(subscribe, derivedPlanning);
}

export const canWriteIn = (teams: Team[], teamId: string | null | undefined) =>
  !teamId ||
  hasTeamPermission(teams.find((t) => t.id === teamId)?.role, "items:write");

export const findItem = (id: string) =>
  items.getSnapshot().find((item) => item.id === id);

function patch(id: string, change: Partial<Item>) {
  patches.set(id, { ...patches.get(id), ...change });
  recompute();
}
function unpatch(id: string) {
  if (patches.delete(id)) recompute();
}

const treeOf = (id: string) => {
  const all = items.getSnapshot();
  const ids = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of all)
      if (item.parent_id && ids.has(item.parent_id) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
  }
  return ids;
};

/** Refreshes after a write. The write stands even if this read fails. */
async function settle(id?: string) {
  await quiet();
  if (id) unpatch(id);
}

/** Status goes through the timeline, so everyone sees who moved what. */
export async function saveStatus(item: Item, status: Status) {
  patch(item.id, { status });
  try {
    const next = await client.postItemUpdate(item.id, { status });
    await settle(item.id);
    return next;
  } catch (error) {
    unpatch(item.id);
    throw error;
  }
}

export const reopenStatus = (item: Item): Status =>
  (item.progress ?? 0) > 0 ? "in_progress" : "todo";

/** A change to a few fields, saved against the version it was shown at. */
export async function saveFields(item: Item, change: Partial<ItemInput>) {
  patch(item.id, change as Partial<Item>);
  try {
    const next = await client.updateItem(item.id, {
      ...writeBody(item),
      ...change,
    });
    await settle(item.id);
    return next;
  } catch (error) {
    unpatch(item.id);
    throw error;
  }
}

/** A personal item can't carry an assignee; older rows may hold one anyway. */
export function writeBody(item: Item) {
  const { assignee_id, ...body } = itemBody(item) as ReturnType<
    typeof itemBody
  > & {
    assignee_id?: string | null;
  };
  return item.team_id ? { ...body, assignee_id } : body;
}

/** Column moves: fields, or handing to and taking back from your agent. */
export async function saveColumn(item: Item, change: ColumnChange) {
  if ("status" in change) return saveStatus(item, change.status);
  if ("agent" in change) {
    const { agent, ...rest } = change;
    const after =
      agent === "hand"
        ? await client.handTaskToAgent(item.id)
        : await client.takeTaskBack(item.id);
    if ("assignee_id" in rest)
      await client.updateItem(item.id, {
        ...writeBody(after),
        assignee_id: rest.assignee_id ?? null,
      });
    await settle();
    return after;
  }
  return saveFields(item, change);
}

export async function saveItem(
  item: Item,
  data: ItemInput,
  version: number,
  options: EditOptions = {},
) {
  const saved = await client.updateItem(
    item.id,
    { ...data, status: item.status, version },
    options,
  );
  await settle();
  return saved;
}

export async function createItem(
  input: Partial<ItemInput> & { title: string; id?: string },
) {
  const made = await client.createItem(input);
  await settle();
  return made;
}

export async function moveItem(
  id: string,
  to: { before_id?: string; after_id?: string },
) {
  await client.moveItem(id, to);
  await settle();
}

type PendingDelete = {
  id: string;
  ids: Set<string>;
  timer: ReturnType<typeof setTimeout>;
  fire: () => void;
};
const deletes = new Map<string, PendingDelete>();

window.addEventListener("pagehide", () => {
  for (const pending of [...deletes.values()]) {
    clearTimeout(pending.timer);
    pending.fire();
  }
});

/**
 * Removing an item can't be reversed on the server, so the request waits out
 * the undo window with the item hidden. Undo cancels it, and every step,
 * update and session survives. Occurrences are confirmed by their scope
 * dialog and removed at once.
 */
export function deleteLater(item: Item, onFail: (message: string) => void) {
  const ids = treeOf(item.id);
  ids.forEach((id) => hidden.add(id));
  recompute();
  const show = () => {
    deletes.delete(item.id);
    ids.forEach((id) => hidden.delete(id));
    recompute();
  };
  const fire = () => {
    deletes.delete(item.id);
    const version = findItem(item.id)?.version ?? item.version;
    client.deleteItem(item.id, version).then(
      () => {
        ids.forEach((id) => hidden.delete(id));
        void quiet();
      },
      (error) => {
        show();
        onFail(messageOf(error, "Couldn't delete this."));
      },
    );
  };
  const timer = setTimeout(fire, UNDO_MS);
  deletes.set(item.id, { id: item.id, ids, timer, fire });
  return () => {
    clearTimeout(timer);
    show();
  };
}

export async function deleteNow(item: Item, options: EditOptions) {
  await client.deleteItem(item.id, item.version, options);
  await settle();
}

/** Feedback for what a row, a card or a panel does to an item. */
export function useTaskActions() {
  const toast = useToast();
  const fail = useCallback(
    (error: unknown, fallback: string) =>
      toast({ text: messageOf(error, fallback), error: true }),
    [toast],
  );

  const setStatus = useCallback(
    async (item: Item, status: Status) => {
      if (item.status === status) return;
      const before = item.status;
      try {
        const next = await saveStatus(item, status);
        if (status !== "done" && status !== "cancelled") return;
        toast({
          text: status === "done" ? "Done" : "Cancelled",
          // A repeating task moves on to its next time when it finishes.
          action: item.rrule
            ? undefined
            : {
                label: "Undo",
                run: () =>
                  void saveStatus({ ...item, ...next }, before).catch((e) =>
                    fail(e, "Couldn't undo that."),
                  ),
              },
        });
      } catch (error) {
        fail(error, "Couldn't change the status.");
      }
    },
    [toast, fail],
  );

  const toggle = useCallback(
    (item: Item) =>
      setStatus(item, item.status === "done" ? reopenStatus(item) : "done"),
    [setStatus],
  );

  const change = useCallback(
    async (item: Item, fields: Partial<ItemInput>) => {
      try {
        return await saveFields(item, fields);
      } catch (error) {
        fail(error, "Couldn't save that.");
        void quiet();
        return null;
      }
    },
    [fail],
  );

  const remove = useCallback(
    (item: Item) => {
      const undo = deleteLater(item, (text) => toast({ text, error: true }));
      toast({
        text: `Deleted “${item.title.slice(0, 40)}”`,
        action: { label: "Undo", run: undo },
      });
    },
    [toast],
  );

  return { setStatus, toggle, change, remove, fail };
}
