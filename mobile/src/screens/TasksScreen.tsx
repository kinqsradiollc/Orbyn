import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  ITEM_SORTS,
  isClosed,
  searchItems,
  emptyPlans,
  emptySearch,
  statusLabels,
  statusOrder,
  type Item,
  type ItemSort,
  type Priority,
  type Status,
  type TaskList,
  type User,
} from "@orbyn/core";
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
import { usePlanning } from "../lib/planningContext";
import { isOverdue } from "../lib/progress";
import { animateLayout, PressableScale } from "../motion";
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
type Group = "none" | "list" | "tag" | "size";
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
  today: "Today",
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
const GROUPS: Group[] = ["none", "list", "tag", "size"];
const GROUP_LABELS: Record<Group, string> = {
  none: "No grouping",
  list: "By list",
  tag: "By tag",
  size: "By size",
};
const GROUP_KEY = "orbyn-tasks-group";
/** The grouping chosen on this device. */
const savedGroup = (): Group => {
  const value = readLocal(GROUP_KEY);
  return GROUPS.find((g) => g === value) ?? "none";
};

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
export function TasksScreen({
  items,
  search,
  onSearch,
  user,
  onManageLists,
  onManageTags,
  onReorder,
  onDragging,
  ...handlers
}: ListHandlers & {
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
}) {
  const { lists, tags, listById, tagById } = usePlanning();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULTS,
    group: savedGroup(),
  }));
  const [open, setOpen] = useState<Key | "pins" | "sort" | null>(null);
  const [showTools, setShowTools] = useState(false);
  const [pins, setPins] = useState<Pin[]>(savedPins);
  const [sort, setSort] = useState<ItemSort>(savedSort);
  const [layout, setLayout] = useState<Layout>(savedLayout);
  const twoColumns = useWindowDimensions().width >= BOARD_WIDE;
  const now = new Date();
  /** Whether a due date falls between local midnights `from` and `to` days away. */
  const within = (i: Item, from: number, to: number) => {
    if (!i.due_at) return false;
    const due = new Date(i.due_at);
    return due >= dayStart(from, now) && due < dayStart(to, now);
  };

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
      (filters.due === "today" && within(i, 0, 1)) ||
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
  const order = sorter(sort, byPriority(now));
  // Finished and cancelled items always go last, whatever the order.
  const visible = found
    .filter((i) => status === "all" || i.status === status)
    .sort(
      (a, b) =>
        Number(isClosed(a.status)) - Number(isClosed(b.status)) || order(a, b),
    );
  const chooseSort = (next: ItemSort) => {
    animateLayout();
    setSort(next);
    setOpen(null);
    saveLocal(SORT_KEY, next);
  };
  const chooseLayout = (next: Layout) => {
    animateLayout();
    setLayout(next);
    saveLocal(LAYOUT_KEY, next);
  };

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
    group: GROUPS.map((value) => ({ value, label: GROUP_LABELS[value] })),
  };
  const current = (key: Key) =>
    options[key].find((o) => o.value === filters[key])?.label ?? "Any";
  const active = keys.filter((k) => k !== "group" && filters[k] !== "any");
  const set = (key: Key, value: string) => {
    animateLayout();
    setFilters((f) => ({ ...f, [key]: value }));
    if (key === "group") saveLocal(GROUP_KEY, value);
  };

  // Pinned sections: open tasks by when they're due, each in one section only.
  // A due filter is already a smart list, so it shows without them.
  const pinnedAs = (i: Item): "overdue" | Pin | null => {
    if (isClosed(i.status) || !i.due_at) return null;
    if (isOverdue(i, now)) return "overdue";
    if (within(i, 0, 1)) return "today";
    if (within(i, 1, 2)) return "tomorrow";
    return within(i, 2, 7) ? "soon" : null;
  };
  const sections =
    filters.due === "any"
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
    animateLayout();
    const next = pins.includes(p)
      ? pins.filter((x) => x !== p)
      : PINS.filter((x) => x === p || pins.includes(x));
    setPins(next);
    // SecureStore can't keep an empty value.
    saveLocal(PIN_KEY, next.join(",") || "none");
  };

  // Lists that share a name (in different teams) get the team in their title.
  const nameCount = new Map<string, number>();
  for (const l of lists)
    nameCount.set(l.name, (nameCount.get(l.name) ?? 0) + 1);
  const groups = groupItems(rest, filters.group, {
    list: (id) => listById.get(id),
    tag: (id) => tagById.get(id),
    sameName: (name) => (nameCount.get(name) ?? 0) > 1,
  });
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
            title: `Nothing ${statusLabels[status].toLowerCase()}.`,
            body: "Tasks with this status will show up here.",
          };

  return (
    <>
      <View style={s.search}>
        <View style={s.icon} pointerEvents="none">
          <Icon name="search" size={17} color={colors.muted} />
        </View>
        <TextInput
          style={[shared.input, s.input]}
          placeholder="Find something…"
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
        accessibilityLabel="Filter by status"
      >
        {STATUS_FILTERS.map((f) => {
          const selected = f === status;
          const tone = f === "all" ? null : statusTones[f];
          const n = count(f);
          return (
            <PressableScale
              key={f}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${statusFilterLabel(f)}, ${n} item${n === 1 ? "" : "s"}`}
              onPress={() => {
                animateLayout();
                setStatus(f);
              }}
              style={[
                s.chip,
                selected && {
                  backgroundColor: tone?.bg ?? colors.accent,
                  borderColor: tone?.fg ?? colors.accent,
                },
              ]}
            >
              {tone && <View style={[s.dot, { backgroundColor: tone.fg }]} />}
              <Text
                style={[
                  s.chipText,
                  selected && { color: tone?.fg ?? colors.white },
                ]}
              >
                {statusFilterLabel(f)}
              </Text>
              <Text
                style={[
                  s.chipCount,
                  selected && { color: tone?.fg ?? colors.white },
                ]}
              >
                {n}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Filters and view${active.length ? `, ${active.length} active` : ""}`}
        accessibilityState={{ expanded: showTools }}
        onPress={() => {
          setShowTools((shown) => !shown);
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
        <Icon
          name={showTools ? "chevronUp" : "chevronDown"}
          size={16}
          color={colors.muted}
        />
      </PressableScale>
      {showTools && (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.filterScroll}
            contentContainerStyle={s.chips}
            accessibilityLabel="Filters"
          >
            {keys.map((key) => {
              const on = filters[key] !== "any" && filters[key] !== "none";
              const isGroup = key === "group";
              const shown = isGroup
                ? filters.group !== "none"
                : on || filters[key] === "none";
              return (
                <PressableScale
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={`${KEY_LABELS[key]}: ${current(key)}`}
                  accessibilityHint="Shows the choices below"
                  accessibilityState={{ expanded: open === key }}
                  onPress={() => {
                    animateLayout();
                    setOpen(open === key ? null : key);
                  }}
                  style={[
                    s.filter,
                    shown && s.filterOn,
                    open === key && s.filterOpen,
                  ]}
                >
                  {key === "group" ? (
                    <Icon
                      name="list"
                      size={13}
                      color={shown ? colors.accent : colors.muted}
                    />
                  ) : (
                    key === "due" && (
                      <Icon
                        name="filter"
                        size={12}
                        color={shown ? colors.accent : colors.muted}
                      />
                    )
                  )}
                  <Text style={[s.filterText, shown && s.filterTextOn]}>
                    {shown
                      ? `${KEY_LABELS[key]}: ${current(key)}`
                      : KEY_LABELS[key]}
                  </Text>
                </PressableScale>
              );
            })}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Pinned sections: ${pins.length ? pins.map((p) => PIN_LABELS[p]).join(", ") : "overdue only"}`}
              accessibilityHint="Shows the choices below"
              accessibilityState={{ expanded: open === "pins" }}
              onPress={() => {
                animateLayout();
                setOpen(open === "pins" ? null : "pins");
              }}
              style={[
                s.filter,
                pins.length > 0 && s.filterOn,
                open === "pins" && s.filterOpen,
              ]}
            >
              <Icon
                name="pin"
                size={12}
                color={pins.length ? colors.accent : colors.muted}
              />
              <Text style={[s.filterText, pins.length > 0 && s.filterTextOn]}>
                Pinned
              </Text>
            </PressableScale>
            {active.length > 0 && (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Clear filters"
                onPress={() => {
                  animateLayout();
                  setFilters((f) => ({ ...DEFAULTS, group: f.group }));
                  setOpen(null);
                }}
                style={s.filter}
              >
                <Icon name="x" size={12} color={colors.danger} />
                <Text style={[s.filterText, { color: colors.danger }]}>
                  Clear
                </Text>
              </PressableScale>
            )}
          </ScrollView>
          {open && open !== "pins" && open !== "sort" && (
            <View style={s.panel}>
              <ChipRow label={KEY_LABELS[open]}>
                {options[open].map((o) => (
                  <Chip
                    key={o.value}
                    label={o.label}
                    color={o.color}
                    selected={filters[open] === o.value}
                    onPress={() => set(open, o.value)}
                  />
                ))}
              </ChipRow>
              {(open === "list" || open === "tag") &&
                options[open].length <= 2 && (
                  <Text style={[shared.small, s.panelHint]}>
                    {open === "list" ? "No lists yet." : "No tags yet."}
                  </Text>
                )}
            </View>
          )}
          {open === "pins" && (
            <View style={s.panel}>
              <ChipRow label="Pinned sections" multi>
                {PINS.map((p) => (
                  <Chip
                    key={p}
                    multi
                    label={PIN_LABELS[p]}
                    selected={pins.includes(p)}
                    onPress={() => togglePin(p)}
                  />
                ))}
              </ChipRow>
              <Text style={[shared.small, s.panelHint]}>
                Pinned sections sit at the top of the list. Overdue tasks always
                do.
              </Text>
            </View>
          )}
          <View style={s.layout}>
            <Segmented
              accessibilityLabel="Layout"
              options={LAYOUTS}
              labels={LAYOUT_LABELS}
              value={layout}
              onChange={chooseLayout}
            />
          </View>
          <View style={s.toolbar}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${SORT_LABELS[sort]}`}
              accessibilityHint="Shows the choices below"
              accessibilityState={{ expanded: open === "sort" }}
              onPress={() => {
                animateLayout();
                setOpen(open === "sort" ? null : "sort");
              }}
              style={[s.filter, open === "sort" && s.filterOpen]}
            >
              <Icon name="list" size={13} color={colors.muted} />
              <Text style={s.filterText}>Sort: {SORT_LABELS[sort]}</Text>
            </PressableScale>
            <View style={s.toolbarActions}>
              <SmallAction
                label="Tags"
                disabled={false}
                onPress={onManageTags}
              />
              <SmallAction
                label="Lists"
                disabled={false}
                onPress={onManageLists}
              />
            </View>
          </View>
          {open === "sort" && (
            <View style={s.panel}>
              <ChipRow label="Sort by">
                {ITEM_SORTS.map((value) => (
                  <Chip
                    key={value}
                    label={SORT_LABELS[value]}
                    selected={sort === value}
                    onPress={() => chooseSort(value)}
                  />
                ))}
              </ChipRow>
              <Text style={[shared.small, s.panelHint]}>
                Finished and cancelled items always come last.
              </Text>
            </View>
          )}
          {manual && layout === "list" && visible.length > 1 && (
            <Text style={[shared.small, s.manualHint]}>
              Long-press a task and drag it to reorder, or hold it for Move up
              and Move down. Tasks move among others in the same list, or under
              the same task.
            </Text>
          )}
        </>
      )}

      {visible.length === 0 ? (
        <>
          <SectionHeading title={title} count={0} />
          <EmptyState
            {...empty}
            action="Make a plan"
            onAction={handlers.onAdd}
          />
        </>
      ) : layout === "board" ? (
        // One section per status; each card moves with "Move to…". On a wide
        // screen the sections sit two across.
        <View style={twoColumns && status === "all" && s.board}>
          {(status === "all" ? BOARD_STATUSES : [status]).map((st) => {
            const column = visible.filter((i) => i.status === st);
            return (
              <View
                key={st}
                style={twoColumns && status === "all" && s.boardColumn}
              >
                <SectionHeading
                  title={statusLabels[st]}
                  count={column.length}
                  color={statusTones[st].fg}
                />
                {column.length > 0 ? (
                  <ItemRows items={column} {...rowProps} moveButton />
                ) : (
                  <View style={s.emptyColumn}>
                    <Text style={shared.small}>Nothing here yet.</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
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
                    : undefined
                }
              />
              <ItemRows items={section.items} {...listRowProps} />
            </View>
          ))}
          {rest.length > 0 &&
            groups.map((g) => (
              <View key={g.key}>
                <SectionHeading
                  title={
                    filters.group !== "none"
                      ? g.title
                      : sections.length
                        ? "Everything else"
                        : title
                  }
                  count={g.items.length}
                  color={g.color}
                />
                <ItemRows items={g.items} {...listRowProps} />
              </View>
            ))}
        </>
      )}
    </>
  );
}

/** Split sorted items into titled groups; an item with two tags shows in both. */
function groupItems(
  items: Item[],
  group: Group,
  names: {
    list: (id: string) => TaskList | undefined;
    tag: (id: string) => { name: string; color: string } | undefined;
    /** Whether more than one list has this name. */
    sameName: (name: string) => boolean;
  },
) {
  type Section = { key: string; title: string; items: Item[]; color?: string };
  if (group === "none") return [{ key: "all", title: "", items } as Section];
  const groups = new Map<string, Section>();
  const add = (key: string, title: string, item: Item, color?: string) => {
    const g = groups.get(key) ?? { key, title, items: [], color };
    g.items.push(item);
    groups.set(key, g);
  };
  for (const i of items) {
    if (group === "size") add(sizeOf(i), SIZE_LABELS[sizeOf(i)], i);
    else if (group === "list") {
      const list = i.list_id ? names.list(i.list_id) : undefined;
      if (list)
        add(
          list.id,
          list.team_name && names.sameName(list.name)
            ? `${list.name} · ${list.team_name}`
            : list.name,
          i,
          list.color,
        );
      else add("~none", "No list", i);
    } else {
      const tagged = (i.tag_ids ?? []).flatMap((id) => {
        const tag = names.tag(id);
        return tag ? [{ id, tag }] : [];
      });
      if (!tagged.length) add("~none", "No tags", i);
      for (const { id, tag } of tagged) add(id, tag.name, i, tag.color);
    }
  }
  const all = [...groups.values()];
  if (group === "size")
    return all.sort(
      (a, b) => SIZES.indexOf(a.key as Size) - SIZES.indexOf(b.key as Size),
    );
  // Named groups alphabetically, "No list" / "No tags" last.
  return all.sort(
    (a, b) =>
      Number(a.key === "~none") - Number(b.key === "~none") ||
      a.title.localeCompare(b.title),
  );
}

const s = themed(() =>
  StyleSheet.create({
    search: { marginBottom: 12, justifyContent: "center" },
    icon: { position: "absolute", left: 15, zIndex: 1 },
    input: { paddingLeft: 42 },
    chipScroll: { marginHorizontal: -spacing.page, marginBottom: 10 },
    filterScroll: { marginHorizontal: -spacing.page, marginBottom: 12 },
    toolsToggle: {
      minHeight: 48,
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
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    toolsSummary: {
      flex: 1,
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
    dot: { width: 7, height: 7, borderRadius: 4 },
    chipText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    chipCount: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
    filter: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minHeight: 44,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    filterOn: {
      borderStyle: "solid",
      borderColor: colors.softBorder,
      backgroundColor: colors.accentSoft,
    },
    filterOpen: { borderColor: colors.accent },
    filterText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
    filterTextOn: { fontFamily: fonts.semibold, color: colors.accent },
    panel: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      padding: 12,
      marginBottom: 12,
    },
    panelHint: { marginTop: 8 },
    layout: { marginBottom: 12 },
    manualHint: { marginTop: -4, marginBottom: 14 },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      marginBottom: 14,
    },
    toolbarActions: { flexDirection: "row", gap: 8 },
    /** The board on a wide screen: status sections two across. */
    board: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -8 },
    boardColumn: { width: "50%", paddingHorizontal: 8 },
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
