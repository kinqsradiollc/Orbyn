import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { TeamsChannelStore } from "@orbyn/api-client";
import { client } from "../lib/api";
import {
  session,
  loadTeamsInstallation,
  saveTeamsInstallation,
} from "../lib/session";
import { Switch } from "../components/Switch";
import { MoreMenu } from "../components/MoreMenu";
import { SmallAction } from "../components/SmallAction";
import { ErrorBanner } from "../components/ErrorBanner";
import { shared } from "../styles";
import { colors, radii, themed } from "../theme";
/** Review the same owned Microsoft identity and personal conversation as the web client. */
export function TeamsChannelSettings({
  onBusyChange,
}: { onBusyChange?: (busy: boolean) => void } = {}) {
  const token = session.token;
  const store = useMemo(
    () =>
      new TeamsChannelStore(
        client,
        () => session.token,
        (id) => {
          void saveTeamsInstallation(id);
        },
      ),
    [token],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [openError, setOpenError] = useState("");
  useEffect(() => {
    onBusyChange?.(state.busy);
    return () => onBusyChange?.(false);
  }, [state.busy, onBusyChange]);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    setOpenError("");
    return () => {
      live.current = false;
    };
  }, [store]);
  useEffect(() => {
    let active = true;
    void loadTeamsInstallation().then((id) => {
      if (active) void store.restore(id);
    });
    return () => {
      active = false;
      store.dispose();
    };
  }, [store]);
  const pending = state.installation,
    connection = state.status?.connection;
  useEffect(() => {
    const deadline =
      state.challenge?.expiresAt ??
      (pending && ["pending", "exchanging"].includes(pending.state)
        ? pending.expires_at
        : null);
    if (!deadline || state.busy) return;
    const remaining = Date.parse(deadline) - Date.now();
    if (remaining <= 0) {
      store.expireChallenge();
      return;
    }
    const timer = setTimeout(
      () => void store.refresh(),
      Math.min(10000, remaining),
    );
    return () => clearTimeout(timer);
  }, [store, pending, state.challenge, state.busy]);
  const active = connection && connection.state !== "disconnected";
  const open = async (url: string) => {
    if (live.current && token === session.token) setOpenError("");
    try {
      await Linking.openURL(url);
    } catch (error) {
      if (live.current && token === session.token)
        setOpenError("Couldn't open Microsoft sign-in. Try again.");
      throw error;
    }
  };
  return (
    <View style={s.body}>
      <View style={s.row}>
        <Text style={shared.label}>Microsoft Teams</Text>
        <Text style={[shared.small, s.wrap]}>
          {active
            ? connection.display_name
            : state.status
              ? "Not connected"
              : state.error
                ? "Unavailable"
                : "Loading…"}
        </Text>
        {active && (
          <MoreMenu
            label="Teams connection options"
            title="Teams"
            disabled={state.busy}
            actions={[
              {
                label: "Disconnect Teams",
                destructive: true,
                onPress: () => void store.disconnect(),
              },
            ]}
          />
        )}
      </View>
      {!state.status && !state.error && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          Loading connection…
        </Text>
      )}
      {state.status && !state.status.configured && (
        <Text style={shared.small}>Teams setup is unavailable.</Text>
      )}
      {active && (
        <>
          <Text style={shared.small} accessibilityLiveRegion="polite">
            {connection.state === "linked"
              ? "Personal chat linked"
              : connection.state === "reconnect"
                ? "Reconnect required"
                : "Link your personal chat"}
          </Text>
          {connection.state === "linked" && (
            <>
              <View style={s.row}>
                <Text style={[shared.body, s.wrap]}>Send agent DMs to me</Text>
                <Switch
                  accessibilityLabel="Send Teams agent DMs to me"
                  value={connection.dm_enabled}
                  disabled={
                    state.busy ||
                    (!state.status?.delivery_available &&
                      !connection.dm_enabled)
                  }
                  trackColor={{ true: colors.accent }}
                  onValueChange={(enabled) => void store.permission(enabled)}
                />
              </View>
              <Text style={shared.small}>
                Background questions and updates; Overnight results.
              </Text>
            </>
          )}
          {state.status && !state.status.delivery_available && (
            <Text style={shared.small}>
              Ask your administrator to configure Teams messaging.
            </Text>
          )}
        </>
      )}
      {pending?.state === "ready" && pending.identity && (
        <View style={s.review}>
          <Text style={shared.label}>{pending.identity.displayName}</Text>
          <Text selectable style={shared.small}>
            Tenant: {pending.identity.tenantId}
            {"\n"}Account: {pending.identity.objectId}
          </Text>
          <View style={s.actions}>
            <SmallAction
              label="Use this account"
              disabled={
                state.busy || Date.parse(pending.expires_at) <= Date.now()
              }
              onPress={() => void store.confirm()}
            />
            <SmallAction
              label="Cancel"
              disabled={state.busy}
              onPress={store.cancel}
            />
          </View>
        </View>
      )}
      {state.challenge && (
        <View style={s.review}>
          <Text style={shared.small}>
            Send this command to Orbyn in your personal Teams chat.
          </Text>
          <Text selectable style={shared.body}>
            {state.challenge.command}
          </Text>
          <Text style={shared.small}>
            Expires {new Date(state.challenge.expiresAt).toLocaleTimeString()}.
            Messaging stays off until you enable it.
          </Text>
        </View>
      )}
      {pending && pending.state !== "ready" && (
        <Text style={shared.small} accessibilityLiveRegion="polite">
          {["pending", "exchanging"].includes(pending.state)
            ? "Finish Microsoft sign-in, then return here."
            : pending.state === "confirmed"
              ? "Account reviewed. Link your personal chat."
              : "Request ended. Connect again to continue."}
        </Text>
      )}
      {state.authorizationUrl && (
        <SmallAction
          label="Open Microsoft sign-in"
          disabled={state.busy}
          onPress={() =>
            void open(state.authorizationUrl!).catch(() => undefined)
          }
        />
      )}
      <View style={s.actions}>
        {state.status?.configured &&
          !["pending", "exchanging", "ready"].includes(pending?.state ?? "") &&
          (!active || connection.state === "reconnect") && (
            <SmallAction
              label="Connect Teams"
              disabled={state.busy}
              onPress={() => void store.start(open)}
            />
          )}
        {state.status?.configured &&
          active &&
          connection.state === "awaiting_conversation" &&
          !state.challenge && (
            <SmallAction
              label="Get linking command"
              disabled={state.busy}
              onPress={() => void store.renewLink()}
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
      <ErrorBanner error={openError} onDismiss={() => setOpenError("")} />
      {!!state.error && (
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
    body: {
      gap: 12,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
    },
    wrap: { flex: 1, flexShrink: 1, minWidth: 0, flexBasis: 140 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    review: {
      gap: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
    },
  }),
);
