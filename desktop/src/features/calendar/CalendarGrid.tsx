import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
} from "react";
import { Pin, Sparkles, Timer, Users, Video, X } from "lucide-react";
import {
  sameDay,
  statusLabels,
  type BusyInterval,
  type CalendarEntry,
  type DerivedBlock,
  type FrameOccurrence,
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
import { usePlanning } from "../../app/planning";
import { layoutSpans, type Span } from "./layout";
import { entryClass, listLook } from "./MonthView";
import type { MateBusy } from "./Teammates";
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
  /** Where an Alt-dragged block's copy will go. */
  | { type: "copy"; block: TimeBlock }
  | { type: "ghost"; ghost: PlannedBlock; id: string };

type Props = {
  days: Date[];
  entries: CalendarEntry[];
  blocks: TimeBlock[];
  derived: DerivedBlock[];
  /** Your frames, drawn as bands behind everything else. */
  frames: FrameOccurrence[];
  onFrame: (frame: FrameOccurrence, anchor: DOMRect) => void;
  /** Blocks a plan preview proposes (not saved yet). */
  ghosts: PlannedBlock[];
  /** Planned blocks can be dragged (to pin them) and removed. */
  tunable: boolean;
  onPinGhost: (ghost: PlannedBlock, start: Date, end: Date) => void;
  onRemoveGhost: (ghost: PlannedBlock) => void;
  /** Times the plan keeps free. */
  keepFree: BusyInterval[];
  /** Set while tuning: dragging across empty time keeps it free. */
  onKeepFree?: (start: Date, end: Date) => void;
  onRemoveKeepFree: (range: BusyInterval) => void;
  /** Extra time-zone columns beside the hours. */
  zones: string[];
  onOpenDay: (day: Date) => void;
  onEntry: (entry: CalendarEntry, anchor: DOMRect) => void;
  onBlock: (block: TimeBlock, anchor: DOMRect) => void;
  /** A task dropped on the grid at `start`. */
  onDropTask: (itemId: string, start: Date) => void;
  /** A block dragged to a new time or resized. */
  onChangeBlock: (block: TimeBlock, start: Date, end: Date) => void;
  /** A block Alt/Option-dragged: copy it to `start`. */
  onDuplicateBlock: (block: TimeBlock, start: Date) => void;
  /** Events and timed tasks you can drag (not repeating ones, for now). */
  canDragEntry: (entry: CalendarEntry) => boolean;
  /** An entry dragged to a new time, or resized from its bottom edge. */
  onChangeEntry: (
    entry: CalendarEntry,
    start: Date,
    end: Date,
    resized: boolean,
  ) => void;
  /** Dragging across empty time (when not keeping time free): a new event. */
  onCreateRange: (start: Date, end: Date) => void;
  /** Teammates' busy times, as thin strips at the side of each day. */
  teammates: MateBusy[];
  /** The picked time, marked in the grid ("C" makes an event there). */
  slot: Date | null;
  /** A click on an empty spot picks that time. */
  onSelectSlot: (start: Date) => void;
};

type Target =
  | { kind: "block"; block: TimeBlock }
  | { kind: "ghost"; ghost: PlannedBlock }
  | { kind: "entry"; entry: CalendarEntry };

type Gesture = {
  mode: "move" | "resize";
  target: Target;
  /** The block id, or the ghost's cell id. */
  id: string;
  day: number;
  x: number;
  y: number;
  start: number;
  end: number;
  moved: boolean;
};

/** A keep-free range being dragged out, in minutes from midnight. */
type Selecting = { day: number; anchor: number; from: number; to: number };

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

const ghostId = (g: PlannedBlock) => "g:" + g.item_id + g.start_at;

/** The part of [start, end) on a day, in minutes from its midnight. */
function onDay(start: string, end: string, dayStart: number, dayEnd: number) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (s >= dayEnd || e <= dayStart) return null;
  return {
    top: (Math.max(s, dayStart) - dayStart) / 60000,
    bottom: (Math.min(e, dayEnd) - dayStart) / 60000,
  };
}

/**
 * Week and Day time grid on the calendar API: events and dated tasks, time
 * blocks (drag to move, drag the bottom edge to resize, Alt-drag to copy),
 * frames as tinted bands, buffers and travel as hatched bands, plan-preview
 * ghosts (drag to pin, × to remove while tuning), events and timed tasks
 * (drag to move, events also resize; not repeating ones yet), dragging across
 * empty time (a new event, or keep-free while tuning), teammates' busy times
 * as thin strips, extra time-zone columns, and a drop target for tasks
 * dragged from the side list.
 */
export function CalendarGrid({
  days,
  entries,
  blocks,
  derived,
  frames,
  onFrame,
  ghosts,
  tunable,
  onPinGhost,
  onRemoveGhost,
  keepFree,
  onKeepFree,
  onRemoveKeepFree,
  zones,
  onOpenDay,
  onEntry,
  onBlock,
  onDropTask,
  onChangeBlock,
  onDuplicateBlock,
  canDragEntry,
  onChangeEntry,
  onCreateRange,
  teammates,
  slot,
  onSelectSlot,
}: Props) {
  const { listById } = usePlanning();
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDragState] = useState<{
    id: string;
    start: Date;
    end: Date;
    copy: boolean;
  } | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (next: typeof drag) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [selecting, setSelectingState] = useState<Selecting | null>(null);
  const selectingRef = useRef(selecting);
  const setSelecting = (next: Selecting | null) => {
    selectingRef.current = next;
    setSelectingState(next);
  };
  /** A keep-free drag just ended; the click that follows isn't a pick. */
  const skipClick = useRef(false);
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

  // ---- moving, resizing and copying blocks; moving planned blocks ----
  const begin = (
    e: PointerEvent<HTMLElement>,
    target: Target,
    id: string,
    mode: Gesture["mode"],
    day: number,
  ) => {
    // Touch keeps scrolling the grid; blocks move from their menu instead.
    if (e.button !== 0 || (e.pointerType === "touch" && mode === "move"))
      return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const span =
      target.kind === "block"
        ? target.block
        : target.kind === "ghost"
          ? target.ghost
          : {
              start_at: target.entry.start_at,
              end_at: entryEnd(target.entry).toISOString(),
            };
    gesture.current = {
      mode,
      target,
      id,
      day,
      x: e.clientX,
      y: e.clientY,
      start: Date.parse(span.start_at),
      end: Date.parse(span.end_at),
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
      setDrag({
        id: g.id,
        start: new Date(g.start),
        end: new Date(end),
        copy: false,
      });
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
      id: g.id,
      start,
      end: new Date(start.getTime() + g.end - g.start),
      copy: g.target.kind === "block" && e.altKey,
    });
  };
  const finish = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    const d = dragRef.current;
    if (g?.moved) {
      suppressClick.current = true;
      if (d && (d.start.getTime() !== g.start || d.end.getTime() !== g.end)) {
        const t = g.target;
        if (t.kind === "entry")
          onChangeEntry(t.entry, d.start, d.end, g.mode === "resize");
        else if (t.kind === "ghost") onPinGhost(t.ghost, d.start, d.end);
        else if (g.mode === "move" && e.altKey)
          onDuplicateBlock(t.block, d.start);
        else onChangeBlock(t.block, d.start, d.end);
      }
    }
    setDrag(null);
  };
  const cancel = () => {
    gesture.current = null;
    setDrag(null);
  };

  // ---- dragging across empty time: keep it free (tuning), else a new event ----
  const startSelect = (e: PointerEvent<HTMLDivElement>, day: number) => {
    if (
      e.target !== e.currentTarget ||
      e.button !== 0 ||
      e.pointerType === "touch"
    )
      return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const m = minutesAt(e.clientY, day);
    setSelecting({ day, anchor: m, from: m, to: m });
  };
  const moveSelect = (e: PointerEvent<HTMLDivElement>, day: number) => {
    const s = selectingRef.current;
    if (!s || s.day !== day) return;
    const m = minutesAt(e.clientY, day);
    const from = Math.min(s.anchor, m);
    const to = Math.max(s.anchor, m);
    if (from !== s.from || to !== s.to) setSelecting({ ...s, from, to });
  };
  const endSelect = (day: number) => {
    const s = selectingRef.current;
    setSelecting(null);
    if (!s || s.to - s.from < SNAP) return;
    skipClick.current = true;
    (onKeepFree ?? onCreateRange)(at(days[day], s.from), at(days[day], s.to));
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
  const moving = drag && !drag.copy ? drag : null;
  const shownBlocks = blocks.map((b) =>
    moving?.id === b.id
      ? {
          ...b,
          start_at: moving.start.toISOString(),
          end_at: moving.end.toISOString(),
        }
      : b,
  );
  const copied = drag?.copy ? blocks.find((b) => b.id === drag.id) : undefined;
  const spans: Span<Cell>[] = [
    ...entries
      .filter((e) => !isAllDayEntry(e))
      .map((entry) => {
        const key = "e:" + entryKey(entry);
        const m = moving?.id === key ? moving : null;
        return {
          key,
          start: m ? m.start : new Date(entry.start_at),
          end: m ? m.end : entryEnd(entry),
          data: { type: "entry" as const, entry },
        };
      }),
    ...shownBlocks.map((block) => ({
      key: "b:" + block.id,
      start: new Date(block.start_at),
      end: new Date(block.end_at),
      data: { type: "block" as const, block },
    })),
    ...(copied && drag
      ? [
          {
            key: "c:" + copied.id,
            start: drag.start,
            end: drag.end,
            data: { type: "copy" as const, block: copied },
          },
        ]
      : []),
    ...ghosts.map((ghost) => {
      const id = ghostId(ghost);
      const shown =
        moving?.id === id
          ? {
              ...ghost,
              start_at: moving.start.toISOString(),
              end_at: moving.end.toISOString(),
            }
          : ghost;
      return {
        key: id,
        start: new Date(shown.start_at),
        end: new Date(shown.end_at),
        data: { type: "ghost" as const, ghost: shown, id },
      };
    }),
  ];
  const ghostById = new Map(ghosts.map((g) => [ghostId(g), g]));

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
              .map((e) => {
                const look = listLook(e.list_id, listById);
                return (
                  <button
                    key={entryKey(e)}
                    className={entryClass(e) + look.className}
                    style={look.style}
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
                      <Users
                        size={10}
                        className="team-mark"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
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
            const draft = selecting?.day === n ? selecting : null;
            return (
              <div
                key={d.toISOString()}
                ref={(el) => {
                  cols.current[n] = el;
                }}
                className={
                  "tg-col" +
                  (isToday ? " is-today" : "") +
                  (draft ? " is-selecting" : "")
                }
                style={{ "--hour": HOUR_PX + "px" } as CSSProperties}
                onDragOver={(e) => onDragOver(e, n)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDropHint(null);
                }}
                onDrop={(e) => onDrop(e, n)}
                onPointerDown={(e) => startSelect(e, n)}
                onPointerMove={(e) => moveSelect(e, n)}
                onPointerUp={() => endSelect(n)}
                onPointerCancel={() => setSelecting(null)}
                onClick={(e) => {
                  if (skipClick.current) {
                    skipClick.current = false;
                    return;
                  }
                  // Only empty space: entries and blocks open their menus.
                  if (e.target === e.currentTarget)
                    onSelectSlot(at(d, minutesAt(e.clientY, n)));
                }}
              >
                {frames.map((f) => {
                  const r = onDay(f.start_at, f.end_at, dayStart, dayEnd);
                  if (!r) return null;
                  return (
                    <div
                      key={"f:" + f.frame_id + f.start_at}
                      className={"tg-frame" + (f.busy ? " is-busy" : "")}
                      style={
                        {
                          top: r.top * PX_PER_MIN,
                          height: (r.bottom - r.top) * PX_PER_MIN,
                          "--frame": f.color,
                        } as CSSProperties
                      }
                    >
                      <button
                        className="tg-frame-label"
                        aria-haspopup="dialog"
                        aria-label={`${f.name} frame, ${spanLabel(f.start_at, f.end_at)}${f.busy ? ", busy" : ""}`}
                        onClick={(ev) =>
                          onFrame(f, ev.currentTarget.getBoundingClientRect())
                        }
                      >
                        {f.name}
                        {f.busy && " · Busy"}
                      </button>
                    </div>
                  );
                })}
                {derived.map((x) => {
                  const r = onDay(x.start_at, x.end_at, dayStart, dayEnd);
                  if (!r) return null;
                  const height = (r.bottom - r.top) * PX_PER_MIN;
                  return (
                    <div
                      key={x.kind + x.item_id + x.start_at}
                      className={"tg-band is-" + x.kind}
                      style={{
                        top: r.top * PX_PER_MIN,
                        height: Math.max(4, height),
                      }}
                      title={x.label}
                    >
                      {height >= 14 && <span>{x.label}</span>}
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
                    const dragged = moving?.id === p.key ? moving : null;
                    const draggable = canDragEntry(e);
                    const repeating = !!(e.occurrence || e.rrule);
                    const time = dragged
                      ? spanLabel(
                          dragged.start.toISOString(),
                          dragged.end.toISOString(),
                        )
                      : e.end_at
                        ? spanLabel(e.start_at, e.end_at)
                        : timeLabel(new Date(e.start_at));
                    const look = listLook(e.list_id, listById);
                    return (
                      <div
                        key={p.key}
                        className={"tg-slot" + (dragged ? " is-dragging" : "")}
                        style={place}
                      >
                        <button
                          className={
                            entryClass(e) +
                            " tg-event" +
                            (short ? " is-short" : "") +
                            (draggable ? " is-draggable" : "") +
                            look.className
                          }
                          style={look.style}
                          title={
                            repeating
                              ? `Open it to change a repeating ${e.kind === "event" ? "event" : "task"}`
                              : undefined
                          }
                          onPointerDown={
                            draggable
                              ? (ev) =>
                                  begin(
                                    ev,
                                    { kind: "entry", entry: e },
                                    p.key,
                                    "move",
                                    n,
                                  )
                              : undefined
                          }
                          onPointerMove={draggable ? move : undefined}
                          onPointerUp={draggable ? finish : undefined}
                          onPointerCancel={draggable ? cancel : undefined}
                          aria-label={`${e.title} (${
                            e.kind === "event"
                              ? "Event"
                              : statusLabels[e.status]
                          }, ${time}${e.team_name ? ", " + e.team_name : ""}${
                            e.occurrence ? ", repeats" : ""
                          })`}
                          aria-haspopup="dialog"
                          onClick={(ev) => {
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            onEntry(
                              e,
                              ev.currentTarget.getBoundingClientRect(),
                            );
                          }}
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
                        {draggable && e.kind === "event" && (
                          <span
                            className="tg-resize"
                            aria-hidden="true"
                            onPointerDown={(ev) =>
                              begin(
                                ev,
                                { kind: "entry", entry: e },
                                p.key,
                                "resize",
                                n,
                              )
                            }
                            onPointerMove={move}
                            onPointerUp={finish}
                            onPointerCancel={cancel}
                          />
                        )}
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
                  if (cell.type === "copy") {
                    const b = cell.block;
                    return (
                      <div
                        key={p.key}
                        className="tg-slot is-copy"
                        style={place}
                        aria-hidden="true"
                      >
                        <span
                          className={
                            "cal-block tg-event" + (short ? " is-short" : "")
                          }
                        >
                          <span className="cal-title">
                            <Timer size={11} />
                            Copy of {b.title}
                          </span>
                          {drag && (
                            <small>
                              {spanLabel(
                                drag.start.toISOString(),
                                drag.end.toISOString(),
                              )}
                            </small>
                          )}
                        </span>
                      </div>
                    );
                  }
                  if (cell.type === "block") {
                    const b = cell.block;
                    const dragging = moving?.id === b.id;
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
                          onPointerDown={(ev) =>
                            begin(
                              ev,
                              { kind: "block", block: b },
                              b.id,
                              "move",
                              n,
                            )
                          }
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
                          onPointerDown={(ev) =>
                            begin(
                              ev,
                              { kind: "block", block: b },
                              b.id,
                              "resize",
                              n,
                            )
                          }
                          onPointerMove={move}
                          onPointerUp={finish}
                          onPointerCancel={cancel}
                        />
                      </div>
                    );
                  }
                  const g = cell.ghost;
                  // Drag and remove the plan's own copy, not the moved one.
                  const original = ghostById.get(cell.id) ?? g;
                  const label = `${g.pinned ? "Pinned" : "Planned"}: ${g.title}, ${spanLabel(g.start_at, g.end_at)}`;
                  return (
                    <div
                      key={p.key}
                      className={
                        "tg-slot cal-ghost" +
                        (short ? " is-short" : "") +
                        (tunable ? " is-tunable" : "") +
                        (g.pinned ? " is-pinned" : "") +
                        (moving?.id === cell.id ? " is-dragging" : "")
                      }
                      style={place}
                      role={tunable ? "group" : "img"}
                      aria-label={label}
                      title={
                        tunable ? "Drag to pin it at another time" : undefined
                      }
                      onPointerDown={
                        tunable
                          ? (ev) =>
                              begin(
                                ev,
                                { kind: "ghost", ghost: original },
                                cell.id,
                                "move",
                                n,
                              )
                          : undefined
                      }
                      onPointerMove={tunable ? move : undefined}
                      onPointerUp={tunable ? finish : undefined}
                      onPointerCancel={tunable ? cancel : undefined}
                    >
                      <span className="cal-title">
                        {g.pinned ? (
                          <Pin size={11} aria-hidden="true" />
                        ) : (
                          <Sparkles size={11} aria-hidden="true" />
                        )}
                        {g.title}
                      </span>
                      <small>
                        {spanLabel(g.start_at, g.end_at)}
                        {g.parts > 1 && ` · ${g.part}/${g.parts}`}
                      </small>
                      {tunable && (
                        <button
                          className="cal-ghost-remove"
                          aria-label={
                            g.pinned
                              ? `Unpin ${g.title}`
                              : `Leave ${g.title} out of this plan`
                          }
                          title={g.pinned ? "Unpin" : "Leave out"}
                          onPointerDown={(ev) => ev.stopPropagation()}
                          onClick={() => onRemoveGhost(original)}
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  );
                })}
                {keepFree.map((k) => {
                  const r = onDay(k.start_at, k.end_at, dayStart, dayEnd);
                  if (!r) return null;
                  return (
                    <div
                      key={"k:" + k.start_at + k.end_at}
                      className="tg-keepfree"
                      style={{
                        top: r.top * PX_PER_MIN,
                        height: Math.max(16, (r.bottom - r.top) * PX_PER_MIN),
                      }}
                    >
                      <span>Keep free</span>
                      <button
                        aria-label={`Stop keeping ${spanLabel(k.start_at, k.end_at)} free`}
                        title="Stop keeping free"
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={() => onRemoveKeepFree(k)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  );
                })}
                {draft && draft.to > draft.from && (
                  <div
                    className={
                      onKeepFree ? "tg-keepfree is-draft" : "tg-newevent"
                    }
                    style={{
                      top: draft.from * PX_PER_MIN,
                      height: (draft.to - draft.from) * PX_PER_MIN,
                    }}
                    aria-hidden="true"
                  >
                    <span>
                      {onKeepFree ? "Keep " : "New event, "}
                      {timeLabel(at(d, draft.from))} –{" "}
                      {timeLabel(at(d, draft.to))}
                      {onKeepFree && " free"}
                    </span>
                  </div>
                )}
                {teammates.map((m, i) =>
                  m.busy.map((b) => {
                    const r = onDay(b.start_at, b.end_at, dayStart, dayEnd);
                    if (!r) return null;
                    return (
                      <div
                        key={"m:" + m.user_id + b.start_at + b.end_at}
                        className="tg-mate"
                        aria-hidden="true"
                        style={
                          {
                            top: r.top * PX_PER_MIN,
                            height: Math.max(
                              3,
                              (r.bottom - r.top) * PX_PER_MIN,
                            ),
                            right: 2 + i * 5,
                            "--mate": m.color,
                          } as CSSProperties
                        }
                      />
                    );
                  }),
                )}
                {slot && sameDay(slot, d) && (
                  <div
                    className="tg-selected"
                    style={{
                      top: minutesOf(slot) * PX_PER_MIN,
                      height: 60 * PX_PER_MIN - 2,
                    }}
                    aria-hidden="true"
                  >
                    {timeLabel(slot)} · Press C for an event
                  </div>
                )}
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
