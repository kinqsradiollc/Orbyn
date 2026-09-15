import { useState } from "react";
import { CalendarPlus, GripVertical } from "lucide-react";
import { dateLabel, type Item } from "@orbyn/core";
import { byScore, minutesLabel } from "../../lib/planning";
import { TASK_MIME } from "./model";

type Props = {
  items: Item[];
  /** Pick a time with the keyboard-friendly dialog. */
  onSchedule: (item: Item) => void;
};

const SHOWN = 12;

/** Open tasks to drag onto the calendar (or schedule with a button). */
export function SchedulePanel({ items, onSchedule }: Props) {
  const [all, setAll] = useState(false);
  const open = items
    .filter((i) => i.kind === "task" && i.status !== "done")
    .sort(byScore());
  const shown = all ? open : open.slice(0, SHOWN);
  return (
    <section className="card schedule-panel" aria-labelledby="schedule-title">
      <div className="section-heading">
        <h2 id="schedule-title">
          Tasks to place <span>{open.length}</span>
        </h2>
      </div>
      <p className="panel-hint">
        Drag a task onto the calendar to set time aside, or choose Schedule.
      </p>
      {shown.length ? (
        <ul className="schedule-list">
          {shown.map((i) => (
            <li
              key={i.id}
              draggable
              className="schedule-item"
              onDragStart={(e) => {
                e.dataTransfer.setData(TASK_MIME, i.id);
                e.dataTransfer.setData("text/plain", i.title);
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              <GripVertical size={14} className="grip" aria-hidden="true" />
              <span className="schedule-main">
                <strong>{i.title}</strong>
                <small>
                  {i.estimate_minutes
                    ? minutesLabel(i.estimate_minutes)
                    : "No estimate · 30 min"}
                  {i.due_at && ` · due ${dateLabel(i.due_at)}`}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Schedule ${i.title}`}
                title="Schedule…"
                onClick={() => onSchedule(i)}
              >
                <CalendarPlus size={15} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel-hint">No open tasks. A clear runway.</p>
      )}
      {open.length > SHOWN && (
        <button className="text-button panel-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${open.length}`}
        </button>
      )}
    </section>
  );
}
