import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  dayHeading,
  sessionLine,
  type CalendarEntry,
  type ExternalEntry,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { StatusPill } from "../../components/Pill";
import { usePlanning } from "../../lib/planningContext";
import { canJoin, rangeLabel } from "../../lib/planning";
import { FadeIn } from "../../motion";
import { colors, fonts, radii, statusTones, themed } from "../../theme";
import { shared } from "../../styles";
import { covers, startOfDay, timeLabel } from "./dates";
import { tap } from "../../lib/haptics";

type Timed = { start_at: string; end_at: string | null; all_day?: boolean };

/** Width of the time column at the default text size. */
const TIME_WIDTH = 64;

/** All-day, or running over midnight: shown as "All day" rather than a time. */
const wholeDay = (x: Timed) =>
  !!x.all_day ||
  (!!x.end_at &&
    startOfDay(new Date(Date.parse(x.end_at) - 1)).getTime() >
      startOfDay(new Date(x.start_at)).getTime());

type Row =
  | { key: string; at: number; entry: CalendarEntry }
  | { key: string; at: number; block: TimeBlock }
  | { key: string; at: number; external: ExternalEntry }
  | { key: string; at: number; ghost: PlannedBlock };

/**
 * The days shown as a list, day by day: events and tasks (repeats as
 * occurrences), time blocks, events from subscribed calendars and planned
 * blocks not saved yet. Tap to open, hold for options.
 */
export function AgendaList({
  days,
  entries,
  blocks,
  external,
  ghosts,
  now,
  onOpen,
  onEntryMenu,
  onBlockMenu,
  onExternal,
  onGhostMenu,
  onJoin,
}: {
  days: Date[];
  entries: CalendarEntry[];
  blocks: TimeBlock[];
  external: ExternalEntry[];
  ghosts: PlannedBlock[];
  now: Date;
  onOpen: (itemId: string, entry?: CalendarEntry) => void;
  onEntryMenu: (entry: CalendarEntry) => void;
  onBlockMenu: (block: TimeBlock) => void;
  onExternal: (event: ExternalEntry) => void;
  onGhostMenu: (ghost: PlannedBlock) => void;
  onJoin: (entry: CalendarEntry) => void;
}) {
  const { listById } = usePlanning();
  const filled = days
    .map((day) => {
      const rows: Row[] = [
        ...entries
          .filter((e) => covers(e, day))
          .map((entry) => ({
            key: `e-${entry.item_id}-${entry.start_at}`,
            at: wholeDay(entry) ? 0 : Date.parse(entry.start_at),
            entry,
          })),
        ...blocks
          .filter((b) => covers(b, day))
          .map((block) => ({
            key: `b-${block.id}`,
            at: Date.parse(block.start_at),
            block,
          })),
        ...external
          .filter((x) => covers(x, day))
          .map((x, n) => ({
            key: `x-${x.subscription_id}-${x.start_at}-${n}`,
            at: wholeDay(x) ? 0 : Date.parse(x.start_at),
            external: x,
          })),
        ...ghosts
          .filter((g) => covers(g, day))
          .map((ghost) => ({
            key: `g-${ghost.item_id}-${ghost.start_at}`,
            at: Date.parse(ghost.start_at),
            ghost,
          })),
      ].sort((a, b) => a.at - b.at);
      return { day, rows };
    })
    .filter((d) => d.rows.length);

  if (!filled.length)
    return (
      <View style={[shared.card, shared.empty]}>
        <View style={shared.emptyIcon}>
          <Icon name="calendar" size={24} color={colors.accent} />
        </View>
        <Text style={shared.sectionTitle}>A clear stretch.</Text>
        <Text style={[shared.subtitle, s.center]}>
          Nothing planned for these two weeks.
        </Text>
      </View>
    );

  return (
    <>
      {filled.map(({ day, rows }) => (
        <FadeIn key={day.toDateString()} style={s.day}>
          <View style={s.dayHead}>
            <Text style={s.dayTitle} accessibilityRole="header">
              {dayHeading(day)}
            </Text>
            <View style={s.count}>
              <Text style={s.countText}>{rows.length}</Text>
            </View>
          </View>
          <View style={s.list}>
            {rows.map((r, n) => (
              <AgendaRow
                key={r.key}
                row={r}
                first={n === 0}
                day={day}
                now={now}
                listColor={(id) => (id ? listById.get(id)?.color : undefined)}
                onOpen={onOpen}
                onEntryMenu={onEntryMenu}
                onBlockMenu={onBlockMenu}
                onExternal={onExternal}
                onGhostMenu={onGhostMenu}
                onJoin={onJoin}
              />
            ))}
          </View>
        </FadeIn>
      ))}
    </>
  );
}

function AgendaRow({
  row: r,
  first,
  day,
  now,
  listColor,
  onOpen,
  onEntryMenu,
  onBlockMenu,
  onExternal,
  onGhostMenu,
  onJoin,
}: {
  row: Row;
  first: boolean;
  day: Date;
  now: Date;
  listColor: (id: string | null) => string | undefined;
} & Pick<
  React.ComponentProps<typeof AgendaList>,
  | "onOpen"
  | "onEntryMenu"
  | "onBlockMenu"
  | "onExternal"
  | "onGhostMenu"
  | "onJoin"
>) {
  // "10:30 PM" at the user's text size; the column widens with it.
  const timeWidth = TIME_WIDTH * Math.min(1.6, useWindowDimensions().fontScale);
  const time = (x: Timed) =>
    wholeDay(x)
      ? "All day"
      : covers({ ...x, end_at: null }, day)
        ? timeLabel(new Date(x.start_at))
        : "Continues";
  let color: string;
  let title: string;
  let detail: string;
  let when: string;
  let onPress: () => void;
  let onLongPress: (() => void) | undefined;
  let extra: React.ReactNode = null;
  let dashed = false;
  let done = false;
  /** A session that ends after its task's deadline. */
  let late = false;
  if ("entry" in r) {
    const e = r.entry;
    color = e.color || listColor(e.list_id) || statusTones[e.status].fg;
    title = e.title;
    when = time(e);
    done = e.status === "done";
    detail = [
      e.kind === "event" ? "Event" : "Task",
      e.occurrence ? "Repeats" : "",
      e.location,
      e.team_name ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    onPress = () => onOpen(e.item_id, e);
    onLongPress = () => onEntryMenu(e);
    extra = (
      <>
        {e.kind === "task" && <StatusPill status={e.status} />}
        {canJoin(e, now) && (
          <Button
            title="Join"
            icon="video"
            style={s.join}
            onPress={() => onJoin(e)}
          />
        )}
      </>
    );
  } else if ("block" in r) {
    const b = r.block;
    color = listColor(b.list_id) ?? colors.accent;
    title = b.title;
    when = timeLabel(new Date(b.start_at));
    detail = `${sessionLine(b) ?? "Session"} · ${rangeLabel(b.start_at, b.end_at)}`;
    dashed = true;
    done = b.status === "done";
    late = !!b.after_deadline && !done;
    onPress = () => onOpen(b.item_id);
    onLongPress = () => onBlockMenu(b);
  } else if ("external" in r) {
    const x = r.external;
    color = x.color;
    title = x.title;
    when = time(x);
    detail = [x.name, x.location].filter(Boolean).join(" · ");
    onPress = () => onExternal(x);
  } else {
    const g = r.ghost;
    color = colors.accent;
    title = g.title;
    when = timeLabel(new Date(g.start_at));
    detail = `Planned, not saved yet · ${rangeLabel(g.start_at, g.end_at)}`;
    dashed = true;
    onPress = () => onGhostMenu(g);
    onLongPress = () => onGhostMenu(g);
  }
  return (
    <View style={[s.row, !first && s.divider]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${when}, ${title}, ${detail}`}
        accessibilityHint={onLongPress ? "Hold for options" : undefined}
        onPress={onPress}
        onLongPress={
          onLongPress
            ? () => {
                tap();
                onLongPress!();
              }
            : undefined
        }
        style={({ pressed }) => [s.rowMain, pressed && s.pressed]}
      >
        <View
          style={[
            s.rail,
            dashed
              ? { borderColor: color, borderWidth: 1.5, borderStyle: "dashed" }
              : { backgroundColor: color },
          ]}
        />
        <Text style={[s.time, { width: timeWidth }]}>{when}</Text>
        <View style={{ flex: 1 }}>
          <View style={s.titleRow}>
            {"external" in r && <Icon name="lock" size={10} color={color} />}
            {"ghost" in r && (
              <Icon name="sparkles" size={11} color={colors.accent} />
            )}
            <Text
              numberOfLines={1}
              style={[s.title, done && s.doneText, { flexShrink: 1 }]}
            >
              {title}
            </Text>
          </View>
          {!!detail && (
            <Text style={[shared.small, late && s.late]} numberOfLines={1}>
              {detail}
            </Text>
          )}
        </View>
      </Pressable>
      {extra && <View style={s.extra}>{extra}</View>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    center: { textAlign: "center" },
    day: { marginBottom: 14 },
    dayHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    dayTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    count: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    countText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.muted,
    },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
    },
    row: { flexDirection: "row", alignItems: "center", paddingRight: 10 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 52,
      paddingVertical: 10,
      paddingLeft: 12,
      paddingRight: 6,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    rail: { width: 4, alignSelf: "stretch", borderRadius: 2 },
    time: {
      fontFamily: fonts.medium,
      fontSize: 12,
      color: colors.muted,
    },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    title: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    doneText: { color: colors.faint, textDecorationLine: "line-through" },
    late: { fontFamily: fonts.semibold, color: colors.warningStrong },
    extra: { flexDirection: "row", alignItems: "center", gap: 6 },
    join: { marginBottom: 0, minHeight: 44, paddingHorizontal: 12 },
  }),
);
