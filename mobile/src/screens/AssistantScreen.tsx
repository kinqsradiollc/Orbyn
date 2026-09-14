import React from "react";
import { Text, TextInput, View } from "react-native";
import type { Item } from "@orbyn/core";
import { Button } from "../components/Button";
import { ProposalReview } from "../components/ProposalReview";
import type { Assistant } from "../hooks/useAssistant";
import { shared } from "../styles";

export function AssistantScreen({
  assistant,
  items,
  busy,
}: {
  assistant: Assistant;
  items: Item[];
  busy: boolean;
}) {
  const { message, setMessage, proposal, ask, apply, discard } = assistant;
  return (
    <>
      <View style={shared.aiCard}>
        <Text style={shared.sectionTitle}>What’s on your mind?</Text>
        <Text style={shared.subtitle}>
          Ask for a summary or changes to your plans. You review every change
          before it’s saved.
        </Text>
        <Button
          secondary
          title="Summarize my week ↗"
          disabled={busy}
          onPress={() => ask("Summarize my week")}
        />
      </View>
      {proposal && (
        <ProposalReview
          proposal={proposal}
          items={items}
          busy={busy}
          onApprove={apply}
          onDiscard={discard}
        />
      )}
      <TextInput
        style={[shared.input, { minHeight: 85 }]}
        multiline
        placeholder="Ask Orbyn…"
        value={message}
        onChangeText={setMessage}
        maxLength={4000}
      />
      <Button
        title={busy ? "Thinking…" : "Send →"}
        disabled={busy || !message.trim()}
        onPress={() => ask()}
      />
      <Text style={shared.small}>
        Your request and up to 100 recent items are shared with the configured
        AI provider.
      </Text>
    </>
  );
}
