import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../../lib/alert";
import {
  DEFAULT_BOOKER_REMINDERS,
  dateLabel,
  type OpenInvite,
  type OpenInviteStatus,
  type Team,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ClockField, DateField, Field } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Pill, type PillTone } from "../../components/Pill";
import { sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import {
  clockLabel,
  minutesLabel,
  rangeLabel,
  shareText,
  shortDay,
} from "../planner/planning";
import { useRun } from "../../hooks/useRun";
import { InlineDetails } from "../../components/InlineDetails";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { DURATIONS, MEETING_URL, dayKeyOf, newKey } from "./helpers";
import { RemoveButton, ReminderChips, bookingStyles as bs } from "./ui";

/** The server's limit on windows per invite. */
const MAX_WINDOWS = 20;
/** The server's limit on co-hosts. */
const MAX_CO_HOSTS = 10;

export const INVITE_STATUS: Record<
  OpenInviteStatus,
  { label: string; tone: PillTone }
> = {
  open: { label: "Open", tone: "accent" },
  booked: { label: "Booked", tone: "accent" },
  expired: { label: "Expired", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

type WindowDraft = { key: string; day: string; start: string; end: string };

/** "2026-09-18" plus "09:30" as that local time. */
const at = (day: string, clock: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, min] = clock.split(":").map(Number);
  return new Date(y, m - 1, d, h || 0, min || 0);
};
const addDays = (day: string, days: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return dayKeyOf(new Date(y, m - 1, d + days));
};
const minutesBetween = (w: WindowDraft) =>
  (at(w.day, w.end).getTime() - at(w.day, w.start).getTime()) / 60_000;

/** "Tue, Sep 15 9:00 AM–12:00 PM" and how many more. */
function windowsSummary(invite: OpenInvite) {
  const [first, ...rest] = invite.windows;
  if (!first) return "";
  const text = `${shortDay(first.start_at)} ${clockLabel(first.start_at)}–${clockLabel(first.end_at)}`;
  return rest.length ? `${text} + ${rest.length} more` : text;
}

/**
 * Your open invites: one-off links offering hand-picked times to one person.
 * Share an open one, or withdraw it (a booking made from it is cancelled).
 */
export function InviteList({ onNew }: { onNew: () => void }) {
  const { busy, error, setError, run } = useRun();
  const [invites, setInvites] = useState<OpenInvite[] | null>(null);
  useEffect(() => {
    void run(async () => setInvites(await client.listOpenInvites()));
  }, [run]);

  const cancel = (invite: OpenInvite) =>
    Alert.alert(
      `Withdraw ${invite.title}?`,
      invite.booking
        ? `The link stops working and ${invite.booking.name}’s booking is cancelled. They’re told by email.`
        : "The link stops working.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Withdraw",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              await client.cancelOpenInvite(invite.id);
              setInvites(await client.listOpenInvites());
            }),
        },
      ],
    );

  return (
    <>
      <ErrorBanner error={error} onDismiss={() => setError("")} />
      <Text style={[shared.subtitle, s.intro]}>
        Their chosen time books immediately. Each link works once.
      </Text>
      <Button title="Offer times" icon="plus" onPress={onNew} />
      {invites === null ? (
        busy ? (
          <Text style={shared.small}>Loading…</Text>
        ) : (
          <Button
            secondary
            title="Retry"
            onPress={() =>
              void run(async () => setInvites(await client.listOpenInvites()))
            }
          />
        )
      ) : invites.length === 0 ? (
        <View style={[shared.card, shared.empty]}>
          <View style={shared.emptyIcon}>
            <Icon name="clock" size={24} color={colors.accent} />
          </View>
          <Text style={shared.sectionTitle}>No invites yet.</Text>
          <Text style={[shared.subtitle, s.center]}>
            Offer times to share a private booking link.
          </Text>
        </View>
      ) : (
        <View style={bs.list}>
          {invites.map((invite, n) => {
            const status = INVITE_STATUS[invite.status];
            const open = invite.status === "open";
            const canWithdraw = open || invite.status === "booked";
            return (
              <View key={invite.id} style={n > 0 && bs.divider}>
                <View style={s.row}>
                  <View style={s.rowTop}>
                    <Text style={[bs.rowTitle, { flex: 1 }]}>
                      {invite.title}
                    </Text>
                    <Pill label={status.label} tone={status.tone} />
                  </View>
                  <Text style={shared.small}>
                    {minutesLabel(invite.duration)} · {windowsSummary(invite)}
                    {invite.co_hosts.length > 0 &&
                      ` · with ${invite.co_hosts.map((h) => h.name).join(", ")}`}
                  </Text>
                  <InlineDetails title="Offered windows">
                    {invite.windows.map((w) => (
                      <Text key={w.start_at} style={shared.small}>
                        {shortDay(w.start_at)} ·{" "}
                        {rangeLabel(w.start_at, w.end_at)}
                      </Text>
                    ))}
                  </InlineDetails>
                  {invite.booking ? (
                    <Text style={[shared.small, s.line]}>
                      {invite.booking.name} booked{" "}
                      {rangeLabel(
                        invite.booking.start_at,
                        invite.booking.end_at,
                      )}
                    </Text>
                  ) : open ? (
                    <Text style={[shared.small, s.line]}>
                      Link works until {dateLabel(invite.expires_at)}
                    </Text>
                  ) : null}
                  <View style={s.actions}>
                    {open && (
                      <SmallAction
                        label="Share link"
                        disabled={false}
                        onPress={() => void shareText(invite.url)}
                      />
                    )}
                    {canWithdraw && (
                      <SmallAction
                        destructive
                        label="Withdraw"
                        disabled={busy}
                        onPress={() => cancel(invite)}
                      />
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

/**
 * Offer times: windows by day with a start and end, the meeting's title and
 * length, where it happens, reminders for the booker and when the link stops.
 */
export function InviteEditor({
  teams,
  userId,
  onDone,
  onBusyChange,
  visible = true,
}: {
  /** Your teams: people you share one with can co-host. */
  teams: Team[];
  userId: string | undefined;
  onDone: () => void;
  onBusyChange?: (busy: boolean) => void;
  visible?: boolean;
}) {
  const { busy, error, setError, run } = useRun();
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [coHosts, setCoHosts] = useState<string[]>([]);
  const [people, setPeople] = useState<{ user_id: string; name: string }[]>([]);
  // Everyone you share a team with, once each, by name.
  const teamIds = teams.map((t) => t.id).join(",");
  useEffect(() => {
    let alive = true;
    const ids = teamIds ? teamIds.split(",") : [];
    Promise.all(ids.map((id) => client.getTeam(id).catch(() => null)))
      .then((details) => {
        if (!alive) return;
        const seen = new Map<string, { user_id: string; name: string }>();
        for (const d of details)
          for (const m of d?.members ?? [])
            if (m.user_id !== userId)
              seen.set(m.user_id, { user_id: m.user_id, name: m.name });
        setPeople(
          [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [teamIds, userId]);
  const tomorrow = addDays(dayKeyOf(new Date()), 1);
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(30);
  const [windows, setWindows] = useState<WindowDraft[]>(() => [
    { key: newKey(), day: tomorrow, start: "09:00", end: "12:00" },
  ]);
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [reminders, setReminders] = useState<number[]>(
    DEFAULT_BOOKER_REMINDERS,
  );
  const [expiry, setExpiry] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [created, setCreated] = useState<OpenInvite | null>(null);

  const patch = (key: string, change: Partial<WindowDraft>) =>
    setWindows((list) =>
      list.map((w) => (w.key === key ? { ...w, ...change } : w)),
    );
  const addWindow = () => {
    if (busy || windows.length >= MAX_WINDOWS) return;
    const last = windows[windows.length - 1];
    setWindows([
      ...windows,
      last
        ? { ...last, key: newKey(), day: addDays(last.day, 1) }
        : { key: newKey(), day: tomorrow, start: "09:00", end: "12:00" },
    ]);
  };

  const now = Date.now();
  const problem = (() => {
    if (!title.trim()) return "Give the meeting a title.";
    if (!windows.length) return "Add a time you’re free.";
    if (windows.some((w) => w.end <= w.start))
      return "End each time after it starts.";
    if (!windows.some((w) => at(w.day, w.end).getTime() > now))
      return "Pick times that haven’t passed yet.";
    if (!windows.some((w) => minutesBetween(w) >= duration))
      return `At least one time must fit a ${minutesLabel(duration)} meeting.`;
    if (meetingUrl.trim() && !MEETING_URL.test(meetingUrl.trim()))
      return "Meeting links start with https://.";
    if (expiry && at(expiry, "23:59").getTime() <= now)
      return "The link should work until a later date.";
    return null;
  })();

  const save = () => {
    if (busy) return;
    if (problem) {
      setTried(true);
      return;
    }
    void run(async () => {
      const invite = await client.createOpenInvite({
        title: title.trim(),
        duration,
        windows: windows
          .map((w) => ({
            start_at: at(w.day, w.start).toISOString(),
            end_at: at(w.day, w.end).toISOString(),
          }))
          .sort((a, b) => (a.start_at < b.start_at ? -1 : 1)),
        location: location.trim(),
        meeting_url: meetingUrl.trim(),
        remind_before_minutes: reminders,
        co_host_ids: coHosts,
        ...(expiry ? { expires_at: at(expiry, "23:59").toISOString() } : {}),
      });
      setCreated(invite);
    });
  };

  if (!visible) return null;
  if (created)
    return (
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={sheetStyles.column}>
          <View style={[shared.softCard, s.done]}>
            <Text style={shared.sectionTitle}>Your invite is ready</Text>
            <Text style={[shared.small, s.line]}>
              Share this link. Their chosen time books immediately.
            </Text>
            <Text selectable style={s.link}>
              {created.url}
            </Text>
            <Button
              title="Share link"
              icon="share"
              style={bs.last}
              onPress={() => void shareText(created.url)}
            />
          </View>
          <Button
            secondary
            title="Back to invites"
            onPress={() => {
              setCreated(null);
              setTitle("");
              setDuration(30);
              setWindows([
                { key: newKey(), day: tomorrow, start: "09:00", end: "12:00" },
              ]);
              setLocation("");
              setMeetingUrl("");
              setCoHosts([]);
              setReminders(DEFAULT_BOOKER_REMINDERS);
              setExpiry(null);
              setTried(false);
              onDone();
            }}
          />
        </View>
      </ScrollView>
    );

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Field label="Title">
          <TextInput
            editable={!busy}
            style={shared.input}
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            placeholder="Coffee chat"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Meeting title"
          />
        </Field>
        <Field label="How long">
          <ChipRow label="Meeting length">
            {DURATIONS.map((d) => (
              <Chip
                key={d}
                label={minutesLabel(d)}
                selected={duration === d}
                disabled={busy}
                onPress={() => setDuration(d)}
              />
            ))}
          </ChipRow>
        </Field>

        <Text style={shared.label}>Times you’re free</Text>
        <Text style={[shared.small, bs.gap]}>
          Available starts are every 15 minutes. Up to {MAX_WINDOWS} windows.
        </Text>
        {windows.map((w, n) => (
          <View key={w.key} style={[shared.card, s.window]}>
            <View style={s.windowTop}>
              <Text style={[shared.label, { flex: 1, marginBottom: 0 }]}>
                Time {n + 1}
              </Text>
              {windows.length > 1 && (
                <RemoveButton
                  disabled={busy}
                  label={`Remove time ${n + 1}`}
                  onPress={() => {
                    setWindows(windows.filter((x) => x.key !== w.key));
                  }}
                />
              )}
            </View>
            <DateField
              disabled={busy}
              label={`Day of time ${n + 1}`}
              value={w.day}
              minimumDate={new Date()}
              onChange={(day) => day && patch(w.key, { day })}
            />
            <View style={[bs.pair, s.clocks]}>
              <View style={bs.half}>
                <Text style={shared.small}>From</Text>
                <ClockField
                  disabled={busy}
                  label={`Time ${n + 1} from`}
                  value={w.start}
                  onChange={(start) => patch(w.key, { start })}
                />
              </View>
              <View style={bs.half}>
                <Text style={shared.small}>To</Text>
                <ClockField
                  disabled={busy}
                  label={`Time ${n + 1} to`}
                  value={w.end}
                  onChange={(end) => patch(w.key, { end })}
                />
              </View>
            </View>
            {w.end <= w.start && (
              <Text style={[shared.small, bs.warn, bs.top]}>
                End after it starts.
              </Text>
            )}
          </View>
        ))}
        {windows.length < MAX_WINDOWS && (
          <View style={s.addWindow}>
            <SmallAction
              label="Add another time"
              disabled={busy}
              onPress={addWindow}
            />
          </View>
        )}

        <InlineDetails
          title="Meeting details"
          reveal={
            tried &&
            !!problem &&
            (problem.includes("Meeting links") ||
              problem.includes("later date"))
          }
        >
          <Field label="Location (optional)">
            <TextInput
              editable={!busy}
              style={shared.input}
              value={location}
              onChangeText={setLocation}
              maxLength={300}
              placeholder="Where you’ll meet"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Location"
            />
          </Field>
          <Field label="Meeting link (optional)" hint="Sent once they book.">
            <TextInput
              editable={!busy}
              style={shared.input}
              value={meetingUrl}
              onChangeText={setMeetingUrl}
              maxLength={500}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Meeting link"
            />
          </Field>
          {people.length > 0 && (
            <Field
              label="Co-hosts (optional)"
              hint={`All co-hosts must be free and receive the calendar event. Up to ${MAX_CO_HOSTS}.`}
            >
              <ChipRow label="Co-hosts" multi>
                {people.map((p) => {
                  const on = coHosts.includes(p.user_id);
                  return (
                    <Chip
                      key={p.user_id}
                      multi
                      label={p.name}
                      selected={on}
                      disabled={busy || (!on && coHosts.length >= MAX_CO_HOSTS)}
                      onPress={() =>
                        setCoHosts(
                          on
                            ? coHosts.filter((id) => id !== p.user_id)
                            : [...coHosts, p.user_id],
                        )
                      }
                    />
                  );
                })}
              </ChipRow>
            </Field>
          )}
          <Field label="Reminder emails">
            <ReminderChips
              disabled={busy}
              value={reminders}
              onChange={setReminders}
            />
          </Field>
          <Field
            label="Link works until (optional)"
            hint="It stops at the end of your last time anyway."
          >
            <DateField
              disabled={busy}
              label="Link works until"
              value={expiry}
              placeholder="The end of the last time"
              clearable
              minimumDate={new Date()}
              onChange={setExpiry}
            />
          </Field>
        </InlineDetails>
        {!!problem && (
          <Text
            style={[shared.small, s.problem, tried && bs.warn]}
            accessibilityLiveRegion="polite"
          >
            {problem}
          </Text>
        )}
        <Button
          title={busy ? "Creating…" : "Create link"}
          icon="link"
          disabled={busy}
          onPress={save}
        />
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginTop: 0, marginBottom: 14 },
    center: { textAlign: "center" },
    row: { paddingVertical: 12, paddingHorizontal: 16, gap: 2 },
    rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    line: { marginTop: 4 },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 10,
    },
    done: { padding: 16 },
    link: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.accent,
      marginVertical: 12,
    },
    window: { gap: 10 },
    windowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    clocks: { alignItems: "flex-start" },
    addWindow: { flexDirection: "row", marginBottom: 18 },
    problem: { textAlign: "center", marginBottom: 10 },
  }),
);
