import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CalendarFeedSettings, CalendarSubscription } from "@orbyn/core";
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
          detail="Just “Busy” blocks, with no details. Safe to share with others."
          on={!!settings?.busy_enabled}
          url={links.busy}
          busy={busy}
          onMake={() => void make(true)}
          onOff={() => turnOff(true)}
        />
        <View style={s.divider} />
        <View style={s.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Include time blocks</Text>
            <Text style={shared.small}>
              Time set aside for tasks shows as “Focus: task”.
            </Text>
          </View>
          <Switch
            value={!!settings?.include_blocks}
            disabled={busy || !settings}
            trackColor={{ true: colors.accent }}
            accessibilityLabel="Include time blocks in the feed"
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

const isCalendarLink = (url: string) => /^(https|webcal):\/\/\S+$/i.test(url);

/**
 * Calendars you subscribe to by link (timetables, public holidays, a work
 * calendar). Their events show on your calendar, read-only; they count as
 * busy only when you say so.
 */
export function SubscriptionsCard() {
  const { busy, error, setError, run } = useRun();
  const [subs, setSubs] = useState<CalendarSubscription[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LIST_COLORS[2]);
  const [counts, setCounts] = useState(false);

  const load = async () => setSubs(await client.listCalendarSubscriptions());
  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const replace = (next: CalendarSubscription) =>
    setSubs((list) => list?.map((x) => (x.id === next.id ? next : x)) ?? null);
  const create = () =>
    run(async () => {
      await client.createCalendarSubscription({
        url: url.trim(),
        name: name.trim(),
        color,
        busy: counts,
      });
      animateLayout();
      setAdding(false);
      setUrl("");
      setName("");
      setCounts(false);
      await load();
    });
  const remove = (sub: CalendarSubscription) =>
    Alert.alert(`Remove ${sub.name}?`, "Its events leave your calendar.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            await client.deleteCalendarSubscription(sub.id);
            animateLayout();
            await load();
          }),
      },
    ]);

  return (
    <>
      <Text style={[shared.eyebrow, s.eyebrow]}>SUBSCRIBED CALENDARS</Text>
      <View style={shared.card}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.small, s.gap]}>
          Add any calendar link (https:// or webcal://) that anyone can reach.
          Its events show on your calendar, read-only, and refresh every hour.
        </Text>
        {subs === null && (
          <Text style={shared.small}>{busy ? "Loading…" : ""}</Text>
        )}
        {subs?.map((sub, n) => (
          <View key={sub.id} style={[s.sub, n > 0 && s.divider]}>
            <View style={s.subTop}>
              <View style={[s.dot, { backgroundColor: sub.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.title} numberOfLines={1}>
                  {sub.name}
                </Text>
                <Text style={shared.small} numberOfLines={1}>
                  {sub.url}
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
            <View style={s.switchRow}>
              <Text style={[s.switchLabel, { flex: 1 }]}>Counts as busy</Text>
              <Switch
                value={sub.busy}
                disabled={busy}
                trackColor={{ true: colors.accent }}
                accessibilityLabel={`${sub.name} counts as busy`}
                onValueChange={(value) =>
                  void run(async () =>
                    replace(
                      await client.updateCalendarSubscription(sub.id, {
                        busy: value,
                      }),
                    ),
                  )
                }
              />
            </View>
            <View style={s.subActions}>
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
                maxLength={2000}
                accessibilityLabel="Calendar link"
              />
            </Field>
            <Field label="Name">
              <TextInput
                style={shared.input}
                value={name}
                onChangeText={setName}
                placeholder="Public holidays"
                placeholderTextColor={colors.faint}
                maxLength={60}
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
            <View style={[s.switchRow, s.gap]}>
              <View style={{ flex: 1 }}>
                <Text style={s.switchLabel}>Counts as busy</Text>
                <Text style={shared.small}>
                  Blocks your planner, booking pages and teammates’ meeting
                  times. All-day and free events never do.
                </Text>
              </View>
              <Switch
                value={counts}
                trackColor={{ true: colors.accent }}
                accessibilityLabel="Counts as busy"
                onValueChange={setCounts}
              />
            </View>
            {!!url.trim() && !isCalendarLink(url.trim()) && (
              <Text style={[shared.small, s.problem, s.gap]}>
                Calendar links start with https:// or webcal://.
              </Text>
            )}
            <View style={s.actions}>
              <Button
                title="Subscribe"
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
    swatch: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
