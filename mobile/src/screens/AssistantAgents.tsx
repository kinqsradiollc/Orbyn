import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { AppState, Text, View } from "react-native";
import { AssistantProfileStore } from "@orbyn/api-client";
import type { PersonalAgentSettings } from "@orbyn/core";
import { BottomSheet } from "../components/BottomSheet";
import { Character } from "../components/Character";
import { Button } from "../components/Button";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { shared } from "../styles";

/** Same evidence and character as web, in the existing safe-area scrolling sheet. */
export function AssistantAgents({
  visible,
  identity,
  onClose,
}: {
  visible: boolean;
  identity: PersonalAgentSettings | null;
  onClose: () => void;
}) {
  const store = useMemo(
    () => new AssistantProfileStore(client, () => session.token),
    [],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    if (!visible) return;
    void store.refresh();
    const refresh = () => {
      if (AppState.currentState === "active") void store.refresh();
    };
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void store.refresh();
    });
    const timer = setInterval(refresh, 15000);
    return () => {
      store.reset();
      clearInterval(timer);
      listener.remove();
    };
  }, [visible, store]);
  return (
    <BottomSheet
      title="Your agents"
      visible={visible}
      onClose={onClose}
      footer={
        <Button
          title={snapshot.loading ? "Refreshing…" : "Refresh status"}
          disabled={snapshot.loading}
          onPress={() => void store.refresh()}
        />
      }
    >
      <Text style={shared.small}>
        Background and Overnight work independently. They start when authorized
        work is ready.
      </Text>
      {snapshot.error && (
        <Text accessibilityRole="alert" style={shared.small}>
          Agent status could not be refreshed. Try again.
        </Text>
      )}
      {!snapshot.data && !snapshot.error && (
        <Text style={shared.small}>Loading agent profiles…</Text>
      )}
      {snapshot.data?.profiles.map((profile) => (
        <View
          key={profile.lane}
          style={[shared.card, { marginVertical: 8, gap: 10 }]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Character
              appearance={identity?.character}
              name={identity?.name ?? "Orbyn"}
              state={
                profile.state === "working"
                  ? "working"
                  : profile.state === "waiting"
                    ? "waiting"
                    : "ready"
              }
              size={56}
            />
            <View style={{ flex: 1 }}>
              <Text style={shared.sectionTitle}>
                {profile.lane === "background" ? "Background" : "Overnight"}
              </Text>
              <Text style={shared.small}>
                {profile.state === "queued" &&
                profile.counts.recovering > 0 &&
                profile.counts.queued === 0
                  ? "Recovery pending"
                  : {
                      idle: "Idle",
                      queued: "Queued",
                      working: "Working",
                      waiting: "Waiting for your decision",
                      scheduled: "Scheduled window",
                    }[profile.state]}
              </Text>
            </View>
          </View>
          <Text style={shared.small}>
            {profile.last_activity_at
              ? `Last work ${new Date(profile.last_activity_at).toLocaleString()}`
              : "No recent work"}
          </Text>
          <Text style={shared.small}>
            {profile.counts.working} working · {profile.counts.waiting} waiting
            · {profile.counts.queued} queued
            {profile.counts.recovering > 0 &&
              ` · ${profile.counts.recovering} recovering`}
          </Text>
          {profile.window && (
            <Text style={shared.small}>
              {profile.window.enabled
                ? `Night window ${profile.window.start}–${profile.window.end} (${profile.window.timezone})`
                : "Night shift is off"}
            </Text>
          )}
          {profile.window?.next_start_at && (
            <Text style={shared.small}>
              Next window{" "}
              {new Date(profile.window.next_start_at).toLocaleString()}
            </Text>
          )}
          {profile.budget && (
            <Text style={shared.small}>
              {profile.budget.estimated_tokens.toLocaleString()} estimated
              tokens
              {profile.budget.local_day
                ? ` for ${profile.budget.local_day}`
                : " this night"}{" "}
              · current night limit{" "}
              {profile.budget.limit_tokens.toLocaleString()}. Estimates are not
              billed usage.
            </Text>
          )}
        </View>
      ))}
      {snapshot.data && (
        <Text style={shared.small}>
          Status as of{" "}
          {new Date(snapshot.data.observed_at).toLocaleTimeString()}
        </Text>
      )}
    </BottomSheet>
  );
}
