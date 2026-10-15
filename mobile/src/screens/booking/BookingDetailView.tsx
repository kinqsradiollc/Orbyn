import React, { useEffect, useRef, useState } from "react";
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../../lib/alert";
import { dateLabel, type BookingDetail, type BookingPage } from "@orbyn/core";
import { Button } from "../../components/Button";
import { InlineDetails } from "../../components/InlineDetails";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Field } from "../../components/Field";
import { Pill } from "../../components/Pill";
import { sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import * as outbox from "../../lib/outbox";
import { deviceTimeZone, minutesLabel, slotLabel } from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { colors, fonts, radii, themed } from "../../theme";
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
  onBusyChange,
}: {
  id: string;
  pages: BookingPage[] | null;
  onPages: (pages: BookingPage[]) => void;
  /** After an action, so counts elsewhere catch up. */
  onChanged: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [note, setNote] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [reason, setReason] = useState("");
  const [reload, setReload] = useState(0);
  const actionPending = useRef(false);
  const renderAccount = session.token;
  const context = useRef({ id, account: renderAccount });
  context.current = { id, account: renderAccount };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onBusyChange?.(false);
    };
  }, [onBusyChange]);

  useEffect(() => {
    let alive = true;
    const account = session.token;
    setBooking(null);
    setPanel(null);
    setReason("");
    setQueued("");
    void run(async () => {
      const b = await client.getBooking(id);
      if (!alive || account !== session.token) return;
      setBooking(b);
      setNote(b.host_note);
    });
    return () => {
      alive = false;
    };
  }, [run, id, reload]);
  // Opened from a notification, before the pages list has loaded.
  useEffect(() => {
    let alive = true;
    const account = session.token;
    if (!pages)
      client
        .listBookingPages()
        .then((next) => {
          if (alive && account === session.token) onPages(next);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pages, onPages]);

  /**
   * Run a host action; the reply is the updated booking. Offline it's kept
   * on the phone (the reply is null) and shown here as `expected` until it
   * is sent.
   */
  const [queued, setQueued] = useState("");
  const act = async (
    fn: () => Promise<unknown>,
    expected: Partial<BookingDetail> = {},
    whenQueued = "Saved on this phone. Sends when online.",
  ) => {
    if (
      actionPending.current ||
      !mounted.current ||
      context.current.id !== id ||
      renderAccount !== session.token
    )
      return;
    const account = session.token;
    actionPending.current = true;
    onBusyChange?.(true);
    try {
      await run(async () => {
        const answer = (await fn()) as BookingDetail | null;
        if (
          !mounted.current ||
          account !== session.token ||
          context.current.id !== id ||
          renderAccount !== session.token
        )
          return;
        const next = answer ?? (booking ? { ...booking, ...expected } : null);
        if (next) {
          setBooking(next);
          if ("host_note" in expected) setNote(next.host_note);
        }
        setQueued(answer ? "" : whenQueued);
        setPanel(null);
        setReason("");
        if (answer) onChanged();
      });
    } finally {
      actionPending.current = false;
      onBusyChange?.(false);
    }
  };
  const openPanel = (p: Panel) => {
    if (busy || actionPending.current) return;
    setPanel(panel === p ? null : p);
    setReason("");
  };

  if (!booking)
    return (
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {busy ? "Loading booking…" : ""}
          </Text>
          {!!error && (
            <SmallAction
              label="Retry"
              disabled={busy}
              onPress={() => setReload((value) => value + 1)}
            />
          )}
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
        {!!queued && (
          <Text
            style={[shared.softCard, shared.small]}
            accessibilityRole="alert"
          >
            {queued}
          </Text>
        )}

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
          {/* Bookings from an open invite have no page. */}
          <Detail
            label={b.page_id ? "Booking page" : "From"}
            value={b.page_title ?? "Open invite"}
          />
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
              Time is held until you decide. They’re notified by email.
            </Text>
            <Button
              title="Approve"
              icon="check"
              disabled={busy}
              onPress={() =>
                void act(() => outbox.approveBooking(b.id, b.name), {
                  status: "confirmed",
                })
              }
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
                          void act(
                            () =>
                              outbox.declineBooking(
                                b.id,
                                b.name,
                                reason.trim(),
                              ),
                            { status: "declined" },
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
                          void act(
                            () =>
                              outbox.rescheduleBooking(b.id, b.name, startAt),
                            {},
                            "Saved on this phone. Sends when online; if the time is taken, choose another.",
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
                                void act(
                                  () =>
                                    outbox.cancelBooking(
                                      b.id,
                                      b.name,
                                      reason.trim(),
                                    ),
                                  { status: "cancelled" },
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

        <InlineDetails title="Private note">
          <View style={shared.card}>
            <TextInput
              style={[shared.input, bs.multiline]}
              value={note}
              editable={!busy}
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
                  void act(
                    () => outbox.setBookingNote(b.id, b.name, note.trim()),
                    { host_note: note.trim() },
                  )
                }
              />
            </View>
          </View>
        </InlineDetails>
        {b.events.length > 0 && (
          <InlineDetails title="History">
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
          </InlineDetails>
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
          editable={!busy}
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
    head: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
    email: { marginTop: 2 },
    pills: { flexDirection: "row", marginBottom: 14 },
    detail: { marginBottom: 14 },
    theirs: { marginTop: -8, marginBottom: 14 },
    link: { fontFamily: fonts.medium, fontSize: 15, color: colors.accent },
    approve: { padding: 16 },
    panel: { marginTop: 10, marginBottom: 12 },
    noteActions: { flexDirection: "row", marginTop: 10 },
    event: { flexDirection: "row", gap: 12 },
    rail: { alignItems: "center", width: 10 },
    dot: {
      width: 10,
      height: 10,
      borderRadius: radii.pill,
      marginTop: 4,
      backgroundColor: colors.dot,
    },
    line: { flex: 1, width: 2, backgroundColor: colors.divider, marginTop: 2 },
    eventBody: { flex: 1, paddingBottom: 14 },
    eventTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
  }),
);
