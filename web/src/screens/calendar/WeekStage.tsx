import {
  hoursLabel,
  type BusyInterval,
  type WeekPart,
  type WeekScene,
} from "@orbyn/core";
import { X } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { clock, dayMedium, dayShort, spanLabel } from "./format";
import { TASK_MIME } from "./model";

export type StageHandle = {
  turn: (yaw: number, tilt: number, zoom: number) => void;
  reset: () => void;
};

/** Where a dragged part would land: a new start, or for a resize a new end. */
export type PartTarget =
  { day: number; minutes: number } | { endMinutes: number };

export type Cell = { day: number; minutes: number };

/** A flat mark on the floor: buffer, travel, keep-free or a teammate's time. */
export type FloorBand = {
  key: string;
  kind: "buffer" | "travel" | "free" | "mate";
  day: number;
  from: number;
  to: number;
  label?: string;
  color?: string;
  /** Teammates sit side by side at the lane's edge. */
  slot?: number;
  range?: BusyInterval;
};

/** A deadline standing on the floor. */
export type Pole = {
  id: string;
  title: string;
  day: number;
  minutes: number;
  at: string;
  /** What opening it shows; deadlines from a session open its task. */
  itemId: string;
};

const LANE = 150;
const STEP = 15;
const LIFT = 22;
const HEIGHT = { low: 7, medium: 12, high: 20 };
const HOVER = 84;
const WORK_HOUR = 54;
const OFF_HOUR = 16;
const CAMERA = { tilt: 44, yaw: -9, zoom: 1 };
const LIMIT = { yaw: 24, tiltMin: 24, tiltMax: 66, zoomMin: 0.7, zoomMax: 1.6 };

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

type Bounds = Pick<
  WeekScene,
  "start_minutes" | "end_minutes" | "work_start_minutes" | "work_end_minutes"
>;

/**
 * Working hours keep their full size and the hours around them fold into a
 * thin strip, so one early session can't shrink the whole working day.
 */
function timeAxis(bounds: Bounds) {
  const {
    start_minutes: start,
    work_start_minutes: from,
    work_end_minutes: to,
  } = bounds;
  const span = (a: number, b: number, perHour: number) =>
    (Math.max(0, b - a) / 60) * perHour;
  return (minutes: number) =>
    span(start, Math.min(minutes, from), OFF_HOUR) +
    span(Math.max(start, from), Math.min(minutes, to), WORK_HOUR) +
    span(Math.max(start, to), minutes, OFF_HOUR);
}

/** The floor is hit-tested through the live 3D transform by the browser. */
function cellAt(x: number, y: number): Cell | null {
  for (const element of document.elementsFromPoint(x, y))
    if (element instanceof HTMLElement && element.dataset.cellDay)
      return {
        day: Number(element.dataset.cellDay),
        minutes: Number(element.dataset.cellMinutes),
      };
  return null;
}

function signAt(x: number, y: number) {
  for (const element of document.elementsFromPoint(x, y))
    if (element instanceof HTMLElement && element.dataset.signDay)
      return Number(element.dataset.signDay);
  return null;
}

const Floor = memo(function Floor({
  days,
  start,
  end,
  y,
}: {
  days: number;
  start: number;
  end: number;
  y: (minutes: number) => number;
}) {
  const rows = Math.ceil((end - start) / STEP);
  return Array.from({ length: days }, (_, day) => (
    <div key={day} className="calendar-cells" style={{ left: day * LANE }}>
      {Array.from({ length: rows }, (_, row) => {
        const minutes = start + row * STEP;
        return (
          <div
            key={row}
            className="calendar-cell"
            style={{ top: y(minutes), height: y(minutes + STEP) - y(minutes) }}
            data-cell-day={day}
            data-cell-minutes={minutes}
          />
        );
      })}
    </div>
  ));
});

type BlockProps = {
  part: WeekPart;
  scene: WeekScene;
  y: (minutes: number) => number;
  draggable: boolean;
  selected: boolean;
  related: boolean;
  dragging: boolean;
  hidden: boolean;
  look?: { color?: string };
  onPointerDown: (
    e: ReactPointerEvent,
    part: WeekPart,
    resize: boolean,
  ) => void;
  onKeyDown: (e: KeyboardEvent, part: WeekPart) => void;
};

function Block({
  part,
  scene,
  y,
  draggable,
  selected,
  related,
  dragging,
  hidden,
  look,
  onPointerDown,
  onKeyDown,
}: BlockProps) {
  const proposal = part.source === "proposal";
  const lift = proposal ? HOVER : part.level * LIFT + (dragging ? 26 : 0);
  const top = y(part.start_minutes);
  const depth = Math.max(13, y(part.end_minutes) - top - 3);
  const short = depth < 22;
  const tall = depth >= 44;
  const time = spanLabel(part.start_at, part.end_at, scene.timezone);
  const name = `${part.title}, ${dayMedium(scene.days[part.day].date)}, ${time}${
    proposal ? ", proposed" : part.late ? ", after its deadline" : ""
  }${part.done ? ", done" : ""}${
    draggable
      ? ". Use arrow keys to move, Shift with up or down to change its length"
      : ""
  }`;
  return (
    <div
      role="button"
      tabIndex={hidden ? -1 : 0}
      aria-label={name}
      aria-pressed={selected}
      data-part={part.id}
      data-source={part.source}
      data-height={part.height}
      className={[
        "calendar-block",
        selected && "is-selected",
        related && "is-related",
        dragging && "is-dragging",
        part.late && "is-late",
        part.done && "is-done",
        draggable && "is-movable",
        short && "is-short",
        hidden && "is-away",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--x": `${part.day * LANE + 5}px`,
          "--y": `${top + 1}px`,
          "--z": `${lift}px`,
          "--w": `${LANE - 10}px`,
          "--d": `${depth}px`,
          "--h": `${proposal ? 6 : HEIGHT[part.height]}px`,
          ...(look?.color ? { "--mark": look.color } : {}),
        } as CSSProperties
      }
      onPointerDown={(event) => onPointerDown(event, part, false)}
      onKeyDown={(event) => onKeyDown(event, part)}
    >
      <div className="calendar-shadow" />
      <div className="calendar-face is-north" />
      <div className="calendar-face is-west" />
      <div className="calendar-face is-east" />
      <div className="calendar-face is-south" />
      <div className="calendar-face is-top">
        <b dir="auto">{part.title}</b>
        {tall && <small>{time}</small>}
        {draggable && part.source !== "proposal" && (
          <i
            className="calendar-grip"
            aria-hidden="true"
            onPointerDown={(event) => onPointerDown(event, part, true)}
          />
        )}
      </div>
    </div>
  );
}

type Props = {
  scene: WeekScene;
  poles: Pole[];
  bands: FloorBand[];
  focusDay: number;
  closeUp: boolean;
  narrow: boolean;
  selectedId: string | null;
  relatedItem: string | null;
  draggingId: string | null;
  slot: Cell | null;
  tuning: boolean;
  looks: Map<string, { color?: string }>;
  stageRef: Ref<StageHandle>;
  canMove: (part: WeekPart) => boolean;
  onPick: (part: WeekPart | null) => void;
  onChooseDay: (day: number) => void;
  onPreview: (part: WeekPart, target: PartTarget) => void;
  onCommit: (part: WeekPart, copy: boolean, resized: boolean) => void;
  onCancel: () => void;
  onSlot: (cell: Cell | null) => void;
  onNewAt: (cell: Cell) => void;
  onKeepFree: (day: number, from: number, to: number) => void;
  onDropKeepFree: (range: BusyInterval) => void;
  onDropTask: (itemId: string, cell: Cell) => void;
  onDropTaskOnDay: (itemId: string, day: number) => void;
  onPole: (pole: Pole) => void;
};

export function WeekStage({
  scene,
  poles,
  bands,
  focusDay,
  closeUp,
  narrow,
  selectedId,
  relatedItem,
  draggingId,
  slot,
  tuning,
  looks,
  stageRef,
  canMove,
  onPick,
  onChooseDay,
  onPreview,
  onCommit,
  onCancel,
  onSlot,
  onNewAt,
  onKeepFree,
  onDropKeepFree,
  onDropTask,
  onDropTaskOnDay,
  onPole,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const pose = useRef({ ...CAMERA });
  const solo = narrow || closeUp;

  // A gesture keeps the floor it started on, or the floor would shift under
  // the pointer as the moved part stops widening the hours.
  const gesturing = useRef(false);
  const held = useRef<Bounds>(scene);
  if (!gesturing.current && !draggingId) held.current = scene;
  const bounds = held.current;
  const { start_minutes: floorStart, end_minutes: floorEnd } = bounds;
  const y = useMemo(
    () => timeAxis(bounds),
    [
      bounds.start_minutes,
      bounds.end_minutes,
      bounds.work_start_minutes,
      bounds.work_end_minutes,
    ],
  );
  const depth = y(floorEnd);
  const world = LANE * scene.days.length;
  const keyTimer = useRef(0);
  const keyPart = useRef<{ part: WeekPart; resized: boolean } | null>(null);

  const place = useCallback(() => {
    const stage = box.current?.getBoundingClientRect();
    const element = camera.current;
    if (!stage || !element) return;
    const { tilt, yaw, zoom } = pose.current;
    if (!solo) {
      const fit = Math.max(
        0.3,
        Math.min(
          (stage.width - 20) / (world + 170),
          (stage.height - 16) / (depth * 0.72 + 230),
        ),
      );
      element.style.transform = `translate(-6px, ${-stage.height * 0.04}px) scale(${fit * zoom}) rotateX(${tilt}deg) rotateZ(${yaw}deg)`;
      return;
    }
    const fit = Math.min(
      (stage.width - 16) / (narrow ? 178 : 300),
      (stage.height - 20) /
        (depth * (narrow ? 0.72 : 0.86) + (narrow ? 90 : 220)),
    );
    const shift = -(focusDay * LANE + LANE / 2 - world / 2);
    const lean = narrow ? 30 : tilt - 6;
    const turn = narrow ? 0 : yaw + 1;
    element.style.transform = `translateY(${narrow ? 12 : 44}px) scale(${fit * zoom}) rotateX(${lean}deg) rotateZ(${turn}deg) translateX(${shift}px)`;
  }, [depth, focusDay, narrow, solo, world]);

  useEffect(() => {
    place();
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [place]);

  useImperativeHandle(
    stageRef,
    () => ({
      turn(yaw, tilt, zoom) {
        const p = pose.current;
        p.yaw = clamp(p.yaw + yaw, -LIMIT.yaw, LIMIT.yaw);
        p.tilt = clamp(p.tilt + tilt, LIMIT.tiltMin, LIMIT.tiltMax);
        p.zoom = clamp(p.zoom + zoom, LIMIT.zoomMin, LIMIT.zoomMax);
        place();
      },
      reset() {
        pose.current = { ...CAMERA };
        place();
      },
    }),
    [place],
  );

  useEffect(() => () => clearTimeout(keyTimer.current), []);

  const startDrag = useCallback(
    (event: ReactPointerEvent, part: WeekPart, resize: boolean) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      const movable = canMove(part);
      const pointer = event.pointerId;
      const fromX = event.clientX;
      const fromY = event.clientY;
      const start = cellAt(fromX, fromY);
      const offset = start
        ? Math.max(0, start.minutes - part.start_minutes)
        : 0;
      const length = part.end_minutes - part.start_minutes;
      let moved = false;
      let alt = event.altKey;
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", escape, true);
        gesturing.current = false;
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointer || !movable) return;
        alt = e.altKey;
        if (
          !moved &&
          Math.abs(e.clientX - fromX) + Math.abs(e.clientY - fromY) < 5
        )
          return;
        const cell = cellAt(e.clientX, e.clientY);
        if (!cell) return;
        moved = true;
        gesturing.current = true;
        if (resize) {
          onPreview(part, {
            endMinutes: clamp(
              cell.minutes + STEP,
              part.start_minutes + STEP,
              floorEnd,
            ),
          });
          return;
        }
        onPreview(part, {
          day: cell.day,
          minutes: clamp(
            Math.round((cell.minutes - offset) / STEP) * STEP,
            floorStart,
            Math.max(floorStart, floorEnd - length),
          ),
        });
      };
      const finish = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        stop();
        if (moved) onCommit(part, alt && !resize, resize);
        else onPick(part);
      };
      const cancel = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        stop();
        if (moved) onCancel();
      };
      const escape = (e: globalThis.KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        stop();
        if (moved) onCancel();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("keydown", escape, true);
    },
    [canMove, floorEnd, floorStart, onCancel, onCommit, onPick, onPreview],
  );

  const keys = useCallback(
    (event: KeyboardEvent, part: WeekPart) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Escape") {
        if (keyPart.current) {
          clearTimeout(keyTimer.current);
          keyPart.current = null;
          onCancel();
        } else onPick(null);
        event.preventDefault();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPick(part);
        return;
      }
      const delta = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -STEP],
        ArrowDown: [0, STEP],
      }[event.key];
      if (!delta) return;
      event.preventDefault();
      if (!canMove(part)) {
        onPick(part);
        return;
      }
      const resized = event.shiftKey && delta[0] === 0;
      const length = part.end_minutes - part.start_minutes;
      onPreview(
        part,
        resized
          ? {
              endMinutes: clamp(
                part.end_minutes + delta[1],
                part.start_minutes + STEP,
                floorEnd,
              ),
            }
          : {
              day: clamp(part.day + delta[0], 0, scene.days.length - 1),
              minutes: clamp(
                part.start_minutes + delta[1],
                floorStart,
                Math.max(floorStart, floorEnd - length),
              ),
            },
      );
      keyPart.current = { part, resized };
      clearTimeout(keyTimer.current);
      keyTimer.current = window.setTimeout(() => {
        const pending = keyPart.current;
        keyPart.current = null;
        if (pending) onCommit(pending.part, false, pending.resized);
      }, 500);
    },
    [
      canMove,
      floorEnd,
      floorStart,
      onCancel,
      onCommit,
      onPick,
      onPreview,
      scene.days.length,
    ],
  );

  // Dragging the floor turns the model, or while tuning marks time to keep free.
  const orbit = useRef<{
    x: number;
    y: number;
    yaw: number;
    tilt: number;
    moved: number;
    id: number;
    cell: Cell | null;
  } | null>(null);
  const [marking, setMarking] = useState<{
    day: number;
    from: number;
    to: number;
  } | null>(null);

  const labels = useMemo(() => {
    const out = new Set([floorStart, floorEnd]);
    for (
      let m = bounds.work_start_minutes;
      m <= bounds.work_end_minutes;
      m += 120
    )
      out.add(m);
    return [...out].sort((a, b) => a - b);
  }, [
    bounds.work_end_minutes,
    bounds.work_start_minutes,
    floorEnd,
    floorStart,
  ]);

  const [dropCell, setDropCell] = useState<Cell | null>(null);
  const [dropSign, setDropSign] = useState<number | null>(null);
  const over = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(TASK_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const sign = signAt(event.clientX, event.clientY);
    setDropSign(sign);
    setDropCell(sign === null ? cellAt(event.clientX, event.clientY) : null);
  };
  const drop = (event: DragEvent) => {
    const id = event.dataTransfer.getData(TASK_MIME);
    const sign = signAt(event.clientX, event.clientY);
    const cell = cellAt(event.clientX, event.clientY);
    setDropCell(null);
    setDropSign(null);
    if (!id) return;
    event.preventDefault();
    if (sign !== null) onDropTaskOnDay(id, sign);
    else if (cell) onDropTask(id, cell);
  };

  const marker = (cell: Cell, className: string, text?: string) => (
    <div
      className={className}
      style={{
        left: cell.day * LANE + 5,
        top: y(cell.minutes),
        width: LANE - 10,
        height: Math.max(
          14,
          y(Math.min(cell.minutes + 60, floorEnd)) - y(cell.minutes),
        ),
      }}
    >
      {text}
    </div>
  );

  return (
    <div
      ref={box}
      className={`calendar-stage${narrow ? " is-solo" : ""}${closeUp && !narrow ? " is-close" : ""}`}
      onDragOver={over}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDropCell(null);
          setDropSign(null);
        }
      }}
      onDrop={drop}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest("button")) return;
        const cell = cellAt(event.clientX, event.clientY);
        // A touch on the floor scrolls the page; blocks still drag.
        if (event.pointerType === "touch" && narrow) return;
        orbit.current = {
          x: event.clientX,
          y: event.clientY,
          yaw: pose.current.yaw,
          tilt: pose.current.tilt,
          moved: 0,
          id: event.pointerId,
          cell,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = orbit.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start.moved = Math.max(start.moved, Math.abs(dx) + Math.abs(dy));
        if (start.moved < 5) return;
        if (tuning && start.cell) {
          const cell = cellAt(event.clientX, event.clientY);
          if (!cell || cell.day !== start.cell.day) return;
          setMarking({
            day: cell.day,
            from: Math.min(start.cell.minutes, cell.minutes),
            to: Math.max(start.cell.minutes, cell.minutes) + STEP,
          });
          return;
        }
        event.currentTarget.classList.add("is-orbiting");
        pose.current.yaw = clamp(start.yaw + dx * 0.14, -LIMIT.yaw, LIMIT.yaw);
        pose.current.tilt = clamp(
          start.tilt - dy * 0.14,
          LIMIT.tiltMin,
          LIMIT.tiltMax,
        );
        place();
      }}
      onPointerUp={(event) => {
        const start = orbit.current;
        orbit.current = null;
        event.currentTarget.classList.remove("is-orbiting");
        if (marking) {
          onKeepFree(marking.day, marking.from, marking.to);
          setMarking(null);
          return;
        }
        if (start && start.moved < 5) {
          onPick(null);
          onSlot(start.cell);
        }
      }}
      onPointerCancel={(event) => {
        orbit.current = null;
        setMarking(null);
        event.currentTarget.classList.remove("is-orbiting");
      }}
      onDoubleClick={(event) => {
        const cell = cellAt(event.clientX, event.clientY);
        if (
          cell &&
          !(event.target as HTMLElement).closest("button, [data-part]")
        )
          onNewAt(cell);
      }}
    >
      <div ref={camera} className="calendar-camera">
        <div
          className="calendar-world"
          style={{
            width: world,
            height: depth,
            left: -world / 2,
            top: -depth / 2,
          }}
        >
          {scene.days.map((day, index) => (
            <div
              key={day.date}
              className={[
                "calendar-lane",
                day.today && "is-today",
                day.over && "is-over",
                day.off && "is-off",
                index === focusDay && "is-here",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: index * LANE, height: depth }}
            />
          ))}
          <Floor
            days={scene.days.length}
            start={floorStart}
            end={floorEnd}
            y={y}
          />
          {labels.map((minutes) => (
            <div key={minutes}>
              <div
                className="calendar-hourline"
                style={{
                  top: y(minutes),
                  left: solo ? focusDay * LANE : 0,
                  width: solo ? LANE : world,
                }}
              />
              <div
                className="calendar-hourlabel"
                style={{
                  top: y(minutes),
                  left: (solo ? focusDay * LANE : 0) - 64,
                }}
              >
                {clock(minutes)}
              </div>
            </div>
          ))}
          {bands.map((band) => {
            const top = y(Math.max(band.from, floorStart));
            const height = Math.max(5, y(Math.min(band.to, floorEnd)) - top);
            return (
              <div
                key={band.key}
                className={`calendar-band is-${band.kind}${solo && band.day !== focusDay ? " is-away" : ""}`}
                style={{
                  left:
                    band.day * LANE +
                    (band.kind === "mate"
                      ? LANE - 8 - (band.slot ?? 0) * 7
                      : 3),
                  top,
                  width: band.kind === "mate" ? 5 : LANE - 6,
                  height,
                  ...(band.color ? { background: band.color } : {}),
                }}
                title={band.label}
              >
                {band.kind !== "mate" && height >= 18 && (
                  <span>{band.label}</span>
                )}
                {band.kind === "free" && band.range && (
                  <button
                    type="button"
                    aria-label={`Stop keeping ${band.label ?? "this time"} free`}
                    onClick={() => band.range && onDropKeepFree(band.range)}
                  >
                    <X aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
          {marking &&
            marker(
              { day: marking.day, minutes: marking.from },
              "calendar-marking",
              `Keep ${clock(marking.from)} to ${clock(marking.to)} free`,
            )}
          {slot &&
            marker(
              slot,
              "calendar-slot",
              `${clock(slot.minutes)} · Press C for an event`,
            )}
          {dropCell &&
            marker(dropCell, "calendar-slot is-drop", clock(dropCell.minutes))}
          {scene.days.map((day, index) => (
            <button
              key={day.date}
              type="button"
              data-sign-day={index}
              className={[
                "calendar-sign",
                day.over && "is-over",
                day.today && "is-today",
                index === focusDay && "is-here",
                dropSign === index && "is-drop",
                solo && index !== focusDay && "is-away",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: index * LANE + 4 }}
              aria-label={`Look closer at ${dayMedium(day.date)}, ${
                day.off
                  ? "day off"
                  : day.over
                    ? `${hoursLabel(day.over_minutes)} over`
                    : `${hoursLabel(day.free_minutes)} free`
              }`}
              onClick={() => onChooseDay(index)}
            >
              <b>{dayShort(day.date)}</b>
              <span>
                {day.off
                  ? "Day off"
                  : day.over
                    ? `${hoursLabel(day.over_minutes)} over`
                    : `${hoursLabel(day.free_minutes)} free`}
              </span>
            </button>
          ))}
          {poles.map((pole) => (
            <div
              key={pole.id}
              className={`calendar-pole${solo && pole.day !== focusDay ? " is-away" : ""}`}
              style={
                {
                  "--x": `${pole.day * LANE + 8}px`,
                  "--y": `${y(clamp(pole.minutes, floorStart, floorEnd))}px`,
                } as CSSProperties
              }
            >
              <button
                type="button"
                dir="auto"
                title={`${pole.title} is due`}
                onClick={() => onPole(pole)}
              >
                {pole.title}
              </button>
            </div>
          ))}
          {scene.now_day !== null &&
            scene.now_minutes >= floorStart &&
            scene.now_minutes <= floorEnd && (
              <div
                className={`calendar-now${solo && scene.now_day !== focusDay ? " is-away" : ""}`}
                style={{
                  left: scene.now_day * LANE,
                  top: y(scene.now_minutes),
                }}
              >
                <i>Now</i>
              </div>
            )}
          {scene.parts.map((part) => (
            <Block
              key={part.id}
              part={part}
              scene={scene}
              y={y}
              draggable={canMove(part)}
              selected={selectedId === part.id}
              related={
                !!relatedItem &&
                selectedId !== part.id &&
                part.source_id.startsWith(relatedItem)
              }
              dragging={draggingId === part.id}
              hidden={solo && part.day !== focusDay}
              look={looks.get(part.id)}
              onPointerDown={startDrag}
              onKeyDown={keys}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
