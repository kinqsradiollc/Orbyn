import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import {
  customRhythmId,
  FOCUS_RHYTHMS,
  focusRhythm,
  newId,
  type Item,
  type ItemDetail,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { PlanningMeta } from "../components/PlanningMeta";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import * as outbox from "../lib/outbox";
import { minutesLabel, nextUp } from "../lib/planning";
import { useNow } from "../hooks/useNow";
import { useRun } from "../hooks/useRun";
import { useFocusSession } from "../hooks/useFocusSession";
import {
  animateLayout,
  pop,
  PressableScale,
  useReducedMotion,
  Pressable,
} from "../motion";
import { colors, fonts, radii, spacing, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";
import { tap } from "../lib/haptics";

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
  readOnly = false,
}: {
  /** The task in focus; the screen is shown while this is set. */
  item: Item | null;
  /** A team task you can only view: no timer, no Mark done. */
  readOnly?: boolean;
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
              readOnly={readOnly}
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
  readOnly,
}: {
  seed: Item;
  items: Item[];
  leaveRef: React.RefObject<() => void>;
  onClose: () => void;
  onSwitch: (item: Item) => void;
  onChanged: () => void;
  readOnly: boolean;
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
  // Up to four tasks to go to next, most pressing first.
  const upcoming = nextUp(items, seed.id).slice(0, 4);
  const next = upcoming[0];
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const focus = useFocusSession({
    item: seed,
    canWrite: !readOnly,
    onLogged: (d) => {
      setDetail(d);
      onChanged();
    },
    onError: setError,
  });
  const rhythmIds = [...FOCUS_RHYTHMS.map((r) => r.id), "custom"] as const;
  const rhythmKey = focus.rhythm.id.startsWith("custom:")
    ? "custom"
    : focus.rhythm.id;
  const [custom, setCustom] = useState({ work: "30", rest: "5" });
  const chooseCustom = (work: string, rest: string) => {
    const w = Math.max(5, Math.min(180, Number(work) || 30));
    const r = Math.max(1, Math.min(30, Number(rest) || 5));
    focus.chooseRhythm(focusRhythm(customRhythmId(w, r, r * 3, 4))!);
  };

  useEffect(() => {
    let alive = true;
    client
      .getItem(seed.id)
      .then((d) => alive && setDetail(d))
      .catch((e: Error) => alive && setError(errorText(e)));
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
    const minutes = Math.min(600, Math.max(1, Math.round(ms / 60_000)));
    const ended = Date.now();
    const saved = await run(() =>
      client.saveFocusSession({
        id: newId(),
        item_id: seed.id,
        kind: "work",
        started_at: new Date(ended - ms).toISOString(),
        ended_at: new Date(ended).toISOString(),
        planned_minutes: 0,
        minutes,
        completed: true,
      }),
    );
    if (!saved) return false;
    if (saved.item) setDetail(saved.item);
    setSession((m) => m + minutes);
    focus.refreshToday();
    onChanged();
    return true;
  };

  /** Log the open timer, keep the work of a session cut short, stop sharing. */
  const settle = async () => {
    const ok = await stop();
    await focus.finish();
    return ok;
  };

  // Leaving while a session runs is stepping away, not stopping: it keeps
  // going and "Back to focus" on Today returns to it. End session stops it.
  const keepsRunning = focus.running && !!focus.state.ends_at;
  const close = async () => {
    if (keepsRunning) {
      if (await stop()) onClose();
      return;
    }
    if (await settle()) onClose();
  };
  const endSession = async () => {
    if (await settle()) onClose();
  };
  leaveRef.current = () => void close();

  // Leaving the app stops the timer and logs what ran, like closing focus.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      // Only a real switch away, not a glance at Control Center.
      if (state === "background") void stopRef.current();
    });
    return () => sub.remove();
  }, []);

  const markDone = async () => {
    if (!(await settle())) return;
    let queued = false;
    tap();
    const saved = await run(async () => {
      const answer = await outbox.postItemUpdate(seed, { status: "done" });
      queued = answer === null;
      return answer;
    });
    if (!saved && !queued) return;
    animateLayout();
    setDetail((d) =>
      saved
        ? (saved as ItemDetail)
        : d
          ? { ...d, status: "done", progress: 100 }
          : d,
    );
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

          {readOnly && (
            <View style={s.viewOnly}>
              <Icon name="users" size={16} color={colors.accent} />
              <Text style={s.viewOnlyText}>
                View only — you’re a viewer in this team, so the timer and Mark
                done are off.
              </Text>
            </View>
          )}

          {!done && !readOnly && (
            <View style={s.rhythm}>
              <Segmented
                options={rhythmIds}
                value={rhythmKey}
                disabled={focus.running || startedAt !== null}
                labels={Object.fromEntries([
                  ...FOCUS_RHYTHMS.map((r) => [r.id, r.label]),
                  ["custom", "Custom"],
                ])}
                accessibilityLabel="Rhythm"
                onChange={(id) =>
                  id === "custom"
                    ? chooseCustom(custom.work, custom.rest)
                    : focus.chooseRhythm(focusRhythm(id)!)
                }
              />
              {rhythmKey === "custom" && !focus.running && (
                <View style={s.customRow}>
                  <Text style={shared.small}>Work</Text>
                  <TextInput
                    style={[shared.input, s.customInput]}
                    keyboardType="number-pad"
                    value={custom.work}
                    maxLength={3}
                    accessibilityLabel="Work minutes"
                    onChangeText={(work) => setCustom({ ...custom, work })}
                    onEndEditing={() => chooseCustom(custom.work, custom.rest)}
                  />
                  <Text style={shared.small}>min · Break</Text>
                  <TextInput
                    style={[shared.input, s.customInput]}
                    keyboardType="number-pad"
                    value={custom.rest}
                    maxLength={2}
                    accessibilityLabel="Break minutes"
                    onChangeText={(rest) => setCustom({ ...custom, rest })}
                    onEndEditing={() => chooseCustom(custom.work, custom.rest)}
                  />
                  <Text style={shared.small}>min</Text>
                </View>
              )}
            </View>
          )}

          {!done && !readOnly && focus.intervals && (
            <View style={s.timerCard}>
              <Ring
                progress={1 - focus.remaining / Math.max(1, focus.total)}
                rest={focus.state.phase !== "work"}
              >
                <Text
                  style={s.ringClock}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  accessibilityRole="timer"
                  accessibilityLabel={`${focus.label}, ${clock(focus.remaining)} left`}
                >
                  {clock(focus.remaining)}
                </Text>
                <Text style={shared.small}>{focus.label}</Text>
              </Ring>
              <Text style={shared.small}>{focus.then}</Text>
              <View style={s.dots} accessible={false}>
                {Array.from({ length: focus.rhythm.rounds }, (_, n) => {
                  const within =
                    ((focus.state.round - 1) % focus.rhythm.rounds) + 1;
                  const on =
                    n + 1 < within ||
                    (n + 1 === within && focus.state.phase !== "work");
                  return (
                    <View
                      key={n}
                      style={[
                        s.dot,
                        on && s.dotOn,
                        n + 1 === within && !on && s.dotNow,
                      ]}
                    />
                  );
                })}
              </View>
              <View style={s.intervalButtons}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={focus.running ? "Pause" : "Start"}
                  onPress={() =>
                    focus.running ? focus.pause() : focus.start()
                  }
                  style={({ pressed }) => [
                    s.play,
                    pressed && { backgroundColor: colors.accentPressed },
                  ]}
                >
                  <Icon
                    name={focus.running ? "pause" : "play"}
                    size={26}
                    color={colors.white}
                    strokeWidth={2}
                  />
                </PressableScale>
                {keepsRunning && (
                  <SmallAction
                    label="End session"
                    disabled={busy}
                    onPress={() => void endSession()}
                  />
                )}
                {focus.state.phase !== "work" && (
                  <SmallAction
                    label="Skip break"
                    disabled={busy}
                    onPress={focus.skip}
                  />
                )}
              </View>
              <Text style={[shared.small, s.center]}>
                {focus.today
                  ? `${minutesLabel(focus.today)} focused today. `
                  : ""}
                Work time is logged to this task as each session ends.
              </Text>
              {!!focus.movedTo && (
                <Text
                  style={[shared.small, s.center]}
                  accessibilityRole="alert"
                >
                  Continued on {focus.movedTo}. The time you ran here is logged.
                </Text>
              )}
            </View>
          )}

          {!done && !readOnly && !focus.intervals && (
            <View style={s.timerCard}>
              <Text
                style={s.timer}
                numberOfLines={1}
                adjustsFontSizeToFit
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
                  accessibilityState={{
                    checked: step.done,
                    disabled: busy || readOnly,
                  }}
                  disabled={busy || readOnly}
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

          {!done && !readOnly && (
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
                  if (await settle()) onSwitch(next);
                }}
              />
              {upcoming.slice(1).map((other) => (
                <View key={other.id} style={[s.otherRow, s.divider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.otherTitle} numberOfLines={1}>
                      {other.title}
                    </Text>
                    <PlanningMeta item={other} />
                  </View>
                  <SmallAction
                    label="Focus"
                    disabled={busy}
                    onPress={async () => {
                      if (await settle()) onSwitch(other);
                    }}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </>
  );
}

/** How far through the phase, as a ring; the time sits inside it. */
function Ring({
  progress,
  rest,
  children,
}: {
  progress: number;
  rest: boolean;
  children: React.ReactNode;
}) {
  const size = 188;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const done = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.surfaceMuted}
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={rest ? colors.dot : colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${length} ${length}`}
          strokeDashoffset={length * (1 - done)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={s.ringInner}>{children}</View>
    </View>
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

const s = themed(() =>
  StyleSheet.create({
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
      fontSize: 24,
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
      fontSize: 36,
      letterSpacing: -1.5,
      color: colors.text,
      fontVariant: ["tabular-nums"],
    },
    rhythm: { marginTop: 18, gap: 10 },
    customRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    customInput: { width: 64, textAlign: "center" },
    ringInner: {
      ...StyleSheet.absoluteFill,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    ringClock: {
      fontFamily: fonts.display,
      fontSize: 36,
      letterSpacing: -1,
      color: colors.text,
      fontVariant: ["tabular-nums"],
      maxWidth: 150,
    },
    dots: { flexDirection: "row", gap: 6, marginTop: 4 },
    dot: {
      width: 22,
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dotOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    dotNow: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    intervalButtons: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      marginTop: 8,
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
      borderColor: colors.checkBorder,
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
      fontSize: 15,
      color: colors.text,
    },
    nextButton: { marginTop: 12, marginBottom: 0 },
    otherRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingTop: 12,
      marginTop: 12,
    },
    otherTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    viewOnly: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      marginVertical: 16,
    },
    viewOnlyText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
  }),
);
