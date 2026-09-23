import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  dayTime,
  freshItem,
  hoursLabel,
  type CapacityDay,
  type MemberCapacity,
  type MemberPresence,
  type TeamCapacity as Capacity,
} from "@orbyn/core";
import { SmallAction } from "../components/SmallAction";
import type { Editing } from "../components/ItemEditor";
import { client } from "../lib/api";
import { onLive } from "../lib/live";
import { animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const LEVEL_WORDS = ["None", "<2h", "2–5h", "5h+"] as const;

function cellText(d: CapacityDay) {
  if (d.off) return "Off";
  if (d.free_minutes === null) return d.over ? "Over" : LEVEL_WORDS[d.level];
  if (d.over && d.over_minutes) return `−${hoursLabel(d.over_minutes)}`;
  return hoursLabel(d.free_minutes);
}

const dayName = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: "short" });
const longDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Who has room this week: people down the side, days across, each cell the
 * free working time left. Swipe sideways on a narrow screen. Tapping a cell
 * says more about that day and offers a task for that person.
 */
export function TeamCapacity({
  teamId,
  weekStart,
  canWrite,
  onOpenItem,
}: {
  teamId: string;
  weekStart: Date;
  canWrite: boolean;
  onOpenItem?: (editing: Editing) => void;
}) {
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [failed, setFailed] = useState(false);
  const [presence, setPresence] = useState<Map<string, MemberPresence>>(
    new Map(),
  );
  const [picked, setPicked] = useState<{
    member: MemberCapacity;
    day: CapacityDay;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    setCapacity(null);
    setPicked(null);
    const to = new Date(weekStart.getTime() + 7 * 86_400_000);
    client.teamCapacity(teamId, weekStart, to).then(
      (c) => {
        if (!alive) return;
        animateLayout();
        setCapacity(c);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [teamId, weekStart]);

  const loadPresence = useCallback(() => {
    client.teamPresence(teamId).then(
      (rows) => setPresence(new Map(rows.map((r) => [r.user_id, r]))),
      () => {},
    );
  }, [teamId]);
  useEffect(() => {
    loadPresence();
    return onLive((news) => {
      if (news.kind === "presence" && (!news.team || news.team === teamId))
        loadPresence();
    });
  }, [teamId, loadPresence]);

  if (failed)
    return (
      <Text style={shared.small}>Connect to see who has room this week.</Text>
    );
  if (!capacity) return <Text style={shared.small}>Loading…</Text>;
  const shown = capacity.days
    .map((day, n) => ({ day, n }))
    .filter(({ n }) => capacity.members.some((m) => !m.days[n].off));

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={s.row}>
            <View style={s.nameCell} />
            {shown.map(({ day }) => (
              <Text key={day} style={s.head} accessibilityLabel={longDay(day)}>
                {dayName(day)}
              </Text>
            ))}
          </View>
          {capacity.members.map((m) => {
            const status = presence.get(m.user_id)?.status;
            return (
              <View key={m.user_id} style={s.row}>
                <View style={s.nameCell}>
                  <View style={s.avatar}>
                    <Text style={s.initials}>{initials(m.name)}</Text>
                    {(status === "active" || status === "away") && (
                      <View
                        style={[
                          s.presence,
                          status === "active" && s.presenceActive,
                        ]}
                      />
                    )}
                  </View>
                  <Text
                    style={s.name}
                    numberOfLines={1}
                    accessibilityLabel={
                      m.name +
                      (status === "active"
                        ? ", active now"
                        : status === "away"
                          ? ", away"
                          : "")
                    }
                  >
                    {m.name.split(" ")[0]}
                  </Text>
                </View>
                {shown.map(({ day, n }) => {
                  const d = m.days[n];
                  const on =
                    picked?.member.user_id === m.user_id &&
                    picked.day.day === day;
                  return (
                    <Pressable
                      key={day}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${m.name}, ${longDay(day)}: ${
                        d.off
                          ? "not working"
                          : d.free_minutes === null
                            ? `${LEVEL_WORDS[d.level]} free`
                            : `${hoursLabel(d.free_minutes)} free`
                      }${d.over ? ", booked over working hours" : ""}`}
                      onPress={() => {
                        animateLayout();
                        setPicked(on ? null : { member: m, day: d });
                      }}
                      style={[
                        s.cell,
                        d.off
                          ? s.off
                          : d.over
                            ? s.over
                            : [s.l0, s.l1, s.l2, s.l3][d.level],
                        on && s.picked,
                      ]}
                    >
                      <Text
                        style={[
                          s.cellText,
                          d.off && s.offText,
                          d.over && !d.off && s.overText,
                        ]}
                      >
                        {cellText(d)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>
      {picked && (
        <View style={s.detail}>
          <Text style={s.detailTitle}>
            {picked.member.name} · {longDay(picked.day.day)}
          </Text>
          <Text style={shared.small}>
            {picked.day.off
              ? "Not a working day."
              : picked.day.free_minutes === null
                ? `${LEVEL_WORDS[picked.day.level]} free${picked.day.over ? ", booked past working hours" : ""}.`
                : `${hoursLabel(picked.day.free_minutes)} free of ${hoursLabel(picked.day.working_minutes ?? 0)}${
                    picked.day.team_minutes
                      ? `, ${hoursLabel(picked.day.team_minutes)} planned for this team`
                      : ""
                  }.`}
          </Text>
          {canWrite && onOpenItem && !picked.day.off && (
            <SmallAction
              label={`Task for ${picked.member.name.split(" ")[0]}`}
              disabled={false}
              onPress={() =>
                onOpenItem({
                  ...freshItem(),
                  kind: "task",
                  team_id: teamId,
                  assignee_id: picked.member.user_id,
                  due_at: dayTime(
                    picked.day.day,
                    17 * 60,
                    capacity.timezone,
                  ).toISOString(),
                })
              }
            />
          )}
        </View>
      )}
      {capacity.show_hours &&
        capacity.members.some((m) => m.unplaced_minutes) && (
          <Text style={[shared.small, s.unplaced]}>
            Not on any day yet:{" "}
            {capacity.members
              .filter((m) => m.unplaced_minutes)
              .map(
                (m) =>
                  `${m.name.split(" ")[0]} ${hoursLabel(m.unplaced_minutes!)}`,
              )
              .join(" · ")}
          </Text>
        )}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginBottom: 4,
    },
    nameCell: {
      width: 92,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    head: {
      width: 52,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: colors.textSoft,
    },
    avatar: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    initials: {
      fontFamily: fonts.semibold,
      fontSize: 9,
      color: colors.textSoft,
    },
    presence: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 2,
      borderColor: colors.surface,
      backgroundColor: colors.faint,
    },
    presenceActive: { backgroundColor: colors.accent },
    name: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    cell: {
      width: 52,
      minHeight: 44,
      borderRadius: radii.input,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: "transparent",
    },
    l0: { backgroundColor: colors.surfaceMuted },
    l1: { backgroundColor: colors.soft },
    l2: { backgroundColor: colors.softBorder },
    l3: { backgroundColor: colors.dot },
    over: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
    off: { borderColor: colors.border, borderStyle: "dashed" },
    picked: { borderColor: colors.accent, borderWidth: 2 },
    cellText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    offText: { color: colors.faint, fontFamily: fonts.medium },
    overText: { color: colors.danger },
    detail: {
      marginTop: 10,
      padding: 12,
      gap: 6,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "flex-start",
    },
    detailTitle: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
    },
    unplaced: { marginTop: 8 },
  }),
);
