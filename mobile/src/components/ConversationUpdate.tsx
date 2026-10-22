import { AskAboutMessage, CopyMessage } from "./ConversationMessage";
import React from "react";
import { Text, View } from "react-native";
import type { AssistantConversationEntry } from "@orbyn/core";
import { SmallAction } from "./SmallAction";
import { shared } from "../styles";
import { colors } from "../theme";

/** Delivery is conversation content; execution and approval remain in existing work views. */
export function ConversationUpdate({
  entry,
  busy,
  onReply,
  onWork,
  onActivity,
  onDetails,
  onSelectExcerpt,
}: {
  entry: Extract<AssistantConversationEntry, { kind: "update" }>;
  busy: boolean;
  onReply: () => void;
  onWork: (id: string) => void;
  onActivity: (lane: "background" | "overnight") => void;
  onDetails: () => void;
  onSelectExcerpt: (excerpt: string) => boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={
          entry.event === "failure"
            ? [shared.small, { color: colors.danger }]
            : shared.small
        }
      >
        {entry.lane === "overnight" ? "Overnight" : "Background"}
      </Text>
      <Text selectable style={shared.body}>
        {entry.text}
      </Text>
      <View
        style={{
          alignItems: "flex-start",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <CopyMessage text={entry.text} />
        {entry.event === "question" && entry.actionable === false ? (
          <Text style={shared.small}>Closed</Text>
        ) : entry.event !== "question" || entry.waiting_kind === "person" ? (
          <SmallAction
            quiet
            label={entry.event === "question" ? "Answer" : "Reply"}
            disabled={busy}
            onPress={onReply}
          />
        ) : (
          <SmallAction
            quiet
            label="Review"
            disabled={busy}
            onPress={() =>
              entry.execution_chat_id
                ? onWork(entry.execution_chat_id)
                : onActivity(entry.lane)
            }
          />
        )}
        <SmallAction
          quiet
          label="Details"
          disabled={false}
          onPress={onDetails}
        />
        <AskAboutMessage text={entry.text} onSelect={onSelectExcerpt} />
      </View>
    </View>
  );
}
