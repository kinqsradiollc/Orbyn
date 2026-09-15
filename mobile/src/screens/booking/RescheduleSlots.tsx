import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { BookingDetail, BookingPage, BusyInterval } from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import {
  clockLabel,
  deviceTimeZone,
  minutesLabel,
  slotLabel,
} from "../../lib/planning";
import { animateLayout } from "../../motion";
import { colors } from "../../theme";
import { shared } from "../../styles";
import { dayKeyLabel, dayKeyOf, lengthOf } from "./helpers";
import { bookingStyles as bs } from "./ui";

const DAYS = 7;

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKeyOf(new Date(y, m - 1, d + n));
};

/**
 * The page's free times of the booking's length, a week at a time, in this
 * device's time zone. Picking one asks before moving the booking.
 */
export function RescheduleSlots({
  booking,
  page,
  busy,
  onPick,
}: {
  booking: BookingDetail;
  /** The booking's page, once pages have loaded. */
  page: BookingPage | undefined;
  busy: boolean;
  onPick: (startAt: string) => void;
}) {
  const today = dayKeyOf(new Date());
  const [from, setFrom] = useState(today);
  const [slots, setSlots] = useState<BusyInterval[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const length = lengthOf(booking);
  const offered = !!page && page.active && page.durations.includes(length);

  useEffect(() => {
    if (!page || !offered) return;
    let alive = true;
    setSlots(null);
    setProblem("");
    client
      .getBookingSlots(booking.id, {
        date: from,
        days: DAYS,
        timezone: deviceTimeZone(),
      })
      .then((p) => {
        if (!alive) return;
        const free = p.slots.filter((s) => s.start_at !== booking.start_at);
        animateLayout();
        setSlots(free);
        setDay(free.length ? dayKeyOf(new Date(free[0].start_at)) : null);
      })
      .catch((e: Error) => alive && setProblem(e.message));
    return () => {
      alive = false;
    };
  }, [page, offered, length, from, booking.start_at]);

  if (!page) return <Text style={shared.small}>Finding free times…</Text>;
  if (!page.active)
    return (
      <Text style={shared.small}>
        This page is off. Turn it back on to see its free times.
      </Text>
    );
  if (!offered)
    return (
      <Text style={shared.small}>
        The page no longer offers {minutesLabel(length)} bookings, so there are
        no times to move this one to.
      </Text>
    );

  const byDay = new Map<string, BusyInterval[]>();
  for (const s of slots ?? []) {
    const key = dayKeyOf(new Date(s.start_at));
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const times = (day && byDay.get(day)) || [];
  const last = addDays(from, DAYS - 1);

  return (
    <View>
      <View style={s.nav}>
        <SmallAction
          label="Earlier"
          disabled={from <= today}
          onPress={() =>
            setFrom(addDays(from, -DAYS) < today ? today : addDays(from, -DAYS))
          }
        />
        <Text style={[shared.small, s.range]}>
          {dayKeyLabel(from)} – {dayKeyLabel(last)}
        </Text>
        <SmallAction
          label="Later"
          disabled={false}
          onPress={() => setFrom(addDays(from, DAYS))}
        />
      </View>
      {problem ? (
        <Text style={[shared.small, s.warn]}>{problem}</Text>
      ) : slots === null ? (
        <Text style={shared.small}>Finding free times…</Text>
      ) : byDay.size === 0 ? (
        <Text style={shared.small}>No free times these days. Try later.</Text>
      ) : (
        <>
          <ChipRow label="Day" style={bs.gap}>
            {[...byDay.keys()].map((key) => (
              <Chip
                key={key}
                label={dayKeyLabel(key)}
                selected={day === key}
                onPress={() => setDay(key)}
              />
            ))}
          </ChipRow>
          <ChipRow label="Time">
            {times.map((t) => (
              <Chip
                key={t.start_at}
                label={clockLabel(t.start_at)}
                selected={false}
                disabled={busy}
                accessibilityHint="Asks before moving the booking"
                onPress={() =>
                  Alert.alert(
                    `Move to ${slotLabel(t.start_at, t.end_at)}?`,
                    `${booking.name} is told by email.`,
                    [
                      { text: "Keep the time", style: "cancel" },
                      { text: "Move it", onPress: () => onPick(t.start_at) },
                    ],
                  )
                }
              />
            ))}
          </ChipRow>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  range: { flex: 1, textAlign: "center" },
  warn: { color: colors.danger },
});
