import { CalendarClock, ListChecks, MessageSquare, Users } from "lucide-react";
import {
  dateLabel,
  STATUSES,
  statusLabels,
  type Item,
  type Status,
} from "@orbyn/core";
import { ProgressBar } from "../../components/ProgressBar";
import { ItemFacts } from "../../components/ItemFacts";
import { stagger } from "../../lib/motion";
import { isOverdue, progressOf, stepsLabel } from "../../lib/tasks";

type Props = {
  items: Item[];
  /** Columns to show, in order. */
  statuses: Status[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onOpen: (item: Item) => void;
  onSetStatus: (item: Item, status: Status) => void;
  /** A subtask's parent title, shown above it. */
  parentOf?: (item: Item) => string | undefined;
};

/**
 * One column per status on wide screens, stacked sections on narrow ones.
 * Cards move between columns with their status menu, no dragging needed.
 */
export function TaskBoard({
  items,
  statuses,
  busy,
  canWrite,
  onOpen,
  onSetStatus,
  parentOf,
}: Props) {
  return (
    <div className="board" style={{ "--cols": statuses.length } as never}>
      {statuses.map((status) => {
        const column = items.filter((i) => i.status === status);
        return (
          <section
            key={status}
            className={`board-column tone-${status}`}
            aria-labelledby={`board-${status}`}
          >
            <h3 id={`board-${status}`}>
              <i aria-hidden="true" />
              {statusLabels[status]}
              <span>{column.length}</span>
            </h3>
            {column.length === 0 && (
              <p className="board-empty">Nothing here yet.</p>
            )}
            {column.map((i, n) => {
              const steps = stepsLabel(i);
              const writable = canWrite(i);
              return (
                <article
                  key={i.id}
                  className="board-card fade-up stagger"
                  style={stagger(n)}
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
                      <select
                        value={i.status}
                        disabled={busy || !writable}
                        title={writable ? "Move to…" : "View only"}
                        onChange={(e) =>
                          onSetStatus(i, e.target.value as Status)
                        }
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s === i.status
                              ? statusLabels[s]
                              : "Move to " + statusLabels[s]}
                          </option>
                        ))}
                      </select>
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
