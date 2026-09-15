import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  searchItems,
  emptyPlans,
  emptySearch,
  sameDay,
  statusLabels,
  statusOrder,
  type Item,
  type Priority,
  type Status,
  type User,
} from "@orbyn/core";
import { Chip, ChipRow } from "../components/Chip";
import { Icon } from "../components/Icon";
import {
  EmptyState,
  ItemRows,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
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
import { colors, fonts, radii, themed, statusTones } from "../theme";
import { shared } from "../styles";

/** Case-insensitive match against the item's title and notes together. */
export const matchesSearch = (item: Item, search: string) =>
  (item.title + " " + item.notes).toLowerCase().includes(search.toLowerCase());

type StatusFilter = "all" | Status;
const STATUS_FILTERS: StatusFilter[] = ["all", ...statusOrder];
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
  week: "Next 7 days",
  none: "No date",
};
const PRIORITY_LABELS: Record<"any" | Priority, string> = {
  any: "Any",
  high: "High",
  medium: "Medium",
  low: "Low",
};
const GROUP_LABELS: Record<Group, string> = {
  none: "No grouping",
  list: "By list",
  tag: "By tag",
  size: "By size",
};

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

/**
 * Every item, most pressing first (priorityScore), with search, status tabs
 * and filters for due date, priority, list, tag, size and assignee. Items can
 * be grouped by list, tag or size.
 */
export function TasksScreen({
  items,
  search,
  onSearch,
  user,
  onManageLists,
  ...handlers
}: ListHandlers & {
  items: Item[];
  search: string;
  onSearch: (search: string) => void;
  user: User | null;
  /** Opens the lists sheet (create, rename, recolour, delete). */
  onManageLists: () => void;
}) {
  const { lists, tags, listById, tagById } = usePlanning();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [open, setOpen] = useState<Key | "pins" | null>(null);
  const [pins, setPins] = useState<Pin[]>(savedPins);
  const now = new Date();
  const weekEnd = dayStart(8, now);

  const people = new Map<string, string>();
  for (const i of items)
    if (i.assignee_id && i.assignee_id !== user?.id)
      people.set(i.assignee_id, i.assignee_name || "Someone");

  const matches = (i: Item) => {
    const due = i.due_at ? new Date(i.due_at) : null;
    const dueOk =
      filters.due === "any" ||
      (filters.due === "none" && !due) ||
      (filters.due === "overdue" &&
        !!due &&
        due < now &&
        i.status !== "done") ||
      (filters.due === "today" && !!due && sameDay(due, now)) ||
      (filters.due === "tomorrow" && !!due && sameDay(due, dayStart(1, now))) ||
      // Due soon: the rest of the next seven days, after today and tomorrow.
      (filters.due === "soon" &&
        !!due &&
        due >= dayStart(2, now) &&
        due < weekEnd) ||
      (filters.due === "week" &&
        !!due &&
        due >= dayStart(0, now) &&
        due < weekEnd);
    const listOk =
      filters.list === "any" ||
      (filters.list === "none" ? !i.list_id : i.list_id === filters.list);
    const tagOk =
      filters.tag === "any" || (i.tag_ids ?? []).includes(filters.tag);
    const assigneeOk =
      filters.assignee === "any" ||
      (filters.assignee === "none"
        ? !i.assignee_id
        : filters.assignee === "me"
          ? !!user && i.assignee_id === user.id
          : i.assignee_id === filters.assignee);
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
  const rank = byPriority(now);
  const visible = found
    .filter((i) => status === "all" || i.status === status)
    .sort(
      (a, b) =>
        Number(a.status === "done") - Number(b.status === "done") || rank(a, b),
    );

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
    group: (Object.keys(GROUP_LABELS) as Group[]).map((value) => ({
      value,
      label: GROUP_LABELS[value],
    })),
  };
  const current = (key: Key) =>
    options[key].find((o) => o.value === filters[key])?.label ?? "Any";
  const active = KEYS.filter((k) => k !== "group" && filters[k] !== "any");
  const set = (key: Key, value: string) => {
    animateLayout();
    setFilters((f) => ({ ...f, [key]: value }));
  };

  // Pinned sections: open tasks by when they're due, each in one section only.
  // A due filter is already a smart list, so it shows without them.
  const pinnedAs = (i: Item): "overdue" | Pin | null => {
    if (i.status === "done" || !i.due_at) return null;
    if (isOverdue(i, now)) return "overdue";
    const due = new Date(i.due_at);
    if (sameDay(due, now)) return "today";
    if (sameDay(due, dayStart(1, now))) return "tomorrow";
    return due >= dayStart(2, now) && due < weekEnd ? "soon" : null;
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

  const groups = groupItems(rest, filters.group, {
    listName: (id) => listById.get(id)?.name,
    tagName: (id) => tagById.get(id)?.name,
  });
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.filterScroll}
        contentContainerStyle={s.chips}
        accessibilityLabel="Filters"
      >
        {KEYS.map((key) => {
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
            <Text style={[s.filterText, { color: colors.danger }]}>Clear</Text>
          </PressableScale>
        )}
      </ScrollView>
      {open && open !== "pins" && (
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
          {(open === "list" || open === "tag") && options[open].length <= 2 && (
            <Text style={[shared.small, s.panelHint]}>
              {open === "list"
                ? "No lists yet."
                : "No tags yet. Add them when you edit a task."}
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
            Pinned sections sit at the top of the list. Overdue tasks always do.
          </Text>
        </View>
      )}
      <View style={s.toolbar}>
        <Text style={shared.small}>Most pressing first</Text>
        <SmallAction label="Lists" disabled={false} onPress={onManageLists} />
      </View>

      {sections.map((section) => (
        <View key={section.key}>
          <SectionHeading
            title={
              section.key === "overdue" ? "Overdue" : PIN_LABELS[section.key]
            }
            count={section.items.length}
            hint={
              section.key === "overdue" ? "Past due and still open" : undefined
            }
          />
          <ItemRows
            items={section.items}
            busy={handlers.busy}
            onToggle={handlers.onToggle}
            onOpen={handlers.onOpen}
            canToggle={handlers.canToggle}
          />
        </View>
      ))}
      {visible.length === 0 ? (
        <>
          <SectionHeading title={title} count={0} />
          <EmptyState
            {...empty}
            action="Make a plan"
            onAction={handlers.onAdd}
          />
        </>
      ) : (
        rest.length > 0 &&
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
            />
            <ItemRows
              items={g.items}
              busy={handlers.busy}
              onToggle={handlers.onToggle}
              onOpen={handlers.onOpen}
              canToggle={handlers.canToggle}
            />
          </View>
        ))
      )}
    </>
  );
}

/** Split sorted items into titled groups; an item with two tags shows in both. */
function groupItems(
  items: Item[],
  group: Group,
  names: {
    listName: (id: string) => string | undefined;
    tagName: (id: string) => string | undefined;
  },
) {
  if (group === "none") return [{ key: "all", title: "", items }];
  const groups = new Map<
    string,
    { key: string; title: string; items: Item[] }
  >();
  const add = (key: string, title: string, item: Item) => {
    const g = groups.get(key) ?? { key, title, items: [] };
    g.items.push(item);
    groups.set(key, g);
  };
  for (const i of items) {
    if (group === "size") add(sizeOf(i), SIZE_LABELS[sizeOf(i)], i);
    else if (group === "list") {
      const name = i.list_id ? names.listName(i.list_id) : undefined;
      if (name && i.list_id) add(i.list_id, name, i);
      else add("~none", "No list", i);
    } else {
      const tagged = (i.tag_ids ?? []).filter((id) => names.tagName(id));
      if (!tagged.length) add("~none", "No tags", i);
      for (const id of tagged) add(id, names.tagName(id)!, i);
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
    chipScroll: { marginHorizontal: -20, marginBottom: 10 },
    filterScroll: { marginHorizontal: -20, marginBottom: 12 },
    chips: { gap: 8, paddingHorizontal: 20 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 36,
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
      minHeight: 36,
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
    toolbar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14,
    },
  }),
);
