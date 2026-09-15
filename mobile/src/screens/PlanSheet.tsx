import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { BREAK_LEVELS, type BreakLevel, type Plan } from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { PlanView } from "../components/PlanView";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import { deviceTimeZone } from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

const DAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;
const DAY_LABELS = { "1": "Today" } as const;
/** Quick picks for padding, in percent; the saved setting joins them. */
const PADS = [0, 10, 15, 25, 50];
const BREAK_LABELS: Record<BreakLevel, string> = {
  none: "None",
  light: "Light",
  normal: "Normal",
  intense: "Often",
};

/**
 * Plan my day: choose how many days, how much to pad estimates, whether long
 * tasks split and how many breaks, preview a plan that fits open tasks around
 * events, then apply it or see it on the calendar first. `seed` opens straight
 * on a plan (unfinished work moved forward from the review card).
 */
export function PlanSheet({
  visible,
  seed,
  onClose,
  onDismiss,
  onApplied,
  onShowOnCalendar,
}: {
  visible: boolean;
  seed: Plan | null;
  onClose: () => void;
  onDismiss?: () => void;
  /** After a plan is applied, so the planner and calendar refresh. */
  onApplied: () => void;
  /** Show the plan as faint blocks on the calendar, to apply from there. */
  onShowOnCalendar?: (plan: Plan) => void;
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
        onShowOnCalendar={onShowOnCalendar}
      />
    </Sheet>
  );
}

function Body({
  seed,
  onApplied,
  onDone,
  onShowOnCalendar,
}: {
  seed: Plan | null;
  onApplied: () => void;
  onDone: () => void;
  onShowOnCalendar?: (plan: Plan) => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [days, setDays] = useState<(typeof DAYS)[number]>("1");
  const [pad, setPad] = useState(15);
  const [split, setSplit] = useState(true);
  const [breakLevel, setBreakLevel] = useState<BreakLevel>("normal");
  const [plan, setPlan] = useState<Plan | null>(seed);
  const [saved, setSaved] = useState<{
    blocks: number;
    skipped: number;
  } | null>(null);

  // Start from the saved planning settings.
  useEffect(() => {
    let alive = true;
    client
      .getPlannerPrefs()
      .then((p) => {
        if (!alive) return;
        setPad(p.pad_percent);
        setBreakLevel(p.break_level);
      })
      .catch(() => {
        // The defaults above still make a sensible plan.
      });
    return () => {
      alive = false;
    };
  }, []);
  const pads = [...new Set([...PADS, pad])].sort((a, b) => a - b);

  const preview = () =>
    run(async () => {
      const next = await client.previewPlan({
        days: Number(days),
        pad_percent: pad,
        split,
        break_level: breakLevel,
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
            <Text style={[shared.label, s.labelTop]}>Pad estimates by</Text>
            <ChipRow label="Pad estimates by">
              {pads.map((n) => (
                <Chip
                  key={n}
                  label={`${n}%`}
                  accessibilityLabel={`${n}% extra time`}
                  selected={pad === n}
                  onPress={() => setPad(n)}
                />
              ))}
            </ChipRow>
            <Text style={[shared.small, s.hint]}>
              Extra time for the unexpected.
            </Text>
            <Text style={[shared.label, s.labelTop]}>
              Breaks between blocks
            </Text>
            <Segmented
              accessibilityLabel="Breaks between blocks"
              options={BREAK_LEVELS}
              labels={BREAK_LABELS}
              value={breakLevel}
              onChange={setBreakLevel}
            />
            <View style={s.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchTitle}>Split long tasks</Text>
                <Text style={shared.small}>
                  Long tasks become several sessions.
                </Text>
              </View>
              <Switch
                value={split}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Split long tasks"
                onValueChange={setSplit}
              />
            </View>
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
          <>
            <Button
              title={busy ? "Saving…" : "Apply plan"}
              icon="check"
              disabled={busy || plan.applied || plan.blocks.length === 0}
              onPress={() => void apply()}
            />
            {onShowOnCalendar && !plan.applied && plan.blocks.length > 0 && (
              <Button
                secondary
                title="See it on the calendar"
                icon="calendar"
                disabled={busy}
                onPress={() => onShowOnCalendar(plan)}
              />
            )}
          </>
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

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 18 },
    labelTop: { marginTop: 18 },
    hint: { marginTop: 8 },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginTop: 18,
    },
    switchTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 3,
    },
    preview: { marginTop: 18, marginBottom: 0 },
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
  }),
);
