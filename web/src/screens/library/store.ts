import {
  favouriteKey,
  favouriteSet,
  type DocKind,
  type DocSummary,
  type Favourite,
  type Folder,
  type Team,
} from "@orbyn/core";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { messageOf } from "../../lib/resource";
import {
  client,
  getToken,
  getSessionVersion,
  onToken,
} from "../../lib/session";
import { canWriteIn } from "../shared-task";
import { watchAccount } from "./streams";

/**
 * The library's reads outlive any one route. `/app/docs` and `/app/doc/:id`
 * are separate routes, so this module keeps what they share: the rows and the
 * account data. View selection/filters live in the Library frame provider.
 * One account owns the data and feed; a sign-in change clears both.
 */
export {
  NO_FILTERS,
  goTo,
  setFilters,
  resetFilters,
  setRailOpen,
} from "./view";
export type { Place, Filters } from "./view";
import { legacyLibraryView, useLibraryView } from "./view";

type State = {
  docs: DocSummary[] | null;
  memory: DocSummary[];
  agents: DocSummary[];
  folders: Folder[];
  stars: Favourite[];
  fading: Set<string>;
  teams: Team[];
  loading: boolean;
  /** The pages themselves couldn't be read. */
  failed: string;
  /** Something beside the pages couldn't be read. */
  partial: string;
};

const blank = (): State => ({
  docs: null,
  memory: [],
  agents: [],
  folders: [],
  stars: [],
  fading: new Set(),
  teams: [],
  loading: true,
  failed: "",
  partial: "",
});

let state = blank();
const listeners = new Set<() => void>();
const PASSIVE_GAP_MS = 5_000;
const BATCH_MS = 160;

type ReadRun = { epoch: number };
type ReadOwner = {
  token: string;
  generation: number;
  epoch: number;
  active: ReadRun | null;
  deadline: number | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  lastStarted: number;
  waiting: ((fresh: boolean) => void)[];
};

const newOwner = (): ReadOwner => ({
  token: getToken(),
  generation: getSessionVersion(),
  epoch: 0,
  active: null,
  deadline: null,
  timer: undefined,
  lastStarted: Number.NEGATIVE_INFINITY,
  waiting: [],
});
let owner = newOwner();
const owns = (account: ReadOwner) =>
  account === owner &&
  account.token === getToken() &&
  account.generation === getSessionVersion();

function publish(change: Partial<State>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}

onToken(() => {
  if (owns(owner)) return;
  const previous = owner;
  owner = newOwner();
  clearTimeout(previous.timer);
  previous.timer = undefined;
  previous.deadline = null;
  previous.waiting.splice(0).forEach((resolve) => resolve(false));
  state = blank();
  restartFeed();
  listeners.forEach((listener) => listener());
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function useLibraryState() {
  const data = useSyncExternalStore(subscribe, () => state);
  const view = useLibraryView();
  return useMemo(() => ({ ...data, ...view.state }), [data, view.state]);
}
/** Synchronous account data plus legacy unframed view. Retained readers use useLibraryState. */
export const libraryState = () => ({ ...state, ...legacyLibraryView() });

/** Read everything; a partial failure keeps what is showing and says so. */
async function readLibrary(account: ReadOwner, epoch: number) {
  const results = await Promise.allSettled([
    client.listDocs(),
    client.listFolders(),
    client.listFavourites(),
    client.fadingDocs(),
    client.listDocs({ kind: "memory" }),
    client.listDocs({ kind: "agent" }),
    client.listTeams(),
  ]);
  if (!owns(account) || epoch !== account.epoch) return false;
  const [pages, folders, stars, fading, memory, agents, teams] = results;
  const names = [
    "pages",
    "folders",
    "favorites",
    "outdated pages",
    "Memory",
    "agent notes",
    "teams",
  ];
  const missing = results.flatMap((result, index) =>
    result.status === "rejected" ? [names[index]] : [],
  );
  publish({
    loading: false,
    docs: pages.status === "fulfilled" ? pages.value : state.docs,
    failed:
      pages.status === "rejected"
        ? messageOf(pages.reason, "Couldn't load your pages.")
        : "",
    folders: folders.status === "fulfilled" ? folders.value : state.folders,
    stars: stars.status === "fulfilled" ? stars.value : state.stars,
    fading:
      fading.status === "fulfilled"
        ? new Set(fading.value.map((doc) => doc.id))
        : state.fading,
    memory: memory.status === "fulfilled" ? memory.value : state.memory,
    agents: agents.status === "fulfilled" ? agents.value : state.agents,
    teams: teams.status === "fulfilled" ? teams.value : state.teams,
    partial:
      pages.status === "fulfilled" && missing.length
        ? `Couldn't refresh ${missing.join(", ")}.`
        : "",
  });
  return !missing.length;
}

/** Only a current causal read settles callers. Superseded callers travel to
 * the queued follow-up; an old account completion cannot touch the new queue. */
function finishRead(account: ReadOwner, run: ReadRun, fresh: boolean) {
  if (!owns(account) || account.active !== run) return;
  account.active = null;
  if (run.epoch === account.epoch && account.deadline === null)
    account.waiting.splice(0).forEach((resolve) => resolve(fresh));
  armRead(account);
}

function armRead(account: ReadOwner) {
  if (!owns(account) || account.active || account.deadline === null) return;
  clearTimeout(account.timer);
  account.timer = setTimeout(
    () => {
      account.timer = undefined;
      if (!owns(account) || account.active || account.deadline === null) return;
      account.deadline = null;
      const run = { epoch: account.epoch };
      account.active = run;
      account.lastStarted = performance.now();
      void readLibrary(account, run.epoch).then(
        (fresh) => finishRead(account, run, fresh),
        (failure) => {
          if (owns(account) && run.epoch === account.epoch)
            publish({
              loading: false,
              failed: messageOf(failure, "Couldn't load your pages."),
            });
          finishRead(account, run, false);
        },
      );
    },
    Math.max(0, account.deadline - performance.now()),
  );
}

function queueRead(account: ReadOwner, passive: boolean) {
  // Fence publication now, even when cooldown or an active read delays dispatch.
  account.epoch++;
  const now = performance.now();
  const batchAt = now + (state.docs === null ? 0 : BATCH_MS);
  // A later notification cannot demote an explicit caller still awaiting its
  // fresh receipt. Only entirely background work uses the cooldown.
  const background = passive && account.waiting.length === 0;
  const due = background
    ? Math.max(batchAt, account.lastStarted + PASSIVE_GAP_MS)
    : batchAt;
  // Keep the earliest deadline: a steady stream cannot postpone the last read.
  account.deadline = Math.min(account.deadline ?? due, due);
  if (!background || state.docs === null) publish({ loading: true });
  armRead(account);
}

/** Explicit refresh always causes a read started after this call. Calls in the
 * pre-dispatch batch share that future read, never a pre-event active read or a
 * completed result. Explicit work bypasses the passive cooldown. */
export function loadLibrary(): Promise<boolean> {
  const account = owner;
  if (!owns(account) || !account.token) return Promise.resolve(false);
  client.noteExternalMutation();
  const result = new Promise<boolean>((resolve) =>
    account.waiting.push(resolve),
  );
  queueRead(account, false);
  return result;
}

/** Passive news is still an invalidation, not a completed-result cache hit.
 * Warm reads keep current actions available and start at most once per gap. */
function invalidateLibrary(account: ReadOwner) {
  if (!owns(account) || !account.token) return;
  queueRead(account, true);
}

/** Keeps the library current while a screen is showing it. */
const feedLeases = new Set<{ generation: number }>();
let feedGeneration: number | null = null;
let stopFeed: (() => void) | null = null;
function restartFeed() {
  const account = owner;
  if (stopFeed && feedGeneration === account.generation) return;
  stopFeed?.();
  stopFeed = null;
  feedGeneration = null;
  if (
    !owns(account) ||
    !account.token ||
    ![...feedLeases].some((lease) => lease.generation === account.generation)
  )
    return;
  feedGeneration = account.generation;
  void loadLibrary();
  const stop = watchAccount((news) => {
    if (
      news.kind !== "changed" ||
      (news.area && news.area !== "docs" && news.area !== "organize")
    )
      return;
    invalidateLibrary(account);
  });
  const visible = () => {
    if (document.visibilityState === "visible" && owns(account)) {
      client.noteExternalMutation();
      invalidateLibrary(account);
    }
  };
  document.addEventListener("visibilitychange", visible);
  stopFeed = () => {
    stop();
    document.removeEventListener("visibilitychange", visible);
  };
}
/** One account-owned feed and visibility invalidation regardless of retained Library count. */
export function useLibraryFeed() {
  const openingGeneration = getSessionVersion();
  useEffect(() => {
    if (openingGeneration !== getSessionVersion()) return;
    const lease = { generation: openingGeneration };
    feedLeases.add(lease);
    restartFeed();
    return () => {
      feedLeases.delete(lease);
      if (
        feedGeneration === lease.generation &&
        ![...feedLeases].some((one) => one.generation === lease.generation)
      ) {
        stopFeed?.();
        stopFeed = null;
        feedGeneration = null;
      }
    };
  }, []);
}

// Confirmed local receipts supersede any older graph already in flight.
// Their callers still own the opening account and component lifetime.
export const patchDocs = (change: (doc: DocSummary) => DocSummary) => {
  invalidateLibrary(owner);
  publish({ docs: state.docs?.map(change) ?? null });
};

export const dropDoc = (id: string) => {
  invalidateLibrary(owner);
  publish({
    docs: state.docs?.filter((doc) => doc.id !== id) ?? null,
    memory: state.memory.filter((doc) => doc.id !== id),
    agents: state.agents.filter((doc) => doc.id !== id),
  });
};

export const setFolders = (change: (all: Folder[]) => Folder[]) => {
  invalidateLibrary(owner);
  publish({ folders: change(state.folders) });
};

export async function starDoc(id: string, starred: boolean) {
  const account = owner;
  if (!owns(account)) return;
  await client.setFavourite("doc", id, starred);
  if (!owns(account)) return;
  // The local receipt must not be overwritten by a read begun before the write.
  invalidateLibrary(account);
  const others = state.stars.filter(
    (star) => !(star.kind === "doc" && star.target_id === id),
  );
  publish({
    stars: starred
      ? [...others, { kind: "doc", target_id: id, created_at: "" }]
      : others,
  });
}

export const isStarred = (stars: Favourite[], id: string) =>
  favouriteSet(stars).has(favouriteKey("doc", id));

export const canWriteDoc = (teams: Team[], teamId: string | null | undefined) =>
  canWriteIn(teams, teamId);

export const teamName = (
  teams: Team[],
  doc: { team_id: string | null; team_name?: string | null },
) =>
  doc.team_id
    ? (doc.team_name ??
      teams.find((team) => team.id === doc.team_id)?.name ??
      "Shared team")
    : "Personal";

export const fixedKinds = ["memory", "agent"] as const;
export type FixedKind = Extract<DocKind, (typeof fixedKinds)[number]>;

/** New pages use nested ownership; Memory and Agent notes stay flat. */
export async function createPage(input: {
  kind: DocKind;
  title?: string;
  folder_id?: string | null;
  team_id?: string | null;
  parent_id?: string;
}) {
  const body = { title: "", ...input };
  return input.kind === "doc"
    ? client.createDocForEditor(body, {
        format: 2,
        nodes: [{ kind: "block", block: { type: "paragraph", text: "" } }],
      })
    : client.createDoc({ ...body, content: [{ type: "paragraph", text: "" }] });
}
