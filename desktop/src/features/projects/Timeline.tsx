import { useMemo } from "react";
import {
  projectTimeline,
  projectSessionTicks,
  type Item,
  type Project,
  type ProjectSession,
} from "@orbyn/core";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * The project on one time axis: each bar runs from when a task would have to
 * start (its deadline less its estimate) to its deadline (`deadlineOf`: an
 * all-day task is due by the end of its day), with markers for today and the
 * project's deadline. Undated tasks are listed underneath, since a
 * timeline can only place what has a date.
 */
export function Timeline({
  project,
  items,
  sessions,
  onOpenItem,
}: {
  project: Project;
  items: Item[];
  sessions: ProjectSession[];
  onOpenItem: (item: Item) => void;
}) {
  const mine = useMemo(
    () => items.filter((i) => i.project_id === project.id),
    [items, project.id],
  );
  const line = useMemo(
    () => projectTimeline(project, mine, new Date(), sessions),
    [project, mine, sessions],
  );
  const undated = mine.filter((i) => !i.due_at);
  const byId = new Map(mine.map((i) => [i.id, i]));

  if (!line)
    return (
      <p className="muted timeline-empty">
        Give a task a date and it will appear here.
      </p>
    );

  const ticks = projectSessionTicks(line, sessions);
  const undatedWithSessions = undated.filter((item) =>
    ticks.some((tick) => tick.item_id === item.id),
  );
  const notShown = undated.length - undatedWithSessions.length;

  return (
    <div className="timeline">
      <div className="timeline-axis">
        <span>{day(line.start)}</span>
        <span className="muted">
          {line.days} day{line.days === 1 ? "" : "s"}
        </span>
        <span>{day(line.end)}</span>
      </div>

      <div className="timeline-rows">
        {/* The marks sit in an overlay that covers only the track column, so
            a percentage means the same thing for a mark as for a bar. */}
        <div className="timeline-marks" aria-hidden="true">
          {line.deadlineAt !== null && (
            <span
              className="timeline-mark is-deadline"
              style={{ left: `${line.deadlineAt}%` }}
            />
          )}
          {line.todayAt !== null && (
            <span
              className="timeline-mark is-today"
              style={{ left: `${line.todayAt}%` }}
            />
          )}
        </div>

        {line.bars.map((bar) => {
          const item = byId.get(bar.id);
          return (
            <div key={bar.id} className="timeline-row">
              <span className="timeline-label" title={bar.title}>
                {bar.title}
              </span>
              <span className="timeline-track">
                <button
                  className={
                    "timeline-bar" +
                    (bar.done ? " is-done" : "") +
                    (bar.late ? " is-late" : "")
                  }
                  style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  onClick={() => item && onOpenItem(item)}
                  title={`${bar.title}${bar.stage ? ` · ${bar.stage}` : ""}`}
                >
                  <span className="sr-only">
                    {bar.title}
                    {bar.stage ? `, ${bar.stage}` : ""}
                    {bar.late ? ", overdue" : ""}
                  </span>
                </button>
                {ticks
                  .filter((tick) => tick.item_id === bar.id)
                  .map((tick) => (
                    <button
                      key={tick.id}
                      className="timeline-session"
                      style={{ left: `${tick.left}%`, width: `${tick.width}%` }}
                      onClick={() => item && onOpenItem(item)}
                      title={`Scheduled session · ${new Date(tick.start_at).toLocaleString()}`}
                      aria-label={`Open ${bar.title} session on ${new Date(tick.start_at).toLocaleString()}`}
                    />
                  ))}
              </span>
            </div>
          );
        })}
        {undatedWithSessions.map((item) => (
          <div key={item.id} className="timeline-row">
            <span className="timeline-label" title={item.title}>
              {item.title}
            </span>
            <span className="timeline-track">
              {ticks
                .filter((tick) => tick.item_id === item.id)
                .map((tick) => (
                  <button
                    key={tick.id}
                    className="timeline-session"
                    style={{ left: `${tick.left}%`, width: `${tick.width}%` }}
                    onClick={() => onOpenItem(item)}
                    title={`Scheduled session · ${new Date(tick.start_at).toLocaleString()}`}
                    aria-label={`Open ${item.title} session on ${new Date(tick.start_at).toLocaleString()}`}
                  />
                ))}
            </span>
          </div>
        ))}
      </div>

      <p className="timeline-key muted">
        <span className="timeline-swatch is-today" aria-hidden="true" /> Today
        {line.deadlineAt !== null && (
          <>
            <span className="timeline-swatch is-deadline" aria-hidden="true" />{" "}
            Deadline
          </>
        )}
        <span className="timeline-swatch is-late" aria-hidden="true" /> Overdue
        <span className="timeline-swatch is-session" aria-hidden="true" />{" "}
        Scheduled session
      </p>

      {notShown > 0 && (
        <p className="timeline-undated muted">
          {notShown} task{notShown === 1 ? "" : "s"} without a date or session
          {notShown === 1 ? " isn't" : " aren't"} shown.
        </p>
      )}
    </div>
  );
}
