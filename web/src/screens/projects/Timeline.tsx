import {
  projectSessionTicks,
  projectTimeline,
  type Item,
  type Project,
  type ProjectSession,
} from "@orbyn/core";
import { useMemo } from "react";
import { tasks } from "../shared-task";
import { shortDate } from "./shared";

/**
 * One time axis: each bar runs from when a task would have to start to its
 * deadline, with today and the project's deadline marked. Undated tasks with
 * sessions still get a row; the rest are counted beneath.
 */
export function Timeline({
  project,
  items,
  sessions,
}: {
  project: Project;
  items: Item[];
  sessions: ProjectSession[];
}) {
  const mine = useMemo(
    () => items.filter((i) => i.project_id === project.id),
    [items, project.id],
  );
  const line = useMemo(
    () => projectTimeline(project, mine, new Date(), sessions),
    [project, mine, sessions],
  );
  if (!line)
    return <p className="muted">Give a task a date and it will appear here.</p>;
  const undated = mine.filter((i) => !i.due_at);
  const byId = new Map(mine.map((i) => [i.id, i]));
  const ticks = projectSessionTicks(line, sessions);
  const withSessions = undated.filter((i) =>
    ticks.some((t) => t.item_id === i.id),
  );
  const notShown = undated.length - withSessions.length;
  const marks = (id: string) =>
    ticks
      .filter((t) => t.item_id === id)
      .map((t) => (
        <span
          key={t.id}
          aria-hidden="true"
          className="pj-tl-session"
          style={{ left: `${t.left}%`, width: `${t.width}%` }}
          title={`Scheduled session · ${new Date(t.start_at).toLocaleString()}`}
        />
      ));
  return (
    <div className="pj-timeline">
      <div className="pj-tl-axis">
        <span>{shortDate(line.start)}</span>
        <span className="muted">
          {line.days} day{line.days === 1 ? "" : "s"}
        </span>
        <span>{shortDate(line.end)}</span>
      </div>
      <div className="pj-tl-rows">
        <div className="pj-tl-marks" aria-hidden="true">
          {line.deadlineAt !== null && (
            <span
              className="is-deadline"
              style={{ left: `${line.deadlineAt}%` }}
            />
          )}
          {line.todayAt !== null && (
            <span className="is-today" style={{ left: `${line.todayAt}%` }} />
          )}
        </div>
        {line.bars.map((bar) => {
          const item = byId.get(bar.id);
          return (
            <div key={bar.id} className="pj-tl-row">
              <button
                dir="auto"
                title={bar.title}
                aria-label={`${bar.title}${bar.stage ? `, ${bar.stage}` : ""}${bar.late ? ", overdue" : ""}`}
                onClick={() => item && tasks.open(item)}
              >
                {bar.title}
              </button>
              <span className="pj-tl-track">
                <span
                  aria-hidden="true"
                  className={`pj-tl-bar${bar.done ? " is-done" : ""}${bar.late ? " is-late" : ""}`}
                  style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
                  title={`${bar.title}${bar.stage ? ` · ${bar.stage}` : ""}`}
                />
                {marks(bar.id)}
              </span>
            </div>
          );
        })}
        {withSessions.map((item) => (
          <div key={item.id} className="pj-tl-row">
            <button
              dir="auto"
              title={item.title}
              onClick={() => tasks.open(item)}
            >
              {item.title}
            </button>
            <span className="pj-tl-track">{marks(item.id)}</span>
          </div>
        ))}
      </div>
      <p className="pj-tl-key muted small">
        <i className="is-today" aria-hidden="true" /> Today
        {line.deadlineAt !== null && (
          <>
            <i className="is-deadline" aria-hidden="true" /> Deadline
          </>
        )}
        <i className="is-late" aria-hidden="true" /> Overdue
        <i className="is-session" aria-hidden="true" /> Scheduled session
      </p>
      {notShown > 0 && (
        <p className="muted small">
          {notShown} task{notShown === 1 ? "" : "s"} without a date or session{" "}
          {notShown === 1 ? "isn't" : "aren't"} shown.
        </p>
      )}
    </div>
  );
}
