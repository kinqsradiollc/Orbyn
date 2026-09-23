import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  addMonths,
  byDueDate,
  dateLabel,
  describeRrule,
  emptyDay,
  itemBody,
  itemsOnDay,
  monthGrid,
  sameDay,
  type BusyInterval,
  type CalendarEntry,
  type CalendarSet,
  type CalendarView,
  type ExternalEntry,
  type Frame,
  type FrameOccurrence,
  type Item,
  type Plan,
  type PlannedBlock,
  type PlannerPrefs,
  type Team,
  type TimeBlock,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { celebrate } from "../components/Celebration";
import { Chip, ChipRow } from "../components/Chip";
import { ClockField, DateField, Field } from "../components/Field";
import {
  PlannerList,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
import { Icon } from "../components/Icon";
import { ReviewCard } from "../components/ReviewCard";
import { Segmented } from "../components/Segmented";
import { SlotFill, type SlotHandle } from "../components/Slot";
import { SmallAction } from "../components/SmallAction";
import { useNow } from "../hooks/useNow";
import { usePlanStale } from "../hooks/usePlanStale";
import { client } from "../lib/api";
import * as outbox from "../lib/outbox";
import { readLocal, saveLocal } from "../lib/localPrefs";
import {
  canJoin,
  clockLabel,
  rangeLabel,
  shortDay,
  slotLabel,
} from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import {
  isConflict,
  pinBlock,
  remakePlan,
  removeBlock,
  setKeepFree,
  unpinBlock,
} from "../lib/plans";
import { askScope, seriesTimes, type OccurrenceRef } from "../lib/scope";
import { FadeIn, PressableScale, animateLayout } from "../motion";
import { colors, fonts, radii, statusTones, themed } from "../theme";
import { shared } from "../styles";
import { ActionMenu, type Menu, type MenuAction } from "./calendar/ActionMenu";
import { AgendaList } from "./calendar/AgendaList";
import { CalendarSetsSheet } from "./calendar/CalendarSetsSheet";
import {
  DAY_END,
  DAY_START,
  addDays,
  covers,
  rangeTitle,
  startOfDay,
  startOfWeek,
  weekDays,
} from "./calendar/dates";
import {
  DayTimeline,
  gutterWidth,
  hoursFor,
  type TimelineSlot,
} from "./calendar/DayTimeline";
import { FrameSheet } from "./calendar/FrameSheet";
import type { MonthThing } from "./calendar/month";
import { MonthView } from "./calendar/MonthView";
import { MoveBlockSheet } from "./calendar/MoveBlockSheet";
import { SearchSheet } from "./calendar/SearchSheet";
import { TasksToPlaceSheet } from "./calendar/TasksToPlaceSheet";
import { useTeammates } from "./calendar/teammates";
import { TeammatesSheet } from "./calendar/TeammatesSheet";
import { WeekStrip } from "./calendar/WeekStrip";
import { PlanSheet } from "./PlanSheet";

const MODES = ["day", "week", "month", "agenda"] as const;
type Mode = (typeof MODES)[number];
const MODE_LABELS: Record<Mode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
};
type Act = (fn: () => Promise<void>) => Promise<void>;

/** The calendar set last shown on this device ("" for everything). */
const SET_KEY = "orbyn-calendar-set";
/** The view last shown on this device. */
const MODE_KEY = "orbyn-calendar-mode";
/** How long "Frame skipped · Undo" and other notes stay up. */
const UNDO_MS = 10_000;
/** Days the agenda lists. */
const AGENDA_DAYS = 14;
/** Days side by side on a wide screen, and the width that allows them. */
const GRID_DAYS = 3;
const GRID_WIDTH = 700;

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const atClock = (day: string, clock: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = clock.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
};

/** An item as a calendar entry, for when the calendar view isn't loaded. */
const entryFromItem = (i: Item): CalendarEntry => ({
  item_id: i.id,
  title: i.title,
  kind: i.kind,
  status: i.status,
  priority: i.priority,
  start_at: i.due_at ?? new Date().toISOString(),
  end_at: i.end_at,
  team_id: i.team_id,
  team_name: i.team_name ?? null,
  list_id: i.list_id ?? null,
  location: i.location ?? "",
  meeting_url: i.meeting_url ?? "",
  occurrence: null,
  rrule: i.rrule ?? null,
  version: i.version,
  all_day: i.all_day,
  busy: i.busy,
  color: i.color ?? null,
});

/** Whether a calendar set shows something; no set shows everything (as on the web). */
function inSet(
  set: CalendarSet | null,
  x: { team_id: string | null; list_id: string | null },
) {
  if (!set) return true;
  const place = x.team_id ? set.team_ids.includes(x.team_id) : set.personal;
  const list =
    !set.list_ids.length || (!!x.list_id && set.list_ids.includes(x.list_id));
  return place && list;
}

/**
 * The calendar: a day, a week strip, the month grid or a two-week agenda,
 * then (except in the agenda) the selected day as an hour-by-hour timeline
 * and a list of its plans. Everything comes from the calendar view:
 * repeating items as occurrences, time blocks, frames, subscribed calendars,
 * and buffers and travel around events. A calendar set narrows what shows;
 * extra time zones label the hours; chosen teammates' busy times show as
 * strips. A plan preview shows as faint blocks that can be moved (pinned),
 * unpinned or removed, with times kept free, until it's applied.
 */
export function CalendarScreen({
  items,
  teams,
  act,
  onChanged,
  preview,
  onPreviewChange,
  onPreviewDone,
  onDragging,
  onOpenOccurrence,
  onFocus,
  onScrollTo,
  controlsSlot,
  ...handlers
}: ListHandlers & {
  /** The page's sticky header: the date navigation and view switch go there. */
  controlsSlot?: SlotHandle;
  items: Item[];
  /** For the frame editor's team filter, sets and teammates. */
  teams: Team[];
  act: Act;
  /** Refresh the planner after a change that moves an item (skipping). */
  onChanged: () => void;
  /** A plan to preview on the timeline (not saved yet). */
  preview: Plan | null;
  /** The preview was tuned or remade: this plan replaces it. */
  onPreviewChange: (plan: Plan) => void;
  /** The preview was applied or discarded. */
  onPreviewDone: () => void;
  /** True while a block is being dragged, so the page holds still. */
  onDragging: (active: boolean) => void;
  /** Open an item, on the occurrence it was tapped on when it repeats. */
  onOpenOccurrence: (item: Item, occurrence: OccurrenceRef | null) => void;
  /** Start a focus session on a task; "Start focus" shows when given. */
  onFocus?: (item: Item) => void;
  /** Scroll the page to `y` below the top of `view` (the timeline asks once per day or view). */
  onScrollTo?: (
    view: React.ComponentRef<typeof View> | null,
    y: number,
  ) => void;
}) {
  const { listById } = usePlanning();
  const [mode, setModeState] = useState<Mode>(() => {
    const saved = readLocal(MODE_KEY);
    return MODES.find((m) => m === saved) ?? "day";
  });
  const navigation = useRef<View>(null);
  const scrollPage = useRef(onScrollTo);
  scrollPage.current = onScrollTo;
  // A month or week selection starts at its date picker, not halfway down
  // the day's timeline. Only the dedicated Day view jumps to the current hour.
  useEffect(() => {
    if (mode === "day") return;
    const frame = requestAnimationFrame(() =>
      scrollPage.current?.(navigation.current, 0),
    );
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<{
    key: string;
    data: CalendarView;
  } | null>(null);
  const [prefs, setPrefs] = useState<PlannerPrefs | null>(null);
  const [setId, setSetId] = useState(() => readLocal(SET_KEY) ?? "");
  /** The block in the "Move to…" sheet. */
  const [moving, setMoving] = useState<TimeBlock | null>(null);
  /** The block in the "Duplicate to…" sheet. */
  const [duplicating, setDuplicating] = useState<TimeBlock | null>(null);
  /** The event or task in the "Move to…" sheet. */
  const [movingEntry, setMovingEntry] = useState<CalendarEntry | null>(null);
  /** The "Find an event" sheet is open. */
  const [searching, setSearching] = useState(false);
  /** The frame in the frame editor. */
  const [editingFrame, setEditingFrame] = useState<Frame | null>(null);
  /** The frame day just skipped, for Undo. */
  const [skipped, setSkipped] = useState<FrameOccurrence | null>(null);
  /** A short message after an action ("Done. Next on …"). */
  const [note, setNote] = useState("");
  /** Options for whatever was held. */
  const [menu, setMenu] = useState<Menu | null>(null);
  /** Tasks to place, calendar sets or teammates. */
  const [panel, setPanel] = useState<null | "tasks" | "sets" | "mates">(null);
  /** Plan my day, fresh or on the current preview. */
  const [planning, setPlanning] = useState<{ seed: Plan | null } | null>(null);
  /** A time to keep free in the preview, being added. */
  const [keepForm, setKeepForm] = useState<{
    day: string;
    from: string;
    to: string;
  } | null>(null);
  /** Bumped after a block or occurrence changes, to reload the range. */
  const [version, setVersion] = useState(0);
  /** Plans this screen made by tuning the preview (they don't jump days). */
  const tuned = useRef(new Set<string>());
  const now = useNow(30_000);
  // Tablets and landscape: three days side by side in the day and week views.
  const { width } = useWindowDimensions();
  const multi = width >= GRID_WIDTH && (mode === "day" || mode === "week");
  /** "Show all 24 hours" for the days side by side (they share one window). */
  const [gridAllHours, setGridAllHours] = useState(false);

  // The range shown: the week (for the strip), the month grid, or the agenda.
  const range = (() => {
    if (mode === "month") {
      const grid = monthGrid(month);
      return {
        from: grid[0][0],
        to: addDays(grid[grid.length - 1][6], 1),
      };
    }
    if (mode === "agenda") {
      const from = startOfDay(selected);
      return { from, to: addDays(from, AGENDA_DAYS) };
    }
    const from = startOfWeek(selected);
    const to = addDays(from, 7);
    // Three days side by side can run past the end of the week.
    const gridEnd = addDays(startOfDay(selected), GRID_DAYS);
    return { from, to: multi && gridEnd > to ? gridEnd : to };
  })();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const rangeKey = `${fromIso}/${toIso}`;

  // One request per range, and again only when the planner's items actually
  // change (unchanged polls keep the same array) or after an edit.
  useEffect(() => {
    let alive = true;
    client
      .calendar(fromIso, toIso)
      .then((data) => alive && setView({ key: `${fromIso}/${toIso}`, data }))
      .catch(() => {
        // Older servers have no calendar view; the items below still show.
      });
    return () => {
      alive = false;
    };
  }, [fromIso, toIso, items, version]);
  const cal = view && view.key === rangeKey ? view.data : null;
  // Checked when a preview arrives and after every calendar reload.
  const [stale, markStale] = usePlanStale(preview, cal);

  // Calendar sets, pins and extra time zones live in the planning settings.
  useEffect(() => {
    let alive = true;
    client
      .getPlannerPrefs()
      .then((p) => alive && setPrefs(p))
      .catch(() => {
        // Without settings the calendar shows everything in local time.
      });
    return () => {
      alive = false;
    };
  }, [version, items]);

  const teammates = useTeammates(
    teams,
    prefs?.pinned_user_ids ?? [],
    fromIso,
    toIso,
    cal,
  );

  // A new preview (not one tuned here) jumps to its first planned day.
  const previewId = preview?.id;
  useEffect(() => {
    if (!preview?.blocks.length || tuned.current.has(preview.id)) return;
    const first = new Date(
      Math.min(...preview.blocks.map((b) => Date.parse(b.start_at))),
    );
    setSelected(first);
    setMonth(first);
    // Only when a different plan arrives, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewId]);

  useEffect(() => {
    if (!skipped) return;
    const timer = setTimeout(() => setSkipped(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [skipped]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(""), UNDO_MS);
    return () => clearTimeout(timer);
  }, [note]);
  const showNote = (text: string) => {
    animateLayout();
    setNote(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  const sets = prefs?.calendar_sets ?? [];
  const activeSet = sets.find((set) => set.id === setId) ?? null;
  const chooseSet = (id: string) => {
    animateLayout();
    setSetId(id);
    saveLocal(SET_KEY, id);
  };
  const zones = (prefs?.extra_timezones ?? []).slice(0, 3);
  const listColor = (id: string | null) =>
    id ? listById.get(id)?.color : undefined;

  const shownItems = items.filter((i) =>
    inSet(activeSet, { team_id: i.team_id, list_id: i.list_id ?? null }),
  );
  const dayItems = itemsOnDay(shownItems, selected).sort(byDueDate);
  const entries = (cal?.entries ?? []).filter((e) => inSet(activeSet, e));
  const blocks = (cal?.blocks ?? []).filter((b) => inSet(activeSet, b));
  // A set picks subscribed calendars too; older sets show all of them.
  const external = (cal?.external ?? []).filter(
    (x) =>
      !activeSet?.subscription_ids ||
      activeSet.subscription_ids.includes(x.subscription_id),
  );
  const shownIds = new Set(entries.map((e) => e.item_id));
  const live = !!preview && !preview.applied;
  const allGhosts = live ? preview.blocks : [];
  const keepFree = live ? (preview.options?.keep_free ?? []) : [];

  /** What one day's timeline shows, including what runs into it. */
  const timelineFor = (day: Date) => {
    const dayEntries = cal
      ? entries.filter((e) => covers(e, day))
      : itemsOnDay(shownItems, day).sort(byDueDate).map(entryFromItem);
    const dayExternal = external.filter((x) => covers(x, day));
    const slots: TimelineSlot[] = [
      ...dayEntries.map((entry): TimelineSlot => ({
        type: "entry",
        key: `entry-${entry.item_id}-${entry.occurrence ?? entry.start_at}`,
        start: new Date(entry.start_at),
        end: entry.end_at ? new Date(entry.end_at) : null,
        kind: entry.kind,
        allDay: !!entry.all_day,
        entry,
      })),
      ...dayExternal.map((x, n): TimelineSlot => ({
        type: "external",
        key: `external-${x.subscription_id}-${x.start_at}-${n}`,
        start: new Date(x.start_at),
        end: new Date(x.end_at),
        kind: "event",
        allDay: x.all_day,
        external: x,
      })),
      ...blocks
        .filter((b) => covers(b, day))
        .map((block): TimelineSlot => ({
          type: "block",
          key: `block-${block.id}`,
          start: new Date(block.start_at),
          end: new Date(block.end_at),
          kind: "task",
          block,
        })),
    ];
    return {
      day,
      dayEntries,
      dayExternal,
      slots,
      derived: (cal?.derived ?? []).filter(
        (d) => shownIds.has(d.item_id) && covers(d, day),
      ),
      frames: (cal?.frames ?? []).filter((f) => covers(f, day)),
      ghosts: allGhosts.filter((b) => covers(b, day)),
    };
  };
  const { dayEntries, dayExternal } = timelineFor(selected);
  // One column, or three days side by side sharing one window of hours.
  const columns = (
    multi
      ? Array.from({ length: GRID_DAYS }, (_, n) =>
          addDays(startOfDay(selected), n),
        )
      : [selected]
  ).map(timelineFor);
  const gridFits = multi
    ? columns
        .map((c) => hoursFor({ ...c, keepFree, now }))
        .reduce((a, b) => ({
          start: Math.min(a.start, b.start),
          end: Math.max(a.end, b.end),
        }))
    : null;
  const gridHours = gridFits
    ? gridAllHours
      ? { start: DAY_START, end: DAY_END }
      : gridFits
    : undefined;
  const joinable = entries.filter((e) => canJoin(e, now));

  const plansOn = (day: Date) =>
    cal
      ? [
          ...entries
            .filter((e) => covers(e, day))
            .map((e) => ({
              key: `${e.item_id}-${e.start_at}`,
              status: e.status,
              color: e.color || undefined,
            })),
          // Subscribed events show as plain dots.
          ...external
            .filter((x) => covers(x, day))
            .map((x, n) => ({
              key: `external-${x.subscription_id}-${x.start_at}-${n}`,
              status: "todo" as const,
            })),
          ...blocks
            .filter((b) => covers(b, day))
            .map((b) => ({
              key: `block-${b.id}`,
              status: b.status,
              color: listColor(b.list_id) ?? colors.accent,
            })),
          ...allGhosts
            .filter((g) => covers(g, day))
            .map((g) => ({
              key: `ghost-${g.item_id}-${g.start_at}`,
              status: "todo" as const,
              color: colors.accent,
            })),
        ]
      : itemsOnDay(shownItems, day).map((i) => ({
          key: i.id,
          status: i.status,
        }));

  const monthThings: MonthThing[] = [
    ...entries.map((e): MonthThing => ({
      key: `e-${e.item_id}-${e.start_at}`,
      title: e.title,
      start: new Date(e.start_at),
      end: e.end_at ? new Date(e.end_at) : null,
      color: e.color || listColor(e.list_id) || statusTones[e.status].fg,
      look: e.status === "done" ? "done" : "entry",
    })),
    ...external.map((x, n): MonthThing => ({
      key: `x-${x.subscription_id}-${x.start_at}-${n}`,
      title: x.title,
      start: new Date(x.start_at),
      end: new Date(x.end_at),
      color: x.color,
      look: "external",
    })),
    ...blocks.map((b): MonthThing => ({
      key: `b-${b.id}`,
      title: b.title,
      start: new Date(b.start_at),
      end: new Date(b.end_at),
      color: listColor(b.list_id) ?? colors.accent,
      look: "block",
    })),
    ...allGhosts.map((g): MonthThing => ({
      key: `g-${g.item_id}-${g.start_at}`,
      title: g.title,
      start: new Date(g.start_at),
      end: new Date(g.end_at),
      color: colors.accent,
      look: "ghost",
    })),
  ];

  const openItem = (itemId: string, entry?: CalendarEntry) => {
    const occurrence: OccurrenceRef | null = entry?.occurrence
      ? {
          itemId,
          occurrence: entry.occurrence,
          start: entry.start_at,
          end: entry.end_at,
        }
      : null;
    const item = items.find((i) => i.id === itemId);
    if (item) onOpenOccurrence(item, occurrence);
    else
      void act(async () =>
        onOpenOccurrence(await client.getItem(itemId), occurrence),
      );
  };
  /** The saved item behind an entry. */
  const itemFor = async (itemId: string) =>
    items.find((i) => i.id === itemId) ?? (await client.getItem(itemId));
  const assertEditable = (item: Item) => {
    if (handlers.canToggle && !handlers.canToggle(item))
      throw new Error("You can view this team’s items but not change them.");
  };
  const canEdit = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    return !item || !handlers.canToggle || handlers.canToggle(item);
  };
  const reload = () => setVersion((v) => v + 1);
  const select = (day: Date) => {
    setSelected(day);
    if (day.getMonth() !== month.getMonth()) setMonth(day);
  };
  const startFocus = (itemId: string) => {
    if (onFocus) void act(async () => onFocus(await itemFor(itemId)));
  };
  const join = (e: CalendarEntry) =>
    void Linking.openURL(e.meeting_url).catch(() =>
      Alert.alert("That meeting link couldn’t be opened."),
    );

  /** Save a block's new times; it shows there at once and the reload confirms. */
  const saveBlock = (block: TimeBlock, start: Date, end: Date) => {
    const start_at = start.toISOString();
    const end_at = end.toISOString();
    setView(
      (v) =>
        v && {
          ...v,
          data: {
            ...v.data,
            blocks: v.data.blocks.map((b) =>
              b.id === block.id ? { ...b, start_at, end_at } : b,
            ),
          },
        },
    );
    // Dragged to another day: follow it there.
    if (!sameDay(start, selected)) select(start);
    void act(async () => {
      try {
        await client.updateBlock(block.id, { start_at, end_at });
        AccessibilityInfo.announceForAccessibility(
          `${block.title} moved to ${slotLabel(start_at, end_at)}`,
        );
      } finally {
        // On an error this puts the block back where it was.
        reload();
      }
    });
  };

  /** Finish a task; a repeating one moves on to its next occurrence. */
  const markDone = (itemId: string, title: string, repeats: boolean) =>
    act(async () => {
      const item = await itemFor(itemId);
      assertEditable(item);
      const sent = await outbox.postItemUpdate(item, { status: "done" });
      celebrate(title);
      if (sent && repeats && item.rrule) {
        const next = await client.getItem(item.id).catch(() => null);
        if (next?.due_at && next.status !== "done")
          showNote(`Done. Next on ${dateLabel(next.due_at)}.`);
      }
      reload();
      onChanged();
    });

  /**
   * Leave one occurrence of a repeating item out, without touching the rest
   * of the series or the item itself.
   */
  const skipOne = (itemId: string, occurrence: string, title: string) =>
    act(async () => {
      const item = await itemFor(itemId);
      assertEditable(item);
      await client.skipOccurrence(itemId, occurrence);
      showNote(`Skipped this one. “${title}” still repeats.`);
      reload();
      onChanged();
    });

  const blockMenu = (block: TimeBlock) => {
    const open = block.status !== "done";
    const actions: MenuAction[] = [
      {
        label: "Open task",
        icon: "arrowRight",
        run: () => openItem(block.item_id),
      },
    ];
    if (open && canEdit(block.item_id))
      actions.push({
        label: "Mark task done",
        icon: "check",
        run: () => void markDone(block.item_id, block.title, false),
      });
    if (open && onFocus)
      actions.push({
        label: "Start focus",
        icon: "play",
        run: () => startFocus(block.item_id),
      });
    actions.push(
      { label: "Move to…", icon: "clock", run: () => setMoving(block) },
      {
        label: "Move to next free time",
        icon: "arrowRight",
        run: () =>
          void act(async () => {
            const moved = await client.rescheduleBlock(block.id);
            showNote(
              `${block.title} moved to ${slotLabel(moved.start_at, moved.end_at)}.`,
            );
            reload();
          }),
      },
    );
    if (open)
      actions.push(
        {
          label: "Duplicate to next free time",
          icon: "plus",
          run: () =>
            void act(async () => {
              const copy = await client.duplicateBlock(block.id);
              reload();
              showNote(
                `Another block for ${block.title} added at ${slotLabel(copy.start_at, copy.end_at)}.`,
              );
            }),
        },
        {
          label: "Duplicate to…",
          icon: "calendar",
          run: () => setDuplicating(block),
        },
      );
    actions.push({
      label: "Delete block",
      icon: "trash",
      destructive: true,
      run: () =>
        void act(async () => {
          await client.deleteBlock(block.id);
          reload();
        }),
    });
    setMenu({
      title: block.title,
      detail: `${slotLabel(block.start_at, block.end_at)} · time set aside`,
      actions,
    });
  };

  /**
   * Move an event or task to new times (drag, resize or Move to…). It shows
   * there at once; a repeating one asks which occurrences first, and the
   * reload confirms it or puts it back.
   */
  const moveEntry = (entry: CalendarEntry, start: Date, end: Date | null) => {
    const start_at = start.toISOString();
    const end_at = end ? end.toISOString() : null;
    const same = (e: CalendarEntry) =>
      e.item_id === entry.item_id && e.start_at === entry.start_at;
    setView(
      (v) =>
        v && {
          ...v,
          data: {
            ...v.data,
            entries: v.data.entries.map((e) =>
              same(e) ? { ...e, start_at, end_at } : e,
            ),
          },
        },
    );
    if (!sameDay(start, selected)) select(start);
    return act(async () => {
      try {
        const item = await itemFor(entry.item_id);
        assertEditable(item);
        const { progress: _progress, ...body } = itemBody(item);
        if (entry.occurrence && item.rrule) {
          const scope = await askScope(item.kind, "move");
          if (!scope) return;
          const times =
            scope === "all"
              ? seriesTimes(
                  item,
                  { start: entry.start_at, end: entry.end_at },
                  { start: start_at, end: end_at },
                )
              : { due_at: start_at, end_at };
          await outbox.updateItem(
            item,
            { ...body, ...times },
            { scope, occurrence: entry.occurrence },
          );
        } else
          await outbox.updateItem(item, {
            ...body,
            due_at: start_at,
            end_at,
          });
        AccessibilityInfo.announceForAccessibility(
          `${entry.title} moved to ${end_at ? slotLabel(start_at, end_at) : shortDay(start_at)}`,
        );
        onChanged();
      } finally {
        // Confirms the move, or puts it back after a cancel or an error.
        reload();
      }
    });
  };
  /** Delete an entry's item; a repeating one asks which occurrences go. */
  const deleteEntry = (entry: CalendarEntry) =>
    act(async () => {
      const item = await itemFor(entry.item_id);
      assertEditable(item);
      if (entry.occurrence && item.rrule) {
        const scope = await askScope(item.kind, "delete");
        if (!scope) return;
        await outbox.deleteItem(item, {
          scope,
          occurrence: entry.occurrence,
        });
      } else {
        const sure = await new Promise<boolean>((resolve) =>
          Alert.alert(
            `Delete ${entry.title}?`,
            "This removes it from your planner.",
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => resolve(false),
              },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => resolve(true),
              },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          ),
        );
        if (!sure) return;
        await outbox.deleteItem(item);
      }
      reload();
      onChanged();
    });
  const entryMenu = (entry: CalendarEntry) => {
    const when = entry.all_day
      ? "all day"
      : entry.end_at
        ? rangeLabel(entry.start_at, entry.end_at)
        : clockLabel(entry.start_at);
    const repeats = entry.occurrence
      ? ` · ${describeRrule(entry.rrule) || "Repeats"}`
      : "";
    const editable = canEdit(entry.item_id);
    const open = entry.kind === "task" && entry.status !== "done";
    const actions: MenuAction[] = [
      {
        label: entry.kind === "event" ? "Open event" : "Open task",
        icon: "arrowRight",
        run: () => openItem(entry.item_id, entry),
      },
    ];
    if (open && editable)
      actions.push({
        label: entry.occurrence ? "Mark this one done" : "Mark done",
        icon: "check",
        run: () =>
          void markDone(entry.item_id, entry.title, !!entry.occurrence),
      });
    if (open && onFocus)
      actions.push({
        label: "Start focus",
        icon: "play",
        run: () => startFocus(entry.item_id),
      });
    // Only a repeating item has an occurrence to leave out.
    if (entry.occurrence && editable)
      actions.push({
        label: "Skip this one",
        icon: "chevronRight",
        run: () => void skipOne(entry.item_id, entry.occurrence!, entry.title),
      });
    if (entry.meeting_url && canJoin(entry, now))
      actions.push({ label: "Join", icon: "video", run: () => join(entry) });
    if (!entry.all_day && editable)
      actions.push({
        label: "Move to…",
        icon: "clock",
        run: () => setMovingEntry(entry),
      });
    if (editable)
      actions.push({
        label: entry.occurrence ? "Delete…" : "Delete",
        icon: "trash",
        destructive: true,
        run: () => void deleteEntry(entry),
      });
    setMenu({
      title: entry.title,
      detail: `${shortDay(entry.start_at)}, ${when}${repeats}`,
      actions,
    });
  };
  /** An event from a subscribed calendar: details only, it can't change here. */
  const showExternal = (x: ExternalEntry) =>
    Alert.alert(
      x.title,
      [
        x.all_day
          ? `${shortDay(x.start_at)}, all day`
          : slotLabel(x.start_at, x.end_at),
        x.location,
        `From ${x.name}. Change it in the calendar it comes from.`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  const frameMenu = (f: FrameOccurrence) =>
    setMenu({
      title: f.name,
      detail: `${shortDay(f.start_at)}, ${rangeLabel(f.start_at, f.end_at)}${f.busy ? " · Busy" : ""}`,
      actions: [
        {
          label: "Edit frame",
          icon: "settings",
          run: () =>
            void act(async () => {
              const frame = (await client.listFrames()).find(
                (x) => x.id === f.frame_id,
              );
              if (frame) setEditingFrame(frame);
            }),
        },
        {
          label: "Skip this day",
          icon: "x",
          run: () =>
            void act(async () => {
              await client.skipFrame(f.frame_id, f.date);
              animateLayout();
              setSkipped(f);
              reload();
            }),
        },
      ],
    });
  const undoSkip = () =>
    act(async () => {
      if (!skipped) return;
      await client.unskipFrame(skipped.frame_id, skipped.date);
      animateLayout();
      setSkipped(null);
      reload();
    });

  // ---- the preview ----
  /** Change the preview; the plan that comes back replaces it in place. */
  const tunePreview = (change: (plan: Plan) => Promise<Plan>) =>
    act(async () => {
      if (!preview) return;
      let next: Plan;
      try {
        next = await change(preview);
      } catch (e) {
        // Expired or replaced: show it's stale, with Refresh.
        if (isConflict(e)) return markStale();
        throw e;
      }
      tuned.current.add(next.id);
      animateLayout();
      onPreviewChange(next);
    });
  const ghostMenu = (g: PlannedBlock) => {
    const actions: MenuAction[] = [
      {
        label: "Open task",
        icon: "arrowRight",
        run: () => openItem(g.item_id),
      },
    ];
    if (g.pinned)
      actions.push({
        label: "Unpin",
        icon: "pin",
        run: () => void tunePreview((p) => unpinBlock(p, g)),
      });
    actions.push({
      label: "Remove from the plan",
      icon: "trash",
      destructive: true,
      run: () => void tunePreview((p) => removeBlock(p, g)),
    });
    setMenu({
      title: g.title,
      detail: `${slotLabel(g.start_at, g.end_at)} · planned, not saved yet${g.pinned ? " · pinned" : ""}`,
      actions,
    });
  };
  const pinGhost = (g: PlannedBlock, start: Date, end: Date) => {
    if (!preview) return;
    // Show it where it was dropped while the plan is made again around it.
    tuned.current.add(preview.id);
    onPreviewChange({
      ...preview,
      blocks: preview.blocks.map((b) =>
        b === g
          ? {
              ...b,
              start_at: start.toISOString(),
              end_at: end.toISOString(),
              pinned: true,
            }
          : b,
      ),
    });
    if (!sameDay(start, selected)) select(start);
    void tunePreview(() => pinBlock(preview, g, start, end));
  };
  const keepFreeMenu = (r: BusyInterval) =>
    setMenu({
      title: "Kept free",
      detail: `${slotLabel(r.start_at, r.end_at)} · the plan leaves this time empty`,
      actions: [
        {
          label: "Stop keeping it free",
          icon: "trash",
          destructive: true,
          run: () =>
            void tunePreview((p) =>
              setKeepFree(
                p,
                (p.options?.keep_free ?? []).filter(
                  (x) =>
                    Date.parse(x.start_at) !== Date.parse(r.start_at) ||
                    Date.parse(x.end_at) !== Date.parse(r.end_at),
                ),
              ),
            ),
        },
      ],
    });
  const addKeepFree = () => {
    if (!keepForm) return;
    const start = atClock(keepForm.day, keepForm.from);
    const end = atClock(keepForm.day, keepForm.to);
    if (end <= start) {
      Alert.alert("A time to keep free ends after it starts.");
      return;
    }
    void tunePreview((p) =>
      setKeepFree(p, [
        ...(p.options?.keep_free ?? []),
        { start_at: start.toISOString(), end_at: end.toISOString() },
      ]),
    ).then(() => setKeepForm(null));
  };
  /** A range drawn on empty time in the timeline (hold, then drag). */
  const keepRange = (start: Date, end: Date) => {
    if (keepFree.length >= 20) return;
    void tunePreview((p) =>
      setKeepFree(p, [
        ...(p.options?.keep_free ?? []),
        { start_at: start.toISOString(), end_at: end.toISOString() },
      ]),
    ).then(() =>
      AccessibilityInfo.announceForAccessibility(
        `Keeping ${slotLabel(start.toISOString(), end.toISOString())} free`,
      ),
    );
  };
  const applyPreview = () =>
    act(async () => {
      if (!preview) return;
      const result = await client.applyPlan(preview.id);
      onPreviewDone();
      reload();
      onChanged();
      const n = result.blocks.length;
      AccessibilityInfo.announceForAccessibility(
        `Plan saved. ${n} block${n === 1 ? "" : "s"} added${result.skipped ? `; ${result.skipped} skipped because the time is taken` : ""}.`,
      );
    });

  const changeMode = (next: Mode) => {
    animateLayout();
    if (next === "month") setMonth(selected);
    setModeState(next);
    saveLocal(MODE_KEY, next);
  };
  const step = (direction: 1 | -1) => {
    if (multi) select(addDays(selected, GRID_DAYS * direction));
    else if (mode === "day") select(addDays(selected, direction));
    else if (mode === "week") select(addDays(selected, 7 * direction));
    else if (mode === "agenda")
      select(addDays(selected, AGENDA_DAYS * direction));
    else {
      const next = addMonths(month, direction);
      setMonth(next);
      setSelected(next);
    }
  };
  const agendaDays = Array.from({ length: AGENDA_DAYS }, (_, n) =>
    addDays(startOfDay(selected), n),
  );
  const heading =
    mode === "month"
      ? month.toLocaleDateString([], { month: "long", year: "numeric" })
      : multi
        ? rangeTitle(columns.map((c) => c.day))
        : mode === "day"
          ? rangeTitle([selected])
          : mode === "week"
            ? rangeTitle(weekDays(startOfWeek(selected)))
            : rangeTitle(agendaDays);
  const unit = multi
    ? `${GRID_DAYS} days`
    : mode === "agenda"
      ? "two weeks"
      : mode === "day"
        ? "day"
        : mode;
  const planned = preview?.blocks.length ?? 0;
  const mates = teammates.shown;

  /** One day's timeline: the first column scrolls the page to the hour. */
  const timeline = (c: ReturnType<typeof timelineFor>, first: boolean) => (
    <DayTimeline
      day={c.day}
      slots={c.slots}
      ghosts={c.ghosts}
      derived={c.derived}
      frames={c.frames}
      zones={zones}
      keepFree={keepFree}
      onKeepFreeMenu={live ? keepFreeMenu : undefined}
      onKeepFree={
        live && !handlers.busy && keepFree.length < 20 ? keepRange : undefined
      }
      scrollKey={
        first && mode === "day"
          ? `${mode}-${multi ? "grid" : "day"}-${selected.toDateString()}`
          : undefined
      }
      onScrollTo={first && mode === "day" ? onScrollTo : undefined}
      hours={gridHours}
      bare={multi && !first}
      grid={multi}
      mates={mates}
      onOpen={openItem}
      onBlockMenu={blockMenu}
      onEntryMenu={entryMenu}
      onMoveBlock={saveBlock}
      onMoveEntry={(entry, start, end) => void moveEntry(entry, start, end)}
      onExternal={showExternal}
      onGhostMenu={ghostMenu}
      onMoveGhost={pinGhost}
      onFrameMenu={frameMenu}
      onDragging={onDragging}
    />
  );

  /** Date navigation and the view switch: in the page's sticky header when it has one. */
  const controls = (
    <>
      <Text
        style={[shared.sectionTitle, s.headingText]}
        accessibilityRole="header"
        numberOfLines={2}
      >
        {heading}
      </Text>
      <View style={s.heading}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Previous ${unit}`}
          onPress={() => step(-1)}
          style={s.control}
        >
          <Icon name="chevronLeft" size={20} />
        </PressableScale>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Next ${unit}`}
          onPress={() => step(1)}
          style={s.control}
        >
          <Icon name="chevronRight" size={20} />
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Go to today"
          onPress={() => {
            setMonth(new Date());
            setSelected(new Date());
          }}
          style={s.control}
        >
          <Text style={s.todayLabel}>Today</Text>
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Find an event"
          onPress={() => setSearching(true)}
          style={s.control}
        >
          <Icon name="search" size={18} />
        </PressableScale>
      </View>
      <Segmented
        accessibilityLabel="Calendar view"
        options={MODES}
        labels={MODE_LABELS}
        value={mode}
        onChange={changeMode}
      />
      <View style={s.tools}>
        <SmallAction
          label="Plan"
          disabled={handlers.busy}
          onPress={() => setPlanning({ seed: null })}
        />
        <SmallAction
          label="Tasks to place"
          disabled={false}
          onPress={() => setPanel("tasks")}
        />
        {teams.length > 0 && (
          <SmallAction
            label={mates.length ? `Teammates (${mates.length})` : "Teammates"}
            disabled={false}
            onPress={() => setPanel("mates")}
          />
        )}
        <SmallAction
          label={sets.length ? "Edit sets" : "Calendar sets"}
          disabled={!prefs}
          onPress={() => setPanel("sets")}
        />
      </View>
    </>
  );

  return (
    <>
      {controlsSlot && (
        <SlotFill slot={controlsSlot}>
          <View style={s.stickyBar}>{controls}</View>
        </SlotFill>
      )}
      {live && (
        <FadeIn style={shared.card}>
          <View style={s.previewHead}>
            <Icon name="sparkles" size={16} color={colors.accent} />
            <Text
              style={[shared.sectionTitle, { flex: 1 }]}
              accessibilityRole="header"
            >
              Plan preview
            </Text>
            <SmallAction
              label="Tune in planner"
              disabled={handlers.busy}
              onPress={() => setPlanning({ seed: preview })}
            />
          </View>
          <Text style={[shared.small, s.previewText]}>
            {planned} block{planned === 1 ? "" : "s"} proposed
            {preview.days > 1 ? ` over ${preview.days} days` : ""}. Hold a faint
            block to move it (sideways for another day; it stays where you put
            it), or for options. Hold empty time and drag to keep it free.
            Nothing is saved until you apply the plan.
          </Text>
          {stale && (
            <View style={s.stale} accessibilityRole="alert">
              <Text style={s.staleText}>
                Your calendar changed since this plan was made.
              </Text>
              <SmallAction
                label="Refresh"
                disabled={handlers.busy}
                onPress={() => void tunePreview(remakePlan)}
              />
            </View>
          )}
          {keepForm ? (
            <FadeIn style={s.keepForm}>
              <Field label="Keep free on">
                <DateField
                  label="Day to keep free"
                  value={keepForm.day}
                  onChange={(day) => day && setKeepForm({ ...keepForm, day })}
                />
              </Field>
              <View style={s.pair}>
                <Field label="From" style={s.half}>
                  <ClockField
                    label="Free from"
                    value={keepForm.from}
                    onChange={(from) => setKeepForm({ ...keepForm, from })}
                  />
                </Field>
                <Field label="Until" style={s.half}>
                  <ClockField
                    label="Free until"
                    value={keepForm.to}
                    onChange={(to) => setKeepForm({ ...keepForm, to })}
                  />
                </Field>
              </View>
              <View style={s.pair}>
                <Button
                  title="Keep it free"
                  icon="check"
                  disabled={handlers.busy}
                  style={s.half}
                  onPress={addKeepFree}
                />
                <Button
                  secondary
                  title="Cancel"
                  style={s.half}
                  onPress={() => setKeepForm(null)}
                />
              </View>
            </FadeIn>
          ) : (
            <View style={s.previewTools}>
              <SmallAction
                label="Keep a time free…"
                disabled={handlers.busy || keepFree.length >= 20}
                onPress={() => {
                  animateLayout();
                  setKeepForm({
                    day: dayKeyOf(selected),
                    from: "13:00",
                    to: "17:00",
                  });
                }}
              />
            </View>
          )}
          <View style={s.previewActions}>
            <Button
              title={handlers.busy ? "Saving…" : "Apply plan"}
              icon="check"
              disabled={handlers.busy || planned === 0}
              style={s.previewButton}
              onPress={() => void applyPreview()}
            />
            <Button
              secondary
              title="Discard"
              disabled={handlers.busy}
              style={s.previewButton}
              onPress={() => {
                animateLayout();
                setKeepForm(null);
                onPreviewDone();
              }}
            />
          </View>
        </FadeIn>
      )}
      {joinable.length > 0 && (
        <FadeIn style={[shared.card, s.join]}>
          <Text style={shared.label}>Happening now</Text>
          {joinable.map((e) => (
            <View key={`${e.item_id}-${e.start_at}`} style={s.joinRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.joinTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={shared.small}>
                  {e.end_at
                    ? rangeLabel(e.start_at, e.end_at)
                    : shortDay(e.start_at)}
                </Text>
              </View>
              <Button
                title="Join"
                icon="video"
                style={s.joinButton}
                onPress={() => join(e)}
              />
            </View>
          ))}
        </FadeIn>
      )}
      <ReviewCard
        items={items}
        onPlan={(plan) => {
          animateLayout();
          onPreviewChange(plan);
        }}
      />
      <View
        ref={navigation}
        collapsable={false}
        style={[shared.card, s.calendar]}
      >
        {!controlsSlot && controls}
        {mates.length > 0 && (
          <View
            style={s.legend}
            accessible
            accessibilityLabel={`Showing when ${mates.map((m) => m.name).join(", ")} are busy`}
          >
            <Text style={s.legendLabel}>Busy:</Text>
            {mates.map((m) => (
              <View key={m.user_id} style={s.legendItem}>
                <View style={[s.legendDot, { backgroundColor: m.color }]} />
                <Text style={s.legendName} numberOfLines={1}>
                  {m.name}
                </Text>
              </View>
            ))}
            <SmallAction
              label="Hide"
              disabled={false}
              onPress={teammates.clear}
            />
          </View>
        )}
        {sets.length > 0 && (
          <ChipRow label="Calendar set" style={s.sets}>
            <Chip
              label="Everything"
              selected={!activeSet}
              onPress={() => chooseSet("")}
            />
            {sets.map((set) => (
              <Chip
                key={set.id}
                label={set.name}
                selected={activeSet?.id === set.id}
                onPress={() => chooseSet(set.id)}
              />
            ))}
          </ChipRow>
        )}
        {mode === "week" && (
          <WeekStrip
            selected={selected}
            plansOn={plansOn}
            onSelect={select}
            onShiftWeek={(d) => select(addDays(selected, 7 * d))}
          />
        )}
        {mode === "month" && (
          <MonthView
            month={month}
            selected={selected}
            things={monthThings}
            frames={cal?.frames ?? []}
            onSelect={select}
            onMore={(day) => {
              select(day);
              changeMode("day");
            }}
          />
        )}
      </View>

      {skipped && (
        <FadeIn style={s.undo}>
          <Text style={s.undoText} accessibilityRole="alert">
            {skipped.name} skipped on {shortDay(skipped.start_at)}.
          </Text>
          <SmallAction
            label="Undo"
            disabled={handlers.busy}
            onPress={() => void undoSkip()}
          />
        </FadeIn>
      )}
      {!!note && (
        <FadeIn style={s.undo}>
          <Text style={s.undoText}>{note}</Text>
          <SmallAction
            label="OK"
            disabled={false}
            onPress={() => setNote("")}
          />
        </FadeIn>
      )}

      {mode === "agenda" ? (
        <AgendaList
          days={agendaDays}
          entries={entries}
          blocks={blocks}
          external={external}
          ghosts={allGhosts}
          now={now}
          onOpen={openItem}
          onEntryMenu={entryMenu}
          onBlockMenu={blockMenu}
          onExternal={showExternal}
          onGhostMenu={ghostMenu}
          onJoin={join}
        />
      ) : (
        // Keyed by day so the timeline and agenda fade in on a new selection.
        <FadeIn key={selected.toDateString()}>
          {multi && (
            <SectionHeading
              title={heading}
              count={columns.reduce((n, c) => n + c.dayEntries.length, 0)}
            />
          )}
          {multi ? (
            <>
              <View style={s.grid}>
                {columns.map((c, n) => (
                  <View
                    key={c.day.toDateString()}
                    // The first column carries the hour labels; the rest
                    // share what's left equally.
                    style={[
                      s.gridColumn,
                      n === 0 && { flexBasis: gutterWidth(zones.length) },
                    ]}
                  >
                    <Text
                      style={[
                        s.gridDay,
                        sameDay(c.day, now) && { color: colors.accent },
                      ]}
                      numberOfLines={1}
                      accessibilityRole="header"
                    >
                      {sameDay(c.day, now) ? "Today" : shortDay(c.day)}
                    </Text>
                    {timeline(c, n === 0)}
                  </View>
                ))}
              </View>
              {gridFits &&
                !(gridFits.start === DAY_START && gridFits.end === DAY_END) && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setGridAllHours(!gridAllHours)}
                    style={({ pressed }) => [
                      s.gridToggle,
                      pressed && s.pressed,
                    ]}
                  >
                    <Text style={s.todayLabel}>
                      {gridAllHours
                        ? "Show just the busy hours"
                        : "Show all 24 hours"}
                    </Text>
                  </Pressable>
                )}
            </>
          ) : (
            timeline(columns[0], true)
          )}
          <PlannerList
            visible={dayItems}
            title="Plans for this day"
            empty={emptyDay}
            {...handlers}
          />
          {dayExternal.length > 0 && (
            <View style={[shared.card, s.external]}>
              <Text style={shared.label}>From calendars you subscribe to</Text>
              {dayExternal.map((x, n) => (
                <Pressable
                  key={`${x.subscription_id}-${x.start_at}-${n}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${x.title}, ${x.all_day ? "all day" : rangeLabel(x.start_at, x.end_at)}, from ${x.name}. Read only`}
                  onPress={() => showExternal(x)}
                  style={({ pressed }) => [
                    s.externalRow,
                    n > 0 && s.divider,
                    pressed && s.pressed,
                  ]}
                >
                  <View style={[s.legendDot, { backgroundColor: x.color }]} />
                  <Text style={s.externalTitle} numberOfLines={1}>
                    {x.title}
                  </Text>
                  <Text style={shared.small}>
                    {x.all_day ? "All day" : rangeLabel(x.start_at, x.end_at)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </FadeIn>
      )}

      <ActionMenu menu={menu} onClose={() => setMenu(null)} />
      <MoveBlockSheet
        block={moving}
        onClose={() => setMoving(null)}
        onSave={async (start, end) => {
          if (!moving) return;
          await client.updateBlock(moving.id, {
            start_at: start.toISOString(),
            end_at: end.toISOString(),
          });
          setMoving(null);
          select(start);
          reload();
        }}
      />
      <MoveBlockSheet
        title="Duplicate block"
        duplicate
        block={duplicating}
        onClose={() => setDuplicating(null)}
        onSave={async (start) => {
          if (!duplicating) return;
          const copy = await client.duplicateBlock(duplicating.id, {
            start_at: start.toISOString(),
          });
          setDuplicating(null);
          select(start);
          reload();
          showNote(
            `Another block for ${copy.title} added at ${slotLabel(copy.start_at, copy.end_at)}.`,
          );
        }}
      />
      <MoveBlockSheet
        title={movingEntry?.kind === "task" ? "Move task" : "Move event"}
        block={
          movingEntry && {
            id: movingEntry.item_id,
            title: movingEntry.title,
            start_at: movingEntry.start_at,
            end_at: movingEntry.end_at ?? movingEntry.start_at,
          }
        }
        onClose={() => setMovingEntry(null)}
        onSave={async (start, end) => {
          const entry = movingEntry;
          setMovingEntry(null);
          if (!entry) return;
          select(start);
          await moveEntry(entry, start, entry.end_at ? end : null);
        }}
      />
      <SearchSheet
        visible={searching}
        onClose={() => setSearching(false)}
        onPick={(day) => {
          setSearching(false);
          setMonth(day);
          select(day);
        }}
      />
      <FrameSheet
        frame={editingFrame}
        teams={teams}
        onClose={() => setEditingFrame(null)}
        onSaved={reload}
      />
      <TasksToPlaceSheet
        visible={panel === "tasks"}
        items={items}
        canEdit={(i) => !handlers.canToggle || handlers.canToggle(i)}
        onClose={() => setPanel(null)}
        onBooked={(start) => {
          select(start);
          reload();
          onChanged();
        }}
      />
      <CalendarSetsSheet
        visible={panel === "sets"}
        sets={sets}
        teams={teams}
        onClose={() => setPanel(null)}
        onSaved={(next) => {
          animateLayout();
          setPrefs(next);
          if (!next.calendar_sets.some((set) => set.id === setId))
            chooseSet("");
        }}
      />
      <TeammatesSheet
        visible={panel === "mates"}
        teammates={teammates}
        onClose={() => setPanel(null)}
      />
      <PlanSheet
        visible={!!planning}
        seed={planning?.seed ?? null}
        title={planning?.seed ? "Tune the plan" : "Plan my day"}
        teams={teams}
        onClose={() => setPlanning(null)}
        onApplied={() => {
          onPreviewDone();
          reload();
          onChanged();
        }}
        onShowOnCalendar={(plan) => {
          setPlanning(null);
          animateLayout();
          onPreviewChange(plan);
        }}
      />
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    calendar: { padding: 12, marginBottom: 22 },
    /** The sticky header's controls. */
    stickyBar: {
      paddingTop: 6,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      marginBottom: 12,
    },
    grid: { flexDirection: "row", gap: 6 },
    gridColumn: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    gridDay: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
      textAlign: "center",
      marginBottom: 6,
    },
    gridToggle: {
      alignItems: "center",
      paddingVertical: 10,
      marginTop: -12,
      marginBottom: 16,
    },
    previewHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },
    previewText: { marginBottom: 14 },
    previewTools: { flexDirection: "row", marginBottom: 14 },
    keepForm: {
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 14,
    },
    pair: { flexDirection: "row", gap: 10 },
    half: { flex: 1, marginBottom: 0 },
    stale: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.warningSoft,
      borderWidth: 1,
      borderColor: colors.warningBorder,
      borderRadius: radii.input,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 14,
    },
    staleText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.warning,
    },
    previewActions: { flexDirection: "row", gap: 10 },
    previewButton: { flex: 1, marginBottom: 0 },
    undo: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    undoText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    join: { paddingVertical: 14 },
    joinRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    joinTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    joinButton: { marginBottom: 0, minHeight: 44 },
    heading: {
      justifyContent: "space-between",
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    headingText: { fontSize: 22, lineHeight: 30, marginBottom: 8 },
    tools: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 10,
      marginBottom: 10,
    },
    legend: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 4,
      marginBottom: 10,
    },
    legendLabel: {
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.muted,
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      maxWidth: 120,
    },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendName: { fontFamily: fonts.medium, fontSize: 12, color: colors.text },
    sets: { paddingHorizontal: 4, marginBottom: 10 },
    control: { padding: 8, minHeight: 44, justifyContent: "center" },
    todayLabel: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.accent,
    },
    external: { paddingVertical: 12 },
    externalRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
    },
    externalTitle: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.text,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    pressed: { opacity: 0.7 },
  }),
);
