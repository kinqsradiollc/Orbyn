import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Switch } from "../../components/Switch";
import {
  DEFAULT_BOOKER_REMINDERS,
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
import { Segmented } from "../../components/Segmented";
import { sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client, webOrigin } from "../../lib/api";
import {
  LIST_COLORS,
  deviceTimeZone,
  minutesLabel,
  parseMinutes,
  shareText,
} from "../../lib/planning";
import { useRun } from "../../hooks/useRun";
import { animateLayout } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import {
  AvailabilityEditor,
  type CustomWeek,
  type OverrideDraft,
} from "./AvailabilityEditor";
import {
  BUFFERS,
  DEFAULT_EVENT_TITLE,
  DEFAULT_WEEK,
  DURATIONS,
  HEX,
  MAX_BUFFER,
  MAX_CONFIRMATION,
  MAX_HOSTS,
  MAX_NOTICE,
  MEETING_URL,
  NOTICE,
  PLACEHOLDERS,
  SLUG,
  bookingLink,
  canEditPage,
  eventTitlePreview,
  newKey,
  questionId,
  rangesValid,
  readableAccent,
  slugify,
  withValue,
} from "./helpers";
import {
  QuestionsEditor,
  draftOf,
  questionProblem,
  type QuestionDraft,
} from "./QuestionsEditor";
import {
  PresetMinutes,
  ReminderChips,
  Section,
  SwitchRow,
  bookingStyles as bs,
  reminderLabel,
} from "./ui";

type SectionId =
  | "basics"
  | "availability"
  | "scheduling"
  | "questions"
  | "confirmation"
  | "reminders"
  | "colour"
  | "cohosts";

/** "Whose page" when it's yours rather than a team's. */
const ME = "me";

type CoHost = { user_id: string; required: boolean };
/** A page's co-hosts: every host but its owner. */
const coHostsOf = (page: BookingPage | null): CoHost[] =>
  (page?.hosts ?? [])
    .filter((h) => h.user_id !== page?.owner_id)
    .map((h) => ({ user_id: h.user_id, required: h.required }));
/** Co-hosts compared regardless of order. */
const hostsKey = (list: CoHost[]) =>
  JSON.stringify([...list].sort((a, b) => a.user_id.localeCompare(b.user_id)));

const overrideDrafts = (page: BookingPage | null): OverrideDraft[] =>
  (page?.date_overrides ?? []).map((o) => ({ key: newKey(), ...o }));

const whole = (n: number, min: number, max: number) =>
  Number.isInteger(n) && n >= min && n <= max;

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
  // NaN while a custom field is empty, so Save can say what's missing.
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
  // The custom week survives a switch to working hours and back.
  const [kept, setKept] = useState<CustomWeek>(() =>
    page?.availability.mode === "custom"
      ? {
          timezone: page.availability.timezone,
          weekly: page.availability.weekly,
        }
      : { timezone: deviceTimeZone(), weekly: DEFAULT_WEEK },
  );
  const [overrides, setOverrides] = useState(() => overrideDrafts(page));
  const [questions, setQuestions] = useState<QuestionDraft[]>(() =>
    (page?.questions ?? []).map(draftOf),
  );
  const [assignment, setAssignment] = useState<"collective" | "round_robin">(
    page?.assignment ?? "collective",
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
  /** The team the page belongs to, or null for your own. */
  const [teamId, setTeamId] = useState<string | null>(page?.team_id ?? null);
  const [reminders, setReminders] = useState<number[]>(
    page?.remind_before_minutes ?? DEFAULT_BOOKER_REMINDERS,
  );
  /** Which of your teams each teammate is in (team pages host their own). */
  const [teamsOf, setTeamsOf] = useState<Map<string, Set<string>>>(
    () => new Map(),
  );
  // The page's owner is always a host; everyone else is a co-host.
  const ownerId = saved?.owner_id ?? user?.id;
  const isOwner = !!ownerId && ownerId === user?.id;
  const [hosts, setHosts] = useState<CoHost[]>(() => coHostsOf(page));
  /** The co-hosts as saved: sent again only once they change. */
  const [savedHostsKey, setSavedHostsKey] = useState(() =>
    hostsKey(coHostsOf(page)),
  );
  const [people, setPeople] = useState<TeamMember[]>([]);
  /** Your teammates have loaded, so co-hosts outside them can be flagged. */
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [openIds, setOpenIds] = useState<SectionId[]>(["basics"]);
  const [tried, setTried] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const columnY = useRef(0);
  const offsets = useRef<Partial<Record<SectionId, number>>>({});

  // Teammates who can co-host, from every team you're in.
  const teamIds = teams.map((t) => t.id).join(",");
  useEffect(() => {
    let alive = true;
    const ids = teamIds ? teamIds.split(",") : [];
    Promise.all(ids.map((id) => client.getTeam(id).catch(() => null)))
      .then((details) => {
        if (!alive) return;
        const seen = new Map<string, TeamMember>();
        const of = new Map<string, Set<string>>();
        details.forEach((d, n) => {
          for (const m of d?.members ?? []) {
            const set = of.get(m.user_id) ?? new Set<string>();
            set.add(ids[n]);
            of.set(m.user_id, set);
            if (m.user_id !== ownerId) seen.set(m.user_id, m);
          }
        });
        setPeople(
          [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setTeamsOf(of);
        setPeopleLoaded(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [teamIds, ownerId]);

  const changeAvailability = (next: BookingAvailability) => {
    if (next.mode === "custom")
      setKept({ timezone: next.timezone, weekly: next.weekly });
    setAvailability(next);
  };

  /** Everyone listed is in the page's team (unknown until members load). */
  const inTeam = (userIds: string[]) =>
    !teamId ||
    !teamsOf.size ||
    userIds.every((id) => teamsOf.get(id)?.has(teamId));
  // Team owners and admins can make and move pages into their teams; only
  // the page's owner can take a team page back.
  const managed = teams.filter((t) => t.role === "owner" || t.role === "admin");
  const ownerLabels: Record<string, string> = { [ME]: "Me" };
  for (const t of managed) ownerLabels[t.id] = t.name;
  if (teamId && !ownerLabels[teamId])
    ownerLabels[teamId] = saved?.team_name ?? page?.team_name ?? "Team";
  const ownerOptions = [
    ...(isOwner ? [ME] : []),
    ...managed.map((t) => t.id),
    ...(teamId && !managed.some((t) => t.id === teamId) ? [teamId] : []),
  ];
  const hostsChanged = hostsKey(hosts) !== savedHostsKey;
  /** Co-hosts who left all your teams: the server refuses a co-host list with them. */
  const staleHosts = new Set(
    peopleLoaded
      ? hosts
          .filter((h) => !people.some((p) => p.user_id === h.user_id))
          .map((h) => h.user_id)
      : [],
  );
  const custom = availability.mode === "custom" ? availability : null;
  const dates = overrides.map((o) => o.date);
  const days = parseMinutes(windowDays);
  const perDay = parseMinutes(maxPerDay);
  const perWeek = parseMinutes(maxPerWeek);
  const cleanSlug = slug.trim();
  /** The first thing to fix, in the order the sections are shown. */
  const findProblem = (): [SectionId, string] | null => {
    if (!title.trim()) return ["basics", "Give the page a title."];
    if (cleanSlug.length < 3 || cleanSlug.length > 60)
      return ["basics", "Use 3 to 60 characters for the link name."];
    if (!SLUG.test(cleanSlug))
      return [
        "basics",
        "Link names use lowercase letters and numbers, with single dashes between words.",
      ];
    if (meetingUrl.trim() && !MEETING_URL.test(meetingUrl.trim()))
      return ["basics", "Meeting links start with https://."];
    if (custom && !isTimeZone(custom.timezone.trim()))
      return ["availability", "Pick a time zone for your hours."];
    if (custom && !custom.weekly.length)
      return ["availability", "Add some hours, or use your working hours."];
    if (custom && !rangesValid(custom.weekly))
      return ["availability", "End each weekly range after it starts."];
    if (new Set(dates).size !== dates.length)
      return ["availability", "List each date with different hours once."];
    if (!overrides.every((o) => rangesValid(o.hours)))
      return ["availability", "End each range on your dates after it starts."];
    if (days === null || days < 1 || days > 90)
      return ["scheduling", "Bookable days ahead is 1 to 90."];
    if (!whole(notice, 0, MAX_NOTICE))
      return [
        "scheduling",
        `Notice is 0 to ${MAX_NOTICE} minutes (two weeks).`,
      ];
    if (!whole(before, 0, MAX_BUFFER) || !whole(after, 0, MAX_BUFFER))
      return [
        "scheduling",
        `Free time before and after is 0 to ${MAX_BUFFER} minutes.`,
      ];
    if (perDay !== null && (perDay < 1 || perDay > 50))
      return ["scheduling", "Bookings a day is 1 to 50, or empty."];
    if (perWeek !== null && (perWeek < 1 || perWeek > 200))
      return ["scheduling", "Bookings a week is 1 to 200, or empty."];
    const question = questions.map(questionProblem).find(Boolean);
    if (question) return ["questions", question];
    if (!eventTitle.trim())
      return ["confirmation", "Give calendar events a title."];
    if (!HEX.test(color)) return ["colour", "Colours look like #376c51."];
    if (hosts.length > MAX_HOSTS)
      return ["cohosts", `Pick up to ${MAX_HOSTS} co-hosts.`];
    // Unchanged co-hosts aren't sent, so a stale one only matters on a change.
    if (hostsChanged && staleHosts.size)
      return [
        "cohosts",
        "Remove co-hosts who are no longer in your teams to save changes to co-hosts.",
      ];
    if (teamId && !inTeam(hosts.map((h) => h.user_id)))
      return ["cohosts", "Co-hosts of a team page must be in the team."];
    return null;
  };
  const problem = findProblem();

  const sectionProps = (id: SectionId) => ({
    open: openIds.includes(id),
    onOpenChange: (open: boolean) =>
      setOpenIds((ids) => (open ? [...ids, id] : ids.filter((x) => x !== id))),
    onLayout: (e: { nativeEvent: { layout: { y: number } } }) => {
      offsets.current[id] = e.nativeEvent.layout.y;
    },
  });

  /** Open the section with the problem and scroll up to it. */
  const reveal = (id: SectionId) => {
    animateLayout();
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setTimeout(() => {
      scroller.current?.scrollTo({
        y: Math.max(0, columnY.current + (offsets.current[id] ?? 0) - 8),
        animated: true,
      });
    }, 60);
  };

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
        slug: cleanSlug,
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
        // Only when changed: a co-host who left your teams would otherwise
        // block every save.
        ...(hostsChanged ? { co_hosts: hosts } : {}),
        color: color.toLowerCase(),
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
        assignment,
        requires_approval: approval,
        allow_reschedule: reschedule,
        event_title: eventTitle.trim(),
        confirmation_message: confirmation.trim(),
        team_id: teamId,
        remind_before_minutes: reminders,
      };
      const next = saved
        ? await client.updateBookingPage(saved.id, body)
        : await client.createBookingPage(body);
      animateLayout();
      setSaved(next);
      setSavedHostsKey(hostsKey(coHostsOf(next)));
      setSlug(next.slug);
      setQuestions(withIds);
      setTried(false);
      onSaved(next);
    });

  const trySave = () => {
    if (problem) {
      setTried(true);
      reveal(problem[0]);
      return;
    }
    void save();
  };

  const link = bookingLink(saved?.slug ?? cleanSlug);
  // Everyone you can pick, plus saved co-hosts who aren't in your teams.
  const candidates = [
    ...people
      .filter((p) => inTeam([p.user_id]))
      .map((p) => ({
        user_id: p.user_id,
        name: p.name,
        email: p.email,
      })),
    ...(page?.hosts ?? [])
      .filter(
        (h) =>
          h.user_id !== ownerId && !people.some((p) => p.user_id === h.user_id),
      )
      .map((h) => ({ user_id: h.user_id, name: h.name, email: "" })),
  ];
  const nameOf = (id: string) =>
    candidates.find((p) => p.user_id === id)?.name ?? "Teammate";
  const hostsFull = hosts.length >= MAX_HOSTS;
  const intervals = withValue([...SLOT_INTERVALS], slotInterval);
  const counts = saved?.counts;
  const hexOk = HEX.test(color);
  const accent = hexOk ? readableAccent(color) : null;
  const light = hexOk && accent !== color.toLowerCase();
  const titlePreview = eventTitlePreview(eventTitle, title).trim();

  return (
    <ScrollView
      ref={scroller}
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View
        style={sheetStyles.column}
        onLayout={(e) => {
          columnY.current = e.nativeEvent.layout.y;
        }}
      >
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

        <Section
          title="Basics"
          summary={title.trim()}
          {...sectionProps("basics")}
        >
          {ownerOptions.length > 1 && (
            <Field
              label="Whose page"
              hint={
                teamId
                  ? "Everyone in the team sees it; its owners and admins can change it. Co-hosts come from the team."
                  : "Only you can change it."
              }
            >
              <Segmented
                wrap
                accessibilityLabel="Whose page"
                options={ownerOptions}
                labels={ownerLabels}
                value={teamId ?? ME}
                onChange={(v) => setTeamId(v === ME ? null : v)}
              />
            </Field>
          )}
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
            {!!cleanSlug && !SLUG.test(cleanSlug) && (
              <Text style={[shared.small, bs.warn, bs.top]}>
                Use lowercase letters and numbers, with single dashes between
                words.
              </Text>
            )}
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
            {!!meetingUrl.trim() && !MEETING_URL.test(meetingUrl.trim()) && (
              <Text style={[shared.small, bs.warn, bs.top]}>
                Meeting links start with https://.
              </Text>
            )}
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
          {...sectionProps("availability")}
        >
          <AvailabilityEditor
            availability={availability}
            onChange={changeAvailability}
            kept={kept}
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
          {...sectionProps("scheduling")}
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
            <PresetMinutes
              label="Free time before each booking"
              presets={BUFFERS}
              value={before}
              onChange={setBefore}
              max={MAX_BUFFER}
            />
          </Field>
          <Field label="Free time after each booking">
            <PresetMinutes
              label="Free time after each booking"
              presets={BUFFERS}
              value={after}
              onChange={setAfter}
              max={MAX_BUFFER}
            />
          </Field>
          <Field label="Notice needed">
            <PresetMinutes
              label="Notice needed"
              presets={NOTICE}
              value={notice}
              onChange={setNotice}
              max={MAX_NOTICE}
            />
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
          {...sectionProps("questions")}
        >
          <QuestionsEditor questions={questions} onChange={setQuestions} />
        </Section>

        <Section
          title="Confirmation"
          summary={[
            approval ? "You approve each request" : "Booked right away",
            reschedule ? "people can move bookings" : "no moving bookings",
          ].join(" · ")}
          {...sectionProps("confirmation")}
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
            hint="{page} is this page’s title; {name} and {email} are the booker’s."
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
            <View style={s.inserts}>
              {PLACEHOLDERS.map((p) => (
                <SmallAction
                  key={p}
                  label={p}
                  disabled={eventTitle.length + p.length >= 200}
                  onPress={() => setEventTitle(`${eventTitle} ${p}`.trim())}
                />
              ))}
            </View>
            <Text
              style={[shared.small, bs.top]}
              accessibilityLiveRegion="polite"
            >
              Looks like: <Text style={s.strong}>{titlePreview || "–"}</Text>
            </Text>
          </Field>
          <Field
            label="Message after booking (optional)"
            hint={`Shown once they book and in their confirmation email. ${confirmation.length}/${MAX_CONFIRMATION}`}
            style={bs.last}
          >
            <TextInput
              style={[shared.input, bs.multiline]}
              value={confirmation}
              onChangeText={setConfirmation}
              maxLength={MAX_CONFIRMATION}
              multiline
              textAlignVertical="top"
              placeholder="Thanks! Bring any questions you have."
              placeholderTextColor={colors.faint}
              accessibilityLabel="Message after booking"
            />
          </Field>
        </Section>

        <Section
          title="Reminders"
          summary={
            reminders.length
              ? `Emailed ${reminders.map(reminderLabel).join(" and ")} before`
              : "No reminder emails"
          }
          {...sectionProps("reminders")}
        >
          <Text style={[shared.small, bs.gap]}>
            People who book get an email before the meeting with a link to move
            or cancel it.
          </Text>
          <ReminderChips value={reminders} onChange={setReminders} />
        </Section>

        <Section title="Colour" summary={color} {...sectionProps("colour")}>
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
                { backgroundColor: hexOk ? color : colors.surface },
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
          <Text style={[shared.label, s.previewLabel]}>Button preview</Text>
          <View
            style={[
              s.bookButton,
              { backgroundColor: accent ?? colors.surfaceMuted },
            ]}
            accessible
            accessibilityLabel={`Booking page button in ${accent ?? "no colour yet"}`}
          >
            <Text style={s.bookButtonText}>Book this time</Text>
          </View>
          {light && (
            <Text style={[shared.small, s.lightNote]}>
              This colour is light, so the booking page uses a darker shade (
              {accent}) for buttons and links to keep them readable.
            </Text>
          )}
        </Section>

        <Section
          title="Co-hosts"
          summary={
            hosts.length
              ? hosts.map((h) => nameOf(h.user_id)).join(", ")
              : "Just you"
          }
          {...sectionProps("cohosts")}
        >
          <Text style={[shared.small, bs.gap]}>
            Only times when every required host is free are offered. Optional
            hosts join when they can. Up to {MAX_HOSTS} co-hosts.
          </Text>
          {hosts.length > 0 && (
            <View style={bs.gap}>
              <Text style={shared.label}>How bookings are shared</Text>
              <Segmented
                accessibilityLabel="How bookings are shared"
                options={["collective", "round_robin"] as const}
                labels={{
                  collective: "Everyone",
                  round_robin: "Round-robin",
                }}
                value={assignment}
                onChange={setAssignment}
              />
              <Text style={shared.small}>
                {assignment === "round_robin"
                  ? "A time is offered when any host is free; each booking goes to the host with the fewest so far."
                  : "A time is offered only when every required host is free."}
              </Text>
            </View>
          )}
          {candidates.length === 0 ? (
            <Text style={shared.small}>
              People in your teams can host with you. Join or make a team to add
              co-hosts.
            </Text>
          ) : (
            <View style={s.hostList}>
              {candidates.map((p, n) => {
                const host = hosts.find((h) => h.user_id === p.user_id);
                const blocked = !host && hostsFull;
                return (
                  <View key={p.user_id} style={n > 0 && bs.divider}>
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityLabel={
                        p.email ? `${p.name}, ${p.email}` : p.name
                      }
                      accessibilityState={{
                        checked: !!host,
                        disabled: blocked,
                      }}
                      disabled={blocked}
                      onPress={() => {
                        animateLayout();
                        setHosts(
                          host
                            ? hosts.filter((h) => h.user_id !== p.user_id)
                            : [
                                ...hosts,
                                { user_id: p.user_id, required: true },
                              ],
                        );
                      }}
                      style={({ pressed }) => [
                        s.hostMain,
                        pressed && bs.pressed,
                        blocked && s.blocked,
                      ]}
                    >
                      <View style={[s.check, !!host && s.checkOn]}>
                        {!!host && (
                          <Icon name="check" size={14} color={colors.white} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={bs.rowTitle} numberOfLines={1}>
                          {p.name}
                        </Text>
                        {!!p.email && (
                          <Text style={shared.small} numberOfLines={1}>
                            {p.email}
                          </Text>
                        )}
                        {staleHosts.has(p.user_id) && (
                          <Text style={[shared.small, bs.warn]}>
                            No longer in your teams — remove to save changes to
                            co-hosts
                          </Text>
                        )}
                      </View>
                    </Pressable>
                    {host && (
                      <View style={s.required}>
                        <Text style={[shared.small, { flex: 1 }]}>
                          {host.required
                            ? "Must be free for a time to be offered"
                            : "Optional: joins when free"}
                        </Text>
                        <Switch
                          value={host.required}
                          trackColor={{ true: colors.accent }}
                          accessibilityLabel={`${p.name} must be free`}
                          onValueChange={(required) =>
                            setHosts(
                              hosts.map((x) =>
                                x.user_id === p.user_id
                                  ? { ...x, required }
                                  : x,
                              ),
                            )
                          }
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          {hostsFull && (
            <Text style={[shared.small, bs.top]}>
              That’s the most co-hosts a page can have.
            </Text>
          )}
        </Section>

        {!!problem && (
          <Text
            style={[shared.small, s.problem, tried && bs.warn]}
            accessibilityLiveRegion="polite"
          >
            {problem[1]}
          </Text>
        )}
        <Button
          title={busy ? "Saving…" : saved ? "Save changes" : "Create page"}
          icon="check"
          disabled={busy || !durations.length}
          onPress={trySave}
        />

        {saved && canEditPage(saved, user?.id) && (
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
    previewLabel: { marginTop: 16 },
    bookButton: {
      alignSelf: "flex-start",
      borderRadius: radii.input,
      paddingVertical: 12,
      paddingHorizontal: 18,
    },
    bookButtonText: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.white,
    },
    lightNote: { marginTop: 10, color: colors.warning },
    inserts: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginTop: 10,
    },
    strong: { fontFamily: fonts.semibold, color: colors.text },
    hostList: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      overflow: "hidden",
    },
    hostMain: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    blocked: { opacity: 0.45 },
    check: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    required: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingLeft: 46,
      paddingRight: 12,
      paddingBottom: 10,
    },
    problem: { textAlign: "center", marginBottom: 10 },
  }),
);
