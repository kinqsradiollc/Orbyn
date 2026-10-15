import { InlineDetails } from "../InlineDetails";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  hoursLabel,
  type AttentionCheck,
  type TeamAttention as Attention,
} from "@orbyn/core";
import { SmallAction } from "../SmallAction";
import { errorText } from "../../lib/errors";
import { Chip, ChipRow } from "../Chip";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

const BUDGETS = [null, 240, 480, 720, 960] as const;
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** How much of each person's week meetings take, against the budget. */
export function TeamAttention(props: Parameters<typeof TeamAttentionBody>[0]) {
  return (
    <TeamAttentionBody
      key={`${props.teamId}:${dayKey(props.weekStart)}`}
      {...props}
    />
  );
}

function TeamAttentionBody({
  teamId,
  weekStart,
  canManage,
  disabled = false,
  onBusyChange,
}: {
  teamId: string;
  weekStart: Date;
  canManage: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<Attention | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const mutation = useRef(false);
  const alive = useRef(true);
  const owner = useRef(session.token).current;
  const reporter = useRef(onBusyChange);
  reporter.current = onBusyChange;
  const current = () => alive.current && session.token === owner;
  const week = dayKey(weekStart);
  const load = useCallback(async () => {
    if (!current()) return;
    const version = ++request.current;
    setFailed(false);
    try {
      const next = await client.teamAttention(teamId, week);
      if (current() && version === request.current) setData(next);
    } catch {
      if (current() && version === request.current) setFailed(true);
    }
  }, [teamId, week]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      request.current++;
      reporter.current?.(false);
    };
  }, [load]);
  if (!data)
    return failed ? (
      <View>
        <Text style={shared.small}>Meeting time couldn’t be loaded.</Text>
        <SmallAction
          label="Retry"
          disabled={false}
          onPress={() => void load()}
        />
      </View>
    ) : (
      <Text style={shared.small}>Loading meeting time…</Text>
    );
  const budget = data.budget_minutes;
  const most = Math.max(
    budget ?? 0,
    ...data.members.map((m) => m.meeting_minutes),
    60,
  );
  return (
    <View style={s.wrap}>
      {!!error && (
        <Text style={shared.small} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {failed && (
        <View>
          <Text style={shared.small}>Meeting time couldn’t be refreshed.</Text>
          <SmallAction
            label="Retry"
            disabled={busy || disabled}
            onPress={() => void load()}
          />
        </View>
      )}
      <Text style={shared.small}>
        {budget
          ? `Budget: ${hoursLabel(budget)} per person each week.`
          : "No meeting budget set."}
      </Text>
      <InlineDetails title="What counts as a meeting">
        <Text style={shared.small}>
          Team events and events with invited people count toward this budget.
        </Text>
      </InlineDetails>
      {canManage && (
        <ChipRow label="Meeting budget">
          {BUDGETS.map((b) => (
            <Chip
              key={b ?? "none"}
              compact
              label={b ? `${hoursLabel(b)}` : "None"}
              selected={budget === b}
              disabled={busy || disabled}
              onPress={() => {
                if (!canManage || disabled || !current() || mutation.current)
                  return;
                mutation.current = true;
                reporter.current?.(true);
                setBusy(true);
                setError("");
                void client
                  .setMeetingBudget(teamId, b)
                  .then(load, (error) => {
                    if (current()) setError(errorText(error));
                  })
                  .finally(() => {
                    mutation.current = false;
                    if (current()) {
                      setBusy(false);
                      reporter.current?.(false);
                    }
                  });
              }}
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
          <Text style={s.name}>{m.name}</Text>
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
    row: { gap: 6 },
    name: {
      minWidth: 0,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    track: {
      width: "100%",
      height: 8,
      borderRadius: radii.check,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    fill: {
      height: "100%",
      borderRadius: radii.check,
      backgroundColor: colors.accent,
    },
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
