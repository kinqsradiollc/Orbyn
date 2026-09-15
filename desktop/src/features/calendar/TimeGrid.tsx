import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Users } from "lucide-react";
import { sameDay, type Item } from "@orbyn/core";
import {
  hourLabel,
  isAllDay,
  itemSpan,
  itemsForDay,
  minutesOf,
  timeLabel,
} from "./dates";
import { layoutDay } from "./layout";
import { entryClass, entryLabel } from "./MonthView";

const START_HOUR = 6;
const END_HOUR = 24;
const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const HOURS = Array.from(
  { length: END_HOUR - START_HOUR },
  (_, n) => START_HOUR + n,
);

type Props = {
  days: Date[];
  items: Item[];
  onOpen: (item: Item) => void;
  /** Clicking a day heading shows that day. */
  onOpenDay: (day: Date) => void;
};

/** The current time, refreshed every minute. */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Time grid for Week and Day: an hour column from 6 AM to midnight, items
 * positioned by start and sized by duration (overlaps side by side), an
 * "All day / no time" row, and a red now-line on today.
 */
export function TimeGrid({ days, items, onOpen, onOpenDay }: Props) {
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const showsToday = days.some((d) => sameDay(d, now));
  const rangeKey = days[0].toDateString() + days.length;

  // Scroll to an hour before now on today, otherwise to 8 AM.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const minutes = showsToday
      ? minutesOf(new Date()) - START_HOUR * 60 - 60
      : (8 - START_HOUR) * 60;
    el.scrollTop = Math.max(0, minutes * PX_PER_MIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const columns = { "--days": days.length } as CSSProperties;
  const nowTop = (minutesOf(now) - START_HOUR * 60) * PX_PER_MIN;

  return (
    <div className="timegrid" style={columns}>
      <div className="tg-head">
        <span className="tg-corner" />
        {days.map((d) => (
          <button
            key={d.toISOString()}
            className={"tg-day " + (sameDay(d, now) ? "is-today" : "")}
            aria-current={sameDay(d, now) ? "date" : undefined}
            aria-label={`Show ${d.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}`}
            onClick={() => onOpenDay(d)}
          >
            <small>{d.toLocaleDateString([], { weekday: "short" })}</small>
            <strong>{d.getDate()}</strong>
          </button>
        ))}
      </div>
      <div className="tg-allday">
        <span className="tg-label">
          All day
          <br />
          no time
        </span>
        {days.map((d) => {
          const allDay = itemsForDay(items, d).filter(isAllDay);
          return (
            <div className="tg-allday-cell" key={d.toISOString()}>
              {allDay.map((i) => (
                <button
                  key={i.id}
                  className={entryClass(i)}
                  title={entryLabel(i)}
                  aria-label={entryLabel(i)}
                  onClick={() => onOpen(i)}
                >
                  {i.kind === "task" && (
                    <i className="dot" aria-hidden="true" />
                  )}
                  <span className="cal-title">{i.title}</span>
                  {i.team_id && (
                    <Users size={10} className="team-mark" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="tg-scroll" ref={scroller}>
        <div
          className="tg-body"
          style={{ height: HOURS.length * HOUR_PX } as CSSProperties}
        >
          <div className="tg-hours" aria-hidden="true">
            {HOURS.map((h, n) => (
              <span key={h} style={{ top: n * HOUR_PX }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          {days.map((d) => {
            const isToday = sameDay(d, now);
            return (
              <div
                key={d.toISOString()}
                className={"tg-col " + (isToday ? "is-today" : "")}
                style={{ "--hour": HOUR_PX + "px" } as CSSProperties}
              >
                {layoutDay(items, d, START_HOUR, END_HOUR).map((p) => {
                  const span = itemSpan(p.item)!;
                  const short = p.height * PX_PER_MIN < 38;
                  return (
                    <button
                      key={p.item.id}
                      className={
                        entryClass(p.item) +
                        " tg-event" +
                        (short ? " is-short" : "")
                      }
                      style={{
                        top: p.top * PX_PER_MIN,
                        height: p.height * PX_PER_MIN - 2,
                        left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                        width: `calc(${100 / p.cols}% - 4px)`,
                      }}
                      title={entryLabel(p.item)}
                      aria-label={entryLabel(p.item)}
                      onClick={() => onOpen(p.item)}
                    >
                      <span className="cal-title">
                        {p.item.kind === "task" && (
                          <i className="dot" aria-hidden="true" />
                        )}
                        {p.item.title}
                      </span>
                      <small>
                        {timeLabel(span.start)}
                        {p.item.end_at && " – " + timeLabel(span.end)}
                        {p.item.team_id && (
                          <Users
                            size={10}
                            className="team-mark"
                            aria-hidden="true"
                          />
                        )}
                      </small>
                    </button>
                  );
                })}
                {isToday && nowTop >= 0 && (
                  <div
                    className="tg-now"
                    style={{ top: nowTop }}
                    role="presentation"
                    title={"Now · " + timeLabel(now)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
