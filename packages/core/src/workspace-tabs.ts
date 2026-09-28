/**
 * Tabs on the web app (W4): pages, projects, views and the assistant open
 * side by side in a strip under the top bar. Each tab is a list of places it
 * has been (its own back and forward) and where in that list it is. This is
 * the pure state; the app keeps it per device and shows it.
 */

/** Most tabs open at once; one more closes the oldest that isn't pinned. */
export const TAB_LIMIT = 8;
/** How far back a tab remembers. */
export const TAB_HISTORY_LIMIT = 50;
/** How many closed tabs ⌘⇧T can bring back. */
export const CLOSED_TABS_KEPT = 10;

/**
 * One place a tab can show: a screen (`view`, as the app names it) and what
 * it has open there — a page, project, saved view or chat id — or null for
 * the screen itself. `title` is the thing's name as last seen ("" for the
 * screen's own name).
 */
export type TabPlace = { view: string; id: string | null; title: string };

export type WorkspaceTab = {
  key: string;
  pinned: boolean;
  /** Places visited in this tab, oldest first. */
  history: TabPlace[];
  /** Where in `history` the tab is now. */
  at: number;
  /** When it opened, in the order tabs opened (for closing the oldest). */
  opened: number;
};

export type TabsState = {
  /** Pinned tabs first, then the rest, in the order shown. */
  tabs: WorkspaceTab[];
  active: string;
  /** Recently closed, newest last, for reopening. */
  closed: WorkspaceTab[];
  /** Counter for keys and opening order. */
  seq: number;
  /** Counts moves to a new place in the active tab (not back or forward). */
  moves: number;
};

export type TabAction =
  /** Go somewhere in the active tab. */
  | { type: "go"; place: TabPlace }
  /** Say what the active tab shows now, without a new step back. */
  | { type: "replace"; place: TabPlace }
  /** A thing's name changed: every tab showing it takes the new one. */
  | { type: "retitle"; view: string; id: string; title: string }
  /** A new tab; `background` keeps the current one in front. */
  | { type: "open"; place: TabPlace; background?: boolean }
  | { type: "select"; key: string }
  | { type: "close"; key: string }
  | { type: "closeOthers"; key: string }
  | { type: "closeRight"; key: string }
  | { type: "pin"; key: string; pinned: boolean }
  /** Move a tab before another (or to the end with `before` null). */
  | { type: "move"; key: string; before: string | null }
  | { type: "reopen" }
  | { type: "back" }
  | { type: "forward" }
  /** The next (1) or previous (-1) tab, round the end. */
  | { type: "cycle"; step: 1 | -1 }
  /** Tabs whose thing is gone: dropped without a word. */
  | { type: "drop"; keys: string[] };

const samePlace = (a: TabPlace, b: TabPlace) =>
  a.view === b.view && a.id === b.id;

/** Where a tab is now. */
export const placeOf = (tab: WorkspaceTab): TabPlace =>
  tab.history[tab.at] ?? tab.history[tab.history.length - 1];

/** The tab in front. */
export const activeTab = (state: TabsState): WorkspaceTab =>
  state.tabs.find((t) => t.key === state.active) ?? state.tabs[0];

export const canGoBack = (tab: WorkspaceTab) => tab.at > 0;
export const canGoForward = (tab: WorkspaceTab) =>
  tab.at < tab.history.length - 1;

/** One tab at `place`: how a device with no tabs yet starts. */
export function initialTabs(
  place: TabPlace = { view: "Overview", id: null, title: "" },
): TabsState {
  return {
    tabs: [{ key: "t1", pinned: false, history: [place], at: 0, opened: 1 }],
    active: "t1",
    closed: [],
    seq: 1,
    moves: 0,
  };
}

/** Pinned tabs sit on the left, each part in its own order. */
const pinnedFirst = (tabs: WorkspaceTab[]) => [
  ...tabs.filter((t) => t.pinned),
  ...tabs.filter((t) => !t.pinned),
];

const withTab = (
  state: TabsState,
  key: string,
  change: (tab: WorkspaceTab) => WorkspaceTab,
): TabsState => ({
  ...state,
  tabs: state.tabs.map((t) => (t.key === key ? change(t) : t)),
});

/** Remember closed tabs, newest last, up to the limit. */
const remember = (closed: WorkspaceTab[], gone: WorkspaceTab[]) =>
  [...closed, ...gone].slice(-CLOSED_TABS_KEPT);

/**
 * Add a tab, closing the oldest unpinned one (never `keep`) when it would
 * make one too many. With every tab pinned there is no room: null.
 */
function addTab(
  state: TabsState,
  tab: WorkspaceTab,
  keep: string,
  front: boolean,
): TabsState | null {
  let tabs = state.tabs;
  let closed = state.closed;
  if (tabs.length >= TAB_LIMIT) {
    const oldest = tabs
      .filter((t) => !t.pinned && t.key !== keep)
      .sort((a, b) => a.opened - b.opened)[0];
    if (!oldest) return null;
    tabs = tabs.filter((t) => t.key !== oldest.key);
    closed = remember(closed, [oldest]);
  }
  // A tab brought to the front opens beside the one it came from; ones
  // opened behind line up at the end, in the order they were opened.
  const from = tabs.findIndex((t) => t.key === keep);
  const at = tab.pinned
    ? tabs.filter((t) => t.pinned).length
    : front
      ? from + 1
      : tabs.length;
  const next = [...tabs];
  next.splice(Math.max(at, tabs.filter((t) => t.pinned).length), 0, tab);
  const active =
    front || !tabs.some((t) => t.key === state.active) ? tab.key : state.active;
  return { ...state, tabs: pinnedFirst(next), closed, active };
}

/** Close some tabs; the one in front moves to a neighbour if it went. */
function closeTabs(state: TabsState, keys: string[]): TabsState {
  const gone = state.tabs.filter((t) => keys.includes(t.key));
  if (!gone.length) return state;
  const left = state.tabs.filter((t) => !keys.includes(t.key));
  if (!left.length) return state;
  let active = state.active;
  if (keys.includes(active)) {
    const was = state.tabs.findIndex((t) => t.key === active);
    // The next tab to the right that stays, else the nearest on the left.
    const right = state.tabs.slice(was + 1).find((t) => !keys.includes(t.key));
    const leftOf = state.tabs
      .slice(0, was)
      .reverse()
      .find((t) => !keys.includes(t.key));
    active = (right ?? leftOf ?? left[0]).key;
  }
  return { ...state, tabs: left, active, closed: remember(state.closed, gone) };
}

/** What a tab action does to the tabs. */
export function tabsReducer(state: TabsState, action: TabAction): TabsState {
  const front = activeTab(state);
  switch (action.type) {
    case "go": {
      const here = placeOf(front);
      if (samePlace(here, action.place))
        return action.place.title && action.place.title !== here.title
          ? tabsReducer(state, { type: "replace", place: action.place })
          : state;
      // A screen that has just opened one of its things (the library, then
      // a page) is one step, not two.
      if (here.view === action.place.view && here.id === null)
        return tabsReducer(state, { type: "replace", place: action.place });
      const history = [
        ...front.history.slice(0, front.at + 1),
        action.place,
      ].slice(-TAB_HISTORY_LIMIT);
      return {
        ...withTab(state, front.key, (t) => ({
          ...t,
          history,
          at: history.length - 1,
        })),
        moves: state.moves + 1,
      };
    }
    case "replace":
      return withTab(state, front.key, (t) => ({
        ...t,
        history: t.history.map((p, i) => (i === t.at ? action.place : p)),
      }));
    case "retitle": {
      let changed = false;
      const tabs = state.tabs.map((t) => {
        if (
          !t.history.some(
            (p) =>
              p.view === action.view &&
              p.id === action.id &&
              p.title !== action.title,
          )
        )
          return t;
        changed = true;
        return {
          ...t,
          history: t.history.map((p) =>
            p.view === action.view && p.id === action.id
              ? { ...p, title: action.title }
              : p,
          ),
        };
      });
      return changed ? { ...state, tabs } : state;
    }
    case "open": {
      const seq = state.seq + 1;
      const tab: WorkspaceTab = {
        key: `t${seq}`,
        pinned: false,
        history: [action.place],
        at: 0,
        opened: seq,
      };
      const added = addTab(
        { ...state, seq },
        tab,
        front.key,
        !action.background,
      );
      // Every tab pinned and no room: go there in this one instead.
      return added ?? tabsReducer(state, { type: "go", place: action.place });
    }
    case "select":
      return state.tabs.some((t) => t.key === action.key) &&
        action.key !== state.active
        ? { ...state, active: action.key }
        : state;
    case "close":
      return closeTabs(state, [action.key]);
    case "closeOthers":
      return closeTabs(
        { ...state, active: action.key },
        state.tabs
          .filter((t) => t.key !== action.key && !t.pinned)
          .map((t) => t.key),
      );
    case "closeRight": {
      const at = state.tabs.findIndex((t) => t.key === action.key);
      if (at < 0) return state;
      return closeTabs(
        state,
        state.tabs
          .slice(at + 1)
          .filter((t) => !t.pinned)
          .map((t) => t.key),
      );
    }
    case "pin": {
      const tab = state.tabs.find((t) => t.key === action.key);
      if (!tab || tab.pinned === action.pinned) return state;
      // Pinned goes to the end of the pinned ones; unpinned to the start
      // of the rest, next to where it was.
      const others = state.tabs.filter((t) => t.key !== action.key);
      const pinnedCount = others.filter((t) => t.pinned).length;
      const next = [...others];
      next.splice(pinnedCount, 0, { ...tab, pinned: action.pinned });
      return { ...state, tabs: pinnedFirst(next) };
    }
    case "move": {
      const tab = state.tabs.find((t) => t.key === action.key);
      if (!tab || action.key === action.before) return state;
      const others = state.tabs.filter((t) => t.key !== action.key);
      const at =
        action.before === null
          ? others.length
          : others.findIndex((t) => t.key === action.before);
      if (at < 0) return state;
      const next = [...others];
      next.splice(at, 0, tab);
      return { ...state, tabs: pinnedFirst(next) };
    }
    case "reopen": {
      const tab = state.closed[state.closed.length - 1];
      if (!tab) return state;
      const seq = state.seq + 1;
      const back = { ...tab, key: `t${seq}`, opened: seq };
      const added = addTab(
        { ...state, seq, closed: state.closed.slice(0, -1) },
        back,
        front.key,
        true,
      );
      return added ?? state;
    }
    case "back":
      return canGoBack(front)
        ? withTab(state, front.key, (t) => ({ ...t, at: t.at - 1 }))
        : state;
    case "forward":
      return canGoForward(front)
        ? withTab(state, front.key, (t) => ({ ...t, at: t.at + 1 }))
        : state;
    case "cycle": {
      if (state.tabs.length < 2) return state;
      const at = state.tabs.findIndex((t) => t.key === front.key);
      const n = state.tabs.length;
      return { ...state, active: state.tabs[(at + action.step + n) % n].key };
    }
    case "drop": {
      const left = state.tabs.filter((t) => !action.keys.includes(t.key));
      // Nothing left: start again at the first screen.
      if (!left.length) return { ...initialTabs(), seq: state.seq };
      const active = left.some((t) => t.key === state.active)
        ? state.active
        : left[0].key;
      return { ...state, tabs: left, active };
    }
  }
}

const isPlace = (p: unknown): p is TabPlace =>
  !!p &&
  typeof p === "object" &&
  typeof (p as TabPlace).view === "string" &&
  ((p as TabPlace).id === null || typeof (p as TabPlace).id === "string") &&
  typeof (p as TabPlace).title === "string";

/** What a device keeps of its tabs (closed ones are forgotten). */
export function saveTabs(state: TabsState): string {
  return JSON.stringify({
    tabs: state.tabs.map(({ key, pinned, history, at, opened }) => ({
      key,
      pinned,
      history,
      at,
      opened,
    })),
    active: state.active,
    seq: state.seq,
  });
}

/**
 * Tabs as a device kept them. Anything unreadable — or a screen `known`
 * doesn't have (an old name, a screen this person can't open) — is left
 * out; with nothing left, one tab on the first screen.
 */
export function restoreTabs(
  saved: string | null,
  known: (view: string) => boolean = () => true,
): TabsState {
  if (!saved) return initialTabs();
  let raw: unknown;
  try {
    raw = JSON.parse(saved);
  } catch {
    return initialTabs();
  }
  if (!raw || typeof raw !== "object") return initialTabs();
  const data = raw as { tabs?: unknown; active?: unknown; seq?: unknown };
  const tabs: WorkspaceTab[] = [];
  const keys = new Set<string>();
  for (const t of Array.isArray(data.tabs) ? data.tabs : []) {
    if (!t || typeof t !== "object") continue;
    const tab = t as Partial<WorkspaceTab>;
    if (typeof tab.key !== "string" || keys.has(tab.key)) continue;
    const history = (Array.isArray(tab.history) ? tab.history : [])
      .filter(isPlace)
      .filter((p) => known(p.view))
      .slice(-TAB_HISTORY_LIMIT)
      .map((p) => ({ view: p.view, id: p.id, title: p.title }));
    if (!history.length) continue;
    const at =
      typeof tab.at === "number" && Number.isInteger(tab.at)
        ? Math.min(Math.max(tab.at, 0), history.length - 1)
        : history.length - 1;
    keys.add(tab.key);
    tabs.push({
      key: tab.key,
      pinned: tab.pinned === true,
      history,
      at,
      opened: typeof tab.opened === "number" ? tab.opened : 0,
    });
  }
  if (!tabs.length) return initialTabs();
  const kept = pinnedFirst(tabs).slice(0, TAB_LIMIT);
  const counted = kept.map((t) => Number(t.key.slice(1)) || 0);
  const seq = Math.max(
    typeof data.seq === "number" ? data.seq : 0,
    ...counted,
    ...kept.map((t) => t.opened),
  );
  const active =
    typeof data.active === "string" && kept.some((t) => t.key === data.active)
      ? data.active
      : kept[0].key;
  return { tabs: kept, active, closed: [], seq, moves: 0 };
}
