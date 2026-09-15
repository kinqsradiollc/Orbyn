import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { Item, ItemDetail } from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { PlanningMeta } from "../components/PlanningMeta";
import { client } from "../lib/api";
import { minutesLabel, nextUp } from "../lib/planning";
import { useNow } from "../hooks/useNow";
import { useRun } from "../hooks/useRun";
import {
  animateLayout,
  pop,
  PressableScale,
  useReducedMotion,
} from "../motion";
import { colors, fonts, radii, spacing } from "../theme";
import { shared } from "../styles";

/** Runs shorter than this (a stray tap) aren't logged. */
const MIN_RUN_MS = 5000;

const clock = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
};

/**
 * Full-screen focus on one task: its checklist, a start / pause timer that
 * logs the minutes worked, Mark done with a short celebration, and the next
 * most pressing task.
 */
export function FocusScreen({
  item,
  items,
  onClose,
  onDismiss,
  onSwitch,
  onChanged,
}: {
  /** The task in focus; the screen is shown while this is set. */
  item: Item | null;
  /** Planner items, for "Next up". */
  items: Item[];
  onClose: () => void;
  /** iOS: called once the dismiss animation has finished. */
  onDismiss?: () => void;
  /** Focus on another task. */
  onSwitch: (item: Item) => void;
  onChanged: () => void;
}) {
  const reduced = useReducedMotion();
  // The body logs running time before leaving; Android's back button goes through it too.
  const leave = useRef(onClose);
  leave.current = onClose;
  return (
    <Modal
      visible={!!item}
      animationType={reduced ? "none" : "slide"}
      presentationStyle="fullScreen"
      onRequestClose={() => leave.current()}
      onDismiss={onDismiss}
    >
      <SafeAreaProvider>
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={s.screen}
        >
          {item && (
            <Body
              key={item.id}
              seed={item}
              items={items}
              leaveRef={leave}
              onClose={onClose}
              onSwitch={onSwitch}
              onChanged={onChanged}
            />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Body({
  seed,
  items,
  leaveRef,
  onClose,
  onSwitch,
  onChanged,
}: {
  seed: Item;
  items: Item[];
  leaveRef: React.RefObject<() => void>;
  onClose: () => void;
  onSwitch: (item: Item) => void;
  onChanged: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [session, setSession] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const now = useNow(1000, startedAt !== null);
  const item: Item = detail ?? seed;
  const done = item.status === "done";
  const elapsed =
    startedAt === null ? 0 : Math.max(0, now.getTime() - startedAt);
  const next = nextUp(items, seed.id)[0];
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);

  useEffect(() => {
    let alive = true;
    client
      .getItem(seed.id)
      .then((d) => alive && setDetail(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [seed.id, setError]);

  /** Stop the timer and log what ran. False when logging failed. */
  const stop = async () => {
    if (startedAt === null) return true;
    const ms = Date.now() - startedAt;
    setStartedAt(null);
    if (ms < MIN_RUN_MS) return true;
    const minutes = Math.min(1440, Math.max(1, Math.round(ms / 60_000)));
    const saved = await run(() => client.logTime(seed.id, minutes));
    if (!saved) return false;
    setDetail(saved);
    setSession((m) => m + minutes);
    onChanged();
    return true;
  };

  const close = async () => {
    if (await stop()) onClose();
  };
  leaveRef.current = () => void close();

  const markDone = async () => {
    if (!(await stop())) return;
    const saved = await run(() =>
      client.postItemUpdate(seed.id, { status: "done" }),
    );
    if (!saved) return;
    animateLayout();
    setDetail(saved);
    setCelebrating(true);
    onChanged();
  };

  const toggleStep = (stepId: string, value: boolean) =>
    run(async () => {
      setDetail(await client.updateStep(seed.id, stepId, { done: value }));
      onChanged();
    });

  return (
    <>
      <View style={s.header}>
        <Text style={s.eyebrow}>FOCUS</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            startedAt !== null ? "Log time and close focus" : "Close focus"
          }
          hitSlop={10}
          onPress={() => void close()}
          style={s.round}
        >
          <Icon name="x" size={18} color={colors.textSoft} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <Text style={s.title} accessibilityRole="header">
            {item.title}
          </Text>
          <PlanningMeta item={item} large />
          {!!item.notes && <Text style={s.notes}>{item.notes}</Text>}

          {!done && (
            <View style={s.timerCard}>
              <Text
                style={s.timer}
                accessibilityRole="timer"
                accessibilityLabel={`Timer ${clock(elapsed)}`}
              >
                {clock(elapsed)}
              </Text>
              <Text style={shared.small}>
                {startedAt !== null
                  ? "Pause to log your time."
                  : session
                    ? `${minutesLabel(session)} logged this session`
                    : item.spent_minutes
                      ? `${minutesLabel(item.spent_minutes)} logged so far`
                      : "Start the timer when you begin."}
              </Text>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={
                  startedAt !== null ? "Pause and log time" : "Start timer"
                }
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() =>
                  startedAt !== null ? void stop() : setStartedAt(Date.now())
                }
                style={({ pressed }) => [
                  s.play,
                  pressed && { backgroundColor: colors.accentPressed },
                  busy && { opacity: 0.5 },
                ]}
              >
                <Icon
                  name={startedAt !== null ? "pause" : "play"}
                  size={26}
                  color={colors.white}
                  strokeWidth={2}
                />
              </PressableScale>
            </View>
          )}

          {celebrating && <Celebration title={item.title} />}

          {steps.length > 0 && (
            <View style={shared.card}>
              <Text style={[shared.sectionTitle, s.gapBelow]}>Checklist</Text>
              {steps.map((step, n) => (
                <Pressable
                  key={step.id}
                  accessibilityRole="checkbox"
                  accessibilityLabel={step.title}
                  accessibilityState={{ checked: step.done, disabled: busy }}
                  disabled={busy}
                  onPress={() => void toggleStep(step.id, !step.done)}
                  style={[s.step, n > 0 && s.divider]}
                >
                  <View style={[s.check, step.done && s.checked]}>
                    {step.done && (
                      <Icon
                        name="check"
                        size={12}
                        color={colors.white}
                        strokeWidth={3}
                      />
                    )}
                  </View>
                  <Text style={[s.stepText, step.done && s.stepDone]}>
                    {step.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {!done && (
            <Button
              title={busy ? "Saving…" : "Mark done"}
              icon="check"
              disabled={busy}
              onPress={() => void markDone()}
            />
          )}

          {next && (
            <View style={[shared.card, s.next]}>
              <Text style={shared.label}>Next up</Text>
              <Text style={s.nextTitle}>{next.title}</Text>
              <PlanningMeta item={next} />
              <Button
                secondary
                title="Focus on this next"
                icon="arrowRight"
                disabled={busy}
                style={s.nextButton}
                onPress={async () => {
                  if (await stop()) onSwitch(next);
                }}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

/** A check that pops in with a short message; still under reduced motion. */
function Celebration({ title }: { title: string }) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(reduced ? 1 : 0.6)).current;
  useEffect(() => {
    if (reduced) return;
    pop(scale, 1.2).start();
  }, [reduced, scale]);
  return (
    <View
      style={s.celebrate}
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`Nice work. ${title} is done.`}
    >
      <Animated.View style={[s.badge, { transform: [{ scale }] }]}>
        <Icon name="check" size={28} color={colors.white} strokeWidth={3} />
      </Animated.View>
      <Text style={s.celebrateTitle}>Nice work.</Text>
      <Text style={[shared.body, s.center]}>{title} is done.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.page,
    paddingVertical: 14,
  },
  eyebrow: { ...shared.eyebrow, marginBottom: 0 },
  round: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: spacing.page, paddingTop: 4, paddingBottom: 40 },
  column: { width: "100%", maxWidth: 600, alignSelf: "center" },
  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    color: colors.text,
  },
  notes: { ...shared.body, marginTop: 12 },
  timerCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingVertical: 26,
    paddingHorizontal: 18,
    marginVertical: 20,
    gap: 6,
  },
  timer: {
    fontFamily: fonts.display,
    fontSize: 56,
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  play: {
    marginTop: 12,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  celebrate: {
    alignItems: "center",
    backgroundColor: colors.soft,
    borderWidth: 1,
    borderColor: colors.softBorder,
    borderRadius: radii.card,
    padding: 22,
    marginVertical: 20,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  celebrateTitle: { ...shared.title, fontSize: 24 },
  center: { textAlign: "center" },
  gapBelow: { marginBottom: 8 },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingVertical: 10,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: "#cfd7ce",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checked: { backgroundColor: colors.accent, borderColor: colors.accent },
  stepText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  stepDone: { color: colors.faint, textDecorationLine: "line-through" },
  next: { marginTop: 8 },
  nextTitle: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.text,
  },
  nextButton: { marginTop: 12, marginBottom: 0 },
});
