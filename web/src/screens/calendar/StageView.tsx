import {
  addDays,
  buildWeekScene,
  dayTime,
  localDateKey,
  movedPartTimes,
  type BusyInterval,
  type CalendarEntry,
  type CalendarView,
  type ExternalEntry,
  type PlannedBlock,
  type PlannerPrefs,
  type TaskList,
  type WeekPart,
  type WeekScene,
} from "@orbyn/core";
import {
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "../../ui/kit";
import { Details, type DetailActions } from "./Details";
import {
  clock,
  dayMedium,
  dayShort,
  headline,
  issueKey,
  issueText,
} from "./format";
import {
  clockOf,
  entryKey,
  externalKey,
  isAllDayEntry,
  spanOn,
  type Picked,
} from "./model";
import type { Times } from "./useActions";
import type { MateBusy } from "./useWorkspace";
import {
  WeekStage,
  type Cell,
  type FloorBand,
  type PartTarget,
  type Pole,
  type StageHandle,
} from "./WeekStage";

type Preview = { part: WeekPart; times: Times };

type Props = {
  weekStart: string;
  date: string;
  prefs: PlannerPrefs;
  view: CalendarView;
  external: ExternalEntry[];
  proposals: PlannedBlock[];
  /** How many of `proposals` are plan.blocks; the rest are moves. */
  newSessions: number;
  tunable: boolean;
  keepFree: BusyInterval[];
  mates: MateBusy[];
  listById: Map<string, TaskList>;
  narrow: boolean;
  picked: Picked | null;
  writeBusy: boolean;
  actions: DetailActions;
  canMoveEntry: (entry: CalendarEntry) => boolean;
  canMoveBlock: (block: CalendarView["blocks"][number]) => boolean;
  onDate: (day: string) => void;
  onPick: (picked: Picked | null) => void;
  onMoveBlock: (
    block: CalendarView["blocks"][number],
    times: Times,
    label: string,
  ) => void;
  onCopyBlock: (block: CalendarView["blocks"][number], start: Date) => void;
  onMoveEntry: (entry: CalendarEntry, times: Times, resized: boolean) => void;
  onPinGhost: (ghost: PlannedBlock, start: Date, end: Date) => void;
  onKeepFree: (start: Date, end: Date) => void;
  onDropKeepFree: (range: BusyInterval) => void;
  onDropTask: (itemId: string, start: Date) => void;
  onDropTaskOnDay: (itemId: string, day: string) => void;
  onNewAt: (start: Date) => void;
  onSlot: (iso: string | null) => void;
  onOpenItem: (itemId: string) => void;
  slot: string | null;
};

/**
 * The approved 3D planner over the calendar's real data: builds the shared
 * week model, keeps a move's preview in it so capacity and issues answer as
 * you drag, and turns stage gestures into the same actions the flat grid uses.
 */
export function StageView({
  weekStart,
  date,
  prefs,
  view,
  external,
  proposals,
  newSessions,
  tunable,
  keepFree,
  mates,
  listById,
  narrow,
  picked,
  writeBusy,
  actions,
  canMoveEntry,
  canMoveBlock,
  onDate,
  onPick,
  onMoveBlock,
  onCopyBlock,
  onMoveEntry,
  onPinGhost,
  onKeepFree,
  onDropKeepFree,
  onDropTask,
  onDropTaskOnDay,
  onNewAt,
  onSlot,
  onOpenItem,
  slot,
}: Props) {
  const tz = prefs.timezone;
  const stage = useRef<StageHandle>(null);
  const [now, setNow] = useState(() => new Date());
  const [preview, setPreviewState] = useState<Preview | null>(null);
  const previewRef = useRef(preview);
  const setPreview = (next: Preview | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };
  const [closeUp, setCloseUp] = useState(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Moving the week drops a move that hadn't landed.
  useEffect(() => setPreview(null), [weekStart]);

  const scene = useMemo<WeekScene>(() => {
    const p = preview;
    const moved = <T extends { start_at: string; end_at: string | null }>(
      x: T,
    ): T =>
      p ? { ...x, start_at: p.times.start_at, end_at: p.times.end_at } : x;
    const blocks =
      p?.part.source === "block"
        ? view.blocks.map((b) => (b.id === p.part.source_id ? moved(b) : b))
        : view.blocks;
    const entries =
      p?.part.source === "entry"
        ? view.entries.map((e) =>
            e.item_id === p.part.source_id && e.start_at === p.part.start_at
              ? moved(e)
              : e,
          )
        : view.entries;
    const shownProposals =
      p?.part.source === "proposal"
        ? proposals.map((g, i) =>
            `${g.item_id}:${i}` === p.part.source_id ? moved(g) : g,
          )
        : proposals;
    const built = buildWeekScene({
      week_start: weekStart,
      prefs,
      now,
      view: { ...view, blocks, entries, external },
      proposals: shownProposals,
    });
    if (!p || p.part.source === "block") return built;
    // An entry's id carries its time: keep the one the gesture started with.
    return {
      ...built,
      parts: built.parts.map((part) =>
        part.source === p.part.source &&
        part.source_id === p.part.source_id &&
        part.start_at === p.times.start_at
          ? { ...part, id: p.part.id }
          : part,
      ),
    };
  }, [external, now, preview, prefs, proposals, view, weekStart]);

  const dayIndex = scene.days.findIndex((d) => d.date === date);
  const focusDay = dayIndex >= 0 ? dayIndex : (scene.now_day ?? 0);

  const records = useMemo(() => {
    const entries = new Map(
      view.entries.map((e) => [`${e.item_id}@${e.start_at}`, e]),
    );
    const blocks = new Map(view.blocks.map((b) => [b.id, b]));
    const frames = new Map(
      (view.frames ?? []).map((f) => [`${f.frame_id}@${f.start_at}`, f]),
    );
    const habits = new Map((view.habit_blocks ?? []).map((h) => [h.id, h]));
    return { entries, blocks, frames, habits };
  }, [view]);

  const recordOf = useCallback(
    (part: WeekPart): Picked | null => {
      if (part.source === "block") {
        const block = records.blocks.get(part.source_id);
        return block ? { kind: "block", block } : null;
      }
      if (part.source === "entry") {
        const entry = records.entries.get(`${part.source_id}@${part.start_at}`);
        return entry ? { kind: "entry", entry } : null;
      }
      if (part.source === "frame") {
        const frame = records.frames.get(`${part.source_id}@${part.start_at}`);
        return frame ? { kind: "frame", frame } : null;
      }
      if (part.source === "habit") {
        const habit = records.habits.get(part.source_id);
        return habit ? { kind: "habit", habit } : null;
      }
      if (part.source === "external") {
        const event = external.find(
          (x) =>
            x.subscription_id === part.source_id &&
            x.start_at === part.start_at &&
            x.title === part.title,
        );
        return event ? { kind: "external", event } : null;
      }
      const index = Number(part.source_id.split(":").pop());
      const ghost = proposals[index];
      return ghost ? { kind: "ghost", ghost } : null;
    },
    [external, proposals, records],
  );

  const canMove = useCallback(
    (part: WeekPart) => {
      if (part.source === "block")
        return (
          part.movable &&
          (() => {
            const block = records.blocks.get(part.source_id);
            return !!block && canMoveBlock(block);
          })()
        );
      if (part.source === "entry") {
        const entry = records.entries.get(`${part.source_id}@${part.start_at}`);
        // Spanning days, it has no single place on the floor.
        return !!entry && !isAllDayEntry(entry, tz) && canMoveEntry(entry);
      }
      if (part.source === "proposal") {
        const index = Number(part.source_id.split(":").pop());
        return tunable && index < newSessions;
      }
      return false;
    },
    [canMoveBlock, canMoveEntry, newSessions, records, tunable, tz],
  );

  const looks = useMemo(() => {
    const out = new Map<string, { color?: string }>();
    for (const part of scene.parts) {
      if (part.source === "entry") {
        const e = records.entries.get(`${part.source_id}@${part.start_at}`);
        const color =
          e?.color || (e?.list_id ? listById.get(e.list_id)?.color : undefined);
        if (color) out.set(part.id, { color });
      } else if (part.source === "frame") {
        const f = records.frames.get(`${part.source_id}@${part.start_at}`);
        if (f) out.set(part.id, { color: f.color });
      } else if (part.source === "external") {
        const x = external.find((e) => e.subscription_id === part.source_id);
        if (x) out.set(part.id, { color: x.color });
      } else if (part.source === "block") {
        const b = records.blocks.get(part.source_id);
        const color = b?.list_id ? listById.get(b.list_id)?.color : undefined;
        if (color) out.set(part.id, { color });
      }
    }
    return out;
  }, [external, listById, records, scene.parts]);

  const bands = useMemo(() => {
    const out: FloorBand[] = [];
    const add = (
      start: string,
      end: string,
      make: (day: number, from: number, to: number) => FloorBand,
    ) =>
      scene.days.forEach((d, day) => {
        const r = spanOn(start, end, d.date, tz);
        if (r) out.push(make(day, r.top, r.bottom));
      });
    for (const x of view.derived)
      add(x.start_at, x.end_at, (day, from, to) => ({
        key: `${x.kind}${x.item_id}${x.start_at}${day}`,
        kind: x.kind,
        day,
        from,
        to,
        label: x.label,
      }));
    for (const k of keepFree)
      add(k.start_at, k.end_at, (day, from, to) => ({
        key: `free${k.start_at}${k.end_at}${day}`,
        kind: "free",
        day,
        from,
        to,
        label: "Keep free",
        range: k,
      }));
    mates.forEach((m, slotIndex) => {
      for (const b of m.busy)
        add(b.start_at, b.end_at, (day, from, to) => ({
          key: `mate${m.user_id}${b.start_at}${day}`,
          kind: "mate",
          day,
          from,
          to,
          label: m.name,
          color: m.color,
          slot: slotIndex,
        }));
    });
    return out;
  }, [keepFree, mates, scene.days, tz, view.derived]);

  // Deadlines with no time set aside stand on the floor too.
  const poles = useMemo(() => {
    const seen = new Set<string>();
    const out: Pole[] = [];
    for (const e of view.entries) {
      if (e.kind !== "task" || e.end_at || isAllDayEntry(e, tz)) continue;
      const day = scene.days.findIndex(
        (d) => d.date === localDateKey(new Date(e.start_at), tz),
      );
      if (day < 0) continue;
      seen.add(`${e.item_id}:${Date.parse(e.start_at)}`);
      out.push({
        id: `entry:${entryKey(e)}`,
        title: e.title,
        day,
        minutes: clockOf(e.start_at, tz),
        at: e.start_at,
        itemId: e.item_id,
      });
    }
    for (const d of scene.deadlines) {
      const itemId = d.id.split(":")[0];
      if (seen.has(`${itemId}:${Date.parse(d.at)}`)) continue;
      out.push({
        id: d.id,
        title: d.title,
        day: d.day,
        minutes: d.minutes,
        at: d.at,
        itemId,
      });
    }
    return out;
  }, [scene.days, scene.deadlines, tz, view.entries]);

  const handlePreview = useCallback(
    (part: WeekPart, target: PartTarget) => {
      setPreview({
        part,
        times:
          "endMinutes" in target
            ? {
                start_at: part.start_at,
                end_at: dayTime(
                  scene.days[part.day].date,
                  target.endMinutes,
                  tz,
                ).toISOString(),
              }
            : movedPartTimes(scene, part, target.day, target.minutes),
      });
    },
    [scene, tz],
  );

  const commit = useCallback(
    (part: WeekPart, copy: boolean, resized: boolean) => {
      const moved = previewRef.current;
      if (!moved) return;
      const { times } = moved;
      const unchanged =
        times.start_at === part.start_at && times.end_at === part.end_at;
      const record = recordOf(moved.part) ?? recordOf(part);
      if (!unchanged && record) {
        const label = `Moved to ${dayShort(localDateKey(new Date(times.start_at), tz))} ${clock(clockOf(times.start_at, tz))}`;
        setSaid(label);
        onDate(localDateKey(new Date(times.start_at), tz));
        if (record.kind === "block") {
          if (copy) onCopyBlock(record.block, new Date(times.start_at));
          else onMoveBlock(record.block, times, `${label}.`);
        } else if (record.kind === "entry")
          onMoveEntry(record.entry, times, resized);
        else if (record.kind === "ghost")
          onPinGhost(
            record.ghost,
            new Date(times.start_at),
            new Date(times.end_at),
          );
      }
      setPreview(null);
    },
    [onCopyBlock, onDate, onMoveBlock, onMoveEntry, onPinGhost, recordOf, tz],
  );

  const cellTime = useCallback(
    (cell: Cell) => dayTime(scene.days[cell.day].date, cell.minutes, tz),
    [scene.days, tz],
  );

  const selectedId = useMemo(() => {
    if (!picked) return null;
    const part = scene.parts.find((p) => {
      const r = recordOf(p);
      if (!r || r.kind !== picked.kind) return false;
      if (r.kind === "block" && picked.kind === "block")
        return r.block.id === picked.block.id;
      if (r.kind === "entry" && picked.kind === "entry")
        return entryKey(r.entry) === entryKey(picked.entry);
      if (r.kind === "frame" && picked.kind === "frame")
        return (
          r.frame.frame_id === picked.frame.frame_id &&
          r.frame.start_at === picked.frame.start_at
        );
      if (r.kind === "habit" && picked.kind === "habit")
        return r.habit.id === picked.habit.id;
      if (r.kind === "external" && picked.kind === "external")
        return externalKey(r.event) === externalKey(picked.event);
      return (
        r.kind === "ghost" &&
        picked.kind === "ghost" &&
        r.ghost === picked.ghost
      );
    });
    return part?.id ?? null;
  }, [picked, recordOf, scene.parts]);

  const relatedItem =
    picked?.kind === "block"
      ? picked.block.item_id
      : picked?.kind === "entry"
        ? picked.entry.item_id
        : null;

  const slotCell = useMemo<Cell | null>(() => {
    if (!slot) return null;
    const day = scene.days.findIndex(
      (d) => d.date === localDateKey(new Date(slot), tz),
    );
    return day < 0 ? null : { day, minutes: clockOf(slot, tz) };
  }, [scene.days, slot, tz]);

  const dayAllDay = useMemo(() => {
    const day = scene.days[focusDay].date;
    const within = (x: {
      start_at: string;
      end_at: string | null;
      all_day?: boolean;
    }) => x.all_day && spanOn(x.start_at, x.end_at ?? x.start_at, day, tz);
    return [
      ...view.entries
        .filter(within)
        .map((entry): Picked => ({ kind: "entry", entry })),
      ...external
        .filter(within)
        .map((event): Picked => ({ kind: "external", event })),
    ];
  }, [external, focusDay, scene.days, tz, view.entries]);

  const empty = !scene.parts.length
    ? "Nothing planned this week"
    : narrow && !scene.parts.some((p) => p.day === focusDay)
      ? `Nothing on ${dayMedium(scene.days[focusDay].date)}`
      : "";

  return (
    <div className="calendar-model" role="region" aria-label="Week planner">
      <div className="calendar-model-head">
        <h2 aria-live="polite">{headline(scene.issues.length)}</h2>
        {scene.issues.length > 0 && (
          <div className="calendar-issues">
            {scene.issues.map((issue) => {
              const text = issueText(issue, scene);
              return (
                <button
                  key={issueKey(issue)}
                  type="button"
                  className={`calendar-issue is-${issue.kind}`}
                  title={text}
                  onClick={() => {
                    if (issue.kind === "over") {
                      onDate(scene.days[issue.day].date);
                      setCloseUp(true);
                      return;
                    }
                    const part = scene.parts.find(
                      (p) => p.id === issue.part_id,
                    );
                    if (!part) return;
                    onDate(scene.days[part.day].date);
                    const record = recordOf(part);
                    if (record) onPick(record);
                  }}
                >
                  <span dir="auto">{text}</span>
                </button>
              );
            })}
          </div>
        )}
        {dayAllDay.length > 0 && (
          <div className="calendar-allday-row">
            <small className="muted">All day</small>
            {dayAllDay.map((p) => (
              <button
                key={
                  p.kind === "entry"
                    ? entryKey(p.entry)
                    : p.kind === "external"
                      ? externalKey(p.event)
                      : ""
                }
                type="button"
                className="calendar-chip"
                onClick={() => onPick(p)}
              >
                <span dir="auto">
                  {p.kind === "entry"
                    ? p.entry.title
                    : p.kind === "external"
                      ? p.event.title
                      : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="calendar-daychips" role="group" aria-label="Day">
        {scene.days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            aria-pressed={index === focusDay}
            className={day.over ? "is-over" : undefined}
            onClick={() => onDate(day.date)}
          >
            {dayShort(day.date)}
          </button>
        ))}
      </div>
      <WeekStage
        scene={scene}
        poles={poles}
        bands={bands}
        focusDay={focusDay}
        closeUp={closeUp}
        narrow={narrow}
        selectedId={selectedId}
        relatedItem={relatedItem}
        draggingId={preview?.part.id ?? null}
        slot={slotCell}
        tuning={tunable}
        looks={looks}
        stageRef={stage}
        canMove={canMove}
        onPick={(part) => onPick(part ? recordOf(part) : null)}
        onChooseDay={(day) => {
          const next = scene.days[day].date;
          setCloseUp(next === date ? !closeUp : true);
          onDate(next);
        }}
        onPreview={handlePreview}
        onCommit={commit}
        onCancel={() => setPreview(null)}
        onSlot={(cell) => onSlot(cell ? cellTime(cell).toISOString() : null)}
        onNewAt={(cell) => onNewAt(cellTime(cell))}
        onKeepFree={(day, from, to) => {
          const d = scene.days[day].date;
          onKeepFree(
            dayTime(d, from, tz),
            to >= 1440 ? dayTime(addDays(d, 1), 0, tz) : dayTime(d, to, tz),
          );
        }}
        onDropKeepFree={onDropKeepFree}
        onDropTask={(id, cell) => onDropTask(id, cellTime(cell))}
        onDropTaskOnDay={(id, day) => onDropTaskOnDay(id, scene.days[day].date)}
        onPole={(pole) => {
          const entry = view.entries.find(
            (e) => e.item_id === pole.itemId && e.start_at === pole.at,
          );
          if (entry) onPick({ kind: "entry", entry });
          else onOpenItem(pole.itemId);
        }}
      />
      {empty && !proposals.length && (
        <p className="calendar-model-empty">{empty}</p>
      )}
      <div
        className="calendar-camera-controls"
        role="group"
        aria-label="Turn the model"
      >
        <IconButton
          label="Turn left"
          onClick={() => stage.current?.turn(-8, 0, 0)}
        >
          <RotateCcw />
        </IconButton>
        <IconButton
          label="Turn right"
          onClick={() => stage.current?.turn(8, 0, 0)}
        >
          <RotateCw />
        </IconButton>
        <IconButton
          label="Tilt up"
          onClick={() => stage.current?.turn(0, -6, 0)}
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          label="Tilt down"
          onClick={() => stage.current?.turn(0, 6, 0)}
        >
          <ArrowDown />
        </IconButton>
        <IconButton
          label="Zoom in"
          onClick={() => stage.current?.turn(0, 0, 0.1)}
        >
          <Plus />
        </IconButton>
        <IconButton
          label="Zoom out"
          onClick={() => stage.current?.turn(0, 0, -0.1)}
        >
          <Minus />
        </IconButton>
        <Button
          variant="ghost"
          onClick={() => {
            stage.current?.reset();
            setCloseUp(false);
          }}
        >
          Reset
        </Button>
      </div>
      <div className="calendar-legend" aria-hidden="true">
        <span>
          <i className="is-event" /> Event
        </span>
        <span>
          <i className="is-session" /> Session
        </span>
        <span>Taller is higher priority</span>
      </div>
      {picked && (
        <aside className="calendar-inspector" aria-label="Selected item">
          <Details
            picked={picked}
            tz={tz}
            writeBusy={writeBusy}
            actions={actions}
            onClose={() => onPick(null)}
          />
        </aside>
      )}
      <div className="sr-only" aria-live="polite">
        {said}
      </div>
    </div>
  );
}
