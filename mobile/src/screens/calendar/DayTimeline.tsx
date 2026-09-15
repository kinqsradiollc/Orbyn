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
  type CalendarEntry,
  type DerivedBlock,
  type FrameOccurrence,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { useNow } from "../../hooks/useNow";
import { usePlanning } from "../../lib/planningContext";
import { isReducedMotion, PressableScale } from "../../motion";
import { colors, fonts, radii, statusTones, themed, tint } from "../../theme";
import { shared } from "../../styles";
import {
  DAY_END,
  DAY_START,
  HOUR_HEIGHT,
  hourLabel,
  layoutDay,
  offsetFor,
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

/** An occurrence of an item, time set aside for a task, or a planned block not saved yet. */
export type TimelineSlot =
  | (Slot & { type: "entry"; entry: CalendarEntry })
  | (Slot & { type: "block"; block: TimeBlock })
  | (Slot & { type: "ghost"; ghost: PlannedBlock });

type DragMode = "move" | "resize";
type Drag = { id: string; start: Date; end: Date };
/** Anything that can be dragged: a saved block, or a planned one. */
type Movable = { id: string; start_at: string; end_at: string };

/**
 * The whole hours a day needs: every timed plan and frame, plus an hour either
 * side of now today, widened to at least MIN_HOURS inside the 6am-midnight
 * window.
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
  onMoveBlock,
  onGhostMenu,
  onMoveGhost,
  onFrameMenu,
  onDragging,
}: {
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
  /** Open the task or event behind an entry or block. */
  onOpen: (itemId: string) => void;
  onBlockMenu: (block: TimeBlock) => void;
  /** Only called for repeating occurrences. */
  onEntryMenu: (entry: CalendarEntry) => void;
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
}) {
  const now = useNow(60_000);
  const { listById } = usePlanning();
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** The hours shown when a drag began, kept still until it ends. */
  const frozen = useRef<{ start: number; end: number } | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const listColor = (id: string | null) =>
    id ? listById.get(id)?.color : undefined;
  const ghostKey = (g: PlannedBlock) => `ghost-${g.item_id}-${g.start_at}`;

  const shownSlots: TimelineSlot[] = [
    ...slots.map((slot): TimelineSlot =>
      slot.type === "block" && drag?.id === slot.block.id
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

  const fitted = visibleHours(
    [...placed, ...frameSpans],
    showNow ? nowTop : null,
  );
  const { start, end } = (drag && frozen.current) || fitted;
  // layoutDay measures from DAY_START; shift everything up to the first shown hour.
  const shift = (start - DAY_START) * HOUR_HEIGHT;
  const hours = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const windowHeight = (end - start) * HOUR_HEIGHT;
  const gutter = GUTTER + zones.length * ZONE_WIDTH;
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
    setDrag({ id: m.id, start: new Date(m.start_at), end: new Date(m.end_at) });
    onDragging?.(true);
    // A light tick where the platform has one without a haptics module.
    if (Platform.OS === "android" && !isReducedMotion()) Vibration.vibrate(10);
  };
  const dragTo = (m: Movable, mode: DragMode, dy: number) => {
    const win = frozen.current ?? { start, end };
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
      current.end.getTime() !== to.getTime()
    )
      setDrag({ id: m.id, start: from, end: to });
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
    const moved =
      d.start.getTime() !== Date.parse(m.start_at) ||
      d.end.getTime() !== Date.parse(m.end_at);
    if (moved) save(d.start, d.end);
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
      : slot.type === "entry" && slot.entry.occurrence
        ? () => onEntryMenu(slot.entry)
        : null;

  return (
    <View style={s.card}>
      {zones.length > 0 && (
        <View
          style={s.zoneHead}
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
      <View style={s.allDay}>
        <Text style={[s.allDayLabel, { width: gutter - 4 }]}>
          All day{"\n"}no time
        </Text>
        <View style={s.allDayItems}>
          {allDay.some((slot) => slot.type !== "ghost") ? (
            allDay.map((slot) => {
              if (slot.type === "ghost") return null;
              const { title, status, item_id, list_id } =
                slot.type === "entry" ? slot.entry : slot.block;
              const t = statusTones[status];
              const color = listColor(list_id);
              return (
                <PressableScale
                  key={slot.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, no set time, ${statusLabels[status]}. Opens task details`}
                  onPress={() => onOpen(item_id)}
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
              {zones.map((zone) => (
                <Text key={zone} style={s.zoneHour} numberOfLines={1}>
                  {clockIn(zone, at)}
                </Text>
              ))}
              <Text style={s.hourLabel}>{hourLabel(hour % 24)}</Text>
              <View style={s.hourLine} />
            </View>
          );
        })}
        <View style={[s.events, { top: PAD_TOP, left: gutter }]}>
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
                  accessibilityLabel={`${label}. Opens task details`}
                  onTap={() => onOpen(g.item_id)}
                  onMenu={() => onGhostMenu(g)}
                  onBegin={() => begin(m)}
                  onDrag={(mode, dy) => dragTo(m, mode, dy)}
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
                  accessibilityLabel={`Time block for ${b.title}, ${range}. Opens task details`}
                  onTap={() => onOpen(b.item_id)}
                  onMenu={() => onBlockMenu(b)}
                  onBegin={() => begin(b)}
                  onDrag={(mode, dy) => dragTo(b, mode, dy)}
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
            const e = slot.entry;
            const t = statusTones[e.status];
            const color = listColor(e.list_id);
            return (
              <View key={slot.key} style={box}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${e.title}, ${range}, ${statusLabels[e.status]}${e.occurrence ? ", repeats" : ""}. Opens task details`}
                  accessibilityHint={
                    e.occurrence
                      ? "Long-press to skip this occurrence"
                      : undefined
                  }
                  onPress={() => onOpen(e.item_id)}
                  {...menuProps(slotMenu(slot))}
                  style={({ pressed }) => [
                    s.event,
                    color
                      ? {
                          backgroundColor: tint(color, 0.16),
                          borderLeftColor: color,
                        }
                      : { backgroundColor: t.bg, borderLeftColor: t.fg },
                    pressed && s.pressed,
                  ]}
                >
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
                      {e.location ? ` · ${e.location}` : ""}
                    </Text>
                  )}
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
              { top: PAD_TOP + nowTop - shift - 1, left: gutter - 5 },
            ]}
          >
            <View style={s.nowDot} />
            <View style={s.nowLine} />
          </View>
        )}
      </View>
    </View>
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
  accessibilityLabel: string;
  onTap: () => void;
  onMenu: () => void;
  onBegin: () => void;
  onDrag: (mode: DragMode, dy: number) => void;
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
        if (hold.lifted) latest.current.onDrag("move", g.dy);
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
      onPanResponderMove: (_, g) => latest.current.onDrag("resize", g.dy),
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
            ? "Hold, then drag to move. More actions move it too."
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
  }),
);
