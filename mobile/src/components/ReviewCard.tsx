import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  atRiskLine,
  type Item,
  type Plan,
  type PlannerReview,
} from "@orbyn/core";
import { Button } from "./Button";
import { ErrorBanner } from "./ErrorBanner";
import { SmallAction } from "./SmallAction";
import { client } from "../lib/api";
import { rangeLabel, slotLabel } from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

/** Unfinished blocks shown before "Show all". */
const FEW = 5;

/**
 * An at-risk task in the plan's words: "Needs 2h, 45m free before Fri 2 Oct,
 * 5 pm", or the daily notice's when the minutes aren't there.
 */
const riskLine = (t: PlannerReview["at_risk"][number]) => {
  const line = atRiskLine(t);
  return line ? line[0].toUpperCase() + line.slice(1) : t.reason;
};

/**
 * What needs a look in the plan: unfinished time blocks (move them forward,
 * one or all), blocks that now clash with an event (reschedule), and tasks
 * at risk of missing their due date. Hidden when there's nothing to review.
 */
export function ReviewCard({
  items,
  onPlan,
  showUnfinished = true,
}: {
  /** Planner items; the review reloads when they change. */
  items: Item[];
  /** Open a proposed plan to review and apply. */
  onPlan: (plan: Plan) => void;
  /**
   * List unfinished sessions (with Move forward). Off beside the Today
   * list, whose "Not finished" rows offer Plan again.
   */
  showUnfinished?: boolean;
}) {
  const [review, setReview] = useState<PlannerReview | null>(null);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState("");
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
  const { conflicts, at_risk } = review;
  const unfinished = showUnfinished ? review.unfinished : [];
  if (!unfinished.length && !conflicts.length && !at_risk.length && !note)
    return null;
  const shownUnfinished = all ? unfinished : unfinished.slice(0, FEW);

  const moveForward = (ids?: string[]) =>
    void run(async () => {
      onPlan(await client.rollForward(ids));
    });

  return (
    <FadeIn style={shared.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={shared.sectionTitle} accessibilityRole="header">
            Needs a look
          </Text>
          <Text style={[shared.small, s.hint]}>Keep your plan honest.</Text>
        </View>
        <SmallAction
          label={busy ? "Checking…" : "Refresh"}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              setNote("");
              await load();
            })
          }
        />
      </View>
      <ErrorBanner error={error} onDismiss={() => setError("")} />
      {!!note && (
        <Text style={s.note} accessibilityRole="alert">
          {note}
        </Text>
      )}

      {unfinished.length > 0 && (
        <View style={s.group}>
          <Text style={shared.label}>Unfinished ({unfinished.length})</Text>
          {shownUnfinished.map((b) => (
            <View key={b.id} style={s.actionRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>
                  {b.title}
                </Text>
                <Text style={shared.small}>
                  {slotLabel(b.start_at, b.end_at)}
                </Text>
              </View>
              <SmallAction
                label="Move forward"
                disabled={busy}
                onPress={() => moveForward([b.id])}
              />
            </View>
          ))}
          {unfinished.length > FEW && (
            <View style={s.more}>
              <SmallAction
                label={all ? "Show fewer" : `Show all ${unfinished.length}`}
                disabled={false}
                onPress={() => {
                  animateLayout();
                  setAll(!all);
                }}
              />
            </View>
          )}
          <Button
            secondary
            icon="arrowRight"
            title={busy ? "Planning…" : "Move all forward"}
            disabled={busy}
            style={s.button}
            onPress={() => moveForward(unfinished.map((b) => b.id))}
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
                    const moved = await client.rescheduleBlock(block.id);
                    setNote(
                      `${block.title} moved to ${slotLabel(moved.start_at, moved.end_at)}.`,
                    );
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
              <Text style={shared.small}>{riskLine(t)}</Text>
            </View>
          ))}
        </View>
      )}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    hint: { marginTop: 2, marginBottom: 12 },
    note: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
      marginBottom: 8,
    },
    group: { marginTop: 6, marginBottom: 6 },
    row: { paddingVertical: 6 },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
    },
    more: { flexDirection: "row", marginTop: 4 },
    title: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    button: { marginTop: 8, marginBottom: 0 },
  }),
);
