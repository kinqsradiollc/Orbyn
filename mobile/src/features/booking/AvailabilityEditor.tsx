import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { BookingAvailability } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ClockField, DateField, Field } from "../../components/Field";
import { Segmented } from "../../components/Segmented";
import { SmallAction } from "../../components/SmallAction";
import { deviceTimeZone, WEEK_ORDER, WEEKDAYS } from "../planner/planning";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import {
  MAX_OVERRIDES,
  MAX_RANGES,
  dayKeyOf,
  newKey,
  nextRange,
} from "./helpers";
import { TimeZonePicker } from "./TimeZonePicker";
import { RemoveButton, bookingStyles as bs } from "./ui";

type Range = { start: string; end: string };
/** A date override being edited, with a local key for React. */
export type OverrideDraft = { key: string; date: string; hours: Range[] };
/** The page's own hours, kept while working hours are picked. */
export type CustomWeek = Omit<
  Extract<BookingAvailability, { mode: "custom" }>,
  "mode"
>;

const MODES = ["working_hours", "custom"] as const;
/** Below this window width a day's hours go under its name, not beside it. */
const SIDE_BY_SIDE = 480;

/** Start and end fields per range, a remove button each, and "Add hours". */
function Ranges({
  ranges,
  onChange,
  label,
  empty,
  extra,
  disabled = false,
}: {
  disabled?: boolean;
  ranges: Range[];
  onChange: (ranges: Range[]) => void;
  /** Spoken name, e.g. "Monday" or "Fri, Sep 18". */
  label: string;
  empty?: string;
  /** More actions next to Add hours. */
  extra?: React.ReactNode;
}) {
  const next = nextRange(ranges);
  return (
    <View>
      {ranges.length === 0 && !!empty && (
        <Text style={[shared.small, s.empty]}>{empty}</Text>
      )}
      {ranges.map((r, n) => (
        <View key={n} style={[bs.pair, s.range]}>
          <View style={bs.half}>
            <ClockField
              disabled={disabled}
              label={`${label} from`}
              value={r.start}
              onChange={(start) =>
                onChange(ranges.map((x, i) => (i === n ? { ...x, start } : x)))
              }
            />
          </View>
          <Text style={s.dash}>–</Text>
          <View style={bs.half}>
            <ClockField
              disabled={disabled}
              label={`${label} until`}
              value={r.end}
              onChange={(end) =>
                onChange(ranges.map((x, i) => (i === n ? { ...x, end } : x)))
              }
            />
          </View>
          <RemoveButton
            disabled={disabled}
            label={`Remove ${label} hours`}
            onPress={() => {
              onChange(ranges.filter((_, i) => i !== n));
            }}
          />
        </View>
      ))}
      {ranges.some((r) => r.end <= r.start) && (
        <Text style={[shared.small, s.warn]}>
          End each range after it starts.
        </Text>
      )}
      {((next && ranges.length < MAX_RANGES) || !!extra) && (
        <View style={s.add}>
          {next && ranges.length < MAX_RANGES && (
            <SmallAction
              label="Add hours"
              disabled={disabled}
              onPress={() => {
                onChange([...ranges, next]);
              }}
            />
          )}
          {extra}
        </View>
      )}
    </View>
  );
}

/**
 * When a booking page offers times: each host's working hours, or the page's
 * own weekly hours in one time zone, plus dates with different hours.
 */
export function AvailabilityEditor({
  availability,
  onChange,
  kept,
  overrides,
  onOverrides,
  disabled = false,
}: {
  disabled?: boolean;
  availability: BookingAvailability;
  onChange: (availability: BookingAvailability) => void;
  /** Custom hours to bring back when switching from working hours. */
  kept: CustomWeek;
  overrides: OverrideDraft[];
  onOverrides: (overrides: OverrideDraft[]) => void;
}) {
  const device = deviceTimeZone();
  const { width, fontScale } = useWindowDimensions();
  const narrow = width < SIDE_BY_SIDE || fontScale > 1.35;
  const custom = availability.mode === "custom" ? availability : null;
  const setWeekly = (weekly: CustomWeek["weekly"]) =>
    !disabled &&
    custom &&
    onChange({
      ...custom,
      weekly: [...weekly].sort(
        (a, b) => a.day - b.day || (a.start < b.start ? -1 : 1),
      ),
    });
  const patchOverride = (key: string, patch: Partial<OverrideDraft>) =>
    !disabled &&
    onOverrides(overrides.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const addOverride = () => {
    if (disabled || overrides.length >= MAX_OVERRIDES) return;
    const taken = new Set(overrides.map((o) => o.date));
    const day = new Date();
    do day.setDate(day.getDate() + 1);
    while (taken.has(dayKeyOf(day)));

    onOverrides([
      ...overrides,
      { key: newKey(), date: dayKeyOf(day), hours: [] },
    ]);
  };

  return (
    <>
      <Field label="Offer times during">
        <Segmented
          disabled={disabled}
          options={MODES}
          value={availability.mode}
          labels={{ working_hours: "My working hours", custom: "Custom hours" }}
          accessibilityLabel="Offer times during"
          onChange={(mode) => {
            onChange(mode === "custom" ? { mode, ...kept } : { mode });
          }}
        />
      </Field>
      {!custom ? (
        <Text style={[shared.small, s.note]}>
          Uses each host's work hours and excludes busy calendar time.
        </Text>
      ) : (
        <>
          <Field
            label="Time zone"
            hint="Hours use this zone; busy host calendar time is excluded."
          >
            <TimeZonePicker
              disabled={disabled}
              value={custom.timezone}
              onChange={(timezone) => onChange({ ...custom, timezone })}
            />
            {custom.timezone !== device && (
              <Button
                disabled={disabled}
                secondary
                title={`Use this device’s (${device})`}
                style={s.inline}
                onPress={() => onChange({ ...custom, timezone: device })}
              />
            )}
          </Field>
          <Text style={shared.label}>Weekly hours</Text>
          {WEEK_ORDER.map((d) => {
            const ranges = custom.weekly
              .filter((r) => r.day === d)
              .map(({ start, end }) => ({ start, end }));
            return (
              <View key={d} style={[s.day, narrow && s.dayStacked]}>
                <Text style={[s.dayName, narrow && s.dayNameStacked]}>
                  {WEEKDAYS[d]}
                </Text>
                <View style={{ flex: 1 }}>
                  <Ranges
                    disabled={disabled}
                    label={WEEKDAYS[d]}
                    empty="Unavailable"
                    ranges={ranges}
                    onChange={(next) =>
                      setWeekly([
                        ...custom.weekly.filter((r) => r.day !== d),
                        ...next.map((r) => ({ day: d, ...r })),
                      ])
                    }
                    extra={
                      ranges.length > 0 && (
                        <SmallAction
                          label="Copy to all days"
                          disabled={disabled}
                          onPress={() => {
                            setWeekly(
                              WEEK_ORDER.flatMap((day) =>
                                ranges.map((r) => ({ day, ...r })),
                              ),
                            );
                          }}
                        />
                      )
                    }
                  />
                </View>
              </View>
            );
          })}
        </>
      )}

      <Text style={[shared.label, s.overrides]}>Date exceptions</Text>
      <Text style={[shared.small, bs.gap]}>
        Replace the usual hours on a specific date.
      </Text>
      {overrides.map((o) => {
        const taken = overrides.some(
          (x) => x.key !== o.key && x.date === o.date,
        );
        return (
          <View key={o.key} style={s.override}>
            <View style={[bs.pair, bs.gap]}>
              <View style={bs.half}>
                <DateField
                  disabled={disabled}
                  label="Date"
                  value={o.date}
                  onChange={(date) => date && patchOverride(o.key, { date })}
                />
              </View>
              <RemoveButton
                disabled={disabled}
                label="Remove this date"
                onPress={() => {
                  onOverrides(overrides.filter((x) => x.key !== o.key));
                }}
              />
            </View>
            {taken && (
              <Text style={[shared.small, s.warn, bs.gap]}>
                This date is already listed.
              </Text>
            )}
            <Segmented
              disabled={disabled}
              options={["closed", "open"] as const}
              value={o.hours.length ? "open" : "closed"}
              labels={{ closed: "Unavailable", open: "Other hours" }}
              accessibilityLabel="Hours on this date"
              onChange={(v) => {
                patchOverride(o.key, {
                  hours: v === "open" ? [{ start: "09:00", end: "17:00" }] : [],
                });
              }}
            />
            {o.hours.length > 0 && (
              <View style={s.overrideHours}>
                <Ranges
                  disabled={disabled}
                  label={o.date}
                  ranges={o.hours}
                  onChange={(hours) => patchOverride(o.key, { hours })}
                />
              </View>
            )}
          </View>
        );
      })}
      {overrides.length < MAX_OVERRIDES && (
        <Button
          disabled={disabled}
          secondary
          title="Add a date"
          icon="plus"
          style={bs.last}
          onPress={addOverride}
        />
      )}
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    note: { marginBottom: 18 },
    inline: { marginTop: 10, marginBottom: 0 },
    day: {
      flexDirection: "row",
      gap: 12,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    /** Narrow screens: the name above the hours, so each range keeps its width. */
    dayStacked: { flexDirection: "column", gap: 6 },
    dayName: {
      width: 38,
      paddingTop: 15,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    dayNameStacked: { width: "100%", paddingTop: 0 },
    empty: { paddingTop: 16, marginBottom: 8 },
    range: { marginBottom: 8 },
    dash: { fontFamily: fonts.medium, fontSize: 15, color: colors.muted },
    add: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    warn: { color: colors.danger, marginBottom: 8 },
    overrides: { marginTop: 18 },
    override: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingVertical: 12,
      marginBottom: 4,
    },
    overrideHours: { marginTop: 12 },
  }),
);
