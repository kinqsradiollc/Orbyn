import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  describeOp,
  fieldsLabel,
  syncLabel,
  type DevicePresence,
  type OutboxEntry,
  type PresenceSettings,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { InlineDetails } from "../components/InlineDetails";
import { MoreMenu } from "../components/MoreMenu";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
import { SwitchRow } from "./booking/ui";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { confirmAction } from "../lib/confirm";
import { deviceId } from "../lib/device";
import { onLive } from "../lib/live";
import * as outbox from "../lib/outbox";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";
import { errorText } from "../lib/errors";

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
  const [problem, setProblem] = useState("");
  const [settingsFailed, setSettingsFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const mutation = useRef(false);
  const ticket = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const request = ++ticket.current;
    const account = session.token;
    const [deviceResult, settingsResult] = await Promise.allSettled([
      client.listDevices(),
      client.presenceSettings(),
    ]);
    if (
      !mounted.current ||
      request !== ticket.current ||
      account !== session.token
    )
      return;
    setReachable(deviceResult.status === "fulfilled");
    if (deviceResult.status === "fulfilled") setDevices(deviceResult.value);
    setSettingsFailed(settingsResult.status === "rejected");
    if (settingsResult.status === "fulfilled" && !mutation.current)
      setSettings(settingsResult.value);
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const unsubscribe = onLive((news) => {
      if (news.kind === "presence") void load();
    });
    return () => {
      mounted.current = false;
      ticket.current++;
      unsubscribe();
    };
  }, [load]);
  const change = async <T,>(
    fn: () => Promise<T>,
    onSaved?: (result: T) => void,
  ) => {
    if (mutation.current || !mounted.current) return;
    const account = session.token;
    mutation.current = true;
    setPending(true);
    setProblem("");
    try {
      const result = await fn();
      if (mounted.current && account === session.token) {
        onSaved?.(result);
        await load();
      }
    } catch (e) {
      if (mounted.current && account === session.token)
        setProblem(errorText(e));
    } finally {
      mutation.current = false;
      if (mounted.current && account === session.token) setPending(false);
    }
  };

  const recoveryAction = (discard: boolean) => {
    const account = session.token;
    const recovery = state.recovery;
    confirmAction(
      discard ? "Discard saved changes?" : "Copy saved changes?",
      discard
        ? "These changes may belong to a previously signed-in account. Discarding removes the saved copy from this phone and cannot be undone."
        : "These changes may belong to a previously signed-in account. Copy only if you are allowed to view them. Their contents will be placed on your clipboard.",
      discard ? "Discard saved changes" : "Copy saved changes",
      () => {
        if (
          !mounted.current ||
          account !== session.token ||
          recovery !== outbox.outboxState().recovery
        )
          return;
        setRecoveryNotice("");
        void change(
          async () => {
            if (discard) {
              await outbox.discardRecovery();
              return true;
            }
            const saved = await outbox.recoveryCopy();
            if (
              !mounted.current ||
              account !== session.token ||
              recovery !== outbox.outboxState().recovery
            )
              return false;
            const copied = await Clipboard.setStringAsync(saved);
            if (!copied)
              throw new Error("Couldn't copy saved changes. Try again.");
            return true;
          },
          (completed) => {
            if (completed)
              setRecoveryNotice(
                discard ? "Saved changes discarded." : "Saved changes copied.",
              );
          },
        );
      },
      discard,
    );
  };

  const self = deviceId();
  return (
    <ScrollView contentContainerStyle={sheetStyles.body}>
      <View style={sheetStyles.column}>
        <ErrorBanner error={problem} onDismiss={() => setProblem("")} />
        <Text style={[shared.eyebrow, s.eyebrow]}>THIS DEVICE</Text>
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
                  : state.storageError
                    ? "Saved changes need attention"
                    : state.recovery
                      ? "Saved changes are held"
                      : state.entries.length
                        ? "Online"
                        : "Everything is in sync"}
              </Text>
              <Text style={shared.small}>
                {state.storageError || state.recovery
                  ? "Review the saved changes below."
                  : state.entries.length
                    ? "Changes wait here until they reach the server."
                    : state.syncedAt
                      ? `Last in sync ${ago(state.syncedAt)}.`
                      : "Offline changes wait here."}
              </Text>
            </View>
          </View>
          {state.storageError && (
            <View style={s.firstEntry}>
              <ErrorBanner error={state.storageError} />
              <SmallAction
                label="Retry saved changes"
                disabled={pending || state.sending}
                onPress={() => {
                  const account = session.token;
                  void change(async () => {
                    await outbox.loadOutbox();
                    if (mounted.current && account === session.token)
                      await outbox.flush();
                  });
                }}
              />
            </View>
          )}
          {state.recovery && (
            <View style={[s.entry, s.firstEntry]}>
              <Text style={s.entryTitle}>
                {state.recovery.count > 0
                  ? `${state.recovery.count} saved ${state.recovery.count === 1 ? "change" : "changes"} held`
                  : "Saved changes held"}
              </Text>
              <Text style={shared.small}>{state.recovery.reason}</Text>
              <Text style={shared.small}>
                These changes cannot sync automatically because their account
                cannot be confirmed.
              </Text>
              <View style={s.actions}>
                <SmallAction
                  label="Copy saved changes"
                  disabled={pending}
                  onPress={() => recoveryAction(false)}
                />
                <SmallAction
                  label="Discard saved changes"
                  destructive
                  disabled={pending}
                  onPress={() => recoveryAction(true)}
                />
              </View>
            </View>
          )}
          {!!recoveryNotice && (
            <Text
              accessibilityLiveRegion="polite"
              style={[shared.small, s.note]}
            >
              {recoveryNotice}
            </Text>
          )}
          {state.entries.length > 0 && (
            <Text style={[shared.small, s.note]}>
              Pending changes stay on this device for this account after
              sign-out.
            </Text>
          )}
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
        <InlineDetails title="What works offline">
          <Text style={shared.small}>
            Tasks, events, habits and booking replies work offline. Assistant,
            search and planning need a connection.
          </Text>
        </InlineDetails>

        <Text style={[shared.eyebrow, s.eyebrow]}>YOUR DEVICES</Text>
        <View style={shared.card}>
          {!reachable ? (
            <View>
              <Text accessibilityRole="alert" style={shared.small}>
                Couldn't load devices.
              </Text>
              <SmallAction
                label="Retry"
                disabled={pending}
                onPress={() => void load()}
              />
            </View>
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
                  <Text style={s.title}>
                    {d.label ?? d.platform}
                    {d.device_id === self ? " · this device" : ""}
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
                  <MoreMenu
                    label={`${d.label ?? d.platform} options`}
                    title={d.label ?? d.platform}
                    disabled={pending}
                    actions={[
                      {
                        label: "Forget device",
                        destructive: true,
                        disabled: pending,
                        onPress: () =>
                          confirmAction(
                            `Forget ${d.label ?? d.platform}?`,
                            "Removes it from this list. It returns if used while still signed in.",
                            "Forget",
                            () => {
                              void change(() =>
                                client.forgetDevice(d.device_id),
                              );
                            },
                          ),
                      },
                    ]}
                  />
                )}
              </View>
            ))
          )}
          {settingsFailed && (
            <View>
              <Text accessibilityRole="alert" style={shared.small}>
                Couldn't load activity sharing.
              </Text>
              <SmallAction
                label="Retry"
                disabled={pending}
                onPress={() => void load()}
              />
            </View>
          )}
          {settings && (
            <View style={[s.divider, s.switch]}>
              <SwitchRow
                title="Share activity with teams"
                disabled={pending || settingsFailed}
                hint="Shows active or away; hides your work and last-seen time."
                value={settings.share_presence}
                onValueChange={(on) => {
                  void change(
                    () => client.updatePresenceSettings({ share_presence: on }),
                    setSettings,
                  );
                }}
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
  const binding = { userId: session.userId, generation: session.generation };
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () =>
    mounted.current &&
    binding.userId === session.userId &&
    binding.generation === session.generation;
  const resolve = async (choice: "mine" | "retry" | "drop") => {
    if (!current() || busy.current) return;
    busy.current = true;
    setPending(true);
    setProblem("");
    try {
      await outbox.resolve(entry.key, choice, binding);
    } catch (error) {
      if (current()) setProblem(errorText(error));
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  };
  return (
    <View style={[s.entry, !first && s.divider, first && s.firstEntry]}>
      <Text style={s.entryTitle}>{describeOp(entry.op)}</Text>
      <Text style={[shared.small, failed && s.failed]}>
        {entry.conflict
          ? `Changed on another device too: ${fieldsLabel(entry.conflict.fields)}.`
          : failed
            ? entry.error
            : entry.attempts
              ? "Waiting for a connection"
              : "Waiting"}
      </Text>
      <ErrorBanner error={problem} onDismiss={() => setProblem("")} />
      {entry.conflict ? (
        <View style={s.actions}>
          <SmallAction
            label="Keep mine"
            disabled={pending}
            onPress={() => void resolve("mine")}
          />
          <SmallAction
            label="Keep theirs"
            disabled={pending}
            onPress={() => void resolve("drop")}
          />
        </View>
      ) : (
        <View style={s.actions}>
          {failed && (
            <SmallAction
              label="Try again"
              disabled={pending}
              onPress={() => {
                if (!current() || busy.current) return;
                if (!entry.uncertain) {
                  void resolve("retry");
                  return;
                }
                confirmAction(
                  "Retry this change?",
                  "This change may already be saved. Check the result first. Retrying can create a duplicate.",
                  "Retry anyway",
                  () => void resolve("retry"),
                  false,
                );
              }}
            />
          )}
          <SmallAction
            label="Discard"
            destructive
            disabled={pending}
            onPress={() => {
              if (!current() || busy.current) return;
              confirmAction(
                "Discard this change?",
                "Removes this phone's pending copy. The request may already have been sent; discarding cannot undo a change saved on the server.",
                "Discard",
                () => void resolve("drop"),
              );
            }}
          />
        </View>
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
    entryTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    failed: { color: colors.danger },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
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
      borderRadius: radii.pill,
      borderWidth: 1.5,
      borderColor: colors.faint,
    },
    dotOnline: { borderColor: colors.dot, backgroundColor: colors.surface },
    dotActive: { borderColor: colors.accent, backgroundColor: colors.accent },
    switch: { paddingTop: 6, marginTop: 4 },
  }),
);
