import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Item, Plan, PlannerReview } from "@orbyn/core";
import { Button } from "./Button";
import { ErrorBanner } from "./ErrorBanner";
import { SmallAction } from "./SmallAction";
import { client } from "../lib/api";
import { minutesLabel, rangeLabel, slotLabel } from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts } from "../theme";
import { shared } from "../styles";

/**
 * What needs a look in the plan: unfinished time blocks (move them forward),
 * blocks that now clash with an event (reschedule), and tasks at risk of
 * missing their due date. Hidden when there's nothing to review.
 */
export function ReviewCard({
  items,
  onPlan,
}: {
  /** Planner items; the review reloads when they change. */
  items: Item[];
  /** Open a proposed plan to review and apply. */
  onPlan: (plan: Plan) => void;
}) {
  const [review, setReview] = useState<PlannerReview | null>(null);
  const { busy, error, setError, run } = useRun();

  const load = useCallback(async () => {
    try {
      const next = await client.plannerReview();
      animateLayout();
      setReview(next);
    } catch {
      // Older servers have no planner; the card simply stays hidden.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, items]);

  if (!review) return null;
  const { unfinished, conflicts, at_risk } = review;
  if (!unfinished.length && !conflicts.length && !at_risk.length) return null;

  return (
    <FadeIn style={shared.card}>
      <Text style={shared.sectionTitle} accessibilityRole="header">
        Needs a look
      </Text>
      <Text style={[shared.small, s.hint]}>Keep your plan honest.</Text>
      <ErrorBanner error={error} onDismiss={() => setError("")} />

      {unfinished.length > 0 && (
        <View style={s.group}>
          <Text style={shared.label}>Unfinished ({unfinished.length})</Text>
          {unfinished.slice(0, 5).map((b) => (
            <View key={b.id} style={s.row}>
              <Text style={s.title} numberOfLines={1}>
                {b.title}
              </Text>
              <Text style={shared.small}>
                {slotLabel(b.start_at, b.end_at)}
              </Text>
            </View>
          ))}
          {unfinished.length > 5 && (
            <Text style={shared.small}>And {unfinished.length - 5} more.</Text>
          )}
          <Button
            secondary
            icon="arrowRight"
            title={busy ? "Planning…" : "Move forward"}
            disabled={busy}
            style={s.button}
            onPress={() =>
              void run(async () => {
                const plan = await client.rollForward(
                  unfinished.map((b) => b.id),
                );
                onPlan(plan);
              })
            }
          />
        </View>
      )}

      {conflicts.length > 0 && (
        <View style={s.group}>
          <Text style={shared.label}>Clashes ({conflicts.length})</Text>
          {conflicts.map(({ block, entry }) => (
            <View key={block.id} style={s.actionRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>
                  {block.title}
                </Text>
                <Text style={shared.small}>
                  {slotLabel(block.start_at, block.end_at)} overlaps{" "}
                  {entry.title}
                  {entry.end_at
                    ? ` (${rangeLabel(entry.start_at, entry.end_at)})`
                    : ""}
                </Text>
              </View>
              <SmallAction
                label="Reschedule"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await client.rescheduleBlock(block.id);
                    await load();
                  })
                }
              />
            </View>
          ))}
        </View>
      )}

      {at_risk.length > 0 && (
        <View style={s.group}>
          <Text style={shared.label}>At risk ({at_risk.length})</Text>
          {at_risk.map((t) => (
            <View key={t.item_id} style={s.row}>
              <Text style={s.title} numberOfLines={1}>
                {t.title}
              </Text>
              <Text style={shared.small}>
                Needs {minutesLabel(t.remaining_minutes) || "more time"},{" "}
                {minutesLabel(t.free_minutes) || "no"} free before it’s due.
                {t.reason ? ` ${t.reason}` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}
    </FadeIn>
  );
}

const s = StyleSheet.create({
  hint: { marginTop: 2, marginBottom: 12 },
  group: { marginTop: 6, marginBottom: 6 },
  row: { paddingVertical: 6 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
  },
  title: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  button: { marginTop: 8, marginBottom: 0 },
});
