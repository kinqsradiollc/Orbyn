import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  SESSION_OUTCOME_LABELS,
  checkInNote,
  shortMinutes,
  todayIsCurrent,
  todayRowWords,
  unfinishedHeading,
  unfinishedWhen,
  type SessionCheckIn,
  type SessionOutcome,
  type TodayList,
  type TodayRow,
} from "@orbyn/core";
import { client } from "../lib/api";
import { tap } from "../lib/haptics";
import { Icon, type IconName } from "./Icon";
import { Pill, chipTone } from "./Pill";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { FadeIn, PressableScale, animateLayout } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** Late tasks shown before "Show all". */
const LATE_SHOWN = 3;
/** Where "Dismiss" on a Not finished row is remembered, on this phone. */
const DISMISSED_KEY = "orbyn-today-dismissed";

const readDismissed = (): string[] =>
  (readLocal(DISMISSED_KEY) ?? "").split(",").filter(Boolean);

/** "Thu 24 Sep" for a YYYY-MM-DD day. */
const dayName = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

const iconOf = (r: TodayRow): IconName =>
  r.kind === "event"
    ? "calendar"
    : r.kind === "session"
      ? "clock"
      : r.due === "late"
        ? "alert"
        : "target";

/**
 * Today, planned and due in one list (GET /today), as on the web's
 * Overview: events, your sessions, tasks due today and late ones in time
 * order, a task both planned and due as one row with two chips, and the
 * sessions you didn't finish yesterday with Plan again and Dismiss. The
 * title on line one, the time and chips on line two, the button on the
 * right.
 */
export function TodayCard({
  today,
  onOpen,
  onFocus,
  onPlanIt,
  onPlanAgain,
  onOpenCalendar,
  busy,
  onCheckedIn,
}: {
  today: TodayList | null;
  /** Opens a task or event by id. */
  onOpen: (itemId: string) => void;
  /** Starts focus mode on a task. */
  onFocus: (itemId: string) => void;
  /** Plans time for a task, looking ahead as far as its deadline. */
  onPlanIt: (itemId: string) => void;
  /** A plan for an unfinished session's work. */
  onPlanAgain: (blockId: string) => void;
  onOpenCalendar: () => void;
  busy: boolean;
  /** After a session check-in: the planner loads again. */
  onCheckedIn?: () => void;
}) {
  const [allLate, setAllLate] = useState(false);
  // Sessions waiting for "how did it go?" are asked about in their own
  // group, not under "Not finished" too.
  const [checkIns, setCheckIns] = useState<SessionCheckIn[]>([]);
  const [asking, setAsking] = useState<string | null>(null);
  const [said, setSaid] = useState<{
    text: string;
    itemId: string;
    plan: boolean;
  } | null>(null);
  const [answering, setAnswering] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    client.sessionCheckIns().then(
      (list) => live && setCheckIns(list),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [today]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  // The words follow the clock ("past"), and the day ends at midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // A list saved for another day (opened offline the next morning) waits.
  if (!today || !todayIsCurrent(today, now)) return null;
  const rows = today.rows;
  const onDay = rows.filter((r) => r.due !== "late" || r.at);
  const late = rows.filter((r) => r.due === "late" && !r.at);
  const lateShown = allLate ? late : late.slice(0, LATE_SHOWN);
  const lateListed = rows.filter((r) => r.due === "late").length;
  const unfinished = today.unfinished.filter(
    (u) =>
      !dismissed.includes(u.block_id) &&
      !checkIns.some((c) => c.id === u.block_id),
  );

  const answer = async (
    c: SessionCheckIn,
    outcome: SessionOutcome,
    more?: number,
  ) => {
    setAnswering(c.id);
    try {
      const r = await client.checkInSession(c.id, {
        outcome,
        ...(more ? { more_minutes: more } : {}),
      });
      tap();
      animateLayout();
      setCheckIns((list) => list.filter((x) => x.id !== c.id));
      setAsking(null);
      setSaid({
        text: `${c.title}: ${checkInNote(outcome, r.counted_minutes)}`,
        itemId: c.item_id,
        plan: outcome !== "done",
      });
      onCheckedIn?.();
    } catch {
      // The row stays; answering again is safe.
    } finally {
      setAnswering(null);
    }
  };

  const dismiss = (blockId: string) => {
    animateLayout();
    // Only ids still listed are kept, so the list doesn't grow for ever.
    const listed = new Set(today.unfinished.map((u) => u.block_id));
    const next = [...dismissed.filter((id) => listed.has(id)), blockId];
    setDismissed(next);
    // SecureStore can't keep an empty value.
    saveLocal(DISMISSED_KEY, next.join(",") || ",");
  };

  const row = (r: TodayRow, n: number) => {
    const words = todayRowWords(r, now);
    const past =
      r.past ||
      (!!r.end_at && r.kind !== "task" && Date.parse(r.end_at) <= +now);
    const warn =
      r.kind === "task" &&
      (r.due === "late" || words.chips.some((c) => c.tone === "warn"));
    const line = [words.lead, words.meta].filter(Boolean).join(" · ");
    const action =
      r.action === "focus"
        ? { label: "Start focus", run: () => onFocus(r.item_id!) }
        : r.action === "plan"
          ? { label: "Plan it", run: () => onPlanIt(r.item_id!) }
          : null;
    return (
      <View key={r.key} style={[s.row, n > 0 && s.divider]}>
        <View style={s.icon}>
          <Icon
            name={iconOf(r)}
            size={16}
            color={
              warn
                ? colors.warning
                : r.kind === "event"
                  ? colors.muted
                  : colors.accent
            }
          />
        </View>
        <Pressable
          accessibilityRole={r.item_id ? "button" : "text"}
          accessibilityLabel={[r.title, line, ...words.chips.map((c) => c.text)]
            .filter(Boolean)
            .join(", ")}
          accessibilityHint={r.item_id ? "Opens it" : undefined}
          disabled={!r.item_id}
          onPress={() => r.item_id && onOpen(r.item_id)}
          style={({ pressed }) => [s.main, pressed && s.pressed]}
        >
          <Text
            numberOfLines={2}
            style={[
              s.title,
              r.kind === "event" && s.eventTitle,
              past && s.pastText,
            ]}
          >
            {r.title}
          </Text>
          {(!!line || words.chips.length > 0) && (
            <View style={s.facts}>
              {!!line && (
                <Text
                  style={[
                    s.line,
                    warn && !!words.lead && s.warnText,
                    r.after_deadline && s.warnText,
                  ]}
                >
                  {line}
                </Text>
              )}
              {words.chips.map((c) => (
                <Pill key={c.text} label={c.text} tone={chipTone(c.tone)} />
              ))}
            </View>
          )}
        </Pressable>
        {action && r.item_id && (
          <PillButton
            label={action.label}
            disabled={busy}
            onPress={action.run}
          />
        )}
      </View>
    );
  };

  const empty = !rows.length && !unfinished.length && !checkIns.length;
  return (
    <FadeIn style={shared.card}>
      <View style={s.head}>
        <Text style={shared.sectionTitle} accessibilityRole="header">
          Today · {dayName(today.day)}
        </Text>
      </View>
      {empty ? (
        <Text style={[shared.small, s.empty]}>
          Nothing planned or due today.
        </Text>
      ) : (
        <>
          {[...onDay, ...lateShown].map(row)}
          {(late.length > LATE_SHOWN || today.late_total > lateListed) && (
            <View style={s.more}>
              {late.length > LATE_SHOWN && (
                <PillButton
                  label={
                    allLate
                      ? "Show fewer late"
                      : `Show ${late.length - LATE_SHOWN} more late`
                  }
                  quiet
                  onPress={() => {
                    animateLayout();
                    setAllLate(!allLate);
                  }}
                />
              )}
              {today.late_total > lateListed && (
                <Text style={shared.small}>
                  {today.late_total - lateListed} more late in Tasks
                </Text>
              )}
            </View>
          )}
          {said && (
            <View style={[s.group, s.said]}>
              <Text style={s.line} accessibilityLiveRegion="polite">
                {said.text}
              </Text>
              <View style={s.saidButtons}>
                {said.plan && (
                  <PillButton
                    label="Plan it"
                    onPress={() => {
                      setSaid(null);
                      onPlanIt(said.itemId);
                    }}
                  />
                )}
                <PillButton label="OK" quiet onPress={() => setSaid(null)} />
              </View>
            </View>
          )}
          {checkIns.length > 0 && (
            <View style={s.group}>
              <Text style={shared.label}>
                How did it go? ({checkIns.length})
              </Text>
              {checkIns.map((c, n) => {
                const start = new Date(c.start_at);
                const when = `${start.toLocaleDateString([], { weekday: "short" })} ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${shortMinutes(c.minutes)}`;
                return (
                  <View key={c.id} style={[s.checkRow, n > 0 && s.divider]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${c.title}, ${when}`}
                      accessibilityHint="Opens it"
                      onPress={() => onOpen(c.item_id)}
                      style={({ pressed }) => [s.main, pressed && s.pressed]}
                    >
                      <Text numberOfLines={2} style={s.title}>
                        {c.title}
                      </Text>
                      <Text style={s.line}>
                        {when}
                        {c.project_name ? ` · ${c.project_name}` : ""}
                      </Text>
                    </Pressable>
                    <View style={s.answers}>
                      {asking === c.id ? (
                        <>
                          {[15, 30, 60, 120].map((m) => (
                            <PillButton
                              key={m}
                              label={`+${shortMinutes(m)}`}
                              disabled={answering === c.id}
                              onPress={() => void answer(c, "more", m)}
                            />
                          ))}
                          <PillButton
                            label="Cancel"
                            quiet
                            onPress={() => setAsking(null)}
                          />
                        </>
                      ) : (
                        <>
                          <PillButton
                            label={SESSION_OUTCOME_LABELS.done}
                            disabled={answering === c.id}
                            onPress={() => void answer(c, "done")}
                          />
                          <PillButton
                            label={SESSION_OUTCOME_LABELS.more}
                            disabled={answering === c.id}
                            onPress={() => setAsking(c.id)}
                          />
                          <PillButton
                            label={SESSION_OUTCOME_LABELS.skipped}
                            quiet
                            disabled={answering === c.id}
                            onPress={() => void answer(c, "skipped")}
                          />
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
          {unfinished.length > 0 && (
            <View style={s.group}>
              <Text style={shared.label}>
                {unfinishedHeading({ unfinished })} ({unfinished.length})
              </Text>
              {unfinished.map((u, n) => (
                <View key={u.block_id} style={[s.row, n > 0 && s.divider]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${u.title}, ${unfinishedWhen(u)}`}
                    accessibilityHint="Opens it"
                    onPress={() => onOpen(u.item_id)}
                    style={({ pressed }) => [s.main, pressed && s.pressed]}
                  >
                    <Text numberOfLines={2} style={s.title}>
                      {u.title}
                    </Text>
                    <Text style={s.line}>{unfinishedWhen(u)}</Text>
                  </Pressable>
                  <View style={s.buttons}>
                    <PillButton
                      label="Plan again"
                      disabled={busy}
                      onPress={() => onPlanAgain(u.block_id)}
                    />
                    <PillButton
                      label="Dismiss"
                      quiet
                      onPress={() => dismiss(u.block_id)}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onOpenCalendar}
        hitSlop={8}
        style={({ pressed }) => [s.footer, pressed && s.pressed]}
      >
        <Text style={s.footerText}>Open calendar</Text>
        <Icon name="arrowRight" size={15} color={colors.accent} />
      </Pressable>
    </FadeIn>
  );
}

/** A rounded pill button beside a row: "Start focus", "Plan it", "Dismiss". */
function PillButton({
  label,
  onPress,
  disabled = false,
  quiet = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  quiet?: boolean;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={onPress}
      style={({ pressed }) => [
        s.pill,
        quiet && s.pillQuiet,
        pressed && s.pillPressed,
        disabled && s.disabled,
      ]}
    >
      <Text style={[s.pillText, quiet && s.pillTextQuiet]}>{label}</Text>
    </PressableScale>
  );
}

const s = themed(() =>
  StyleSheet.create({
    head: { marginBottom: 6 },
    empty: { marginTop: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 11,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    icon: { alignSelf: "flex-start", paddingTop: 2 },
    main: { flex: 1, gap: 4 },
    pressed: { opacity: 0.6 },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    eventTitle: { fontFamily: fonts.medium, color: colors.textSoft },
    pastText: { color: colors.muted },
    facts: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
    },
    line: {
      fontFamily: fonts.regular,
      fontSize: 13,
      color: colors.muted,
    },
    warnText: { color: colors.warning, fontFamily: fonts.semibold },
    more: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
    },
    group: {
      marginTop: 8,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    buttons: { gap: 6, alignItems: "flex-end" },
    checkRow: { gap: 8, paddingVertical: 11 },
    answers: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    said: { gap: 8 },
    saidButtons: { flexDirection: "row", gap: 6 },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 6,
      marginTop: 8,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    footerText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    pill: {
      minHeight: controls.tap - 10,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    pillQuiet: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    pillPressed: { opacity: 0.7 },
    disabled: { opacity: 0.45 },
    pillText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    pillTextQuiet: { color: colors.textSoft },
  }),
);
