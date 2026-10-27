import { AgendaPrivateSettings } from "./AgendaPrivateSettings";
import { AiProviderChoiceControls } from "./AiProviderChoice";
import { ChatgptUsage } from "./ChatgptUsage";
import { ManagedAiUsage } from "./ManagedAiUsage";
import { CHATGPT_USAGE_URL, chatgptExecutorDeviceLabel } from "@orbyn/core";
import React, { useEffect, useRef, useState } from "react";
import { Platform, Linking, ScrollView, Text, View } from "react-native";
import { useChatgptRemote } from "../connections/useChatgptRemote";
import { MoreMenu } from "../../components/MoreMenu";
import { SmallAction } from "../../components/SmallAction";
import { colors } from "../../theme";
import { ChoicePicker } from "../../components/ChoicePicker";
import { InlineDetails } from "../../components/InlineDetails";
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
} from "../connections/chatgpt-local-sign-in";
import type { NativeChatgptDirectorySnapshot } from "../connections/chatgpt-account-directory";
import { chatgptForeground } from "../connections/chatgpt-foreground";
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
      await prepareNativeChatgptAccounts(userId, { signal: controller.signal });
      if (controller.signal.aborted || !owned()) return;
      refresh();
      setAccountReload((n) => n + 1);
      if (!connected.sharingGranted)
        setConnectError("Account saved. ChatGPT plan use is off.");
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
  const modelNameCounts = new Map<string, number>();
  for (const model of models)
    modelNameCounts.set(
      model.display_name,
      (modelNameCounts.get(model.display_name) ?? 0) + 1,
    );
  const available = state.status === "ready" && catalog?.status === "ready";
  const providerReady =
    available &&
    !busy &&
    Boolean(catalog?.capabilities?.includes("plan_inference_v1")) &&
    models.some((model) => model.slug === catalog?.preference.model);
  const selected = models.find((m) => m.slug === catalog?.preference.model);
  return (
    <SettingsSection title="AI connections & models">
      <Text style={shared.body}>ChatGPT</Text>
      {Platform.OS === "web" ? (
        <Text style={shared.small}>
          Connect in Orbyn on a phone or desktop.
        </Text>
      ) : account?.status === "unsupported" ? (
        <Text style={shared.small}>
          Update Orbyn to connect on this device.
        </Text>
      ) : (
        <Text style={shared.small}>
          Sign in with ChatGPT in your browser. Work runs while Orbyn is open.
        </Text>
      )}
      {Platform.OS !== "web" &&
        (!savedAccounts || savedAccounts.selected !== null) && (
          <SmallAction
            label={
              connecting
                ? "Connecting…"
                : savedAccounts?.selected
                  ? "Reconnect current account"
                  : "Connect ChatGPT"
            }
            disabled={
              !userId ||
              !token ||
              localBusy ||
              account?.status === "unsupported"
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
      {Platform.OS !== "web" &&
        hasLocalAccount &&
        (account?.status !== "saved" || !account.planUseAllowed) && (
          <Text style={shared.small}>
            {account?.status === "reconnect"
              ? "Session ended. Reconnect to continue."
              : account?.status === "unreadable"
                ? "Reconnect or disconnect this account."
                : account?.status === "saved" && !account.planUseAllowed
                  ? "ChatGPT plan use is off."
                  : "Account saved on this device."}
          </Text>
        )}
      {Platform.OS !== "web" &&
        localRuntime.userId === userId &&
        (hasLocalAccount || localRuntime.status !== "idle") && (
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
                        : "Not connected."}
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
              contentContainerStyle={{ gap: 8, paddingVertical: 8 }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {savedAccounts.accounts.map((entry, index) => (
                <View
                  key={entry.connection.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
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
                        label: "Enable ChatGPT plan usage",
                        disabled: localBusy || entry.status === "disconnected",
                        onPress: () =>
                          void connect({
                            kind: "reconnect",
                            connectionId: entry.connection.id,
                            expectedRevision: savedAccounts.revision,
                            requestPlanConsent: true,
                          }),
                      },
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
      {Platform.OS !== "web" &&
        savedAccounts &&
        savedAccounts.accounts.length > 0 && (
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
        disabled={busy || localBusy || !userId}
        onPress={refresh}
      />
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
        <Text style={shared.small}>No connected devices yet.</Text>
      )}
      {!!state.devices.length && (
        <ChoicePicker
          label="Connected device"
          value={state.selection?.executor_id ?? ""}
          options={state.devices.map((device, index) => ({
            value: device.executor_id,
            label: device.device
              ? chatgptExecutorDeviceLabel(device.device)
              : `Device ${index + 1}`,
          }))}
          disabled={busy || localBusy}
          onChange={(executorId) => {
            const device = state.devices.find(
              (entry) => entry.executor_id === executorId,
            );
            if (!device || busy || localBusy) return;
            select({
              executor_id: device.executor_id,
              connection_id: device.connection_id,
            });
          }}
        />
      )}
      {catalog && (
        <>
          <Text accessibilityLiveRegion="polite" style={shared.small}>
            {catalog.status === "ready"
              ? `${models.length} models available.`
              : catalog.status === "offline"
                ? "Device offline. Reconnect to choose a model."
                : catalog.status === "stale"
                  ? "Refresh models on the connected device."
                  : "This device has not published a model catalog."}
          </Text>
          <ChoicePicker
            label="Default model"
            value={catalog.preference.model ?? ""}
            options={[
              { value: "", label: "No default model" },
              ...models.map((model) => ({
                value: model.slug,
                label:
                  (modelNameCounts.get(model.display_name) ?? 0) > 1
                    ? `${model.display_name} (${model.slug})`
                    : model.display_name,
                detail:
                  model.display_name === model.slug ? undefined : model.slug,
              })),
            ]}
            disabled={busy || localBusy || !available}
            onChange={(model) => {
              if (!busy && !localBusy && available) void save(model || null);
            }}
          />
          {state.saving && (
            <Text accessibilityLiveRegion="polite" style={shared.small}>
              Saving default model…
            </Text>
          )}
          <InlineDetails title="Connection details">
            {!!catalog.preference.model && (
              <Text selectable style={shared.small}>
                Model: {catalog.preference.model}
              </Text>
            )}
            {catalog.preference.model && !selected && (
              <Text style={shared.small}>Selected model is unavailable.</Text>
            )}
            {catalog.published_at && (
              <Text style={shared.small}>
                Models updated {new Date(catalog.published_at).toLocaleString()}
                .
              </Text>
            )}
          </InlineDetails>
        </>
      )}
      <AiProviderChoiceControls
        userId={userId}
        selection={
          providerReady && state.selection
            ? {
                connection_id: state.selection.connection_id,
                executor_id: state.selection.executor_id,
              }
            : null
        }
      />
      <AgendaPrivateSettings userId={userId} />
      <ChatgptUsage userId={userId} />
      <SmallAction
        label="View ChatGPT usage"
        disabled={!userId}
        onPress={() => {
          void Linking.openURL(CHATGPT_USAGE_URL).catch(() =>
            setConnectError("Open ChatGPT Settings → Usage in your browser."),
          );
        }}
      />
      <ManagedAiUsage userId={userId} />
    </SettingsSection>
  );
}
