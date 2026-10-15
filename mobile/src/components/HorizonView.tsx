import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  clockMinutes,
  dayTime,
  dependencyConflict,
  horizonLanes,
  laneLabel,
  localDateKey,
  onDay,
  type Item,
  type Plan,
  type PlannedBlock,
} from "@orbyn/core";
import { InlineDetails } from "./InlineDetails";
import { Chip, ChipRow } from "./Chip";
import { Icon } from "./Icon";
import { minutesLabel, rangeLabel } from "../lib/planning";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { tap } from "../lib/haptics";

type Lane = { day: string; top: number; bottom: number };

/**
 * The plan as days ahead, one lane a day. Press and hold a session to drag
 * it to another day, or tap it and pick a day: either way it's pinned there
 * at the same time and the rest is planned around it. Tasks the plan
 * couldn't place wait below and can be put on a day the same way. A move
 * that would start a task before what it waits on is refused, and says why.
 */
export function HorizonView({
  plan,
  items,
  timeZone,
  workStart,
  busy,
  onPin,
  onPlace,
  onDragging,
}: {
  plan: Plan;
  items: Item[];
  timeZone: string;
  workStart: string;
  busy: boolean;
  /** Keep a session at new times. */
  onPin: (block: PlannedBlock, start: Date, end: Date) => void;
  /** Put a task the plan couldn't place at these times. */
  onPlace: (itemId: string, start: Date, end: Date) => void;
  /** While dragging, the page shouldn't scroll. */
  onDragging?: (on: boolean) => void;
}) {
  const lanes = horizonLanes(plan, timeZone);
  const today = localDateKey(new Date(), timeZone);
  const refs = useRef(new Map<string, View>());
  const bounds = useRef<Lane[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const measure = () => {
    bounds.current = [];
    for (const lane of lanes) {
      const view = refs.current.get(lane.day);
      view?.measureInWindow((_x, y, _w, h) => {
        bounds.current.push({ day: lane.day, top: y, bottom: y + h });
      });
    }
  };
  const laneAt = (pageY: number) =>
    bounds.current.find((b) => pageY >= b.top && pageY <= b.bottom)?.day ??
    null;

  const estimateOf = (itemId: string) =>
    plan.tasks?.find((t) => t.item_id === itemId)?.estimate_minutes ??
    items.find((i) => i.id === itemId)?.estimate_minutes ??
    30;

  const tryMove = (
    target: { block?: PlannedBlock; itemId: string },
    day: string,
  ) => {
    if (busy) return;
    setNotice("");
    let start: Date;
    let end: Date;
    if (target.block) {
      if (localDateKey(new Date(target.block.start_at), timeZone) === day)
        return;
      ({ start, end } = onDay(target.block, day, timeZone));
    } else {
      start = dayTime(day, clockMinutes(workStart), timeZone);
      end = new Date(
        start.getTime() + Math.min(estimateOf(target.itemId), 240) * 60_000,
      );
    }
    const clash = dependencyConflict(target.itemId, start, end, plan, items);
    if (clash) {
      setNotice(clash);
      AccessibilityInfo.announceForAccessibility(clash);
      return;
    }
    setPicked(null);
    if (target.block) onPin(target.block, start, end);
    else onPlace(target.itemId, start, end);
  };

  const dayChips = (onPick: (day: string) => void, current?: string) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <ChipRow label="Move to">
        {lanes.map((l) => (
          <Chip
            key={l.day}
            compact
            label={laneLabel(l.day, today)}
            selected={l.day === current}
            disabled={busy}
            onPress={() => onPick(l.day)}
          />
        ))}
      </ChipRow>
    </ScrollView>
  );

  return (
    <View style={s.wrap}>
      <InlineDetails title="Moving sessions">
        <Text style={shared.small}>
          Tap to choose a day, or hold and drag. Moved sessions stay pinned.
        </Text>
      </InlineDetails>
      {!!notice && (
        <View style={s.notice} accessibilityRole="alert">
          <Icon name="alert" size={14} color={colors.danger} />
          <Text style={s.noticeText}>{notice}</Text>
        </View>
      )}
      {lanes.map((lane) => (
        <View
          key={lane.day}
          ref={(v) => {
            if (v) refs.current.set(lane.day, v);
          }}
          collapsable={false}
          style={[s.lane, over === lane.day && s.laneOver]}
        >
          <View style={s.laneHead}>
            <Text style={s.laneDay}>{laneLabel(lane.day, today)}</Text>
            <Text style={shared.small}>
              {lane.minutes ? minutesLabel(lane.minutes) : "Free"}
            </Text>
          </View>
          {lane.blocks.map((b) => {
            const key = `${b.item_id}-${b.start_at}`;
            return (
              <View key={key}>
                <DragCard
                  disabled={busy}
                  onStart={() => {
                    measure();
                    onDragging?.(true);
                  }}
                  onCancel={() => {
                    onDragging?.(false);
                    setOver(null);
                  }}
                  onMove={(y) => setOver(laneAt(y))}
                  onDrop={(y) => {
                    onDragging?.(false);
                    setOver(null);
                    const day = laneAt(y);
                    if (day) tryMove({ block: b, itemId: b.item_id }, day);
                  }}
                  onPress={() => {
                    setPicked(picked === key ? null : key);
                  }}
                  label={`${b.title}, ${rangeLabel(b.start_at, b.end_at)}${b.pinned ? ", pinned" : ""}. Tap to move to another day.`}
                >
                  <View style={[s.card, b.pinned && s.pinned]}>
                    <Icon name="list" size={14} color={colors.muted} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.cardTitle}>
                        {b.title}
                        {b.parts > 1 ? ` (${b.part}/${b.parts})` : ""}
                      </Text>
                      <Text style={shared.small}>
                        {rangeLabel(b.start_at, b.end_at)}
                        {b.pinned ? " · pinned" : ""}
                      </Text>
                    </View>
                  </View>
                </DragCard>
                {picked === key &&
                  dayChips(
                    (day) => tryMove({ block: b, itemId: b.item_id }, day),
                    lane.day,
                  )}
              </View>
            );
          })}
        </View>
      ))}
      {plan.unplaced.length > 0 && (
        <View style={s.tray}>
          <Text style={shared.label}>Not placed yet</Text>
          {plan.unplaced.map((u) => (
            <View key={u.item_id}>
              <DragCard
                disabled={busy}
                onStart={() => {
                  measure();
                  onDragging?.(true);
                }}
                onCancel={() => {
                  onDragging?.(false);
                  setOver(null);
                }}
                onMove={(y) => setOver(laneAt(y))}
                onDrop={(y) => {
                  onDragging?.(false);
                  setOver(null);
                  const day = laneAt(y);
                  if (day) tryMove({ itemId: u.item_id }, day);
                }}
                onPress={() => {
                  setPicked(picked === u.item_id ? null : u.item_id);
                }}
                label={`${u.title}, not placed yet: ${u.reason}. Tap to put it on a day.`}
              >
                <View style={[s.card, s.unplaced]}>
                  <Icon name="clock" size={14} color={colors.muted} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.cardTitle}>{u.title}</Text>
                    <Text style={shared.small}>{u.reason}</Text>
                  </View>
                </View>
              </DragCard>
              {picked === u.item_id &&
                dayChips((day) => tryMove({ itemId: u.item_id }, day))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * A card that can be picked up with a long press and dragged, and still
 * works as a button. Taps and scrolling pass through until it is held.
 */
function DragCard({
  children,
  disabled,
  label,
  onPress,
  onStart,
  onMove,
  onDrop,
  onCancel,
}: {
  onCancel: () => void;
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onPress: () => void;
  onStart: () => void;
  onMove: (pageY: number) => void;
  onDrop: (pageY: number) => void;
}) {
  const armed = useRef(false);
  const moved = useRef(false);
  const y = useRef(new Animated.Value(0)).current;
  const [lifted, setLifted] = useState(false);
  const latest = useRef({ onMove, onDrop, onCancel, disabled });
  latest.current = { onMove, onDrop, onCancel, disabled };
  useEffect(
    () => () => {
      if (armed.current) latest.current.onCancel();
    },
    [],
  );
  const reset = () => {
    armed.current = false;
    setLifted(false);
    moved.current = false;
    y.setValue(0);
  };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: () => {
        if (!armed.current || latest.current.disabled) return false;
        moved.current = true;
        return true;
      },
      onMoveShouldSetPanResponder: () => {
        if (!armed.current || latest.current.disabled) return false;
        moved.current = true;
        return true;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => {
        if (!armed.current || latest.current.disabled) return;
        moved.current = true;
        y.setValue(g.dy);
        latest.current.onMove(g.moveY);
      },
      onPanResponderRelease: (_e, g) => {
        if (armed.current) {
          if (latest.current.disabled) latest.current.onCancel();
          else latest.current.onDrop(g.moveY);
        }
        reset();
      },
      onPanResponderTerminate: () => {
        latest.current.onCancel();
        reset();
      },
    }),
  ).current;
  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        { transform: [{ translateY: y }] },
        lifted && { zIndex: 10, elevation: 6, opacity: 0.92 },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        delayLongPress={280}
        onLongPress={() => {
          tap();
          if (latest.current.disabled) return;
          armed.current = true;
          moved.current = false;
          setLifted(true);
          onStart();
        }}
        onPressOut={() => {
          // Held but never moved: put it back down.
          if (armed.current && !moved.current) {
            latest.current.onCancel();
            reset();
          }
        }}
        onPress={onPress}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8 },
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.dangerSoft,
    },
    noticeText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.danger,
    },
    lane: {
      padding: 10,
      gap: 6,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    laneOver: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    laneHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      flexWrap: "wrap",
      gap: 6,
    },
    laneDay: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    pinned: { borderLeftWidth: 3, borderLeftColor: colors.accent },
    unplaced: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: colors.border,
    },
    cardTitle: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    tray: { gap: 6, marginTop: 6 },
  }),
);
