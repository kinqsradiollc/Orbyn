import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { AssistantProfile } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { SmallAction } from "../../components/SmallAction";
import { ActionSheet } from "../../components/MoreMenu";
import { shared } from "../../styles";

type Work = NonNullable<AssistantProfile["work"]>;
export function CurrentAgentWork({
  work,
  truncated,
  onOpenChat,
  onRefresh,
  canOpen,
}: {
  work: Work;
  truncated?: boolean;
  onOpenChat: (id: string) => void;
  onRefresh: () => Promise<void>;
  canOpen: boolean;
}) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const mounted = useRef(true);
  const stopLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [stopping, setStopping] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const latest = useRef(work);
  latest.current = work;
  const owner = { token: session.token, generation: session.generation };
  const current = () =>
    mounted.current &&
    session.token === owner.token &&
    session.generation === owner.generation;
  const stop = async () => {
    const item = latest.current.find((work) => work.job_id === confirm);
    if (!item || item.cancel_requested || stopLock.current || !current())
      return;
    stopLock.current = true;
    setConfirm(null);
    setStopping(item.job_id);
    setError("");
    try {
      await client.stopAssistantRun(item.job_id);
      if (!current()) return;
      setRequested((previous) => new Set(previous).add(item.job_id));
      await onRefresh();
    } catch {
      if (current())
        setError(
          "Couldn’t confirm the stop request. Refresh current work before trying again.",
        );
    } finally {
      stopLock.current = false;
      if (current()) setStopping(null);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Text style={shared.sectionTitle}>Current work</Text>
      {error && (
        <Text style={shared.small} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {!work.length && <Text style={shared.small}>No admitted runs.</Text>}
      {[...work]
        .sort(
          (a, b) =>
            Number(b.state === "waiting") - Number(a.state === "waiting"),
        )
        .map((item) => (
          <View key={item.job_id} style={{ gap: 6, paddingVertical: 8 }}>
            <Text style={shared.body}>{item.title || "Untitled work"}</Text>
            <Text style={shared.small}>
              {item.cancel_requested || requested.has(item.job_id)
                ? "Stop requested · Awaiting confirmation"
                : item.recovering
                  ? "Recovery pending"
                  : item.state === "waiting"
                    ? "Waiting for you"
                    : item.state === "queued"
                      ? "Queued"
                      : "Running"}
            </Text>
            <Text style={shared.small}>
              {new Date(item.updated_at).toLocaleString()}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <SmallAction
                label={
                  item.state === "waiting" ? "Review decision" : "Open work"
                }
                disabled={!canOpen}
                onPress={() => {
                  if (current()) onOpenChat(item.chat_id);
                }}
              />
              <SmallAction
                quiet
                label={
                  stopping === item.job_id
                    ? "Requesting stop…"
                    : "Stop this run"
                }
                disabled={
                  !!stopping ||
                  item.cancel_requested ||
                  requested.has(item.job_id)
                }
                onPress={() => setConfirm(item.job_id)}
              />
            </View>
          </View>
        ))}
      {truncated && <Text style={shared.small}>Showing 20 current runs.</Text>}
      <ActionSheet
        visible={!!confirm}
        label="Stop current work"
        title="Stop this run?"
        message="Requests cancellation. Changes already applied remain available for review and undo."
        actions={[
          {
            label: "Stop run",
            destructive: true,
            disabled: !!stopping,
            onPress: () => void stop(),
          },
        ]}
        onClose={() => setConfirm(null)}
      />
    </View>
  );
}
