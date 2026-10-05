import { AgendaPrivateSettings } from "./AgendaPrivateSettings";
import { AiProviderChoiceControls } from "./AiProviderChoice";
import { ChatgptUsage } from "./ChatgptUsage";
import { CHATGPT_USAGE_URL } from "@orbyn/core";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import { SettingsSection } from "./SettingsSection";

/** Native and mobile web manage the same owned catalogs and account-bound defaults. */
export function ChatgptModelsSection({ userId }: { userId: string }) {
  const { state, refresh, select, save } = useChatgptRemote(userId);
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      lifetime.current?.abort();
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
      const request = await client.startChatgptConnectRequest(
        controller.signal,
      );
      while (
        !controller.signal.aborted &&
        token === session.token &&
        Date.now() < Date.parse(request.expires_at)
      ) {
        await new Promise<void>((resolve) => {
          const cancel = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            controller.signal.removeEventListener("abort", cancel);
            resolve();
          }, 3000);
          controller.signal.addEventListener("abort", cancel, { once: true });
          if (controller.signal.aborted) cancel();
        });
        if (controller.signal.aborted || token !== session.token) return;
        const next = await client.chatgptConnectRequest(
          request.id,
          controller.signal,
        );
        if (controller.signal.aborted || token !== session.token) return;
        if (next.state === "completed") {
          refresh();
          return;
        }
        if (next.state === "failed" || next.state === "expired")
          throw new Error(
            "ChatGPT sign-in did not finish. Try connecting again.",
          );
      }
      if (!controller.signal.aborted && token === session.token)
        throw new Error("ChatGPT sign-in expired. Try connecting again.");
    } catch (error) {
      if (!controller.signal.aborted && token === session.token)
        setConnectError(errorText(error));
    } finally {
      if (lifetime.current === controller) setConnecting(false);
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
        Connect your ChatGPT account and choose its default model.
      </Text>
      <SmallAction
        label={connecting ? "Waiting for ChatGPT…" : "Connect to ChatGPT"}
        disabled={!userId || connecting}
        onPress={() => void connect()}
      />
      {connecting && (
        <Text accessibilityLiveRegion="polite" style={shared.small}>
          Finish sign-in in the browser opened by your connected Orbyn app.
        </Text>
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
                  ? "Refresh the catalog from this device’s desktop app."
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
