import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Switch } from "../components/Switch";
import {
  CALENDAR_KINDS,
  CALENDAR_KIND_DEFAULTS,
  CALENDAR_REMINDER_CHOICES,
  guessCalendarKind,
  reminderLabel,
  type CalendarFeedSettings,
  type CalendarKind,
  type CalendarSubscription,
} from "@orbyn/core";
import { Chip, ChipRow } from "../components/Chip";
import { confirmAction } from "../lib/confirm";
import { Button } from "../components/Button";
import { ErrorBanner } from "../components/ErrorBanner";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { LIST_COLORS, shareText } from "../lib/planning";
import { timeAgo } from "../lib/progress";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/**
 * Your calendar feed: a private link with everything, and a busy-only link
 * safe to share. Links are only shown when made, so a new one replaces the
 * old. The share sheet includes Copy.
 */
export function CalendarFeedCard() {
  const { busy, error, setError, run } = useRun();
  const [settings, setSettings] = useState<CalendarFeedSettings | null>(null);
  const [links, setLinks] = useState<{ full?: string; busy?: string }>({});

  useEffect(() => {
    void run(async () => setSettings(await client.calendarFeedSettings()));
  }, [run]);

  const make = (busyOnly: boolean) =>
    run(async () => {
      const made = await client.createCalendarFeed({ busy: busyOnly });
      animateLayout();
      setLinks((l) => ({ ...l, [busyOnly ? "busy" : "full"]: made.url }));
      setSettings(
        (s) => s && { ...s, [busyOnly ? "busy_enabled" : "enabled"]: true },
      );
    });
  const turnOff = (busyOnly: boolean) =>
    Alert.alert(
      busyOnly ? "Turn off the busy-only link?" : "Turn off the calendar feed?",
      "Calendars subscribed to the link stop updating.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn off",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              await client.deleteCalendarFeed({ busy: busyOnly });
              animateLayout();
              setLinks((l) => ({ ...l, [busyOnly ? "busy" : "full"]: "" }));
              setSettings(
                (s) =>
                  s && {
                    ...s,
                    [busyOnly ? "busy_enabled" : "enabled"]: false,
                  },
              );
            }),
        },
      ],
    );

  return (
    <>
      <Text style={[shared.eyebrow, s.eyebrow]}>CALENDAR FEED</Text>
      <View style={shared.card}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.small, s.gap]}>
          Subscribe from Apple Calendar, Google Calendar or Outlook with a
          private link.
        </Text>
        <FeedLink
          title="Everything"
          detail="Your events and tasks with their details. Keep this link to yourself."
          on={!!settings?.enabled}
          url={links.full}
          busy={busy}
          onMake={() => void make(false)}
          onOff={() => turnOff(false)}
        />
        <View style={s.divider} />
        <FeedLink
          title="Busy times only"
          detail="Just “Busy” times, with no details. Safe to share with others."
          on={!!settings?.busy_enabled}
          url={links.busy}
          busy={busy}
          onMake={() => void make(true)}
          onOff={() => turnOff(true)}
        />
        <View style={s.divider} />
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Include sessions</Text>
            <Text style={shared.small}>Sessions show as “Focus: task”.</Text>
          </View>
          <Switch
            value={!!settings?.include_blocks}
            disabled={busy || !settings}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Include sessions in the feed"
            onValueChange={(include_blocks) =>
              void run(async () =>
                setSettings(
                  await client.updateCalendarFeedSettings({ include_blocks }),
                ),
              )
            }
          />
        </View>
      </View>
    </>
  );
}

function FeedLink({
  title,
  detail,
  on,
  url,
  busy,
  onMake,
  onOff,
}: {
  title: string;
  detail: string;
  on: boolean;
  /** Only known right after the link is made. */
  url?: string;
  busy: boolean;
  onMake: () => void;
  onOff: () => void;
}) {
  return (
    <View>
      <Text style={s.title}>{title}</Text>
      <Text style={[shared.small, s.gap]}>{detail}</Text>
      {!!url && (
        <FadeIn style={s.secret}>
          <Text selectable style={s.code}>
            {url}
          </Text>
          <Button
            title="Share or copy link"
            icon="share"
            style={s.last}
            onPress={() => void shareText(url)}
          />
        </FadeIn>
      )}
      {on && !url && (
        <Text style={[shared.small, s.gap]}>
          The link is on. It’s only shown when it’s made; make a new one to see
          it again (the old one stops working).
        </Text>
      )}
      <View style={s.actions}>
        <Button
          secondary={on}
          title={on ? "New link" : "Create link"}
          icon="link"
          disabled={busy}
          style={s.flex}
          onPress={onMake}
        />
        {on && (
          <Button
            destructive
            title="Turn off"
            disabled={busy}
            style={s.flex}
            onPress={onOff}
          />
        )}
      </View>
    </View>
  );
}

/** http, https or webcal, like the server. */
const isCalendarLink = (url: string) => /^(https?|webcal):\/\/\S+$/i.test(url);

type SubSettings = Pick<
  CalendarSubscription,
  "kind" | "busy" | "all_day_busy" | "visible" | "sharing" | "reminder_minutes"
>;

const presetOf = (kind: CalendarKind): SubSettings => {
  const d = CALENDAR_KIND_DEFAULTS[kind];
  return {
    kind,
    busy: d.busy,
    all_day_busy: d.all_day_busy,
    visible: true,
    sharing: d.sharing,
    reminder_minutes: d.reminder_minutes,
  };
};

/** "Classes · Busy · Reminds 10 minutes before". */
const summaryOf = (x: SubSettings) =>
  [
    CALENDAR_KIND_DEFAULTS[x.kind].label,
    x.busy
      ? x.all_day_busy
        ? "Busy, all-day blocks the day"
        : "Busy"
      : "Not busy",
    x.reminder_minutes != null
      ? `Reminds ${reminderLabel(x.reminder_minutes)}`
      : "",
    x.sharing === "hidden" ? "Kept from teammates" : "",
    x.visible ? "" : "Hidden",
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * A subscribed calendar's settings, the same as the desktop's: what it
 * holds (picking one applies its defaults), then each setting on its own.
 */
function SettingsFields({
  value,
  disabled,
  onChange,
}: {
  value: SubSettings;
  disabled: boolean;
  onChange: (next: SubSettings) => void;
}) {
  const row = (
    label: string,
    hint: string,
    on: boolean,
    set: (v: boolean) => void,
    off = false,
  ) => (
    <View style={s.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.switchLabel}>{label}</Text>
        <Text style={shared.small}>{hint}</Text>
      </View>
      <Switch
        value={on}
        disabled={disabled || off}
        trackColor={{ true: colors.accent }}
        accessibilityLabel={label}
        onValueChange={set}
      />
    </View>
  );
  return (
    <View style={s.settings}>
      <Text style={shared.label}>What&apos;s in it</Text>
      <ChipRow label="What's in it">
        {CALENDAR_KINDS.map((k) => (
          <Chip
            key={k}
            label={CALENDAR_KIND_DEFAULTS[k].label}
            selected={value.kind === k}
            disabled={disabled}
            onPress={() => onChange({ ...presetOf(k), visible: value.visible })}
          />
        ))}
      </ChipRow>
      <Text style={shared.small}>
        {CALENDAR_KIND_DEFAULTS[value.kind].hint}
      </Text>
      {row(
        "Counts as busy",
        "The planner, booking pages and teammates work around it.",
        value.busy,
        (busy) => onChange({ ...value, busy }),
      )}
      {row(
        "All-day events block the day",
        "For exam days and leave. Public holidays usually don't.",
        value.all_day_busy,
        (all_day_busy) => onChange({ ...value, all_day_busy }),
        !value.busy,
      )}
      {row(
        "Show on my calendar",
        "Hidden calendars still count as busy.",
        value.visible,
        (visible) => onChange({ ...value, visible }),
      )}
      <Text style={shared.label}>Teammates see</Text>
      <ChipRow label="Teammates see">
        <Chip
          label="When I'm busy"
          selected={value.sharing === "busy"}
          disabled={disabled}
          onPress={() => onChange({ ...value, sharing: "busy" })}
        />
        <Chip
          label="Nothing"
          selected={value.sharing === "hidden"}
          disabled={disabled}
          onPress={() => onChange({ ...value, sharing: "hidden" })}
        />
      </ChipRow>
      <Text style={shared.label}>Reminders</Text>
      <ChipRow label="Reminders">
        {CALENDAR_REMINDER_CHOICES.map((m) => (
          <Chip
            key={String(m)}
            label={m == null ? "None" : reminderLabel(m).replace(" before", "")}
            selected={value.reminder_minutes === m}
            disabled={disabled}
            onPress={() => onChange({ ...value, reminder_minutes: m })}
          />
        ))}
      </ChipRow>
    </View>
  );
}

/**
 * Calendars you subscribe to by link: a class timetable, exams, shifts,
 * meetings, public holidays. Each kind starts with sensible settings; their
 * events show on your calendar, read-only.
 */
export function SubscriptionsCard() {
  const { busy, error, setError, run } = useRun();
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LIST_COLORS[2]);
  const [draft, setDraft] = useState<SubSettings>(presetOf("other"));
  const [kindPicked, setKindPicked] = useState(false);
  const [note, setNote] = useState("");

  const load = async () => setSubs(await client.listCalendarSubscriptions());
  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const replace = (next: CalendarSubscription) =>
    setSubs((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null);
  const create = () =>
    run(async () => {
      const made = await client.createCalendarSubscription({
        url: url.trim(),
        name: name.trim(),
        color,
        ...draft,
      });
      animateLayout();
      setAdding(false);
      setUrl("");
      setName("");
      setDraft(presetOf("other"));
      setKindPicked(false);
      setNote(
        made.last_error
          ? `Added, but it couldn't be read yet: ${made.last_error}`
          : `Added ${made.name} · ${made.event_count} event${made.event_count === 1 ? "" : "s"}.`,
      );
      await load();
    });
  const change = (sub: CalendarSubscription, next: SubSettings) =>
    run(async () =>
      replace(await client.updateCalendarSubscription(sub.id, next)),
    );
  const remove = (sub: CalendarSubscription) =>
    confirmAction(
      `Remove ${sub.name}?`,
      "Its events leave your calendar.",
      "Remove",
      () =>
        void run(async () => {
          await client.deleteCalendarSubscription(sub.id);
          animateLayout();
          await load();
        }),
    );

  return (
    <>
      <Text style={[shared.eyebrow, s.eyebrow]}>SUBSCRIBED CALENDARS</Text>
      <View style={shared.card}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.small, s.gap]}>
          Add calendars from other apps by their link: a class timetable, exams,
          work shifts, meetings, public holidays. Orbyn reads each one straight
          away and every hour after. Their events are read-only.
        </Text>
        {!!note && <Text style={[shared.small, s.gap]}>{note}</Text>}
        {subs === null && (
          <Text style={shared.small}>{busy ? "Loading…" : ""}</Text>
        )}
        {subs?.map((sub, n) => (
          <View key={sub.id} style={[s.sub, n > 0 && s.divider]}>
            <View style={s.subTop}>
              <View
                style={[
                  s.dot,
                  { backgroundColor: sub.color },
                  !sub.visible && s.faded,
                ]}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>
                  {sub.name}
                </Text>
                <Text style={shared.small} numberOfLines={2}>
                  {summaryOf(sub)}
                </Text>
              </View>
            </View>
            <Text style={[shared.small, s.subMeta]}>
              {sub.last_fetched_at
                ? `${sub.event_count} event${sub.event_count === 1 ? "" : "s"} · updated ${timeAgo(sub.last_fetched_at)}`
                : "Not fetched yet"}
            </Text>
            {!!sub.last_error && (
              <Text style={[shared.small, s.problem]} accessibilityRole="alert">
                {sub.last_error}
              </Text>
            )}
            {open === sub.id && (
              <FadeIn>
                <SettingsFields
                  value={sub}
                  disabled={busy}
                  onChange={(next) => void change(sub, next)}
                />
              </FadeIn>
            )}
            <View style={s.subActions}>
              <SmallAction
                label={open === sub.id ? "Done" : "Settings"}
                disabled={false}
                onPress={() => {
                  animateLayout();
                  setOpen(open === sub.id ? null : sub.id);
                }}
              />
              <SmallAction
                label={sub.visible ? "Hide" : "Show"}
                disabled={busy}
                onPress={() =>
                  void change(sub, { ...sub, visible: !sub.visible })
                }
              />
              <SmallAction
                label="Refresh"
                disabled={busy}
                onPress={() =>
                  void run(async () =>
                    replace(await client.refreshCalendarSubscription(sub.id)),
                  )
                }
              />
              <SmallAction
                label="Remove"
                disabled={busy}
                onPress={() => remove(sub)}
              />
            </View>
          </View>
        ))}
        {adding ? (
          <FadeIn style={[s.form, !!subs?.length && s.divider]}>
            <Field label="Link">
              <TextInput
                style={shared.input}
                value={url}
                onChangeText={setUrl}
                placeholder="webcal://…"
                placeholderTextColor={colors.faint}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={1000}
                accessibilityLabel="Calendar link"
              />
            </Field>
            <Field label="Name">
              <TextInput
                style={shared.input}
                value={name}
                onChangeText={(next) => {
                  setName(next);
                  // Until a kind is picked by hand, the name suggests one.
                  if (!kindPicked) {
                    const guess = guessCalendarKind(next);
                    if (guess !== draft.kind)
                      setDraft({ ...presetOf(guess), visible: draft.visible });
                  }
                }}
                placeholder="e.g. Uni timetable"
                placeholderTextColor={colors.faint}
                maxLength={80}
                accessibilityLabel="Calendar name"
              />
            </Field>
            <Field label="Colour">
              <View
                style={s.swatches}
                accessibilityRole="radiogroup"
                accessibilityLabel="Calendar colour"
              >
                {LIST_COLORS.map((c, n) => (
                  <Pressable
                    key={c}
                    accessibilityRole="radio"
                    accessibilityLabel={`Colour ${n + 1} of ${LIST_COLORS.length}`}
                    accessibilityState={{ checked: color === c }}
                    hitSlop={4}
                    onPress={() => setColor(c)}
                    style={[s.swatch, { backgroundColor: c }]}
                  >
                    {color === c && (
                      <Icon
                        name="check"
                        size={14}
                        color={colors.white}
                        strokeWidth={3}
                      />
                    )}
                  </Pressable>
                ))}
              </View>
            </Field>
            <SettingsFields
              value={draft}
              disabled={busy}
              onChange={(next) => {
                if (next.kind !== draft.kind) setKindPicked(true);
                setDraft(next);
              }}
            />
            {!!url.trim() && !isCalendarLink(url.trim()) && (
              <Text style={[shared.small, s.problem, s.gap]}>
                Calendar links start with https://, http:// or webcal://.
              </Text>
            )}
            <View style={s.actions}>
              <Button
                title={busy ? "Reading it…" : "Subscribe"}
                icon="check"
                disabled={busy || !isCalendarLink(url.trim()) || !name.trim()}
                style={s.flex}
                onPress={() => void create()}
              />
              <Button
                secondary
                title="Cancel"
                style={s.flex}
                onPress={() => setAdding(false)}
              />
            </View>
          </FadeIn>
        ) : (
          <Button
            secondary
            title="Add a calendar"
            icon="plus"
            disabled={busy || (subs?.length ?? 0) >= 20}
            style={[s.last, !!subs?.length && s.addTop]}
            onPress={() => {
              animateLayout();
              setNote("");
              setAdding(true);
            }}
          />
        )}
      </View>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    eyebrow: { marginTop: 8 },
    gap: { marginBottom: 12 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      marginTop: 14,
      paddingTop: 14,
    },
    title: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    secret: {
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 12,
    },
    code: {
      fontFamily: "Menlo",
      fontSize: 13,
      color: colors.text,
      backgroundColor: colors.surface,
      borderRadius: 8,
      padding: 10,
      marginBottom: 10,
    },
    actions: { flexDirection: "row", gap: 10 },
    flex: { flex: 1, marginBottom: 0 },
    last: { marginBottom: 0 },
    addTop: { marginTop: 14 },
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    switchLabel: {
      fontFamily: fonts.medium,
      fontSize: 14,
      color: colors.text,
    },
    sub: { gap: 8 },
    subTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    subMeta: { marginLeft: 20 },
    subActions: { flexDirection: "row", gap: 8 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    problem: { color: colors.danger },
    form: {},
    swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    settings: { gap: 12, marginTop: 12, marginBottom: 12 },
    faded: { opacity: 0.45 },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
