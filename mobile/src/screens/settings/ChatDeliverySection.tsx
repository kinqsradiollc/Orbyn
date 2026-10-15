import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { ChatChannel } from "@orbyn/core";
import { SettingsSection } from "./SettingsSection";
import { BottomSheet } from "../../components/BottomSheet";
import { ActionSheet, MoreMenu } from "../../components/MoreMenu";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { Segmented } from "../../components/Segmented";
import { ErrorBanner } from "../../components/ErrorBanner";
import { shared } from "../../styles";
import { colors } from "../../theme";
import { client } from "../../lib/api";
import { session } from "../../lib/session";

type Kind = "slack" | "discord";

/** Keep the setup draft with Settings; only its focused editor opens here. */
export function ChatDeliverySection({
  channel,
  kind,
  url,
  onKind,
  onUrl,
  busy,
  unavailable,
  recovery,
  act,
  onChanged,
}: {
  channel: ChatChannel | null;
  kind: Kind;
  url: string;
  onKind: (kind: Kind) => void;
  onUrl: (url: string) => void;
  busy: boolean;
  unavailable: boolean;
  recovery: React.ReactNode;
  act: (operation: () => Promise<void>) => Promise<void>;
  onChanged: (value: ChatChannel) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Kind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const writing = useRef(false);
  const discardTarget = useRef<string | null>(null);
  const mounted = useRef(true);
  const account = useRef(session.token).current;
  const latest = useRef({ channel, kind, url });
  latest.current = { channel, kind, url };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && account === session.token;
  const run = async (operation: () => Promise<void>) => {
    if (!current() || busy || unavailable || writing.current) return;
    writing.current = true;
    setPending(true);
    setError("");
    setNotice("");
    let started = false;
    try {
      await act(async () => {
        if (!current()) return;
        started = true;
        try {
          await operation();
        } catch {
          if (current()) setError("Couldn't update chat delivery. Try again.");
        }
      });
      if (current() && !started) setError("Chat delivery is busy. Try again.");
    } catch {
      if (current()) setError("Couldn't update chat delivery. Try again.");
    } finally {
      writing.current = false;
      if (current()) setPending(false);
    }
  };
  const close = () => {
    if (writing.current) return;
    if (latest.current.url.trim()) {
      discardTarget.current = latest.current.url;
      setDiscarding(true);
    } else setEditing(false);
  };
  const disabled = busy || unavailable || pending;
  const name = channel?.kind === "slack" ? "Slack" : "Discord";
  return (
    <SettingsSection title="Chat delivery">
      {recovery}
      {channel === null ? (
        !unavailable && <Text style={shared.small}>Loading chat delivery…</Text>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={shared.body}>
              {channel.kind ? name : "Not connected"}
            </Text>
            <Text style={shared.small}>Daily digest</Text>
          </View>
          {channel.kind ? (
            <MoreMenu
              label="Chat delivery options"
              disabled={disabled}
              actions={[
                {
                  label: "Send test",
                  disabled,
                  onPress: () => {
                    void run(async () => {
                      await client.testChat();
                      if (current()) setNotice("Test sent.");
                    });
                  },
                },
                {
                  label: "Disconnect",
                  destructive: true,
                  disabled,
                  onPress: () => setDisconnecting(channel.kind),
                },
              ]}
            />
          ) : (
            <SmallAction
              label="Connect"
              disabled={disabled}
              onPress={() => {
                setError("");
                setEditing(true);
              }}
            />
          )}
        </View>
      )}
      {!editing && !discarding && <ErrorBanner error={error} />}
      {!!notice && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
      {pending && !editing && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Updating chat delivery…
        </Text>
      )}
      <BottomSheet
        visible={editing && !discarding}
        title="Connect chat delivery"
        closeDisabled={busy || pending}
        onClose={close}
        footer={
          <Button
            title={pending ? "Connecting…" : "Connect"}
            disabled={disabled || !url.trim()}
            onPress={() => {
              const target = { kind, url: url.trim(), raw: url };
              void run(async () => {
                const saved = await client.setChat(target.kind, target.url);
                if (!current()) return;
                onChanged(saved);
                if (
                  latest.current.kind === target.kind &&
                  latest.current.url === target.raw
                ) {
                  onUrl("");
                  setEditing(false);
                }
              });
            }}
          />
        }
      >
        {unavailable && recovery}
        <Text style={shared.small}>
          Your daily digest will be sent to this webhook.
        </Text>
        <Segmented
          accessibilityLabel="Chat service"
          disabled={disabled}
          options={["slack", "discord"] as const}
          labels={{ slack: "Slack", discord: "Discord" }}
          value={kind}
          onChange={onKind}
        />
        <Text style={shared.body}>Webhook URL</Text>
        <TextInput
          style={shared.input}
          editable={!disabled}
          value={url}
          keyboardType="url"
          onChangeText={onUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://…"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Webhook URL"
        />
        <ErrorBanner error={error} />
      </BottomSheet>
      <ActionSheet
        visible={discarding}
        label="Discard webhook setup"
        title="Discard setup?"
        message="Your unsaved webhook URL will be removed."
        cancelLabel="Keep editing"
        onClose={() => setDiscarding(false)}
        actions={[
          {
            label: "Discard setup",
            destructive: true,
            onPress: () => {
              if (
                current() &&
                !writing.current &&
                latest.current.url === discardTarget.current
              ) {
                onUrl("");
                setEditing(false);
              }
            },
          },
        ]}
      />
      <ActionSheet
        visible={!!disconnecting}
        label="Disconnect chat delivery"
        title={`Disconnect ${disconnecting === "slack" ? "Slack" : "Discord"}?`}
        message="Your daily digest will no longer be sent to this webhook."
        cancelLabel="Keep connected"
        onClose={() => setDisconnecting(null)}
        actions={[
          {
            label: "Disconnect",
            destructive: true,
            disabled,
            onPress: () => {
              const target = disconnecting;
              if (target !== latest.current.channel?.kind) return;
              void run(async () => {
                await client.disableChat();
                if (current()) {
                  onChanged({ kind: null });
                  setNotice("Disconnected.");
                }
              });
            },
          },
        ]}
      />
    </SettingsSection>
  );
}
