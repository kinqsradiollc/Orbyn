import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { dateLabel, type BookingDetail, type BookingPage } from "@orbyn/core";
import { Button } from "../../components/Button";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Field } from "../../components/Field";
import { Pill } from "../../components/Pill";
import { sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { deviceTimeZone, minutesLabel, slotLabel } from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { animateLayout } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import {
  EVENT_LABELS,
  STATUS,
  canMarkNoShow,
  eventActor,
  inZone,
  isOpen,
  lengthOf,
} from "./helpers";
import { RescheduleSlots } from "./RescheduleSlots";
import { SwitchRow, bookingStyles as bs } from "./ui";

type Panel = null | "decline" | "cancel" | "reschedule";

/** One booking: who, when, their answers, your note, its history and actions. */
export function BookingDetailView({
  id,
  pages,
  onPages,
  onChanged,
}: {
  id: string;
  pages: BookingPage[] | null;
  onPages: (pages: BookingPage[]) => void;
  /** After an action, so counts elsewhere catch up. */
  onChanged: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [note, setNote] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    void run(async () => {
      const b = await client.getBooking(id);
      setBooking(b);
      setNote(b.host_note);
    });
  }, [run, id]);
  // Opened from a notification, before the pages list has loaded.
  useEffect(() => {
    if (!pages)
      client
        .listBookingPages()
        .then(onPages)
        .catch(() => {});
  }, [pages, onPages]);

  /** Run a host action; the reply is the updated booking. */
  const act = (fn: () => Promise<BookingDetail>) =>
    run(async () => {
      const next = await fn();
      animateLayout();
      setBooking(next);
      setNote(next.host_note);
      setPanel(null);
      setReason("");
      onChanged();
    });
  const openPanel = (p: Panel) => {
    animateLayout();
    setPanel(panel === p ? null : p);
    setReason("");
  };

  if (!booking)
    return (
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <Text style={shared.small}>{busy ? "Loading…" : ""}</Text>
        </View>
      </ScrollView>
    );

  const b = booking;
  const status = STATUS[b.status];
  const open = isOpen(b);
  const waiting = b.status === "awaiting_approval" && open;
  const device = deviceTimeZone();
  const theirTime = b.timezone !== device ? inZone(b.start_at, b.timezone) : "";
  const known = new Set(b.questions.map((q) => q.id));
  const answers = [
    ...b.questions.map((q) => ({ label: q.label, value: b.answers[q.id] })),
    // Answers to questions since removed from the page.
    ...Object.entries(b.answers)
      .filter(([k]) => !known.has(k))
      .map(([k, value]) => ({ label: k, value })),
  ];

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />

        <View style={shared.card}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={shared.sectionTitle}>{b.name}</Text>
              <Text
                selectable
                style={[s.link, s.email]}
                accessibilityRole="link"
                accessibilityHint="Writes them an email"
                onPress={() =>
                  void Linking.openURL(`mailto:${b.email}`).catch(() => {})
                }
              >
                {b.email}
              </Text>
            </View>
            <Pill label={status.label} tone={status.tone} />
          </View>
          {b.no_show && (
            <View style={s.pills}>
              <Pill label="Didn’t show up" tone="danger" />
            </View>
          )}
          <Detail label="When" value={slotLabel(b.start_at, b.end_at)} />
          {!!theirTime && (
            <Text style={[shared.small, s.theirs]}>
              {theirTime} for them ({b.timezone})
            </Text>
          )}
          <Detail label="Length" value={minutesLabel(lengthOf(b))} />
          <Detail label="Booking page" value={b.page_title} />
          <Detail label="Booked" value={dateLabel(b.created_at)} />
          {!!b.location && <Detail label="Location" value={b.location} />}
          {!!b.meeting_url && (
            <View style={s.detail}>
              <Text style={shared.label}>Meeting link</Text>
              <Text
                style={s.link}
                accessibilityRole="link"
                onPress={() => void Linking.openURL(b.meeting_url)}
              >
                {b.meeting_url}
              </Text>
            </View>
          )}
          {b.hosts.length > 1 && (
            <Detail
              label="Hosts"
              value={b.hosts.map((h) => h.name).join(", ")}
            />
          )}
          {b.reschedule_count > 0 && (
            <Text style={shared.small}>
              Moved {b.reschedule_count}{" "}
              {b.reschedule_count === 1 ? "time" : "times"}.
            </Text>
          )}
          {!!b.cancel_reason && (
            <Detail
              label={
                b.status === "declined"
                  ? "Why it was declined"
                  : b.cancelled_by === "booker"
                    ? "Their reason for cancelling"
                    : "Reason for cancelling"
              }
              value={b.cancel_reason}
            />
          )}
        </View>

        {(answers.length > 0 || !!b.note) && (
          <>
            <Text style={[shared.eyebrow, bs.eyebrow]}>THEIR ANSWERS</Text>
            <View style={shared.card}>
              {answers.map((a, n) => (
                <Detail
                  key={`${a.label}-${n}`}
                  label={a.label}
                  value={a.value?.trim() || "No answer"}
                  faint={!a.value?.trim()}
                />
              ))}
              {!!b.note && <Detail label="Their note" value={b.note} />}
            </View>
          </>
        )}

        {waiting && (
          <View style={[shared.softCard, s.approve]}>
            <Text style={bs.rowTitle}>{b.name} is waiting for you</Text>
            <Text style={[shared.small, bs.gap]}>
              The time stays held until you decide. They’re told by email either
              way.
            </Text>
            <Button
              title="Approve"
              icon="check"
              disabled={busy}
              onPress={() => void act(() => client.approveBooking(b.id))}
            />
            <Button
              secondary
              title="Decline…"
              disabled={busy}
              style={bs.last}
              onPress={() => openPanel("decline")}
            />
            {panel === "decline" && (
              <ReasonPanel
                label="Why you’re declining (optional)"
                confirm="Decline request"
                reason={reason}
                onReason={setReason}
                busy={busy}
                onConfirm={() =>
                  Alert.alert(
                    `Decline ${b.name}’s request?`,
                    "They’re told by email.",
                    [
                      { text: "Keep it", style: "cancel" },
                      {
                        text: "Decline",
                        style: "destructive",
                        onPress: () =>
                          void act(() =>
                            client.declineBooking(b.id, reason.trim()),
                          ),
                      },
                    ],
                  )
                }
              />
            )}
          </View>
        )}

        {(open || canMarkNoShow(b)) && (
          <>
            <Text style={[shared.eyebrow, bs.eyebrow]}>ACTIONS</Text>
            <View style={shared.card}>
              {canMarkNoShow(b) && (
                <SwitchRow
                  title="Didn’t show up"
                  hint="Counts toward no-shows. Only hosts see it."
                  value={b.no_show}
                  disabled={busy}
                  onValueChange={(v) =>
                    void act(() => client.setBookingNoShow(b.id, v))
                  }
                />
              )}
              {open && (
                <>
                  <Button
                    secondary
                    title="Move to another time"
                    icon="clock"
                    disabled={busy}
                    onPress={() => openPanel("reschedule")}
                  />
                  {panel === "reschedule" && (
                    <View style={s.panel}>
                      <RescheduleSlots
                        booking={b}
                        busy={busy}
                        onPick={(startAt) =>
                          void act(() =>
                            client.rescheduleBooking(b.id, startAt),
                          )
                        }
                      />
                    </View>
                  )}
                  <Button
                    destructive
                    title="Cancel booking…"
                    disabled={busy}
                    style={bs.last}
                    onPress={() => openPanel("cancel")}
                  />
                  {panel === "cancel" && (
                    <ReasonPanel
                      label="Reason (optional, sent to them)"
                      confirm="Cancel booking"
                      destructive
                      reason={reason}
                      onReason={setReason}
                      busy={busy}
                      onConfirm={() =>
                        Alert.alert(
                          `Cancel ${b.name}’s booking?`,
                          "They’re told by email and it leaves your calendar.",
                          [
                            { text: "Keep it", style: "cancel" },
                            {
                              text: "Cancel booking",
                              style: "destructive",
                              onPress: () =>
                                void act(() =>
                                  client.cancelBookingAsHost(
                                    b.id,
                                    reason.trim(),
                                  ),
                                ),
                            },
                          ],
                        )
                      }
                    />
                  )}
                </>
              )}
            </View>
          </>
        )}

        <Text style={[shared.eyebrow, bs.eyebrow]}>YOUR NOTE</Text>
        <View style={shared.card}>
          <TextInput
            style={[shared.input, bs.multiline]}
            value={note}
            onChangeText={setNote}
            maxLength={4000}
            multiline
            textAlignVertical="top"
            placeholder="Only hosts see this"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Private note about this booking"
          />
          <View style={s.noteActions}>
            <SmallAction
              label="Save note"
              disabled={busy || note.trim() === b.host_note.trim()}
              onPress={() =>
                void act(() => client.setBookingNote(b.id, note.trim()))
              }
            />
          </View>
        </View>

        {b.events.length > 0 && (
          <>
            <Text style={[shared.eyebrow, bs.eyebrow]}>HISTORY</Text>
            <View style={shared.card}>
              {b.events.map((e, n) => (
                <View key={e.id} style={s.event}>
                  <View style={s.rail}>
                    <View style={s.dot} />
                    {n < b.events.length - 1 && <View style={s.line} />}
                  </View>
                  <View style={s.eventBody}>
                    <Text style={s.eventTitle}>{EVENT_LABELS[e.kind]}</Text>
                    {!!e.detail && <Text style={shared.body}>{e.detail}</Text>}
                    <Text style={shared.small}>
                      {eventActor(e)} · {dateLabel(e.created_at)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Detail({
  label,
  value,
  faint = false,
}: {
  label: string;
  value: string;
  faint?: boolean;
}) {
  return (
    <View style={s.detail}>
      <Text style={shared.label}>{label}</Text>
      <Text selectable style={[shared.body, faint && { color: colors.faint }]}>
        {value}
      </Text>
    </View>
  );
}

function ReasonPanel({
  label,
  confirm,
  destructive = false,
  reason,
  onReason,
  busy,
  onConfirm,
}: {
  label: string;
  confirm: string;
  destructive?: boolean;
  reason: string;
  onReason: (reason: string) => void;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <View style={s.panel}>
      <Field label={label}>
        <TextInput
          style={[shared.input, bs.multiline]}
          value={reason}
          onChangeText={onReason}
          maxLength={500}
          multiline
          textAlignVertical="top"
          placeholderTextColor={colors.faint}
          accessibilityLabel={label}
        />
      </Field>
      <Button
        destructive={destructive}
        title={confirm}
        disabled={busy}
        style={bs.last}
        onPress={onConfirm}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    head: { flexDirection: "row", gap: 10, marginBottom: 14 },
    email: { marginTop: 2 },
    pills: { flexDirection: "row", marginBottom: 14 },
    detail: { marginBottom: 14 },
    theirs: { marginTop: -8, marginBottom: 14 },
    link: { fontFamily: fonts.medium, fontSize: 14, color: colors.accent },
    approve: { padding: 16 },
    panel: { marginTop: 10, marginBottom: 12 },
    noteActions: { flexDirection: "row", marginTop: 10 },
    event: { flexDirection: "row", gap: 12 },
    rail: { alignItems: "center", width: 10 },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      marginTop: 4,
      backgroundColor: colors.dot,
    },
    line: { flex: 1, width: 2, backgroundColor: colors.divider, marginTop: 2 },
    eventBody: { flex: 1, paddingBottom: 14 },
    eventTitle: {
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
      marginBottom: 2,
    },
  }),
);
