import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { BookingDetail, BusyInterval } from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { clockLabel, deviceTimeZone, slotLabel } from "../../lib/planning";
import { animateLayout } from "../../motion";
import { colors, themed } from "../../theme";
import { shared } from "../../styles";
import { dayKeyLabel, dayKeyOf, lengthOf } from "./helpers";
import { bookingStyles as bs } from "./ui";
import { errorText } from "../../lib/errors";

const DAYS = 7;

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKeyOf(new Date(y, m - 1, d + n));
};

/** Ask before moving the booking to `start`. */
function confirmMove(
  booking: BookingDetail,
  start: string,
  onPick: (startAt: string) => void,
) {
  const end = new Date(Date.parse(start) + lengthOf(booking) * 60_000);
  Alert.alert(
    `Move to ${slotLabel(start, end)}?`,
    `${booking.name} is told by email.`,
    [
      { text: "Keep the time", style: "cancel" },
      { text: "Move it", onPress: () => onPick(start) },
    ],
  );
}

/**
 * The page's free times of the booking's length, a week at a time, in this
 * device's time zone. Picking one asks before moving the booking. Only free
 * times can be booked (the server refuses others), so when the times can't
 * be loaded the server's reason shows and the week can still be changed.
 */
export function RescheduleSlots({
  booking,
  busy,
  onPick,
}: {
  booking: BookingDetail;
  busy: boolean;
  onPick: (startAt: string) => void;
}) {
  const today = dayKeyOf(new Date());
  const [from, setFrom] = useState(today);
  const [slots, setSlots] = useState<BusyInterval[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const length = lengthOf(booking);

  // The host route ignores notice and pages that are switched off.
  useEffect(() => {
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
      .catch((e: Error) => {
        if (!alive) return;
        animateLayout();
        // The server's own reason; there's no free-entry fallback, since a
        // time that isn't free would be refused anyway.
        setProblem(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [booking.id, from, length, booking.start_at]);

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
                onPress={() => confirmMove(booking, t.start_at, onPick)}
              />
            ))}
          </ChipRow>
        </>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    nav: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 12,
    },
    range: { flex: 1, textAlign: "center" },
    warn: { color: colors.danger },
  }),
);
