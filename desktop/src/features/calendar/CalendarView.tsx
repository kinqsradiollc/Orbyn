import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useToast } from "../../components/Toast";
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
  isClosed,
  lateSessionWarning,
  monthGrid,
  sameDay,
  startOfDay,
  type CalendarEntry,
  type CalendarSet,
  type EditScope,
  type ExternalEntry,
  type FieldDate,
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
import { usePrefs } from "../../app/prefs";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { errorText, fromDayKey } from "../../lib/planning";
import { localDay } from "../../lib/drag";
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
import { BlockMenu, EntryMenu, ExternalMenu, FrameMenu } from "./CalendarMenus";
import { ScopeDialog, type OccurrenceRef } from "../../components/ScopeDialog";
import { BlockDialog } from "./BlockDialog";
import { CalendarSetsDialog } from "./CalendarSets";
import { FrameDialog } from "./FrameDialog";
import { SchedulePanel } from "./SchedulePanel";
import { PlannerPanel } from "./PlannerPanel";
import { useCalendarData } from "./useCalendarData";
import { usePlanTuning } from "./usePlanTuning";
import { TeammatesLegend, TeammatesMenu, useTeammates } from "./Teammates";
import {
  entryAsItem,
  entryKey,
  externalAsItem,
  externalKey,
  inSet,
  itemIdOf,
} from "./model";
import "./calendar.css";
import "./calendar-drag.css";
import "./calendar-events.css";

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
  /** Plan only these tasks ("Find time before the deadline"). */
  only?: string[];
  /** Plan up to this deadline, counting days in the planner's zone. */
  until?: string | null;
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
  /** Opens an item; on a repeating one, `occurrence` is the time clicked. */
  onOpen: (item: Item, occurrence?: OccurrenceRef) => void;
  /** Opens the item editor (to edit a whole series). */
  onEditItem: (item: Item, occurrence?: OccurrenceRef) => void;
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
  /**
   * Opens the page or project a date field is on (DATA-07: date fields
   * shown on the calendar as deadlines).
   */
  onOpenFieldTarget?: (target: FieldDate["target"], id: string) => void;
};

/** Where a date field's deadline comes from, kept in its entry's key. */
const FIELD_SOURCE = "field:";

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

/**
 * A date field's day as an all-day entry beside subscribed calendars: never
 * busy time, drawn in the accent, and opening its page or project.
 */
const fieldEntry = (d: FieldDate): ExternalEntry => {
  const [y, m, day] = d.date.split("-").map(Number);
  return {
    subscription_id: `${FIELD_SOURCE}${d.target}:${d.target_id}`,
    name: d.target === "page" ? "A page's date" : "A project's date",
    color: "var(--color-accent)",
    title: `${d.field_name} · ${d.title || "Untitled"}`,
    start_at: new Date(y, m - 1, day).toISOString(),
    end_at: new Date(y, m - 1, day + 1).toISOString(),
    all_day: true,
    location: "",
    busy: false,
  };
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
  | { kind: "external"; event: ExternalEntry; anchor: DOMRect }
  | null;
type Dialog =
  | { kind: "schedule"; item: Item }
  | { kind: "move"; block: TimeBlock }
  | { kind: "sets" }
  | { kind: "frame"; frameId: string }
  | null;
/**
 * A choice to make, under the toolbar ("Keep it", "Find time before").
 * Anything that only reports or offers Undo goes to the app's one toast.
 */
type Note = {
  text: string;
  tone?: "warn";
  actions: { label: string; run: () => void }[];
};

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** Which time of a repeating item an entry is, for opening or editing it. */
const occurrenceOf = (e: CalendarEntry): OccurrenceRef | undefined =>
  e.occurrence
    ? { occurrence: e.occurrence, start_at: e.start_at, end_at: e.end_at }
    : undefined;

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
  onOpenFieldTarget,
  onNewEvent,
  userId,
}: Props) {
  const { ask, tell } = useConfirm();
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
  // The set shown follows the account (SHR-08); this browser keeps a copy.
  const { viewChoice, setViewChoice } = usePrefs();
  const accountSet = viewChoice("calendar")?.set;
  useEffect(() => {
    if (accountSet !== undefined)
      setSetIdState(accountSet === "all" ? "" : accountSet);
  }, [accountSet]);
  const activeSet: CalendarSet | null =
    sets.find((s) => s.id === setId) ?? null;
  const chooseSet = (id: string) => {
    setSetIdState(id);
    setViewChoice("calendar", { set: id || "all" });
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
  // Date fields shown on the calendar as deadlines (DATA-07).
  const [fieldDates, setFieldDates] = useState<FieldDate[]>([]);
  const fromKey = dayKeyOf(range.from);
  const toKey = dayKeyOf(range.to);
  useEffect(() => {
    let live = true;
    client.fieldDates(fromKey, toKey).then(
      (dates) => live && setFieldDates(dates),
      () => live && setFieldDates([]),
    );
    return () => {
      live = false;
    };
  }, [fromKey, toKey, revision]);
  // A set picks subscribed calendars too; older sets show all of them.
  const external = [
    ...(data?.external ?? []).filter(
      (e) =>
        !activeSet?.subscription_ids ||
        activeSet.subscription_ids.includes(e.subscription_id),
    ),
    ...fieldDates.map(fieldEntry),
  ];
  /** An entry from a date field opens its page or project; others their details. */
  const showExternal = (event: ExternalEntry, anchor: DOMRect) => {
    if (event.subscription_id.startsWith(FIELD_SOURCE)) {
      const [target, id] = event.subscription_id
        .slice(FIELD_SOURCE.length)
        .split(":");
      onOpenFieldTarget?.(target as FieldDate["target"], id);
      return;
    }
    setMenu({ kind: "external", event, anchor });
  };
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

  // ---- notes: the app's one toast, with Undo where there is one ----
  const toast = useToast();

  // ---- the planner ----
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [autoPreview, setAutoPreview] = useState<{
    days?: number;
    include?: string[];
    only?: string[];
    until?: string | null;
    key: number;
  } | null>(null);
  const tuner = usePlanTuning(plan, setPlan, plannerOpen, data, report, items);
  const tuning = plannerOpen && !!plan && !plan.applied;
  const ghosts = plan && !plan.applied ? plan.blocks : [];
  const latestNav = useRef({ onDateChange, onModeChange, mode });
  latestNav.current = { onDateChange, onModeChange, mode };
  useEffect(() => {
    if (!planRequest) return;
    const { onDateChange, onModeChange, mode } = latestNav.current;
    setPlannerOpen(true);
    if (planRequest.plan) {
      setAutoPreview(null);
      setPlan(planRequest.plan);
      onDateChange(fromDayKey(planRequest.plan.starts_on));
      if (mode === "month" || mode === "agenda")
        onModeChange(planRequest.plan.days > 1 ? "week" : "day");
    } else {
      if (mode === "month" || mode === "agenda")
        onModeChange(
          (planRequest.days && planRequest.days > 1) || planRequest.until
            ? "week"
            : "day",
        );
      setAutoPreview({
        days: planRequest.days,
        include: planRequest.include,
        only: planRequest.only,
        until: planRequest.until,
        key: planRequest.key,
      });
    }
  }, [planRequest]);

  // ---- menus and dialogs ----
  const [menu, setMenu] = useState<Menu>(null);
  /** A late-session warning with its choices ("Keep it", "Find time before"). */
  const [note, setNote] = useState<Note | null>(null);
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

  /** "Moved to Wed 30 Sep, 4:00 pm." */
  const movedTo = (at: string) =>
    `${shortDay(at)}, ${new Date(at).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;

  /**
   * A session now ends after its task's deadline: say so, and offer to keep
   * it there or move it to free time before the deadline. Never refused.
   */
  const warnIfLate = (block: TimeBlock) => {
    const text = lateSessionWarning(block);
    if (!text) return;
    setNote({
      tone: "warn",
      text: `${text}.`,
      actions: [
        { label: "Keep it", run: () => setNote(null) },
        {
          label: "Find time before",
          run: () => void moveBeforeDeadline(block),
        },
      ],
    });
  };

  /** Move a session to the next free time that ends by its deadline. */
  const moveBeforeDeadline = async (block: TimeBlock) => {
    try {
      const moved = await client.rescheduleBlock(block.id, {
        before_deadline: true,
      });
      setNote(null);
      toast({
        text: `Moved to ${movedTo(moved.start_at)}, before the deadline.`,
        action: {
          label: "Undo",
          run: () =>
            void mutate(() =>
              client.updateBlock(block.id, {
                start_at: block.start_at,
                end_at: block.end_at,
              }),
            ),
        },
      });
    } catch (e) {
      if ((e as HttpError).status === 401) report(e);
      else toast({ tone: "warn", text: errorText(e) });
    }
    await reload();
  };

  const createBlock = (item: Item, start: Date, end?: Date) => {
    if (item.kind !== "task") return;
    const minutes = Math.min(item.estimate_minutes ?? 30, 1440);
    void mutate(async () =>
      warnIfLate(
        await client.createBlock({
          item_id: item.id,
          start_at: start.toISOString(),
          end_at: (
            end ?? new Date(start.getTime() + minutes * 60_000)
          ).toISOString(),
        }),
      ),
    );
  };

  /**
   * A task dropped on a whole day (ORG-06): a session at that day's first
   * free working time. A day with none says so, and the task stays put.
   */
  const planOnDay = (itemId: string, day: Date) => {
    const item = itemMap.get(itemId);
    if (!item || item.kind !== "task") return;
    void (async () => {
      try {
        const block = await client.createBlockOnDay({
          item_id: item.id,
          day: localDay(day),
        });
        if (lateSessionWarning(block)) warnIfLate(block);
        else
          toast({
            text: `Planned “${item.title}” for ${movedTo(block.start_at)}.`,
          });
      } catch (e) {
        toast({ tone: "warn", text: errorText(e) });
      }
      await reload();
    })();
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
    void mutate(async () =>
      warnIfLate(
        await client.updateBlock(block.id, {
          start_at: start.toISOString(),
          end_at: end.toISOString(),
        }),
      ),
    );
  };

  /**
   * A block moved to the next free working time of the same length, one
   * that ends by its deadline when there is one.
   */
  const reschedule = async (block: TimeBlock) => {
    try {
      const moved = await client.rescheduleBlock(block.id);
      if (lateSessionWarning(moved)) warnIfLate(moved);
      else toast({ text: `Moved to ${movedTo(moved.start_at)}.` });
    } catch (e) {
      report(e);
    }
    await reload();
  };
  /** Another block for the same task: at `start`, or the next free time. */
  const duplicate = async (block: TimeBlock, start?: Date) => {
    try {
      const copy = await client.duplicateBlock(
        block.id,
        start ? { start_at: start.toISOString() } : {},
      );
      if (lateSessionWarning(copy)) warnIfLate(copy);
      else if (!start) toast({ text: `Copied to ${movedTo(copy.start_at)}.` });
    } catch (e) {
      report(e);
    }
    await reload();
  };

  // ---- dragging events and timed tasks ----
  /** Not view-only ones; repeating ones ask which occurrences to move. */
  const canDragEntry = (e: CalendarEntry) => {
    const item = itemMap.get(e.item_id);
    return !item || canWrite(item);
  };
  /** A dragged repeating entry waiting for "this one / following / all". */
  const [scopeAsk, setScopeAsk] = useState<{
    entry: CalendarEntry;
    start: Date;
    end: Date;
    resized: boolean;
  } | null>(null);
  const [deadlineDrop, setDeadlineDrop] = useState<{
    entry: CalendarEntry;
    start: Date;
    end: Date;
  } | null>(null);
  const moveEntry = (
    entry: CalendarEntry,
    start: Date,
    end: Date,
    resized: boolean,
  ) => {
    if (entry.kind === "task" && !entry.end_at && !resized) {
      setDeadlineDrop({ entry, start, end });
      return;
    }
    if (entry.occurrence) setScopeAsk({ entry, start, end, resized });
    else void saveMove(entry, start, end, resized);
  };
  /** Save a dragged entry's new time; it shows there at once and goes back on failure. */
  const saveMove = async (
    entry: CalendarEntry,
    start: Date,
    end: Date,
    resized: boolean,
    scope?: EditScope,
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
      // "All" moves the whole series by the same amount; "this" and
      // "following" take the occurrence's new times.
      const whole = scope === "all" && !!item.due_at;
      const dueIso = whole
        ? new Date(
            Date.parse(item.due_at!) +
              (start.getTime() - Date.parse(entry.start_at)),
          ).toISOString()
        : startIso;
      const dueEnd =
        whole && endIso
          ? new Date(
              Date.parse(dueIso) + (end.getTime() - start.getTime()),
            ).toISOString()
          : endIso;
      await client.updateItem(
        item.id,
        {
          title: item.title,
          notes: item.notes ?? "",
          kind: item.kind,
          status: item.status,
          priority: item.priority,
          due_at: dueIso,
          end_at: dueEnd,
          team_id: item.team_id ?? null,
          version: item.version,
        },
        entry.occurrence && scope
          ? { scope, occurrence: entry.occurrence }
          : {},
      );
      await onChanged();
    } catch (e) {
      if ((e as HttpError).status === 401) report(e);
      else
        toast({
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
    } catch (e) {
      report(e);
    }
    await reload();
  };
  const skipFrame = async (f: FrameOccurrence) => {
    try {
      await client.skipFrame(f.frame_id, f.date);
      toast({
        text: `Skipped ${f.name} on ${shortDay(f.start_at)}.`,
        action: { label: "Undo", run: () => void unskipFrame(f) },
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
        toast({ text: `Done — next on ${dateLabel(next.due_at)}.` });
    } catch (e) {
      report(e);
    }
    await changed();
  };
  /** A cancelled task back to "to do". */
  const reopen = async (itemId: string) => {
    try {
      await client.postItemUpdate(itemId, { status: "todo" });
    } catch (e) {
      report(e);
    }
    await changed();
  };
  /** Open tasks you can change; for a repeating one, only its current occurrence. */
  const canComplete = (e: CalendarEntry) => {
    if (e.kind !== "task" || isClosed(e.status)) return false;
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
  const blocked =
    !shortcuts ||
    !!menu ||
    !!dialog ||
    !!matesMenu ||
    !!scopeAsk ||
    !!deadlineDrop;
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
  const shortTitle =
    mode === "day"
      ? date.toLocaleDateString([], {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : null;
  const unit =
    mode === "month"
      ? "month"
      : mode === "week"
        ? "week"
        : mode === "agenda"
          ? "two weeks"
          : "day";
  const monthItems = [
    ...entries.map((e) => entryAsItem(e, itemMap)),
    ...external.map(externalAsItem),
  ];
  const externalById = new Map(external.map((x) => [externalKey(x), x]));
  /** Open an item from the month grid or day list; external events show their details. */
  const openKey = (i: Item, anchor?: DOMRect) => {
    const x = externalById.get(i.id);
    if (!x) {
      const entry = entries.find((e) => entryKey(e) === i.id);
      return withItem(itemIdOf(i.id), (item) =>
        onOpen(item, entry && occurrenceOf(entry)),
      );
    }
    showExternal(
      x,
      anchor ?? new DOMRect(window.innerWidth / 2 - 150, 160, 300, 0),
    );
  };
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
            <h2 aria-live="polite">
              {/* A phone gets the short form of a long day title; screen
                  readers always hear the full one. */}
              <span className={shortTitle ? "cal-title-long" : undefined}>
                {title}
              </span>
              {shortTitle && (
                <span className="cal-title-short" aria-hidden="true">
                  {shortTitle}
                </span>
              )}
            </h2>
          </div>
          <div className="calendar-tools">
            <label className="set-picker">
              <Layers size={14} aria-hidden="true" />
              <span className="sr-only">Calendar set</span>
              <Select
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
              </Select>
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
            {note.actions.map((a) => (
              <button key={a.label} className="text-button" onClick={a.run}>
                {a.label}
              </button>
            ))}
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
              blocks={blocks}
              frames={frames}
              selected={date}
              onSelect={onDateChange}
              onOpenDay={openDay}
              onOpen={openKey}
              onDropTask={planOnDay}
            />
            <div className="month-side">
              <DayAgenda
                day={date}
                items={itemsForDay(monthItems, date)}
                onOpen={openKey}
              />
              {/* Tasks to drag onto a day, as beside the week. */}
              <SchedulePanel
                items={items}
                onSchedule={(item) => setDialog({ kind: "schedule", item })}
              />
            </div>
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
            onDropTaskOnDay={planOnDay}
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
            external={external}
            onExternal={showExternal}
            slot={slot}
            onSelectSlot={setSlot}
          />
        )}

        {mode === "agenda" && (
          <AgendaList
            days={agendaDays}
            external={external}
            onExternal={showExternal}
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
              items={items}
              teams={teams}
              plan={plan}
              tuner={tuner}
              onPlan={(p) => {
                setPlan(p);
                if (p && mode === "day" && p.days > 1) onModeChange("week");
              }}
              request={autoPreview}
              onChanged={changed}
              onShowDay={(at) => {
                onDateChange(new Date(at));
                if (mode === "agenda") onModeChange("week");
              }}
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
          onReopen={() => void reopen(menu.entry.item_id)}
          onClose={() => setMenu(null)}
          onOpen={() =>
            withItem(menu.entry.item_id, (item) =>
              onOpen(item, occurrenceOf(menu.entry)),
            )
          }
          onEditSeries={() => {
            const e = menu.entry;
            withItem(e.item_id, (item) =>
              onEditItem(
                item,
                e.occurrence
                  ? {
                      occurrence: e.occurrence,
                      start_at: e.start_at,
                      end_at: e.end_at,
                    }
                  : undefined,
              ),
            );
          }}
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
          onReschedule={() => void reschedule(menu.block)}
          onChangeTime={() => setDialog({ kind: "move", block: menu.block })}
          onFindTime={() => void moveBeforeDeadline(menu.block)}
          onDelete={async () => {
            if (
              await ask({
                title: `Delete this session for “${menu.block.title}”?`,
                confirmLabel: "Delete",
                destructive: true,
              })
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
      {menu?.kind === "external" && (
        <ExternalMenu
          event={menu.event}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
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
          heading="Plan a session"
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
      {scopeAsk && (
        <ScopeDialog
          kind={scopeAsk.entry.kind}
          action="move"
          onCancel={() => setScopeAsk(null)}
          onChoose={(scope) => {
            const a = scopeAsk;
            setScopeAsk(null);
            void saveMove(a.entry, a.start, a.end, a.resized, scope);
          }}
        />
      )}
      {deadlineDrop && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDeadlineDrop(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setDeadlineDrop(null);
          }}
        >
          <section
            className="modal modal-small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="deadline-drop-title"
          >
            <div className="section-heading">
              <h2 id="deadline-drop-title">{deadlineDrop.entry.title}</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel"
                onClick={() => setDeadlineDrop(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted modal-lead">
              What should happen at {deadlineDrop.start.toLocaleString()}?
            </p>
            <div className="scope-options">
              <button
                type="button"
                className="primary"
                autoFocus
                onClick={() => {
                  const drop = deadlineDrop;
                  setDeadlineDrop(null);
                  withItem(drop.entry.item_id, (item) =>
                    createBlock(item, drop.start),
                  );
                }}
              >
                Plan a session here
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const drop = deadlineDrop;
                  setDeadlineDrop(null);
                  if (drop.entry.occurrence)
                    setScopeAsk({ ...drop, resized: false });
                  else void saveMove(drop.entry, drop.start, drop.end, false);
                }}
              >
                Move the deadline to{" "}
                {deadlineDrop.start.toLocaleString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setDeadlineDrop(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
      {dialog?.kind === "frame" && (
        <FrameDialog
          frameId={dialog.frameId}
          onDeleted={() => {
            setDialog(null);
            toast({ text: "Frame deleted." });
            void reload();
          }}
          teams={teams}
          report={report}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            toast({ text: "Frame saved." });
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
