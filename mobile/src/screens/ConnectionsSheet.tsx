import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  WEBHOOK_EVENTS,
  type ApiKey,
  type Webhook,
  type WebhookEvent,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { Pill } from "../components/Pill";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { client } from "../lib/api";
import { shareText } from "../lib/planning";
import { timeAgo } from "../lib/progress";
import { useRun } from "../hooks/useRun";
import { CalendarFeedCard, SubscriptionsCard } from "./CalendarLinks";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "item.created": "Item created",
  "item.updated": "Item updated",
  "item.completed": "Item completed",
  "item.deleted": "Item deleted",
  "block.scheduled": "Time scheduled",
  "booking.requested": "Booking requested",
  "booking.confirmed": "Booking confirmed",
  "booking.rescheduled": "Booking moved",
  "booking.cancelled": "Booking cancelled or declined",
  "event.starting": "An event is about to start",
  "block.started": "A time block starts",
  "task.at_risk": "A task is at risk",
};

/**
 * Settings → Connections: API keys, webhooks, your calendar feed links and
 * the calendars you subscribe to.
 * Secrets are shown once, when they're made.
 */
export function ConnectionsSheet({
  visible,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Connections"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body />
    </Sheet>
  );
}

function Body() {
  const { busy, error, setError, run } = useRun();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(
    null,
  );
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([
    "item.created",
    "item.updated",
    "item.completed",
  ]);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(
    null,
  );
  const [tests, setTests] = useState<Record<string, string>>({});

  useEffect(() => {
    void run(async () => {
      const [k, h] = await Promise.all([
        client.listApiKeys(),
        client.listWebhooks(),
      ]);
      setKeys(k);
      setHooks(h);
    });
  }, [run]);

  const reloadHooks = async () => setHooks(await client.listWebhooks());

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <View style={[shared.softCard, s.privacy]}>
          <Icon name="shieldCheck" size={18} color={colors.accent} />
          <Text style={[shared.body, { flex: 1 }]}>
            Your data stays on this server. It only goes to the apps and
            addresses you connect here, and you can turn each one off at any
            time.
          </Text>
        </View>

        {/* API keys */}
        <Text style={[shared.eyebrow, s.eyebrow]}>API KEYS</Text>
        <View style={shared.card}>
          <Text style={[shared.small, s.gap]}>
            Let scripts and other apps use Orbyn as you. Treat a key like a
            password.
          </Text>
          {newKey && (
            <FadeIn style={s.secret}>
              <Text style={shared.label}>
                {newKey.name}: copy it now, it won’t be shown again
              </Text>
              <Text selectable style={s.code}>
                {newKey.key}
              </Text>
              <View style={s.actions}>
                <Button
                  title="Copy or share"
                  icon="share"
                  style={s.flex}
                  onPress={() => void shareText(newKey.key)}
                />
                <Button
                  secondary
                  title="Done"
                  style={s.flex}
                  onPress={() => setNewKey(null)}
                />
              </View>
            </FadeIn>
          )}
          {keys.map((k) => (
            <View key={k.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{k.name}</Text>
                <Text style={shared.small}>
                  {k.prefix}… · Made {timeAgo(k.created_at)} ·{" "}
                  {k.last_used_at
                    ? `Used ${timeAgo(k.last_used_at)}`
                    : "Not used yet"}
                </Text>
              </View>
              <SmallAction
                destructive
                label="Delete"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    `Delete ${k.name}?`,
                    "Anything using this key stops working.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () =>
                          void run(async () => {
                            await client.deleteApiKey(k.id);
                            animateLayout();
                            setKeys(await client.listApiKeys());
                          }),
                      },
                    ],
                  )
                }
              />
            </View>
          ))}
          <Field label="New key" style={s.formTop}>
            <TextInput
              style={shared.input}
              value={keyName}
              onChangeText={setKeyName}
              maxLength={80}
              placeholder="What it’s for, like “Shortcuts”"
              placeholderTextColor={colors.faint}
              accessibilityLabel="API key name"
            />
          </Field>
          <Button
            title="Create key"
            icon="key"
            style={s.last}
            disabled={busy || !keyName.trim()}
            onPress={() =>
              void run(async () => {
                const made = await client.createApiKey(keyName.trim());
                animateLayout();
                setNewKey({ name: made.name, key: made.key });
                setKeyName("");
                setKeys(await client.listApiKeys());
              })
            }
          />
        </View>

        {/* Webhooks */}
        <Text style={[shared.eyebrow, s.eyebrow]}>WEBHOOKS</Text>
        <View style={shared.card}>
          <Text style={[shared.small, s.gap]}>
            Orbyn posts to your URL when these things happen. Each delivery is
            signed with the webhook’s secret.
          </Text>
          {secret && (
            <FadeIn style={s.secret}>
              <Text style={shared.label}>
                Signing secret: copy it now, it won’t be shown again
              </Text>
              <Text selectable style={s.code}>
                {secret.secret}
              </Text>
              <View style={s.actions}>
                <Button
                  title="Copy or share"
                  icon="share"
                  style={s.flex}
                  onPress={() => void shareText(secret.secret)}
                />
                <Button
                  secondary
                  title="Done"
                  style={s.flex}
                  onPress={() => setSecret(null)}
                />
              </View>
            </FadeIn>
          )}
          {hooks.map((h) => (
            <View key={h.id} style={s.hook}>
              <View style={s.hookTop}>
                <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>
                  {h.url}
                </Text>
                <Switch
                  value={h.active}
                  disabled={busy}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel={`Send to ${h.url}`}
                  onValueChange={(active) =>
                    void run(async () => {
                      await client.updateWebhook(h.id, { active });
                      await reloadHooks();
                    })
                  }
                />
              </View>
              <Text style={shared.small}>
                {h.events.map((e) => EVENT_LABELS[e]).join(", ")}
              </Text>
              <View style={s.status}>
                {h.last_status !== null ? (
                  <Pill
                    label={`Last delivery ${h.last_status}`}
                    tone={
                      h.last_status >= 200 && h.last_status < 300
                        ? "accent"
                        : "danger"
                    }
                  />
                ) : (
                  <Pill label="No deliveries yet" />
                )}
                {!!h.last_delivered_at && (
                  <Text style={shared.small}>
                    {timeAgo(h.last_delivered_at)}
                  </Text>
                )}
              </View>
              {!!h.last_error && (
                <Text style={[shared.small, s.error]}>{h.last_error}</Text>
              )}
              {!!tests[h.id] && (
                <Text style={[shared.small, s.test]} accessibilityRole="alert">
                  {tests[h.id]}
                </Text>
              )}
              <View style={s.actions}>
                <SmallAction
                  label="Send test"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      const r = await client.testWebhook(h.id);
                      setTests((t) => ({
                        ...t,
                        [h.id]: r.ok
                          ? `Test delivered (${r.status}).`
                          : `Test failed${r.status ? ` (${r.status})` : ""}${r.error ? `: ${r.error}` : "."}`,
                      }));
                      await reloadHooks();
                    })
                  }
                />
                <SmallAction
                  destructive
                  label="Delete"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert("Delete this webhook?", h.url, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () =>
                          void run(async () => {
                            await client.deleteWebhook(h.id);
                            animateLayout();
                            await reloadHooks();
                          }),
                      },
                    ])
                  }
                />
              </View>
            </View>
          ))}
          <Field label="New webhook URL" style={s.formTop}>
            <TextInput
              style={shared.input}
              value={url}
              onChangeText={setUrl}
              maxLength={500}
              placeholder="https://example.com/orbyn"
              placeholderTextColor={colors.faint}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Webhook URL"
            />
          </Field>
          <Field label="Send when">
            <ChipRow label="Webhook events" multi>
              {WEBHOOK_EVENTS.map((e) => {
                const on = events.includes(e);
                return (
                  <Chip
                    key={e}
                    multi
                    label={EVENT_LABELS[e]}
                    selected={on}
                    onPress={() =>
                      setEvents(
                        on ? events.filter((x) => x !== e) : [...events, e],
                      )
                    }
                  />
                );
              })}
            </ChipRow>
          </Field>
          <Button
            title="Add webhook"
            icon="plus"
            style={s.last}
            disabled={busy || !url.trim() || !events.length}
            onPress={() =>
              void run(async () => {
                const made = await client.createWebhook({
                  url: url.trim(),
                  events,
                });
                animateLayout();
                setSecret({ url: made.url, secret: made.secret });
                setUrl("");
                await reloadHooks();
              })
            }
          />
        </View>

        <CalendarFeedCard />
        <SubscriptionsCard />
      </View>
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    privacy: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    eyebrow: { marginTop: 8 },
    gap: { marginBottom: 12 },
    secret: {
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 14,
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
    actions: { flexDirection: "row", gap: 10, marginTop: 8 },
    flex: { flex: 1, marginBottom: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    hook: {
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    hookTop: { flexDirection: "row", alignItems: "center", gap: 10 },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
    },
    error: { color: colors.danger, marginTop: 6 },
    test: { color: colors.accent, marginTop: 6 },
    formTop: { marginTop: 14 },
    last: { marginBottom: 0 },
  }),
);
