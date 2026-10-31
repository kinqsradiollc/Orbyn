import {
  sessionLine,
  statusLabels,
  type BusyInterval,
  type CalendarEntry,
  type CalendarView,
  type ExternalEntry,
  type PlannedBlock,
  type TaskList,
  type TimeBlock,
} from "@orbyn/core";
import { dayTime, localDateKey, zonedParts } from "@orbyn/core";
import { Lock, Pin, Sparkles, Timer, Users, Video, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Empty } from "../../ui/kit";
import {
  dayText,
  hourLabel,
  spanLabel,
  timeLabel,
  zoneAbbr,
  zoneCity,
} from "./format";
import {
  clockOf,
  DAY_MINUTES,
  entryEnd,
  entryKey,
  entryOnDay,
  externalKey,
  frameKey,
  ghostKey,
  isAllDayEntry,
  joinable,
  SNAP,
  spanOn,
  TASK_MIME,
  type Picked,
} from "./model";
import type { Times } from "./useActions";
import type { MateBusy } from "./useWorkspace";

const HOUR = 48;
const PER_MIN = HOUR / 60;

type Cell =
  | { type: "entry"; entry: CalendarEntry }
  | { type: "block"; block: TimeBlock }
  | { type: "copy"; block: TimeBlock }
  | { type: "external"; event: ExternalEntry }
  | { type: "habit"; habit: NonNullable<CalendarView["habit_blocks"]>[number] }
  | { type: "ghost"; ghost: PlannedBlock };

type Span = {
  key: string;
  top: number;
  bottom: number;
  cell: Cell;
  col: number;
  cols: number;
};

/** Spans in a day column: overlapping ones share the width. */
function layout(spans: Omit<Span, "col" | "cols">[]) {
  const placed = spans
    .map((s) => ({
      ...s,
      bottom: Math.max(s.bottom, s.top + 24),
      col: 0,
      cols: 1,
    }))
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let cluster: Span[] = [];
  let ends: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const p of cluster) p.cols = ends.length;
    cluster = [];
    ends = [];
  };
  for (const p of placed) {
    if (p.top >= clusterEnd) close();
    let col = ends.findIndex((end) => end <= p.top);
    if (col === -1) {
      col = ends.length;
      ends.push(0);
    }
    ends[col] = p.bottom;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(...ends);
  }
  close();
  return placed;
}

type Gesture = {
  mode: "move" | "resize";
  picked: Picked;
  key: string;
  day: number;
  x: number;
  y: number;
  start: number;
  end: number;
  moved: boolean;
};

type Drag = { key: string; start_at: string; end_at: string; copy: boolean };

type Props = {
  days: string[];
  tz: string;
  view: CalendarView;
  external: ExternalEntry[];
  ghosts: PlannedBlock[];
  tunable: boolean;
  keepFree: BusyInterval[];
  zones: string[];
  mates: MateBusy[];
  listById: Map<string, TaskList>;
  relatedItem: string | null;
  slot: string | null;
  canDrag: (p: Picked) => boolean;
  onPick: (p: Picked, anchor: DOMRect) => void;
  onOpenDay: (day: string) => void;
  onSlot: (iso: string | null) => void;
  onNewRange: (start: Date, end: Date) => void;
  onKeepFree: (start: Date, end: Date) => void;
  onDropKeepFree: (range: BusyInterval) => void;
  onMoveBlock: (block: TimeBlock, times: Times) => void;
  onCopyBlock: (block: TimeBlock, start: Date) => void;
  onMoveEntry: (entry: CalendarEntry, times: Times, resized: boolean) => void;
  onPinGhost: (ghost: PlannedBlock, start: Date, end: Date) => void;
  onDropTask: (itemId: string, start: Date) => void;
  onDropTaskOnDay: (itemId: string, day: string) => void;
};

const useNow = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const look = (
  listId: string | null | undefined,
  lists: Map<string, TaskList>,
  own?: string | null,
) => {
  const color = own || (listId ? lists.get(listId)?.color : undefined);
  return color ? ({ "--mark": color } as CSSProperties) : undefined;
};

/** Hours and days: drag to move, the bottom edge to resize, Alt to copy. */
export function TimeGrid({
  days,
  tz,
  view,
  external,
  ghosts,
  tunable,
  keepFree,
  zones,
  mates,
  listById,
  relatedItem,
  slot,
  canDrag,
  onPick,
  onOpenDay,
  onSlot,
  onNewRange,
  onKeepFree,
  onDropKeepFree,
  onMoveBlock,
  onCopyBlock,
  onMoveEntry,
  onPinGhost,
  onDropTask,
  onDropTaskOnDay,
}: Props) {
  const now = useNow();
  const hint = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef(drag);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const [selecting, setSelectingState] = useState<{
    day: number;
    anchor: number;
    from: number;
    to: number;
  } | null>(null);
  const selectRef = useRef(selecting);
  const setSelecting = (next: typeof selecting) => {
    selectRef.current = next;
    setSelectingState(next);
  };
  const skipClick = useRef(false);
  const [dropHint, setDropHint] = useState<{
    day: number;
    minutes: number;
  } | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const today = localDateKey(now, tz);
  const rangeKey = `${days[0]}:${days.length}`;
  const at = (day: string, minutes: number) => dayTime(day, minutes, tz);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const minutes = days.includes(today)
      ? clockOf(new Date().toISOString(), tz) - 60
      : 8 * 60;
    el.scrollTop = Math.max(0, minutes * PER_MIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  // A pointer-up in a different range must not commit an old gesture.
  useEffect(() => {
    gesture.current = null;
    setDrag(null);
    setSelecting(null);
    setDropHint(null);
    setDropDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  const minutesAt = (clientY: number, day: number) => {
    const rect = cols.current[day]?.getBoundingClientRect();
    if (!rect) return 9 * 60;
    const raw = (clientY - rect.top) / PER_MIN;
    return Math.min(
      DAY_MINUTES - SNAP,
      Math.max(0, Math.round(raw / SNAP) * SNAP),
    );
  };

  const begin = (
    e: ReactPointerEvent<HTMLElement>,
    picked: Picked,
    key: string,
    mode: Gesture["mode"],
    day: number,
    span: { start_at: string; end_at: string },
  ) => {
    // Touch keeps scrolling the grid; moves come from the item's menu instead.
    if (e.button !== 0 || (e.pointerType === "touch" && mode === "move"))
      return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      mode,
      picked,
      key,
      day,
      x: e.clientX,
      y: e.clientY,
      start: Date.parse(span.start_at),
      end: Date.parse(span.end_at),
      moved: false,
    };
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    g.moved = true;
    const delta = Math.round(dy / PER_MIN / SNAP) * SNAP * 60_000;
    if (g.mode === "resize") {
      const end = Math.max(g.start + SNAP * 60_000, g.end + delta);
      setDrag({
        key: g.key,
        start_at: new Date(g.start).toISOString(),
        end_at: new Date(end).toISOString(),
        copy: false,
      });
      return;
    }
    const over = cols.current.findIndex((c) => {
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    const shift = over === -1 ? 0 : over - g.day;
    // By calendar days, so a move across a clock change keeps its hour.
    const moved = new Date(g.start + delta);
    const p = zonedParts(moved, tz);
    const key = localDateKey(moved, tz);
    const dayIndex = days.indexOf(key);
    const target = dayIndex + shift;
    const start =
      dayIndex >= 0 && days[target]
        ? at(days[target], p.hour * 60 + p.minute).getTime()
        : g.start + delta + shift * 86_400_000;
    setDrag({
      key: g.key,
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + g.end - g.start).toISOString(),
      copy: g.picked.kind === "block" && e.altKey,
    });
  };

  const finish = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    const d = dragRef.current;
    setDrag(null);
    if (!g?.moved) return;
    suppressClick.current = true;
    if (
      !d ||
      (Date.parse(d.start_at) === g.start && Date.parse(d.end_at) === g.end)
    )
      return;
    const times = { start_at: d.start_at, end_at: d.end_at };
    const t = g.picked;
    if (t.kind === "entry") onMoveEntry(t.entry, times, g.mode === "resize");
    else if (t.kind === "ghost") {
      if (tunable)
        onPinGhost(t.ghost, new Date(d.start_at), new Date(d.end_at));
    } else if (t.kind === "block") {
      if (g.mode === "move" && e.altKey)
        onCopyBlock(t.block, new Date(d.start_at));
      else onMoveBlock(t.block, times);
    }
  };
  const cancel = () => {
    gesture.current = null;
    setDrag(null);
  };

  const startSelect = (e: ReactPointerEvent<HTMLDivElement>, day: number) => {
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
  const moveSelect = (e: ReactPointerEvent<HTMLDivElement>, day: number) => {
    const s = selectRef.current;
    if (!s || s.day !== day) return;
    const m = minutesAt(e.clientY, day);
    const from = Math.min(s.anchor, m);
    const to = Math.max(s.anchor, m);
    if (from !== s.from || to !== s.to) setSelecting({ ...s, from, to });
  };
  const endSelect = (day: number) => {
    const s = selectRef.current;
    setSelecting(null);
    if (!s || s.to - s.from < SNAP) return;
    skipClick.current = true;
    (tunable ? onKeepFree : onNewRange)(
      at(days[day], s.from),
      at(days[day], s.to),
    );
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, day: number) => {
    if (!e.dataTransfer.types.includes(TASK_MIME)) return;
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
  const dayDrop = (day: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(TASK_MIME)) return;
      e.preventDefault();
      setDropDay(day);
    },
    onDragLeave: () => setDropDay((was) => (was === day ? null : was)),
    onDrop: (e: DragEvent) => {
      setDropDay(null);
      const id = e.dataTransfer.getData(TASK_MIME);
      if (!id) return;
      e.preventDefault();
      onDropTaskOnDay(id, day);
    },
  });

  const moving = drag && !drag.copy ? drag : null;
  const withDrag = <T extends { start_at: string; end_at: string | null }>(
    x: T,
    key: string,
  ): T =>
    moving?.key === key
      ? { ...x, start_at: moving.start_at, end_at: moving.end_at }
      : x;
  const copied = drag?.copy
    ? view.blocks.find((b) => `b:${b.id}` === drag.key)
    : undefined;

  const spansFor = useMemo(
    () => (day: string) => {
      const out: Omit<Span, "col" | "cols">[] = [];
      const push = (key: string, start: string, end: string, cell: Cell) => {
        const r = spanOn(start, end, day, tz);
        if (r) out.push({ key, top: r.top, bottom: r.bottom, cell });
      };
      for (const raw of view.entries) {
        const key = `e:${entryKey(raw)}`;
        const entry = withDrag(raw, key);
        if (isAllDayEntry(entry, tz) || (entry.kind === "task" && !raw.end_at))
          continue;
        push(key, entry.start_at, entryEnd(entry).toISOString(), {
          type: "entry",
          entry: raw,
        });
      }
      for (const event of external)
        if (!isAllDayEntry(event, tz))
          push(externalKey(event), event.start_at, event.end_at, {
            type: "external",
            event,
          });
      for (const raw of view.blocks) {
        const key = `b:${raw.id}`;
        const block = withDrag(raw, key);
        push(key, block.start_at, block.end_at, { type: "block", block });
      }
      for (const habit of view.habit_blocks ?? [])
        push(`h:${habit.id}`, habit.start_at, habit.end_at, {
          type: "habit",
          habit,
        });
      if (copied && drag)
        push(`c:${copied.id}`, drag.start_at, drag.end_at, {
          type: "copy",
          block: copied,
        });
      for (const raw of ghosts) {
        const key = `g:${ghostKey(raw)}`;
        const ghost = withDrag(raw, key);
        push(key, ghost.start_at, ghost.end_at, { type: "ghost", ghost });
      }
      return layout(out);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, external, ghosts, tz, drag],
  );

  if (!days.length) return <Empty title="Nothing to show" />;
  const allDay = (day: string) => [
    ...external.filter((x) => isAllDayEntry(x, tz) && entryOnDay(x, day, tz)),
    ...view.entries.filter(
      (e) => isAllDayEntry(e, tz) && entryOnDay(e, day, tz),
    ),
  ];
  const style = {
    "--calendar-days": days.length,
    "--calendar-gutter": `${(1 + zones.length) * 52}px`,
    "--calendar-hour": `${HOUR}px`,
  } as CSSProperties;

  return (
    <div className="calendar-grid" style={style}>
      <span id={hint} className="sr-only">
        Use Up and Down to pick a time. Home picks 8 AM; End picks the last
        slot. Press C to make an event there.
      </span>
      <div className="calendar-grid-head">
        <span className="calendar-grid-corner">
          {zones.length > 0 &&
            [null, ...zones].map((z) => (
              <small key={z ?? "local"} title={z ?? tz}>
                {z ? zoneCity(z) : "Here"}
                <br />
                {z ? zoneAbbr(z, at(days[0], 0)) : ""}
              </small>
            ))}
        </span>
        {days.map((day) => (
          <button
            key={day}
            type="button"
            className={`calendar-grid-day${day === today ? " is-today" : ""}${dropDay === day ? " is-drop" : ""}`}
            aria-current={day === today ? "date" : undefined}
            aria-label={`Show ${dayText(day, { weekday: "long", month: "long", day: "numeric" })}`}
            onClick={() => onOpenDay(day)}
            {...dayDrop(day)}
          >
            <small>{dayText(day, { weekday: "short" })}</small>
            <b>{Number(day.slice(8))}</b>
          </button>
        ))}
      </div>
      <div className="calendar-allday">
        <span className="calendar-allday-label">All day</span>
        {days.map((day) => (
          <div
            key={day}
            className={`calendar-allday-cell${dropDay === day ? " is-drop" : ""}`}
            {...dayDrop(day)}
          >
            {allDay(day).map((x) =>
              "subscription_id" in x ? (
                <button
                  key={externalKey(x)}
                  type="button"
                  className="calendar-chip"
                  style={{ "--mark": x.color } as CSSProperties}
                  title={`${x.title} · ${x.name}`}
                  aria-label={`${x.title} (from ${x.name}, all day, read-only)`}
                  onClick={(ev) =>
                    onPick(
                      { kind: "external", event: x },
                      ev.currentTarget.getBoundingClientRect(),
                    )
                  }
                >
                  <Lock aria-hidden="true" />
                  <span dir="auto">{x.title}</span>
                </button>
              ) : (
                <button
                  key={entryKey(x)}
                  type="button"
                  className={`calendar-chip${relatedItem === x.item_id ? " is-related" : ""}`}
                  style={look(x.list_id, listById, x.color)}
                  aria-label={`${x.title} (${x.kind === "event" ? "Event" : statusLabels[x.status]}, all day)`}
                  onClick={(ev) =>
                    onPick(
                      { kind: "entry", entry: x },
                      ev.currentTarget.getBoundingClientRect(),
                    )
                  }
                >
                  <span dir="auto">{x.title}</span>
                  {x.team_id && <Users aria-hidden="true" />}
                </button>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="calendar-grid-scroll" ref={scroller}>
        <div className="calendar-grid-body" style={{ height: 24 * HOUR }}>
          <div className="calendar-hours" aria-hidden="true">
            {[null, ...zones].map((zone) => (
              <div className="calendar-zone" key={zone ?? "local"}>
                {Array.from({ length: 24 }, (_, h) => (
                  <span key={h} style={{ top: h * HOUR }}>
                    {zone
                      ? at(days[0], h * 60).toLocaleTimeString(undefined, {
                          hour: "numeric",
                          timeZone: zone,
                        })
                      : hourLabel(h)}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {days.map((day, n) => {
            const draft = selecting?.day === n ? selecting : null;
            const slotHere =
              slot && localDateKey(new Date(slot), tz) === day
                ? clockOf(slot, tz)
                : null;
            const due = view.entries.filter(
              (e) =>
                e.kind === "task" &&
                !e.end_at &&
                !isAllDayEntry(e, tz) &&
                localDateKey(
                  new Date(withDrag(e, `e:${entryKey(e)}`).start_at),
                  tz,
                ) === day,
            );
            const groups = new Map<string, CalendarEntry[]>();
            for (const e of due) {
              const key = withDrag(e, `e:${entryKey(e)}`).start_at;
              groups.set(key, [...(groups.get(key) ?? []), e]);
            }
            return (
              <div
                key={day}
                ref={(el) => {
                  cols.current[n] = el;
                }}
                className={`calendar-col${day === today ? " is-today" : ""}${draft ? " is-selecting" : ""}`}
                role="group"
                tabIndex={0}
                aria-label={dayText(day, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
                aria-describedby={hint}
                onKeyDown={(e) => {
                  if (
                    e.target !== e.currentTarget ||
                    e.altKey ||
                    e.metaKey ||
                    e.ctrlKey
                  )
                    return;
                  const current = slotHere ?? 9 * 60;
                  const next =
                    e.key === "ArrowUp"
                      ? current - SNAP
                      : e.key === "ArrowDown"
                        ? current + SNAP
                        : e.key === "Home"
                          ? 8 * 60
                          : e.key === "End"
                            ? DAY_MINUTES - SNAP
                            : null;
                  if (next === null) return;
                  e.preventDefault();
                  const minutes = Math.max(
                    0,
                    Math.min(DAY_MINUTES - SNAP, next),
                  );
                  onSlot(at(day, minutes).toISOString());
                  const el = scroller.current;
                  if (el) {
                    const top = minutes * PER_MIN;
                    if (top < el.scrollTop) el.scrollTop = top;
                    else if (
                      top + SNAP * PER_MIN >
                      el.scrollTop + el.clientHeight
                    )
                      el.scrollTop = top + SNAP * PER_MIN - el.clientHeight;
                  }
                }}
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
                  if (e.target === e.currentTarget)
                    onSlot(at(day, minutesAt(e.clientY, n)).toISOString());
                }}
              >
                {(view.frames ?? []).map((f) => {
                  const r = spanOn(f.start_at, f.end_at, day, tz);
                  if (!r) return null;
                  return (
                    <div
                      key={frameKey(f)}
                      className={`calendar-frame${f.busy ? " is-busy" : ""}`}
                      style={
                        {
                          top: r.top * PER_MIN,
                          height: (r.bottom - r.top) * PER_MIN,
                          "--mark": f.color,
                        } as CSSProperties
                      }
                    >
                      <button
                        type="button"
                        aria-label={`${f.name} frame, ${spanLabel(f.start_at, f.end_at, tz)}${f.busy ? ", busy" : ""}`}
                        onClick={(ev) =>
                          onPick(
                            { kind: "frame", frame: f },
                            ev.currentTarget.getBoundingClientRect(),
                          )
                        }
                      >
                        {f.name}
                        {f.busy && " · Busy"}
                      </button>
                    </div>
                  );
                })}
                {view.derived.map((x) => {
                  const r = spanOn(x.start_at, x.end_at, day, tz);
                  if (!r) return null;
                  const height = (r.bottom - r.top) * PER_MIN;
                  return (
                    <div
                      key={x.kind + x.item_id + x.start_at}
                      className={`calendar-derived is-${x.kind}`}
                      style={{
                        top: r.top * PER_MIN,
                        height: Math.max(4, height),
                      }}
                      title={x.label}
                    >
                      {height >= 14 && <span>{x.label}</span>}
                    </div>
                  );
                })}
                {[...groups.entries()].map(([iso, group]) => {
                  const top = clockOf(iso, tz) * PER_MIN;
                  if (group.length > 1)
                    return (
                      <div
                        key={iso}
                        className="calendar-due is-group"
                        style={{ top }}
                      >
                        <span
                          className="calendar-due-line"
                          aria-hidden="true"
                        />
                        <span className="calendar-due-names">
                          Due ·
                          {group.map((e) => (
                            <button
                              key={entryKey(e)}
                              type="button"
                              dir="auto"
                              onClick={(ev) =>
                                onPick(
                                  { kind: "entry", entry: e },
                                  ev.currentTarget.getBoundingClientRect(),
                                )
                              }
                            >
                              {e.title}
                            </button>
                          ))}
                        </span>
                      </div>
                    );
                  const e = group[0];
                  const key = `e:${entryKey(e)}`;
                  const picked: Picked = { kind: "entry", entry: e };
                  const draggable = canDrag(picked);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`calendar-due${relatedItem === e.item_id ? " is-related" : ""}`}
                      style={{ top }}
                      aria-label={`${e.title} deadline, ${timeLabel(iso, tz)}`}
                      onPointerDown={
                        draggable
                          ? (ev) =>
                              begin(ev, picked, key, "move", n, {
                                start_at: e.start_at,
                                end_at: entryEnd(e).toISOString(),
                              })
                          : undefined
                      }
                      onPointerMove={draggable ? move : undefined}
                      onPointerUp={draggable ? finish : undefined}
                      onPointerCancel={draggable ? cancel : undefined}
                      onClick={(ev) => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        onPick(
                          picked,
                          ev.currentTarget.getBoundingClientRect(),
                        );
                      }}
                    >
                      <span className="calendar-due-line" aria-hidden="true" />
                      <span className="calendar-due-names" dir="auto">
                        Due · {e.title}
                      </span>
                    </button>
                  );
                })}
                {spansFor(day).map((p) => {
                  const height = (p.bottom - p.top) * PER_MIN;
                  const short = height < 38;
                  const place = {
                    top: p.top * PER_MIN,
                    height: height - 2,
                    left: `calc(${(p.col / p.cols) * 100}% + 2px)`,
                    width: `calc(${100 / p.cols}% - 4px)`,
                  };
                  const c = p.cell;
                  const cls = `calendar-tile${short ? " is-short" : ""}`;
                  if (c.type === "entry") {
                    const e = c.entry;
                    const picked: Picked = { kind: "entry", entry: e };
                    const draggable = canDrag(picked);
                    const shown = withDrag(e, p.key);
                    const span = {
                      start_at: e.start_at,
                      end_at: entryEnd(e).toISOString(),
                    };
                    const time = shown.end_at
                      ? spanLabel(shown.start_at, shown.end_at, tz)
                      : timeLabel(shown.start_at, tz);
                    return (
                      <div
                        key={p.key}
                        className={`calendar-slotbox${moving?.key === p.key ? " is-dragging" : ""}`}
                        style={place}
                      >
                        <button
                          type="button"
                          className={`${cls} is-event${e.status === "done" ? " is-done" : ""}${e.busy === false ? " is-free" : ""}${relatedItem === e.item_id ? " is-related" : ""}`}
                          style={look(e.list_id, listById, e.color)}
                          aria-label={`${e.title} (${e.kind === "event" ? "Event" : statusLabels[e.status]}, ${time}${e.team_name ? `, ${e.team_name}` : ""}${e.occurrence ? ", repeats" : ""})`}
                          onPointerDown={
                            draggable
                              ? (ev) =>
                                  begin(ev, picked, p.key, "move", n, span)
                              : undefined
                          }
                          onPointerMove={draggable ? move : undefined}
                          onPointerUp={draggable ? finish : undefined}
                          onPointerCancel={draggable ? cancel : undefined}
                          onClick={(ev) => {
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            onPick(
                              picked,
                              ev.currentTarget.getBoundingClientRect(),
                            );
                          }}
                        >
                          <b dir="auto">{e.title}</b>
                          <small>
                            {time}
                            {e.team_id && <Users aria-hidden="true" />}
                          </small>
                        </button>
                        {draggable && e.kind === "event" && (
                          <span
                            className="calendar-resize"
                            aria-hidden="true"
                            onPointerDown={(ev) =>
                              begin(ev, picked, p.key, "resize", n, span)
                            }
                            onPointerMove={move}
                            onPointerUp={finish}
                            onPointerCancel={cancel}
                          />
                        )}
                        {joinable(e, now.getTime()) && (
                          <a
                            className="calendar-join"
                            href={e.meeting_url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Join ${e.title}`}
                          >
                            <Video aria-hidden="true" /> Join
                          </a>
                        )}
                      </div>
                    );
                  }
                  if (c.type === "external") {
                    const x = c.event;
                    return (
                      <div
                        key={p.key}
                        className="calendar-slotbox"
                        style={place}
                      >
                        <button
                          type="button"
                          className={`${cls} is-event${x.busy ? "" : " is-free"}`}
                          style={{ "--mark": x.color } as CSSProperties}
                          aria-label={`${x.title} (from ${x.name}, ${spanLabel(x.start_at, x.end_at, tz)}, read-only)`}
                          onClick={(ev) =>
                            onPick(
                              { kind: "external", event: x },
                              ev.currentTarget.getBoundingClientRect(),
                            )
                          }
                        >
                          <b dir="auto">
                            <Lock aria-hidden="true" /> {x.title}
                          </b>
                          <small>{spanLabel(x.start_at, x.end_at, tz)}</small>
                        </button>
                      </div>
                    );
                  }
                  if (c.type === "habit") {
                    const h = c.habit;
                    return (
                      <div
                        key={p.key}
                        className="calendar-slotbox"
                        style={place}
                      >
                        <button
                          type="button"
                          className={`${cls} is-habit${h.outcome ? " is-done" : ""}`}
                          aria-label={`${h.name} habit, ${spanLabel(h.start_at, h.end_at, tz)}${h.outcome ? `, ${h.outcome}` : ""}`}
                          onClick={(ev) =>
                            onPick(
                              { kind: "habit", habit: h },
                              ev.currentTarget.getBoundingClientRect(),
                            )
                          }
                        >
                          <b dir="auto">{h.name}</b>
                          <small>{spanLabel(h.start_at, h.end_at, tz)}</small>
                        </button>
                      </div>
                    );
                  }
                  if (c.type === "copy")
                    return (
                      <div
                        key={p.key}
                        className="calendar-slotbox is-copy"
                        style={place}
                        aria-hidden="true"
                      >
                        <span className={`${cls} is-session`}>
                          <b dir="auto">Copy of {c.block.title}</b>
                        </span>
                      </div>
                    );
                  if (c.type === "block") {
                    const b = c.block;
                    const original =
                      view.blocks.find((x) => x.id === b.id) ?? b;
                    const picked: Picked = { kind: "block", block: original };
                    const draggable = canDrag(picked);
                    const line = sessionLine(b, now);
                    const late = !!b.after_deadline && b.status !== "done";
                    const span = {
                      start_at: original.start_at,
                      end_at: original.end_at,
                    };
                    return (
                      <div
                        key={p.key}
                        className={`calendar-slotbox${moving?.key === p.key ? " is-dragging" : ""}`}
                        style={place}
                      >
                        <button
                          type="button"
                          className={`${cls} is-session is-${b.priority}${b.status === "done" ? " is-done" : ""}${late ? " is-late" : ""}${relatedItem === b.item_id ? " is-related" : ""}`}
                          aria-label={`Session for ${b.title}, ${spanLabel(b.start_at, b.end_at, tz)}${line ? `, ${line}` : ""}`}
                          onPointerDown={
                            draggable
                              ? (ev) =>
                                  begin(ev, picked, p.key, "move", n, span)
                              : undefined
                          }
                          onPointerMove={draggable ? move : undefined}
                          onPointerUp={draggable ? finish : undefined}
                          onPointerCancel={draggable ? cancel : undefined}
                          onClick={(ev) => {
                            if (suppressClick.current) {
                              suppressClick.current = false;
                              return;
                            }
                            onPick(
                              picked,
                              ev.currentTarget.getBoundingClientRect(),
                            );
                          }}
                        >
                          <b dir="auto">
                            <Timer aria-hidden="true" /> {b.title}
                          </b>
                          {line && <small>{line}</small>}
                          {(!short || !line) && (
                            <small>{spanLabel(b.start_at, b.end_at, tz)}</small>
                          )}
                        </button>
                        {draggable && (
                          <span
                            className="calendar-resize"
                            aria-hidden="true"
                            onPointerDown={(ev) =>
                              begin(ev, picked, p.key, "resize", n, span)
                            }
                            onPointerMove={move}
                            onPointerUp={finish}
                            onPointerCancel={cancel}
                          />
                        )}
                      </div>
                    );
                  }
                  const g = c.ghost;
                  const original =
                    ghosts.find((x) => `g:${ghostKey(x)}` === p.key) ?? g;
                  const picked: Picked = { kind: "ghost", ghost: original };
                  const span = {
                    start_at: original.start_at,
                    end_at: original.end_at,
                  };
                  return (
                    <div
                      key={p.key}
                      className={`calendar-slotbox${moving?.key === p.key ? " is-dragging" : ""}`}
                      style={place}
                    >
                      <button
                        type="button"
                        className={`${cls} is-ghost${g.pinned ? " is-pinned" : ""}`}
                        disabled={!tunable}
                        title={
                          tunable ? "Drag to pin it at another time" : undefined
                        }
                        aria-label={`${g.pinned ? "Pinned" : "Planned"}: ${g.title}, ${spanLabel(g.start_at, g.end_at, tz)}. Change its time`}
                        onPointerDown={
                          tunable
                            ? (ev) => begin(ev, picked, p.key, "move", n, span)
                            : undefined
                        }
                        onPointerMove={tunable ? move : undefined}
                        onPointerUp={tunable ? finish : undefined}
                        onPointerCancel={tunable ? cancel : undefined}
                        onClick={(ev) => {
                          if (suppressClick.current) {
                            suppressClick.current = false;
                            return;
                          }
                          onPick(
                            picked,
                            ev.currentTarget.getBoundingClientRect(),
                          );
                        }}
                      >
                        <b dir="auto">
                          {g.pinned ? (
                            <Pin aria-hidden="true" />
                          ) : (
                            <Sparkles aria-hidden="true" />
                          )}{" "}
                          {g.title}
                        </b>
                        <small>
                          {spanLabel(g.start_at, g.end_at, tz)}
                          {g.parts > 1 && ` · Session ${g.part} of ${g.parts}`}
                        </small>
                      </button>
                    </div>
                  );
                })}
                {keepFree.map((k) => {
                  const r = spanOn(k.start_at, k.end_at, day, tz);
                  if (!r) return null;
                  return (
                    <div
                      key={k.start_at + k.end_at}
                      className="calendar-keepfree"
                      style={{
                        top: r.top * PER_MIN,
                        height: Math.max(18, (r.bottom - r.top) * PER_MIN),
                      }}
                    >
                      <span>Keep free</span>
                      <button
                        type="button"
                        aria-label={`Stop keeping ${spanLabel(k.start_at, k.end_at, tz)} free`}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={() => onDropKeepFree(k)}
                      >
                        <X aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
                {draft && draft.to > draft.from && (
                  <div
                    className={
                      tunable
                        ? "calendar-keepfree is-draft"
                        : "calendar-newrange"
                    }
                    style={{
                      top: draft.from * PER_MIN,
                      height: (draft.to - draft.from) * PER_MIN,
                    }}
                    aria-hidden="true"
                  >
                    <span>
                      {tunable ? "Keep " : "New event, "}
                      {timeLabel(at(day, draft.from), tz)} –{" "}
                      {timeLabel(at(day, draft.to), tz)}
                      {tunable && " free"}
                    </span>
                  </div>
                )}
                {mates.map((m, i) =>
                  m.busy.map((b) => {
                    const r = spanOn(b.start_at, b.end_at, day, tz);
                    if (!r) return null;
                    return (
                      <div
                        key={`${m.user_id}${b.start_at}${b.end_at}`}
                        className="calendar-mate"
                        aria-hidden="true"
                        style={{
                          top: r.top * PER_MIN,
                          height: Math.max(3, (r.bottom - r.top) * PER_MIN),
                          right: 2 + i * 5,
                          background: m.color,
                        }}
                      />
                    );
                  }),
                )}
                {slotHere !== null && (
                  <div
                    className="calendar-picked"
                    style={{ top: slotHere * PER_MIN, height: HOUR - 2 }}
                    aria-hidden="true"
                  >
                    {timeLabel(slot as string, tz)} · Press C for an event
                  </div>
                )}
                {dropHint?.day === n && (
                  <div
                    className="calendar-drop"
                    style={{ top: dropHint.minutes * PER_MIN }}
                    aria-hidden="true"
                  >
                    {timeLabel(at(day, dropHint.minutes), tz)}
                  </div>
                )}
                {day === today && (
                  <div
                    className="calendar-nowline"
                    style={{ top: clockOf(now.toISOString(), tz) * PER_MIN }}
                    role="presentation"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <span className="sr-only" role="status">
        {slot && `Selected ${timeLabel(slot, tz)}`}
      </span>
    </div>
  );
}
