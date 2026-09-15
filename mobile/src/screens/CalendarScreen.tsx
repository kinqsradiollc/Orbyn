import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AlertButton,
} from "react-native";
import {
  addMonths,
  itemBody,
  monthGrid,
  itemsOnDay,
  byDueDate,
  dayHeading,
  describeRrule,
  emptyDay,
  motion,
  sameDay,
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
import {
  PlannerList,
  SectionHeading,
  type ListHandlers,
} from "../components/PlannerList";
import { Icon } from "../components/Icon";
import { SmallAction } from "../components/SmallAction";
import { useNow } from "../hooks/useNow";
import { usePlanStale } from "../hooks/usePlanStale";
import { client } from "../lib/api";
import { readLocal, saveLocal } from "../lib/localPrefs";
import {
  canJoin,
  clockLabel,
  rangeLabel,
  shortDay,
  slotLabel,
} from "../lib/planning";
import { pinBlock, remakePlan, removeBlock } from "../lib/plans";
import { askScope, seriesTimes, type OccurrenceRef } from "../lib/scope";
import {
  FadeIn,
  PressableScale,
  animateLayout,
  easeOut,
  isReducedMotion,
} from "../motion";
import { colors, fonts, radii, statusTones, themed } from "../theme";
import { shared } from "../styles";
import { addDays, startOfWeek } from "./calendar/dates";
import { DayTimeline, type TimelineSlot } from "./calendar/DayTimeline";
import { FrameSheet } from "./calendar/FrameSheet";
import { MoveBlockSheet } from "./calendar/MoveBlockSheet";
import { SearchSheet } from "./calendar/SearchSheet";
import { WeekStrip } from "./calendar/WeekStrip";

type Mode = "week" | "month";
type Act = (fn: () => Promise<void>) => Promise<void>;

/** The calendar set last shown on this device ("" for everything). */
const SET_KEY = "orbyn-calendar-set";
/** How long "Frame skipped · Undo" stays up. */
const UNDO_MS = 10_000;

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

const onDay = (iso: string, day: Date) => sameDay(new Date(iso), day);

/** Whether something is on `day`; all-day ones cover each day up to their (exclusive) end. */
function covers(
  x: { start_at: string; end_at: string | null; all_day?: boolean },
  day: Date,
) {
  if (!x.all_day) return onDay(x.start_at, day);
  const dayStart = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
  ).getTime();
  const from = Date.parse(x.start_at);
  const to = x.end_at ? Date.parse(x.end_at) : from + 86_400_000;
  return from < dayStart + 86_400_000 && to > dayStart;
}

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
 * A swipeable week strip (or the Sunday-first month grid), then the selected
 * day as an hour-by-hour timeline and a list of its plans with progress. The
 * week comes from the calendar view: repeating items as occurrences, time
 * blocks, frames, and buffers and travel around events. A calendar set
 * narrows what shows; extra time zones from the planning settings label the
 * hours. A plan preview shows as faint blocks that can be moved (pinned) or
 * removed until it's applied or discarded.
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
  ...handlers
}: ListHandlers & {
  items: Item[];
  /** For the frame editor's team filter. */
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
}) {
  const [mode, setMode] = useState<Mode>("week");
  const [selected, setSelected] = useState(() => new Date());
  const [month, setMonth] = useState(() => new Date());
  const [view, setView] = useState<{
    start: number;
    data: CalendarView;
  } | null>(null);
  const [prefs, setPrefs] = useState<PlannerPrefs | null>(null);
  const [setId, setSetId] = useState(() => readLocal(SET_KEY) ?? "");
  /** The block in the "Move to…" sheet. */
  const [moving, setMoving] = useState<TimeBlock | null>(null);
  /** The event in the "Move to…" sheet. */
  const [movingEntry, setMovingEntry] = useState<CalendarEntry | null>(null);
  /** The "Find an event" sheet is open. */
  const [searching, setSearching] = useState(false);
  /** The frame in the frame editor. */
  const [editingFrame, setEditingFrame] = useState<Frame | null>(null);
  /** The frame day just skipped, for Undo. */
  const [skipped, setSkipped] = useState<FrameOccurrence | null>(null);
  /** Bumped after a block or occurrence changes, to reload the week. */
  const [version, setVersion] = useState(0);
  /** Plans this screen made by tuning the preview (they don't jump days). */
  const tuned = useRef(new Set<string>());
  const stale = usePlanStale(preview);
  const now = useNow(30_000);

  // One request per week shown, and again only when the planner's items
  // actually change (unchanged polls keep the same array) or after an edit.
  const weekStart = startOfWeek(selected).getTime();
  useEffect(() => {
    let alive = true;
    const from = new Date(weekStart);
    client
      .calendar(from.toISOString(), addDays(from, 7).toISOString())
      .then((data) => alive && setView({ start: weekStart, data }))
      .catch(() => {
        // Older servers have no calendar view; the items below still show.
      });
    return () => {
      alive = false;
    };
  }, [weekStart, items, version]);
  const week = view && view.start === weekStart ? view.data : null;

  // Calendar sets and extra time zones live in the planning settings.
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
  }, [version]);

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

  const sets = prefs?.calendar_sets ?? [];
  const activeSet = sets.find((set) => set.id === setId) ?? null;
  const chooseSet = (id: string) => {
    animateLayout();
    setSetId(id);
    saveLocal(SET_KEY, id);
  };
  const zones = (prefs?.extra_timezones ?? []).slice(0, 3);

  const shownItems = items.filter((i) =>
    inSet(activeSet, { team_id: i.team_id, list_id: i.list_id ?? null }),
  );
  const dayItems = itemsOnDay(shownItems, selected).sort(byDueDate);
  const entries = (week?.entries ?? []).filter((e) => inSet(activeSet, e));
  const blocks = (week?.blocks ?? []).filter((b) => inSet(activeSet, b));
  const shownIds = new Set(entries.map((e) => e.item_id));

  const dayEntries = week
    ? entries.filter((e) => covers(e, selected))
    : dayItems.map(entryFromItem);
  // Events from subscribed calendars: shown read-only.
  const dayExternal = (week?.external ?? []).filter((x) => covers(x, selected));
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
    ...dayExternal.map((external, n): TimelineSlot => ({
      type: "external",
      key: `external-${external.subscription_id}-${external.start_at}-${n}`,
      start: new Date(external.start_at),
      end: new Date(external.end_at),
      kind: "event",
      allDay: external.all_day,
      external,
    })),
    ...blocks
      .filter((b) => onDay(b.start_at, selected))
      .map((block): TimelineSlot => ({
        type: "block",
        key: `block-${block.id}`,
        start: new Date(block.start_at),
        end: new Date(block.end_at),
        kind: "task",
        block,
      })),
  ];
  const derived = (week?.derived ?? []).filter(
    (d) =>
      shownIds.has(d.item_id) &&
      (onDay(d.start_at, selected) || onDay(d.end_at, selected)),
  );
  const dayFrames = (week?.frames ?? []).filter((f) =>
    onDay(f.start_at, selected),
  );
  const ghosts =
    preview && !preview.applied
      ? preview.blocks.filter((b) => onDay(b.start_at, selected))
      : [];
  const joinable = entries.filter((e) => canJoin(e, now));

  const plansOn = (day: Date) =>
    week
      ? [
          ...entries
            .filter((e) => covers(e, day))
            .map((e) => ({
              key: `${e.item_id}-${e.start_at}`,
              status: e.status,
            })),
          // Subscribed events show as plain dots.
          ...(week.external ?? [])
            .filter((x) => covers(x, day))
            .map((x, n) => ({
              key: `external-${x.subscription_id}-${x.start_at}-${n}`,
              status: "todo" as const,
            })),
        ]
      : itemsOnDay(shownItems, day).map((i) => ({
          key: i.id,
          status: i.status,
        }));

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
  const reload = () => setVersion((v) => v + 1);

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

  const blockMenu = (block: TimeBlock) => {
    const item = items.find((i) => i.id === block.item_id);
    const canFinish =
      block.status !== "done" &&
      (!item || !handlers.canToggle || handlers.canToggle(item));
    const buttons: AlertButton[] = [
      ...(canFinish
        ? [
            {
              text: "Mark task done",
              onPress: () =>
                void act(async () => {
                  await client.postItemUpdate(block.item_id, {
                    status: "done",
                  });
                  celebrate(block.title);
                  reload();
                  onChanged();
                }),
            },
          ]
        : []),
      { text: "Move to…", onPress: () => setMoving(block) },
      {
        text: "Move to next free time",
        onPress: () =>
          void act(async () => {
            await client.rescheduleBlock(block.id);
            reload();
          }),
      },
      ...(block.status !== "done"
        ? [
            {
              text: "Duplicate",
              onPress: () =>
                void act(async () => {
                  const copy = await client.duplicateBlock(block.id);
                  reload();
                  AccessibilityInfo.announceForAccessibility(
                    `Another block for ${block.title} added at ${slotLabel(copy.start_at, copy.end_at)}`,
                  );
                }),
            },
          ]
        : []),
      {
        text: "Delete block",
        style: "destructive",
        onPress: () =>
          void act(async () => {
            await client.deleteBlock(block.id);
            reload();
          }),
      },
      { text: "Cancel", style: "cancel" },
    ];
    Alert.alert(block.title, slotLabel(block.start_at, block.end_at), buttons);
  };
  /**
   * Move an event to new times (drag, resize or Move to…). It shows there at
   * once; a repeating one asks which occurrences first, and the reload
   * confirms it or puts it back.
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
          await client.updateItem(
            item.id,
            { ...body, ...times },
            { scope, occurrence: entry.occurrence },
          );
        } else
          await client.updateItem(item.id, {
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
        await client.deleteItem(item.id, item.version, {
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
        await client.deleteItem(item.id, item.version);
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
    const movable = entry.kind === "event" && !!entry.end_at && !entry.all_day;
    const buttons: AlertButton[] = [
      { text: "Open", onPress: () => openItem(entry.item_id, entry) },
      ...(movable
        ? [{ text: "Move to…", onPress: () => setMovingEntry(entry) }]
        : []),
      {
        text: entry.occurrence ? "Delete…" : "Delete",
        style: "destructive",
        onPress: () => void deleteEntry(entry),
      },
      { text: "Cancel", style: "cancel" },
    ];
    Alert.alert(
      entry.title,
      `${shortDay(entry.start_at)}, ${when}${repeats}`,
      buttons,
    );
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
    Alert.alert(
      f.name,
      `${shortDay(f.start_at)}, ${rangeLabel(f.start_at, f.end_at)}${f.busy ? " · Busy" : ""}`,
      [
        {
          text: "Edit frame",
          onPress: () =>
            void act(async () => {
              const frame = (await client.listFrames()).find(
                (x) => x.id === f.frame_id,
              );
              if (frame) setEditingFrame(frame);
            }),
        },
        {
          text: "Skip this day",
          onPress: () =>
            void act(async () => {
              await client.skipFrame(f.frame_id, f.date);
              animateLayout();
              setSkipped(f);
              reload();
            }),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
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
      const next = await change(preview);
      tuned.current.add(next.id);
      animateLayout();
      onPreviewChange(next);
    });
  const ghostMenu = (g: PlannedBlock) =>
    Alert.alert(
      g.title,
      `${slotLabel(g.start_at, g.end_at)} · planned, not saved yet`,
      [
        {
          text: "Remove from the plan",
          style: "destructive",
          onPress: () => void tunePreview((p) => removeBlock(p, g)),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
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
    void tunePreview(() => pinBlock(preview, g, start, end));
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

  const select = (day: Date) => {
    setSelected(day);
    if (day.getMonth() !== month.getMonth()) setMonth(day);
  };
  const step = (direction: 1 | -1) => {
    if (mode === "week") select(addDays(selected, 7 * direction));
    else {
      const next = addMonths(month, direction);
      setMonth(next);
      setSelected(next);
    }
  };
  const heading = (mode === "week" ? selected : month).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const unit = mode === "week" ? "week" : "month";
  const planned = preview?.blocks.length ?? 0;
  return (
    <>
      {preview && !preview.applied && (
        <FadeIn style={shared.card}>
          <View style={s.previewHead}>
            <Icon name="sparkles" size={16} color={colors.accent} />
            <Text style={shared.sectionTitle} accessibilityRole="header">
              Plan preview
            </Text>
          </View>
          <Text style={[shared.small, s.previewText]}>
            {planned} block{planned === 1 ? "" : "s"} proposed
            {preview.days > 1 ? ` over ${preview.days} days` : ""}. Hold a faint
            block to move it (it stays where you put it), or for the option to
            remove it. Nothing is saved until you apply the plan.
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
                onPress={() =>
                  void Linking.openURL(e.meeting_url).catch(() =>
                    Alert.alert("That meeting link couldn’t be opened."),
                  )
                }
              />
            </View>
          ))}
        </FadeIn>
      )}
      <View style={[shared.card, s.calendar]}>
        <View style={s.heading}>
          <Text
            style={[shared.sectionTitle, s.headingText]}
            accessibilityRole="header"
          >
            {heading}
          </Text>
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
            accessibilityLabel={`Next ${unit}`}
            onPress={() => step(1)}
            style={s.control}
          >
            <Icon name="chevronRight" size={20} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Find an event"
            onPress={() => setSearching(true)}
            style={s.control}
          >
            <Icon name="search" size={18} />
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              mode === "week" ? "Show the month grid" : "Show the week strip"
            }
            onPress={() => {
              animateLayout();
              setMonth(selected);
              setMode(mode === "week" ? "month" : "week");
            }}
            style={s.toggle}
          >
            <Icon name="calendar" size={14} color={colors.accent} />
            <Text style={s.toggleText}>
              {mode === "week" ? "Month" : "Week"}
            </Text>
          </PressableScale>
        </View>
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
        {mode === "week" ? (
          <WeekStrip
            selected={selected}
            plansOn={plansOn}
            onSelect={select}
            onShiftWeek={(d) => select(addDays(selected, 7 * d))}
          />
        ) : (
          <MonthGrid
            month={month}
            selected={selected}
            items={shownItems}
            onSelect={select}
          />
        )}
      </View>

      {/* Keyed by day so the timeline and agenda fade in on a new selection. */}
      <FadeIn key={selected.toDateString()}>
        <SectionHeading
          title={dayHeading(selected)}
          count={dayEntries.length}
          hint={
            sameDay(selected, new Date())
              ? "Today, hour by hour. Hold an event, block or frame to move it or see options."
              : "Hour by hour. Hold an event, block or frame to move it or see options."
          }
        />
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
        <DayTimeline
          day={selected}
          slots={slots}
          ghosts={ghosts}
          derived={derived}
          frames={dayFrames}
          zones={zones}
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
        <PlannerList
          visible={dayItems}
          title="Plans for this day"
          empty={emptyDay}
          {...handlers}
        />
      </FadeIn>
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
        title="Move event"
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
          await moveEntry(entry, start, end);
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
    </>
  );
}

function MonthGrid({
  month,
  selected,
  items,
  onSelect,
}: {
  month: Date;
  selected: Date;
  items: Item[];
  onSelect: (day: Date) => void;
}) {
  const today = new Date();
  return (
    <>
      <View style={s.week}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <Text key={day} style={s.weekday}>
            {day}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week, n) => (
        <View key={n} style={s.week}>
          {week.map((day) => {
            const plans = itemsOnDay(items, day);
            const active = sameDay(day, selected);
            const isToday = sameDay(day, today);
            return (
              <Pressable
                key={day.toISOString()}
                accessibilityRole="button"
                accessibilityLabel={`${day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}${isToday ? ", today" : ""}, ${plans.length} plan${plans.length === 1 ? "" : "s"}`}
                accessibilityState={{ selected: active }}
                onPress={() => onSelect(day)}
                style={[s.day, isToday && !active && s.today]}
              >
                {active && <SelectedPill />}
                <Text
                  style={[
                    s.dayText,
                    day.getMonth() !== month.getMonth() && {
                      color: colors.faint,
                    },
                    isToday && { color: colors.accent },
                    active && { color: colors.white },
                  ]}
                >
                  {day.getDate()}
                </Text>
                <View style={s.dots}>
                  {plans.slice(0, 3).map((i) => (
                    <View
                      key={i.id}
                      style={[
                        s.dot,
                        {
                          backgroundColor: active
                            ? colors.white
                            : statusTones[i.status].fg,
                        },
                      ]}
                    />
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </>
  );
}

/** The selected day's filled highlight; scales in when a day is chosen. */
function SelectedPill() {
  const progress = useRef(
    new Animated.Value(isReducedMotion() ? 1 : 0),
  ).current;
  useEffect(() => {
    if (isReducedMotion()) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: motion.base,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
  }, [progress]);
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[s.selected, { opacity: progress, transform: [{ scale }] }]}
    />
  );
}

const s = themed(() =>
  StyleSheet.create({
    calendar: { padding: 12, marginBottom: 22 },
    previewHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },
    previewText: { marginBottom: 14 },
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
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
      paddingLeft: 6,
    },
    headingText: { flex: 1 },
    sets: { paddingHorizontal: 4, marginBottom: 10 },
    control: { padding: 8, minHeight: 44, justifyContent: "center" },
    todayLabel: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.accent,
    },
    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minHeight: 32,
      marginLeft: 4,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
    },
    toggleText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.accent,
    },
    week: { flexDirection: "row" },
    weekday: {
      flex: 1,
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 10,
      color: colors.muted,
      marginBottom: 9,
    },
    day: {
      flex: 1,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 10,
      margin: 1,
    },
    selected: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 10,
      backgroundColor: colors.accent,
    },
    today: { backgroundColor: colors.accentSoft },
    dayText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    dots: { height: 7, flexDirection: "row", gap: 3, marginTop: 4 },
    dot: { width: 5, height: 5, borderRadius: radii.pill },
  }),
);
