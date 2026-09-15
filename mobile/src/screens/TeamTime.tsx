import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import type {
  BusyInterval,
  MeetingSlot,
  MemberAvailability,
  MemberWorkload,
  TeamMember,
} from "@orbyn/core";
import { dateLabel } from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { Pill } from "../components/Pill";
import { ProgressBar } from "../components/ProgressBar";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { dayStart, minutesLabel, rangeLabel, slotLabel } from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

/** The part of each day the availability bars show. */
const BAR_START = 7;
const BAR_END = 21;
const LENGTHS = [15, 30, 45, 60, 90];

/** Busy intervals clipped to one day's bar, as fractions of its width. */
function segments(busy: BusyInterval[], day: Date) {
  const from = new Date(day).setHours(BAR_START, 0, 0, 0);
  const to = new Date(day).setHours(BAR_END, 0, 0, 0);
  return busy
    .map((b) => ({
      b,
      start: Math.max(from, Date.parse(b.start_at)),
      end: Math.min(to, Date.parse(b.end_at)),
    }))
    .filter((x) => x.end > x.start)
    .map((x) => ({
      key: x.b.start_at,
      left: (x.start - from) / (to - from),
      width: (x.end - x.start) / (to - from),
      label: rangeLabel(new Date(x.start), new Date(x.end)),
    }));
}

/**
 * Team time inside a team: when each member is busy today and tomorrow (busy
 * only, never what for), who is overloaded this week, and Find a time.
 */
export function TeamTime({
  teamId,
  members,
  userId,
  canWrite,
  onCreated,
}: {
  teamId: string;
  members: TeamMember[];
  userId?: string;
  /** Whether you can add team events (Find a time → book). */
  canWrite: boolean;
  /** After a team event is created. */
  onCreated: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [availability, setAvailability] = useState<MemberAvailability[]>([]);
  const [workload, setWorkload] = useState<MemberWorkload[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>(() =>
    members.map((m) => m.user_id),
  );
  const [length, setLength] = useState(30);
  const [title, setTitle] = useState("Team meeting");
  const [slots, setSlots] = useState<MeetingSlot[] | null>(null);
  const [booked, setBooked] = useState("");

  useEffect(() => {
    let alive = true;
    const today = dayStart(0);
    Promise.all([
      client.teamAvailability(
        teamId,
        today.toISOString(),
        dayStart(2).toISOString(),
      ),
      client.teamWorkload(
        teamId,
        today.toISOString(),
        dayStart(7).toISOString(),
      ),
      client.getPlannerPrefs().catch(() => null),
    ])
      .then(([a, w, prefs]) => {
        if (!alive) return;
        animateLayout();
        setAvailability(a);
        setWorkload(w);
        setPinned(prefs?.pinned_user_ids ?? []);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [teamId, setError]);

  const order = (a: { user_id: string; name: string }, b: typeof a) =>
    Number(pinned.includes(b.user_id)) - Number(pinned.includes(a.user_id)) ||
    a.name.localeCompare(b.name);
  const togglePin = (id: string) =>
    run(async () => {
      const next = pinned.includes(id)
        ? pinned.filter((x) => x !== id)
        : [...pinned, id].slice(-20);
      const prefs = await client.updatePlannerPrefs({ pinned_user_ids: next });
      animateLayout();
      setPinned(prefs.pinned_user_ids);
    });

  const find = () =>
    run(async () => {
      const from = new Date();
      const found = await client.suggestMeetingTimes(teamId, {
        from: from.toISOString(),
        to: dayStart(7).toISOString(),
        duration: length,
        user_ids: people,
      });
      animateLayout();
      setSlots(found.slice(0, 8));
      setBooked("");
    });

  const book = (slot: MeetingSlot) =>
    run(async () => {
      await client.createItem({
        title: title.trim() || "Team meeting",
        kind: "event",
        due_at: slot.start_at,
        end_at: slot.end_at,
        team_id: teamId,
      });
      animateLayout();
      setSlots(null);
      setBooked(`Added for ${slotLabel(slot.start_at, slot.end_at)}.`);
      onCreated();
    });

  const atRisk = workload
    .flatMap((w) => w.at_risk_items ?? [])
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));

  const days = [
    { label: "Today", day: dayStart(0) },
    { label: "Tomorrow", day: dayStart(1) },
  ];

  return (
    <>
      <ErrorBanner error={error} onDismiss={() => setError("")} />

      <Text style={[shared.eyebrow, s.eyebrow]}>AVAILABILITY</Text>
      <View style={shared.card}>
        <Text style={[shared.small, s.gap]}>
          Busy times only, never what they are. Bars run{" "}
          {rangeLabel(
            new Date(2000, 0, 1, BAR_START),
            new Date(2000, 0, 1, BAR_END),
          )}
          .
        </Text>
        {availability.length === 0 && (
          <Text style={shared.small}>Loading availability…</Text>
        )}
        {[...availability].sort(order).map((m, n) => {
          const me = m.user_id === userId;
          const isPinned = pinned.includes(m.user_id);
          return (
            <FadeIn
              key={m.user_id}
              index={n}
              style={[s.member, n > 0 && s.divider]}
            >
              <View style={s.memberTop}>
                <Text style={s.name} numberOfLines={1}>
                  {m.name}
                  {me ? " (you)" : ""}
                </Text>
                {!me && (
                  <SmallAction
                    label={isPinned ? "Unpin" : "Pin"}
                    disabled={busy}
                    onPress={() => void togglePin(m.user_id)}
                  />
                )}
              </View>
              {days.map(({ label, day }) => {
                const segs = segments(m.busy, day);
                const spoken = segs.length
                  ? `${label}: busy ${segs.map((x) => x.label).join(", ")}`
                  : `${label}: free`;
                return (
                  <View
                    key={label}
                    style={s.dayRow}
                    accessible
                    accessibilityLabel={`${m.name}, ${spoken}`}
                  >
                    <Text style={s.dayLabel}>{label}</Text>
                    <View style={s.bar}>
                      {segs.map((x) => (
                        <View
                          key={x.key}
                          style={[
                            s.busy,
                            {
                              left: `${x.left * 100}%`,
                              width: `${Math.max(x.width * 100, 1.5)}%`,
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

      <Text style={[shared.eyebrow, s.eyebrow]}>WORKLOAD THIS WEEK</Text>
      <View style={shared.card}>
        {workload.length === 0 && (
          <Text style={shared.small}>Loading workload…</Text>
        )}
        {[...workload].sort(order).map((w, n) => (
          <View key={w.user_id} style={[s.member, n > 0 && s.divider]}>
            <View style={s.memberTop}>
              <Text style={s.name} numberOfLines={1}>
                {w.name}
              </Text>
              {w.overloaded && <Pill label="Overloaded" tone="danger" />}
              {w.at_risk > 0 && (
                <Pill label={`${w.at_risk} at risk`} tone="warning" />
              )}
            </View>
            <ProgressBar
              value={Math.round(Math.min(1, w.load) * 100)}
              height={8}
              color={w.overloaded ? colors.danger : colors.accent}
              track={colors.surfaceMuted}
              label={`${w.name} workload`}
            />
            <Text style={[shared.small, s.top]}>
              {minutesLabel(w.assigned_minutes) || "Nothing"} of{" "}
              {minutesLabel(w.capacity_minutes) || "no"} free time ·{" "}
              {w.open_tasks} open
              {w.unestimated_tasks
                ? ` · ${w.unestimated_tasks} without an estimate`
                : ""}
            </Text>
          </View>
        ))}
      </View>

      {atRisk.length > 0 && (
        <>
          <Text style={[shared.eyebrow, s.eyebrow]}>AT-RISK TASKS</Text>
          <View style={shared.card}>
            <Text style={[shared.small, s.gap]}>
              Tasks that can’t get enough time before they’re due. Those due
              soonest take the free time first.
            </Text>
            {atRisk.map((t, n) => (
              <View
                key={t.id}
                style={[s.member, n > 0 && s.divider]}
                accessible
                accessibilityLabel={`${t.title}, ${t.assignee_name}, due ${dateLabel(t.due_at)}, needs ${minutesLabel(t.remaining_minutes) || "more time"}`}
              >
                <Text style={s.name} numberOfLines={2}>
                  {t.title}
                </Text>
                <Text style={shared.small}>
                  {t.assignee_name} · due {dateLabel(t.due_at)} · needs{" "}
                  {minutesLabel(t.remaining_minutes) || "more time"}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      <Text style={[shared.eyebrow, s.eyebrow]}>FIND A TIME</Text>
      <View style={shared.card}>
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
          disabled={busy}
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
            No time in the next week when everyone is free. Try fewer people or
            a shorter meeting.
          </Text>
        )}
        {slots && slots.length > 0 && (
          <>
            {canWrite && (
              <TextInput
                style={[shared.input, s.gap]}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
                placeholder="Team meeting"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Meeting title"
              />
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
                  <SmallAction
                    label="Book"
                    disabled={busy}
                    onPress={() => void book(slot)}
                  />
                )}
              </View>
            ))}
          </>
        )}
      </View>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    eyebrow: { marginTop: 8 },
    gap: { marginBottom: 12 },
    top: { marginTop: 6 },
    labelTop: { marginTop: 14 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    member: { paddingVertical: 10 },
    memberTop: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 6,
    },
    name: {
      flex: 1,
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
    },
    dayRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    dayLabel: {
      width: 64,
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.muted,
    },
    bar: {
      flex: 1,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.surfaceMuted,
      overflow: "hidden",
    },
    busy: {
      position: "absolute",
      top: 0,
      bottom: 0,
      backgroundColor: colors.mediumText,
      borderRadius: 3,
    },
    find: { marginTop: 14 },
    booked: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
      marginBottom: 10,
    },
    slot: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingVertical: 8,
    },
    slotMain: { flex: 1, gap: 2 },
    disrupts: { color: colors.warning },
    slotText: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.text,
    },
  }),
);
