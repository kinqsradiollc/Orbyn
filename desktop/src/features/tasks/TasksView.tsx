import { Select } from "../../components/Select";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  List,
  ListTodo,
  Pin,
  Search,
  X,
  BadgeCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  searchItems,
  plannedTodayIds,
  emptyPlans,
  emptySearch,
  STATUSES,
  isClosed,
  statusLabels,
  boardColumns,
  columnPrefill,
  dropChange,
  durationText,
  groupTasks,
  isBoardGroup,
  BOARD_GROUPS,
  TASK_GROUP_LABELS,
  BOARD_FILTERS,
  BOARD_FILTER_LABELS,
  BOARD_RANGES,
  BOARD_RANGE_LABELS,
  boardFilterCounts,
  inBoardRange,
  isAgentLane,
  matchesBoardFilter,
  OWNER_REVIEW,
  type BoardFilter,
  type BoardRange,
  type ReviewItem,
  type BoardGroupBy,
  type ColumnChange,
  type GroupNames,
  type Item,
  type ItemInput,
  type ItemSort,
  type Priority,
  type Status,
  type TaskGroupBy,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { ProgressDialog } from "../followthrough/ProgressDialog";
import "../followthrough/followthrough.css";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import { Popover } from "../../components/Popover";
import { usePlanning } from "../../app/planning";
import { usePlanned } from "../../app/planned";
import { usePrefs } from "../../app/prefs";
import { statusCounts } from "../../lib/tasks";
import {
  byScore,
  errorText,
  matchesDue,
  SIZE_LABELS,
  sizeOf,
  type DueFilter,
  type Size,
} from "../../lib/planning";
import { TaskBoard } from "./TaskBoard";
import { DateField } from "../../components/DateField";

type Props = {
  items: Item[];
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  onSetStatus: (item: Item, status: Status) => void;
  /** You, for "Assigned to me". */
  userId?: string;
  /** Refresh the planner after reordering. */
  onChanged?: () => Promise<void>;
  /** A column's +: a new task starting with that column's value. */
  onNewItem?: (prefill: Partial<ItemInput>) => void;
  /** A card dragged to another column: its list, priority, assignee or tags. */
  onChangeItem?: (item: Item, change: ColumnChange) => void;
  /** Your agent's chosen name, for its lane and badges. */
  agentName?: string;
  /** Open a proposal in Review (the "Who's on it" board's Review lane). */
  onOpenReview?: (id: string) => void;
};

/** How often the list looks again while your agent works on a task (its progress line). */
const AGENT_POLL_MS = 20_000;

type Filter = Status | "all";
type Layout = "list" | "board";
/** How the list groups its rows; the board always groups by something. */
type Group = TaskGroupBy;
const LIST_GROUPS: Group[] = [
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

const LAYOUT_KEY = "orbyn-tasks-layout";
const GROUP_KEY = "orbyn-tasks-group";
const BOARD_GROUP_KEY = "orbyn-tasks-board-group";
const HIDE_EMPTY_KEY = "orbyn-tasks-hide-empty";
/** Folded groups, remembered per layout and grouping. */
const foldKey = (layout: string, group: string) =>
  `orbyn-tasks-folded:${layout}:${group}`;
const savedFolds = (key: string): Set<string> => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [],
    );
  } catch {
    return new Set();
  }
};
const PIN_KEY = "orbyn-tasks-pinned";
const SORT_KEY = "orbyn-tasks-sort";
const saved = <T extends string>(key: string, allowed: T[], fallback: T): T => {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the choice just won't stick.
  }
};

const SIZES: Size[] = ["quick", "short", "long", "none"];
/** "Group by" names in the menu. */
const GROUP_NAMES: Record<Group, string> = {
  ...TASK_GROUP_LABELS,
  none: "No grouping",
};
const DUE_OPTIONS: { id: DueFilter; label: string }[] = [
  { id: "any", label: "Any due date" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today (planned or due)" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "soon", label: "Due soon" },
  { id: "week", label: "This week" },
  { id: "none", label: "No date" },
];

const SORTS: { id: ItemSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "score", label: "Priority score" },
  { id: "due", label: "Due date" },
  { id: "priority", label: "Priority" },
  { id: "estimate", label: "Estimate" },
  { id: "title", label: "Title" },
  { id: "created", label: "Created" },
  { id: "position", label: "Manual order" },
];
const RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
/** Smallest first, missing values last. */
const ascending = (a?: number | null, b?: number | null) =>
  a == null || Number.isNaN(a)
    ? b == null || Number.isNaN(b)
      ? 0
      : 1
    : b == null || Number.isNaN(b)
      ? -1
      : a - b;
const time = (iso?: string | null) => (iso ? Date.parse(iso) : null);
const negate = (n: number | null | undefined) => (n == null ? null : -n);

/**
 * The server's `sort` orders, on the loaded items. "Priority score" uses the
 * `score` each item comes with (none for events and finished tasks, which go
 * last); ties go to the more pressing task.
 */
function sortBy(
  sort: ItemSort,
  now: Date,
  among: Item[],
): (a: Item, b: Item) => number {
  const pressing = byScore(now, among);
  switch (sort) {
    case "newest":
      return (a, b) =>
        ascending(negate(time(a.created_at)), negate(time(b.created_at))) ||
        pressing(a, b);
    case "created":
      return (a, b) =>
        ascending(time(a.created_at), time(b.created_at)) ||
        a.title.localeCompare(b.title);
    case "due":
      return (a, b) =>
        ascending(time(a.due_at), time(b.due_at)) || pressing(a, b);
    case "priority":
      return (a, b) => RANK[b.priority] - RANK[a.priority] || pressing(a, b);
    case "estimate":
      return (a, b) =>
        ascending(a.estimate_minutes, b.estimate_minutes) || pressing(a, b);
    case "position":
      return (a, b) =>
        ascending(a.position, b.position) || a.title.localeCompare(b.title);
    case "title":
      return (a, b) => a.title.localeCompare(b.title);
    default:
      return (a, b) =>
        ascending(negate(a.score), negate(b.score)) || pressing(a, b);
  }
}

/** Smart lists that can be pinned above the list. Overdue always is. */
type PinId = "today" | "tomorrow" | "soon";
const PINNABLE: { id: PinId; label: string; hint: string }[] = [
  { id: "today", label: "Today", hint: "Planned or due today" },
  { id: "tomorrow", label: "Tomorrow", hint: "Due tomorrow" },
  { id: "soon", label: "Due soon", hint: "Due after tomorrow, within a week" },
];
const savedPins = (): PinId[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PIN_KEY) ?? "[]");
    return Array.isArray(value)
      ? PINNABLE.map((p) => p.id).filter((id) => value.includes(id))
      : [];
  } catch {
    return [];
  }
};

/**
 * Every item with search, filters (due, priority, list, tag, size, assignee),
 * status chips, grouping, a sort order (most pressing first unless you pick
 * another, remembered) and a List / Board toggle. In the List layout, open items that are overdue (and, if
 * pinned from the view menu, due today, tomorrow or soon) sit in their own
 * sections at the top.
 */
export function TasksView({
  items,
  query,
  onQueryChange,
  busy,
  canWrite,
  onToggle,
  onOpen,
  onSetStatus,
  userId,
  onChanged,
  onNewItem,
  onChangeItem,
  agentName = "Orbyn",
  onOpenReview,
}: Props) {
  const { lists, tags } = usePlanning();
  const { feed } = usePlanned();
  const [filter, setFilter] = useState<Filter>("all");
  const [progressOpen, setProgressOpen] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(() =>
    saved(LAYOUT_KEY, ["list", "board"], "list"),
  );
  const [group, setGroupState] = useState<Group>(() =>
    saved(GROUP_KEY, LIST_GROUPS, "none"),
  );
  const [boardGroup, setBoardGroupState] = useState<BoardGroupBy>(() =>
    saved(BOARD_GROUP_KEY, [...BOARD_GROUPS], "status"),
  );
  const [hideEmpty, setHideEmptyState] = useState(
    () => saved(HIDE_EMPTY_KEY, ["yes", "no"], "no") === "yes",
  );
  /** What the shown layout groups by, and which of its groups are folded. */
  const shownGroup: Group = layout === "board" ? boardGroup : group;
  const [folds, setFolds] = useState(() =>
    savedFolds(foldKey(layout, shownGroup)),
  );
  useEffect(() => {
    setFolds(savedFolds(foldKey(layout, shownGroup)));
  }, [layout, shownGroup]);
  const toggleGroupFold = (key: string) => {
    const next = new Set(folds);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setFolds(next);
    remember(foldKey(layout, shownGroup), JSON.stringify([...next]));
  };
  // Project names, for grouping by project (loaded only then).
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (shownGroup !== "project" || projects.length) return;
    let live = true;
    client
      .listProjects()
      .then(
        (all) => live && setProjects(all.map(({ id, name }) => ({ id, name }))),
      )
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [shownGroup, projects.length]);
  const [pins, setPinsState] = useState<PinId[]>(savedPins);
  const [sort, setSortState] = useState<ItemSort>(() =>
    saved(
      SORT_KEY,
      SORTS.map((s) => s.id),
      "score",
    ),
  );
  const [viewMenu, setViewMenu] = useState<DOMRect | null>(null);
  // How the list was left follows the account (SHR-08): the layout, the
  // grouping, the order and the pinned sections. This browser keeps a copy
  // so the list opens as it was before the account's choices arrive.
  const { viewChoice, setViewChoice } = usePrefs();
  const account = viewChoice("tasks");
  const accountBoard = viewChoice("tasks:board");
  useEffect(() => {
    if (!account) return;
    if (account.layout === "list" || account.layout === "board")
      setLayoutState(account.layout);
    if (account.group && (LIST_GROUPS as string[]).includes(account.group))
      setGroupState(account.group as Group);
    if (account.sort && SORTS.some((x) => x.id === account.sort))
      setSortState(account.sort as ItemSort);
    if (account.pins)
      setPinsState(
        PINNABLE.map((p) => p.id).filter((id) => account.pins!.includes(id)),
      );
  }, [account?.layout, account?.group, account?.sort, account?.pins?.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const g = accountBoard?.group;
    if (g && isBoardGroup(g as Group)) setBoardGroupState(g as BoardGroupBy);
  }, [accountBoard?.group]);
  const keepChoice = (change: {
    layout?: Layout;
    group?: Group;
    sort?: ItemSort;
    pins?: PinId[];
  }) =>
    setViewChoice("tasks", {
      layout: change.layout ?? layout,
      group: change.group ?? group,
      sort: change.sort ?? sort,
      pins: change.pins ?? pins,
    });
  const [due, setDue] = useState<DueFilter>("any");
  const [priority, setPriority] = useState<Priority | "any">("any");
  const [listId, setListId] = useState("any");
  const [tagId, setTagId] = useState("any");
  const [size, setSize] = useState<Size | "any">("any");
  const [assignee, setAssignee] = useState("any");
  /** On a phone the filters fold behind one button (see .filter-bar). */
  const [filtersOpen, setFiltersOpen] = useState(false);
  // "Who's on it" (W2): quick filters, a date range, connected agents' work
  // and what waits in Review.
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [range, setRange] = useState<BoardRange>({ kind: "all" });
  const [agentWork, setAgentWork] = useState<
    { grant_id: string; name: string; item_ids: string[] }[]
  >([]);
  const [reviewCards, setReviewCards] = useState<ReviewItem[]>([]);
  const owners = layout === "board" && boardGroup === "owner";
  const itemsKey = items
    .map((i) => `${i.id}:${i.version}:${i.agent_state ?? ""}`)
    .join();
  useEffect(() => {
    if (!owners) return;
    let live = true;
    client
      .agentWork()
      .then((work) => live && setAgentWork(work))
      .catch(() => {});
    client
      .reviewInbox()
      .then((inbox) => live && setReviewCards(inbox.pending))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [owners, itemsKey]);
  // While your agent has work, its progress is looked at again every few seconds.
  const agentBusy = items.some(
    (i) => i.agent_state === "queued" || i.agent_state === "working",
  );
  useEffect(() => {
    if (!agentBusy || !onChanged) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void onChanged();
    }, AGENT_POLL_MS);
    return () => clearInterval(timer);
  }, [agentBusy, onChanged]);
  const activeFilters = [due, priority, listId, tagId, size, assignee].filter(
    (v) => v !== "any",
  ).length;

  const setLayout = (next: Layout) => {
    setLayoutState(next);
    remember(LAYOUT_KEY, next);
    keepChoice({ layout: next });
  };
  const setGroup = (next: Group) => {
    if (layout === "board") {
      if (!isBoardGroup(next)) return;
      setBoardGroupState(next);
      remember(BOARD_GROUP_KEY, next);
      setViewChoice("tasks:board", { group: next });
      return;
    }
    setGroupState(next);
    remember(GROUP_KEY, next);
    keepChoice({ group: next });
  };
  const setHideEmpty = (next: boolean) => {
    setHideEmptyState(next);
    remember(HIDE_EMPTY_KEY, next ? "yes" : "no");
  };
  const togglePin = (id: PinId) => {
    const next = PINNABLE.map((p) => p.id).filter(
      (p) => (p === id) !== pins.includes(p),
    );
    setPinsState(next);
    remember(PIN_KEY, JSON.stringify(next));
    keepChoice({ pins: next });
  };

  // People team tasks are assigned to, for the assignee filter.
  const assignees = useMemo(() => {
    const people = new Map<string, string>();
    for (const i of items)
      if (i.assignee_id && i.assignee_name)
        people.set(i.assignee_id, i.assignee_name);
    return [...people.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const hasTeamItems = items.some((i) => i.team_id);

  const active =
    due !== "any" ||
    priority !== "any" ||
    listId !== "any" ||
    tagId !== "any" ||
    size !== "any" ||
    assignee !== "any";
  const clear = () => {
    setDue("any");
    setPriority("any");
    setListId("any");
    setTagId("any");
    setSize("any");
    setAssignee("any");
  };

  const now = new Date();
  // Tasks with a session of yours today count as "Today" too.
  const plannedToday = plannedTodayIds(feed, now);
  const matching = searchItems(items, query)
    .filter(
      (i) =>
        matchesDue(i, due, now, plannedToday) &&
        (priority === "any" || i.priority === priority) &&
        (listId === "any" ||
          (listId === "none" ? !i.list_id : i.list_id === listId)) &&
        (tagId === "any" || (i.tag_ids ?? []).includes(tagId)) &&
        (size === "any" || sizeOf(i) === size) &&
        (assignee === "any" ||
          (assignee === "me"
            ? i.assignee_id === userId
            : assignee === "none"
              ? !!i.team_id && !i.assignee_id
              : i.assignee_id === assignee)),
    )
    .sort(sortBy(sort, now, items));
  const counts = statusCounts(matching);
  // Sessions per task, for the range's "planned" dates.
  const plannedAt = new Map(
    (feed?.tasks ?? []).map((t) => [
      t.item_id,
      t.sessions.map((x) => x.start_at),
    ]),
  );
  const ranged = owners
    ? matching.filter((i) => inBoardRange(i, range, now, plannedAt.get(i.id)))
    : matching;
  const boardCounts = boardFilterCounts(ranged, now, reviewCards.length);
  const visible = owners
    ? ranged.filter((i) => matchesBoardFilter(i, boardFilter, now))
    : filter === "all"
      ? matching
      : matching.filter((i) => i.status === filter);
  const empty =
    query.trim() || active
      ? emptySearch
      : filter !== "all" && items.length
        ? {
            title: `Nothing ${statusLabels[filter].toLowerCase()} right now.`,
            body: "Pick another status to see the rest of your plans.",
          }
        : emptyPlans;

  // Pinned smart lists: open items only, and each item shows once (in the
  // first that takes it: a late task planned today stays under Overdue).
  const open = visible.filter((i) => !isClosed(i.status));
  const taken = new Set<string>();
  // Grouped by who's on it, every task stays in its lane.
  const pinned =
    layout === "list" && group !== "owner"
      ? [
          { id: "overdue" as const, label: "Overdue" },
          ...PINNABLE.filter((p) => pins.includes(p.id)),
        ]
          .map((p) => ({
            key: p.id,
            title: p.label,
            items: open.filter(
              (i) =>
                !taken.has(i.id) &&
                matchesDue(i, p.id, now, plannedToday) &&
                !!taken.add(i.id),
            ),
          }))
          .filter((s) => s.items.length)
      : [];
  const pinnedIds = new Set(pinned.flatMap((s) => s.items.map((i) => i.id)));
  const rest = pinned.length
    ? visible.filter((i) => !pinnedIds.has(i.id))
    : visible;

  /** What groups are named from. */
  const names: GroupNames = {
    lists,
    tags,
    projects,
    userId,
    now,
    agentName,
    agents: agentWork,
  };
  /** The unpinned items split into titled groups (an item can sit in several tag groups). */
  const groups =
    group === "none"
      ? [
          {
            key: "all",
            title: pinned.length ? "Everything else" : "",
            items: rest,
            minutes: 0,
          },
        ]
      : groupTasks(rest, group, names);
  // The board: every column a card could go to (DATA-03).
  const columns =
    layout === "board"
      ? boardColumns(visible, boardGroup, names, {
          statuses:
            boardGroup === "status" && filter !== "all"
              ? [filter]
              : [...STATUSES],
          hideEmpty,
        })
      : [];
  const targets =
    layout === "board"
      ? boardColumns(items, boardGroup, names)
          // Nothing is moved into Review or a connected agent's lane.
          .filter((c) => c.key !== OWNER_REVIEW && !isAgentLane(c.key))
          .map(({ key, title }) => ({ key, title }))
      : [];
  const moveCard = (item: Item, from: string, to: string) => {
    const result = dropChange(item, boardGroup, from, to, names);
    if (!result) return;
    if (!result.ok) {
      setMoveError(result.reason);
      return;
    }
    setMoveError("");
    const change = result.change;
    if ("status" in change) onSetStatus(item, change.status);
    else onChangeItem?.(item, change);
  };

  // Subtasks sit under their parent when both are listed; folding hides them.
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggleFold = (id: string) =>
    setFolded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Manual order: drag a row onto another, or use its arrows.
  const manual = sort === "position";
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; before: boolean } | null>(
    null,
  );
  const [moveError, setMoveError] = useState("");
  const move = async (
    id: string,
    to: { before_id?: string; after_id?: string },
  ) => {
    setMoveError("");
    try {
      await client.moveItem(id, to);
      await onChanged?.();
    } catch (e) {
      setMoveError(errorText(e));
    }
  };

  /**
   * Rows for a list: subtasks go under a parent listed with them, and one
   * whose parent is elsewhere names it ("↳ Parent").
   */
  const itemById = new Map(items.map((i) => [i.id, i]));
  const rows = (list: Item[], tree = true) => {
    const ids = new Set(list.map((i) => i.id));
    const kids = new Map<string, Item[]>();
    if (tree)
      for (const i of list)
        if (i.parent_id && ids.has(i.parent_id))
          kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
    const top = tree
      ? list.filter((i) => !i.parent_id || !ids.has(i.parent_id))
      : list;
    const render = (level: Item[], depth: number): ReactNode[] =>
      level.map((i, n) => {
        const children = kids.get(i.id) ?? [];
        const isFolded = folded.has(i.id);
        const row = (
          <ItemRow
            key={i.id}
            item={i}
            index={n}
            busy={busy}
            readOnly={!canWrite(i)}
            score={sort === "score" ? i.score : undefined}
            parentTitle={
              i.parent_id && !ids.has(i.parent_id)
                ? itemById.get(i.parent_id)?.title
                : undefined
            }
            collapsed={children.length ? isFolded : undefined}
            onToggleChildren={
              children.length ? () => toggleFold(i.id) : undefined
            }
            onMoveUp={
              manual && n > 0
                ? () => void move(i.id, { before_id: level[n - 1].id })
                : undefined
            }
            onMoveDown={
              manual && n < level.length - 1
                ? () => void move(i.id, { after_id: level[n + 1].id })
                : undefined
            }
            onToggle={onToggle}
            onOpen={onOpen}
          />
        );
        const shown = manual ? (
          <div
            key={i.id}
            className={
              "reorder-row" +
              (dragId === i.id ? " is-dragging" : "") +
              (dropAt?.id === i.id
                ? dropAt.before
                  ? " is-drop-before"
                  : " is-drop-after"
                : "")
            }
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", i.id);
              setDragId(i.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropAt(null);
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === i.id) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const before = e.clientY < r.top + r.height / 2;
              if (dropAt?.id !== i.id || dropAt.before !== before)
                setDropAt({ id: i.id, before });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragId;
              const before = dropAt?.id === i.id ? dropAt.before : true;
              setDragId(null);
              setDropAt(null);
              if (from && from !== i.id)
                void move(
                  from,
                  before ? { before_id: i.id } : { after_id: i.id },
                );
            }}
          >
            {row}
          </div>
        ) : (
          row
        );
        if (!children.length || isFolded) return shown;
        return (
          <Fragment key={i.id}>
            {shown}
            <div
              className="task-children"
              role="group"
              aria-label={`Subtasks of ${i.title}`}
            >
              {render(children, depth + 1)}
            </div>
          </Fragment>
        );
      });
    return render(top, 0);
  };

  return (
    <section className="card tasks-card">
      {progressOpen && (
        <ProgressDialog onClose={() => setProgressOpen(false)} />
      )}
      <div className="section-heading tasks-heading workspace-task-toolbar">
        <h2>
          All items <span>{items.length}</span>
        </h2>
        <button
          className="secondary tasks-view-button"
          aria-haspopup="dialog"
          aria-label="Done this week"
          title="Done this week"
          onClick={() => setProgressOpen(true)}
        >
          <BadgeCheck size={14} aria-hidden="true" />{" "}
          <span>Done this week</span>
        </button>

        <div className="tasks-tools">
          <div className="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search items"
              placeholder="Search tasks"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </div>
          <button
            className="secondary tasks-view-button"
            aria-label="Saved view options"
            title="Saved view options"
            aria-haspopup="dialog"
            aria-expanded={!!viewMenu}
            onClick={(e) =>
              setViewMenu(
                viewMenu ? null : e.currentTarget.getBoundingClientRect(),
              )
            }
          >
            <Pin size={14} aria-hidden="true" /> <span>Views</span>
          </button>
          <div className="segmented" role="group" aria-label="Layout">
            <button
              aria-pressed={layout === "list"}
              className={layout === "list" ? "active" : ""}
              onClick={() => setLayout("list")}
            >
              <List size={15} aria-hidden="true" /> List
            </button>
            <button
              aria-pressed={layout === "board"}
              className={layout === "board" ? "active" : ""}
              onClick={() => setLayout("board")}
            >
              <Columns3 size={15} aria-hidden="true" /> Board
            </button>
          </div>
          <button
            type="button"
            className="secondary filters-toggle"
            aria-expanded={filtersOpen}
            aria-controls="task-filters"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            {activeFilters ? `Filters · ${activeFilters}` : "Filters"}
          </button>
        </div>
      </div>
      {viewMenu && (
        <Popover
          anchor={viewMenu}
          label="View options"
          onClose={() => setViewMenu(null)}
        >
          <div className="popover-head">
            <small className="eyebrow">PINNED AT THE TOP</small>
            <small>Overdue tasks are always pinned when there are some.</small>
          </div>
          <div className="popover-actions">
            {PINNABLE.map((p) => (
              <label key={p.id} className="popover-check">
                <input
                  type="checkbox"
                  checked={pins.includes(p.id)}
                  onChange={() => togglePin(p.id)}
                />
                <span>
                  {p.label}
                  <small>{p.hint}</small>
                </span>
              </label>
            ))}
          </div>
          {layout === "board" && (
            <>
              <small className="popover-note">
                Pinned lists show in the List layout.
              </small>
              <div className="popover-actions">
                <label className="popover-check">
                  <input
                    type="checkbox"
                    checked={hideEmpty}
                    onChange={(e) => setHideEmpty(e.target.checked)}
                  />
                  <span>
                    Hide empty columns
                    <small>Columns with no cards fold away</small>
                  </span>
                </label>
              </div>
            </>
          )}
        </Popover>
      )}
      <div
        id="task-filters"
        className={"filter-bar" + (filtersOpen ? " is-open" : "")}
        role="group"
        aria-label="Filters"
      >
        <label className="filter-select">
          <span>Due</span>
          <Select
            value={due}
            onChange={(e) => setDue(e.target.value as DueFilter)}
          >
            {DUE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="filter-select">
          <span>Priority</span>
          <Select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | "any")}
          >
            <option value="any">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </label>
        <label className="filter-select">
          <span>List</span>
          <Select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="any">Any list</option>
            <option value="none">No list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="filter-select">
          <span>Tag</span>
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="any">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="filter-select">
          <span>Size</span>
          <Select
            value={size}
            onChange={(e) => setSize(e.target.value as Size | "any")}
          >
            <option value="any">Any size</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {SIZE_LABELS[s]}
              </option>
            ))}
          </Select>
        </label>
        {hasTeamItems && (
          <label className="filter-select">
            <span>Assignee</span>
            <Select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="any">Anyone</option>
              {userId && <option value="me">Assigned to me</option>}
              <option value="none">Not assigned</option>
              {assignees
                .filter(([id]) => id !== userId)
                .map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
            </Select>
          </label>
        )}
        <label className="filter-select">
          <span>{layout === "board" ? "Columns" : "Group by"}</span>
          <Select
            value={shownGroup}
            onChange={(e) => setGroup(e.target.value as Group)}
          >
            {(layout === "board" ? [...BOARD_GROUPS] : LIST_GROUPS).map((g) => (
              <option key={g} value={g}>
                {GROUP_NAMES[g]}
              </option>
            ))}
          </Select>
        </label>
        <label className="filter-select">
          <span>Sort</span>
          <Select
            value={sort}
            onChange={(e) => {
              const next = e.target.value as ItemSort;
              setSortState(next);
              keepChoice({ sort: next });
              remember(SORT_KEY, next);
            }}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        {active && (
          <button className="text-button filter-clear" onClick={clear}>
            <X size={13} /> Clear filters
          </button>
        )}
      </div>
      {owners ? (
        <div className="board-tools">
          <div
            className="filter-chips"
            role="group"
            aria-label="Show on the board"
          >
            {BOARD_FILTERS.map((f) => (
              <button
                key={f}
                aria-pressed={boardFilter === f}
                className={boardFilter === f ? "active" : ""}
                onClick={() => setBoardFilter(f)}
              >
                {BOARD_FILTER_LABELS[f]}
                <span>{boardCounts[f]}</span>
              </button>
            ))}
          </div>
          <div className="board-range">
            <div className="segmented" role="group" aria-label="Dates">
              {BOARD_RANGES.map((k) => (
                <button
                  key={k}
                  aria-pressed={range.kind === k}
                  className={range.kind === k ? "active" : ""}
                  onClick={() => setRange((r) => ({ ...r, kind: k }))}
                >
                  {BOARD_RANGE_LABELS[k]}
                </button>
              ))}
            </div>
            {range.kind === "range" && (
              <div className="board-range-days">
                <DateField
                  aria-label="From"
                  value={range.from ?? ""}
                  onChange={(e) =>
                    setRange((r) => ({ ...r, from: e.target.value || null }))
                  }
                />
                <DateField
                  aria-label="To"
                  value={range.to ?? ""}
                  min={range.from ?? undefined}
                  onChange={(e) =>
                    setRange((r) => ({ ...r, to: e.target.value || null }))
                  }
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="filter-chips"
          role="group"
          aria-label="Filter by status"
        >
          {(["all", ...STATUSES] as Filter[]).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              className={
                (filter === f ? "active " : "") +
                (f === "all" ? "" : "tone-" + f)
              }
              onClick={() => setFilter(f)}
            >
              {f !== "all" && <i aria-hidden="true" />}
              {f === "all" ? "All" : statusLabels[f]}
              <span>{counts[f]}</span>
            </button>
          ))}
        </div>
      )}
      {moveError && (
        <div className="error" role="alert">
          {moveError}
        </div>
      )}
      {manual && layout === "list" && (
        <p className="tasks-hint">
          Drag rows, or use their arrows, to set the order. Items move within
          their own list, team or parent task.
        </p>
      )}
      {!visible.length && !owners ? (
        <EmptyState icon={ListTodo} title={empty.title} body={empty.body}>
          {!items.length && onNewItem && (
            <button className="primary" onClick={() => onNewItem({})}>
              Add task
            </button>
          )}
        </EmptyState>
      ) : layout === "board" ? (
        <TaskBoard
          columns={columns}
          by={boardGroup}
          targets={targets}
          parentOf={(i) =>
            i.parent_id ? itemById.get(i.parent_id)?.title : undefined
          }
          busy={busy}
          canWrite={canWrite}
          onOpen={onOpen}
          onMove={moveCard}
          onAdd={
            onNewItem && boardGroup !== "assignee" && boardGroup !== "owner"
              ? (key) => onNewItem(columnPrefill(boardGroup, key, names))
              : undefined
          }
          folded={folds}
          onToggleFold={toggleGroupFold}
          reviewCards={owners ? reviewCards : []}
          onOpenReview={onOpenReview}
          agentName={agentName}
          agentOf={(i) =>
            i.assignee_id
              ? undefined
              : agentWork.find((a) => a.item_ids.includes(i.id))?.name
          }
        />
      ) : (
        <>
          {pinned.map((s) => (
            <section
              key={s.key}
              className={"task-group task-pinned is-" + s.key}
              aria-label={`${s.title}, ${s.items.length}`}
            >
              <h3 className="task-group-title">
                <Pin size={12} aria-hidden="true" />
                {s.title}
                <span>{s.items.length}</span>
              </h3>
              {rows(s.items)}
            </section>
          ))}
          {group === "none" && !pinned.length
            ? rows(rest)
            : groups
                .filter((g) => g.items.length)
                .map((g) => {
                  const isFolded = folds.has(g.key);
                  return (
                    <section
                      key={g.key}
                      className={"task-group" + (isFolded ? " is-folded" : "")}
                      aria-label={`${g.title}, ${g.items.length}`}
                    >
                      <h3 className="task-group-title">
                        <button
                          type="button"
                          className="task-group-fold"
                          aria-expanded={!isFolded}
                          onClick={() => toggleGroupFold(g.key)}
                        >
                          {isFolded ? (
                            <ChevronRight size={14} aria-hidden="true" />
                          ) : (
                            <ChevronDown size={14} aria-hidden="true" />
                          )}
                          {g.color && (
                            <i
                              className="list-dot"
                              style={{ background: g.color }}
                              aria-hidden="true"
                            />
                          )}
                          {g.title}
                          <span>{g.items.length}</span>
                          {g.minutes > 0 && (
                            <small className="task-group-time">
                              {durationText(g.minutes)}
                            </small>
                          )}
                        </button>
                      </h3>
                      {!isFolded && rows(g.items)}
                    </section>
                  );
                })}
        </>
      )}
    </section>
  );
}
