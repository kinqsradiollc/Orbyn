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
import { MoreMenu } from "../../components/MoreMenu";
import { SmallAction } from "../../components/SmallAction";
import { colors } from "../../theme";
import { shared } from "../../styles";
import { session } from "../../lib/session";
import { errorText } from "../../lib/errors";
import {
  signInNativeChatgpt,
  prepareNativeChatgptAccounts,
  disconnectNativeChatgpt,
  cancelNativeChatgptSignIn,
  readNativeChatgptAccountState,
  readNativeChatgptAccounts,
  selectNativeChatgptAccount,
  type NativeChatgptAccountState,
  type NativeChatgptConnectAction,
  type NativeChatgptDisconnectTarget,
} from "../../lib/chatgpt-local-sign-in";
import type { NativeChatgptDirectorySnapshot } from "../../lib/chatgpt-account-directory";
import { chatgptForeground } from "../../lib/chatgpt-foreground";
import { SettingsSection } from "./SettingsSection";

/** Native and mobile web manage the same owned catalogs and account-bound defaults. */
export function ChatgptModelsSection({ userId }: { userId: string }) {
  const { state, refresh, select, save } = useChatgptRemote(userId);
  const token = session.token;
  const owner = useRef({ userId, token });
  owner.current = { userId, token };
  const [localAccount, setLocalAccount] = useState<{
    userId: string;
    token: string | null;
    value: NativeChatgptAccountState;
  } | null>(null);
  const [accountReload, setAccountReload] = useState(0);
  const [directory, setDirectory] = useState<{
    userId: string;
    token: string;
    value: NativeChatgptDirectorySnapshot | null;
  } | null>(null);
  const savedAccounts =
    directory?.userId === userId && directory.token === token
      ? directory.value
      : null;

  const account =
    localAccount?.userId === userId && localAccount.token === token
      ? localAccount.value
      : null;
  useEffect(() => {
    const controller = new AbortController();
    if (Platform.OS === "web" || !userId || !token)
      return () => controller.abort();
    void Promise.all([
      readNativeChatgptAccountState(userId, { signal: controller.signal }),
      readNativeChatgptAccounts(userId, { signal: controller.signal }),
    ]).then(
      ([value, accounts]) => {
        if (!controller.signal.aborted && token === session.token) {
          setLocalAccount({ userId, token, value });
          setDirectory({ userId, token, value: accounts });
        }
      },
      () => {
        if (!controller.signal.aborted && token === session.token) {
          setLocalAccount(null);
          setDirectory(null);
        }
      },
    );
    return () => controller.abort();
  }, [userId, token, accountReload]);
  const [localRuntime, setLocalRuntime] = useState(
    chatgptForeground.snapshot(),
  );
  useEffect(
    () =>
      chatgptForeground.subscribe(() => {
        setLocalRuntime(chatgptForeground.snapshot());
        setAccountReload((value) => value + 1);
        refresh();
      }),
    [userId],
  );
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [ownedError, setOwnedError] = useState<{
    userId: string;
    token: string | null;
    text: string;
  } | null>(null);
  const connectError =
    ownedError?.userId === userId && ownedError.token === token
      ? ownedError.text
      : null;
  const setConnectError = (text: string | null) =>
    setOwnedError(text ? { userId, token, text } : null);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    setConnecting(false);
    setDisconnecting(false);
    setChoosing(false);
    setConnectError(null);
    return () => {
      if (lifetime.current) {
        lifetime.current.abort();
        cancelNativeChatgptSignIn();
        lifetime.current = null;
      }
    };
  }, [userId, token]);
  const connect = async (requested?: NativeChatgptConnectAction) => {
    if (
      connecting ||
      disconnecting ||
      choosing ||
      lifetime.current ||
      owner.current.userId !== userId ||
      owner.current.token !== token ||
      session.token !== token
    )
      return;
    const controller = new AbortController();
    lifetime.current = controller;
    const owned = () =>
      owner.current.userId === userId &&
      owner.current.token === token &&
      token === session.token;
    setConnecting(true);
    setConnectError(null);
    try {
      chatgptForeground.suspend();
      await prepareNativeChatgptAccounts(userId, { signal: controller.signal });
      if (controller.signal.aborted || !owned()) return;
      const action =
        requested ??
        (savedAccounts?.selected
          ? {
              kind: "reconnect" as const,
              connectionId: savedAccounts.selected,
              expectedRevision: savedAccounts.revision,
            }
          : undefined);
      const connected = await signInNativeChatgpt(userId, {
        signal: controller.signal,
        action,
      });
      if (controller.signal.aborted || !owned()) return;
      if (!connected.sharingGranted)
        throw new Error(
          "Enable ChatGPT plan usage when connecting this account.",
        );
      await prepareNativeChatgptAccounts(userId, { signal: controller.signal });
      if (controller.signal.aborted || !owned()) return;
      refresh();
      setAccountReload((n) => n + 1);
    } catch (error) {
      if (!controller.signal.aborted && owned())
        setConnectError(errorText(error));
    } finally {
      // Cancellation can preserve the previous local grant; restore its executor without another OAuth attempt.
      if (owned()) chatgptForeground.restart();
      if (lifetime.current === controller) {
        lifetime.current = null;
        setConnecting(false);
      }
    }
  };
  const disconnect = async (target?: NativeChatgptDisconnectTarget) => {
    if (
      connecting ||
      disconnecting ||
      choosing ||
      lifetime.current ||
      owner.current.userId !== userId ||
      owner.current.token !== token ||
      session.token !== token
    )
      return;
    const controller = new AbortController();
    lifetime.current = controller;
    setDisconnecting(true);
    setConnectError(null);
    const live = () =>
      !controller.signal.aborted &&
      owner.current.userId === userId &&
      owner.current.token === token &&
      session.token === token;
    chatgptForeground.suspend();
    try {
      await disconnectNativeChatgpt(userId, { target });
    } catch (error) {
      if (live()) setConnectError(errorText(error));
    } finally {
      if (live()) {
        chatgptForeground.restart();
        refresh();
        setAccountReload((n) => n + 1);
      }
      if (lifetime.current === controller) {
        lifetime.current = null;
        setDisconnecting(false);
      }
    }
  };
  const choose = async (connectionId: string, revision: string) => {
    if (
      connecting ||
      disconnecting ||
      choosing ||
      lifetime.current ||
      owner.current.userId !== userId ||
      owner.current.token !== token ||
      session.token !== token
    )
      return;
    const controller = new AbortController();
    lifetime.current = controller;
    const live = () =>
      !controller.signal.aborted &&
      owner.current.userId === userId &&
      owner.current.token === token &&
      session.token === token;
    setChoosing(true);
    setConnectError(null);
    chatgptForeground.suspend();
    try {
      await selectNativeChatgptAccount(userId, connectionId, revision, {
        signal: controller.signal,
      });
      if (live()) {
        refresh();
        setAccountReload((n) => n + 1);
      }
    } catch (error) {
      if (live()) setConnectError(errorText(error));
    } finally {
      if (live()) chatgptForeground.restart();
      if (lifetime.current === controller) {
        lifetime.current = null;
        setChoosing(false);
      }
    }
  };
  const localBusy = connecting || disconnecting || choosing;
  const hasLocalAccount =
    account?.status === "saved" ||
    account?.status === "unreadable" ||
    account?.status === "reconnect";
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
          : account?.status === "unsupported"
            ? "Update Orbyn to connect ChatGPT on this device."
            : "Connect your account in the browser. ChatGPT work runs while this app is open."}
      </Text>
      {(!savedAccounts || savedAccounts.selected !== null) && (
        <SmallAction
          label={
            Platform.OS === "web"
              ? "Browser connection unavailable"
              : connecting
                ? "Connecting…"
                : savedAccounts?.selected
                  ? "Reconnect current account"
                  : "Connect to ChatGPT"
          }
          disabled={
            !userId ||
            !token ||
            localBusy ||
            account?.status === "unsupported" ||
            Platform.OS === "web"
          }
          onPress={() => void connect()}
        />
      )}
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
      {Platform.OS !== "web" && hasLocalAccount && (
        <Text style={shared.small}>
          {account?.status === "reconnect"
            ? "This ChatGPT session has ended. Connect again to continue."
            : account?.status === "unreadable"
              ? "Saved connection needs attention. Reconnect or disconnect it."
              : account?.status === "saved" && !account.planUseAllowed
                ? "ChatGPT plan use is off. Enable it in ChatGPT Settings, then reconnect."
                : "Account saved on this device."}
        </Text>
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
                    : hasLocalAccount
                      ? "This device is not running ChatGPT work."
                      : "No local ChatGPT connection."}
          </Text>
          {localRuntime.status === "error" && (
            <SmallAction
              label="Retry connection"
              disabled={localBusy}
              onPress={() => chatgptForeground.restart()}
            />
          )}
        </>
      )}
      {Platform.OS !== "web" &&
        (hasLocalAccount ||
          (localRuntime.userId === userId &&
            localRuntime.status !== "idle")) && (
          <SmallAction
            label={disconnecting ? "Disconnecting…" : "Disconnect this device"}
            disabled={localBusy}
            onPress={() => void disconnect()}
          />
        )}
      {Platform.OS !== "web" &&
        savedAccounts &&
        savedAccounts.accounts.length > 0 && (
          <View>
            <Text style={shared.small}>Accounts on this device</Text>
            <ScrollView
              style={{ maxHeight: 200 }}
              contentContainerStyle={{ gap: 16, paddingVertical: 8 }}
            >
              {savedAccounts.accounts.map((entry, index) => (
                <View
                  key={entry.connection.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <SmallAction
                      label={
                        entry.status !== "connected"
                          ? `Reconnect account ${index + 1}`
                          : `Account ${index + 1}${entry.connection.id === savedAccounts.selected ? " · current" : ""}`
                      }
                      disabled={
                        localBusy ||
                        entry.connection.id === savedAccounts.selected
                      }
                      onPress={() =>
                        entry.status === "connected"
                          ? void choose(
                              entry.connection.id,
                              savedAccounts.revision,
                            )
                          : void connect({
                              kind: "reconnect",
                              connectionId: entry.connection.id,
                              expectedRevision: savedAccounts.revision,
                            })
                      }
                    />
                  </View>
                  <MoreMenu
                    label={`Account ${index + 1} options`}
                    title={`Account ${index + 1}`}
                    disabled={localBusy}
                    actions={[
                      {
                        label:
                          entry.status === "disconnected"
                            ? "Retry cleanup"
                            : "Disconnect account",
                        destructive: true,
                        disabled: localBusy,
                        onPress: () =>
                          void disconnect({
                            connectionId: entry.connection.id,
                            expectedRevision: savedAccounts.revision,
                          }),
                      },
                    ]}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      {Platform.OS !== "web" && savedAccounts && (
        <SmallAction
          label="Add ChatGPT account"
          disabled={
            localBusy ||
            savedAccounts.accounts.length >= 100 ||
            account?.status === "unsupported"
          }
          onPress={() =>
            void connect({
              kind: "add",
              expectedRevision: savedAccounts.revision,
            })
          }
        />
      )}
      {choosing && (
        <SmallAction
          label="Cancel switch"
          disabled={false}
          onPress={() => {
            lifetime.current?.abort();
            cancelNativeChatgptSignIn();
          }}
        />
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
