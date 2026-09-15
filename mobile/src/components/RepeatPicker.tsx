import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  describeRrule,
  formatRrule,
  parseRrule,
  type Frequency,
} from "@orbyn/core";
import { Chip, ChipRow } from "./Chip";
import { DateField, NumberInput } from "./Field";
import { Segmented } from "./Segmented";
import { WEEK_ORDER, WEEKDAYS } from "../lib/planning";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

type Preset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
type Ends = "never" | "count" | "until";

const PRESETS: Preset[] = [
  "none",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
  "yearly",
];
const PRESET_LABELS: Record<Preset, string> = {
  none: "None",
  daily: "Daily",
  weekdays: "Weekdays",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};
const FREQ: Record<Exclude<Preset, "none">, Frequency> = {
  daily: "DAILY",
  weekdays: "WEEKLY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};
const UNIT: Record<Frequency, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};
const ENDS: Ends[] = ["never", "count", "until"];
const ENDS_LABELS: Record<Ends, string> = {
  never: "Never",
  count: "After",
  until: "On a date",
};
const WORK_WEEK = [1, 2, 3, 4, 5];

const clampInt = (text: string, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number(text) || min)));

/** Read the saved rule into the picker's choices. */
function initial(rrule: string | null | undefined, dueAt: string | null) {
  const rule = rrule ? parseRrule(rrule) : null;
  const dueDay = new Date(dueAt ?? Date.now()).getDay();
  if (!rule)
    return {
      preset: "none" as Preset,
      interval: "1",
      days: [dueDay],
      ends: "never" as Ends,
      count: "10",
      until: null as string | null,
    };
  const weekdays =
    rule.freq === "WEEKLY" &&
    rule.interval === 1 &&
    rule.byDay.join(",") === WORK_WEEK.join(",");
  const preset: Preset = weekdays
    ? "weekdays"
    : (
        {
          DAILY: "daily",
          WEEKLY: "weekly",
          MONTHLY: "monthly",
          YEARLY: "yearly",
        } as const
      )[rule.freq];
  const until = rule.until
    ? "day" in rule.until
      ? rule.until.day
      : rule.until.at.toISOString().slice(0, 10)
    : null;
  return {
    preset,
    interval: String(rule.interval),
    days: rule.byDay.length ? rule.byDay : [dueDay],
    ends: (rule.count ? "count" : until ? "until" : "never") as Ends,
    count: String(rule.count ?? 10),
    until,
  };
}

/**
 * None, daily, weekdays, weekly on chosen days, monthly or yearly; every N;
 * ending never, after N times or on a date. Writes an RRULE with formatRrule.
 * Mounted once per edit, so its choices start from the saved rule.
 */
export function RepeatPicker({
  rrule,
  dueAt,
  disabled = false,
  onChange,
  onProblem,
}: {
  rrule: string | null | undefined;
  /** The item's date; repeating needs one. */
  dueAt: string | null;
  disabled?: boolean;
  /** The new rule, or null to stop repeating. */
  onChange: (rrule: string | null) => void;
  /** Why the choices can't be saved yet ("pick the last date"), or null. */
  onProblem?: (problem: string | null) => void;
}) {
  const [state, setState] = useState(() => initial(rrule, dueAt));
  const unsupported = !!rrule && !parseRrule(rrule);

  const update = (patch: Partial<typeof state>) => {
    const next = { ...state, ...patch };
    setState(next);
    onProblem?.(
      next.preset !== "none" && next.ends === "until" && !next.until
        ? "Pick the last date, or choose another ending."
        : null,
    );
    if (next.preset === "none") {
      onChange(null);
      return;
    }
    const freq = FREQ[next.preset];
    onChange(
      formatRrule({
        freq,
        interval:
          next.preset === "weekdays" ? 1 : clampInt(next.interval, 1, 99),
        byDay:
          next.preset === "weekdays"
            ? WORK_WEEK
            : next.preset === "weekly"
              ? next.days
              : [],
        count: next.ends === "count" ? clampInt(next.count, 1, 999) : null,
        until: next.ends === "until" ? next.until : null,
      }),
    );
  };

  const noDate = !dueAt;
  const freq = state.preset === "none" ? null : FREQ[state.preset];
  const n = clampInt(state.interval, 1, 99);
  return (
    <View>
      <Segmented
        wrap
        accessibilityLabel="Repeat"
        disabled={disabled || (noDate && state.preset === "none")}
        options={PRESETS}
        labels={PRESET_LABELS}
        value={state.preset}
        onChange={(preset) => update({ preset })}
      />
      {noDate && (
        <Text style={[shared.small, s.gap]}>
          Set a due date first; repeats start from it.
        </Text>
      )}
      {unsupported && state.preset === "none" && (
        <Text style={[shared.small, s.gap]}>
          This repeats with a rule the app can’t edit. Choose a pattern to
          replace it.
        </Text>
      )}
      {freq && state.preset !== "weekdays" && (
        <View style={s.gap}>
          <Text style={shared.label}>Every</Text>
          <NumberInput
            value={state.interval}
            editable={!disabled}
            onChangeText={(interval) => update({ interval })}
            suffix={n === 1 ? UNIT[freq] : `${UNIT[freq]}s`}
            accessibilityLabel={`Repeat every how many ${UNIT[freq]}s`}
          />
        </View>
      )}
      {state.preset === "weekly" && (
        <ChipRow label="Repeat on these days" multi style={s.gap}>
          {WEEK_ORDER.map((d) => {
            const on = state.days.includes(d);
            return (
              <Chip
                key={d}
                multi
                label={WEEKDAYS[d]}
                selected={on}
                disabled={disabled}
                onPress={() => {
                  const days = on
                    ? state.days.filter((x) => x !== d)
                    : [...state.days, d].sort((a, b) => a - b);
                  // At least one day: an empty BYDAY isn't a weekly rule.
                  if (days.length) update({ days });
                }}
              />
            );
          })}
        </ChipRow>
      )}
      {freq && (
        <View style={s.gap}>
          <Text style={shared.label}>Ends</Text>
          <Segmented
            accessibilityLabel="Repeat ends"
            disabled={disabled}
            options={ENDS}
            labels={ENDS_LABELS}
            value={state.ends}
            onChange={(ends) => update({ ends })}
          />
          {state.ends === "count" && (
            <View style={s.gapSmall}>
              <NumberInput
                value={state.count}
                editable={!disabled}
                onChangeText={(count) => update({ count })}
                suffix="times"
                accessibilityLabel="Number of times"
              />
            </View>
          )}
          {state.ends === "until" && (
            <View style={s.gapSmall}>
              <DateField
                label="Last day"
                value={state.until}
                minimumDate={dueAt ? new Date(dueAt) : undefined}
                onChange={(until) => update({ until })}
              />
            </View>
          )}
        </View>
      )}
      {!!rrule && freq && (
        <Text style={s.summary} accessibilityLiveRegion="polite">
          {describeRrule(rrule)}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    gap: { marginTop: 12 },
    gapSmall: { marginTop: 8 },
    summary: {
      marginTop: 10,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
  }),
);
