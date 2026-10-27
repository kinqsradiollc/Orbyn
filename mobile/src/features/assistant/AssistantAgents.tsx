import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AppState, Text, View } from "react-native";
import { AssistantProfileStore } from "@orbyn/api-client";
import { ASSISTANT_ACTIVITY_LABELS } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { InlineDetails } from "../../components/InlineDetails";
import { Character } from "../../components/Character";
import { Button } from "../../components/Button";
import { AssistantHandoffAction } from "../settings/AssistantHandoffAction";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { shared } from "../../styles";

/** Same evidence and character as web, in the existing safe-area scrolling sheet. */
export function AssistantAgents({
  visible,
  lane,
  onClose,
  onOpenChat,
  canOpen,
}: {
  visible: boolean;
  lane?: "background" | "overnight";
  onClose: () => void;
  onOpenChat: (id: string) => void;
  canOpen: boolean;
}) {
  const store = useMemo(
    () => new AssistantProfileStore(client, () => session.token),
    [],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const owner = session.token;
  const pendingChat = useRef<{ id: string; owner: string } | null>(null);
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
  }, [visible, store, owner]);
  return (
    <BottomSheet
      title={
        lane === "background"
          ? "Background"
          : lane === "overnight"
            ? "Overnight"
            : "Your agents"
      }
      visible={visible}
      onClose={onClose}
      afterClose={() => {
        const choice = pendingChat.current;
        pendingChat.current = null;
        if (choice && choice.owner === session.token && canOpen)
          onOpenChat(choice.id);
      }}
      footer={
        <Button
          title={snapshot.loading ? "Refreshing…" : "Refresh status"}
          disabled={snapshot.loading}
          onPress={() => void store.refresh()}
        />
      }
    >
      {snapshot.error && (
        <Text accessibilityRole="alert" style={shared.small}>
          Agent status could not be refreshed. Try again.
        </Text>
      )}
      {visible && !snapshot.data && !snapshot.error && (
        <Text style={shared.small}>Loading activity…</Text>
      )}
      {snapshot.data?.profiles
        .filter((profile) => !lane || profile.lane === lane)
        .map((profile) => (
          <View
            key={profile.lane}
            style={[shared.card, { marginVertical: 8, gap: 10 }]}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 14 }}
            >
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
                size={32}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={shared.label}>
                  {profile.identity?.name ??
                    (profile.lane === "background"
                      ? "Background"
                      : "Overnight")}
                </Text>
                <Text style={shared.small}>
                  {profile.identity?.name &&
                    profile.identity.name !==
                      (profile.lane === "background"
                        ? "Background"
                        : "Overnight") &&
                    `${profile.lane === "background" ? "Background" : "Overnight"} · `}
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
            {profile.last_activity_at && (
              <InlineDetails title="Last activity">
                <Text style={shared.small}>
                  {new Date(profile.last_activity_at).toLocaleString()}
                </Text>
              </InlineDetails>
            )}
            {!profile.runtime.reporting && (
              <Text accessibilityLiveRegion="polite" style={shared.small}>
                Worker not responding
              </Text>
            )}
            {(profile.counts.working > 0 ||
              profile.counts.waiting > 0 ||
              profile.counts.queued > 0 ||
              profile.counts.recovering > 0) && (
              <Text style={shared.small}>
                {[
                  profile.counts.working > 0 &&
                    `${profile.counts.working} working`,
                  profile.counts.waiting > 0 &&
                    `${profile.counts.waiting} waiting`,
                  profile.counts.queued > 0 &&
                    `${profile.counts.queued} queued`,
                  profile.counts.recovering > 0 &&
                    `${profile.counts.recovering} recovering`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            )}
            {profile.window && (
              <Text style={shared.small}>
                {profile.window.enabled
                  ? `Night shift ${profile.window.start}–${profile.window.end} · ${profile.window.timezone}`
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
                Night estimate{" "}
                {profile.budget.estimated_tokens.toLocaleString()}/
                {profile.budget.limit_tokens.toLocaleString()} tokens
              </Text>
            )}
            {(profile.recent_activity.length > 0 ||
              profile.outputs.length > 0) && (
              <InlineDetails title="Activity and results">
                {profile.recent_activity.map((event) => (
                  <View key={event.sequence} style={{ gap: 4 }}>
                    <Text style={shared.small}>
                      {ASSISTANT_ACTIVITY_LABELS[event.kind]}
                    </Text>
                    <Text style={shared.small}>
                      {new Date(event.created_at).toLocaleString()}
                    </Text>
                  </View>
                ))}
                {profile.outputs.map((output) => (
                  <View key={output.job_id} style={{ gap: 4 }}>
                    <Button
                      title={output.title || "Completed work"}
                      secondary
                      disabled={!canOpen}
                      onPress={() => {
                        pendingChat.current = {
                          id: output.chat_id,
                          owner: session.token,
                        };
                        onClose();
                      }}
                    />
                    <Text style={shared.small}>
                      {new Date(output.completed_at).toLocaleString()}
                    </Text>
                    <AssistantHandoffAction
                      jobId={output.job_id}
                      title={output.title}
                      lane={profile.lane}
                      existing={output.handoff}
                      onOpenChat={(id) => {
                        pendingChat.current = { id, owner: session.token };
                        onClose();
                      }}
                    />
                  </View>
                ))}
              </InlineDetails>
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
