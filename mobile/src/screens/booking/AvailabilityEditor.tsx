import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type { BookingAvailability } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ClockField, DateField, Field } from "../../components/Field";
import { Segmented } from "../../components/Segmented";
import { SmallAction } from "../../components/SmallAction";
import { animateLayout } from "../../motion";
import { deviceTimeZone, WEEK_ORDER, WEEKDAYS } from "../../lib/planning";
import { colors, fonts } from "../../theme";
import { shared } from "../../styles";
import {
  DEFAULT_WEEK,
  MAX_OVERRIDES,
  MAX_RANGES,
  dayKeyOf,
  newKey,
  nextRange,
} from "./helpers";
import { RemoveButton, bookingStyles as bs } from "./ui";

type Range = { start: string; end: string };
/** A date override being edited, with a local key for React. */
export type OverrideDraft = { key: string; date: string; hours: Range[] };

const MODES = ["working_hours", "custom"] as const;

/** Start and end fields per range, a remove button each, and "Add hours". */
function Ranges({
  ranges,
  onChange,
  label,
  empty,
}: {
  ranges: Range[];
  onChange: (ranges: Range[]) => void;
  /** Spoken name, e.g. "Monday" or "Fri, Sep 18". */
  label: string;
  empty?: string;
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
              label={`${label} until`}
              value={r.end}
              onChange={(end) =>
                onChange(ranges.map((x, i) => (i === n ? { ...x, end } : x)))
              }
            />
          </View>
          <RemoveButton
            label={`Remove ${label} hours`}
            onPress={() => {
              animateLayout();
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
      {next && ranges.length < MAX_RANGES && (
        <View style={s.add}>
          <SmallAction
            label="Add hours"
            disabled={false}
            onPress={() => {
              animateLayout();
              onChange([...ranges, next]);
            }}
          />
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
  overrides,
  onOverrides,
}: {
  availability: BookingAvailability;
  onChange: (availability: BookingAvailability) => void;
  overrides: OverrideDraft[];
  onOverrides: (overrides: OverrideDraft[]) => void;
}) {
  const device = deviceTimeZone();
  const custom = availability.mode === "custom" ? availability : null;
  const patchOverride = (key: string, patch: Partial<OverrideDraft>) =>
    onOverrides(overrides.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  const addOverride = () => {
    const taken = new Set(overrides.map((o) => o.date));
    const day = new Date();
    do day.setDate(day.getDate() + 1);
    while (taken.has(dayKeyOf(day)));
    animateLayout();
    onOverrides([
      ...overrides,
      { key: newKey(), date: dayKeyOf(day), hours: [] },
    ]);
  };

  return (
    <>
      <Field label="Offer times during">
        <Segmented
          options={MODES}
          value={availability.mode}
          labels={{ working_hours: "My working hours", custom: "Custom hours" }}
          accessibilityLabel="Offer times during"
          onChange={(mode) => {
            animateLayout();
            onChange(
              mode === "custom"
                ? { mode, timezone: device, weekly: DEFAULT_WEEK }
                : { mode },
            );
          }}
        />
      </Field>
      {!custom ? (
        <Text style={[shared.small, s.note]}>
          Each host’s working days and hours from Settings → Planning. Busy time
          on their calendars is always left out.
        </Text>
      ) : (
        <>
          <Field
            label="Time zone"
            hint="The hours below are in this zone. Busy time on hosts’ calendars is still left out."
          >
            <TextInput
              style={shared.input}
              value={custom.timezone}
              onChangeText={(timezone) => onChange({ ...custom, timezone })}
              maxLength={80}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Europe/London"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Time zone"
            />
            {custom.timezone !== device && (
              <Button
                secondary
                title={`Use this device’s (${device})`}
                style={s.inline}
                onPress={() => onChange({ ...custom, timezone: device })}
              />
            )}
          </Field>
          <Text style={shared.label}>Weekly hours</Text>
          {WEEK_ORDER.map((d) => (
            <View key={d} style={s.day}>
              <Text style={s.dayName}>{WEEKDAYS[d]}</Text>
              <View style={{ flex: 1 }}>
                <Ranges
                  label={WEEKDAYS[d]}
                  empty="Unavailable"
                  ranges={custom.weekly
                    .filter((r) => r.day === d)
                    .map(({ start, end }) => ({ start, end }))}
                  onChange={(ranges) =>
                    onChange({
                      ...custom,
                      weekly: [
                        ...custom.weekly.filter((r) => r.day !== d),
                        ...ranges.map((r) => ({ day: d, ...r })),
                      ].sort(
                        (a, b) => a.day - b.day || (a.start < b.start ? -1 : 1),
                      ),
                    })
                  }
                />
              </View>
            </View>
          ))}
        </>
      )}

      <Text style={[shared.label, s.overrides]}>
        Dates with different hours
      </Text>
      <Text style={[shared.small, bs.gap]}>
        Days off, or days with other hours. These replace the usual hours for
        that date.
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
                  label="Date"
                  value={o.date}
                  onChange={(date) => date && patchOverride(o.key, { date })}
                />
              </View>
              <RemoveButton
                label="Remove this date"
                onPress={() => {
                  animateLayout();
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
              options={["closed", "open"] as const}
              value={o.hours.length ? "open" : "closed"}
              labels={{ closed: "Unavailable", open: "Other hours" }}
              accessibilityLabel="Hours on this date"
              onChange={(v) => {
                animateLayout();
                patchOverride(o.key, {
                  hours: v === "open" ? [{ start: "09:00", end: "17:00" }] : [],
                });
              }}
            />
            {o.hours.length > 0 && (
              <View style={s.overrideHours}>
                <Ranges
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

const s = StyleSheet.create({
  note: { marginBottom: 18 },
  inline: { marginTop: 10, marginBottom: 0 },
  day: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dayName: {
    width: 38,
    paddingTop: 15,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  empty: { paddingTop: 16, marginBottom: 8 },
  range: { marginBottom: 8 },
  dash: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
  add: { flexDirection: "row" },
  warn: { color: colors.danger, marginBottom: 8 },
  overrides: { marginTop: 18 },
  override: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  overrideHours: { marginTop: 12 },
});
