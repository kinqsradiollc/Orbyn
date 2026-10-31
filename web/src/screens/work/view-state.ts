import {
  isBoardGroup,
  type BoardGroupBy,
  type ItemSort,
  type Priority,
  type TaskGroupBy,
  type TaskSize,
  BOARD_GROUPS,
  STATUSES,
  type Status,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import type { DueFilter } from "../shared-task";

export type StatusFilter = Status | "all" | "active";
export type Layout = "list" | "board";
export type PinId = "today" | "tomorrow" | "soon";

export const LIST_GROUPS: TaskGroupBy[] = [
  "none",
  "list",
  "tag",
  "size",
  "priority",
  "project",
  "due_week",
  "assignee",
  "owner",
];
export const SORTS: { id: ItemSort; label: string }[] = [
  { id: "score", label: "Priority score" },
  { id: "newest", label: "Newest" },
  { id: "due", label: "Due date" },
  { id: "priority", label: "Priority" },
  { id: "estimate", label: "Estimate" },
  { id: "title", label: "Title" },
  { id: "created", label: "Created" },
  { id: "position", label: "Manual order" },
];
export const PINNABLE: { id: PinId; label: string; hint: string }[] = [
  { id: "today", label: "Today", hint: "Planned or due today" },
  { id: "tomorrow", label: "Tomorrow", hint: "Due tomorrow" },
  { id: "soon", label: "Due soon", hint: "Due within a week" },
];

const KEYS = {
  filter: "orbyn-tasks-status",
  layout: "orbyn-tasks-layout",
  group: "orbyn-tasks-group",
  boardGroup: "orbyn-tasks-board-group",
  hideEmpty: "orbyn-tasks-hide-empty",
  pins: "orbyn-tasks-pinned",
  sort: "orbyn-tasks-sort",
};

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice lasts for this page without storage.
  }
};
const saved = <T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const value = read(key) as T | null;
  return value && allowed.includes(value) ? value : fallback;
};
const FILTERS: StatusFilter[] = ["active", "all", ...STATUSES];

/** Any existing customization keeps the established all-history default. */
const customized = () =>
  [
    KEYS.layout,
    KEYS.group,
    KEYS.boardGroup,
    KEYS.sort,
    KEYS.pins,
    KEYS.hideEmpty,
  ].some((key) => read(key) !== null);

const savedPins = (): PinId[] => {
  try {
    const value: unknown = JSON.parse(read(KEYS.pins) ?? "[]");
    return Array.isArray(value)
      ? PINNABLE.map((p) => p.id).filter((id) => value.includes(id))
      : [];
  } catch {
    return [];
  }
};

/** Folded groups, remembered per layout and grouping. */
const foldKey = (layout: string, group: string) =>
  `orbyn-tasks-folded:${layout}:${group}`;
const savedFolds = (key: string) => {
  try {
    const value: unknown = JSON.parse(read(key) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
};

export type Filters = {
  due: DueFilter;
  priority: Priority | "any";
  list: string;
  tag: string;
  size: TaskSize | "any";
  assignee: string;
};
export const NO_FILTERS: Filters = {
  due: "any",
  priority: "any",
  list: "any",
  tag: "any",
  size: "any",
  assignee: "any",
};

/**
 * How the list was left. This browser keeps a copy so it opens as it was;
 * the account keeps layout, grouping, order and pinned sections across
 * devices. Active work is the default for anyone with no saved choice.
 */
export function useWorkView() {
  const fresh = useRef(!customized()).current;
  const [filter, setFilterState] = useState<StatusFilter>(() =>
    saved(KEYS.filter, FILTERS, fresh ? "active" : "all"),
  );
  const [layout, setLayoutState] = useState<Layout>(() =>
    saved(KEYS.layout, ["list", "board"] as Layout[], "list"),
  );
  const [group, setGroupState] = useState<TaskGroupBy>(() =>
    saved(KEYS.group, LIST_GROUPS, "none"),
  );
  const [boardGroup, setBoardGroupState] = useState<BoardGroupBy>(() =>
    saved(KEYS.boardGroup, BOARD_GROUPS, "status"),
  );
  const [hideEmpty, setHideEmptyState] = useState(
    () => saved(KEYS.hideEmpty, ["yes", "no"], fresh ? "yes" : "no") === "yes",
  );
  const [pins, setPinsState] = useState<PinId[]>(savedPins);
  const [sort, setSortState] = useState<ItemSort>(() =>
    saved(
      KEYS.sort,
      SORTS.map((s) => s.id),
      "score",
    ),
  );
  const chosen = useRef(false);
  const latest = useRef({ layout, group, sort, pins });
  latest.current = { layout, group, sort, pins };

  useEffect(() => {
    let alive = true;
    client.getPrefs().then(
      (prefs) => {
        if (!alive) return;
        const account = prefs.views?.tasks;
        const board = prefs.views?.["tasks:board"];
        if (account) {
          // Existing account collections keep their all-status presentation.
          if (!chosen.current && !read(KEYS.filter)) setFilterState("all");
          if (!read(KEYS.hideEmpty)) setHideEmptyState(false);
          if (account.layout === "list" || account.layout === "board")
            setLayoutState(account.layout);
          if (
            account.group &&
            LIST_GROUPS.includes(account.group as TaskGroupBy)
          )
            setGroupState(account.group as TaskGroupBy);
          if (account.sort && SORTS.some((s) => s.id === account.sort))
            setSortState(account.sort as ItemSort);
          if (account.pins)
            setPinsState(
              PINNABLE.map((p) => p.id).filter((id) =>
                account.pins!.includes(id),
              ),
            );
        }
        if (board?.group && isBoardGroup(board.group))
          setBoardGroupState(board.group);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const keep = useCallback(
    (
      change: Partial<{
        layout: Layout;
        group: TaskGroupBy;
        sort: ItemSort;
        pins: PinId[];
      }>,
    ) => {
      chosen.current = true;
      const next = { ...latest.current, ...change };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void client
          .savePrefs({ views: { tasks: next } })
          .catch(() => undefined);
      }, 800);
    },
    [],
  );

  const setFilter = (next: StatusFilter) => {
    chosen.current = true;
    setFilterState(next);
    remember(KEYS.filter, next);
  };
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    remember(KEYS.layout, next);
    keep({ layout: next });
  };
  const setGroup = (next: TaskGroupBy) => {
    if (layout === "board") {
      if (!isBoardGroup(next)) return;
      setBoardGroupState(next);
      remember(KEYS.boardGroup, next);
      void client
        .savePrefs({ views: { "tasks:board": { group: next } } })
        .catch(() => undefined);
      return;
    }
    setGroupState(next);
    remember(KEYS.group, next);
    keep({ group: next });
  };
  const setSort = (next: ItemSort) => {
    setSortState(next);
    remember(KEYS.sort, next);
    keep({ sort: next });
  };
  const setHideEmpty = (next: boolean) => {
    setHideEmptyState(next);
    remember(KEYS.hideEmpty, next ? "yes" : "no");
  };
  const togglePin = (id: PinId) => {
    const next = PINNABLE.map((p) => p.id).filter(
      (p) => (p === id) !== pins.includes(p),
    );
    setPinsState(next);
    remember(KEYS.pins, JSON.stringify(next));
    keep({ pins: next });
  };

  const shownGroup: TaskGroupBy = layout === "board" ? boardGroup : group;
  const [folds, setFolds] = useState(() =>
    savedFolds(foldKey(layout, shownGroup)),
  );
  useEffect(() => {
    setFolds(savedFolds(foldKey(layout, shownGroup)));
  }, [layout, shownGroup]);
  const toggleFold = (key: string) => {
    const next = new Set(folds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFolds(next);
    remember(foldKey(layout, shownGroup), JSON.stringify([...next]));
  };

  return {
    filter,
    setFilter,
    layout,
    setLayout,
    group,
    boardGroup,
    shownGroup,
    setGroup,
    sort,
    setSort,
    hideEmpty,
    setHideEmpty,
    pins,
    togglePin,
    folds,
    toggleFold,
  };
}
