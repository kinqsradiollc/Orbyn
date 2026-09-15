import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Layers,
  SlidersHorizontal,
  Wand2,
} from "lucide-react";
import {
  addMonths,
  monthGrid,
  sameDay,
  startOfDay,
  type CalendarEntry,
  type CalendarSet,
  type Item,
  type Plan,
  type Team,
  type TimeBlock,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { fromDayKey } from "../../lib/planning";
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
import { BlockMenu, EntryMenu } from "./CalendarMenus";
import { BlockDialog } from "./BlockDialog";
import { CalendarSetsDialog } from "./CalendarSets";
import { SchedulePanel } from "./SchedulePanel";
import { PlannerPanel } from "./PlannerPanel";
import { useCalendarData } from "./useCalendarData";
import { entryAsItem, inSet, itemIdOf } from "./model";
import "./calendar.css";

export type CalendarMode = "month" | "week" | "day" | "agenda";

/** A request from elsewhere (assistant, command bar) to show the planner. */
export type PlanRequest = {
  key: number;
  /** A plan to show and apply. */
  plan?: Plan;
  /** Preview a plan for this many days right away. */
  days?: number;
};

const MODES: { id: CalendarMode; label: string; key: string }[] = [
  { id: "month", label: "Month", key: "m" },
  { id: "week", label: "Week", key: "w" },
  { id: "day", label: "Day", key: "d" },
  { id: "agenda", label: "Agenda", key: "a" },
];
const AGENDA_DAYS = 14;
const SET_KEY = "orbyn-calendar-set";

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
};

/** Ignore shortcuts while typing or when a modifier is held. */
const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return (
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    !!el?.closest("input, textarea, select, [contenteditable='true']")
  );
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
  | null;
type Dialog =
  | { kind: "schedule"; item: Item }
  | { kind: "move"; block: TimeBlock }
  | { kind: "sets" }
  | null;

/**
 * Month / Week / Day / Agenda calendar on the calendar API, with calendar
 * sets, time blocks, the planner and a list of tasks to place. Shortcuts:
 * ← → move, T today, M/W/D/A switch views, P planner, 1–9 sets, 0 all.
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
  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // ---- the planner ----
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [autoPreview, setAutoPreview] = useState<{
    days?: number;
    key: number;
  } | null>(null);
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
      setAutoPreview({ days: planRequest.days, key: planRequest.key });
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

  const latest = useRef({
    step,
    onDateChange,
    onModeChange,
    togglePlanner,
    sets,
  });
  latest.current = { step, onDateChange, onModeChange, togglePlanner, sets };
  const blocked = !shortcuts || !!menu || !!dialog;
  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e)) return;
      const { step, onDateChange, onModeChange, togglePlanner, sets } =
        latest.current;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (key === "t") onDateChange(new Date());
      else if (key === "p") togglePlanner();
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

        {mode === "month" && (
          <div className="month-layout">
            <MonthView
              items={monthItems}
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
            ghosts={ghosts}
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
              plan={plan}
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
          onClose={() => setMenu(null)}
          onOpen={() => withItem(menu.entry.item_id, onOpen)}
          onEditSeries={() => withItem(menu.entry.item_id, onEditItem)}
          onFocus={() => withItem(menu.entry.item_id, onFocus)}
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
          onClose={() => setMenu(null)}
          onOpen={() => withItem(menu.block.item_id, onOpen)}
          onFocus={() => withItem(menu.block.item_id, onFocus)}
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
