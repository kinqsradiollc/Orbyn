import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from "react";
import { Sparkles, Timer, Users, Video } from "lucide-react";
import {
  sameDay,
  statusLabels,
  type CalendarEntry,
  type DerivedBlock,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";
import {
  clockIn,
  joinable,
  spanLabel,
  zoneAbbr,
  zoneCity,
} from "../../lib/planning";
import { hourLabel, minutesOf, timeLabel } from "./dates";
import { layoutSpans, type Span } from "./layout";
import { entryClass } from "./MonthView";
import {
  entryEnd,
  entryKey,
  entryOnDay,
  isAllDayEntry,
  TASK_MIME,
} from "./model";

const HOUR_PX = 48;
const PX_PER_MIN = HOUR_PX / 60;
const HOURS = Array.from({ length: 24 }, (_, n) => n);
const SNAP = 15;

type Cell =
  | { type: "entry"; entry: CalendarEntry }
  | { type: "block"; block: TimeBlock }
  | { type: "ghost"; ghost: PlannedBlock };

type Props = {
  days: Date[];
  entries: CalendarEntry[];
  blocks: TimeBlock[];
  derived: DerivedBlock[];
  /** Blocks a plan preview proposes (not saved yet). */
  ghosts: PlannedBlock[];
  /** Extra time-zone columns beside the hours. */
  zones: string[];
  onOpenDay: (day: Date) => void;
  onEntry: (entry: CalendarEntry, anchor: DOMRect) => void;
  onBlock: (block: TimeBlock, anchor: DOMRect) => void;
  /** A task dropped on the grid at `start`. */
  onDropTask: (itemId: string, start: Date) => void;
  /** A block dragged to a new time or resized. */
  onChangeBlock: (block: TimeBlock, start: Date, end: Date) => void;
};

type Gesture = {
  mode: "move" | "resize";
  block: TimeBlock;
  day: number;
  x: number;
  y: number;
  start: number;
  end: number;
  moved: boolean;
};

/** The current time, refreshed every 30 seconds (for the now-line and Join). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const at = (day: Date, minutes: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

/**
 * Week and Day time grid on the calendar API: events and dated tasks, time
 * blocks (drag to move, drag the bottom edge to resize), buffers and travel
 * as hatched bands, plan-preview ghosts, extra time-zone columns, and a drop
 * target for tasks dragged from the side list.
 */
export function CalendarGrid({
  days,
  entries,
  blocks,
  derived,
  ghosts,
  zones,
  onOpenDay,
  onEntry,
  onBlock,
  onDropTask,
  onChangeBlock,
}: Props) {
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDragState] = useState<{
    id: string;
    start: Date;
    end: Date;
  } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (next: typeof drag) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [dropHint, setDropHint] = useState<{
    day: number;
    minutes: number;
  } | null>(null);
  const showsToday = days.some((d) => sameDay(d, now));
  const rangeKey = days[0].toDateString() + days.length;

  // Scroll to an hour before now on today, otherwise to 8 AM.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const minutes = showsToday ? minutesOf(new Date()) - 60 : 8 * 60;
    el.scrollTop = Math.max(0, minutes * PX_PER_MIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const minutesAt = (clientY: number, day: number) => {
    const rect = cols.current[day]?.getBoundingClientRect();
    if (!rect) return 9 * 60;
    const raw = (clientY - rect.top) / PX_PER_MIN;
    return Math.min(24 * 60 - SNAP, Math.max(0, Math.round(raw / SNAP) * SNAP));
  };

  // ---- moving and resizing blocks ----
  const begin = (
    e: PointerEvent<HTMLElement>,
    block: TimeBlock,
    mode: Gesture["mode"],
    day: number,
  ) => {
    // Touch keeps scrolling the grid; blocks move from their menu instead.
    if (e.button !== 0 || (e.pointerType === "touch" && mode === "move"))
      return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      mode,
      block,
      day,
      x: e.clientX,
      y: e.clientY,
      start: Date.parse(block.start_at),
      end: Date.parse(block.end_at),
      moved: false,
    };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    g.moved = true;
    const delta = Math.round(dy / PX_PER_MIN / SNAP) * SNAP * 60_000;
    if (g.mode === "resize") {
      const end = Math.max(g.start + SNAP * 60_000, g.end + delta);
      setDrag({ id: g.block.id, start: new Date(g.start), end: new Date(end) });
      return;
    }
    const over = cols.current.findIndex((c) => {
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    const start = new Date(g.start + delta);
    start.setDate(start.getDate() + (over === -1 ? 0 : over - g.day));
    setDrag({
      id: g.block.id,
      start,
      end: new Date(start.getTime() + g.end - g.start),
    });
  };
  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    const d = dragRef.current;
    if (g?.moved) {
      suppressClick.current = true;
      if (d && (d.start.getTime() !== g.start || d.end.getTime() !== g.end))
        onChangeBlock(g.block, d.start, d.end);
    }
    setDrag(null);
  };
  const cancel = () => {
    gesture.current = null;
    setDrag(null);
  };

  // ---- dropping tasks from the side list ----
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(TASK_MIME);
  const onDragOver = (e: DragEvent<HTMLDivElement>, day: number) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const minutes = minutesAt(e.clientY, day);
    if (dropHint?.day !== day || dropHint.minutes !== minutes)
      setDropHint({ day, minutes });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, day: number) => {
    setDropHint(null);
    const id = e.dataTransfer.getData(TASK_MIME);
    if (!id) return;
    e.preventDefault();
    onDropTask(id, at(days[day], minutesAt(e.clientY, day)));
  };

  const gutters = 1 + zones.length;
  const style = {
    "--days": days.length,
    "--gutter": `${gutters * 56}px`,
  } as CSSProperties;
  const nowTop = minutesOf(now) * PX_PER_MIN;
  const shownBlocks = blocks.map((b) =>
    drag?.id === b.id
      ? {
          ...b,
          start_at: drag.start.toISOString(),
          end_at: drag.end.toISOString(),
        }
      : b,
  );
  const spans: Span<Cell>[] = [
    ...entries
      .filter((e) => !isAllDayEntry(e))
      .map((entry) => ({
        key: "e:" + entryKey(entry),
        start: new Date(entry.start_at),
        end: entryEnd(entry),
        data: { type: "entry" as const, entry },
      })),
    ...shownBlocks.map((block) => ({
      key: "b:" + block.id,
      start: new Date(block.start_at),
      end: new Date(block.end_at),
      data: { type: "block" as const, block },
    })),
    ...ghosts.map((ghost) => ({
      key: "g:" + ghost.item_id + ghost.start_at,
      start: new Date(ghost.start_at),
      end: new Date(ghost.end_at),
      data: { type: "ghost" as const, ghost },
    })),
  ];

  return (
    <div className="timegrid" style={style}>
      <div className="tg-head">
        <span className="tg-corner tg-zone-heads">
          {zones.length > 0 &&
            [null, ...zones].map((z) => (
              <small key={z ?? "local"} title={z ?? "Your time zone"}>
                {z ? zoneCity(z) : "Local"}
                <br />
                {z ? zoneAbbr(z, days[0]) : ""}
              </small>
            ))}
        </span>
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
        {days.map((d) => (
          <div className="tg-allday-cell" key={d.toISOString()}>
            {entries
              .filter((e) => isAllDayEntry(e) && entryOnDay(e, d))
              .map((e) => (
                <button
                  key={entryKey(e)}
                  className={entryClass(e)}
                  title={e.title}
                  aria-label={`${e.title} (${e.kind === "event" ? "Event" : statusLabels[e.status]}, all day)`}
                  aria-haspopup="dialog"
                  onClick={(ev) =>
                    onEntry(e, ev.currentTarget.getBoundingClientRect())
                  }
                >
                  {e.kind === "task" && (
                    <i className="dot" aria-hidden="true" />
                  )}
                  <span className="cal-title">{e.title}</span>
                  {e.team_id && (
                    <Users size={10} className="team-mark" aria-hidden="true" />
                  )}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div className="tg-scroll" ref={scroller}>
        <div className="tg-body" style={{ height: 24 * HOUR_PX }}>
          <div className="tg-hours" aria-hidden="true">
            {[null, ...zones].map((zone) => (
              <div className="tg-zone" key={zone ?? "local"}>
                {HOURS.map((h) => (
                  <span key={h} style={{ top: h * HOUR_PX }}>
                    {zone ? clockIn(zone, at(days[0], h * 60)) : hourLabel(h)}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {days.map((d, n) => {
            const isToday = sameDay(d, now);
            const dayStart = at(d, 0).getTime();
            const dayEnd = at(d, 24 * 60).getTime();
            return (
              <div
                key={d.toISOString()}
                ref={(el) => {
                  cols.current[n] = el;
                }}
                className={"tg-col " + (isToday ? "is-today" : "")}
                style={{ "--hour": HOUR_PX + "px" } as CSSProperties}
                onDragOver={(e) => onDragOver(e, n)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDropHint(null);
                }}
                onDrop={(e) => onDrop(e, n)}
              >
                {derived
                  .filter(
                    (x) =>
                      Date.parse(x.start_at) < dayEnd &&
                      Date.parse(x.end_at) > dayStart,
                  )
                  .map((x) => {
                    const top =
                      (Math.max(Date.parse(x.start_at), dayStart) - dayStart) /
                      60000;
                    const bottom =
                      (Math.min(Date.parse(x.end_at), dayEnd) - dayStart) /
                      60000;
                    return (
                      <div
                        key={x.kind + x.item_id + x.start_at}
                        className={"tg-band is-" + x.kind}
                        style={{
                          top: top * PX_PER_MIN,
                          height: Math.max(4, (bottom - top) * PX_PER_MIN),
                        }}
                        title={x.label}
                      >
                        {(bottom - top) * PX_PER_MIN >= 14 && (
                          <span>{x.label}</span>
                        )}
                      </div>
                    );
                  })}
                {layoutSpans(spans, d, 0, 24).map((p) => {
                  const short = p.height * PX_PER_MIN < 38;
                  const place = {
                    top: p.top * PX_PER_MIN,
                    height: p.height * PX_PER_MIN - 2,
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${100 / p.cols}% - 4px)`,
                  };
                  const cell = p.data;
                  if (cell.type === "entry") {
                    const e = cell.entry;
                    const time = e.end_at
                      ? spanLabel(e.start_at, e.end_at)
                      : timeLabel(new Date(e.start_at));
                    return (
                      <div key={p.key} className="tg-slot" style={place}>
                        <button
                          className={
                            entryClass(e) +
                            " tg-event" +
                            (short ? " is-short" : "")
                          }
                          aria-label={`${e.title} (${
                            e.kind === "event"
                              ? "Event"
                              : statusLabels[e.status]
                          }, ${time}${e.team_name ? ", " + e.team_name : ""}${
                            e.occurrence ? ", repeats" : ""
                          })`}
                          aria-haspopup="dialog"
                          onClick={(ev) =>
                            onEntry(e, ev.currentTarget.getBoundingClientRect())
                          }
                        >
                          <span className="cal-title">
                            {e.kind === "task" && (
                              <i className="dot" aria-hidden="true" />
                            )}
                            {e.title}
                          </span>
                          <small>
                            {time}
                            {e.team_id && (
                              <Users
                                size={10}
                                className="team-mark"
                                aria-hidden="true"
                              />
                            )}
                          </small>
                        </button>
                        {joinable(e, now.getTime()) && (
                          <a
                            className="tg-join"
                            href={e.meeting_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Join ${e.title}`}
                          >
                            <Video size={11} aria-hidden="true" /> Join
                          </a>
                        )}
                      </div>
                    );
                  }
                  if (cell.type === "block") {
                    const b = cell.block;
                    const dragging = drag?.id === b.id;
                    return (
                      <div
                        key={p.key}
                        className={"tg-slot" + (dragging ? " is-dragging" : "")}
                        style={place}
                      >
                        <button
                          className={
                            "cal-block tg-event" +
                            (short ? " is-short" : "") +
                            (b.status === "done" ? " is-done" : "")
                          }
                          aria-label={`Time for ${b.title}, ${spanLabel(b.start_at, b.end_at)}`}
                          aria-haspopup="dialog"
                          onPointerDown={(ev) => begin(ev, b, "move", n)}
                          onPointerMove={move}
                          onPointerUp={finish}
                          onPointerCancel={cancel}
                          onClick={(ev) => {
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            onBlock(
                              b,
                              ev.currentTarget.getBoundingClientRect(),
                            );
                          }}
                        >
                          <span className="cal-title">
                            <Timer size={11} aria-hidden="true" />
                            {b.title}
                          </span>
                          <small>{spanLabel(b.start_at, b.end_at)}</small>
                        </button>
                        <span
                          className="tg-resize"
                          aria-hidden="true"
                          onPointerDown={(ev) => begin(ev, b, "resize", n)}
                          onPointerMove={move}
                          onPointerUp={finish}
                          onPointerCancel={cancel}
                        />
                      </div>
                    );
                  }
                  const g = cell.ghost;
                  return (
                    <div
                      key={p.key}
                      className={
                        "tg-slot cal-ghost" + (short ? " is-short" : "")
                      }
                      style={place}
                      role="img"
                      aria-label={`Planned: ${g.title}, ${spanLabel(g.start_at, g.end_at)}`}
                    >
                      <span className="cal-title">
                        <Sparkles size={11} aria-hidden="true" />
                        {g.title}
                      </span>
                      <small>
                        {spanLabel(g.start_at, g.end_at)}
                        {g.parts > 1 && ` · ${g.part}/${g.parts}`}
                      </small>
                    </div>
                  );
                })}
                {dropHint?.day === n && (
                  <div
                    className="tg-drop"
                    style={{ top: dropHint.minutes * PX_PER_MIN }}
                    aria-hidden="true"
                  >
                    {timeLabel(at(d, dropHint.minutes))}
                  </div>
                )}
                {isToday && (
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
