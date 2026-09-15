import { useState } from "react";
import { Columns3, List, ListTodo, Search } from "lucide-react";
import {
  byDueDate,
  searchItems,
  emptyPlans,
  emptySearch,
  statusLabels,
  statusOrder,
  type Item,
  type Status,
} from "@orbyn/core";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../../components/ItemRow";
import { statusCounts } from "../../lib/tasks";
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
};

type Filter = Status | "all";
type Layout = "list" | "board";

const LAYOUT_KEY = "orbyn-tasks-layout";
const savedLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
};

/** Every item with search, status filter chips and a List / Board toggle. */
export function TasksView({
  items,
  query,
  onQueryChange,
  busy,
  canWrite,
  onToggle,
  onOpen,
  onSetStatus,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [layout, setLayoutState] = useState<Layout>(savedLayout);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Storage can be unavailable (private mode); the choice just won't stick.
    }
  };

  const matching = searchItems(items, query).slice().sort(byDueDate);
  const counts = statusCounts(matching);
  const visible =
    filter === "all" ? matching : matching.filter((i) => i.status === filter);
  const empty = query.trim()
    ? emptySearch
    : filter !== "all" && items.length
      ? {
          title: `Nothing ${statusLabels[filter].toLowerCase()} right now.`,
          body: "Pick another status to see the rest of your plans.",
        }
      : emptyPlans;

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
      ) : (
        visible.map((i, n) => (
          <ItemRow
            key={i.id}
            item={i}
            index={n}
            busy={busy}
            readOnly={!canWrite(i)}
            onToggle={onToggle}
            onOpen={onOpen}
          />
        ))
      )}
    </section>
  );
}
