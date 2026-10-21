import React, { useState } from "react";
import { Text, View } from "react-native";
import type { AssistantConversationEntry, AssistantSource } from "@orbyn/core";
import { InlineDetails } from "./InlineDetails";
import { SmallAction } from "./SmallAction";
import { shared } from "../styles";
import { colors } from "../theme";
import { client } from "../lib/api";

/** Delivery is conversation content; execution and approval remain in existing work views. */
export function ConversationUpdate({
  entry,
  busy,
  onReply,
  onWork,
  onActivity,
  onSource,
  onRefresh,
}: {
  entry: Extract<AssistantConversationEntry, { kind: "update" }>;
  busy: boolean;
  onReply: () => void;
  onWork: (id: string) => void;
  onActivity: (lane: "background" | "overnight") => void;
  onSource?: (source: AssistantSource) => void;
  onRefresh: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={
          entry.event === "failure"
            ? [shared.small, { color: colors.danger }]
            : shared.small
        }
      >
        {entry.lane === "overnight" ? "Overnight" : "Background"} ·{" "}
        {new Date(entry.created_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </Text>
      <Text selectable style={shared.body}>
        {entry.text}
      </Text>
      <View style={{ alignItems: "flex-start" }}>
        {entry.event === "question" && entry.actionable === false ? (
          <Text style={shared.small}>Closed</Text>
        ) : entry.event !== "question" || entry.waiting_kind === "person" ? (
          <SmallAction label="Reply" disabled={busy} onPress={onReply} />
        ) : (
          <SmallAction
            label="Review request"
            disabled={busy}
            onPress={() =>
              entry.execution_chat_id
                ? onWork(entry.execution_chat_id)
                : onActivity(entry.lane)
            }
          />
        )}
      </View>
      <InlineDetails title="Details">
        {entry.night_runs?.map((run) => (
          <View key={`${run.work.kind}:${run.work.id}`} style={{ gap: 4 }}>
            <Text style={shared.small}>
              {run.state === "done"
                ? "Finished"
                : run.state === "waiting"
                  ? "Needs review"
                  : run.state === "failed"
                    ? "Couldn’t finish"
                    : run.state === "cancelled"
                      ? "Stopped"
                      : "Still working"}
            </Text>
            <Text selectable style={shared.body}>
              {run.text}
            </Text>
          </View>
        ))}
        <SmallAction
          disabled={busy}
          label={
            entry.execution_chat_id
              ? "View work"
              : entry.work.kind === "night"
                ? "Review night"
                : "View activity"
          }
          onPress={() =>
            entry.execution_chat_id
              ? onWork(entry.execution_chat_id)
              : onActivity(entry.lane)
          }
        />
        {entry.sources
          .filter((source) => source.kind === "doc" || source.kind === "task")
          .map((source) => (
            <SmallAction
              key={`${source.kind}:${source.id}`}
              label={source.kind === "doc" ? "Page" : "Task"}
              disabled={busy || !onSource}
              onPress={() =>
                onSource?.(
                  source.kind === "doc"
                    ? {
                        doc_id: source.id,
                        block_id: null,
                        title: "Page",
                        quote: "",
                      }
                    : { kind: "task", id: source.id, title: "Task", quote: "" },
                )
              }
            />
          ))}
        {entry.work.kind === "job" &&
          entry.event === "question" &&
          entry.actionable !== false && (
            <SmallAction
              label="Stop work"
              destructive
              disabled={busy || stopping}
              onPress={() => {
                setStopping(true);
                setError("");
                void client
                  .stopAssistantRun(entry.work.id)
                  .then(onRefresh, () =>
                    setError("Couldn't stop this work. Try again."),
                  )
                  .finally(() => setStopping(false));
              }}
            />
          )}
      </InlineDetails>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={[shared.small, { color: colors.danger }]}
        >
          {error}
        </Text>
      )}
    </View>
  );
}
