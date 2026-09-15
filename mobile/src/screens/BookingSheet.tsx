import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Booking, BookingPage, Team, TeamMember, User } from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { Field, NumberInput } from "../components/Field";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client, webOrigin } from "../lib/api";
import {
  minutesLabel,
  parseMinutes,
  shareText,
  slotLabel,
} from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

const DURATIONS = [15, 30, 45, 60, 90, 120];
const NOTICE = [
  { value: 0, label: "None" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "1 day" },
  { value: 2880, label: "2 days" },
];
const BUFFERS = [0, 5, 10, 15, 30];

/** The link people open to book time. */
export const bookingLink = (slug: string) => `${webOrigin}/book/${slug}`;

const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

type Page = "list" | { page: BookingPage | null };

/**
 * Booking pages: links people outside Orbyn use to book time with you (and
 * co-hosts). Each page's editor also lists its upcoming bookings.
 */
export function BookingSheet({
  visible,
  user,
  teams,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  user: User | null;
  teams: Team[];
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [page, setPage] = useState<Page>("list");
  const close = () => {
    setPage("list");
    onClose();
  };
  return (
    <Sheet
      visible={visible}
      title={
        page === "list"
          ? "Booking pages"
          : page.page
            ? "Booking page"
            : "New booking page"
      }
      onClose={close}
      onBack={page === "list" ? undefined : () => setPage("list")}
      onDismiss={onDismiss}
    >
      {page === "list" ? (
        <PageList onOpen={(p) => setPage({ page: p })} />
      ) : (
        <PageEditor
          key={page.page?.id ?? "new"}
          page={page.page}
          user={user}
          teams={teams}
          onDone={() => setPage("list")}
        />
      )}
    </Sheet>
  );
}

function PageList({ onOpen }: { onOpen: (page: BookingPage | null) => void }) {
  const { busy, error, setError, run } = useRun();
  const [pages, setPages] = useState<BookingPage[] | null>(null);
  useEffect(() => {
    void run(async () => setPages(await client.listBookingPages()));
  }, [run]);
  return (
    <ScrollView contentContainerStyle={sheetStyles.body}>
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          Share a link and people can pick a time that works for you. Your
          calendar stays private; they only see free times.
        </Text>
        {pages === null ? (
          <Text style={shared.small}>{busy ? "Loading…" : ""}</Text>
        ) : pages.length === 0 ? (
          <View style={[shared.card, shared.empty]}>
            <View style={shared.emptyIcon}>
              <Icon name="link" size={24} color={colors.accent} />
            </View>
            <Text style={shared.sectionTitle}>No booking pages yet.</Text>
            <Text style={[shared.subtitle, s.center]}>
              Make one for office hours, intro calls or anything people book
              with you.
            </Text>
          </View>
        ) : (
          <View style={s.card}>
            {pages.map((p, n) => (
              <View key={p.id} style={[n > 0 && s.divider]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${p.title}${p.active ? "" : ", turned off"}`}
                  accessibilityHint="Edit this page and see its bookings"
                  onPress={() => onOpen(p)}
                  style={({ pressed }) => [s.row, pressed && s.pressed]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{p.title}</Text>
                    <Text style={shared.small} numberOfLines={1}>
                      /book/{p.slug} ·{" "}
                      {p.durations.map((d) => minutesLabel(d)).join(", ")}
                    </Text>
                  </View>
                  {!p.active && <Pill label="Off" />}
                  <Icon name="chevronRight" size={16} color={colors.faint} />
                </Pressable>
                <View style={s.rowActions}>
                  <SmallAction
                    label="Share link"
                    disabled={!p.active}
                    onPress={() => void shareText(bookingLink(p.slug))}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
        <Button
          title="New booking page"
          icon="plus"
          onPress={() => onOpen(null)}
        />
      </View>
    </ScrollView>
  );
}

function PageEditor({
  page,
  user,
  teams,
  onDone,
}: {
  page: BookingPage | null;
  user: User | null;
  teams: Team[];
  onDone: () => void;
}) {
  const { busy, error, setError, run } = useRun();
  const [saved, setSaved] = useState<BookingPage | null>(page);
  const [title, setTitle] = useState(page?.title ?? "");
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!page);
  const [description, setDescription] = useState(page?.description ?? "");
  const [durations, setDurations] = useState<number[]>(page?.durations ?? [30]);
  const [windowDays, setWindowDays] = useState(String(page?.window_days ?? 14));
  const [notice, setNotice] = useState(page?.min_notice_minutes ?? 240);
  const [buffer, setBuffer] = useState(page?.buffer_minutes ?? 0);
  const [maxPerDay, setMaxPerDay] = useState(
    page?.max_per_day ? String(page.max_per_day) : "",
  );
  const [location, setLocation] = useState(page?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(page?.meeting_url ?? "");
  const [active, setActive] = useState(page?.active ?? true);
  const [hosts, setHosts] = useState<{ user_id: string; required: boolean }[]>(
    (page?.hosts ?? [])
      .filter((h) => h.user_id !== user?.id)
      .map((h) => ({ user_id: h.user_id, required: h.required })),
  );
  const [people, setPeople] = useState<TeamMember[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Teammates who can co-host, from every team you're in.
  const teamIds = teams.map((t) => t.id).join(",");
  useEffect(() => {
    let alive = true;
    const ids = teamIds ? teamIds.split(",") : [];
    Promise.all(ids.map((id) => client.getTeam(id).catch(() => null)))
      .then((details) => {
        if (!alive) return;
        const seen = new Map<string, TeamMember>();
        for (const d of details)
          for (const m of d?.members ?? [])
            if (m.user_id !== user?.id) seen.set(m.user_id, m);
        setPeople(
          [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [teamIds, user?.id]);

  const pageId = saved?.id;
  const loadBookings = useCallback(async () => {
    if (!pageId) return;
    const list = await client.listBookings(pageId);
    const now = Date.now();
    setBookings(
      list
        .filter((b) => b.status !== "cancelled" && Date.parse(b.end_at) > now)
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)),
    );
  }, [pageId]);
  useEffect(() => {
    void run(loadBookings);
  }, [run, loadBookings]);

  const save = () =>
    run(async () => {
      const body = {
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim(),
        durations: [...durations].sort((a, b) => a - b),
        window_days: parseMinutes(windowDays) ?? 14,
        min_notice_minutes: notice,
        buffer_minutes: buffer,
        max_per_day: parseMinutes(maxPerDay) || null,
        location: location.trim(),
        meeting_url: meetingUrl.trim(),
        active,
        co_hosts: hosts,
      };
      const next = saved
        ? await client.updateBookingPage(saved.id, body)
        : await client.createBookingPage(body);
      animateLayout();
      setSaved(next);
      setSlug(next.slug);
    });

  const link = bookingLink(saved?.slug ?? slug.trim());
  const nameOf = (id: string) =>
    people.find((p) => p.user_id === id)?.name ??
    page?.hosts.find((h) => h.user_id === id)?.name ??
    "Teammate";

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        {saved && (
          <View style={[shared.softCard, s.linkCard]}>
            <Text style={shared.label}>Booking link</Text>
            <Text selectable style={s.link}>
              {link}
            </Text>
            <Button
              title="Share link"
              icon="share"
              disabled={!saved.active}
              style={s.last}
              onPress={() => void shareText(link)}
            />
            {!saved.active && (
              <Text style={[shared.small, s.top]}>
                This page is off, so the link shows nothing to book.
              </Text>
            )}
          </View>
        )}

        <View style={shared.card}>
          <Field label="Title">
            <TextInput
              style={shared.input}
              value={title}
              onChangeText={(t) => {
                setTitle(t);
                if (!slugTouched) setSlug(slugify(t));
              }}
              maxLength={120}
              placeholder="Intro call"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Page title"
            />
          </Field>
          <Field
            label="Link name"
            hint={`${webOrigin}/book/${slug || "your-name"}`}
          >
            <TextInput
              style={shared.input}
              value={slug}
              onChangeText={(t) => {
                setSlugTouched(true);
                setSlug(t.toLowerCase());
              }}
              maxLength={60}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="intro-call"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Link name, lowercase letters, numbers and dashes"
            />
          </Field>
          <Field label="Description (optional)">
            <TextInput
              style={[shared.input, s.multiline]}
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
              multiline
              textAlignVertical="top"
              placeholder="What the time is for"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Description"
            />
          </Field>
          <Field label="Lengths people can book" hint="Up to four.">
            <ChipRow label="Lengths" multi>
              {DURATIONS.map((d) => {
                const on = durations.includes(d);
                return (
                  <Chip
                    key={d}
                    multi
                    label={minutesLabel(d)}
                    selected={on}
                    disabled={!on && durations.length >= 4}
                    onPress={() => {
                      const next = on
                        ? durations.filter((x) => x !== d)
                        : [...durations, d];
                      if (next.length) setDurations(next);
                    }}
                  />
                );
              })}
            </ChipRow>
          </Field>
          <Field label="Bookable up to">
            <NumberInput
              value={windowDays}
              onChangeText={setWindowDays}
              suffix="days ahead"
              accessibilityLabel="Bookable up to how many days ahead"
            />
          </Field>
          <Field label="Notice needed">
            <ChipRow label="Notice needed">
              {NOTICE.map((n) => (
                <Chip
                  key={n.value}
                  label={n.label}
                  selected={notice === n.value}
                  onPress={() => setNotice(n.value)}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label="Gap between bookings">
            <ChipRow label="Gap between bookings">
              {BUFFERS.map((b) => (
                <Chip
                  key={b}
                  label={b ? minutesLabel(b) : "None"}
                  selected={buffer === b}
                  onPress={() => setBuffer(b)}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label="Most bookings a day" hint="Leave empty for no limit.">
            <NumberInput
              value={maxPerDay}
              onChangeText={setMaxPerDay}
              placeholder="No limit"
              accessibilityLabel="Most bookings a day"
            />
          </Field>
          <Field label="Location (optional)">
            <TextInput
              style={shared.input}
              value={location}
              onChangeText={setLocation}
              maxLength={300}
              placeholder="Where you’ll meet"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Location"
            />
          </Field>
          <Field
            label="Meeting link (optional)"
            hint="Sent to people once they book."
          >
            <TextInput
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
          <View style={s.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>Taking bookings</Text>
              <Text style={shared.small}>Turn off to pause the page.</Text>
            </View>
            <Switch
              value={active}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Taking bookings"
              onValueChange={setActive}
            />
          </View>
        </View>

        <Text style={[shared.eyebrow, s.eyebrow]}>CO-HOSTS</Text>
        <View style={shared.card}>
          <Text style={[shared.small, s.gap]}>
            Only times when every required host is free are offered. Optional
            hosts join when they can.
          </Text>
          {people.length === 0 && hosts.length === 0 ? (
            <Text style={shared.small}>
              Teammates you can add show up here.
            </Text>
          ) : (
            <>
              <ChipRow label="Co-hosts" multi>
                {people.map((p) => {
                  const on = hosts.some((h) => h.user_id === p.user_id);
                  return (
                    <Chip
                      key={p.user_id}
                      multi
                      label={p.name}
                      selected={on}
                      onPress={() =>
                        setHosts(
                          on
                            ? hosts.filter((h) => h.user_id !== p.user_id)
                            : [
                                ...hosts,
                                { user_id: p.user_id, required: true },
                              ],
                        )
                      }
                    />
                  );
                })}
              </ChipRow>
              {hosts.map((h) => (
                <View key={h.user_id} style={s.hostRow}>
                  <Text style={[s.hostName, { flex: 1 }]} numberOfLines={1}>
                    {nameOf(h.user_id)}
                  </Text>
                  <Text style={shared.small}>Required</Text>
                  <Switch
                    value={h.required}
                    trackColor={{ true: colors.accent }}
                    accessibilityLabel={`${nameOf(h.user_id)} required`}
                    onValueChange={(required) =>
                      setHosts(
                        hosts.map((x) =>
                          x.user_id === h.user_id ? { ...x, required } : x,
                        ),
                      )
                    }
                  />
                </View>
              ))}
            </>
          )}
        </View>

        <Button
          title={busy ? "Saving…" : saved ? "Save changes" : "Create page"}
          icon="check"
          disabled={
            busy || !title.trim() || slug.trim().length < 3 || !durations.length
          }
          onPress={() => void save()}
        />

        {saved && (
          <>
            <Text style={[shared.eyebrow, s.eyebrow]}>UPCOMING BOOKINGS</Text>
            <View style={shared.card}>
              {bookings.length === 0 ? (
                <Text style={shared.small}>Nothing booked yet.</Text>
              ) : (
                bookings.map((b, n) => (
                  <FadeIn key={b.id} style={[s.booking, n > 0 && s.divider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowTitle}>{b.name}</Text>
                      <Text style={shared.small}>
                        {slotLabel(b.start_at, b.end_at)}
                      </Text>
                      <Text style={shared.small} numberOfLines={1}>
                        {b.email}
                      </Text>
                      {!!b.note && (
                        <Text style={[shared.body, s.top]}>{b.note}</Text>
                      )}
                      {b.status === "pending" && (
                        <View style={s.top}>
                          <Pill
                            label="Waiting for them to confirm"
                            tone="warning"
                          />
                        </View>
                      )}
                    </View>
                    <SmallAction
                      destructive
                      label="Cancel"
                      disabled={busy}
                      onPress={() =>
                        Alert.alert(
                          `Cancel ${b.name}’s booking?`,
                          "They’re told by email.",
                          [
                            { text: "Keep it", style: "cancel" },
                            {
                              text: "Cancel booking",
                              style: "destructive",
                              onPress: () =>
                                void run(async () => {
                                  await client.cancelBooking(saved.id, b.id);
                                  animateLayout();
                                  await loadBookings();
                                }),
                            },
                          ],
                        )
                      }
                    />
                  </FadeIn>
                ))
              )}
            </View>
            <Button
              destructive
              title="Delete page"
              icon="trash"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  `Delete ${saved.title}?`,
                  "The link stops working. Bookings already made stay on your calendar.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        void run(async () => {
                          await client.deleteBookingPage(saved.id);
                          onDone();
                        }),
                    },
                  ],
                )
              }
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  intro: { marginTop: 0, marginBottom: 18 },
  center: { textAlign: "center" },
  eyebrow: { marginTop: 8 },
  gap: { marginBottom: 12 },
  top: { marginTop: 6 },
  last: { marginBottom: 0 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden",
    marginBottom: 16,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 14,
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  rowActions: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  rowTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 2,
  },
  linkCard: { padding: 16 },
  link: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.accent,
    marginBottom: 12,
  },
  multiline: { minHeight: 80 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    marginTop: 6,
  },
  hostName: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
  booking: { flexDirection: "row", gap: 10, paddingVertical: 12 },
});
