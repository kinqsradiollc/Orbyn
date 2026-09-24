import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  deadlineOf,
  dueDate,
  planDaysBefore,
  type Item,
  type ItemSessions,
  type Plan,
  type PlannedBlock,
  type TimeBlock,
} from "@orbyn/core";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { ErrorBanner } from "./ErrorBanner";
import { TimeField } from "./Field";
import { Icon } from "./Icon";
import { SmallAction } from "./SmallAction";
import { client } from "../lib/api";
import {
  dayStart,
  deviceTimeZone,
  minutesLabel,
  rangeLabel,
  shortDay,
  slotLabel,
} from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { errorText } from "../lib/errors";
import { FadeIn, animateLayout } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const PICK_DAYS = 7;
/** How far "Find time" looks when the task has no deadline. */
const FIND_DAYS = 7;

/** The next half hour from now, as a starting suggestion. */
const nextHalfHour = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
};

/** "Wed 23 Sep". */
const rowDay = (iso: string) =>
  new Date(iso).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/** "Planned 1h 30m before Fri 2 Oct, 5 pm · 3h 30m still needed (4h estimated, 30m logged)". */
function summary(s: ItemSessions, item: Item) {
  const by = s.deadline_at
    ? s.due_all_day
      ? ` by the end of ${dueDate(s.deadline_at, true)}`
      : ` before ${dueDate(s.deadline_at)}`
    : "";
  const parts = [`Planned ${minutesLabel(s.planned_minutes) || "0m"}${by}`];
  if (item.estimate_minutes != null && item.remaining_minutes != null) {
    const spent = item.spent_minutes ?? 0;
    parts.push(
      `${minutesLabel(item.remaining_minutes) || "0m"} still needed (${minutesLabel(
        item.estimate_minutes,
      )} estimated${spent ? `, ${minutesLabel(spent)} logged` : ""})`,
    );
  }
  return parts.join(" · ");
}

/** "No sessions yet. Due Fri 2 Oct, 5 pm · about 4h of work." */
function emptyText(s: ItemSessions | null, item: Item) {
  const facts: string[] = [];
  if (s?.deadline_at)
    facts.push(`Due ${dueDate(s.deadline_at, s.due_all_day)}`);
  else if (s?.project_deadline)
    facts.push(`No deadline · project ends ${rowDay(s.project_deadline)}`);
  if (item.estimate_minutes)
    facts.push(
      `about ${minutesLabel(item.remaining_minutes ?? item.estimate_minutes)} of work`,
    );
  return `No sessions yet.${facts.length ? ` ${facts.join(" · ")}.` : ""}`;
}

/**
 * A task's sessions, shown as soon as the task opens (reading them never
 * makes a plan): a summary of the time planned before the deadline, past
 * sessions dimmed, upcoming ones to show on the calendar or remove, late
 * ones flagged. "Find time before the deadline" asks the planner for this
 * task alone; "Add session…" picks a day and time by hand.
 */
export function SessionsPanel({
  item,
  canWork,
  reloadKey,
  onChanged,
  onShowOnCalendar,
}: {
  item: Item;
  /** An open task you can change: planning and removing are offered. */
  canWork: boolean;
  /** Changes when the task changes elsewhere, to load its sessions again. */
  reloadKey: string;
  /** After a session is added or removed, so calendars can refresh. */
  onChanged?: () => void;
  /** Show a session's day on the calendar. */
  onShowOnCalendar?: (at: string) => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [data, setData] = useState<ItemSessions | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(0);
  const [time, setTime] = useState(nextHalfHour);
  const minutes = Math.min(1440, item.estimate_minutes || 30);

  const load = useCallback(async () => {
    const next = await client.itemSessions(item.id);
    animateLayout();
    setData(next);
  }, [item.id]);

  useEffect(() => {
    load().catch((e: Error) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reloadKey]);

  const deadline = data?.deadline_at ?? deadlineOf(item);
  const findLabel = deadline ? "Find time before the deadline" : "Find time";
  const offered: PlannedBlock[] =
    plan?.blocks.filter((b) => b.item_id === item.id) ?? [];

  const find = () =>
    run(async () => {
      setPicking(false);
      // Days up to the deadline, counted where the planner plans.
      const zone = await client
        .getPlannerPrefs()
        .then((p) => (p.timezone === "UTC" ? deviceTimeZone() : p.timezone))
        .catch(() => deviceTimeZone());
      const next = await client.previewPlan({
        item_ids: [item.id],
        days: planDaysBefore(deadline, new Date(), zone) ?? FIND_DAYS,
        timezone: deviceTimeZone(),
      });
      const mine = next.blocks.filter((b) => b.item_id === item.id);
      animateLayout();
      setPlan(mine.length ? next : null);
      setReason(
        mine.length
          ? ""
          : next.unplaced.find((u) => u.item_id === item.id)?.reason ||
              next.tasks?.find((t) => t.item_id === item.id)?.reason ||
              "There’s no free working time for this before it’s due.",
      );
    });

  const done = async () => {
    animateLayout();
    setPlan(null);
    setPicking(false);
    setReason("");
    await load();
    onChanged?.();
  };

  const bookAll = () =>
    run(async () => {
      if (!plan) return;
      await client.applyPlan(plan.id);
      await done();
    });

  const book = (start: Date, end: Date) =>
    run(async () => {
      await client.createBlock({
        item_id: item.id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
      });
      await done();
    });

  const remove = (block: TimeBlock) =>
    run(async () => {
      await client.deleteBlock(block.id);
      await load();
      onChanged?.();
    });

  const pickedStart = new Date(dayStart(day));
  pickedStart.setHours(time.getHours(), time.getMinutes(), 0, 0);
  const pickedEnd = new Date(pickedStart.getTime() + minutes * 60_000);
  const sessions = data?.sessions ?? [];
  const now = Date.now();

  return (
    <FadeIn style={shared.card}>
      <View style={s.heading}>
        <Icon name="calendar" size={16} color={colors.muted} />
        <Text style={shared.sectionTitle} accessibilityRole="header">
          Sessions
        </Text>
      </View>
      <ErrorBanner error={error} onDismiss={() => setError("")} />
      {!data && !error && <Text style={shared.small}>Loading sessions…</Text>}
      {!!data && sessions.length > 0 && (
        <>
          <Text style={[shared.small, s.summary]}>{summary(data, item)}</Text>
          {data.late_minutes > 0 && (
            <View style={s.lateChip}>
              <Text style={s.lateChipText}>
                {minutesLabel(data.late_minutes)} after the deadline
              </Text>
            </View>
          )}
          {sessions.map((b, n) => {
            const past = Date.parse(b.end_at) <= now;
            const late = !!b.after_deadline && !past;
            return (
              <View
                key={b.id}
                style={[s.row, n > 0 && !late && s.divider, late && s.lateRow]}
              >
                <View style={s.rowText}>
                  <Text style={[s.when, past && s.past]}>
                    {rowDay(b.start_at)} · {rangeLabel(b.start_at, b.end_at)}
                  </Text>
                  <Text style={[shared.small, past && s.past]}>
                    {b.part ? `Session ${b.part}` : "Session"}
                  </Text>
                  {late && <Text style={s.lateText}>After the deadline</Text>}
                </View>
                {!past && (
                  <View style={s.rowActions}>
                    {onShowOnCalendar && (
                      <SmallAction
                        label="Show"
                        disabled={busy}
                        onPress={() => onShowOnCalendar(b.start_at)}
                      />
                    )}
                    {canWork && (
                      <SmallAction
                        destructive
                        label="Remove"
                        disabled={busy}
                        onPress={() => void remove(b)}
                      />
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}
      {!!data && !sessions.length && (
        <Text style={[shared.body, s.gapSmall]}>{emptyText(data, item)}</Text>
      )}

      {offered.length > 0 && (
        <View style={s.offer}>
          <Text style={shared.label}>
            {offered.length > 1
              ? `${offered.length} sessions found`
              : "Next free time"}
          </Text>
          {offered.map((b) => (
            <Text key={b.start_at} style={s.offerTime}>
              {slotLabel(b.start_at, b.end_at)}
              {b.parts > 1 ? ` · Session ${b.part}` : ""}
            </Text>
          ))}
          <Button
            title={
              offered.length > 1
                ? `Add these ${offered.length} sessions`
                : "Book this time"
            }
            icon="check"
            disabled={busy}
            style={s.offerButton}
            onPress={() =>
              offered.length > 1
                ? void bookAll()
                : void book(
                    new Date(offered[0].start_at),
                    new Date(offered[0].end_at),
                  )
            }
          />
        </View>
      )}
      {!!reason && <Text style={[shared.body, s.gap]}>{reason}</Text>}

      {canWork && !picking && (
        <View style={s.tools}>
          <Button
            secondary={sessions.length > 0}
            icon="sparkles"
            title={busy && !plan ? "Finding time…" : findLabel}
            disabled={busy}
            onPress={() => void find()}
          />
          <Button
            secondary
            icon="plus"
            title="Add session…"
            disabled={busy}
            onPress={() => {
              animateLayout();
              setPlan(null);
              setReason("");
              setPicking(true);
            }}
          />
        </View>
      )}
      {canWork && picking && (
        <View style={s.gap}>
          <Text style={shared.label}>Day</Text>
          <ChipRow label="Day">
            {Array.from({ length: PICK_DAYS }, (_, n) => (
              <Chip
                key={n}
                label={
                  n === 0
                    ? "Today"
                    : n === 1
                      ? "Tomorrow"
                      : shortDay(dayStart(n))
                }
                selected={day === n}
                onPress={() => setDay(n)}
              />
            ))}
          </ChipRow>
          <Text style={[shared.label, s.gap]}>Start</Text>
          <TimeField label="Start time" value={time} onChange={setTime} />
          <Text style={[shared.small, s.gapSmall]}>
            {minutesLabel(minutes)}
            {item.estimate_minutes ? "" : " (set an estimate to change this)"}
          </Text>
          <Button
            title={`Add ${slotLabel(pickedStart, pickedEnd)}`}
            icon="check"
            disabled={busy}
            style={s.gap}
            onPress={() => void book(pickedStart, pickedEnd)}
          />
          <Button
            secondary
            title="Cancel"
            disabled={busy}
            onPress={() => {
              animateLayout();
              setPicking(false);
            }}
          />
        </View>
      )}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    heading: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 8,
    },
    summary: { marginBottom: 8 },
    lateChip: {
      alignSelf: "flex-start",
      paddingVertical: 3,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      backgroundColor: colors.warningSoft,
      marginBottom: 8,
    },
    lateChipText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.warningStrong,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap,
      paddingVertical: 8,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    lateRow: {
      marginVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.warningBorder,
      backgroundColor: colors.warningSoft,
    },
    rowText: { flex: 1, gap: 2 },
    rowActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    when: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.text,
    },
    past: { color: colors.muted },
    lateText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.warningStrong,
    },
    offer: {
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 14,
      marginTop: 12,
    },
    offerTime: {
      fontFamily: fonts.display,
      fontSize: 16,
      color: colors.text,
      marginTop: 4,
    },
    offerButton: { marginTop: 10, marginBottom: 0 },
    tools: { marginTop: 12 },
    gap: { marginTop: 12 },
    gapSmall: { marginTop: 6 },
  }),
);
