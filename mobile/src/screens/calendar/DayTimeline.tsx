import React, { useEffect, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  sameDay,
  statusLabels,
  zonedParts,
  type BusyInterval,
  type CalendarEntry,
  type DerivedBlock,
  type ExternalEntry,
  type FrameOccurrence,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { useNow } from "../../hooks/useNow";
import { shortDay } from "../../lib/planning";
import { usePlanning } from "../../lib/planningContext";
import { isReducedMotion, PressableScale } from "../../motion";
import { colors, fonts, radii, statusTones, themed, tint } from "../../theme";
import { shared } from "../../styles";
import {
  DAY_END,
  DAY_START,
  HOUR_HEIGHT,
  addDays,
  covers,
  hourLabel,
  layoutDay,
  offsetFor,
  shiftDays,
  timeLabel,
  type Slot,
} from "./dates";

const GUTTER = 56;
/** Width of each extra time-zone column in the hour gutter. */
const ZONE_WIDTH = 42;
const PAD_TOP = 10;
/** Fewest hours shown, so a quiet day still reads as a day. */
const MIN_HOURS = 8;
/** Where a quiet day that isn't today starts. */
const QUIET_START = 8;
/** Blocks move and resize in steps of this many minutes. */
const SNAP = 15;
/** Finger travel for one step. */
const STEP = (SNAP / 60) * HOUR_HEIGHT;
/** How long to hold a block before it lifts for dragging. */
const HOLD_MS = 350;
/** Finger travel that turns a press into a scroll before the block lifts. */
const SLOP = 8;
/** Sideways finger travel that moves a lifted block one day. */
const DAY_SHIFT = 72;
const MAX_DAY_SHIFT = 6;
/** Width of each teammate's busy strip, and the gap after it. */
const STRIP = 4;

/** An occurrence of an item, time set aside for a task, or a planned block not saved yet. */
export type TimelineSlot =
  | (Slot & { type: "entry"; entry: CalendarEntry })
  | (Slot & { type: "block"; block: TimeBlock })
  | (Slot & { type: "ghost"; ghost: PlannedBlock })
  | (Slot & { type: "external"; external: ExternalEntry });

type DragMode = "move" | "resize";
type Drag = {
  id: string;
  start: Date;
  end: Date;
  /** Days it moves when dropped (dragged sideways). */
  days: number;
};
/** Anything that can be dragged: a saved block, or a planned one. */
type Movable = { id: string; start_at: string; end_at: string };

/**
 * The whole hours a day needs: every timed plan and frame, plus an hour either
 * side of now today (a quiet day that isn't today starts at 8 AM), widened
 * to at least MIN_HOURS inside the day. "Show all 24 hours" shows the rest.
 */
function visibleHours(
  placed: { top: number; height: number }[],
  nowTop: number | null,
) {
  const toHour = (y: number) => DAY_START + y / HOUR_HEIGHT;
  const anchors: number[] = [];
  for (const p of placed) anchors.push(toHour(p.top), toHour(p.top + p.height));
  if (nowTop !== null) anchors.push(toHour(nowTop) - 1, toHour(nowTop) + 1);
  if (!anchors.length) anchors.push(QUIET_START);
  let start = Math.max(DAY_START, Math.floor(Math.min(...anchors)));
  let end = Math.min(DAY_END, Math.ceil(Math.max(...anchors)));
  if (end - start < MIN_HOURS) {
    end = Math.min(DAY_END, start + MIN_HOURS);
    start = Math.max(DAY_START, end - MIN_HOURS);
  }
  return { start, end };
}

/** Width of the hour gutter with `zones` extra time-zone columns. */
export const gutterWidth = (zones: number) => GUTTER + zones * ZONE_WIDTH;

/**
 * The hours a day's timeline shows on its own (see visibleHours), so days
 * side by side can share one window.
 */
export function hoursFor({
  day,
  slots,
  ghosts = [],
  frames = [],
  keepFree = [],
  now,
}: {
  day: Date;
  slots: TimelineSlot[];
  ghosts?: PlannedBlock[];
  frames?: FrameOccurrence[];
  keepFree?: BusyInterval[];
  now: Date;
}) {
  const all: TimelineSlot[] = [
    ...slots,
    ...ghosts.map((ghost): TimelineSlot => ({
      type: "ghost",
      key: `ghost-${ghost.item_id}-${ghost.start_at}`,
      start: new Date(ghost.start_at),
      end: new Date(ghost.end_at),
      kind: "task",
      ghost,
    })),
  ];
  const { placed } = layoutDay(all, day);
  const spans = [...frames, ...keepFree.filter((r) => covers(r, day))].map(
    (r) => {
      const top = offsetFor(day, new Date(r.start_at));
      return { top, height: offsetFor(day, new Date(r.end_at)) - top };
    },
  );
  const nowTop = offsetFor(day, now);
  const showNow =
    sameDay(day, now) &&
    nowTop >= 0 &&
    nowTop <= (DAY_END - DAY_START) * HOUR_HEIGHT;
  return visibleHours([...placed, ...spans], showNow ? nowTop : null);
}

/** "Los Angeles" for "America/Los_Angeles". */
const zoneCity = (zone: string) =>
  (zone.split("/").pop() ?? zone).replace(/_/g, " ");

/** The zone's short name on `at` ("JST", "GMT+10"), or "" when unknown. */
function zoneAbbr(zone: string, at: Date) {
  try {
    return (
      new Intl.DateTimeFormat([], { timeZone: zone, timeZoneName: "short" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

/** `at` as a time in `zone`: "3 PM", or "3:30 PM" in half-hour zones. */
function clockIn(zone: string, at: Date) {
  try {
    const { minute } = zonedParts(at, zone);
    return at.toLocaleTimeString([], {
      hour: "numeric",
      ...(minute ? { minute: "2-digit" as const } : {}),
      timeZone: zone,
    });
  } catch {
    return "";
  }
}

const MORE = { name: "longpress", label: "More options" } as const;
/** Screen-reader actions on a block that can be moved. */
const BLOCK_ACTIONS = [
  { name: "activate" },
  MORE,
  { name: "earlier", label: `Move ${SNAP} minutes earlier` },
  { name: "later", label: `Move ${SNAP} minutes later` },
  { name: "longer", label: `Make ${SNAP} minutes longer` },
  { name: "shorter", label: `Make ${SNAP} minutes shorter` },
];

/**
 * Hour rows covering the day's plans (and now, today), with entries placed by
 * start time and sized by duration; overlapping ones sit side by side. Frames
 * are translucent labelled bands behind everything (long-press one to edit it
 * or skip the day). Entries take their list's colour. Time blocks have a
 * dashed outline; hold one to lift it and drag it to another time (15-minute
 * steps), or drag its bottom edge to change its length; let go without moving
 * for its menu. A plan preview shows as faint sparkle blocks that can be
 * dragged the same way to pin them. Buffers and travel are faint bands.
 * Untimed plans go in the "All day / no time" row. Today shows a current-time
 * line. Extra time zones get their own columns in the hour gutter.
 *
 * The timeline is drawn at full height and never scrolls by itself: it sits
 * inside the page ScrollView, and a nested vertical ScrollView here took every
 * swipe that started on it, so the page seemed to scroll without moving.
 * While a block is lifted, `onDragging` asks the page to hold still.
 */
export function DayTimeline({
  day,
  slots,
  ghosts = [],
  derived,
  frames = [],
  zones = [],
  onOpen,
  onBlockMenu,
  onEntryMenu,
  onMoveEntry,
  onExternal,
  onMoveBlock,
  onGhostMenu,
  onMoveGhost,
  onFrameMenu,
  onDragging,
  keepFree = [],
  onKeepFreeMenu,
  onKeepFree,
  mates = [],
  scrollKey,
  onScrollTo,
  hours: sharedHours,
  bare = false,
  grid = false,
}: {
  /** The hours to show, shared by days side by side (hides "Show all 24 hours"). */
  hours?: { start: number; end: number };
  /** A column beside another: no hour labels or time-zone columns. */
  bare?: boolean;
  /** One of several days side by side: the all-day row keeps a fixed height. */
  grid?: boolean;
  day: Date;
  /** Only the entries and blocks on `day`. */
  slots: TimelineSlot[];
  /** Blocks a plan preview proposes on `day` (not saved yet). */
  ghosts?: PlannedBlock[];
  /** Buffers and travel around the day's events. */
  derived: DerivedBlock[];
  /** Frame occurrences on `day`. */
  frames?: FrameOccurrence[];
  /** Extra IANA time zones shown beside the hours (at most three). */
  zones?: string[];
  /** Open the task or event behind an entry or block (with the entry, for its occurrence). */
  onOpen: (itemId: string, entry?: CalendarEntry) => void;
  onBlockMenu: (block: TimeBlock) => void;
  /** Options for an entry (long-press). */
  onEntryMenu: (entry: CalendarEntry) => void;
  /** Save an event's new times after a drag or resize; events can't move without it. */
  onMoveEntry?: (entry: CalendarEntry, start: Date, end: Date) => void;
  /** Details of an event from a subscribed calendar (read-only). */
  onExternal?: (event: ExternalEntry) => void;
  /** Save a block's new times after a drag, resize or screen-reader action. */
  onMoveBlock?: (block: TimeBlock, start: Date, end: Date) => void;
  /** Options for a planned block; without it planned blocks can't be touched. */
  onGhostMenu?: (ghost: PlannedBlock) => void;
  /** Pin a planned block at new times. */
  onMoveGhost?: (ghost: PlannedBlock, start: Date, end: Date) => void;
  /** Options for a frame occurrence (long-press its band). */
  onFrameMenu?: (frame: FrameOccurrence) => void;
  /** True while a block is lifted, so the page can stop scrolling. */
  onDragging?: (active: boolean) => void;
  /** Times a plan preview keeps free, drawn as bands. */
  keepFree?: BusyInterval[];
  /** Options for a kept-free band (long-press). */
  onKeepFreeMenu?: (range: BusyInterval) => void;
  /** With a plan preview: hold empty time and drag to keep a range free. */
  onKeepFree?: (start: Date, end: Date) => void;
  /** Changes when the day or view changes: the page scrolls to the right hour once. */
  scrollKey?: string;
  /** Scroll the page to `y` below the top of `view`. */
  onScrollTo?: (
    view: React.ComponentRef<typeof View> | null,
    y: number,
  ) => void;
  /** Teammates' busy times, as thin strips beside the hours. */
  mates?: {
    user_id: string;
    name: string;
    color: string;
    busy: BusyInterval[];
  }[];
}) {
  const now = useNow(60_000);
  const { listById } = usePlanning();
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** The hours shown when a drag began, kept still until it ends. */
  const frozen = useRef<{ start: number; end: number } | null>(null);
  const [allHours, setAllHours] = useState(false);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  /** A range being drawn on empty time to keep free, in px from the top shown hour. */
  const [draw, setDrawState] = useState<{ from: number; to: number } | null>(
    null,
  );
  const drawRef = useRef<{ from: number; to: number } | null>(null);
  const setDraw = (next: { from: number; to: number } | null) => {
    drawRef.current = next;
    setDrawState(next);
  };
  const body = useRef<React.ComponentRef<typeof View>>(null);
  const listColor = (id: string | null) =>
    id ? listById.get(id)?.color : undefined;
  const ghostKey = (g: PlannedBlock) => `ghost-${g.item_id}-${g.start_at}`;

  const shownSlots: TimelineSlot[] = [
    ...slots.map((slot): TimelineSlot =>
      drag &&
      ((slot.type === "block" && drag.id === slot.block.id) ||
        (slot.type === "entry" && drag.id === slot.key))
        ? { ...slot, start: drag.start, end: drag.end }
        : slot,
    ),
    ...ghosts.map((ghost): TimelineSlot => {
      const key = ghostKey(ghost);
      const dragged = drag?.id === key;
      return {
        type: "ghost",
        key,
        start: dragged ? drag.start : new Date(ghost.start_at),
        end: dragged ? drag.end : new Date(ghost.end_at),
        kind: "task",
        ghost,
      };
    }),
  ];
  const { placed, allDay } = layoutDay(shownSlots, day);
  const isToday = sameDay(day, now);
  const nowTop = offsetFor(day, now);
  const showNow =
    isToday && nowTop >= 0 && nowTop <= (DAY_END - DAY_START) * HOUR_HEIGHT;
  const frameSpans = frames.map((f) => {
    const top = offsetFor(day, new Date(f.start_at));
    return { f, top, height: offsetFor(day, new Date(f.end_at)) - top };
  });

  const freeSpans = keepFree
    .filter((r) => covers(r, day))
    .map((r) => {
      const top = offsetFor(day, new Date(r.start_at));
      return { r, top, height: offsetFor(day, new Date(r.end_at)) - top };
    });

  const fitted =
    sharedHours ??
    visibleHours(
      [...placed, ...frameSpans, ...freeSpans],
      showNow ? nowTop : null,
    );
  // With shared hours the columns' owner shows the one toggle.
  const fitsAll =
    !!sharedHours || (fitted.start === DAY_START && fitted.end === DAY_END);
  const { start, end } =
    ((drag || draw) && frozen.current) ||
    (allHours && !sharedHours ? { start: DAY_START, end: DAY_END } : fitted);

  // Scroll the page to an hour before now today, or 8 AM on another day:
  // once per new day or view (the key), never on a re-render or a layout.
  const scrollInfo = useRef({ start, end, isToday, now, onScrollTo });
  scrollInfo.current = { start, end, isToday, now, onScrollTo };
  useEffect(() => {
    if (!scrollKey) return;
    const frame = requestAnimationFrame(() => {
      const info = scrollInfo.current;
      if (!info.onScrollTo) return;
      const hour = info.isToday
        ? info.now.getHours() + info.now.getMinutes() / 60 - 1
        : QUIET_START;
      const shown = Math.min(info.end, Math.max(info.start, hour));
      info.onScrollTo(
        body.current,
        PAD_TOP + (shown - info.start) * HOUR_HEIGHT,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollKey]);
  // layoutDay measures from DAY_START; shift everything up to the first shown hour.
  const shift = (start - DAY_START) * HOUR_HEIGHT;
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const windowHeight = (end - start) * HOUR_HEIGHT;
  const gutter = bare ? 0 : gutterWidth(zones.length);
  // Teammates' strips sit between the hours and the events.
  const stripsWidth = mates.length ? mates.length * STRIP + 2 : 0;
  const clip = <T,>(item: T, top: number, bottom: number) => ({
    item,
    top: Math.max(0, top - shift),
    height: Math.min(windowHeight, bottom - shift) - Math.max(0, top - shift),
  });
  const bands = derived
    .map((d) =>
      clip(
        d,
        offsetFor(day, new Date(d.start_at)),
        offsetFor(day, new Date(d.end_at)),
      ),
    )
    .filter((b) => b.height > 2);
  const frameBands = frameSpans
    .map(({ f, top, height }) => clip(f, top, top + height))
    .filter((b) => b.height > 4);
  const freeBands = freeSpans
    .map(({ r, top, height }) => clip(r, top, top + height))
    .filter((b) => b.height > 4);
  const strips = mates.map((m) => ({
    m,
    spans: m.busy
      .filter((b) => covers(b, day))
      .map((b) =>
        clip(
          b,
          offsetFor(day, new Date(b.start_at)),
          offsetFor(day, new Date(b.end_at)),
        ),
      )
      .filter((b) => b.height > 1),
  }));
  /** "To Wed, Sep 16" on a block being dragged sideways. */
  const dayBadge = (id: string) =>
    drag?.id === id && drag.days
      ? `To ${shortDay(addDays(day, drag.days))}`
      : undefined;

  // ---- moving and resizing blocks ----
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const minuteOf = (at: Date) => (at.getTime() - midnight.getTime()) / 60_000;
  const atMinute = (minute: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute);
  const snap = (minute: number) => Math.round(minute / SNAP) * SNAP;

  /** Blocks wholly inside the hours shown can be dragged. */
  const canDrag = (m: Movable, allowed: boolean) =>
    allowed &&
    minuteOf(new Date(m.start_at)) >= start * 60 &&
    minuteOf(new Date(m.end_at)) <= end * 60;

  const begin = (m: Movable) => {
    frozen.current = { start, end };
    setDrag({
      id: m.id,
      start: new Date(m.start_at),
      end: new Date(m.end_at),
      days: 0,
    });
    onDragging?.(true);
    // A light tick where the platform has one without a haptics module.
    if (Platform.OS === "android" && !isReducedMotion()) Vibration.vibrate(10);
  };
  const dragTo = (m: Movable, mode: DragMode, dy: number, dx = 0) => {
    const win = frozen.current ?? { start, end };
    // Sideways moves it to another day; it keeps its time.
    const days =
      mode === "move"
        ? Math.max(
            -MAX_DAY_SHIFT,
            Math.min(MAX_DAY_SHIFT, Math.trunc(dx / DAY_SHIFT)),
          )
        : 0;
    let from = new Date(m.start_at);
    let to = new Date(m.end_at);
    if (Math.abs(dy) >= STEP / 2) {
      const moved = (dy / HOUR_HEIGHT) * 60;
      if (mode === "move") {
        const length = to.getTime() - from.getTime();
        const latest = win.end * 60 - length / 60_000;
        from = atMinute(
          Math.max(
            win.start * 60,
            Math.min(latest, snap(minuteOf(from) + moved)),
          ),
        );
        to = new Date(from.getTime() + length);
      } else {
        const minute = Math.min(win.end * 60, snap(minuteOf(to) + moved));
        to =
          minute - minuteOf(from) >= SNAP
            ? atMinute(minute)
            : new Date(from.getTime() + SNAP * 60_000);
      }
    }
    const current = dragRef.current;
    if (
      !current ||
      current.start.getTime() !== from.getTime() ||
      current.end.getTime() !== to.getTime() ||
      current.days !== days
    )
      setDrag({ id: m.id, start: from, end: to, days });
  };
  /** End a drag; true when it moved (and `save` was called with the new times). */
  const finish = (
    m: Movable,
    commit: boolean,
    save: (start: Date, end: Date) => void,
  ) => {
    const d = dragRef.current;
    frozen.current = null;
    setDrag(null);
    onDragging?.(false);
    if (!commit || !d) return false;
    const from = shiftDays(d.start, d.days);
    const to = shiftDays(d.end, d.days);
    const moved =
      from.getTime() !== Date.parse(m.start_at) ||
      to.getTime() !== Date.parse(m.end_at);
    if (moved) save(from, to);
    return moved;
  };
  /** Screen-reader actions: a step earlier, later, longer or shorter. */
  const nudge = (
    m: Movable,
    action: string,
    save: (start: Date, end: Date) => void,
  ) => {
    const from = Date.parse(m.start_at);
    const to = Date.parse(m.end_at);
    const step = SNAP * 60_000;
    const next =
      action === "earlier"
        ? [from - step, to - step]
        : action === "later"
          ? [from + step, to + step]
          : action === "longer"
            ? [from, to + step]
            : action === "shorter" && to - from > step
              ? [from, to - step]
              : null;
    if (next) save(new Date(next[0]), new Date(next[1]));
  };

  // ---- drawing a range to keep free (plan preview) ----
  const clampY = (y: number) =>
    Math.max(0, Math.min((end - start) * HOUR_HEIGHT, y));
  /** Minutes after midnight at `y` px below the top shown hour, snapped. */
  const minuteAt = (
    y: number,
    win: { start: number },
    round: "floor" | "ceil",
  ) => win.start * 60 + Math[round]((y / HOUR_HEIGHT) * (60 / SNAP)) * SNAP;
  const beginDraw = (y: number) => {
    frozen.current = { start, end };
    const at = clampY(y);
    setDraw({ from: at, to: at });
    onDragging?.(true);
    if (Platform.OS === "android" && !isReducedMotion()) Vibration.vibrate(10);
  };
  const moveDraw = (y: number) => {
    const d = drawRef.current;
    if (d) setDraw({ from: d.from, to: clampY(y) });
  };
  const endDraw = (commit: boolean) => {
    const d = drawRef.current;
    const win = frozen.current ?? { start, end };
    frozen.current = null;
    setDraw(null);
    onDragging?.(false);
    if (!commit || !d || !onKeepFree) return;
    const from = minuteAt(Math.min(d.from, d.to), win, "floor");
    const to = minuteAt(Math.max(d.from, d.to), win, "ceil");
    if (to - from >= SNAP) onKeepFree(atMinute(from), atMinute(to));
  };
  const drawLabel = (() => {
    if (!draw) return "";
    const win = frozen.current ?? { start, end };
    const from = minuteAt(Math.min(draw.from, draw.to), win, "floor");
    const to = minuteAt(Math.max(draw.from, draw.to), win, "ceil");
    return to - from >= SNAP
      ? `Keep free ${timeLabel(atMinute(from))} – ${timeLabel(atMinute(to))}`
      : "Drag to keep time free";
  })();

  const menuProps = (menu: (() => void) | null) => {
    if (!menu) return {};
    return {
      onLongPress: menu,
      accessibilityActions: [MORE],
      onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
        if (e.nativeEvent.actionName === MORE.name) menu();
      },
    };
  };
  const slotMenu = (slot: TimelineSlot) =>
    slot.type === "block"
      ? () => onBlockMenu(slot.block)
      : slot.type === "entry"
        ? () => onEntryMenu(slot.entry)
        : null;

  return (
    <View style={s.card}>
      {zones.length > 0 && (
        <View
          // Kept, invisible, beside another column so the hours line up.
          style={[s.zoneHead, bare && s.hidden]}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {zones.map((zone) => (
            <View key={zone} style={s.zoneCell}>
              <Text style={s.zoneName} numberOfLines={1}>
                {zoneCity(zone)}
              </Text>
              <Text style={s.zoneAbbr} numberOfLines={1}>
                {zoneAbbr(zone, day)}
              </Text>
            </View>
          ))}
          <View style={[s.zoneCell, { width: GUTTER - 4 }]}>
            <Text style={[s.zoneName, s.local]} numberOfLines={1}>
              Local
            </Text>
          </View>
        </View>
      )}
      <View style={[s.allDay, grid && s.allDayGrid, bare && s.allDayBare]}>
        {!bare && (
          <Text style={[s.allDayLabel, { width: gutter - 4 }]}>
            All day{"\n"}no time
          </Text>
        )}
        <View style={s.allDayItems}>
          {allDay.some((slot) => slot.type !== "ghost") ? (
            allDay.map((slot) => {
              if (slot.type === "ghost") return null;
              if (slot.type === "external") {
                const x = slot.external;
                return (
                  <PressableScale
                    key={slot.key}
                    accessibilityRole="button"
                    accessibilityLabel={`${x.title}, all day, from ${x.name}. Read only`}
                    onPress={() => onExternal?.(x)}
                    style={[
                      s.allDayChip,
                      { backgroundColor: tint(x.color, 0.16) },
                      !x.busy && s.free,
                    ]}
                  >
                    <Icon name="lock" size={10} color={x.color} />
                    <Text numberOfLines={1} style={s.allDayText}>
                      {x.title}
                    </Text>
                  </PressableScale>
                );
              }
              const { title, status, item_id, list_id } =
                slot.type === "entry" ? slot.entry : slot.block;
              const entry = slot.type === "entry" ? slot.entry : undefined;
              const t = statusTones[status];
              const color = entry?.color || listColor(list_id);
              return (
                <PressableScale
                  key={slot.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, ${entry?.all_day ? "all day" : "no set time"}, ${statusLabels[status]}. Opens details`}
                  onPress={() => onOpen(item_id, entry)}
                  {...menuProps(slotMenu(slot))}
                  style={[
                    s.allDayChip,
                    { backgroundColor: color ? tint(color, 0.16) : t.bg },
                  ]}
                >
                  <View style={[s.dot, { backgroundColor: color ?? t.fg }]} />
                  <Text
                    numberOfLines={1}
                    style={[s.allDayText, status === "done" && s.doneText]}
                  >
                    {title}
                  </Text>
                </PressableScale>
              );
            })
          ) : (
            <Text style={shared.small}>Nothing without a time</Text>
          )}
        </View>
      </View>
      <View
        ref={body}
        collapsable={false}
        accessibilityLabel={
          zones.length
            ? `Day timeline, with times in ${zones.map(zoneCity).join(", ")}`
            : "Day timeline"
        }
        style={{ height: windowHeight + PAD_TOP * 2 }}
      >
        {hours.map((hour) => {
          const at = new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            hour,
          );
          return (
            <View
              key={hour}
              style={[s.hour, { top: PAD_TOP + (hour - start) * HOUR_HEIGHT }]}
              importantForAccessibility="no-hide-descendants"
            >
              {!bare &&
                zones.map((zone) => (
                  <Text key={zone} style={s.zoneHour} numberOfLines={1}>
                    {clockIn(zone, at)}
                  </Text>
                ))}
              {!bare && <Text style={s.hourLabel}>{hourLabel(hour % 24)}</Text>}
              <View style={s.hourLine} />
            </View>
          );
        })}
        {strips.map(({ m, spans }, i) =>
          spans.map(({ item: b, top, height }) => (
            <View
              key={`mate-${m.user_id}-${b.start_at}`}
              accessible
              accessibilityLabel={`${m.name} busy, ${timeLabel(new Date(b.start_at))} – ${timeLabel(new Date(b.end_at))}`}
              style={[
                s.strip,
                {
                  top: PAD_TOP + top,
                  height,
                  left: gutter + i * STRIP,
                  backgroundColor: m.color,
                },
              ]}
            />
          )),
        )}
        <View style={[s.events, { top: PAD_TOP, left: gutter + stripsWidth }]}>
          {/* Empty time, behind everything: hold and drag to keep it free. */}
          {!!onKeepFree && (
            <DrawLayer
              height={windowHeight}
              onBegin={beginDraw}
              onMove={moveDraw}
              onEnd={endDraw}
            />
          )}
          {!!draw && (
            <View
              pointerEvents="none"
              style={[
                s.keepFree,
                s.drawing,
                {
                  top: Math.min(draw.from, draw.to),
                  height: Math.max(4, Math.abs(draw.to - draw.from)),
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={s.keepFreeText}
                accessibilityLiveRegion="polite"
              >
                {drawLabel}
              </Text>
            </View>
          )}
          {freeBands.map(({ item: r, top, height }) => (
            <Pressable
              key={`free-${r.start_at}-${r.end_at}`}
              accessibilityRole="button"
              accessibilityLabel={`Kept free by the plan, ${timeLabel(new Date(r.start_at))} – ${timeLabel(new Date(r.end_at))}`}
              accessibilityHint={
                onKeepFreeMenu ? "Long-press for options" : undefined
              }
              disabled={!onKeepFreeMenu}
              {...menuProps(onKeepFreeMenu ? () => onKeepFreeMenu(r) : null)}
              style={({ pressed }) => [
                s.keepFree,
                { top, height },
                pressed && s.pressed,
              ]}
            >
              {height >= 16 && (
                <Text numberOfLines={1} style={s.keepFreeText}>
                  Kept free
                </Text>
              )}
            </Pressable>
          ))}
          {frameBands.map(({ item: f, top, height }) => (
            <Pressable
              key={`frame-${f.frame_id}-${f.date}`}
              accessibilityRole="button"
              accessibilityLabel={`${f.name} frame, ${timeLabel(new Date(f.start_at))} – ${timeLabel(new Date(f.end_at))}${f.busy ? ", busy" : ""}`}
              accessibilityHint={
                onFrameMenu
                  ? "Long-press to edit it or skip this day"
                  : undefined
              }
              disabled={!onFrameMenu}
              {...menuProps(onFrameMenu ? () => onFrameMenu(f) : null)}
              style={({ pressed }) => [
                s.frame,
                {
                  top,
                  height,
                  backgroundColor: tint(f.color, pressed ? 0.2 : 0.1),
                  borderLeftColor: f.color,
                },
              ]}
            >
              {height >= 16 && (
                <View style={s.frameLabel}>
                  <View style={[s.frameDot, { backgroundColor: f.color }]} />
                  <Text numberOfLines={1} style={s.frameText}>
                    {f.name}
                  </Text>
                  {f.busy && <Text style={s.frameBusy}>Busy</Text>}
                </View>
              )}
            </Pressable>
          ))}
          {bands.map(({ item: d, top, height }) => (
            <View
              key={`${d.kind}-${d.item_id}-${d.start_at}`}
              pointerEvents="none"
              accessible
              accessibilityLabel={`${d.label}, ${timeLabel(new Date(d.start_at))} – ${timeLabel(new Date(d.end_at))}`}
              style={[s.band, d.kind === "travel" && s.travel, { top, height }]}
            >
              {height >= 14 && (
                <Text numberOfLines={1} style={s.bandText}>
                  {d.label}
                </Text>
              )}
            </View>
          ))}
          {placed.map((p) => {
            const slot = p.slot;
            const compact = p.height < 44;
            const range = `${timeLabel(p.start)} – ${timeLabel(p.end)}`;
            const box = {
              position: "absolute" as const,
              top: p.top - shift,
              height: p.height,
              left: `${(p.column / p.columns) * 100}%` as const,
              width: `${100 / p.columns}%` as const,
              paddingRight: 3,
              paddingBottom: 2,
            };
            if (slot.type === "ghost") {
              const g = slot.ghost;
              const part = g.parts > 1 ? ` · ${g.part}/${g.parts}` : "";
              const label = `Planned, not saved yet${g.pinned ? ", pinned" : ""}: ${g.title}, ${range}${g.parts > 1 ? `, part ${g.part} of ${g.parts}` : ""}`;
              const content = (
                <>
                  <View style={s.blockTop}>
                    <Icon
                      name={g.pinned ? "pin" : "sparkles"}
                      size={11}
                      color={colors.accent}
                    />
                    <Text
                      numberOfLines={compact ? 1 : 2}
                      style={[s.eventTitle, s.blockTitle]}
                    >
                      {g.title}
                    </Text>
                  </View>
                  {!compact && (
                    <Text numberOfLines={1} style={s.blockTime}>
                      {range}
                      {part}
                    </Text>
                  )}
                </>
              );
              if (!onGhostMenu)
                return (
                  <View key={slot.key} style={box} pointerEvents="none">
                    <View
                      accessible
                      accessibilityLabel={label}
                      style={[s.event, s.ghost]}
                    >
                      {content}
                    </View>
                  </View>
                );
              const m: Movable = {
                id: slot.key,
                start_at: g.start_at,
                end_at: g.end_at,
              };
              const pin = (from: Date, to: Date) => onMoveGhost?.(g, from, to);
              const lifted = drag?.id === slot.key;
              return (
                <DraggableBlock
                  key={slot.key}
                  style={[box, lifted && s.above]}
                  blockStyle={[s.event, s.ghost, g.pinned && s.pinned]}
                  canDrag={canDrag(m, !!onMoveGhost)}
                  lifted={lifted}
                  gripColor={colors.accent}
                  badge={dayBadge(slot.key)}
                  accessibilityLabel={`${label}. Opens task details`}
                  onTap={() => onOpen(g.item_id)}
                  onMenu={() => onGhostMenu(g)}
                  onBegin={() => begin(m)}
                  onDrag={(mode, dy, dx) => dragTo(m, mode, dy, dx)}
                  onEnd={(commit) => finish(m, commit, pin)}
                  onAction={(name) =>
                    name === "activate"
                      ? onOpen(g.item_id)
                      : name === MORE.name
                        ? onGhostMenu(g)
                        : nudge(m, name, pin)
                  }
                >
                  {content}
                </DraggableBlock>
              );
            }
            if (slot.type === "block") {
              const b = slot.block;
              const color = listColor(b.list_id);
              const lifted = drag?.id === b.id;
              const save = (from: Date, to: Date) => onMoveBlock?.(b, from, to);
              return (
                <DraggableBlock
                  key={slot.key}
                  style={[box, lifted && s.above]}
                  blockStyle={[
                    s.event,
                    s.block,
                    !!color && { borderColor: color },
                  ]}
                  canDrag={canDrag(b, !!onMoveBlock)}
                  lifted={lifted}
                  gripColor={color ?? colors.accent}
                  badge={dayBadge(b.id)}
                  accessibilityLabel={`Time block for ${b.title}, ${range}. Opens task details`}
                  onTap={() => onOpen(b.item_id)}
                  onMenu={() => onBlockMenu(b)}
                  onBegin={() => begin(b)}
                  onDrag={(mode, dy, dx) => dragTo(b, mode, dy, dx)}
                  onEnd={(commit) => finish(b, commit, save)}
                  onAction={(name) =>
                    name === "activate"
                      ? onOpen(b.item_id)
                      : name === MORE.name
                        ? onBlockMenu(b)
                        : nudge(b, name, save)
                  }
                >
                  <View style={s.blockTop}>
                    <Icon
                      name="target"
                      size={11}
                      color={color ?? colors.accent}
                    />
                    <Text
                      numberOfLines={compact ? 1 : 2}
                      style={[
                        s.eventTitle,
                        color ? s.grow : s.blockTitle,
                        b.status === "done" && s.doneText,
                      ]}
                    >
                      {b.title}
                    </Text>
                  </View>
                  {!compact && (
                    <Text
                      numberOfLines={1}
                      style={[s.blockTime, !!color && s.softTime]}
                    >
                      {range}
                    </Text>
                  )}
                </DraggableBlock>
              );
            }
            if (slot.type === "external") {
              const x = slot.external;
              return (
                <View key={slot.key} style={box}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${x.title}, ${range}, from ${x.name}. Read only`}
                    onPress={() => onExternal?.(x)}
                    style={({ pressed }) => [
                      s.event,
                      {
                        backgroundColor: tint(x.color, 0.14),
                        borderLeftColor: x.color,
                      },
                      !x.busy && s.free,
                      pressed && s.pressed,
                    ]}
                  >
                    <View style={s.blockTop}>
                      <Icon name="lock" size={10} color={x.color} />
                      <Text
                        numberOfLines={compact ? 1 : 2}
                        style={s.eventTitle}
                      >
                        {x.title}
                      </Text>
                    </View>
                    {!compact && (
                      <Text numberOfLines={1} style={[s.eventTime, s.softTime]}>
                        {range}
                        {x.location ? ` · ${x.location}` : ""}
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            }
            const e = slot.entry;
            const t = statusTones[e.status];
            // Its own colour first, then its list's, then its status.
            const color = e.color || listColor(e.list_id);
            const tone = color
              ? { backgroundColor: tint(color, 0.16), borderLeftColor: color }
              : { backgroundColor: t.bg, borderLeftColor: t.fg };
            const free = e.kind === "event" && e.busy === false;
            const label = `${e.title}, ${range}, ${e.kind === "event" ? (free ? "free" : "event") : statusLabels[e.status]}${e.occurrence ? ", repeats" : ""}. Opens details`;
            const content = (
              <>
                <View style={s.blockTop}>
                  {!!e.occurrence && (
                    <Icon name="repeat" size={10} color={color ?? t.fg} />
                  )}
                  <Text
                    numberOfLines={compact ? 1 : 2}
                    style={[s.eventTitle, e.status === "done" && s.doneText]}
                  >
                    {e.title}
                  </Text>
                </View>
                {!compact && (
                  <Text
                    numberOfLines={1}
                    style={[
                      s.eventTime,
                      { color: color ? colors.textSoft : t.fg },
                    ]}
                  >
                    {range}
                    {free ? " · Free" : ""}
                    {e.location ? ` · ${e.location}` : ""}
                  </Text>
                )}
              </>
            );
            if (onMoveEntry && e.kind === "event" && e.end_at) {
              const m: Movable = {
                id: slot.key,
                start_at: e.start_at,
                end_at: e.end_at,
              };
              const save = (from: Date, to: Date) => onMoveEntry(e, from, to);
              const lifted = drag?.id === slot.key;
              return (
                <DraggableBlock
                  key={slot.key}
                  style={[box, lifted && s.above]}
                  blockStyle={[s.event, tone, free && s.free]}
                  canDrag={canDrag(m, true)}
                  lifted={lifted}
                  gripColor={color ?? t.fg}
                  badge={dayBadge(slot.key)}
                  accessibilityLabel={label}
                  onTap={() => onOpen(e.item_id, e)}
                  onMenu={() => onEntryMenu(e)}
                  onBegin={() => begin(m)}
                  onDrag={(mode, dy, dx) => dragTo(m, mode, dy, dx)}
                  onEnd={(commit) => finish(m, commit, save)}
                  onAction={(name) =>
                    name === "activate"
                      ? onOpen(e.item_id, e)
                      : name === MORE.name
                        ? onEntryMenu(e)
                        : nudge(m, name, save)
                  }
                >
                  {content}
                </DraggableBlock>
              );
            }
            return (
              <View key={slot.key} style={box}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint="Long-press for options"
                  onPress={() => onOpen(e.item_id, e)}
                  {...menuProps(slotMenu(slot))}
                  style={({ pressed }) => [
                    s.event,
                    tone,
                    free && s.free,
                    pressed && s.pressed,
                  ]}
                >
                  {content}
                </Pressable>
              </View>
            );
          })}
        </View>
        {showNow && (
          <View
            pointerEvents="none"
            accessible
            accessibilityLabel={`Current time, ${timeLabel(now)}`}
            style={[
              s.now,
              {
                top: PAD_TOP + nowTop - shift - 1,
                left: Math.max(0, gutter - 5),
              },
            ]}
          >
            <View style={s.nowDot} />
            <View style={s.nowLine} />
          </View>
        )}
      </View>
      {!fitsAll && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setAllHours(!allHours)}
          style={({ pressed }) => [s.hoursToggle, pressed && s.pressed]}
        >
          <Text style={s.hoursToggleText}>
            {allHours ? "Show just the busy hours" : "Show all 24 hours"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Empty time under the day's blocks: hold it, then drag up or down to draw a
 * range (the plan preview keeps it free). Before the hold a swipe scrolls
 * the page as usual. Screen readers use the "Keep a time free…" form.
 */
function DrawLayer({
  height,
  onBegin,
  onMove,
  onEnd,
}: {
  height: number;
  onBegin: (y: number) => void;
  onMove: (y: number) => void;
  onEnd: (commit: boolean) => void;
}) {
  const latest = useRef({ onBegin, onMove, onEnd });
  latest.current = { onBegin, onMove, onEnd };
  const hold = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    lifted: boolean;
    y: number;
  }>({ timer: null, lifted: false, y: 0 }).current;
  const cancelHold = () => {
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = null;
  };
  // Never leave the page locked if the timeline goes away mid-draw.
  useEffect(
    () => () => {
      cancelHold();
      if (hold.lifted) {
        hold.lifted = false;
        latest.current.onEnd(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // A swipe on empty time still scrolls the page until the hold.
      onShouldBlockNativeResponder: () => false,
      onPanResponderGrant: (e) => {
        hold.lifted = false;
        hold.y = e.nativeEvent.locationY;
        hold.timer = setTimeout(() => {
          hold.timer = null;
          hold.lifted = true;
          latest.current.onBegin(hold.y);
        }, HOLD_MS);
      },
      onPanResponderMove: (_, g) => {
        if (hold.lifted) latest.current.onMove(hold.y + g.dy);
        else if (hold.timer && (Math.abs(g.dx) > SLOP || Math.abs(g.dy) > SLOP))
          cancelHold();
      },
      onPanResponderTerminationRequest: () => !hold.lifted,
      onPanResponderRelease: () => {
        cancelHold();
        if (!hold.lifted) return;
        hold.lifted = false;
        latest.current.onEnd(true);
      },
      onPanResponderTerminate: () => {
        cancelHold();
        if (hold.lifted) {
          hold.lifted = false;
          latest.current.onEnd(false);
        }
      },
    }),
  ).current;
  return (
    <View
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={[s.drawLayer, { height }]}
      {...pan.panHandlers}
    />
  );
}

/**
 * A block: tap to open its task. Hold it to lift it, then drag to move it
 * (let go without moving for its menu); drag the grip on its bottom edge to
 * change its length. Before it lifts, a swipe scrolls the page as usual.
 */
function DraggableBlock({
  style,
  blockStyle,
  canDrag,
  lifted,
  gripColor,
  badge,
  accessibilityLabel,
  onTap,
  onMenu,
  onBegin,
  onDrag,
  onEnd,
  onAction,
  children,
}: {
  style: StyleProp<ViewStyle>;
  blockStyle: StyleProp<ViewStyle>;
  canDrag: boolean;
  lifted: boolean;
  gripColor: string;
  /** Shown on the block while it's dragged, e.g. the day it moves to. */
  badge?: string;
  accessibilityLabel: string;
  onTap: () => void;
  onMenu: () => void;
  onBegin: () => void;
  onDrag: (mode: DragMode, dy: number, dx: number) => void;
  /** End the drag (saving it when `commit`); true when the block moved. */
  onEnd: (commit: boolean) => boolean;
  onAction: (name: string) => void;
  children: React.ReactNode;
}) {
  const [pressed, setPressed] = useState(false);
  // Latest props for the long-lived pan responders.
  const latest = useRef({ canDrag, onTap, onMenu, onBegin, onDrag, onEnd });
  latest.current = { canDrag, onTap, onMenu, onBegin, onDrag, onEnd };
  const hold = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    lifted: boolean;
  }>({ timer: null, lifted: false }).current;
  const cancelHold = () => {
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = null;
  };
  // Never leave the page locked if the block goes away mid-drag.
  useEffect(
    () => () => {
      cancelHold();
      if (hold.lifted) {
        hold.lifted = false;
        latest.current.onEnd(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const body = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // PanResponder blocks native scrolling by default (Android): a swipe
      // that starts on a block must still scroll the page until it lifts.
      onShouldBlockNativeResponder: () => false,
      onPanResponderGrant: () => {
        hold.lifted = false;
        setPressed(true);
        hold.timer = setTimeout(() => {
          hold.timer = null;
          setPressed(false);
          if (latest.current.canDrag) {
            hold.lifted = true;
            latest.current.onBegin();
          } else latest.current.onMenu();
        }, HOLD_MS);
      },
      onPanResponderMove: (_, g) => {
        if (hold.lifted) latest.current.onDrag("move", g.dy, g.dx);
        else if (
          hold.timer &&
          (Math.abs(g.dx) > SLOP || Math.abs(g.dy) > SLOP)
        ) {
          cancelHold();
          setPressed(false);
        }
      },
      // Before the block lifts the page may scroll instead; after, it can't.
      onPanResponderTerminationRequest: () => !hold.lifted,
      onPanResponderRelease: () => {
        setPressed(false);
        if (hold.timer) {
          cancelHold();
          latest.current.onTap();
          return;
        }
        if (!hold.lifted) return;
        hold.lifted = false;
        // Held and let go without moving: the block's menu, like a long-press.
        if (!latest.current.onEnd(true)) latest.current.onMenu();
      },
      onPanResponderTerminate: () => {
        cancelHold();
        setPressed(false);
        if (hold.lifted) {
          hold.lifted = false;
          latest.current.onEnd(false);
        }
      },
    }),
  ).current;
  const grip = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.canDrag,
      onPanResponderGrant: () => latest.current.onBegin(),
      onPanResponderMove: (_, g) => latest.current.onDrag("resize", g.dy, 0),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        latest.current.onEnd(true);
      },
      onPanResponderTerminate: () => {
        latest.current.onEnd(false);
      },
    }),
  ).current;

  return (
    <View style={style}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={
          canDrag
            ? "Hold, then drag up or down to change its time, or sideways to move it to another day. More actions move it too."
            : "Hold for options"
        }
        accessibilityActions={
          canDrag ? BLOCK_ACTIONS : BLOCK_ACTIONS.slice(0, 2)
        }
        onAccessibilityAction={(e) => onAction(e.nativeEvent.actionName)}
        style={[blockStyle, pressed && s.pressed, lifted && s.lifted]}
        {...body.panHandlers}
      >
        {children}
        {canDrag && (
          <View style={s.grip} {...grip.panHandlers}>
            <View style={[s.gripBar, { backgroundColor: gripColor }]} />
          </View>
        )}
      </View>
      {!!badge && (
        <View style={s.badge} pointerEvents="none">
          <Text style={s.badgeText} accessibilityLiveRegion="polite">
            {badge}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 22,
    },
    zoneHead: {
      flexDirection: "row",
      paddingTop: 8,
      paddingBottom: 2,
      backgroundColor: colors.surfaceMuted,
    },
    zoneCell: { width: ZONE_WIDTH, paddingRight: 4 },
    zoneName: {
      textAlign: "right",
      fontFamily: fonts.semibold,
      fontSize: 9,
      color: colors.muted,
    },
    zoneAbbr: {
      textAlign: "right",
      fontFamily: fonts.medium,
      fontSize: 9,
      color: colors.faint,
    },
    local: { paddingRight: 4 },
    allDay: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingRight: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surfaceMuted,
    },
    /** Days side by side: the same height in every column, so the hours line up. */
    allDayGrid: { height: 58, overflow: "hidden" },
    allDayBare: { paddingLeft: 8 },
    hidden: { opacity: 0 },
    allDayLabel: {
      textAlign: "right",
      fontFamily: fonts.medium,
      fontSize: 10,
      lineHeight: 13,
      color: colors.muted,
    },
    allDayItems: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
    allDayChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      maxWidth: "100%",
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    allDayText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.text,
    },
    dot: { width: 7, height: 7, borderRadius: 4 },
    hour: {
      position: "absolute",
      left: 0,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      height: 14,
      marginTop: -7,
    },
    zoneHour: {
      width: ZONE_WIDTH,
      textAlign: "right",
      paddingRight: 4,
      fontFamily: fonts.medium,
      fontSize: 9,
      color: colors.faint,
    },
    hourLabel: {
      width: GUTTER - 4,
      textAlign: "right",
      paddingRight: 8,
      fontFamily: fonts.medium,
      fontSize: 10,
      color: colors.faint,
    },
    hourLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    events: { position: "absolute", right: 6, bottom: 0 },
    frame: {
      position: "absolute",
      left: 0,
      right: 0,
      borderLeftWidth: 3,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingTop: 3,
      alignItems: "flex-end",
    },
    frameLabel: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      maxWidth: "70%",
    },
    frameDot: { width: 6, height: 6, borderRadius: 3 },
    frameText: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 10,
      color: colors.textSoft,
    },
    frameBusy: {
      fontFamily: fonts.semibold,
      fontSize: 9,
      color: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
      paddingHorizontal: 5,
      overflow: "hidden",
    },
    band: {
      position: "absolute",
      left: 0,
      right: 3,
      borderRadius: 6,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 8,
      justifyContent: "center",
    },
    travel: { backgroundColor: colors.soft },
    bandText: {
      fontFamily: fonts.medium,
      fontSize: 10,
      color: colors.muted,
    },
    event: {
      flex: 1,
      borderLeftWidth: 3,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      overflow: "hidden",
    },
    pressed: { opacity: 0.7 },
    /** Free events and calendars that don't count as busy: lighter. */
    free: { opacity: 0.6 },
    block: {
      borderWidth: 1.5,
      borderLeftWidth: 1.5,
      borderStyle: "dashed",
      borderColor: colors.accent,
      backgroundColor: colors.surface,
    },
    lifted: {
      borderStyle: "solid",
      shadowColor: colors.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    above: { zIndex: 2, elevation: 4 },
    ghost: {
      borderWidth: 1.5,
      borderLeftWidth: 1.5,
      borderStyle: "dashed",
      borderColor: colors.accent,
      backgroundColor: tint(colors.accent, 0.1),
      opacity: 0.8,
    },
    pinned: { borderStyle: "solid", opacity: 0.9 },
    grip: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    gripBar: { width: 18, height: 3, borderRadius: 2, opacity: 0.6 },
    blockTop: { flexDirection: "row", alignItems: "center", gap: 4 },
    grow: { flex: 1 },
    blockTitle: { flex: 1, color: colors.accent },
    blockTime: {
      fontFamily: fonts.medium,
      fontSize: 11,
      marginTop: 1,
      color: colors.accent,
    },
    softTime: { color: colors.textSoft },
    eventTitle: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 12,
      lineHeight: 16,
      color: colors.text,
    },
    eventTime: { fontFamily: fonts.medium, fontSize: 11, marginTop: 1 },
    doneText: { color: colors.faint, textDecorationLine: "line-through" },
    now: {
      position: "absolute",
      right: 0,
      flexDirection: "row",
      alignItems: "center",
    },
    nowDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: colors.danger,
      marginTop: 1,
    },
    nowLine: { flex: 1, height: 2, backgroundColor: colors.danger },
    keepFree: {
      position: "absolute",
      left: 0,
      right: 3,
      borderRadius: 6,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.faint,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 8,
      justifyContent: "center",
    },
    keepFreeText: {
      fontFamily: fonts.semibold,
      fontSize: 10,
      color: colors.muted,
    },
    /** The range being drawn: the kept-free look, outlined in the accent. */
    drawing: { borderColor: colors.accent, zIndex: 3, elevation: 3 },
    drawLayer: { position: "absolute", left: 0, right: 0, top: 0 },
    strip: {
      position: "absolute",
      width: STRIP - 1,
      borderRadius: 2,
      opacity: 0.85,
    },
    hoursToggle: {
      alignItems: "center",
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    hoursToggleText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    badge: {
      position: "absolute",
      top: -10,
      right: 4,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
      paddingHorizontal: 8,
      paddingVertical: 2,
      zIndex: 3,
      elevation: 5,
    },
    badgeText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.white,
    },
  }),
);
