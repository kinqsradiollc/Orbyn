import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  hoursLabel,
  type AttentionCheck,
  type TeamAttention as Attention,
} from "@orbyn/core";
import { Chip, ChipRow } from "../Chip";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

const BUDGETS = [null, 240, 480, 720, 960] as const;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** How much of each person's week meetings take, against the budget. */
export function TeamAttention({
  teamId,
  weekStart,
  canManage,
}: {
  teamId: string;
  weekStart: Date;
  canManage: boolean;
}) {
  const [data, setData] = useState<Attention | null>(null);
  const [failed, setFailed] = useState(false);
  const week = dayKey(weekStart);
  const load = useCallback(() => {
    client.teamAttention(teamId, week).then(
      (d) => {
        setData(d);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [teamId, week]);
  useEffect(load, [load]);
  if (failed)
    return <Text style={shared.small}>Connect to see meeting time.</Text>;
  if (!data) return <Text style={shared.small}>Loading…</Text>;
  const budget = data.budget_minutes;
  const most = Math.max(
    budget ?? 0,
    ...data.members.map((m) => m.meeting_minutes),
    60,
  );
  return (
    <View style={s.wrap}>
      <Text style={shared.small}>
        {budget
          ? `Meetings are kept to ${hoursLabel(budget)} a person a week. Team events and events with people invited count.`
          : "No meeting budget yet. Team events and events with people invited count as meetings."}
      </Text>
      {canManage && (
        <ChipRow label="Meeting budget">
          {BUDGETS.map((b) => (
            <Chip
              key={b ?? "none"}
              compact
              label={b ? `${hoursLabel(b)}` : "None"}
              selected={budget === b}
              onPress={() =>
                void client.setMeetingBudget(teamId, b).then(load, () => {})
              }
            />
          ))}
        </ChipRow>
      )}
      {data.members.map((m) => (
        <View
          key={m.user_id}
          style={s.row}
          accessible
          accessibilityLabel={`${m.name}: ${hoursLabel(m.meeting_minutes)} of meetings${budget ? ` of ${hoursLabel(budget)}` : ""}${m.over ? ", over budget" : ""}`}
        >
          <Text style={s.name} numberOfLines={1}>
            {m.name}
          </Text>
          <View style={s.track}>
            <View
              style={[
                s.fill,
                m.over && s.fillOver,
                {
                  width: `${Math.min(100, (m.meeting_minutes / most) * 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={[shared.small, m.over && s.over]}>
            {hoursLabel(m.meeting_minutes)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Before a team meeting is saved: whose week it takes over the budget. */
export function AttentionWarning({
  teamId,
  start,
  end,
  itemId,
}: {
  teamId: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
  itemId?: string;
}) {
  const [check, setCheck] = useState<AttentionCheck | null>(null);
  useEffect(() => {
    setCheck(null);
    if (!teamId || !start || !end || Date.parse(end) <= Date.parse(start))
      return;
    let alive = true;
    const id = setTimeout(() => {
      client
        .checkAttention(teamId, {
          start_at: start,
          end_at: end,
          ...(itemId ? { item_id: itemId } : {}),
        })
        .then(
          (c) => alive && setCheck(c),
          () => {},
        );
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [teamId, start, end, itemId]);
  if (!check?.budget_minutes || !check.over.length) return null;
  const names = check.over.map((o) => o.name.split(" ")[0]);
  const who =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <View style={s.warning} accessibilityRole="alert">
      <Text style={s.warningText}>
        This puts {who} over the team’s {hoursLabel(check.budget_minutes)}{" "}
        meeting budget this week.
      </Text>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 10 },
    row: { flexDirection: "row", alignItems: "center", gap: 10 },
    name: {
      width: 90,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    track: {
      flex: 1,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    fill: { height: "100%", borderRadius: 4, backgroundColor: colors.accent },
    fillOver: { backgroundColor: colors.danger },
    over: { color: colors.danger, fontFamily: fonts.semibold },
    warning: {
      marginTop: 8,
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.dangerSoft,
    },
    warningText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.danger,
    },
  }),
);
