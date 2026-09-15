import { Timer, Users, Video } from "lucide-react";
import {
  dayHeading,
  emptyDay,
  sameDay,
  type CalendarEntry,
  type TimeBlock,
} from "@orbyn/core";
import { usePlanning } from "../../app/planning";
import { joinable, spanLabel } from "../../lib/planning";
import { stagger } from "../../lib/motion";
import { StatusPill } from "../../components/StatusPill";
import { timeLabel } from "./dates";
import { listLook } from "./MonthView";
import { entryKey, entryOnDay, isAllDayEntry } from "./model";

type Props = {
  days: Date[];
  entries: CalendarEntry[];
  blocks: TimeBlock[];
  onEntry: (entry: CalendarEntry, anchor: DOMRect) => void;
  onBlock: (block: TimeBlock, anchor: DOMRect) => void;
};

type Row =
  | { key: string; at: number; entry: CalendarEntry }
  | { key: string; at: number; block: TimeBlock };

/** The next two weeks as a list, day by day: events, tasks and time blocks. */
export function AgendaList({ days, entries, blocks, onEntry, onBlock }: Props) {
  const { listById } = usePlanning();
  const now = Date.now();
  const filled = days
    .map((day) => {
      const rows: Row[] = [
        ...entries
          .filter((e) => entryOnDay(e, day))
          .map((entry) => ({
            key: entryKey(entry),
            at: isAllDayEntry(entry) ? 0 : Date.parse(entry.start_at),
            entry,
          })),
        ...blocks
          .filter((b) => sameDay(new Date(b.start_at), day))
          .map((block) => ({
            key: block.id,
            at: Date.parse(block.start_at),
            block,
          })),
      ].sort((a, b) => a.at - b.at);
      return { day, rows };
    })
    .filter((d) => d.rows.length);

  if (!filled.length)
    return (
      <div className="agenda-list">
        <div className="agenda-empty">
          <strong>{emptyDay.title}</strong>
          <p>Nothing planned for the next two weeks.</p>
        </div>
      </div>
    );

  return (
    <div className="agenda-list">
      {filled.map(({ day, rows }) => (
        <section key={day.toDateString()} className="agenda-day">
          <h3>
            {dayHeading(day)}
            <span>{rows.length}</span>
          </h3>
          {rows.map((r, n) => {
            if ("entry" in r) {
              const look = listLook(r.entry.list_id, listById);
              return (
                <div
                  key={r.key}
                  className="agenda-row fade-up stagger"
                  style={stagger(n)}
                >
                  <button
                    className={
                      "calendar-agenda-item " +
                      (r.entry.status === "done" ? "done" : "") +
                      look.className
                    }
                    style={look.style}
                    aria-haspopup="dialog"
                    onClick={(e) =>
                      onEntry(r.entry, e.currentTarget.getBoundingClientRect())
                    }
                  >
                    <span className="agenda-time">
                      {isAllDayEntry(r.entry)
                        ? "All day"
                        : timeLabel(new Date(r.entry.start_at))}
                    </span>
                    <span className="agenda-main">
                      <strong>{r.entry.title}</strong>
                      <small>
                        {r.entry.kind === "event" ? "Event" : "Task"}
                        {r.entry.occurrence && " · Repeats"}
                        {r.entry.location && ` · ${r.entry.location}`}
                        {r.entry.team_name && (
                          <>
                            {" · "}
                            <Users size={11} aria-hidden="true" />{" "}
                            {r.entry.team_name}
                          </>
                        )}
                      </small>
                    </span>
                    {r.entry.kind === "task" && (
                      <StatusPill status={r.entry.status} />
                    )}
                  </button>
                  {joinable(r.entry, now) && (
                    <a
                      className="secondary agenda-join"
                      href={r.entry.meeting_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Video size={14} aria-hidden="true" /> Join
                    </a>
                  )}
                </div>
              );
            }
            return (
              <div
                key={r.key}
                className="agenda-row fade-up stagger"
                style={stagger(n)}
              >
                <button
                  className="calendar-agenda-item is-block"
                  aria-haspopup="dialog"
                  onClick={(e) =>
                    onBlock(r.block, e.currentTarget.getBoundingClientRect())
                  }
                >
                  <span className="agenda-time">
                    {timeLabel(new Date(r.block.start_at))}
                  </span>
                  <span className="agenda-main">
                    <strong>{r.block.title}</strong>
                    <small>
                      <Timer size={11} aria-hidden="true" /> Time block ·{" "}
                      {spanLabel(r.block.start_at, r.block.end_at)}
                    </small>
                  </span>
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
