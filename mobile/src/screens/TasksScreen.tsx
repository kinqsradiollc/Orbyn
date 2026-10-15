import { usePaneWidth } from "../hooks/usePaneWidth";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ITEM_SORTS,
  dueDayAt,
  plannedTodayIds,
  isClosed,
  searchItems,
  emptyPlans,
  emptySearch,
  statusLabels,
  statusOrder,
  BOARD_GROUPS,
  boardColumns,
  columnPrefill,
  dropChange,
  durationText,
  groupTasks,
  isBoardGroup,
  TASK_GROUP_LABELS,
  BOARD_FILTERS,
  BOARD_FILTER_LABELS,
  boardFilterCounts,
  isAgentLane,
  matchesBoardFilter,
  NO_GROUP,
  OWNER_REVIEW,
  type BoardFilter,
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
  type User,
  type ViewChoice,
} from "@orbyn/core";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { session } from "../lib/session";
import { Chip, ChipRow } from "../components/Chip";
import { Icon } from "../components/Icon";
import {
  EmptyState,
  ItemRows,
  SectionHeading,
  type ListHandlers,
  type Place,
} from "../components/PlannerList";
import { Segmented } from "../components/Segmented";
import { SmallAction } from "../components/SmallAction";
import {
  byPriority,
  dayStart,
  SIZE_LABELS,
  SIZES,
  sizeOf,
  type Size,
} from "../lib/planning";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { client } from "../lib/api";
import { openReview } from "../lib/review";
import { tap } from "../lib/haptics";
import { usePlanning } from "../lib/planningContext";
import { usePlanned } from "../lib/plannedContext";
import { isOverdue } from "../lib/progress";
import { Pressable } from "../motion";
import { colors, fonts, radii, spacing, themed, statusTones } from "../theme";
import { shared } from "../styles";

/** From this window width the board shows its status sections two across. */
const BOARD_WIDE = 700;

/** Case-insensitive match against the item's title and notes together. */
export const matchesSearch = (item: Item, search: string) =>
  (item.title + " " + item.notes).toLowerCase().includes(search.toLowerCase());

type StatusFilter = "all" | Status;
/** Every status, closed ones last (cancelled isn't a step, but it's a status). */
const BOARD_STATUSES: Status[] = [...statusOrder, "cancelled"];
const STATUS_FILTERS: StatusFilter[] = ["all", ...BOARD_STATUSES];
const statusFilterLabel = (f: StatusFilter) =>
  f === "all" ? "All" : statusLabels[f];

type Due = "any" | "overdue" | "today" | "tomorrow" | "soon" | "week" | "none";
type Group = TaskGroupBy;
type Filters = {
  due: Due;
  priority: "any" | Priority;
  /** "any", "none" or a list id. */
  list: string;
  /** "any" or a tag id. */
  tag: string;
  size: "any" | Size;
  /** "any", "me", "none" or a user id. */
  assignee: string;
  group: Group;
};
type Key = keyof Filters;

const DEFAULTS: Filters = {
  due: "any",
  priority: "any",
  list: "any",
  tag: "any",
  size: "any",
  assignee: "any",
  group: "none",
};
const KEYS: Key[] = [
  "due",
  "priority",
  "list",
  "tag",
  "size",
  "assignee",
  "group",
];
const KEY_LABELS: Record<Key, string> = {
  due: "Due",
  priority: "Priority",
  list: "List",
  tag: "Tag",
  size: "Size",
  assignee: "Assignee",
  group: "Group",
};
const DUE_LABELS: Record<Due, string> = {
  any: "Any time",
  overdue: "Overdue",
  today: "Today (planned or due)",
  tomorrow: "Tomorrow",
  soon: "Due soon",
  week: "This week",
  none: "No date",
};
const PRIORITY_LABELS: Record<"any" | Priority, string> = {
  any: "Any",
  high: "High",
  medium: "Medium",
  low: "Low",
};
const GROUPS: Group[] = [
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
const GROUP_LABELS: Record<Group, string> = {
  none: "No grouping",
  status: "By status",
  list: "By list",
  tag: "By tag",
  size: "By size",
  priority: "By priority",
  project: "By project",
  due_week: "By due week",
  assignee: "By assignee",
  owner: "By who's on it",
};
const GROUP_KEY = "orbyn-tasks-group";
/** The grouping chosen on this device. */
const savedGroup = (): Group => {
  const value = readLocal(GROUP_KEY);
  return GROUPS.find((g) => g === value) ?? "none";
};
/** What the board's columns are (DATA-03), remembered on this device. */
const BOARD_GROUP_KEY = "orbyn-tasks-board-group";
const savedBoardGroup = (): BoardGroupBy => {
  const value = readLocal(BOARD_GROUP_KEY);
  return BOARD_GROUPS.find((g) => g === value) ?? "status";
};
/** Folded groups, per layout and grouping (SecureStore keys take no colons). */
const foldKey = (layout: string, group: string) =>
  `orbyn-tasks-folded.${layout}.${group}`;
const savedFolds = (key: string) =>
  new Set((readLocal(key) ?? "").split(",").filter(Boolean));

type Layout = "list" | "board";
const LAYOUTS = ["list", "board"] as const;
const LAYOUT_LABELS: Record<Layout, string> = { list: "List", board: "Board" };
const LAYOUT_KEY = "orbyn-tasks-layout";
const savedLayout = (): Layout =>
  readLocal(LAYOUT_KEY) === "board" ? "board" : "list";

/** Sections pinned above the list. Overdue tasks always get one. */
type Pin = "today" | "tomorrow" | "soon";
const PINS: Pin[] = ["today", "tomorrow", "soon"];
const PIN_LABELS: Record<Pin, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  soon: "Due soon",
};
const PIN_KEY = "orbyn-task-pins";
/** The pins chosen on this device; all of them until someone changes it. */
const savedPins = (): Pin[] => {
  const raw = readLocal(PIN_KEY);
  if (raw === null) return PINS;
  const chosen = raw.split(",");
  return PINS.filter((p) => chosen.includes(p));
};

const SORT_LABELS: Record<ItemSort, string> = {
  newest: "Newest",
  score: "Priority score",
  due: "Due date",
  priority: "Priority",
  estimate: "Estimate",
  title: "Title",
  created: "Created",
  position: "Manual order",
};
const SORT_KEY = "orbyn-task-sort";
/** The order chosen on this device; most pressing first until then. */
const savedSort = (): ItemSort => {
  const value = readLocal(SORT_KEY);
  return ITEM_SORTS.find((s) => s === value) ?? "score";
};
const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
/** Earlier first; missing values (NaN) last. */
const ascending = (a: number, b: number) =>
  Number.isNaN(a) ? (Number.isNaN(b) ? 0 : 1) : Number.isNaN(b) ? -1 : a - b;
const time = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
/** An item's place in the manual order (newer servers send it). */
const position = (i: Item) =>
  (i as { position?: number | null }).position ?? NaN;

/**
 * The server's list orders (`GET /items?sort=`), applied to the loaded items.
 * "score" uses the priority score the server sends with each item, or the
 * local ranking when an older server sends none. Ties fall back to `rank`.
 */
function sorter(sort: ItemSort, rank: (a: Item, b: Item) => number) {
  const by = (compare: (a: Item, b: Item) => number) => (a: Item, b: Item) =>
    compare(a, b) || rank(a, b);
  switch (sort) {
    case "newest":
      return by((a, b) => ascending(time(b.created_at), time(a.created_at)));
    case "created":
      return by((a, b) => ascending(time(a.created_at), time(b.created_at)));
    case "due":
      return by((a, b) => ascending(time(a.due_at), time(b.due_at)));
    case "priority":
      return by(
        (a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority],
      );
    case "estimate":
      return by((a, b) =>
        ascending(a.estimate_minutes ?? NaN, b.estimate_minutes ?? NaN),
      );
    case "title":
      return by((a, b) => a.title.localeCompare(b.title));
    case "position":
      return by((a, b) => ascending(position(a), position(b)));
    default:
      return by((a, b) =>
        a.score === undefined && b.score === undefined
          ? 0
          : ascending(-(a.score ?? NaN), -(b.score ?? NaN)),
      );
  }
}

/**
 * Every item in the chosen order (most pressing first unless changed), as a
 * list or a board of status sections, both remembered on this device. Search,
 * status tabs and filters for due date, priority, list, tag, size and
 * assignee; the list view groups by list, tag or size.
 */
function TasksScreenBody({
  items,
  search,
  onSearch,
  user,
  onManageLists,
  onManageTags,
  onReorder,
  onDragging,
  onAddWith,
  onChangeItem,
  viewChoice,
  onViewChoice,
  ...handlers
}: ListHandlers & {
  /**
   * How the list was left, following the account (SHR-08): layout,
   * grouping, order and pinned sections, and saving a change to them.
   */
  viewChoice?: ViewChoice;
  onViewChoice?: (choice: ViewChoice) => void;
  items: Item[];
  search: string;
  onSearch: (search: string) => void;
  user: User | null;
  /** Opens the lists sheet (create, rename, recolour, delete). */
  onManageLists: () => void;
  /** Opens the tags sheet. */
  onManageTags: () => void;
  /** Manual order: move a task before or after another in its place. */
  onReorder?: (item: Item, place: Place) => void;
  /** A row is being dragged: the page holds still. */
  onDragging?: (dragging: boolean) => void;
  /** A board column's +: a new task starting with that column's value. */
  onAddWith?: (prefill: Partial<ItemInput>) => void;
  /** A card moved to another column: its list, priority, assignee or tags. */
  onChangeItem?: (item: Item, change: ColumnChange) => void;
}) {
  const { lists, tags } = usePlanning();
  const { feed } = usePlanned();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULTS,
    group: savedGroup(),
  }));
  const [open, setOpen] = useState<Key | "pins" | "sort" | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [choiceQuery, setChoiceQuery] = useState("");
  const afterTools = useRef<{ owner: string; run: () => void } | null>(null);
  useEffect(() => setChoiceQuery(""), [open]);
  const closeToolsThen = (run: () => void) => {
    afterTools.current = { owner: session.token, run };
    setShowTools(false);
  };
  const [pins, setPins] = useState<Pin[]>(savedPins);
  const [sort, setSort] = useState<ItemSort>(savedSort);
  const [layout, setLayout] = useState<Layout>(savedLayout);
  const [boardGroup, setBoardGroup] = useState<BoardGroupBy>(savedBoardGroup);
  // The account's choices, when they arrive, win over this phone's copy.
  useEffect(() => {
    if (!viewChoice) return;
    if (viewChoice.layout === "list" || viewChoice.layout === "board")
      setLayout(viewChoice.layout);
    if (viewChoice.sort && ITEM_SORTS.includes(viewChoice.sort as ItemSort))
      setSort(viewChoice.sort as ItemSort);
    if (viewChoice.group && (GROUPS as string[]).includes(viewChoice.group))
      setFilters((f) => ({ ...f, group: viewChoice.group as never }));
    if (viewChoice.pins)
      setPins(PINS.filter((p) => viewChoice.pins!.includes(p)));
  }, [
    viewChoice?.layout,
    viewChoice?.sort,
    viewChoice?.group,
    viewChoice?.pins?.join(),
  ]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownGroup: Group = layout === "board" ? boardGroup : filters.group;
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
    // SecureStore can't keep an empty value.
    saveLocal(foldKey(layout, shownGroup), [...next].join(",") || ",");
  };
  /** A card picked up on the board (long press), waiting for its column. */
  const [picked, setPicked] = useState<{ item: Item; from: string } | null>(
    null,
  );
  const [moveNote, setMoveNote] = useState("");
  const [moveQuery, setMoveQuery] = useState("");
  useEffect(() => setMoveQuery(""), [picked?.item.id]);
  const owner = session.token;
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [detailsRetry, setDetailsRetry] = useState(0);
  const [projectError, setProjectError] = useState(false);
  const needsProjects = shownGroup === "project";
  useEffect(() => {
    if (!needsProjects) return;
    let live = true;
    setProjectError(false);
    client.listProjects().then(
      (all) => {
        if (live && session.token === owner)
          setProjects(all.map(({ id, name }) => ({ id, name })));
      },
      () => {
        if (live && session.token === owner) {
          setProjects([]);
          setProjectError(true);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [needsProjects, owner, detailsRetry]);
  const owners = shownGroup === "owner";
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [agentName, setAgentName] = useState("Orbyn");
  const [agentWork, setAgentWork] = useState<
    { grant_id: string; name: string; item_ids: string[] }[]
  >([]);
  const [reviewCards, setReviewCards] = useState<ReviewItem[]>([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersError, setOwnersError] = useState(false);
  const itemsKey = items
    .map((i) => `${i.id}:${i.version}:${i.agent_state ?? ""}`)
    .join();
  useEffect(() => {
    if (!owners) return;
    let live = true;
    setOwnersLoading(true);
    setOwnersError(false);
    const current = () => live && session.token === owner;
    void Promise.all([
      client.agentSettings(),
      client.agentWork(),
      client.reviewInbox(),
    ])
      .then(
        ([settings, work, inbox]) => {
          if (!current()) return;
          setAgentName(settings.name || "Orbyn");
          setAgentWork(work);
          setReviewCards(inbox.pending);
        },
        () => {
          if (!current()) return;
          setAgentWork([]);
          setReviewCards([]);
          setOwnersError(true);
        },
      )
      .finally(() => {
        if (current()) setOwnersLoading(false);
      });
    return () => {
      live = false;
    };
  }, [owners, itemsKey, owner, detailsRetry]);
  const { width: paneWidth, onLayout: measurePane } = usePaneWidth();
  const twoColumns = paneWidth >= BOARD_WIDE;
  const now = new Date();
  /**
   * Whether the day a task is due by (`dueDayAt`: an all-day task's last
   * day) falls between local midnights `from` and `to` days away.
   */
  const within = (i: Item, from: number, to: number) => {
    const due = dueDayAt(i);
    return !!due && due >= dayStart(from, now) && due < dayStart(to, now);
  };
  // "Today" is planned or due today: tasks with a session of yours today too.
  const plannedToday = plannedTodayIds(feed, now);
  const today = (i: Item) => within(i, 0, 1) || plannedToday.has(i.id);

  // The assignee filter only means something with team items.
  const hasTeamItems = items.some((i) => i.team_id);
  const keys = KEYS.filter((k) => k !== "assignee" || hasTeamItems);
  const assignee = hasTeamItems ? filters.assignee : "any";
  const people = new Map<string, string>();
  for (const i of items)
    if (i.assignee_id && i.assignee_id !== user?.id)
      people.set(i.assignee_id, i.assignee_name || "Someone");

  const matches = (i: Item) => {
    const dueOk =
      filters.due === "any" ||
      (filters.due === "none" && !i.due_at) ||
      (filters.due === "overdue" && isOverdue(i, now)) ||
      (filters.due === "today" && today(i)) ||
      (filters.due === "tomorrow" && within(i, 1, 2)) ||
      // Due soon: the rest of the coming week, after today and tomorrow.
      (filters.due === "soon" && within(i, 2, 7)) ||
      // This week: from today through Saturday (weeks start on Sunday).
      (filters.due === "week" && within(i, 0, 7 - now.getDay()));
    const listOk =
      filters.list === "any" ||
      (filters.list === "none" ? !i.list_id : i.list_id === filters.list);
    const tagOk =
      filters.tag === "any" || (i.tag_ids ?? []).includes(filters.tag);
    const assigneeOk =
      assignee === "any" ||
      (assignee === "none"
        ? // Unassigned: team items nobody has taken yet.
          !!i.team_id && !i.assignee_id
        : assignee === "me"
          ? !!user && i.assignee_id === user.id
          : i.assignee_id === assignee);
    return (
      dueOk &&
      listOk &&
      tagOk &&
      assigneeOk &&
      (filters.priority === "any" || i.priority === filters.priority) &&
      (filters.size === "any" || sizeOf(i) === filters.size)
    );
  };

  const found = searchItems(items, search).filter(matches);
  const count = (f: StatusFilter) =>
    f === "all" ? found.length : found.filter((i) => i.status === f).length;
  const order = sorter(sort, byPriority(now, items));
  // Finished and cancelled items always go last, whatever the order.
  const boardCounts = boardFilterCounts(found, now, reviewCards.length);
  const visible = found
    .filter((i) =>
      owners
        ? matchesBoardFilter(i, boardFilter, now)
        : status === "all" || i.status === status,
    )
    .sort(
      (a, b) =>
        Number(isClosed(a.status)) - Number(isClosed(b.status)) || order(a, b),
    );
  const chooseSort = (next: ItemSort) => {
    setSort(next);
    setOpen(null);
    saveLocal(SORT_KEY, next);
    keep({ sort: next });
  };
  const chooseLayout = (next: Layout) => {
    setLayout(next);
    saveLocal(LAYOUT_KEY, next);
    keep({ layout: next });
  };
  /** Save a change to how the list is shown, for every device. */
  const keep = (change: ViewChoice) =>
    onViewChoice?.({
      layout,
      sort,
      group: filters.group,
      pins,
      ...change,
    });

  const options: Record<
    Key,
    { value: string; label: string; color?: string }[]
  > = {
    due: (Object.keys(DUE_LABELS) as Due[]).map((value) => ({
      value,
      label: DUE_LABELS[value],
    })),
    priority: (Object.keys(PRIORITY_LABELS) as ("any" | Priority)[]).map(
      (value) => ({ value, label: PRIORITY_LABELS[value] }),
    ),
    list: [
      { value: "any", label: "Any list" },
      { value: "none", label: "No list" },
      ...lists.map((l) => ({
        value: l.id,
        label: l.team_name ? `${l.name} · ${l.team_name}` : l.name,
        color: l.color,
      })),
    ],
    tag: [
      { value: "any", label: "Any tag" },
      ...tags.map((t) => ({ value: t.id, label: t.name, color: t.color })),
    ],
    size: [
      { value: "any", label: "Any size" },
      ...SIZES.map((value) => ({ value, label: SIZE_LABELS[value] })),
    ],
    assignee: [
      { value: "any", label: "Anyone" },
      { value: "me", label: "Me" },
      { value: "none", label: "Unassigned" },
      ...[...people].map(([value, label]) => ({ value, label })),
    ],
    group:
      layout === "board"
        ? BOARD_GROUPS.map((value) => ({
            value,
            label: `By ${TASK_GROUP_LABELS[value].toLowerCase()}`,
          }))
        : GROUPS.map((value) => ({ value, label: GROUP_LABELS[value] })),
  };
  const valueOf = (key: Key) =>
    key === "group" && layout === "board" ? boardGroup : filters[key];
  const choiceOptions =
    open === "sort"
      ? ITEM_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }))
      : open && open !== "pins"
        ? options[open]
        : [];
  const choiceMatches = choiceOptions.filter((option) =>
    option.label
      .toLocaleLowerCase()
      .includes(choiceQuery.trim().toLocaleLowerCase()),
  );
  const current = (key: Key) =>
    options[key].find((o) => o.value === valueOf(key))?.label ?? "Any";
  const active = keys.filter((k) => k !== "group" && filters[k] !== "any");
  const set = (key: Key, value: string) => {
    if (key === "group" && layout === "board") {
      if (!isBoardGroup(value)) return;
      setBoardGroup(value);
      setPicked(null);
      setOpen(null);
      saveLocal(BOARD_GROUP_KEY, value);
      return;
    }
    setFilters((f) => ({ ...f, [key]: value }));
    setOpen(null);
    if (key === "group") {
      saveLocal(GROUP_KEY, value);
      keep({ group: value });
    }
  };

  // Pinned sections: open tasks by when they're due, each in one section only.
  // A due filter is already a smart list, so it shows without them.
  const pinnedAs = (i: Item): "overdue" | Pin | null => {
    if (isClosed(i.status)) return null;
    if (i.due_at && isOverdue(i, now)) return "overdue";
    if (today(i)) return "today";
    if (!i.due_at) return null;
    if (within(i, 1, 2)) return "tomorrow";
    return within(i, 2, 7) ? "soon" : null;
  };
  // Grouped by who's on it, every task stays in its lane.
  const sections =
    filters.due === "any" && !owners
      ? (["overdue", ...PINS] as const)
          .filter((key) => key === "overdue" || pins.includes(key))
          .map((key) => ({
            key,
            items: visible.filter((i) => pinnedAs(i) === key),
          }))
          .filter((section) => section.items.length > 0)
      : [];
  const pinned = new Set(
    sections.flatMap((section) => section.items.map((i) => i.id)),
  );
  const rest = visible.filter((i) => !pinned.has(i.id));
  const togglePin = (p: Pin) => {
    const next = pins.includes(p)
      ? pins.filter((x) => x !== p)
      : PINS.filter((x) => x === p || pins.includes(x));
    setPins(next);
    // SecureStore can't keep an empty value.
    saveLocal(PIN_KEY, next.join(",") || "none");
    keep({ pins: next });
  };

  const names: GroupNames = {
    lists,
    tags,
    projects,
    userId: user?.id,
    now,
    agentName,
    agents: agentWork,
  };
  const groups = groupTasks(rest, filters.group, names);
  // The board: every column a card could go to (DATA-03).
  const columns =
    layout === "board"
      ? boardColumns(visible, boardGroup, names, {
          statuses:
            boardGroup === "status"
              ? status === "all"
                ? BOARD_STATUSES
                : [status]
              : undefined,
        })
      : [];
  // Nothing is moved into Review or a connected agent's lane.
  const targets =
    layout === "board"
      ? boardColumns(items, boardGroup, names).filter(
          (c) => c.key !== OWNER_REVIEW && !isAgentLane(c.key),
        )
      : [];
  /** What waits in Review, as rows that open it (the "Needs review" lane). */
  const reviewRows = (
    <View style={s.reviewList}>
      {reviewCards.length ? (
        reviewCards.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Review: ${p.summary}`}
            onPress={() => openReview(p.id)}
            style={s.reviewRow}
          >
            <Text style={s.reviewTitle}>{p.summary}</Text>
            <Text style={s.reviewMeta}>
              {p.source === "assistant" ? agentName : p.proposer} ·{" "}
              {p.changes.length === 1
                ? "1 change"
                : `${p.changes.length} changes`}
            </Text>
          </Pressable>
        ))
      ) : (
        <View style={s.emptyColumn}>
          <Text style={shared.small}>
            {ownersLoading
              ? "Loading reviews…"
              : ownersError
                ? "Reviews unavailable"
                : "Nothing waiting for review"}
          </Text>
        </View>
      )}
    </View>
  );
  /** Drop the picked-up card on a column. */
  const dropOn = (to: string) => {
    if (!picked || handlers.busy) return;
    const currentItem = items.find((item) => item.id === picked.item.id);
    if (!currentItem) {
      setPicked(null);
      return;
    }
    const result = dropChange(currentItem, boardGroup, picked.from, to, names);
    if (!result) return;
    if (!result.ok) {
      setMoveNote(result.reason);
      return;
    }
    tap();
    setPicked(null);
    setMoveNote("");
    const change = result.change;
    if ("status" in change) handlers.onSetStatus?.(currentItem, change.status);
    else onChangeItem?.(currentItem, change);
  };
  const rowProps = {
    busy: handlers.busy,
    onToggle: handlers.onToggle,
    onOpen: handlers.onOpen,
    canToggle: handlers.canToggle,
    onSetStatus: handlers.onSetStatus,
    showScore: sort === "score",
  };
  const manual = sort === "position" && !!onReorder;
  // The list nests subtasks under their tasks; in manual order rows drag.
  const listRowProps = {
    ...rowProps,
    nest: true,
    onReorder: manual ? onReorder : undefined,
    onDragging,
  };
  const title = status === "all" ? "All items" : statusLabels[status];
  const empty =
    search.trim() || active.length
      ? emptySearch
      : status === "all"
        ? emptyPlans
        : {
            title: `No ${statusLabels[status].toLowerCase()} tasks`,
            body: "",
          };

  return (
    <View onLayout={measurePane} style={{ width: "100%" }}>
      <View style={s.search}>
        <View style={s.icon} pointerEvents="none">
          <Icon name="search" size={17} color={colors.muted} />
        </View>
        <TextInput
          style={[shared.input, s.input]}
          placeholder="Search tasks"
          placeholderTextColor={colors.faint}
          value={search}
          onChangeText={onSearch}
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel="Search your plans"
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.chipScroll}
        contentContainerStyle={s.chips}
        accessibilityRole="tablist"
        accessibilityLabel={owners ? "Show" : "Filter by status"}
      >
        {owners &&
          BOARD_FILTERS.map((f) => {
            const selected = f === boardFilter;
            const n =
              (f === "needs_review" || f === "all") &&
              (ownersLoading || ownersError)
                ? null
                : boardCounts[f];
            return (
              <Pressable
                key={f}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${BOARD_FILTER_LABELS[f]}, ${n ?? "count unavailable"}`}
                onPress={() => {
                  setBoardFilter(f);
                }}
                style={[s.chip, selected && s.chipSoft]}
              >
                <Text style={[s.chipText, selected && s.chipSoftText]}>
                  {BOARD_FILTER_LABELS[f]}
                </Text>
                <Text style={[s.chipCount, selected && s.chipSoftText]}>
                  {n ?? "—"}
                </Text>
              </Pressable>
            );
          })}
        {!owners &&
          STATUS_FILTERS.map((f) => {
            const selected = f === status;
            const tone = f === "all" ? null : statusTones[f];
            const n = count(f);
            return (
              <Pressable
                key={f}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${statusFilterLabel(f)}, ${n} item${n === 1 ? "" : "s"}`}
                onPress={() => {
                  setStatus(f);
                }}
                style={[
                  s.chip,
                  selected && {
                    backgroundColor: tone?.bg ?? colors.accentSoft,
                    borderColor: tone?.fg ?? colors.accent,
                  },
                ]}
              >
                {tone && <View style={[s.dot, { backgroundColor: tone.fg }]} />}
                <Text
                  style={[
                    s.chipText,
                    selected && { color: tone?.fg ?? colors.accent },
                  ]}
                >
                  {statusFilterLabel(f)}
                </Text>
                <Text
                  style={[
                    s.chipCount,
                    selected && { color: tone?.fg ?? colors.accent },
                  ]}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filters and view${active.length ? `, ${active.length} active` : ""}`}
        accessibilityState={{ expanded: showTools }}
        onPress={() => {
          setShowTools(true);
          setOpen(null);
        }}
        style={s.toolsToggle}
      >
        <Icon name="filter" size={16} color={colors.accent} />
        <Text style={s.toolsLabel}>
          Filters & view{active.length ? ` · ${active.length} active` : ""}
        </Text>
        <Text style={s.toolsSummary}>
          {LAYOUT_LABELS[layout]} · {SORT_LABELS[sort]}
        </Text>
        <Icon name="chevronRight" size={16} color={colors.muted} />
      </Pressable>
      {active.length > 0 && (
        <View style={s.activeFilters}>
          {active.map((key) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${KEY_LABELS[key]} filter: ${current(key)}`}
              style={s.activeFilter}
              onPress={() => set(key, "any")}
            >
              <Text style={s.filterText}>
                {KEY_LABELS[key]}: {current(key)}
              </Text>
              <Icon name="x" size={14} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      )}
      <BottomSheet
        visible={showTools}
        title={
          open === "pins"
            ? "Pinned sections"
            : open === "sort"
              ? "Sort tasks"
              : open
                ? KEY_LABELS[open]
                : "Filters and view"
        }
        onClose={() => {
          afterTools.current = null;
          setShowTools(false);
        }}
        afterClose={() => {
          const next = afterTools.current;
          afterTools.current = null;
          if (next?.owner === session.token) next.run();
        }}
        footer={<Button title="Done" onPress={() => setShowTools(false)} />}
      >
        {open ? (
          <View style={s.choicePage}>
            <SmallAction
              label="Back"
              disabled={false}
              onPress={() => setOpen(null)}
            />
            {open === "pins" ? (
              <>
                <ChipRow label="Pinned sections" multi>
                  {PINS.map((pin) => (
                    <Chip
                      key={pin}
                      multi
                      label={PIN_LABELS[pin]}
                      selected={pins.includes(pin)}
                      onPress={() => togglePin(pin)}
                    />
                  ))}
                </ChipRow>
                <Text style={shared.small}>Overdue is always shown.</Text>
              </>
            ) : (
              <>
                <TextInput
                  style={shared.input}
                  value={choiceQuery}
                  onChangeText={setChoiceQuery}
                  accessibilityLabel="Search choices"
                  placeholder="Search choices"
                  placeholderTextColor={colors.faint}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <ScrollView
                  style={s.choiceList}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {choiceMatches.map((option) => {
                    const selected =
                      open === "sort"
                        ? sort === option.value
                        : valueOf(open) === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        style={[s.choiceRow, selected && s.choiceSelected]}
                        onPress={() =>
                          open === "sort"
                            ? chooseSort(option.value as ItemSort)
                            : set(open, option.value)
                        }
                      >
                        <Text style={s.choiceText}>{option.label}</Text>
                        {selected && (
                          <Icon name="check" size={16} color={colors.accent} />
                        )}
                      </Pressable>
                    );
                  })}
                  {!choiceMatches.length && (
                    <Text style={shared.small}>No matching choices</Text>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        ) : (
          <View style={s.choicePage}>
            <Segmented
              accessibilityLabel="Layout"
              options={LAYOUTS}
              labels={LAYOUT_LABELS}
              value={layout}
              onChange={chooseLayout}
            />
            {keys.map((key) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={`${KEY_LABELS[key]}: ${current(key)}`}
                style={s.choiceRow}
                onPress={() => setOpen(key)}
              >
                <View style={s.choiceValue}>
                  <Text style={s.choiceLabel}>{KEY_LABELS[key]}</Text>
                  <Text style={s.choiceText}>{current(key)}</Text>
                </View>
                <Icon name="chevronRight" size={16} color={colors.muted} />
              </Pressable>
            ))}
            <SmallAction
              label={`Sort: ${SORT_LABELS[sort]}`}
              disabled={false}
              onPress={() => setOpen("sort")}
            />
            <SmallAction
              label="Pinned sections"
              disabled={false}
              onPress={() => setOpen("pins")}
            />
            {active.length > 0 && (
              <SmallAction
                label="Clear filters"
                disabled={false}
                onPress={() =>
                  setFilters((filters) => ({
                    ...DEFAULTS,
                    group: filters.group,
                  }))
                }
              />
            )}
            <View style={s.toolbarActions}>
              <SmallAction
                label="Tags"
                disabled={handlers.busy}
                onPress={() => closeToolsThen(onManageTags)}
              />
              <SmallAction
                label="Lists"
                disabled={handlers.busy}
                onPress={() => closeToolsThen(onManageLists)}
              />
            </View>
          </View>
        )}
      </BottomSheet>
      {manual && layout === "list" && visible.length > 1 && (
        <Text style={[shared.small, s.manualHint]}>
          Hold and drag within the same list or parent task.
        </Text>
      )}
      {(projectError || ownersError) && (
        <View style={s.feedback}>
          <Text style={s.moveNote}>
            Couldn't load {projectError ? "project names" : "ownership details"}
            .
          </Text>
          <SmallAction
            label="Retry"
            disabled={false}
            onPress={() => setDetailsRetry((n) => n + 1)}
          />
        </View>
      )}
      {owners && ownersLoading && (
        <Text style={shared.small}>Loading ownership…</Text>
      )}

      {visible.length === 0 &&
      !(owners && (reviewCards.length || ownersLoading || ownersError)) ? (
        <>
          <SectionHeading title={title} count={0} />
          <EmptyState {...empty} action="Add task" onAction={handlers.onAdd} />
        </>
      ) : layout === "board" ? (
        // One section per column; a long press picks a card up and a tap on
        // a column chip puts it down there (DATA-03). On a wide screen the
        // sections sit two across.
        <>
          <BottomSheet
            visible={!!picked}
            title="Move task"
            closeDisabled={handlers.busy}
            onClose={() => {
              if (!handlers.busy) setPicked(null);
            }}
            footer={
              <Button
                title="Cancel"
                secondary
                disabled={handlers.busy}
                onPress={() => setPicked(null)}
              />
            }
          >
            <View style={s.choicePage}>
              <Text style={s.pickTitle}>{picked?.item.title}</Text>
              {!!moveNote && (
                <Text accessibilityRole="alert" style={s.moveNote}>
                  {moveNote}
                </Text>
              )}
              <TextInput
                style={shared.input}
                value={moveQuery}
                onChangeText={setMoveQuery}
                accessibilityLabel="Search columns"
                placeholder="Search columns"
                placeholderTextColor={colors.faint}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!handlers.busy}
              />
              <ScrollView
                style={s.choiceList}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {targets
                  .filter(
                    (column) =>
                      column.key !== picked?.from &&
                      column.title
                        .toLocaleLowerCase()
                        .includes(moveQuery.trim().toLocaleLowerCase()),
                  )
                  .map((column) => (
                    <Pressable
                      key={column.key}
                      accessibilityRole="button"
                      disabled={handlers.busy}
                      style={s.choiceRow}
                      onPress={() => dropOn(column.key)}
                    >
                      <Text style={s.choiceText}>{column.title}</Text>
                    </Pressable>
                  ))}
                {!targets.some(
                  (column) =>
                    column.key !== picked?.from &&
                    column.title
                      .toLocaleLowerCase()
                      .includes(moveQuery.trim().toLocaleLowerCase()),
                ) && <Text style={shared.small}>No matching columns</Text>}
              </ScrollView>
            </View>
          </BottomSheet>
          {!!moveNote && (
            <Text
              style={[shared.small, s.moveNote]}
              onPress={() => setMoveNote("")}
            >
              {moveNote}
            </Text>
          )}
          <View style={twoColumns && columns.length > 1 && s.board}>
            {columns.map((column) => {
              const folded = folds.has(column.key);
              return (
                <View
                  key={column.key}
                  style={twoColumns && columns.length > 1 && s.boardColumn}
                >
                  <SectionHeading
                    title={column.title}
                    count={
                      owners && column.key === OWNER_REVIEW
                        ? ownersLoading || ownersError
                          ? undefined
                          : reviewCards.length
                        : column.items.length
                    }
                    time={
                      column.minutes ? durationText(column.minutes) : undefined
                    }
                    color={
                      boardGroup === "status"
                        ? statusTones[column.key as Status]?.fg
                        : column.color
                    }
                    folded={folded}
                    onToggleFold={() => toggleFold(column.key)}
                    onAdd={
                      onAddWith &&
                      boardGroup !== "assignee" &&
                      boardGroup !== "owner"
                        ? () =>
                            onAddWith(
                              columnPrefill(boardGroup, column.key, names),
                            )
                        : undefined
                    }
                  />
                  {folded ? null : owners && column.key === OWNER_REVIEW ? (
                    reviewRows
                  ) : column.items.length > 0 ? (
                    <ItemRows
                      items={column.items}
                      {...rowProps}
                      moveButton={boardGroup === "status"}
                      onPickUp={(item) => {
                        if (!handlers.busy)
                          setPicked({ item, from: column.key });
                      }}
                    />
                  ) : (
                    <View style={s.emptyColumn}>
                      <Text style={shared.small}>Nothing here yet.</Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <>
          {sections.map((section) => (
            <View key={section.key}>
              <SectionHeading
                title={
                  section.key === "overdue"
                    ? "Overdue"
                    : PIN_LABELS[section.key]
                }
                count={section.items.length}
                hint={
                  section.key === "overdue"
                    ? "Due before today and still open"
                    : section.key === "today"
                      ? "Planned or due today"
                      : undefined
                }
              />
              <ItemRows items={section.items} {...listRowProps} />
            </View>
          ))}
          {rest.length > 0 &&
            groups.map((g) => {
              const grouped = filters.group !== "none";
              const folded = grouped && folds.has(g.key);
              return (
                <View key={g.key}>
                  {owners && g.key === NO_GROUP && (
                    <>
                      <SectionHeading
                        title="Needs review"
                        count={
                          ownersLoading || ownersError
                            ? undefined
                            : reviewCards.length
                        }
                        folded={folds.has(OWNER_REVIEW)}
                        onToggleFold={() => toggleFold(OWNER_REVIEW)}
                      />
                      {!folds.has(OWNER_REVIEW) && reviewRows}
                    </>
                  )}
                  <SectionHeading
                    title={
                      grouped
                        ? g.title
                        : sections.length
                          ? "Everything else"
                          : title
                    }
                    count={g.items.length}
                    color={g.color}
                    time={
                      grouped && g.minutes ? durationText(g.minutes) : undefined
                    }
                    folded={folded}
                    onToggleFold={grouped ? () => toggleFold(g.key) : undefined}
                  />
                  {!folded && <ItemRows items={g.items} {...listRowProps} />}
                </View>
              );
            })}
          {owners && !groups.some((g) => g.key === NO_GROUP) && (
            <View>
              <SectionHeading
                title="Needs review"
                count={
                  ownersLoading || ownersError ? undefined : reviewCards.length
                }
                folded={folds.has(OWNER_REVIEW)}
                onToggleFold={() => toggleFold(OWNER_REVIEW)}
              />
              {!folds.has(OWNER_REVIEW) && reviewRows}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    search: { marginBottom: 12, justifyContent: "center" },
    icon: { position: "absolute", left: 15, zIndex: 1 },
    input: { paddingLeft: 42 },
    chipScroll: { marginHorizontal: -spacing.page, marginBottom: 10 },
    choicePage: { gap: 8, minWidth: 0 },
    choiceList: { maxHeight: 300 },
    choiceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radii.input,
    },
    choiceSelected: { backgroundColor: colors.accentSoft },
    choiceValue: { flex: 1, minWidth: 0, gap: 2 },
    choiceLabel: {
      color: colors.muted,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
    choiceText: {
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
      flexShrink: 1,
    },
    activeFilters: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    activeFilter: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: "100%",
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    feedback: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    toolsToggle: {
      minHeight: 44,
      flexWrap: "wrap",
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 14,
      marginBottom: 14,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    toolsLabel: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    toolsSummary: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 110,
      minWidth: 0,
      textAlign: "right",
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.muted,
    },
    chips: { gap: 8, paddingHorizontal: spacing.page },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      // The status filters are the most-tapped control on this screen, and
      // were the last ones still under a finger's width.
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 13,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    dot: { width: 7, height: 7, borderRadius: radii.pill },
    chipText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    chipCount: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    filterText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.muted,
    },
    manualHint: { marginTop: -4, marginBottom: 14 },
    toolbarActions: { flexDirection: "row", gap: 8 },
    /** The board on a wide screen: status sections two across. */
    board: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -8 },
    boardColumn: { width: "50%", paddingHorizontal: 8 },
    pickTitle: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    moveNote: { marginBottom: 12, color: colors.danger },
    chipSoft: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    chipSoftText: { color: colors.accent },
    reviewList: { gap: 8, marginBottom: 22 },
    reviewRow: {
      gap: 4,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    reviewTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    reviewMeta: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    emptyColumn: {
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      borderRadius: radii.card,
      paddingVertical: 14,
      paddingHorizontal: 16,
      marginBottom: 22,
    },
  }),
);

/** Account changes cannot retain stale owner names, selections or overlays. */
export function TasksScreen(
  props: React.ComponentProps<typeof TasksScreenBody>,
) {
  return (
    <TasksScreenBody
      key={`${session.token}:${props.user?.id ?? ""}`}
      {...props}
    />
  );
}
