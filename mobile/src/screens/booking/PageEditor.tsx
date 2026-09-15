import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SLOT_INTERVALS,
  isTimeZone,
  type BookingAvailability,
  type BookingPage,
  type Team,
  type TeamMember,
  type User,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Field, NumberInput } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { sheetStyles } from "../../components/Sheet";
import { client, webOrigin } from "../../lib/api";
import {
  LIST_COLORS,
  minutesLabel,
  parseMinutes,
  shareText,
} from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { animateLayout } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { AvailabilityEditor, type OverrideDraft } from "./AvailabilityEditor";
import {
  BUFFERS,
  DEFAULT_EVENT_TITLE,
  DURATIONS,
  HEX,
  NOTICE,
  bookingLink,
  eventTitlePreview,
  newKey,
  questionId,
  rangesValid,
  slugify,
  withValue,
} from "./helpers";
import {
  QuestionsEditor,
  draftOf,
  questionProblem,
  type QuestionDraft,
} from "./QuestionsEditor";
import { Section, SwitchRow, bookingStyles as bs } from "./ui";

const overrideDrafts = (page: BookingPage | null): OverrideDraft[] =>
  (page?.date_overrides ?? []).map((o) => ({ key: newKey(), ...o }));

/** "Every 15m · 10m before, 5m after · 4 hours’ notice". */
function schedulingSummary(p: {
  interval: number;
  before: number;
  after: number;
  notice: number;
  windowDays: string;
}) {
  const parts = [`Starts every ${minutesLabel(p.interval)}`];
  if (p.before || p.after)
    parts.push(
      [
        p.before && `${minutesLabel(p.before)} before`,
        p.after && `${minutesLabel(p.after)} after`,
      ]
        .filter(Boolean)
        .join(", "),
    );
  if (p.notice) parts.push(`${minutesLabel(p.notice)} notice`);
  parts.push(`up to ${p.windowDays || "14"} days ahead`);
  return parts.join(" · ");
}

/** Create or edit a booking page, in sections that open one at a time. */
export function PageEditor({
  page,
  user,
  teams,
  onSaved,
  onDeleted,
  onShowBookings,
}: {
  page: BookingPage | null;
  user: User | null;
  teams: Team[];
  onSaved: (page: BookingPage) => void;
  onDeleted: () => void;
  /** Open the bookings list filtered to this page. */
  onShowBookings: (page: BookingPage) => void;
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
  const [before, setBefore] = useState(page?.buffer_before_minutes ?? 0);
  const [after, setAfter] = useState(page?.buffer_after_minutes ?? 0);
  const [slotInterval, setSlotInterval] = useState(
    page?.slot_interval_minutes ?? 15,
  );
  const [maxPerDay, setMaxPerDay] = useState(
    page?.max_per_day ? String(page.max_per_day) : "",
  );
  const [maxPerWeek, setMaxPerWeek] = useState(
    page?.max_per_week ? String(page.max_per_week) : "",
  );
  const [location, setLocation] = useState(page?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState(page?.meeting_url ?? "");
  const [active, setActive] = useState(page?.active ?? true);
  const [availability, setAvailability] = useState<BookingAvailability>(
    page?.availability ?? { mode: "working_hours" },
  );
  const [overrides, setOverrides] = useState(() => overrideDrafts(page));
  const [questions, setQuestions] = useState<QuestionDraft[]>(() =>
    (page?.questions ?? []).map(draftOf),
  );
  const [approval, setApproval] = useState(page?.requires_approval ?? false);
  const [reschedule, setReschedule] = useState(page?.allow_reschedule ?? true);
  const [eventTitle, setEventTitle] = useState(
    page?.event_title ?? DEFAULT_EVENT_TITLE,
  );
  const [confirmation, setConfirmation] = useState(
    page?.confirmation_message ?? "",
  );
  const [color, setColor] = useState(page?.color ?? LIST_COLORS[0]);
  const [hosts, setHosts] = useState<{ user_id: string; required: boolean }[]>(
    (page?.hosts ?? [])
      .filter((h) => h.user_id !== user?.id)
      .map((h) => ({ user_id: h.user_id, required: h.required })),
  );
  const [people, setPeople] = useState<TeamMember[]>([]);

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

  const custom = availability.mode === "custom" ? availability : null;
  const dates = overrides.map((o) => o.date);
  const days = parseMinutes(windowDays);
  const perDay = parseMinutes(maxPerDay);
  const perWeek = parseMinutes(maxPerWeek);
  // Most mistakes are caught here so Save can say what's wrong.
  const problem = !title.trim()
    ? "Give the page a title."
    : slug.trim().length < 3
      ? "Use at least three characters for the link name."
      : days === null || days < 1 || days > 90
        ? "Bookable days ahead is 1 to 90."
        : perDay !== null && (perDay < 1 || perDay > 50)
          ? "Bookings a day is 1 to 50, or empty."
          : perWeek !== null && (perWeek < 1 || perWeek > 200)
            ? "Bookings a week is 1 to 200, or empty."
            : custom && !isTimeZone(custom.timezone.trim())
              ? "Enter a time zone like Europe/London."
              : custom && !rangesValid(custom.weekly)
                ? "End each weekly range after it starts."
                : new Set(dates).size !== dates.length
                  ? "List each date with different hours once."
                  : !overrides.every((o) => rangesValid(o.hours))
                    ? "End each range on your dates after it starts."
                    : questions.map(questionProblem).find(Boolean) ||
                      (!eventTitle.trim()
                        ? "Give calendar events a title."
                        : !HEX.test(color)
                          ? "Colours look like #376c51."
                          : "");

  const save = () =>
    run(async () => {
      // New questions get ids from their labels; saved ones keep theirs.
      const taken = new Set(
        questions.map((q) => q.id).filter((id): id is string => !!id),
      );
      const withIds = questions.map((q) => ({
        ...q,
        id: q.id ?? questionId(q.label, taken),
      }));
      const body = {
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim(),
        durations: [...durations].sort((a, b) => a - b),
        window_days: days ?? 14,
        min_notice_minutes: notice,
        buffer_before_minutes: before,
        buffer_after_minutes: after,
        slot_interval_minutes: slotInterval,
        max_per_day: perDay || null,
        max_per_week: perWeek || null,
        location: location.trim(),
        meeting_url: meetingUrl.trim(),
        active,
        co_hosts: hosts,
        color,
        availability: custom
          ? { ...custom, timezone: custom.timezone.trim() }
          : availability,
        date_overrides: overrides
          .map(({ date, hours }) => ({ date, hours }))
          .sort((a, b) => (a.date < b.date ? -1 : 1)),
        questions: withIds.map((q) => ({
          id: q.id,
          label: q.label.trim(),
          type: q.type,
          required: q.required,
          options:
            q.type === "choice"
              ? q.options.map((o) => o.trim()).filter(Boolean)
              : [],
        })),
        requires_approval: approval,
        allow_reschedule: reschedule,
        event_title: eventTitle.trim(),
        confirmation_message: confirmation.trim(),
      };
      const next = saved
        ? await client.updateBookingPage(saved.id, body)
        : await client.createBookingPage(body);
      animateLayout();
      setSaved(next);
      setSlug(next.slug);
      setQuestions(withIds);
      onSaved(next);
    });

  const link = bookingLink(saved?.slug ?? slug.trim());
  const nameOf = (id: string) =>
    people.find((p) => p.user_id === id)?.name ??
    page?.hosts.find((h) => h.user_id === id)?.name ??
    "Teammate";
  const intervals = withValue([...SLOT_INTERVALS], slotInterval);
  const counts = saved?.counts;

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
              style={bs.last}
              onPress={() => void shareText(link)}
            />
            {!saved.active && (
              <Text style={[shared.small, bs.top]}>
                This page is off, so the link shows nothing to book.
              </Text>
            )}
            <Button
              secondary
              title={
                counts?.needs_approval
                  ? `See bookings (${counts.needs_approval} to approve)`
                  : `See bookings (${counts?.upcoming ?? 0} upcoming)`
              }
              icon="calendar"
              style={s.seeBookings}
              onPress={() => onShowBookings(saved)}
            />
          </View>
        )}

        <Section title="Basics" initiallyOpen summary={title.trim()}>
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
              style={[shared.input, bs.multiline]}
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
              {[
                ...DURATIONS,
                ...durations.filter((d) => !DURATIONS.includes(d)),
              ]
                .sort((a, b) => a - b)
                .map((d) => {
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
          <SwitchRow
            title="Taking bookings"
            hint="Turn off to pause the page."
            value={active}
            onValueChange={setActive}
          />
        </Section>

        <Section
          title="Availability"
          summary={[
            custom
              ? `Custom hours in ${custom.timezone}`
              : "Your working hours",
            overrides.length
              ? `${overrides.length} ${overrides.length === 1 ? "date" : "dates"} with other hours`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <AvailabilityEditor
            availability={availability}
            onChange={setAvailability}
            overrides={overrides}
            onOverrides={setOverrides}
          />
        </Section>

        <Section
          title="Scheduling"
          summary={schedulingSummary({
            interval: slotInterval,
            before,
            after,
            notice,
            windowDays,
          })}
        >
          <Field label="Offer start times every">
            <ChipRow label="Offer start times every">
              {intervals.map((m) => (
                <Chip
                  key={m}
                  label={minutesLabel(m)}
                  selected={slotInterval === m}
                  onPress={() => setSlotInterval(m)}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label="Free time before each booking">
            <ChipRow label="Free time before each booking">
              {withValue(BUFFERS, before).map((b) => (
                <Chip
                  key={b}
                  label={b ? minutesLabel(b) : "None"}
                  selected={before === b}
                  onPress={() => setBefore(b)}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label="Free time after each booking">
            <ChipRow label="Free time after each booking">
              {withValue(BUFFERS, after).map((b) => (
                <Chip
                  key={b}
                  label={b ? minutesLabel(b) : "None"}
                  selected={after === b}
                  onPress={() => setAfter(b)}
                />
              ))}
            </ChipRow>
          </Field>
          <Field label="Notice needed">
            <ChipRow label="Notice needed">
              {withValue(
                NOTICE.map((n) => n.value),
                notice,
              ).map((v) => (
                <Chip
                  key={v}
                  label={
                    NOTICE.find((n) => n.value === v)?.label ?? minutesLabel(v)
                  }
                  selected={notice === v}
                  onPress={() => setNotice(v)}
                />
              ))}
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
          <Field label="Most bookings a day" hint="Leave empty for no limit.">
            <NumberInput
              value={maxPerDay}
              onChangeText={setMaxPerDay}
              placeholder="No limit"
              accessibilityLabel="Most bookings a day"
            />
          </Field>
          <Field
            label="Most bookings a week"
            hint="Leave empty for no limit."
            style={bs.last}
          >
            <NumberInput
              value={maxPerWeek}
              onChangeText={setMaxPerWeek}
              placeholder="No limit"
              accessibilityLabel="Most bookings a week"
            />
          </Field>
        </Section>

        <Section
          title="Questions"
          summary={
            questions.length
              ? questions
                  .map((q) => q.label.trim())
                  .filter(Boolean)
                  .join(", ")
              : "Just name and email"
          }
        >
          <QuestionsEditor questions={questions} onChange={setQuestions} />
        </Section>

        <Section
          title="Confirmation"
          summary={[
            approval ? "You approve each request" : "Booked right away",
            reschedule ? "people can move bookings" : "no moving bookings",
          ].join(" · ")}
        >
          <SwitchRow
            title="Approve each request"
            hint="Times stay held until you approve or decline."
            value={approval}
            onValueChange={setApproval}
          />
          <SwitchRow
            title="Let people move their booking"
            hint="From the link in their confirmation email."
            value={reschedule}
            onValueChange={setReschedule}
          />
          <Field
            label="Calendar event title"
            hint={`{page}, {name} and {email} are filled in. Looks like: ${eventTitlePreview(eventTitle, title)}`}
          >
            <TextInput
              style={shared.input}
              value={eventTitle}
              onChangeText={setEventTitle}
              maxLength={200}
              autoCorrect={false}
              placeholder={DEFAULT_EVENT_TITLE}
              placeholderTextColor={colors.faint}
              accessibilityLabel="Calendar event title"
            />
          </Field>
          <Field
            label="Message after booking (optional)"
            hint="Shown once they book and in their confirmation email."
            style={bs.last}
          >
            <TextInput
              style={[shared.input, bs.multiline]}
              value={confirmation}
              onChangeText={setConfirmation}
              maxLength={1000}
              multiline
              textAlignVertical="top"
              placeholder="Thanks! Bring any questions you have."
              placeholderTextColor={colors.faint}
              accessibilityLabel="Message after booking"
            />
          </Field>
        </Section>

        <Section title="Colour" summary={color}>
          <Text style={[shared.small, bs.gap]}>
            Used for buttons and highlights on the booking page.
          </Text>
          <View style={s.swatches} accessibilityRole="radiogroup">
            {LIST_COLORS.map((c) => {
              const on = color.toLowerCase() === c;
              return (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityLabel={c}
                  accessibilityState={{ checked: on }}
                  hitSlop={4}
                  onPress={() => setColor(c)}
                  style={[s.swatch, { backgroundColor: c }, on && s.swatchOn]}
                >
                  {on && <Icon name="check" size={16} color={colors.white} />}
                </Pressable>
              );
            })}
          </View>
          <View style={[bs.pair, s.hexRow]}>
            <View
              style={[
                s.preview,
                { backgroundColor: HEX.test(color) ? color : colors.surface },
              ]}
            />
            <TextInput
              style={[shared.input, bs.half]}
              value={color}
              onChangeText={(t) =>
                setColor(t.startsWith("#") ? t : `#${t.replace(/#/g, "")}`)
              }
              maxLength={7}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="#376c51"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Colour as a hex code"
            />
          </View>
        </Section>

        <Section
          title="Co-hosts"
          summary={
            hosts.length
              ? hosts.map((h) => nameOf(h.user_id)).join(", ")
              : "Just you"
          }
        >
          <Text style={[shared.small, bs.gap]}>
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
              <View style={s.hosts}>
                {hosts.map((h) => (
                  <SwitchRow
                    key={h.user_id}
                    title={nameOf(h.user_id)}
                    hint={h.required ? "Required" : "Optional"}
                    value={h.required}
                    onValueChange={(required) =>
                      setHosts(
                        hosts.map((x) =>
                          x.user_id === h.user_id ? { ...x, required } : x,
                        ),
                      )
                    }
                  />
                ))}
              </View>
            </>
          )}
        </Section>

        {!!problem && <Text style={[shared.small, s.problem]}>{problem}</Text>}
        <Button
          title={busy ? "Saving…" : saved ? "Save changes" : "Create page"}
          icon="check"
          disabled={busy || !!problem || !durations.length}
          onPress={() => void save()}
        />

        {saved && (
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
                        onDeleted();
                      }),
                  },
                ],
              )
            }
          />
        )}
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    linkCard: { padding: 16 },
    link: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.accent,
      marginBottom: 12,
    },
    seeBookings: { marginTop: 10, marginBottom: 0 },
    swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    swatch: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    swatchOn: { borderWidth: 3, borderColor: colors.surface },
    hexRow: { marginTop: 14 },
    preview: {
      width: 50,
      height: 50,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    hosts: { marginTop: 14 },
    problem: { textAlign: "center", marginBottom: 10 },
  }),
);
