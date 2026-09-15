import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  SlidersHorizontal,
  Users,
  Wand2,
  X,
} from "lucide-react";
import {
  addMonths,
  dateLabel,
  monthGrid,
  sameDay,
  startOfDay,
  type CalendarEntry,
  type CalendarSet,
  type FrameOccurrence,
  type HttpError,
  type Item,
  type ItemInput,
  type Plan,
  type Team,
  type TimeBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { celebrate } from "../../lib/celebrate";
import { isTyping } from "../../lib/keys";
import { usePlanning } from "../../app/planning";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { errorText, fromDayKey } from "../../lib/planning";
import {
  addDays,
  itemsForDay,
  monthTitle,
  rangeTitle,
  startOfWeek,
} from "./dates";
import { MonthView } from "./MonthView";
import { DayAgenda } from "./DayAgenda";
import { CalendarGrid } from "./CalendarGrid";
import { AgendaList } from "./AgendaList";
import { BlockMenu, EntryMenu, FrameMenu } from "./CalendarMenus";
import { BlockDialog } from "./BlockDialog";
import { CalendarSetsDialog } from "./CalendarSets";
import { FrameDialog } from "./FrameDialog";
import { SchedulePanel } from "./SchedulePanel";
import { PlannerPanel } from "./PlannerPanel";
import { useCalendarData } from "./useCalendarData";
import { usePlanTuning } from "./usePlanTuning";
import { TeammatesLegend, TeammatesMenu, useTeammates } from "./Teammates";
import { entryAsItem, entryKey, inSet, itemIdOf } from "./model";
import "./calendar.css";
import "./calendar-drag.css";

export type CalendarMode = "month" | "week" | "day" | "agenda";

/** A request from elsewhere (assistant, command bar, notices) to show the planner. */
export type PlanRequest = {
  key: number;
  /** A plan to show and apply. */
  plan?: Plan;
  /** Preview a plan for this many days right away. */
  days?: number;
  /** Tasks the preview must include ("Plan it"). */
  include?: string[];
};

const MODES: { id: CalendarMode; label: string; key: string }[] = [
  { id: "month", label: "Month", key: "m" },
  { id: "week", label: "Week", key: "w" },
  { id: "day", label: "Day", key: "d" },
  { id: "agenda", label: "Agenda", key: "a" },
];
const AGENDA_DAYS = 14;
const SET_KEY = "orbyn-calendar-set";
/** How long a note under the toolbar stays. */
const NOTE_MS = 8000;

type Props = {
  items: Item[];
  teams: Team[];
  canWrite: (item: Item) => boolean;
  onOpen: (item: Item) => void;
  /** Opens the item editor (to edit a whole series). */
  onEditItem: (item: Item) => void;
  onFocus: (item: Item) => void;
  /** The selected day; also decides which month / week is shown. */
  date: Date;
  onDateChange: (date: Date) => void;
  mode: CalendarMode;
  onModeChange: (mode: CalendarMode) => void;
  /** Keyboard shortcuts are off while a dialog or panel is open. */
  shortcuts: boolean;
  revision: number;
  report: (e: unknown) => void;
  /** Refresh the planner (tasks) after a change. */
  onChanged: () => Promise<void>;
  planRequest: PlanRequest | null;
  /** Opens the item editor for a new event (the "C" shortcut). */
  onNewEvent: (draft: Partial<ItemInput>) => void;
  /** You, left out of "Show teammates". */
  userId?: string;
};

const savedSet = () => {
  try {
    return localStorage.getItem(SET_KEY) ?? "";
  } catch {
    return "";
  }
};

type Menu =
  | { kind: "entry"; entry: CalendarEntry; anchor: DOMRect }
  | { kind: "block"; block: TimeBlock; anchor: DOMRect }
  | { kind: "frame"; frame: FrameOccurrence; anchor: DOMRect }
  | null;
type Dialog =
  | { kind: "schedule"; item: Item }
  | { kind: "move"; block: TimeBlock }
  | { kind: "sets" }
  | { kind: "frame"; frameId: string }
  | null;
/** A short message under the toolbar, sometimes with Undo. */
type Note = { text: string; undo?: () => void; tone?: "warn" };

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/**
 * Month / Week / Day / Agenda calendar on the calendar API, with calendar
 * sets, frames, time blocks, the planner (and tuning its preview on the
 * grid), teammates' busy times and a list of tasks to place. Entries take
 * their list's colour; drag them to move, or drag empty time for an event.
 * Shortcuts: ← → move, T today, M/W/D/A switch views, C new event (at a
 * time picked by clicking the grid, else the selected day), P planner,
 * 1–9 sets, 0 all, Esc drops the picked time.
 */
export function CalendarView({
  items,
  teams,
  canWrite,
  onOpen,
  onEditItem,
  onFocus,
  date,
  onDateChange,
  mode,
  onModeChange,
  shortcuts,
  revision,
  report,
  onChanged,
  planRequest,
  onNewEvent,
  userId,
}: Props) {
  const planning = usePlanning();
  const prefs = planning.prefs;
  const narrow = useMediaQuery("(max-width: 900px)");
  const phone = useMediaQuery("(max-width: 520px)");
  const span = phone ? 1 : narrow ? 3 : 7;
  const weekStart = span === 7 ? startOfWeek(date) : startOfDay(date);
  const weekDays = Array.from({ length: span }, (_, n) =>
    addDays(weekStart, n),
  );
  const gridDays = mode === "day" ? [startOfDay(date)] : weekDays;
  const dayKeyStr = date.toDateString();

  const range = useMemo(() => {
    if (mode === "month") {
      const grid = monthGrid(date);
      return { from: grid[0][0], to: addDays(grid[5][6], 1) };
    }
    if (mode === "week")
      return { from: weekStart, to: addDays(weekStart, span) };
    const from = startOfDay(date);
    return { from, to: addDays(from, mode === "day" ? 1 : AGENDA_DAYS) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dayKeyStr, span]);
  const { data, reload, setData } = useCalendarData(
    range.from,
    range.to,
    revision,
    report,
  );

  // ---- calendar sets ----
  const sets = prefs?.calendar_sets ?? [];
  const [setId, setSetIdState] = useState(savedSet);
  const activeSet: CalendarSet | null =
    sets.find((s) => s.id === setId) ?? null;
  const chooseSet = (id: string) => {
    setSetIdState(id);
    try {
      localStorage.setItem(SET_KEY, id);
    } catch {
      // The choice just won't stick.
    }
  };

  const entries = (data?.entries ?? []).filter((e) => inSet(activeSet, e));
  const shownIds = new Set(entries.map((e) => e.item_id));
  const blocks = (data?.blocks ?? []).filter((b) => inSet(activeSet, b));
  const derived = (data?.derived ?? []).filter((d) => shownIds.has(d.item_id));
  const frames = data?.frames ?? [];
  const gridMode = mode === "week" || mode === "day";

  // ---- teammates' busy times ----
  const mates = useTeammates(
    teams,
    userId,
    prefs?.pinned_user_ids ?? [],
    range.from,
    range.to,
    gridMode,
    report,
  );
  const [matesMenu, setMatesMenu] = useState<DOMRect | null>(null);
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // ---- notes under the toolbar ----
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(id);
  }, [note]);

  // ---- the planner ----
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [autoPreview, setAutoPreview] = useState<{
    days?: number;
    include?: string[];
    key: number;
  } | null>(null);
  const tuner = usePlanTuning(plan, setPlan, plannerOpen, data, report);
  const tuning = plannerOpen && !!plan && !plan.applied;
  const ghosts = plan && !plan.applied ? plan.blocks : [];
  const latestNav = useRef({ onDateChange, onModeChange, mode });
  latestNav.current = { onDateChange, onModeChange, mode };
  useEffect(() => {
    if (!planRequest) return;
    const { onDateChange, onModeChange, mode } = latestNav.current;
    setPlannerOpen(true);
    if (planRequest.plan) {
      setPlan(planRequest.plan);
      onDateChange(fromDayKey(planRequest.plan.starts_on));
      if (mode === "month" || mode === "agenda")
        onModeChange(planRequest.plan.days > 1 ? "week" : "day");
    } else {
      if (mode === "month" || mode === "agenda")
        onModeChange(planRequest.days && planRequest.days > 1 ? "week" : "day");
      setAutoPreview({
        days: planRequest.days,
        include: planRequest.include,
        key: planRequest.key,
      });
    }
  }, [planRequest]);

  // ---- menus and dialogs ----
  const [menu, setMenu] = useState<Menu>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const resolve = async (id: string) =>
    itemMap.get(id) ?? (await client.getItem(id));
  const withItem = (id: string, fn: (item: Item) => void) =>
    void resolve(id).then(fn, report);

  const changed = async () => {
    await reload();
    await onChanged();
  };
  const mutate = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      report(e);
    }
    await reload();
  };

  const createBlock = (item: Item, start: Date, end?: Date) => {
    if (item.kind !== "task") return;
    const minutes = Math.min(item.estimate_minutes ?? 30, 1440);
    void mutate(() =>
      client.createBlock({
        item_id: item.id,
        start_at: start.toISOString(),
        end_at: (
          end ?? new Date(start.getTime() + minutes * 60_000)
        ).toISOString(),
      }),
    );
  };

  const changeBlock = (block: TimeBlock, start: Date, end: Date) => {
    // Show the new time right away; the reload confirms it.
    setData(
      (d) =>
        d && {
          ...d,
          blocks: d.blocks.map((b) =>
            b.id === block.id
              ? {
                  ...b,
                  start_at: start.toISOString(),
                  end_at: end.toISOString(),
                }
              : b,
          ),
        },
    );
    void mutate(() =>
      client.updateBlock(block.id, {
        start_at: start.toISOString(),
        end_at: end.toISOString(),
      }),
    );
  };

  /** Another block for the same task: at `start`, or the next free time. */
  const duplicate = async (block: TimeBlock, start?: Date) => {
    try {
      const copy = await client.duplicateBlock(
        block.id,
        start ? { start_at: start.toISOString() } : {},
      );
      if (!start)
        setNote({
          text: `Copied to ${shortDay(copy.start_at)}, ${new Date(
            copy.start_at,
          ).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
        });
    } catch (e) {
      report(e);
    }
    await reload();
  };

  // ---- dragging events and timed tasks ----
  /** Not repeating ones (that needs a this/following/all choice), nor view-only ones. */
  const canDragEntry = (e: CalendarEntry) => {
    if (e.occurrence || e.rrule) return false;
    const item = itemMap.get(e.item_id);
    return !item || canWrite(item);
  };
  /** Save a dragged entry's new time; it shows there at once and goes back on failure. */
  const moveEntry = async (
    entry: CalendarEntry,
    start: Date,
    end: Date,
    resized: boolean,
  ) => {
    const startIso = start.toISOString();
    // A task without an end keeps none; moving only changes its due time.
    const endIso = entry.end_at || resized ? end.toISOString() : null;
    const key = entryKey(entry);
    setData(
      (d) =>
        d && {
          ...d,
          entries: d.entries.map((x) =>
            entryKey(x) === key
              ? { ...x, start_at: startIso, end_at: endIso }
              : x,
          ),
        },
    );
    try {
      const known = itemMap.get(entry.item_id);
      const item =
        known && known.version >= entry.version
          ? known
          : await client.getItem(entry.item_id);
      // The full body, as the editor sends it; planning and event fields
      // left out keep their saved values.
      await client.updateItem(item.id, {
        title: item.title,
        notes: item.notes ?? "",
        kind: item.kind,
        status: item.status,
        priority: item.priority,
        due_at: startIso,
        end_at: endIso,
        team_id: item.team_id ?? null,
        version: item.version,
      });
      await onChanged();
    } catch (e) {
      if ((e as HttpError).status === 401) report(e);
      else
        setNote({
          tone: "warn",
          text:
            (e as HttpError).status === 409
              ? `“${entry.title}” was changed somewhere else, so it stayed put. It now shows the latest; try again.`
              : `Couldn't move “${entry.title}”. ${errorText(e)}`,
        });
    }
    await reload();
  };

  // ---- frames ----
  const unskipFrame = async (f: FrameOccurrence) => {
    try {
      await client.unskipFrame(f.frame_id, f.date);
      setNote(null);
    } catch (e) {
      report(e);
    }
    await reload();
  };
  const skipFrame = async (f: FrameOccurrence) => {
    try {
      await client.skipFrame(f.frame_id, f.date);
      setNote({
        text: `Skipped ${f.name} on ${shortDay(f.start_at)}.`,
        undo: () => void unskipFrame(f),
      });
    } catch (e) {
      report(e);
    }
    await reload();
  };

  const step = (dir: -1 | 1) => {
    if (mode === "month") {
      const next = addMonths(date, dir);
      const today = new Date();
      onDateChange(
        today.getMonth() === next.getMonth() &&
          today.getFullYear() === next.getFullYear()
          ? today
          : next,
      );
    } else
      onDateChange(
        addDays(
          date,
          dir * (mode === "week" ? span : mode === "agenda" ? AGENDA_DAYS : 1),
        ),
      );
  };
  const openDay = (day: Date) => {
    onDateChange(day);
    onModeChange("day");
  };
  /** Closing the planner drops its preview and any pending auto-preview. */
  const closePlanner = () => {
    setPlannerOpen(false);
    setPlan(null);
    setAutoPreview(null);
  };
  const togglePlanner = () => {
    if (plannerOpen) return closePlanner();
    if (mode === "month" || mode === "agenda") onModeChange("week");
    setPlannerOpen(true);
  };

  // ---- new events, and finishing tasks from the calendar ----
  /** A time picked in the week or day grid, for "C". */
  const [slot, setSlot] = useState<Date | null>(null);
  /** A new event at the picked time if it's on screen, else on the selected day. */
  const newEvent = () => {
    const start =
      slot &&
      (mode === "week" || mode === "day") &&
      gridDays.some((d) => sameDay(d, slot))
        ? slot
        : nextQuarter(date);
    onNewEvent({
      kind: "event",
      title: "",
      due_at: start.toISOString(),
      end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
    });
  };
  const complete = async (itemId: string, repeating = false) => {
    try {
      const next = await client.postItemUpdate(itemId, { status: "done" });
      celebrate();
      // A repeating task moves on to its next occurrence instead of closing.
      if (repeating && next.status !== "done" && next.due_at)
        setNote({ text: `Done — next on ${dateLabel(next.due_at)}.` });
    } catch (e) {
      report(e);
    }
    await changed();
  };
  /** Open tasks you can change; for a repeating one, only its current occurrence. */
  const canComplete = (e: CalendarEntry) => {
    if (e.kind !== "task" || e.status === "done") return false;
    const item = itemMap.get(e.item_id);
    if (item && !canWrite(item)) return false;
    if (!e.occurrence) return true;
    return !!item?.due_at && Date.parse(item.due_at) === Date.parse(e.start_at);
  };
  const menuBlockItem =
    menu?.kind === "block" ? itemMap.get(menu.block.item_id) : undefined;

  const latest = useRef({
    step,
    onDateChange,
    onModeChange,
    togglePlanner,
    sets,
    newEvent,
    slot,
  });
  latest.current = {
    step,
    onDateChange,
    onModeChange,
    togglePlanner,
    sets,
    newEvent,
    slot,
  };
  const blocked = !shortcuts || !!menu || !!dialog || !!matesMenu;
  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e)) return;
      const {
        step,
        onDateChange,
        onModeChange,
        togglePlanner,
        sets,
        newEvent,
        slot,
      } = latest.current;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Escape") {
        if (!slot) return;
        setSlot(null);
      } else if (key === "t") onDateChange(new Date());
      else if (key === "p") togglePlanner();
      else if (key === "c") newEvent();
      else if (/^[0-9]$/.test(key)) {
        const n = Number(key);
        if (n === 0) chooseSet("");
        else if (sets[n - 1]) chooseSet(sets[n - 1].id);
        else return;
      } else {
        const m = MODES.find((m) => m.key === key);
        if (!m) return;
        onModeChange(m.id);
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [blocked]);

  const agendaDays = Array.from({ length: AGENDA_DAYS }, (_, n) =>
    addDays(startOfDay(date), n),
  );
  const title =
    mode === "month"
      ? monthTitle(date)
      : mode === "week"
        ? rangeTitle(weekDays)
        : mode === "agenda"
          ? rangeTitle([agendaDays[0], agendaDays[AGENDA_DAYS - 1]])
          : rangeTitle([date]);
  const unit =
    mode === "month"
      ? "month"
      : mode === "week"
        ? "week"
        : mode === "agenda"
          ? "two weeks"
          : "day";
  const monthItems = entries.map((e) => entryAsItem(e, itemMap));
  const openKey = (i: Item) => withItem(itemIdOf(i.id), onOpen);
  const zones = (prefs?.extra_timezones ?? []).slice(0, 3);
  const showSide = mode !== "month";
  const menuEntry = menu?.kind === "entry" ? menu.entry : null;
  const menuItem = menuEntry ? itemMap.get(menuEntry.item_id) : undefined;

  return (
    <div className={"calendar-page" + (showSide ? " with-side" : "")}>
      <section className="card calendar" aria-label="Calendar">
        <div className="calendar-toolbar">
          <div className="calendar-nav">
            <button
              className="icon-button"
              aria-label={`Previous ${unit}`}
              title={`Previous ${unit} (←)`}
              aria-keyshortcuts="ArrowLeft"
              onClick={() => step(-1)}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="secondary calendar-today"
              title="Jump to today (T)"
              aria-keyshortcuts="T"
              disabled={sameDay(date, new Date())}
              onClick={() => onDateChange(new Date())}
            >
              Today
            </button>
            <button
              className="icon-button"
              aria-label={`Next ${unit}`}
              title={`Next ${unit} (→)`}
              aria-keyshortcuts="ArrowRight"
              onClick={() => step(1)}
            >
              <ChevronRight size={19} />
            </button>
            <h2 aria-live="polite">{title}</h2>
          </div>
          <div className="calendar-tools">
            <label className="set-picker">
              <Layers size={14} aria-hidden="true" />
              <span className="sr-only">Calendar set</span>
              <select
                value={activeSet?.id ?? ""}
                title="Calendar set (number keys)"
                onChange={(e) => chooseSet(e.target.value)}
              >
                <option value="">Everything (0)</option>
                {sets.map((s, n) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {n < 9 ? ` (${n + 1})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="icon-button"
              aria-label="Edit calendar sets"
              title="Edit calendar sets"
              onClick={() => setDialog({ kind: "sets" })}
            >
              <SlidersHorizontal size={16} />
            </button>
            {teams.length > 0 && gridMode && (
              <button
                className={
                  "secondary planner-toggle" +
                  (mates.selected.length ? " active" : "")
                }
                aria-haspopup="dialog"
                aria-expanded={!!matesMenu}
                title="Show teammates' busy times"
                onClick={(e) => {
                  mates.load();
                  setMatesMenu(
                    matesMenu ? null : e.currentTarget.getBoundingClientRect(),
                  );
                }}
              >
                <Users size={14} /> Teammates
                {mates.selected.length > 0 && ` (${mates.selected.length})`}
              </button>
            )}
            <button
              className={
                "secondary planner-toggle" + (plannerOpen ? " active" : "")
              }
              aria-pressed={plannerOpen}
              aria-keyshortcuts="P"
              title="Planner (P)"
              onClick={togglePlanner}
            >
              <Wand2 size={14} /> Plan
            </button>
            <div className="segmented" role="group" aria-label="Calendar view">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  aria-pressed={mode === m.id}
                  className={mode === m.id ? "active" : ""}
                  title={`${m.label} view (${m.key.toUpperCase()})`}
                  aria-keyshortcuts={m.key.toUpperCase()}
                  onClick={() => onModeChange(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {note && (
          <div
            className={
              "calendar-note" + (note.tone === "warn" ? " is-warn" : "")
            }
            role={note.tone === "warn" ? "alert" : "status"}
          >
            <span>{note.text}</span>
            {note.undo && (
              <button
                className="text-button"
                onClick={() => {
                  const undo = note.undo!;
                  setNote(null);
                  undo();
                }}
              >
                Undo
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => setNote(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {gridMode && (
          <TeammatesLegend shown={mates.shown} onClear={mates.clear} />
        )}

        {mode === "month" && (
          <div className="month-layout">
            <MonthView
              items={monthItems}
              frames={frames}
              selected={date}
              onSelect={onDateChange}
              onOpenDay={openDay}
              onOpen={openKey}
            />
            <DayAgenda
              day={date}
              items={itemsForDay(monthItems, date)}
              onOpen={openKey}
            />
          </div>
        )}

        {(mode === "week" || mode === "day") && (
          <CalendarGrid
            days={gridDays}
            entries={entries}
            blocks={blocks}
            derived={derived}
            frames={frames}
            onFrame={(frame, anchor) =>
              setMenu({ kind: "frame", frame, anchor })
            }
            ghosts={ghosts}
            tunable={tuning && !tuner.pending}
            onPinGhost={(ghost, start, end) =>
              void tuner.pin(ghost, start, end)
            }
            onRemoveGhost={(ghost) => void tuner.remove(ghost)}
            keepFree={tuning ? (tuner.state?.keepFree ?? []) : []}
            onKeepFree={
              tuning
                ? (start, end) => void tuner.keepFree(start, end)
                : undefined
            }
            onRemoveKeepFree={(range) => void tuner.dropKeepFree(range)}
            zones={zones}
            onOpenDay={openDay}
            onEntry={(entry, anchor) =>
              setMenu({ kind: "entry", entry, anchor })
            }
            onBlock={(block, anchor) =>
              setMenu({ kind: "block", block, anchor })
            }
            onDropTask={(id, start) => {
              const item = itemMap.get(id);
              if (item) createBlock(item, start);
            }}
            onChangeBlock={changeBlock}
            onDuplicateBlock={(block, start) => void duplicate(block, start)}
            canDragEntry={canDragEntry}
            onChangeEntry={(entry, start, end, resized) =>
              void moveEntry(entry, start, end, resized)
            }
            onCreateRange={(start, end) =>
              onNewEvent({
                kind: "event",
                title: "",
                due_at: start.toISOString(),
                end_at: end.toISOString(),
              })
            }
            teammates={mates.shown}
            slot={slot}
            onSelectSlot={setSlot}
          />
        )}

        {mode === "agenda" && (
          <AgendaList
            days={agendaDays}
            entries={entries}
            blocks={blocks}
            onEntry={(entry, anchor) =>
              setMenu({ kind: "entry", entry, anchor })
            }
            onBlock={(block, anchor) =>
              setMenu({ kind: "block", block, anchor })
            }
          />
        )}
      </section>

      {showSide && (
        <div className="calendar-side">
          {plannerOpen && (
            <PlannerPanel
              prefs={prefs}
              teams={teams}
              plan={plan}
              tuner={tuner}
              onPlan={(p) => {
                setPlan(p);
                if (p && mode === "day" && p.days > 1) onModeChange("week");
              }}
              request={autoPreview}
              onChanged={changed}
              report={report}
              revision={revision}
              onClose={closePlanner}
            />
          )}
          <SchedulePanel
            items={items}
            onSchedule={(item) => setDialog({ kind: "schedule", item })}
          />
        </div>
      )}

      {menu?.kind === "entry" && (
        <EntryMenu
          entry={menu.entry}
          anchor={menu.anchor}
          canWrite={menuItem ? canWrite(menuItem) : true}
          canComplete={canComplete(menu.entry)}
          onClose={() => setMenu(null)}
          onOpen={() => withItem(menu.entry.item_id, onOpen)}
          onEditSeries={() => withItem(menu.entry.item_id, onEditItem)}
          onFocus={() => withItem(menu.entry.item_id, onFocus)}
          onComplete={() =>
            void complete(menu.entry.item_id, !!menu.entry.occurrence)
          }
          onSkip={() =>
            void mutate(async () => {
              await client.skipOccurrence(
                menu.entry.item_id,
                menu.entry.occurrence!,
              );
              await onChanged();
            })
          }
        />
      )}
      {menu?.kind === "block" && (
        <BlockMenu
          block={menu.block}
          anchor={menu.anchor}
          canWrite={menuBlockItem ? canWrite(menuBlockItem) : true}
          onClose={() => setMenu(null)}
          onOpen={() => withItem(menu.block.item_id, onOpen)}
          onFocus={() => withItem(menu.block.item_id, onFocus)}
          onComplete={() => void complete(menu.block.item_id)}
          onDuplicate={() => void duplicate(menu.block)}
          onChangeTime={() => setDialog({ kind: "move", block: menu.block })}
          onDelete={() => {
            if (
              window.confirm(
                `Delete this time block for “${menu.block.title}”?`,
              )
            )
              void mutate(() => client.deleteBlock(menu.block.id));
          }}
        />
      )}
      {matesMenu && (
        <TeammatesMenu
          anchor={matesMenu}
          teammates={mates}
          onClose={() => setMatesMenu(null)}
        />
      )}
      {menu?.kind === "frame" && (
        <FrameMenu
          frame={menu.frame}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onEdit={() =>
            setDialog({ kind: "frame", frameId: menu.frame.frame_id })
          }
          onSkip={() => void skipFrame(menu.frame)}
        />
      )}
      {dialog?.kind === "schedule" && (
        <BlockDialog
          heading="Set time aside"
          subject={dialog.item.title}
          start={nextQuarter(date)}
          minutes={Math.min(dialog.item.estimate_minutes ?? 30, 1440)}
          onClose={() => setDialog(null)}
          onSave={(start, end) => {
            createBlock(dialog.item, start, end);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "move" && (
        <BlockDialog
          heading="Change time"
          subject={dialog.block.title}
          start={new Date(dialog.block.start_at)}
          minutes={Math.round(
            (Date.parse(dialog.block.end_at) -
              Date.parse(dialog.block.start_at)) /
              60_000,
          )}
          onClose={() => setDialog(null)}
          onSave={(start, end) => {
            changeBlock(dialog.block, start, end);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "sets" && (
        <CalendarSetsDialog
          sets={sets}
          teams={teams}
          lists={planning.lists}
          onClose={() => setDialog(null)}
          onSave={async (next) => {
            await planning.savePrefs({ calendar_sets: next });
            if (setId && !next.some((s) => s.id === setId)) chooseSet("");
          }}
        />
      )}
      {dialog?.kind === "frame" && (
        <FrameDialog
          frameId={dialog.frameId}
          teams={teams}
          report={report}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            setNote({ text: "Frame saved." });
            void reload();
          }}
        />
      )}
    </div>
  );
}

/** The next quarter hour on `day` (today: from now; other days: 9 AM). */
function nextQuarter(day: Date) {
  const now = new Date();
  if (!sameDay(day, now))
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
  const d = new Date(now);
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
}
