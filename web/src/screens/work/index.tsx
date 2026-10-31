import {
  boardColumns,
  boardFilterCounts,
  BOARD_FILTERS,
  BOARD_FILTER_LABELS,
  BOARD_GROUPS,
  BOARD_RANGES,
  BOARD_RANGE_LABELS,
  columnPrefill,
  dropChange,
  durationText,
  emptyPlans,
  emptySearch,
  groupTasks,
  inBoardRange,
  isAgentLane,
  isClosed,
  matchesBoardFilter,
  OWNER_REVIEW,
  parseQuickAdd,
  plannedTodayIds,
  searchItems,
  STATUSES,
  statusLabels,
  TASK_GROUP_LABELS,
  TASK_SIZE_LABELS,
  TASK_SIZES,
  type BoardFilter,
  type BoardRange,
  type GroupNames,
  type Item,
  type ItemSort,
  type Priority,
  type ReviewItem,
  type SavedView,
  type TaskGroupBy,
} from "@orbyn/core";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3,
  ListChecks,
  List as ListIcon,
  Pin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ScreenProps } from "../../app/routes";
import { navigate, usePath, useSearch, useTitle } from "../../lib/router";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import { useAccount } from "../../app/account";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  Input,
  Loading,
  Menu,
  SelectBox,
  useToast,
} from "../../ui/kit";
import {
  deviceTimeZone,
  matchesDue,
  refreshPlanner,
  saveColumn,
  sizeOf,
  statusCounts,
  TaskHost,
  TaskRow,
  tasks,
  useItems,
  usePlanning,
  type DueFilter,
} from "../shared-task";
import { withQuickAdd } from "../shared-task/draft";
import { createItem, moveItem } from "../shared-task/store";
import { Board } from "./Board";
import { BulkBar } from "./BulkBar";
import { DoneDialog, SaveViewDialog } from "./dialogs";
import { sortBy } from "./sorting";
import {
  LIST_GROUPS,
  NO_FILTERS,
  PINNABLE,
  SORTS,
  useWorkView,
  type Filters,
  type StatusFilter,
} from "./view-state";
import "./work.css";

const AGENT_POLL_MS = 20_000;
const DUE_OPTIONS: { id: DueFilter; label: string }[] = [
  { id: "any", label: "Any due date" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today (planned or due)" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "soon", label: "Due soon" },
  { id: "week", label: "This week" },
  { id: "none", label: "No date" },
];
const GROUP_NAMES: Record<TaskGroupBy, string> = {
  ...TASK_GROUP_LABELS,
  none: "No grouping",
};

export default function WorkScreen({ params }: ScreenProps) {
  const path = usePath();
  const search = useSearch();
  useTitle("Work");

  // /app/task/:id opens the task over the list; closing returns to the list.
  const taskId = params.id;
  useEffect(() => {
    if (!taskId) return;
    tasks.open(taskId, { onClose: () => navigate("/app/tasks", true) });
    return () => tasks.close(taskId);
  }, [taskId]);

  // /app/add fills in a new item. It never adds anything by itself.
  const adding = path === "/app/add";
  useEffect(() => {
    if (!adding) return;
    const text =
      new URLSearchParams(search).get("text")?.trim().slice(0, 500) ?? "";
    tasks.create({ text, onClose: () => navigate("/app/tasks", true) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding]);

  return (
    <>
      <TaskHost />
      <WorkBody />
    </>
  );
}

function WorkBody() {
  const items = useItems();
  const planning = usePlanning();
  const { lists, tags, teams, feed, phase, error, canWrite } = planning;
  const { user } = useAccount();
  const view = useWorkView();
  const {
    filter,
    setFilter,
    layout,
    group,
    boardGroup,
    shownGroup,
    sort,
    hideEmpty,
    pins,
    folds,
    toggleFold,
  } = view;

  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchBox = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<Filters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const activeFilters = Object.values(filters).filter(
    (v) => v !== "any",
  ).length;

  // Project names for grouping by project, read only then.
  const projects = useResource(
    () =>
      shownGroup === "project"
        ? client
            .listProjects()
            .then((all) => all.map(({ id, name }) => ({ id, name })))
        : Promise.resolve([] as { id: string; name: string }[]),
    [shownGroup],
  );

  // "Who's on it": connected agents' work and what waits in Review.
  const owners = layout === "board" && boardGroup === "owner";
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [range, setRange] = useState<BoardRange>({ kind: "all" });
  const itemsKey = items
    .map((i) => `${i.id}:${i.version}:${i.agent_state ?? ""}`)
    .join();
  const ownerData = useResource(async () => {
    if (!owners)
      return { agents: [], review: [] as ReviewItem[], failed: false };
    const [work, inbox] = await Promise.allSettled([
      client.agentWork(),
      client.reviewInbox(),
    ]);
    return {
      agents: work.status === "fulfilled" ? work.value : [],
      review: inbox.status === "fulfilled" ? inbox.value.pending : [],
      failed: work.status === "rejected" || inbox.status === "rejected",
    };
  }, [owners, itemsKey]);
  const agentWork = ownerData.data?.agents ?? [];
  const reviewCards = ownerData.data?.review ?? [];
  const agentName =
    useResource(() => client.agentSettings().then((a) => a.name || "Orbyn"), [])
      .data ?? "Orbyn";

  const agentBusy = items.some(
    (i) => i.agent_state === "queued" || i.agent_state === "working",
  );
  useEffect(() => {
    if (!agentBusy) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refreshPlanner().catch(() => undefined);
    }, AGENT_POLL_MS);
    return () => clearInterval(timer);
  }, [agentBusy]);

  const assignees = useMemo(() => {
    const people = new Map<string, string>();
    for (const i of items)
      if (i.assignee_id && i.assignee_name)
        people.set(i.assignee_id, i.assignee_name);
    return [...people.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);
  const hasTeamItems = items.some((i) => i.team_id);

  const now = new Date();
  const plannedToday = plannedTodayIds(feed, now);
  const matching = searchItems(items, query)
    .filter(
      (i) =>
        matchesDue(i, filters.due, now, plannedToday) &&
        (filters.priority === "any" || i.priority === filters.priority) &&
        (filters.list === "any" ||
          (filters.list === "none"
            ? !i.list_id
            : i.list_id === filters.list)) &&
        (filters.tag === "any" || (i.tag_ids ?? []).includes(filters.tag)) &&
        (filters.size === "any" || sizeOf(i) === filters.size) &&
        (filters.assignee === "any" ||
          (filters.assignee === "me"
            ? i.assignee_id === user?.id
            : filters.assignee === "none"
              ? !!i.team_id && !i.assignee_id
              : i.assignee_id === filters.assignee)),
    )
    .sort(sortBy(sort, now, items));
  const counts = statusCounts(matching);
  const plannedAt = new Map(
    (feed?.tasks ?? []).map((t) => [
      t.item_id,
      t.sessions.map((s) => s.start_at),
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
      : matching.filter((i) =>
          filter === "active" ? !isClosed(i.status) : i.status === filter,
        );

  const empty =
    query.trim() || activeFilters
      ? emptySearch
      : filter !== "all" && items.length
        ? {
            title:
              filter === "active"
                ? "No active work right now."
                : `Nothing ${statusLabels[filter].toLowerCase()} right now.`,
            body: "Pick another status to see the rest of your plans.",
          }
        : emptyPlans;

  // Each open item shows once, in the first pinned section that takes it.
  const open = visible.filter((i) => !isClosed(i.status));
  const taken = new Set<string>();
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

  const names: GroupNames = {
    lists,
    tags,
    projects: projects.data ?? [],
    userId: user?.id,
    now,
    agentName,
    agents: agentWork,
  };
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
  const columns =
    layout === "board"
      ? boardColumns(visible, boardGroup, names, {
          statuses:
            boardGroup === "status" && filter !== "all"
              ? filter === "active"
                ? STATUSES.filter((status) => !isClosed(status))
                : [filter]
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

  const [moveError, setMoveError] = useState("");
  const [moving, setMoving] = useState(false);
  const moveCard = (item: Item, from: string, to: string) => {
    if (moving || !canWrite(item)) return;
    const result = dropChange(item, boardGroup, from, to, names);
    if (!result) return;
    if (!result.ok) return setMoveError(result.reason);
    setMoveError("");
    void saveColumn(item, result.change).catch((e) =>
      setMoveError(messageOf(e, "Couldn't move the card.")),
    );
  };

  const manual = sort === "position";
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; before: boolean } | null>(
    null,
  );
  const move = async (
    id: string,
    to: { before_id?: string; after_id?: string },
  ) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || !canWrite(item) || moving) return;
    setMoving(true);
    setMoveError("");
    try {
      await moveItem(id, to);
    } catch (e) {
      setMoveError(messageOf(e, "Couldn't change the order."));
    } finally {
      setMoving(false);
    }
  };

  // Selecting: x, a modified click, or the Select control.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const shownIds = () =>
    [...(list.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [])].map(
      (row) => row.dataset.item!,
    );
  const selecting = selectMode || selected.size > 0;
  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
    anchor.current = null;
  };
  const select = (id: string, shift: boolean) => {
    setSelected((was) => {
      const next = new Set(was);
      if (shift && anchor.current) {
        const ids = shownIds();
        const from = ids.indexOf(anchor.current);
        const to = ids.indexOf(id);
        if (from >= 0 && to >= 0)
          for (const row of ids.slice(
            Math.min(from, to),
            Math.max(from, to) + 1,
          ))
            next.add(row);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!shift) anchor.current = id;
  };
  const selectedItems = items.filter((i) => selected.has(i.id));
  useEffect(() => {
    if (!selected.size) return;
    const known = new Set(items.map((i) => i.id));
    if ([...selected].some((id) => !known.has(id)))
      setSelected((was) => new Set([...was].filter((id) => known.has(id))));
  }, [items, selected]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        target.closest(
          "input, textarea, select, [contenteditable], dialog, .st-panel, .menu",
        )
      )
        return;
      const k = event.key;
      if (k === "/") {
        event.preventDefault();
        searchBox.current?.focus();
      } else if (k === "n" || k === "N") {
        event.preventDefault();
        tasks.create({});
      } else if (k === "Escape" && selecting) clearSelection();
      else if (
        layout === "list" &&
        (k === "j" || k === "k" || k === "ArrowDown" || k === "ArrowUp")
      ) {
        const ids = shownIds();
        if (!ids.length) return;
        event.preventDefault();
        const at = cursor ? ids.indexOf(cursor) : -1;
        const step = k === "j" || k === "ArrowDown" ? 1 : -1;
        const next = ids[Math.max(0, Math.min(ids.length - 1, at + step))];
        setCursor(next);
        list.current
          ?.querySelector(`[data-item="${next}"]`)
          ?.scrollIntoView({ block: "nearest" });
      } else if (cursor && (k === "Enter" || k === "o")) {
        event.preventDefault();
        tasks.open(cursor);
      } else if (cursor && k === "x") {
        event.preventDefault();
        select(cursor, false);
      } else if (cursor && k === "e") {
        event.preventDefault();
        list.current
          ?.querySelector<HTMLButtonElement>(
            `[data-item="${cursor}"] .st-check`,
          )
          ?.click();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggleChildren = (id: string) =>
    setFolded((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const itemById = new Map(items.map((i) => [i.id, i]));

  /** Subtasks sit under a parent listed with them; others name their parent. */
  const rows = (shown: Item[]) => {
    const ids = new Set(shown.map((i) => i.id));
    const kids = new Map<string, Item[]>();
    for (const i of shown)
      if (i.parent_id && ids.has(i.parent_id))
        kids.set(i.parent_id, [...(kids.get(i.parent_id) ?? []), i]);
    const top = shown.filter((i) => !i.parent_id || !ids.has(i.parent_id));
    const render = (level: Item[]): ReactNode[] =>
      level.map((i, n) => {
        const children = kids.get(i.id) ?? [];
        const isFolded = folded.has(i.id);
        const row = (
          <TaskRow
            item={i}
            readOnly={!canWrite(i)}
            score={sort === "score" ? i.score : undefined}
            parentTitle={
              i.parent_id && !ids.has(i.parent_id)
                ? itemById.get(i.parent_id)?.title
                : undefined
            }
            collapsed={children.length ? isFolded : undefined}
            onToggleChildren={
              children.length ? () => toggleChildren(i.id) : undefined
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
            selecting={selecting}
            selected={selected.has(i.id)}
            onSelect={({ shiftKey }) => select(i.id, shiftKey)}
            cursor={cursor === i.id}
          />
        );
        const shownRow = manual ? (
          <div
            className={`work-reorder${dragId === i.id ? " is-dragging" : ""}${
              dropAt?.id === i.id
                ? dropAt.before
                  ? " is-before"
                  : " is-after"
                : ""
            }`}
            draggable={!moving && canWrite(i)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", i.id);
              setDragId(i.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropAt(null);
            }}
            onDragOver={(event) => {
              if (!dragId || dragId === i.id) return;
              event.preventDefault();
              const box = event.currentTarget.getBoundingClientRect();
              const before = event.clientY < box.top + box.height / 2;
              if (dropAt?.id !== i.id || dropAt.before !== before)
                setDropAt({ id: i.id, before });
            }}
            onDrop={(event) => {
              event.preventDefault();
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
        return (
          <Fragment key={i.id}>
            {shownRow}
            {children.length > 0 && !isFolded && (
              <div
                className="work-children"
                role="group"
                aria-label={`Subtasks of ${i.title}`}
              >
                {render(children)}
              </div>
            )}
          </Fragment>
        );
      });
    return render(top);
  };

  const groupHeader = (
    key: string,
    title: string,
    count: number,
    color?: string,
    minutes = 0,
  ) => {
    const isFolded = folds.has(key);
    return (
      <h2 className="work-group-head">
        <button
          type="button"
          aria-expanded={!isFolded}
          onClick={() => toggleFold(key)}
        >
          {isFolded ? (
            <ChevronRight aria-hidden="true" />
          ) : (
            <ChevronDown aria-hidden="true" />
          )}
          {color && <i style={{ background: color }} aria-hidden="true" />}
          <span dir="auto">{title}</span>
          <span className="work-count">{count}</span>
          {minutes > 0 && (
            <span className="work-count">{durationText(minutes)}</span>
          )}
        </button>
      </h2>
    );
  };

  const views = useResource<SavedView[]>(
    () =>
      client
        .listViews()
        .then((all) => all.filter((v) => v.definition.source === "tasks")),
    [],
  );

  const body = () => {
    if (phase === "loading" && !items.length)
      return <Loading label="Loading your work" />;
    if (phase === "error" && !items.length)
      return (
        <ErrorNotice
          message={error}
          onRetry={() => void planning.retry().catch(() => undefined)}
        />
      );
    if (!visible.length && !owners)
      return (
        <Empty title={empty.title}>
          <p>{empty.body}</p>
          {!items.length && (
            <Button variant="primary" onClick={() => tasks.create({})}>
              Add a task
            </Button>
          )}
        </Empty>
      );
    if (layout === "board")
      return (
        <Board
          columns={columns}
          by={boardGroup}
          targets={targets}
          busy={moving}
          canWrite={canWrite}
          onMove={moveCard}
          onAdd={
            boardGroup !== "assignee" && boardGroup !== "owner"
              ? (key) =>
                  tasks.create({
                    prefill: columnPrefill(boardGroup, key, names),
                  })
              : undefined
          }
          folded={folds}
          onToggleFold={toggleFold}
          parentOf={(i) =>
            i.parent_id ? itemById.get(i.parent_id)?.title : undefined
          }
          reviewCards={owners ? reviewCards : []}
          onOpenReview={(id) => navigate(`/app/review/${id}`)}
          agentName={agentName}
          agentOf={(i) =>
            i.assignee_id
              ? undefined
              : agentWork.find((a) => a.item_ids.includes(i.id))?.name
          }
        />
      );
    return (
      <div ref={list} className="work-list st-rows">
        {pinned.map((section) => (
          <section
            key={section.key}
            aria-label={`${section.title}, ${section.items.length}`}
          >
            <h2 className="work-group-head work-pinned">
              <span
                className={section.key === "overdue" ? "work-late" : undefined}
              >
                <Pin aria-hidden="true" />
                {section.title}
                <span className="work-count">{section.items.length}</span>
              </span>
            </h2>
            {rows(section.items)}
          </section>
        ))}
        {group === "none" && !pinned.length
          ? rows(rest)
          : groups
              .filter((g) => g.items.length)
              .map((g) => (
                <section
                  key={g.key}
                  aria-label={`${g.title}, ${g.items.length}`}
                >
                  {groupHeader(
                    g.key,
                    g.title,
                    g.items.length,
                    g.color,
                    g.minutes,
                  )}
                  {!folds.has(g.key) && rows(g.items)}
                </section>
              ))}
      </div>
    );
  };

  return (
    <div className="work">
      <header className="work-head">
        <h1>Work</h1>
        <label className="work-search">
          <Search aria-hidden="true" />
          <input
            ref={searchBox}
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="st-gap" />
        <div className="segmented" role="group" aria-label="Layout">
          <button
            type="button"
            aria-pressed={layout === "list"}
            onClick={() => view.setLayout("list")}
          >
            <ListIcon aria-hidden="true" /> List
          </button>
          <button
            type="button"
            aria-pressed={layout === "board"}
            onClick={() => view.setLayout("board")}
          >
            <Columns3 aria-hidden="true" /> Board
          </button>
        </div>
        <Button
          aria-expanded={filtersOpen}
          aria-controls="work-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal aria-hidden="true" />
          {activeFilters ? `Filters · ${activeFilters}` : "Filters"}
        </Button>
        <Menu
          label="View options"
          trigger={(show, expanded) => (
            <Button aria-expanded={expanded} onClick={show}>
              <Pin aria-hidden="true" /> View
            </Button>
          )}
        >
          {(close) => (
            <>
              {PINNABLE.map((pin) => (
                <button
                  key={pin.id}
                  role="menuitemcheckbox"
                  aria-checked={pins.includes(pin.id)}
                  title={pin.hint}
                  onClick={() => view.togglePin(pin.id)}
                >
                  <span className="work-tick">
                    {pins.includes(pin.id) && <Check aria-hidden="true" />}
                  </span>
                  Pin {pin.label.toLowerCase()}
                </button>
              ))}
              {layout === "board" && (
                <button
                  role="menuitemcheckbox"
                  aria-checked={hideEmpty}
                  onClick={() => view.setHideEmpty(!hideEmpty)}
                >
                  <span className="work-tick">
                    {hideEmpty && <Check aria-hidden="true" />}
                  </span>
                  Hide empty columns
                </button>
              )}
              <hr />
              <button
                onClick={() => {
                  close();
                  setSelectMode(true);
                }}
              >
                <ListChecks aria-hidden="true" /> Select tasks
              </button>
              <button
                onClick={() => {
                  close();
                  setDoneOpen(true);
                }}
              >
                <BadgeCheck aria-hidden="true" /> Done this week
              </button>
              <button
                onClick={() => {
                  close();
                  setSaving(true);
                }}
              >
                <Plus aria-hidden="true" /> Save as view
              </button>
              {(views.data?.length ?? 0) > 0 && <hr />}
              {views.data?.slice(0, 8).map((saved) => (
                <button
                  key={saved.id}
                  onClick={() => navigate(`/app/view/${saved.id}`)}
                >
                  <span dir="auto">{saved.name}</span>
                </button>
              ))}
            </>
          )}
        </Menu>
        <Button
          variant="primary"
          onClick={() =>
            tasks.create({ prefill: contextPrefill(filters, lists) })
          }
        >
          <Plus aria-hidden="true" /> New
        </Button>
      </header>

      {filtersOpen && (
        <div
          id="work-filters"
          className="work-filters"
          role="group"
          aria-label="Filters"
        >
          <Field label="Due">
            <SelectBox
              value={filters.due}
              onChange={(event) =>
                change({ due: event.target.value as DueFilter })
              }
            >
              {DUE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Priority">
            <SelectBox
              value={filters.priority}
              onChange={(event) =>
                change({ priority: event.target.value as Priority | "any" })
              }
            >
              <option value="any">Any priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </SelectBox>
          </Field>
          <Field label="List">
            <SelectBox
              value={filters.list}
              onChange={(event) => change({ list: event.target.value })}
            >
              <option value="any">Any list</option>
              <option value="none">No list</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Tag">
            <SelectBox
              value={filters.tag}
              onChange={(event) => change({ tag: event.target.value })}
            >
              <option value="any">Any tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectBox>
          </Field>
          <Field label="Size">
            <SelectBox
              value={filters.size}
              onChange={(event) =>
                change({ size: event.target.value as Filters["size"] })
              }
            >
              <option value="any">Any size</option>
              {TASK_SIZES.map((size) => (
                <option key={size} value={size}>
                  {TASK_SIZE_LABELS[size]}
                </option>
              ))}
            </SelectBox>
          </Field>
          {hasTeamItems && (
            <Field label="Assignee">
              <SelectBox
                value={filters.assignee}
                onChange={(event) => change({ assignee: event.target.value })}
              >
                <option value="any">Anyone</option>
                {user && <option value="me">Assigned to me</option>}
                <option value="none">Not assigned</option>
                {assignees
                  .filter(([id]) => id !== user?.id)
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </SelectBox>
            </Field>
          )}
          <Field label={layout === "board" ? "Columns" : "Group by"}>
            <SelectBox
              value={shownGroup}
              onChange={(event) =>
                view.setGroup(event.target.value as TaskGroupBy)
              }
            >
              {(layout === "board" ? [...BOARD_GROUPS] : LIST_GROUPS).map(
                (g) => (
                  <option key={g} value={g}>
                    {GROUP_NAMES[g]}
                  </option>
                ),
              )}
            </SelectBox>
          </Field>
          <Field label="Sort">
            <SelectBox
              value={sort}
              onChange={(event) => view.setSort(event.target.value as ItemSort)}
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SelectBox>
          </Field>
          {activeFilters > 0 && (
            <Button variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
              <X aria-hidden="true" /> Clear filters
            </Button>
          )}
        </div>
      )}

      {owners ? (
        <div className="work-owner-tools">
          <div
            className="work-chips"
            role="group"
            aria-label="Show on the board"
          >
            {BOARD_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={boardFilter === f}
                onClick={() => setBoardFilter(f)}
              >
                {BOARD_FILTER_LABELS[f]}
                <span>
                  {f === "needs_review" &&
                  (ownerData.loading || ownerData.data?.failed)
                    ? "–"
                    : boardCounts[f]}
                </span>
              </button>
            ))}
          </div>
          <div className="work-range">
            <div className="segmented" role="group" aria-label="Dates">
              {BOARD_RANGES.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={range.kind === kind}
                  onClick={() => setRange((r) => ({ ...r, kind }))}
                >
                  {BOARD_RANGE_LABELS[kind]}
                </button>
              ))}
            </div>
            {range.kind === "range" && (
              <>
                <Input
                  type="date"
                  aria-label="From"
                  value={range.from ?? ""}
                  onChange={(event) =>
                    setRange((r) => ({
                      ...r,
                      from: event.target.value || null,
                    }))
                  }
                />
                <Input
                  type="date"
                  aria-label="To"
                  min={range.from ?? undefined}
                  value={range.to ?? ""}
                  onChange={(event) =>
                    setRange((r) => ({ ...r, to: event.target.value || null }))
                  }
                />
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="work-chips" role="group" aria-label="Filter by status">
          {(["active", "all", ...STATUSES] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "All history"
                : f === "active"
                  ? "Active"
                  : statusLabels[f]}
              <span>
                {f === "active"
                  ? matching.filter((item) => !isClosed(item.status)).length
                  : counts[f]}
              </span>
            </button>
          ))}
        </div>
      )}

      {layout === "list" && <QuickLine filters={filters} />}

      {phase === "error" && items.length > 0 && (
        <ErrorNotice
          message={error}
          onRetry={() => void planning.retry().catch(() => undefined)}
        />
      )}
      {shownGroup === "project" && projects.error && (
        <ErrorNotice
          message={projects.error}
          onRetry={() => void projects.reload()}
        />
      )}
      {owners && ownerData.data?.failed && (
        <ErrorNotice
          message="Couldn't refresh connected-agent work and reviews."
          onRetry={() => void ownerData.reload()}
        />
      )}
      {owners && ownerData.loading && (
        <p className="muted small" role="status">
          Refreshing agent work and reviews…
        </p>
      )}
      {moving && (
        <p className="muted small" role="status">
          Saving order…
        </p>
      )}
      {moveError && <ErrorNotice message={moveError} />}
      {manual && layout === "list" && (
        <p className="muted small">
          Drag rows or use the arrows. Order stays within each list, team or
          parent task.
        </p>
      )}
      {body()}
      {selecting && (
        <BulkBar
          selected={selectedItems}
          total={visible.length}
          onSelectAll={() => setSelected(new Set(shownIds()))}
          onClear={clearSelection}
        />
      )}
      {doneOpen && <DoneDialog onClose={() => setDoneOpen(false)} />}
      {saving && (
        <SaveViewDialog
          query={query}
          filter={filter}
          filters={filters}
          sort={sort}
          group={shownGroup}
          layout={layout}
          onClose={() => {
            setSaving(false);
            void views.reload();
          }}
        />
      )}
    </div>
  );
}

/** A new task starts in the list being looked at. */
const contextPrefill = (
  filters: Filters,
  lists: { id: string; team_id: string | null }[],
) => {
  const list = lists.find((l) => l.id === filters.list);
  return list ? { list_id: list.id, team_id: list.team_id } : undefined;
};

/** Type and press Enter: the fastest way to add one. */
function QuickLine({ filters }: { filters: Filters }) {
  const { lists, tags } = usePlanning();
  const { user } = useAccount();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const words = text.trim();
    if (!words || busy) return;
    let parsed;
    try {
      parsed = parseQuickAdd(words, {
        timeZone: deviceTimeZone(),
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          team_id: l.team_id,
        })),
        tags: tags.map((t) => ({ id: t.id, name: t.name, team_id: t.team_id })),
        selfId: user?.id,
      });
    } catch {
      parsed = null;
    }
    // Habits and invitations are worth a second look before they're made.
    if (!parsed || parsed.habit || parsed.input.attendees?.length) {
      tasks.create({ text: words, prefill: contextPrefill(filters, lists) });
      setText("");
      return;
    }
    setBusy(true);
    try {
      const made = await createItem({
        ...withQuickAdd(
          contextPrefill(filters, lists),
          parsed.input,
          parsed.chips,
        ),
        title: parsed.input.title,
        id: crypto.randomUUID(),
      });
      setText("");
      toast({
        text: `Added “${made.title.slice(0, 40)}”`,
        action: { label: "Open", run: () => tasks.open(made) },
      });
    } catch (e) {
      toast({
        text: messageOf(e, "Couldn't add this. Your text is still here."),
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="work-quick">
      <Plus aria-hidden="true" />
      <input
        aria-label="Add a task"
        dir="auto"
        maxLength={500}
        placeholder="Add a task: Call Sam tomorrow 3pm #work !high"
        value={text}
        disabled={busy}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void add();
          }
        }}
      />
    </div>
  );
}
