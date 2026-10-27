import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  clockMinutes,
  dayTime,
  dueDateOf,
  freshItem,
  weekdayOf,
  type BusyInterval,
  type MeetingSlot,
  type MemberAvailability,
  type MemberWorkload,
  type TeamAnalytics,
  type TeamMember,
} from "@orbyn/core";
import { InlineDetails } from "../../components/InlineDetails";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import type { Editing } from "../tasks/ItemEditor";
import { Pill } from "../../components/Pill";
import { ProgressBar } from "../../components/ProgressBar";
import { SmallAction } from "../../components/SmallAction";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import * as outbox from "../../lib/outbox";
import { TeamCapacity } from "./TeamCapacity";
import { TeamAttention } from "../followthrough/Attention";
import {
  dayStart,
  minutesLabel,
  rangeLabel,
  slotLabel,
} from "../planner/planning";
import { useRun } from "../../hooks/useRun";
import { FadeIn, animateLayout } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

const LENGTHS = [15, 30, 45, 60, 90, 120];
const DAY_MINUTES = 1440;
const DAY_MS = 86_400_000;

/** "2026-09-18" for a local date. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local midnight on the Monday of `d`'s week. */
const mondayOf = (d: Date) => dayStart(-((d.getDay() + 6) % 7), d);

/** A fraction of the day's bar, from minutes after local midnight. */
const frac = (minutes: number) =>
  Math.max(0, Math.min(DAY_MINUTES, minutes)) / DAY_MINUTES;

/** A member's working window on `day`, in minutes from local midnight. */
function workWindow(m: MemberAvailability, day: Date) {
  const key = dayKey(day);
  if (!m.work_days.includes(weekdayOf(key))) return null;
  const start = dayTime(key, clockMinutes(m.work_start), m.timezone);
  const end = dayTime(key, clockMinutes(m.work_end), m.timezone);
  return {
    from: (start.getTime() - day.getTime()) / 60000,
    to: (end.getTime() - day.getTime()) / 60000,
  };
}

/** Busy intervals clipped to one day's bar. */
function segments(busy: BusyInterval[], day: Date) {
  const start = day.getTime();
  return busy
    .map((b) => ({
      key: b.start_at,
      from: (Date.parse(b.start_at) - start) / 60000,
      to: (Date.parse(b.end_at) - start) / 60000,
      label: rangeLabel(b.start_at, b.end_at),
    }))
    .filter((b) => b.to > 0 && b.from < DAY_MINUTES);
}

/**
 * Team time inside a team, a week at a time: when each member works and is
 * busy (busy only, never what for), who is overloaded, and Find a time.
 */
export function TeamTime({
  teamId,
  members,
  userId,
  canWrite,
  canManage = false,
  onCreated,
  onOpenItem,
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  teamId: string;
  members: TeamMember[];
  userId?: string;
  /** Whether you can add team events (Find a time → book). */
  canWrite: boolean;
  /** Only a manager sees how the team's time was set aside. */
  canManage?: boolean;
  /** After a team event is created. */
  onCreated: () => void;
  /** Open the item editor, e.g. with a meeting time filled in. */
  onOpenItem?: (editing: Editing) => void;
}) {
  const { busy, error, setError, run: execute } = useRun();
  const mutation = useRef(false);
  const budgetLock = useRef(false);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const mounted = useRef(true);
  const owner = useRef(session.token).current;
  const reporter = useRef(onBusyChange);
  reporter.current = onBusyChange;
  const current = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reporter.current?.(false);
    };
  }, []);
  const run = async <T,>(fn: () => Promise<T>) => {
    if (!current() || mutation.current || budgetLock.current || disabled)
      return;
    mutation.current = true;
    reporter.current?.(true);
    try {
      return await execute(fn);
    } finally {
      mutation.current = false;
      if (current()) reporter.current?.(false);
    }
  };
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [availability, setAvailability] = useState<MemberAvailability[] | null>(
    null,
  );
  const [readError, setReadError] = useState("");
  const [readRevision, setReadRevision] = useState(0);
  const [workload, setWorkload] = useState<MemberWorkload[] | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>(() =>
    members.map((m) => m.user_id),
  );
  const [length, setLength] = useState(30);
  const [title, setTitle] = useState("Team meeting");
  const queryKey = JSON.stringify([
    teamId,
    people,
    length,
    members.map((m) => m.user_id),
  ]);
  const query = useRef(queryKey);
  query.current = queryKey;
  const [result, setResult] = useState<{
    key: string;
    slots: MeetingSlot[];
  } | null>(null);
  const slots = result?.key === queryKey ? result.slots : null;
  const [booked, setBooked] = useState("");
  /** The most people a hand-picked search can ask about (the server's limit). */
  const MAX_PEOPLE = 50;
  const everyone = members.every((member) => people.includes(member.user_id));
  const tooMany = !everyone && people.length > MAX_PEOPLE;

  const days = Array.from({ length: 7 }, (_, n) => dayStart(n, weekStart));
  const weekEnd = dayStart(7, weekStart);
  const thisWeek = mondayOf(new Date()).getTime() === weekStart.getTime();
  const todayKey = dayKey(new Date());
  const weekLabel = `${days[0].toLocaleDateString([], {
    month: "short",
    day: "numeric",
  })} – ${days[6].toLocaleDateString([], { month: "short", day: "numeric" })}`;

  useEffect(() => {
    client
      .getPlannerPrefs()
      .then((prefs) => {
        if (current()) setPinned(prefs.pinned_user_ids);
      })
      .catch(() => {});
  }, []);

  /** Set-aside time over the last 30 days, for managers. */
  const [analytics, setAnalytics] = useState<TeamAnalytics | null>(null);
  useEffect(() => {
    if (!canManage) return setAnalytics(null);
    let alive = true;
    client
      .teamAnalytics(teamId, 30)
      .then((a) => alive && setAnalytics(a))
      // The week's own numbers are the point here; this is an extra.
      .catch(() => alive && setAnalytics(null));
    return () => {
      alive = false;
    };
  }, [teamId, canManage]);

  useEffect(() => {
    let alive = true;
    setAvailability(null);
    setWorkload(null);
    setReadError("");
    const from = weekStart.toISOString();
    const to = dayStart(7, weekStart).toISOString();
    Promise.all([
      client.teamAvailability(teamId, from, to),
      client.teamWorkload(teamId, from, to),
    ])
      .then(([a, w]) => {
        if (!alive) return;
        animateLayout();
        setAvailability(a);
        setWorkload(w);
      })
      .catch((e: Error) => {
        if (alive && current()) setReadError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [teamId, weekStart, readRevision]);

  const order = (a: { user_id: string; name: string }, b: typeof a) =>
    Number(pinned.includes(b.user_id)) - Number(pinned.includes(a.user_id)) ||
    a.name.localeCompare(b.name);
  const togglePin = (id: string) =>
    run(async () => {
      const next = pinned.includes(id)
        ? pinned.filter((x) => x !== id)
        : [...pinned, id].slice(-20);
      const prefs = await client.updatePlannerPrefs({ pinned_user_ids: next });
      if (!current()) return;
      animateLayout();
      setPinned(prefs.pinned_user_ids);
    });

  const find = () => {
    if (tooMany)
      return setError(`Pick up to ${MAX_PEOPLE} people, or everyone.`);
    return run(async () => {
      const key = queryKey;
      // Start on the next quarter hour, like the web.
      const from = new Date();
      from.setMinutes(Math.ceil(from.getMinutes() / 15) * 15, 0, 0);
      const found = await client.suggestMeetingTimes(teamId, {
        from: from.toISOString(),
        to: new Date(from.getTime() + 7 * DAY_MS).toISOString(),
        duration: length,
        // Everyone: the server asks about every member by default.
        ...(everyone ? {} : { user_ids: people }),
      });
      if (!current() || query.current !== key) return;
      animateLayout();
      setResult({ key, slots: found.slice(0, 8) });
      setBooked("");
    });
  };

  const meetingTitle = () => title.trim() || "Team meeting";

  /** Open the event in the editor to check before saving. */
  const openInEditor = (slot: MeetingSlot) =>
    canWrite &&
    current() &&
    slots?.includes(slot) &&
    onOpenItem?.({
      ...freshItem(),
      kind: "event",
      title: meetingTitle(),
      due_at: slot.start_at,
      end_at: slot.end_at,
      team_id: teamId,
    });

  /** Save the event straight away. */
  const book = (slot: MeetingSlot) =>
    canWrite &&
    current() &&
    slots?.includes(slot) &&
    run(async () => {
      const made = await outbox.createItem({
        title: meetingTitle(),
        kind: "event",
        due_at: slot.start_at,
        end_at: slot.end_at,
        team_id: teamId,
      });
      if (!current()) return;
      animateLayout();
      setResult(null);
      setBooked(
        made
          ? `Added for ${slotLabel(slot.start_at, slot.end_at)}.`
          : `Saved on this phone for ${slotLabel(slot.start_at, slot.end_at)}. It’s sent when you’re back online.`,
      );
      onCreated();
    });

  const atRisk = (workload ?? [])
    .flatMap((w) => w.at_risk_items ?? [])
    .sort((a, b) => Date.parse(a.deadline_at) - Date.parse(b.deadline_at));

  return (
    <>
      <ErrorBanner error={error} onDismiss={() => setError("")} />

      {!!readError && (
        <View>
          <Text accessibilityRole="alert" style={shared.small}>
            {readError}
          </Text>
          <Button
            secondary
            title="Retry team time"
            onPress={() => setReadRevision((value) => value + 1)}
          />
        </View>
      )}
      <View style={s.weekHead}>
        <Text style={[shared.eyebrow, s.weekEyebrow]}>TEAM TIME</Text>
        <Text style={s.weekLabel} accessibilityLiveRegion="polite">
          Week of {weekLabel}
        </Text>
        <View style={s.weekNav}>
          <SmallAction
            label="Earlier"
            disabled={budgetBusy}
            onPress={() => setWeekStart(dayStart(-7, weekStart))}
          />
          <SmallAction
            label="This week"
            disabled={thisWeek || budgetBusy}
            onPress={() => setWeekStart(mondayOf(new Date()))}
          />
          <SmallAction
            label="Later"
            disabled={budgetBusy}
            onPress={() => setWeekStart(weekEnd)}
          />
        </View>
      </View>

      <InlineDetails title="Availability">
        <View style={s.panel}>
          <Text style={[shared.small, s.gap]}>
            Work hours and busy times only. Event details stay private.
          </Text>
          {availability === null && !readError && (
            <Text style={shared.small}>Loading availability…</Text>
          )}
          {[...(availability ?? [])].sort(order).map((m, n) => {
            const me = m.user_id === userId;
            const isPinned = pinned.includes(m.user_id);
            return (
              <FadeIn
                key={m.user_id}
                index={n}
                style={[s.member, n > 0 && s.divider]}
              >
                <View style={s.memberTop}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.name}>
                      {m.name}
                      {me ? " (you)" : ""}
                    </Text>
                    <Text style={shared.small}>
                      {m.timezone.replace(/_/g, " ")}
                    </Text>
                  </View>
                  {!me && (
                    <SmallAction
                      label={isPinned ? "Unpin" : "Pin"}
                      disabled={busy}
                      onPress={() => void togglePin(m.user_id)}
                    />
                  )}
                </View>
                {days.map((day) => {
                  const segs = segments(m.busy, day);
                  const work = workWindow(m, day);
                  const label = day.toLocaleDateString([], {
                    weekday: "short",
                    day: "numeric",
                  });
                  const spoken = segs.length
                    ? `busy ${segs.map((x) => x.label).join(", ")}`
                    : work
                      ? "free"
                      : "not working";
                  const today = dayKey(day) === todayKey;
                  return (
                    <View
                      key={day.toISOString()}
                      style={s.dayRow}
                      accessible
                      accessibilityLabel={`${m.name}, ${day.toLocaleDateString(
                        [],
                        { weekday: "long" },
                      )}: ${spoken}`}
                    >
                      <Text style={[s.dayLabel, today && s.today]}>
                        {label}
                      </Text>
                      <View style={s.bar}>
                        {work && frac(work.to) > frac(work.from) && (
                          <View
                            style={[
                              s.work,
                              {
                                left: `${frac(work.from) * 100}%`,
                                width: `${(frac(work.to) - frac(work.from)) * 100}%`,
                              },
                            ]}
                          />
                        )}
                        {segs.map((x) => (
                          <View
                            key={x.key}
                            style={[
                              s.busy,
                              {
                                left: `${frac(x.from) * 100}%`,
                                width: `${Math.max((frac(x.to) - frac(x.from)) * 100, 1.5)}%`,
                              },
                            ]}
                          />
                        ))}
                      </View>
                    </View>
                  );
                })}
              </FadeIn>
            );
          })}
        </View>
      </InlineDetails>

      <Text style={[shared.eyebrow, s.eyebrow]}>WHO HAS ROOM</Text>
      <View style={s.panel}>
        <TeamCapacity
          teamId={teamId}
          weekStart={weekStart}
          canWrite={canWrite}
          onOpenItem={onOpenItem}
        />
      </View>

      <Text style={[shared.eyebrow, s.eyebrow]}>MEETING BUDGET</Text>
      <View style={s.panel}>
        <TeamAttention
          disabled={busy || disabled}
          onBusyChange={(pending) => {
            budgetLock.current = pending;
            setBudgetBusy(pending);
            reporter.current?.(pending);
          }}
          teamId={teamId}
          weekStart={weekStart}
          canManage={canManage}
        />
      </View>

      <Text style={[shared.eyebrow, s.eyebrow]}>WORKLOAD</Text>
      <View style={s.panel}>
        {workload === null && !readError && (
          <Text style={shared.small}>Loading workload…</Text>
        )}
        {[...(workload ?? [])].sort(order).map((w, n) => {
          const pct = Math.round(w.load * 100);
          return (
            <View key={w.user_id} style={[s.member, n > 0 && s.divider]}>
              <View style={s.memberTop}>
                <Text style={s.name}>{w.name}</Text>
                {w.overloaded && <Pill label="Overloaded" tone="danger" />}
                {w.at_risk > 0 && (
                  <Pill label={`${w.at_risk} at risk`} tone="warning" />
                )}
              </View>
              <View style={s.loadRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ProgressBar
                    value={Math.min(100, pct)}
                    height={8}
                    color={w.overloaded ? colors.danger : colors.accent}
                    track={colors.surfaceMuted}
                    label={`${w.name} workload, ${pct}%`}
                  />
                </View>
                <Text style={[s.pct, w.overloaded && s.over]}>{pct}%</Text>
              </View>
              <Text style={[shared.small, s.top]}>
                {minutesLabel(w.assigned_minutes) || "Nothing"} of{" "}
                {minutesLabel(w.capacity_minutes) || "no"} free time ·{" "}
                {w.open_tasks} open
                {w.unestimated_tasks
                  ? ` · ${w.unestimated_tasks} without an estimate`
                  : ""}
              </Text>
            </View>
          );
        })}
      </View>

      {atRisk.length > 0 && (
        <>
          <Text style={[shared.eyebrow, s.eyebrow]}>AT-RISK TASKS</Text>
          <View style={s.panel}>
            <Text style={[shared.small, s.gap]}>
              Not enough time before the deadline.
            </Text>
            {atRisk.map((t, n) => (
              <View
                key={t.id}
                style={[s.member, n > 0 && s.divider]}
                accessible
                accessibilityLabel={`${t.title}, ${t.assignee_name}, due ${dueDateOf(t)}, needs ${minutesLabel(t.remaining_minutes) || "more time"}`}
              >
                <Text style={s.name}>{t.title}</Text>
                <Text style={shared.small}>
                  {t.assignee_name} · due {dueDateOf(t)} · needs{" "}
                  {minutesLabel(t.remaining_minutes) || "more time"}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {analytics && analytics.total_planned_minutes > 0 && (
        <>
          <InlineDetails title="Sessions · last 30 days">
            <View style={s.panel}>
              {analytics.members
                .filter((m) => m.planned_minutes > 0 || m.completed > 0)
                .map((m) => (
                  <View key={m.user_id} style={s.analyticsRow}>
                    <Text style={s.analyticsName}>{m.name}</Text>
                    <Text style={s.analyticsHours}>
                      {Math.round(m.planned_minutes / 60)} h
                    </Text>
                    <Text style={s.analyticsDone}>{m.completed} done</Text>
                  </View>
                ))}
            </View>
          </InlineDetails>
        </>
      )}

      <InlineDetails title="Find meeting times">
        <View style={s.panel}>
          <Text style={shared.label}>Who</Text>
          <ChipRow label="Who needs to be there" multi>
            {members.map((m) => {
              const on = people.includes(m.user_id);
              return (
                <Chip
                  key={m.user_id}
                  multi
                  label={m.user_id === userId ? `${m.name} (you)` : m.name}
                  selected={on}
                  onPress={() => {
                    const next = on
                      ? people.filter((x) => x !== m.user_id)
                      : [...people, m.user_id];
                    if (next.length) setPeople(next);
                  }}
                />
              );
            })}
          </ChipRow>
          {tooMany && (
            <Text
              style={[shared.small, { color: colors.danger, marginTop: 8 }]}
              accessibilityLiveRegion="polite"
            >
              Pick up to {MAX_PEOPLE} people, or everyone ({people.length}{" "}
              picked).
            </Text>
          )}
          <Text style={[shared.label, s.labelTop]}>How long</Text>
          <ChipRow label="Meeting length">
            {LENGTHS.map((l) => (
              <Chip
                key={l}
                label={minutesLabel(l)}
                selected={length === l}
                onPress={() => setLength(l)}
              />
            ))}
          </ChipRow>
          <Button
            secondary
            title={busy && !slots ? "Looking…" : "Find times"}
            icon="search"
            disabled={busy || tooMany}
            style={s.find}
            onPress={() => void find()}
          />
          {!!booked && (
            <Text style={s.booked} accessibilityRole="alert">
              {booked}
            </Text>
          )}
          {slots && slots.length === 0 && (
            <Text style={shared.small}>
              No shared time next week. Try fewer people or a shorter meeting.
            </Text>
          )}
          {slots && slots.length > 0 && (
            <>
              {canWrite && (
                <>
                  <TextInput
                    style={[shared.input, s.gap]}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={200}
                    placeholder="Team meeting"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="Meeting title"
                  />
                  {onOpenItem && (
                    <Text style={[shared.small, s.gap]}>
                      Review before saving, or save the event now.
                    </Text>
                  )}
                </>
              )}
              {slots.map((slot, n) => (
                <View key={slot.start_at} style={[s.slot, n > 0 && s.divider]}>
                  <View style={s.slotMain}>
                    <Text style={s.slotText}>
                      {slotLabel(slot.start_at, slot.end_at)}
                    </Text>
                    <Text
                      style={[shared.small, slot.disruption > 0 && s.disrupts]}
                    >
                      {slot.disruption > 0
                        ? "Breaks someone’s focus time"
                        : "No one’s focus time is split"}
                    </Text>
                  </View>
                  {canWrite && (
                    <View style={s.slotActions}>
                      {onOpenItem ? (
                        <>
                          <SmallAction
                            label="Review event"
                            disabled={busy}
                            onPress={() => openInEditor(slot)}
                          />
                          <SmallAction
                            label="Save event"
                            disabled={busy}
                            onPress={() => void book(slot)}
                          />
                        </>
                      ) : (
                        <SmallAction
                          label="Save event"
                          disabled={busy}
                          onPress={() => void book(slot)}
                        />
                      )}
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
        </View>
      </InlineDetails>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    panel: { paddingVertical: 8, marginBottom: 12, minWidth: 0 },
    eyebrow: { marginTop: 8 },
    analyticsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
    },
    analyticsName: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15 },
    analyticsHours: {
      color: colors.text,
      fontSize: 15,
      fontFamily: fonts.semibold,
      fontVariant: ["tabular-nums"],
    },
    analyticsDone: {
      color: colors.muted,
      fontSize: 13,
      minWidth: 58,
      textAlign: "right",
    },
    gap: { marginBottom: 12 },
    top: { marginTop: 6 },
    labelTop: { marginTop: 14 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    weekHead: { marginTop: 8, marginBottom: 6 },
    weekEyebrow: { marginBottom: 2 },
    weekLabel: {
      fontFamily: fonts.display,
      fontSize: 18,
      letterSpacing: -0.3,
      color: colors.text,
      marginBottom: 10,
    },
    weekNav: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    member: { paddingVertical: 10 },
    memberTop: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },
    name: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    dayLabel: {
      width: 52,
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.muted,
    },
    today: { fontFamily: fonts.semibold, color: colors.accent },
    bar: {
      flex: 1,
      height: 10,
      borderRadius: radii.check,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    work: {
      position: "absolute",
      top: 0,
      bottom: 0,
      backgroundColor: colors.accentSoft,
    },
    busy: {
      position: "absolute",
      top: 0,
      bottom: 0,
      backgroundColor: colors.mediumText,
      borderRadius: radii.check,
    },
    loadRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    pct: {
      width: 44,
      textAlign: "right",
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.text,
    },
    over: { color: colors.danger },
    find: { marginTop: 14 },
    booked: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
      marginBottom: 10,
    },
    slot: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingVertical: 8,
    },
    slotMain: { flex: 1, minWidth: 0, flexBasis: 180, gap: 2 },
    slotActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    disrupts: { color: colors.warning },
    slotText: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
  }),
);
