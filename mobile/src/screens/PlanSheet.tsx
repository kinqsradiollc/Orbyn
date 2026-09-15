import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Plan } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { PlanView } from "../components/PlanView";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { deviceTimeZone } from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts } from "../theme";
import { shared } from "../styles";

const DAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
const DAY_LABELS = { "1": "Today" } as const;

/**
 * Plan my day: choose how many days, preview a plan that fits open tasks
 * around events, then apply it. `seed` opens straight on a plan (unfinished
 * work moved forward from the review card).
 */
export function PlanSheet({
  visible,
  seed,
  onClose,
  onDismiss,
  onApplied,
}: {
  visible: boolean;
  seed: Plan | null;
  onClose: () => void;
  onDismiss?: () => void;
  /** After a plan is applied, so the planner and calendar refresh. */
  onApplied: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title={seed ? "Move work forward" : "Plan my day"}
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body
        key={seed?.id ?? "new"}
        seed={seed}
        onApplied={onApplied}
        onDone={onClose}
      />
    </Sheet>
  );
}

function Body({
  seed,
  onApplied,
  onDone,
}: {
  seed: Plan | null;
  onApplied: () => void;
  onDone: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [days, setDays] = useState<(typeof DAYS)[number]>("1");
  const [plan, setPlan] = useState<Plan | null>(seed);
  const [saved, setSaved] = useState<{
    blocks: number;
    skipped: number;
  } | null>(null);

  const preview = () =>
    run(async () => {
      const next = await client.previewPlan({
        days: Number(days),
        timezone: deviceTimeZone(),
      });
      animateLayout();
      setPlan(next);
      setSaved(null);
    });

  const apply = () =>
    run(async () => {
      if (!plan) return;
      const result = await client.applyPlan(plan.id);
      animateLayout();
      setSaved({ blocks: result.blocks.length, skipped: result.skipped });
      onApplied();
    });

  return (
    <ScrollView contentContainerStyle={sheetStyles.body}>
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          {seed
            ? "Here’s a new time for the work that didn’t get done. Nothing changes until you apply it."
            : "Orbyn fits your open tasks into free working time around your events. Nothing is saved until you apply the plan."}
        </Text>
        {!seed && (
          <View style={shared.card}>
            <Text style={shared.label}>How many days?</Text>
            <Segmented
              wrap
              accessibilityLabel="Days to plan"
              options={DAYS}
              labels={DAY_LABELS}
              value={days}
              onChange={setDays}
            />
            <Button
              title={
                busy && !plan
                  ? "Planning…"
                  : plan
                    ? "Preview again"
                    : "Preview plan"
              }
              icon="sparkles"
              disabled={busy}
              style={s.preview}
              onPress={() => void preview()}
            />
          </View>
        )}

        {plan && (
          <FadeIn style={shared.card}>
            <Text style={[shared.sectionTitle, s.gapBelow]}>Proposed plan</Text>
            <PlanView plan={plan} />
          </FadeIn>
        )}

        {plan && !saved && (
          <Button
            title={busy ? "Saving…" : "Apply plan"}
            icon="check"
            disabled={busy || plan.applied || plan.blocks.length === 0}
            onPress={() => void apply()}
          />
        )}
        {saved && (
          <FadeIn style={s.saved}>
            <Icon
              name="check"
              size={16}
              color={colors.accent}
              strokeWidth={2.4}
            />
            <Text style={s.savedText} accessibilityRole="alert">
              Plan saved. {saved.blocks} block{saved.blocks === 1 ? "" : "s"}{" "}
              added to your calendar
              {saved.skipped
                ? `; ${saved.skipped} skipped because the time is taken.`
                : "."}
            </Text>
          </FadeIn>
        )}
        {saved && <Button secondary title="Done" onPress={onDone} />}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  intro: { marginTop: 0, marginBottom: 18 },
  preview: { marginTop: 14, marginBottom: 0 },
  gapBelow: { marginBottom: 6 },
  saved: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  savedText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.accent,
  },
});
