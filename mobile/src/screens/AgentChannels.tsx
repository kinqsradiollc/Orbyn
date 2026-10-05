import React, {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { SlackChannelStore } from "@orbyn/api-client";
import { client } from "../lib/api";
import {
  session,
  loadSlackInstallation,
  saveSlackInstallation,
} from "../lib/session";
import { Switch } from "../components/Switch";
import { MoreMenu } from "../components/MoreMenu";
import { SmallAction } from "../components/SmallAction";
import { shared } from "../styles";
import { colors, radii, themed } from "../theme";
/** Private agent DMs; provider and MCP permissions remain separate settings. */
export function AgentChannelsCard() {
  const token = session.token;
  const store = useMemo(
    () =>
      new SlackChannelStore(
        client,
        () => session.token,
        (id) => {
          void saveSlackInstallation(id);
        },
      ),
    [token],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [dm, setDm] = useState(false);
  useEffect(() => {
    let active = true;
    void loadSlackInstallation().then((id) => {
      if (active) void store.restore(id);
    });
    return () => {
      active = false;
      store.dispose();
    };
  }, [store]);
  const pending = state.installation;
  useEffect(() => {
    setDm(false);
  }, [pending?.id]);
  useEffect(() => {
    if (
      !pending ||
      !["pending", "exchanging"].includes(pending.state) ||
      state.busy ||
      Date.parse(pending.expires_at) <= Date.now()
    )
      return;
    const timer = setTimeout(() => void store.refresh(), 10_000);
    return () => clearTimeout(timer);
  }, [store, pending, state.busy]);
  const connection = state.status?.connection;
  const connected = connection && !connection.disconnected;
  const open = async (url: string) => {
    await Linking.openURL(url);
  };
  return (
    <View style={[shared.card, s.card]}>
      <Text style={shared.sectionTitle}>Agent channels</Text>
      <View style={s.row}>
        <Text style={shared.body}>Slack</Text>
        <Text style={[shared.small, s.wrap]}>
          {connected ? connection.workspace_name : "Not connected"}
        </Text>
        {connected && (
          <MoreMenu
            label="Slack connection options"
            title="Slack"
            disabled={state.busy}
            actions={[
              {
                label: "Disconnect Slack",
                destructive: true,
                onPress: () => void store.disconnect(),
              },
            ]}
          />
        )}
      </View>
      <Text style={shared.small}>
        Background updates and one Overnight morning notice. Decisions open in
        Orbyn.
      </Text>
      {!state.status && !state.error && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Loading connection…
        </Text>
      )}
      {state.status && !state.status.configured && (
        <Text style={shared.small}>
          Slack connection setup is unavailable. Existing permissions can still
          be turned off.
        </Text>
      )}
      {connected && (
        <>
          <Text selectable style={shared.small}>
            Slack account: {connection.external_user_id}
            {"\n"}Workspace: {connection.workspace_id}
            {"\n"}
            {connection.token_expires_at
              ? `Token expires ${new Date(connection.token_expires_at).toLocaleString()}`
              : "No token expiry reported"}
          </Text>
          <View style={s.row}>
            <Text style={[shared.body, s.wrap]}>Send agent DMs to me</Text>
            <Switch
              accessibilityLabel="Send agent DMs to me"
              value={connection.dm_enabled}
              disabled={
                state.busy ||
                (!state.status?.configured && !connection.dm_enabled)
              }
              trackColor={{ true: colors.accent }}
              onValueChange={(enabled) => void store.permission(enabled)}
            />
          </View>
        </>
      )}
      {pending?.state === "ready" && pending.identity && (
        <View style={s.review}>
          <Text style={shared.label}>Review connection</Text>
          <Text selectable style={shared.body}>
            {pending.identity.workspace_name} · {pending.identity.workspace_id}
          </Text>
          <Text selectable style={shared.small}>
            Slack account: {pending.identity.external_user_id}
            {"\n"}Granted scopes: {pending.identity.bot_scopes.join(", ")}
          </Text>
          <View style={s.row}>
            <Text style={[shared.body, s.wrap]}>
              Allow Background and Overnight DMs
            </Text>
            <Switch
              accessibilityLabel="Allow Background and Overnight DMs"
              value={dm}
              disabled={state.busy}
              trackColor={{ true: colors.accent }}
              onValueChange={setDm}
            />
          </View>
          <View style={s.actions}>
            <SmallAction
              label="Confirm connection"
              disabled={
                state.busy || Date.parse(pending.expires_at) <= Date.now()
              }
              onPress={() => void store.confirm(dm)}
            />
            <SmallAction
              label="Cancel"
              disabled={state.busy}
              onPress={store.cancel}
            />
          </View>
        </View>
      )}
      {pending && pending.state !== "ready" && (
        <>
          <Text style={shared.small} accessibilityLiveRegion="polite">
            {["pending", "exchanging"].includes(pending.state)
              ? "Finish in Slack, then return here."
              : "Connection request ended. Start again to reconnect."}
          </Text>
          {state.authorizationUrl && (
            <SmallAction
              label="Open Slack authorization"
              disabled={state.busy}
              onPress={() => {
                void open(state.authorizationUrl!).catch(() => undefined);
              }}
            />
          )}
        </>
      )}
      <View style={s.actions}>
        {state.status?.configured &&
          !["pending", "exchanging", "ready"].includes(
            pending?.state ?? "",
          ) && (
            <SmallAction
              label={connected ? "Reconnect Slack" : "Connect Slack"}
              disabled={state.busy}
              onPress={() => void store.start(open)}
            />
          )}
        <SmallAction
          label="Refresh"
          disabled={state.busy}
          onPress={() => void store.refresh()}
        />
        {pending && ["pending", "exchanging"].includes(pending.state) && (
          <SmallAction
            label="Cancel request"
            disabled={state.busy}
            onPress={store.cancel}
          />
        )}
      </View>
      {state.error && (
        <Text
          accessibilityRole="alert"
          style={[shared.small, { color: colors.danger }]}
        >
          {state.error}
        </Text>
      )}
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    card: { gap: 12 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    wrap: { flex: 1, flexShrink: 1 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    review: {
      gap: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
    },
  }),
);
