import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { HttpError, type BookingDetail, type BusyInterval } from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { DateField, Field, TimeField } from "../../components/Field";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import {
  clockLabel,
  deviceTimeZone,
  minutesLabel,
  slotLabel,
} from "../../lib/planning";
import { animateLayout } from "../../motion";
import { colors, themed } from "../../theme";
import { shared } from "../../styles";
import { dayKeyLabel, dayKeyOf, lengthOf } from "./helpers";
import { bookingStyles as bs } from "./ui";

const DAYS = 7;

const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split("-").map(Number);
  return dayKeyOf(new Date(y, m - 1, d + n));
};

/** The next quarter hour from now, for the pick-a-time fallback. */
const nextQuarter = () => {
  const d = new Date();
  d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0);
  return d;
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
 * device's time zone. Picking one asks before moving the booking. When the
 * page can't offer times (it's gone, or the length no longer fits), any date
 * and time can be picked instead.
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
  const [manual, setManual] = useState(false);
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
        if (
          e instanceof HttpError &&
          (e.statusCode === 404 || e.statusCode === 422)
        ) {
          setProblem(
            `This booking’s page can’t offer ${minutesLabel(length)} times any more. Pick a date and time yourself.`,
          );
          setManual(true);
        } else setProblem(e.message);
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

  if (manual)
    return (
      <View>
        {!!problem && <Text style={[shared.small, s.warn]}>{problem}</Text>}
        <AnyTime booking={booking} busy={busy} onPick={onPick} />
      </View>
    );

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

/** A date and a start time, for when the page has no times to offer. */
function AnyTime({
  booking,
  busy,
  onPick,
}: {
  booking: BookingDetail;
  busy: boolean;
  onPick: (startAt: string) => void;
}) {
  const [start, setStart] = useState(nextQuarter);
  const past = start.getTime() <= Date.now();
  return (
    <View style={s.manual}>
      <Field label="Date">
        <DateField
          label="New date"
          value={dayKeyOf(start)}
          minimumDate={new Date()}
          onChange={(key) => {
            if (!key) return;
            const [y, m, d] = key.split("-").map(Number);
            const next = new Date(start);
            next.setFullYear(y, m - 1, d);
            setStart(next);
          }}
        />
      </Field>
      <Field
        label="Start"
        hint={`${minutesLabel(lengthOf(booking))}, in this device’s time zone.`}
      >
        <TimeField label="New start time" value={start} onChange={setStart} />
      </Field>
      {past && (
        <Text style={[shared.small, s.warn, bs.gap]}>
          Pick a time that hasn’t passed.
        </Text>
      )}
      <Button
        title="Move to this time"
        icon="clock"
        disabled={busy || past}
        style={bs.last}
        onPress={() => confirmMove(booking, start.toISOString(), onPick)}
      />
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
    manual: { marginTop: 12 },
  }),
);
