import { useMemo, useState } from "react";
import { Columns3, List, ListTodo, Search, X } from "lucide-react";
import {
  searchItems,
  emptyPlans,
  emptySearch,
  statusLabels,
  statusOrder,
  type Item,
  type Priority,
  type Status,
} from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import { usePlanning } from "../../app/planning";
import { statusCounts } from "../../lib/tasks";
import {
  byScore,
  matchesDue,
  SIZE_LABELS,
  sizeOf,
  type DueFilter,
  type Size,
} from "../../lib/planning";
import { TaskBoard } from "./TaskBoard";

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
};

type Filter = Status | "all";
type Layout = "list" | "board";
type Group = "none" | "list" | "tag" | "size";

const LAYOUT_KEY = "orbyn-tasks-layout";
const GROUP_KEY = "orbyn-tasks-group";
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
const DUE_OPTIONS: { id: DueFilter; label: string }[] = [
  { id: "any", label: "Any due date" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "none", label: "No date" },
];

/**
 * Every item with search, filters (due, priority, list, tag, size, assignee),
 * status chips, grouping, and a List / Board toggle. Sorted by how pressing
 * each task is.
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
}: Props) {
  const { lists, tags, listById, tagById } = usePlanning();
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayoutState] = useState<Layout>(() =>
    saved(LAYOUT_KEY, ["list", "board"], "list"),
  );
  const [group, setGroupState] = useState<Group>(() =>
    saved(GROUP_KEY, ["none", "list", "tag", "size"], "none"),
  );
  const [due, setDue] = useState<DueFilter>("any");
  const [priority, setPriority] = useState<Priority | "any">("any");
  const [listId, setListId] = useState("any");
  const [tagId, setTagId] = useState("any");
  const [size, setSize] = useState<Size | "any">("any");
  const [assignee, setAssignee] = useState("any");

  const setLayout = (next: Layout) => {
    setLayoutState(next);
    remember(LAYOUT_KEY, next);
  };
  const setGroup = (next: Group) => {
    setGroupState(next);
    remember(GROUP_KEY, next);
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
  const matching = searchItems(items, query)
    .filter(
      (i) =>
        matchesDue(i, due, now) &&
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
    .sort(byScore(now));
  const counts = statusCounts(matching);
  const visible =
    filter === "all" ? matching : matching.filter((i) => i.status === filter);
  const empty =
    query.trim() || active
      ? emptySearch
      : filter !== "all" && items.length
        ? {
            title: `Nothing ${statusLabels[filter].toLowerCase()} right now.`,
            body: "Pick another status to see the rest of your plans.",
          }
        : emptyPlans;

  /** The visible items split into titled groups (an item can sit in several tag groups). */
  const groups: {
    key: string;
    title: string;
    color?: string;
    items: Item[];
  }[] =
    group === "list"
      ? [
          ...lists
            .map((l) => ({
              key: l.id,
              title: l.team_name ? `${l.name} · ${l.team_name}` : l.name,
              color: l.color,
              items: visible.filter((i) => i.list_id === l.id),
            }))
            .filter((g) => g.items.length),
          {
            key: "none",
            title: "No list",
            items: visible.filter(
              (i) => !i.list_id || !listById.has(i.list_id),
            ),
          },
        ]
      : group === "tag"
        ? [
            ...tags
              .map((t) => ({
                key: t.id,
                title: t.name,
                color: t.color,
                items: visible.filter((i) => (i.tag_ids ?? []).includes(t.id)),
              }))
              .filter((g) => g.items.length),
            {
              key: "none",
              title: "No tag",
              items: visible.filter(
                (i) => !(i.tag_ids ?? []).some((id) => tagById.has(id)),
              ),
            },
          ]
        : group === "size"
          ? SIZES.map((s) => ({
              key: s,
              title: SIZE_LABELS[s],
              items: visible.filter((i) => sizeOf(i) === s),
            }))
          : [{ key: "all", title: "", items: visible }];

  const rows = (list: Item[]) =>
    list.map((i, n) => (
      <ItemRow
        key={i.id}
        item={i}
        index={n}
        busy={busy}
        readOnly={!canWrite(i)}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    ));

  return (
    <section className="card tasks-card">
      <div className="section-heading tasks-heading">
        <h2>
          All items <span>{items.length}</span>
        </h2>
        <div className="tasks-tools">
          <div className="search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search items"
              placeholder="Find something…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </div>
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
        </div>
      </div>
      <div className="filter-bar" role="group" aria-label="Filters">
        <label className="filter-select">
          <span>Due</span>
          <select
            value={due}
            onChange={(e) => setDue(e.target.value as DueFilter)}
          >
            {DUE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span>Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority | "any")}
          >
            <option value="any">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="filter-select">
          <span>List</span>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="any">Any list</option>
            <option value="none">No list</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span>Tag</span>
          <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="any">Any tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          <span>Size</span>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value as Size | "any")}
          >
            <option value="any">Any size</option>
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {SIZE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        {hasTeamItems && (
          <label className="filter-select">
            <span>Assignee</span>
            <select
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
            </select>
          </label>
        )}
        {layout === "list" && (
          <label className="filter-select">
            <span>Group by</span>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value as Group)}
            >
              <option value="none">No grouping</option>
              <option value="list">List</option>
              <option value="tag">Tag</option>
              <option value="size">Size</option>
            </select>
          </label>
        )}
        {active && (
          <button className="text-button filter-clear" onClick={clear}>
            <X size={13} /> Clear filters
          </button>
        )}
      </div>
      <div className="filter-chips" role="group" aria-label="Filter by status">
        {(["all", ...statusOrder] as Filter[]).map((f) => (
          <button
            key={f}
            aria-pressed={filter === f}
            className={
              (filter === f ? "active " : "") + (f === "all" ? "" : "tone-" + f)
            }
            onClick={() => setFilter(f)}
          >
            {f !== "all" && <i aria-hidden="true" />}
            {f === "all" ? "All" : statusLabels[f]}
            <span>{counts[f]}</span>
          </button>
        ))}
      </div>
      {!visible.length ? (
        <EmptyState icon={ListTodo} title={empty.title} body={empty.body} />
      ) : layout === "board" ? (
        <TaskBoard
          items={visible}
          statuses={filter === "all" ? statusOrder : [filter]}
          busy={busy}
          canWrite={canWrite}
          onOpen={onOpen}
          onSetStatus={onSetStatus}
        />
      ) : group === "none" ? (
        rows(visible)
      ) : (
        groups
          .filter((g) => g.items.length)
          .map((g) => (
            <section
              key={g.key}
              className="task-group"
              aria-label={`${g.title}, ${g.items.length}`}
            >
              <h3 className="task-group-title">
                {g.color && (
                  <i
                    className="list-dot"
                    style={{ background: g.color }}
                    aria-hidden="true"
                  />
                )}
                {g.title}
                <span>{g.items.length}</span>
              </h3>
              {rows(g.items)}
            </section>
          ))
      )}
    </section>
  );
}
