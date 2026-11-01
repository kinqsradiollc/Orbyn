import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { getSessionVersion, onToken } from "../../lib/session";
import { useSearch } from "../../lib/router";

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

export type LibraryView = { place: Place; filters: Filters; railOpen: boolean };
const empty = (): LibraryView => ({
  place: { at: "all" },
  filters: { ...NO_FILTERS },
  railOpen: true,
});
function createView(search = "") {
  const generation = getSessionVersion();
  const listeners = new Set<() => void>();
  let active = true,
    state = empty();
  const query = new URLSearchParams(search),
    folder = query.get("folder");
  if (
    query.getAll("folder").length === 1 &&
    folder &&
    /^[A-Za-z0-9_-]{1,160}$/.test(folder)
  )
    state = { ...state, place: { at: "folder", id: folder } };
  const publish = (next: LibraryView) => {
    if (active && generation === getSessionVersion()) {
      state = next;
      listeners.forEach((f) => f());
    }
  };
  const actions = {
    goTo: (place: Place) =>
      publish({
        ...state,
        place,
        filters: { ...NO_FILTERS, sort: state.filters.sort },
      }),
    setFilters: (change: Partial<Filters>) =>
      publish({ ...state, filters: { ...state.filters, ...change } }),
    resetFilters: () =>
      publish({
        ...state,
        filters: { ...NO_FILTERS, sort: state.filters.sort },
      }),
    setRailOpen: (railOpen: boolean) => publish({ ...state, railOpen }),
  };
  return {
    getSnapshot: () => state,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    actions,
    activate() {
      active = generation === getSessionVersion();
    },
    retire() {
      active = false;
    },
  };
}
type ViewOwner = ReturnType<typeof createView>;
let legacy = createView();
const legacyListeners = new Set<() => void>();
let stopLegacy = legacy.subscribe(() => legacyListeners.forEach((f) => f()));
onToken(() => {
  legacy.retire();
  stopLegacy();
  legacy = createView();
  stopLegacy = legacy.subscribe(() => legacyListeners.forEach((f) => f()));
  legacyListeners.forEach((f) => f());
});
const legacySubscribe = (f: () => void) => {
  legacyListeners.add(f);
  return () => {
    legacyListeners.delete(f);
  };
};
const Context = createContext<ViewOwner | null>(null);
/** One stable provider per frame, outside both page/collection route variants. */
export function LibraryViewProvider({
  children,
  search: searchOverride,
}: {
  children: ReactNode;
  search?: string;
}) {
  const frameSearch = useSearch();
  const search = searchOverride ?? frameSearch;
  const inherited = useContext(Context);
  const [local] = useState(() => createView(search));
  const owner = inherited ?? local;
  useLayoutEffect(() => {
    if (inherited) return;
    owner.activate();
    return () => owner.retire();
  }, [owner, inherited]);
  useEffect(() => {
    const q = new URLSearchParams(search),
      folder = q.get("folder");
    if (
      q.getAll("folder").length === 1 &&
      folder &&
      /^[A-Za-z0-9_-]{1,160}$/.test(folder)
    )
      owner.actions.goTo({ at: "folder", id: folder });
  }, [owner, search]);
  return <Context.Provider value={owner}>{children}</Context.Provider>;
}

export function useLibraryView() {
  const owner = useContext(Context);
  const state = useSyncExternalStore(
    owner?.subscribe ?? legacySubscribe,
    owner?.getSnapshot ?? (() => legacy.getSnapshot()),
  );
  return useMemo(
    () => ({ state, ...(owner ?? legacy).actions }),
    [owner, state],
  );
}
/** Compatibility only for unframed callers. Retained components use their bound hook actions. */
export const legacyLibraryView = () => legacy.getSnapshot();
export const goTo = (place: Place) => legacy.actions.goTo(place);
export const setFilters = (change: Partial<Filters>) =>
  legacy.actions.setFilters(change);
export const resetFilters = () => legacy.actions.resetFilters();
export const setRailOpen = (open: boolean) => legacy.actions.setRailOpen(open);
