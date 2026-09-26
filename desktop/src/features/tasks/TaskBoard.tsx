import { useRef, useState } from "react";
import { Select } from "../../components/Select";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ListChecks,
  MessageSquare,
  Plus,
  Users,
} from "lucide-react";
import {
  dateLabel,
  durationText,
  type BoardGroupBy,
  type Item,
  type TaskGroup,
} from "@orbyn/core";
import { ProgressBar } from "../../components/ProgressBar";
import { ItemFacts } from "../../components/ItemFacts";
import { stagger } from "../../lib/motion";
import { isOverdue, progressOf, stepsLabel } from "../../lib/tasks";
import { CARD_MIME, carries, edgeScroll, startDrag } from "../../lib/drag";

type Props = {
  /** The columns, in order, each with its cards. */
  columns: TaskGroup[];
  /** What the columns are: moving a card changes this on its task. */
  by: BoardGroupBy;
  /** Where a card's Move to menu can send it (every column, shown or not). */
  targets: { key: string; title: string }[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onOpen: (item: Item) => void;
  /** A card moved from one column to another (drag, or its Move to menu). */
  onMove: (item: Item, from: string, to: string) => void;
  /** + in a column's header: a new task with that column's value. */
  onAdd?: (column: string) => void;
  /** Columns folded down to their header. */
  folded: Set<string>;
  onToggleFold: (column: string) => void;
  /** A subtask's parent title, shown above it. */
  parentOf?: (item: Item) => string | undefined;
};

/**
 * One column per status, list, priority, assignee or tag. Cards drag
 * between columns (DATA-03) and each keeps a Move to menu for the keyboard
 * and screen readers. Each column's header folds it and shows its count and
 * estimated time (DATA-04), with + to add a task there. Many columns scroll
 * sideways, and a card dragged near an edge scrolls the board along.
 */
export function TaskBoard({
  columns,
  by,
  targets,
  busy,
  canWrite,
  onOpen,
  onMove,
  onAdd,
  folded,
  onToggleFold,
  parentOf,
}: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ id: string; from: string } | null>(
    null,
  );
  const [over, setOver] = useState<string | null>(null);
  const scrolls = columns.length > 5;
  const byId = new Map(columns.flatMap((c) => c.items.map((i) => [i.id, i])));

  const drop = (to: string, raw: string) => {
    setOver(null);
    setDragging(null);
    try {
      const { id, from } = JSON.parse(raw) as { id: string; from: string };
      const item = byId.get(id);
      if (item && from !== to) onMove(item, from, to);
    } catch {
      // Something else was dropped here: nothing to move.
    }
  };

  return (
    <div
      ref={boardRef}
      className={"board" + (scrolls ? " is-scroll" : "")}
      style={{ "--cols": columns.length } as never}
      onDragOver={(e) => {
        if (carries(e, CARD_MIME)) edgeScroll(boardRef.current, e.clientX);
      }}
    >
      {columns.map((column) => {
        const isFolded = folded.has(column.key);
        const titleId = `board-${by}-${column.key}`;
        return (
          <section
            key={column.key}
            className={
              "board-column" +
              (by === "status" ? ` tone-${column.key}` : "") +
              (isFolded ? " is-folded" : "") +
              (over === column.key && dragging?.from !== column.key
                ? " is-drop"
                : "")
            }
            aria-labelledby={titleId}
            onDragOver={(e) => {
              if (!carries(e, CARD_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (over !== column.key) setOver(column.key);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null))
                return;
              setOver((o) => (o === column.key ? null : o));
            }}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(CARD_MIME);
              if (!raw) return;
              e.preventDefault();
              drop(column.key, raw);
            }}
          >
            <h3 id={titleId} className="board-column-head">
              <button
                type="button"
                className="board-fold"
                aria-expanded={!isFolded}
                aria-label={`${isFolded ? "Show" : "Fold"} ${column.title}`}
                onClick={() => onToggleFold(column.key)}
              >
                {isFolded ? (
                  <ChevronRight size={14} aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} aria-hidden="true" />
                )}
                {by === "status" ? (
                  <i aria-hidden="true" />
                ) : (
                  column.color && (
                    <i
                      className="list-dot"
                      style={{ background: column.color }}
                      aria-hidden="true"
                    />
                  )
                )}
                <span className="board-column-title">{column.title}</span>
              </button>
              <span
                className="board-column-count"
                title={
                  column.minutes
                    ? `${column.items.length} · ${durationText(column.minutes)} estimated`
                    : undefined
                }
              >
                {column.items.length}
                {column.minutes > 0 && (
                  <small> · {durationText(column.minutes)}</small>
                )}
              </span>
              {onAdd && (
                <button
                  type="button"
                  className="icon-button board-add"
                  aria-label={`New task in ${column.title}`}
                  title={`New task in ${column.title}`}
                  onClick={() => onAdd(column.key)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
              )}
            </h3>
            {!isFolded && column.items.length === 0 && (
              <p className="board-empty">
                {dragging ? "Drop here" : "Nothing here yet."}
              </p>
            )}
            {!isFolded &&
              column.items.map((i, n) => {
                const steps = stepsLabel(i);
                const writable = canWrite(i);
                return (
                  <article
                    key={i.id}
                    className={
                      "board-card fade-up stagger" +
                      (dragging?.id === i.id ? " is-dragging" : "")
                    }
                    style={stagger(n)}
                    draggable={writable && !busy}
                    onDragStart={(e) => {
                      startDrag(e, { kind: "task", id: i.id, title: i.title });
                      e.dataTransfer.setData(
                        CARD_MIME,
                        JSON.stringify({ id: i.id, from: column.key }),
                      );
                      e.dataTransfer.effectAllowed = "move";
                      setDragging({ id: i.id, from: column.key });
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <button
                      className="board-card-main"
                      onClick={() => onOpen(i)}
                      aria-label={`Open ${i.title}`}
                    >
                      {parentOf?.(i) && (
                        <span className="row-parent">↳ {parentOf(i)}</span>
                      )}
                      <strong>{i.title}</strong>
                      <span className="board-card-meta">
                        {i.due_at && (
                          <span
                            className={isOverdue(i) ? "is-overdue" : undefined}
                          >
                            <CalendarClock size={12} aria-hidden="true" />
                            {dateLabel(i.due_at)}
                            {isOverdue(i) && " · Overdue"}
                          </span>
                        )}
                        {i.team_name && (
                          <span>
                            <Users size={12} aria-hidden="true" />
                            {i.team_name}
                          </span>
                        )}
                      </span>
                      <ItemFacts item={i} />
                      <ProgressBar
                        value={progressOf(i)}
                        status={i.status}
                        label={`Progress on ${i.title}`}
                      />
                      {(steps || !!i.updates_count) && (
                        <span className="board-card-meta">
                          {steps && (
                            <span>
                              <ListChecks size={12} aria-hidden="true" />
                              {steps}
                            </span>
                          )}
                          {!!i.updates_count && (
                            <span>
                              <MessageSquare size={12} aria-hidden="true" />
                              {i.updates_count}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                    <div className="board-card-foot">
                      <span className={"priority " + i.priority}>
                        {i.priority}
                      </span>
                      <label className="board-move">
                        <span className="sr-only">Move {i.title} to</span>
                        <Select
                          value={column.key}
                          disabled={busy || !writable}
                          title={writable ? "Move to…" : "View only"}
                          onChange={(e) =>
                            onMove(i, column.key, e.target.value)
                          }
                        >
                          {targets.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.key === column.key
                                ? c.title
                                : "Move to " + c.title}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>
                  </article>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
