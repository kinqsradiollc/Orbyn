import { AgendaPrivateSettings } from "./AgendaPrivateSettings";
import { AiProviderChoiceControls } from "./AiProviderChoice";
import { ChatgptUsage } from "./ChatgptUsage";
import { CHATGPT_USAGE_URL } from "@orbyn/core";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import { useChatgptRemote } from "../../hooks/useChatgptRemote";
import { SmallAction } from "../../components/SmallAction";
import { colors } from "../../theme";
import { shared } from "../../styles";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import {
  signInNativeChatgpt,
  disconnectNativeChatgpt,
  cancelNativeChatgptSignIn,
} from "../../lib/chatgpt-local-sign-in";
import { chatgptForeground } from "../../lib/chatgpt-foreground";
import { SettingsSection } from "./SettingsSection";

/** Native and mobile web manage the same owned catalogs and account-bound defaults. */
export function ChatgptModelsSection({ userId }: { userId: string }) {
  const { state, refresh, select, save } = useChatgptRemote(userId);
  const [localRuntime, setLocalRuntime] = useState(
    chatgptForeground.snapshot(),
  );
  useEffect(
    () =>
      chatgptForeground.subscribe(() => {
        setLocalRuntime(chatgptForeground.snapshot());
        refresh();
      }),
    [userId],
  );
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      if (lifetime.current) {
        lifetime.current.abort();
        cancelNativeChatgptSignIn();
      }
    },
    [userId],
  );
  const connect = async () => {
    const controller = new AbortController();
    lifetime.current?.abort();
    lifetime.current = controller;
    const token = session.token;
    setConnecting(true);
    setConnectError(null);
    try {
      chatgptForeground.suspend();
      const connected = await signInNativeChatgpt(userId);
      if (controller.signal.aborted || token !== session.token) return;
      if (!connected.sharingGranted)
        throw new Error(
          "Enable ChatGPT plan usage when connecting this account.",
        );
      refresh();
    } catch (error) {
      if (!controller.signal.aborted && token === session.token)
        setConnectError(errorText(error));
    } finally {
      // Cancellation can preserve the previous local grant; restore its executor without another OAuth attempt.
      if (token === session.token) chatgptForeground.restart();
      if (lifetime.current === controller) {
        lifetime.current = null;
        setConnecting(false);
      }
    }
  };
  const busy = state.status === "loading" || state.saving;
  const catalog = state.catalog;
  const models = catalog?.models ?? [];
  const filtered = models.filter((m) =>
    `${m.display_name} ${m.slug}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const available = state.status === "ready" && catalog?.status === "ready";
  const selected = models.find((m) => m.slug === catalog?.preference.model);
  return (
    <SettingsSection title="AI connections & models">
      <AiProviderChoiceControls
        userId={userId}
        selection={
          state.selection
            ? {
                connection_id: state.selection.connection_id,
                executor_id: state.selection.executor_id,
              }
            : null
        }
      />
      <ChatgptUsage userId={userId} />
      <AgendaPrivateSettings userId={userId} />
      <Text style={shared.body}>ChatGPT</Text>
      <Text style={shared.small}>
        {Platform.OS === "web"
          ? "Direct browser connection is not available yet."
          : "Connect your account in the browser. ChatGPT work runs while this app is open."}
      </Text>
      <SmallAction
        label={
          Platform.OS === "web"
            ? "Browser connection unavailable"
            : connecting
              ? "Connecting…"
              : "Connect to ChatGPT"
        }
        disabled={!userId || connecting || Platform.OS === "web"}
        onPress={() => void connect()}
      />
      {connecting && (
        <SmallAction
          label="Cancel"
          disabled={false}
          onPress={() => {
            lifetime.current?.abort();
            cancelNativeChatgptSignIn();
          }}
        />
      )}
      {Platform.OS !== "web" && localRuntime.userId === userId && (
        <>
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {localRuntime.status === "ready"
              ? "This device is ready."
              : localRuntime.status === "starting"
                ? "Preparing this device…"
                : localRuntime.status === "paused"
                  ? "Work paused."
                  : localRuntime.status === "error"
                    ? "Reconnect this device to resume work."
                    : "No local ChatGPT connection."}
          </Text>
          {localRuntime.status === "error" && (
            <SmallAction
              label="Retry connection"
              disabled={connecting}
              onPress={() => chatgptForeground.restart()}
            />
          )}
          {localRuntime.status !== "idle" && (
            <SmallAction
              label="Disconnect this device"
              disabled={connecting}
              onPress={() => {
                chatgptForeground.suspend();
                void disconnectNativeChatgpt(userId)
                  .then(() => {
                    chatgptForeground.restart();
                    refresh();
                  })
                  .catch((error) => setConnectError(errorText(error)));
              }}
            />
          )}
        </>
      )}
      {connectError && (
        <Text accessibilityRole="alert" style={shared.small}>
          {connectError}
        </Text>
      )}
      <SmallAction
        label="Refresh devices & models"
        disabled={busy || !userId}
        onPress={refresh}
      />
      <SmallAction
        label="Manage ChatGPT usage"
        disabled={!userId}
        onPress={() => {
          void Linking.openURL(CHATGPT_USAGE_URL).catch(() =>
            Alert.alert(
              "Could not open ChatGPT",
              "Open ChatGPT Settings → Usage in your browser.",
            ),
          );
        }}
      />
      <Text style={shared.small}>
        Choose the same ChatGPT account to view its current allowance and app
        limits.
      </Text>
      {state.status === "loading" && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          Loading ChatGPT devices and models…
        </Text>
      )}
      {state.error && (
        <Text
          accessibilityRole="alert"
          style={[shared.body, { color: colors.danger }]}
        >
          {state.error}
        </Text>
      )}
      {state.status === "ready" && !state.devices.length && (
        <Text style={shared.small}>
          No ChatGPT model catalog is available yet.
        </Text>
      )}
      {!!state.devices.length && (
        <>
          <Text style={shared.body}>Connected device</Text>
          <ScrollView
            nestedScrollEnabled
            style={{ maxHeight: 160 }}
            contentContainerStyle={{ gap: 8 }}
            accessibilityLabel="ChatGPT devices"
          >
            {state.devices.map((d, i) => (
              <Pressable
                key={d.executor_id}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: state.selection?.executor_id === d.executor_id,
                  disabled: busy,
                }}
                disabled={busy}
                style={[
                  shared.card,
                  {
                    padding: 12,
                    backgroundColor:
                      state.selection?.executor_id === d.executor_id
                        ? colors.surfaceMuted
                        : colors.surface,
                  },
                ]}
                onPress={() => {
                  setQuery("");
                  select({
                    executor_id: d.executor_id,
                    connection_id: d.connection_id,
                  });
                }}
              >
                <Text style={shared.body}>
                  Device {i + 1} · {d.host_id.slice(0, 8)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      {catalog && (
        <>
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {catalog.status === "ready"
              ? `${models.length} models available.`
              : catalog.status === "offline"
                ? "This device is offline. Reconnect it before choosing a model."
                : catalog.status === "stale"
                  ? "Refresh the catalog from the connected device."
                  : "This device has not published a model catalog."}
          </Text>
          <Text style={shared.body}>
            Default model:{" "}
            {selected?.display_name ??
              catalog.preference.model ??
              "None selected"}
            {catalog.preference.model && !selected ? " · unavailable" : ""}
          </Text>
          <TextInput
            accessibilityLabel="Find a ChatGPT model"
            style={shared.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name or model ID"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ScrollView
            nestedScrollEnabled
            style={{ maxHeight: 280 }}
            contentContainerStyle={{ gap: 8 }}
            accessibilityLabel="ChatGPT models"
          >
            {filtered.slice(0, 50).map((m) => (
              <Pressable
                key={m.slug}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: catalog.preference.model === m.slug,
                  disabled: busy || !available,
                }}
                disabled={busy || !available}
                style={[
                  shared.card,
                  {
                    padding: 12,
                    backgroundColor:
                      catalog.preference.model === m.slug
                        ? colors.surfaceMuted
                        : colors.surface,
                  },
                ]}
                onPress={() => save(m.slug)}
              >
                <View style={{ gap: 4 }}>
                  <Text style={shared.body}>{m.display_name}</Text>
                  <Text style={shared.small}>{m.slug}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
          {filtered.length > 50 && (
            <Text style={shared.small}>
              Showing 50 of {filtered.length} matches. Narrow your search to
              find a model.
            </Text>
          )}
          {!filtered.length && (
            <Text style={shared.small}>No models match your search.</Text>
          )}
          <SmallAction
            label="Clear default model"
            disabled={busy || !available || !catalog.preference.model}
            onPress={() => save(null)}
          />
          {state.saving && (
            <Text accessibilityLiveRegion="polite" style={shared.small}>
              Saving default model…
            </Text>
          )}
          {catalog.published_at && (
            <Text style={shared.small}>
              Catalog updated {new Date(catalog.published_at).toLocaleString()}.
            </Text>
          )}
        </>
      )}
    </SettingsSection>
  );
}
