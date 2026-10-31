import {
  favouriteKey,
  favouriteSet,
  type DocKind,
  type DocSummary,
  type Favourite,
  type Folder,
  type Team,
} from "@orbyn/core";
import { useEffect, useSyncExternalStore } from "react";
import { messageOf } from "../../lib/resource";
import { client, getToken, onToken } from "../../lib/session";
import { canWriteIn } from "../shared-task";
import { watchAccount } from "./streams";

/**
 * The library's reads outlive any one route. `/app/docs` and `/app/doc/:id`
 * are separate routes, so this module keeps what they share: the rows and the
 * rail's place. One account owns it; a sign-in change clears everything.
 */
export type Place =
  | { at: "all" }
  | { at: "kind"; kind: "doc" | "note" | "meeting" }
  | { at: "favorites" }
  | { at: "uploads" }
  | { at: "fading" }
  | { at: "agenda"; month: string | null }
  | { at: "folder"; id: string }
  | { at: "unfiled" }
  | { at: "archived" }
  | { at: "trash" };

export type Filters = {
  query: string;
  sort: string;
  tag: string;
  project: string;
  scope: string;
  source: string;
  kind: string;
};

export const NO_FILTERS: Filters = {
  query: "",
  sort: "recent",
  tag: "",
  project: "",
  scope: "",
  source: "",
  kind: "",
};

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
  place: Place;
  filters: Filters;
  railOpen: boolean;
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
  place: { at: "all" },
  filters: NO_FILTERS,
  railOpen: true,
});

let state = blank();
let owner = getToken();
let read = 0;
const listeners = new Set<() => void>();

function publish(change: Partial<State>) {
  state = { ...state, ...change };
  listeners.forEach((listener) => listener());
}

onToken(() => {
  if (getToken() === owner) return;
  owner = getToken();
  read++;
  state = blank();
  listeners.forEach((listener) => listener());
});

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useLibraryState = () =>
  useSyncExternalStore(subscribe, () => state);

export const libraryState = () => state;

export function goTo(place: Place) {
  publish({ place, filters: { ...NO_FILTERS, sort: state.filters.sort } });
}

export const setFilters = (change: Partial<Filters>) =>
  publish({ filters: { ...state.filters, ...change } });

export const resetFilters = () =>
  publish({ filters: { ...NO_FILTERS, sort: state.filters.sort } });

export const setRailOpen = (railOpen: boolean) => publish({ railOpen });

/** Read everything; a partial failure keeps what is showing and says so. */
export async function loadLibrary() {
  const id = ++read;
  publish({ loading: true });
  const results = await Promise.allSettled([
    client.listDocs(),
    client.listFolders(),
    client.listFavourites(),
    client.fadingDocs(),
    client.listDocs({ kind: "memory" }),
    client.listDocs({ kind: "agent" }),
    client.listTeams(),
  ]);
  if (id !== read) return false;
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

/** Keeps the library current while a screen is showing it. */
export function useLibraryFeed() {
  useEffect(() => {
    void loadLibrary();
    let soon: ReturnType<typeof setTimeout> | undefined;
    const stop = watchAccount((news) => {
      if (
        news.kind !== "changed" ||
        (news.area && news.area !== "docs" && news.area !== "organize")
      )
        return;
      clearTimeout(soon);
      soon = setTimeout(() => void loadLibrary(), 400);
    });
    return () => {
      clearTimeout(soon);
      stop();
    };
  }, []);
}

export const patchDocs = (change: (doc: DocSummary) => DocSummary) =>
  publish({ docs: state.docs?.map(change) ?? null });

export const dropDoc = (id: string) =>
  publish({
    docs: state.docs?.filter((doc) => doc.id !== id) ?? null,
    memory: state.memory.filter((doc) => doc.id !== id),
    agents: state.agents.filter((doc) => doc.id !== id),
  });

export const setFolders = (change: (all: Folder[]) => Folder[]) =>
  publish({ folders: change(state.folders) });

export async function starDoc(id: string, starred: boolean) {
  await client.setFavourite("doc", id, starred);
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
