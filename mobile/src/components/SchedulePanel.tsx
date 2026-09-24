import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Item, PlannedBlock, TimeBlock } from "@orbyn/core";
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
  shortDay,
  slotLabel,
} from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { controls, colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const PICK_DAYS = 7;

/** The next half hour from now, as a starting suggestion. */
const nextHalfHour = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
};

/**
 * "Schedule…" on a task: asks the planner for the task's next free time over
 * the coming week and offers the first block to book, or lets you pick a day
 * and start time yourself. Also lists the time already booked for it.
 */
export function SchedulePanel({
  item,
  onBooked,
}: {
  item: Item;
  /** After a block is booked or removed, so calendars can refresh. */
  onBooked?: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState<PlannedBlock | null>(null);
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState(0);
  const [time, setTime] = useState(nextHalfHour);
  const [booked, setBooked] = useState<TimeBlock[]>([]);
  const minutes = Math.min(1440, item.estimate_minutes || 30);

  const loadBooked = useCallback(async () => {
    const blocks = await client.listBlocks(
      dayStart(0).toISOString(),
      dayStart(14).toISOString(),
    );
    setBooked(
      blocks
        .filter((b) => b.item_id === item.id)
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)),
    );
  }, [item.id]);

  const find = () =>
    run(async () => {
      // The card fades itself in (FadeIn); a layout animation on the same
      // commit would leave it invisible on iOS.
      setOpen(true);
      const [plan] = await Promise.all([
        client.previewPlan({
          item_ids: [item.id],
          days: 7,
          timezone: deviceTimeZone(),
        }),
        loadBooked(),
      ]);
      const first = plan.blocks.find((b) => b.item_id === item.id) ?? null;
      animateLayout();
      setProposal(first);
      setReason(
        first
          ? ""
          : plan.unplaced.find((u) => u.item_id === item.id)?.reason ||
              "There’s no free working time for this in the next week.",
      );
    });

  const book = (start: Date, end: Date) =>
    run(async () => {
      await client.createBlock({
        item_id: item.id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
      });
      animateLayout();
      setProposal(null);
      setPicking(false);
      setReason("");
      await loadBooked();
      onBooked?.();
    });

  const remove = (block: TimeBlock) =>
    run(async () => {
      await client.deleteBlock(block.id);
      await loadBooked();
      onBooked?.();
    });

  if (!open)
    return (
      <Button
        secondary
        icon="calendar"
        title={busy ? "Finding time…" : "Schedule…"}
        disabled={busy}
        onPress={() => void find()}
      />
    );

  const pickedStart = new Date(dayStart(day));
  pickedStart.setHours(time.getHours(), time.getMinutes(), 0, 0);
  const pickedEnd = new Date(pickedStart.getTime() + minutes * 60_000);

  return (
    <FadeIn style={shared.card}>
      <View style={s.heading}>
        <Text style={shared.sectionTitle} accessibilityRole="header">
          Schedule
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close scheduling"
          hitSlop={10}
          onPress={() => {
            animateLayout();
            setOpen(false);
            setError("");
          }}
          style={s.close}
        >
          <Icon name="x" size={16} color={colors.textSoft} />
        </Pressable>
      </View>
      <ErrorBanner error={error} onDismiss={() => setError("")} />
      {busy && !proposal && !reason && (
        <Text style={shared.small}>Looking for free time…</Text>
      )}
      {proposal && (
        <View style={s.offer}>
          <Text style={shared.label}>Next free time</Text>
          <Text style={s.offerTime}>
            {slotLabel(proposal.start_at, proposal.end_at)}
          </Text>
          {proposal.parts > 1 && (
            <Text style={shared.small}>
              First of {proposal.parts} sessions. Plan my day can place the
              rest.
            </Text>
          )}
          <Button
            title="Book this time"
            icon="check"
            disabled={busy}
            style={s.offerButton}
            onPress={() =>
              void book(new Date(proposal.start_at), new Date(proposal.end_at))
            }
          />
        </View>
      )}
      {!!reason && <Text style={[shared.body, s.gap]}>{reason}</Text>}

      {!picking ? (
        <Button
          secondary
          title="Pick a day and time"
          disabled={busy}
          onPress={() => {
            animateLayout();
            setPicking(true);
          }}
        />
      ) : (
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
            title={`Book ${slotLabel(pickedStart, pickedEnd)}`}
            icon="check"
            disabled={busy}
            style={s.gap}
            onPress={() => void book(pickedStart, pickedEnd)}
          />
        </View>
      )}

      {booked.length > 0 && (
        <View style={s.booked}>
          <Text style={shared.label}>Sessions</Text>
          {booked.map((b, n) => (
            <View key={b.id} style={[s.bookedRow, n > 0 && s.divider]}>
              <Text style={s.bookedText}>
                {slotLabel(b.start_at, b.end_at)}
              </Text>
              <SmallAction
                destructive
                label="Remove"
                disabled={busy}
                onPress={() => void remove(b)}
              />
            </View>
          ))}
        </View>
      )}
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    heading: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
    close: {
      marginLeft: "auto",
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    offer: {
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 14,
      marginBottom: 12,
    },
    offerTime: {
      fontFamily: fonts.display,
      fontSize: 17,
      color: colors.text,
      marginBottom: 4,
    },
    offerButton: { marginTop: 10, marginBottom: 0 },
    gap: { marginTop: 12 },
    gapSmall: { marginTop: 6 },
    booked: { marginTop: 8 },
    bookedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: controls.tap,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    bookedText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.text,
    },
  }),
);
