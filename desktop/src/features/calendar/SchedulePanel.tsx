import { useState } from "react";
import { CalendarPlus, GripVertical } from "lucide-react";
import {
  dueDateOf,
  isClosed,
  rowFitChip,
  stillToPlan,
  stillToPlanLabel,
  type Item,
} from "@orbyn/core";
import { usePlanned } from "../../app/planned";
import { byScore, minutesLabel } from "../../lib/planning";
import { TASK_MIME } from "./model";

type Props = {
  items: Item[];
  /** Pick a time with the keyboard-friendly dialog. */
  onSchedule: (item: Item) => void;
};

const SHOWN = 12;

/**
 * Open tasks to drag onto the calendar (or schedule with a button). Tasks
 * already on track (all they still need is planned before the deadline) are
 * left out; the rest say how much is still to plan.
 */
export function SchedulePanel({ items, onSchedule }: Props) {
  const [all, setAll] = useState(false);
  const { byItem } = usePlanned();
  const open = items
    .filter(
      (i) =>
        i.kind === "task" &&
        !isClosed(i.status) &&
        stillToPlan(byItem.get(i.id)) !== 0,
    )
    .sort(byScore(new Date(), items));
  const shown = all ? open : open.slice(0, SHOWN);
  /** Its status, when a row would show one ("At risk", "Short 2h"…). */
  const status = (i: Item) => {
    const chip = rowFitChip(byItem.get(i.id)?.fit);
    return chip && chip.tone === "warn" ? (
      <span className={`plan-chip is-${chip.tone}`}>{chip.text}</span>
    ) : null;
  };
  return (
    <section className="card schedule-panel" aria-labelledby="schedule-title">
      <div className="section-heading">
        <h2 id="schedule-title">
          Tasks to place <span>{open.length}</span>
        </h2>
      </div>
      <p className="panel-hint">
        Drag a task onto the calendar to plan a session, or choose Schedule.
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
                <small>{placeLine(i, stillToPlan(byItem.get(i.id)))}</small>
                {status(i)}
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
        <p className="panel-hint">
          Nothing left to place: every open task has its time planned.
        </p>
      )}
      {open.length > SHOWN && (
        <button className="text-button panel-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${open.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * "2 h still to plan · due Fri 2 Oct, 5 pm", or, without the planned feed,
 * the estimate: "45 min · due …" ("No estimate · 30 min").
 */
function placeLine(i: Item, toPlan: number | null) {
  const size =
    toPlan != null
      ? stillToPlanLabel(toPlan)
      : i.estimate_minutes
        ? minutesLabel(i.estimate_minutes)
        : "No estimate · 30 min";
  const due = dueDateOf(i);
  return due ? `${size} · due ${due}` : size;
}
