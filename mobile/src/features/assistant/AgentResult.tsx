import React from "react";
import { Text, View } from "react-native";
import {
  ASSISTANT_OUTCOME_LABELS,
  assistantOutcomeDetails,
  type AssistantProfile,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { InlineDetails } from "../../components/InlineDetails";
import { AssistantHandoffAction } from "../settings/AssistantHandoffAction";
import { shared } from "../../styles";

type Output = AssistantProfile["outputs"][number];
export function AgentResult({
  output,
  lane,
  canOpen,
  onOpenChat,
}: {
  output: Output;
  lane: "background" | "overnight";
  canOpen: boolean;
  onOpenChat: (id: string) => void;
}) {
  const receipt = output.execution_outcome;
  return (
    <View style={{ gap: 6, paddingVertical: 10 }}>
      <Text style={shared.body}>{output.title || "Untitled result"}</Text>
      <Text style={shared.small}>
        {receipt
          ? ASSISTANT_OUTCOME_LABELS[receipt.outcome]
          : output.state === "failed"
            ? "Run failed"
            : "Run finished · Review outcome"}
      </Text>
      {output.summary && (
        <Text style={shared.body} numberOfLines={4}>
          {output.summary}
        </Text>
      )}
      <Text style={shared.small}>
        {new Date(output.completed_at).toLocaleString()}
      </Text>
      <Button
        title={
          receipt?.outcome === "waiting" ? "Review decision" : "Open result"
        }
        secondary
        disabled={!canOpen}
        onPress={() => onOpenChat(output.chat_id)}
      />
      {receipt && (
        <InlineDetails title="Evidence & open questions">
          {assistantOutcomeDetails(receipt).map((line, index) => (
            <Text key={index} style={shared.small}>
              {line}
            </Text>
          ))}
        </InlineDetails>
      )}
      <InlineDetails title="Continue this work">
        <AssistantHandoffAction
          jobId={output.job_id}
          title={output.title}
          lane={lane}
          existing={output.handoff}
          onOpenChat={onOpenChat}
        />
      </InlineDetails>
    </View>
  );
}
