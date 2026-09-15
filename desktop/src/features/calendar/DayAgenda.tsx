import { Fragment } from "react";
import { Users } from "lucide-react";
import { dayHeading, emptyDay, type Item } from "@orbyn/core";
import { usePlanning } from "../../app/planning";
import { stagger } from "../../lib/motion";
import { progressOf } from "../../lib/tasks";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusPill } from "../../components/StatusPill";
import { firstDay, isAllDay, isMultiDay, lastDay, timeLabel } from "./dates";
import { listLook } from "./MonthView";

type Props = {
  day: Date;
  items: Item[];
  onOpen: (item: Item, anchor?: DOMRect) => void;
};

/**
 * The selected day's items beside the month grid on wide screens and below it
 * on narrower ones (like the mobile calendar).
 */
export function DayAgenda({ day, items, onOpen }: Props) {
  const { listById } = usePlanning();
  return (
    <section className="calendar-agenda" aria-live="polite">
      <Fragment key={day.toDateString()}>
        <h3 className="fade-in">
          {dayHeading(day)}
          <span>{items.length}</span>
        </h3>
        {items.length === 0 ? (
          <div className="agenda-empty fade-in">
            <strong>{emptyDay.title}</strong>
            <p>{emptyDay.body}</p>
          </div>
        ) : (
          items.map((i, n) => {
            const continued =
              firstDay(i).getTime() <
              new Date(
                day.getFullYear(),
                day.getMonth(),
                day.getDate(),
              ).getTime();
            const look = listLook(i.list_id, listById, i.color);
            return (
              <button
                key={i.id}
                className={
                  "calendar-agenda-item fade-up stagger " +
                  (i.status === "done" ? "done" : "") +
                  look.className
                }
                style={{ ...stagger(n), ...look.style }}
                onClick={(e) =>
                  onOpen(i, e.currentTarget.getBoundingClientRect())
                }
              >
                <span className="agenda-time">
                  {continued ? (
                    <>
                      Ongoing
                      <small>
                        until{" "}
                        {lastDay(i).toLocaleDateString([], {
                          day: "numeric",
                          month: "short",
                        })}
                      </small>
                    </>
                  ) : isAllDay(i) && !isMultiDay(i) ? (
                    "All day"
                  ) : (
                    timeLabel(new Date(i.due_at!))
                  )}
                </span>
                <span className="agenda-main">
                  <strong>{i.title}</strong>
                  <small>
                    {i.kind === "event" ? "Event" : "Task"}
                    {i.team_name && (
                      <>
                        {" · "}
                        <Users size={11} aria-hidden="true" /> {i.team_name}
                      </>
                    )}
                  </small>
                  {i.kind === "task" && (
                    <ProgressBar
                      value={progressOf(i)}
                      status={i.status}
                      label={`Progress on ${i.title}`}
                    />
                  )}
                </span>
                {i.kind === "task" && <StatusPill status={i.status} />}
              </button>
            );
          })
        )}
      </Fragment>
    </section>
  );
}
