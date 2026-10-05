import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState, Text, View } from "react-native";
import { AssistantProfileStore } from "@orbyn/api-client";
import { ASSISTANT_ACTIVITY_LABELS } from "@orbyn/core";
import { BottomSheet } from "../components/BottomSheet";
import { Character } from "../components/Character";
import { Button } from "../components/Button";
import { client } from "../lib/api";
import { session } from "../lib/session";
import { shared } from "../styles";

/** Same evidence and character as web, in the existing safe-area scrolling sheet. */
export function AssistantAgents({
  visible,
  onClose,
  onOpenChat,
  canOpen,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenChat: (id: string) => void;
  canOpen: boolean;
}) {
  const store = useMemo(
    () => new AssistantProfileStore(client, () => session.token),
    [],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const pendingChat = useRef<string | null>(null);
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
      afterClose={() => {
        const id = pendingChat.current;
        pendingChat.current = null;
        if (id) onOpenChat(id);
      }}
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
      {visible && !snapshot.data && !snapshot.error && (
        <Text style={shared.small}>Loading agent profiles…</Text>
      )}
      {snapshot.data?.profiles.map((profile) => (
        <View
          key={profile.lane}
          style={[shared.card, { marginVertical: 8, gap: 10 }]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Character
              appearance={profile.identity?.character}
              name={
                profile.identity?.name ??
                (profile.lane === "background" ? "Background" : "Overnight")
              }
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
          <Text style={shared.body}>Recent activity</Text>
          {profile.recent_activity.length === 0 ? (
            <Text style={shared.small}>No recent activity</Text>
          ) : (
            profile.recent_activity.map((event) => (
              <View key={event.sequence} style={{ gap: 4 }}>
                <Text style={shared.small}>
                  {ASSISTANT_ACTIVITY_LABELS[event.kind]}
                </Text>
                <Text style={shared.small}>
                  {new Date(event.created_at).toLocaleString()}
                </Text>
              </View>
            ))
          )}
          <Text style={shared.body}>Outputs</Text>
          {profile.outputs.length === 0 ? (
            <Text style={shared.small}>No recent outputs</Text>
          ) : (
            profile.outputs.map((output) => (
              <View key={output.job_id} style={{ gap: 4 }}>
                <Button
                  title={output.title || "Completed work"}
                  secondary
                  disabled={!canOpen}
                  onPress={() => {
                    pendingChat.current = output.chat_id;
                    onClose();
                  }}
                />
                <Text style={shared.small}>
                  {new Date(output.completed_at).toLocaleString()}
                </Text>
              </View>
            ))
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
