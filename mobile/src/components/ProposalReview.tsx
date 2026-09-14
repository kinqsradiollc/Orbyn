import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { dateLabel, type Item, type Proposal } from "@orbyn/core";
import { Button } from "./Button";
import { shared } from "../styles";

export function ProposalReview({
  proposal,
  items,
  busy,
  onApprove,
  onDiscard,
}: {
  proposal: Proposal;
  /** Current planner items, used to name items an action refers to by id. */
  items: Item[];
  busy: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  return (
    <View style={shared.card}>
      <Text style={shared.body}>{proposal.summary}</Text>
      {proposal.actions.map((a, n) => (
        <View key={n} style={s.action}>
          <Text style={shared.itemTitle}>
            {a.operation.toUpperCase()} ·{" "}
            {a.data?.title ||
              items.find((i) => i.id === a.item_id)?.title ||
              a.item_id}
          </Text>
          {a.data && (
            <>
              <Text style={shared.body}>{a.data.notes}</Text>
              <Text style={shared.small}>
                {a.data.kind} · {a.data.status} · {a.data.priority} priority
                {"\n"}
                {dateLabel(a.data.due_at)}
                {a.data.end_at && " → " + dateLabel(a.data.end_at)}
                {"\n"}Remind {a.data.reminder_minutes} min before
              </Text>
            </>
          )}
        </View>
      ))}
      {proposal.actions.length > 0 && (
        <>
          <Button
            title={`Approve ${proposal.actions.length} changes`}
            disabled={busy}
            onPress={onApprove}
          />
          <Button secondary title="Discard" onPress={onDiscard} />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  action: { borderTopWidth: 1, borderTopColor: "#e3e9da", paddingVertical: 15 },
});
