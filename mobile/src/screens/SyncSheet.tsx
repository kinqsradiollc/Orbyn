import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  describeOp,
  fieldsLabel,
  syncLabel,
  type DevicePresence,
  type OutboxEntry,
  type PresenceSettings,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { SwitchRow } from "./booking/ui";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { deviceId } from "../lib/device";
import { onLive } from "../lib/live";
import * as outbox from "../lib/outbox";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

type Outbox = ReturnType<typeof outbox.outboxState>;

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

/**
 * Sync and devices: what this phone is still holding (and anything that
 * needs a decision), then every device Orbyn is open on and whether it's in
 * sync, and whether teammates may see when you're active.
 */
export function SyncSheet({
  visible,
  outbox: state,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  outbox: Outbox;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Sync & devices"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      {visible && <Body state={state} />}
    </Sheet>
  );
}

function Body({ state }: { state: Outbox }) {
  const [devices, setDevices] = useState<DevicePresence[] | null>(null);
  const [settings, setSettings] = useState<PresenceSettings | null>(null);
  const [reachable, setReachable] = useState(true);
  const load = useCallback(() => {
    client.listDevices().then(
      (d) => {
        setDevices(d);
        setReachable(true);
      },
      () => setReachable(false),
    );
    client.presenceSettings().then(setSettings, () => {});
  }, []);
  useEffect(() => {
    load();
    return onLive((news) => news.kind === "presence" && load());
  }, [load]);

  const self = deviceId();
  return (
    <ScrollView contentContainerStyle={sheetStyles.body}>
      <View style={sheetStyles.column}>
        <Text style={[shared.eyebrow, s.eyebrow]}>ON THIS PHONE</Text>
        <View style={shared.card}>
          <View style={s.headRow}>
            <Icon
              name={state.offline ? "cloudOff" : "refreshCw"}
              size={18}
              color={colors.accent}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>
                {state.offline
                  ? "Offline"
                  : state.entries.length
                    ? "Online"
                    : "Everything is in sync"}
              </Text>
              <Text style={shared.small}>
                {state.entries.length
                  ? "Changes made here are kept until the server has them, in the order you made them."
                  : state.syncedAt
                    ? `Last in sync ${ago(state.syncedAt)}.`
                    : "Changes you make without a connection wait here."}
              </Text>
            </View>
          </View>
          {state.entries.map((e, n) => (
            <Entry key={e.key} entry={e} first={n === 0} />
          ))}
          {state.entries.some((e) => e.state === "pending") && (
            <Button
              secondary
              title={state.sending ? "Sending…" : "Send now"}
              icon="refreshCw"
              disabled={state.sending}
              style={s.send}
              onPress={() => void outbox.flush()}
            />
          )}
        </View>
        <Text style={[shared.small, s.note]}>
          Without a connection you can add, change, tick off and delete tasks
          and events, change habits, and answer booking requests. The assistant,
          search and making a plan need a connection.
        </Text>

        <Text style={[shared.eyebrow, s.eyebrow]}>YOUR DEVICES</Text>
        <View style={shared.card}>
          {!reachable ? (
            <Text style={shared.small}>Connect to see your other devices.</Text>
          ) : devices === null ? (
            <Text style={shared.small}>Loading…</Text>
          ) : (
            devices.map((d, n) => (
              <View key={d.device_id} style={[s.device, n > 0 && s.divider]}>
                <View
                  style={[
                    s.dot,
                    d.online && s.dotOnline,
                    d.active && s.dotActive,
                  ]}
                />
                <Icon
                  name={
                    d.platform === "ios" || d.platform === "android"
                      ? "smartphone"
                      : "monitor"
                  }
                  size={17}
                  color={colors.textSoft}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>
                    {d.label ?? d.platform}
                    {d.device_id === self ? " · this phone" : ""}
                  </Text>
                  <Text style={shared.small}>
                    {d.active
                      ? "Active now"
                      : d.online
                        ? "Online"
                        : `Seen ${ago(d.seen_at)}`}
                    {" · "}
                    {d.device_id === self && state.entries.length
                      ? `${state.entries.length} waiting here`
                      : syncLabel(d)}
                  </Text>
                </View>
                {d.device_id !== self && (
                  <SmallAction
                    label="Forget"
                    disabled={false}
                    onPress={() =>
                      confirmAction(
                        `Forget ${d.label ?? d.platform}?`,
                        "It leaves this list. If it's still signed in, it shows up again next time it's used.",
                        "Forget",
                        () =>
                          void client
                            .forgetDevice(d.device_id)
                            .then(load, () => {}),
                      )
                    }
                  />
                )}
              </View>
            ))
          )}
          {settings && (
            <View style={[s.divider, s.switch]}>
              <SwitchRow
                title="Let my teams see when I’m active"
                hint="They see “active” or “away” — never when you were last on, or what you’re working on."
                value={settings.share_presence}
                onValueChange={(on) =>
                  void client
                    .updatePresenceSettings({ share_presence: on })
                    .then(setSettings, (e: Error) =>
                      Alert.alert("Not saved", e.message),
                    )
                }
              />
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function Entry({ entry, first }: { entry: OutboxEntry; first: boolean }) {
  const failed = entry.state === "failed";
  return (
    <View style={[s.entry, !first && s.divider, first && s.firstEntry]}>
      <Text style={s.entryTitle} numberOfLines={2}>
        {describeOp(entry.op)}
      </Text>
      <Text style={[shared.small, failed && s.failed]}>
        {entry.conflict
          ? `Changed on another device too: ${fieldsLabel(entry.conflict.fields)}.`
          : failed
            ? entry.error
            : entry.attempts
              ? "Waiting for a connection"
              : "Waiting"}
      </Text>
      {entry.conflict ? (
        <View style={s.actions}>
          <SmallAction
            label="Keep mine"
            disabled={false}
            onPress={() => void outbox.resolve(entry.key, "mine")}
          />
          <SmallAction
            label="Keep theirs"
            disabled={false}
            onPress={() => void outbox.resolve(entry.key, "drop")}
          />
        </View>
      ) : (
        failed && (
          <View style={s.actions}>
            <SmallAction
              label="Try again"
              disabled={false}
              onPress={() => void outbox.resolve(entry.key, "retry")}
            />
            <SmallAction
              label="Discard"
              destructive
              disabled={false}
              onPress={() =>
                Alert.alert(
                  "Discard this change?",
                  "It was never saved, so it goes for good.",
                  [
                    { text: "Keep it", style: "cancel" },
                    {
                      text: "Discard",
                      style: "destructive",
                      onPress: () => void outbox.resolve(entry.key, "drop"),
                    },
                  ],
                )
              }
            />
          </View>
        )
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    eyebrow: { marginTop: 18 },
    headRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    note: { marginTop: 10 },
    send: { marginTop: 14, marginBottom: 0 },
    entry: { paddingVertical: 12, gap: 3 },
    firstEntry: { marginTop: 12 },
    entryTitle: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    failed: { color: colors.danger },
    actions: { flexDirection: "row", gap: 8, marginTop: 6 },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    device: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: colors.faint,
    },
    dotOnline: { borderColor: colors.dot, backgroundColor: colors.surface },
    dotActive: { borderColor: colors.accent, backgroundColor: colors.accent },
    switch: { paddingTop: 6, marginTop: 4 },
  }),
);
