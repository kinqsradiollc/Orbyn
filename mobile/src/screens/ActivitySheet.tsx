import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ActivitySummary } from "@orbyn/core";
import { client } from "../lib/api";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { InlineDetails } from "../components/InlineDetails";
import { colors, radii, themed } from "../theme";
import { shared } from "../styles";

export function ActivitySheet({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<30 | 90 | 365>(90);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setSummary(null);
    setError("");
    void client
      .activitySummary(period)
      .then((value) => {
        if (live) setSummary(value);
      })
      .catch(() => {
        if (live) setError("Couldn't load activity.");
      });
    return () => {
      live = false;
    };
  }, [period, retry]);
  return (
    <BottomSheet visible title="Activity" onClose={onClose}>
      <View style={s.content}>
        <View style={s.period} accessibilityLabel="Activity period">
          {([30, 90, 365] as const).map((days) => (
            <Chip
              key={days}
              label={`${days} days`}
              selected={period === days}
              onPress={() => setPeriod(days)}
            />
          ))}
        </View>
        <ErrorBanner error={error} />
        {error ? (
          <Button title="Retry" secondary onPress={() => setRetry(retry + 1)} />
        ) : !summary ? (
          <Text style={shared.small}>Loading activity…</Text>
        ) : (
          <>
            <View style={s.totals}>
              <View style={s.total}>
                <Text style={shared.small}>Task completions</Text>
                <Text style={shared.label}>{summary.totals.completions}</Text>
              </View>
              <View style={s.total}>
                <Text style={shared.small}>Focus time</Text>
                <Text style={shared.label}>
                  {Math.floor(summary.totals.focus_minutes / 60)}h{" "}
                  {summary.totals.focus_minutes % 60}m
                </Text>
              </View>
              <View style={s.total}>
                <Text style={shared.small}>Active days</Text>
                <Text style={shared.label}>{summary.totals.active_days}</Text>
              </View>
            </View>
            <Text style={shared.small}>
              Completion history since{" "}
              {new Date(summary.completion_history_since).toLocaleDateString(
                [],
                {
                  timeZone: summary.timezone,
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                },
              )}
              .
            </Text>
            <View
              style={s.grid}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {summary.days.map((day) => (
                <View
                  key={day.day}
                  style={[
                    s.cell,
                    ((day.completions ?? 0) > 0 || day.focus_minutes > 0) &&
                      s.active,
                  ]}
                />
              ))}
            </View>
            <Text style={shared.small}>
              {summary.days[0]?.day} – {summary.days.at(-1)?.day} ·{" "}
              {summary.timezone}
            </Text>
            {!summary.totals.active_days && (
              <Text style={shared.small}>
                No recorded activity in this period.
              </Text>
            )}
            <InlineDetails title="Daily details">
              <Text style={shared.small}>
                Active days include a task completion or recorded focus time.
                Work from connected agents is included. Focus time uses the
                session start day; — means completion history is unavailable.
              </Text>
              {summary.days
                .slice()
                .reverse()
                .map((day) => (
                  <View key={day.day} style={s.day}>
                    <Text style={shared.label}>{day.day}</Text>
                    <Text style={shared.small}>
                      {day.completions ?? "—"} completed · {day.focus_minutes}{" "}
                      min focus
                    </Text>
                  </View>
                ))}
            </InlineDetails>
          </>
        )}
      </View>
    </BottomSheet>
  );
}
const s = themed(() =>
  StyleSheet.create({
    content: { gap: 12 },
    period: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    totals: { gap: 12 },
    total: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: 3 },
    cell: {
      width: 12,
      height: 12,
      borderRadius: radii.check,
      backgroundColor: colors.surfaceMuted,
    },
    active: { backgroundColor: colors.accent },
    day: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 4,
    },
  }),
);
