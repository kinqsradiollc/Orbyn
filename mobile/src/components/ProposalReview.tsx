import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { dateLabel, type Item, type Proposal } from "@orbyn/core";
import { Button } from "./Button";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

const OPERATION = {
  create: { label: "New", bg: colors.accentSoft, fg: colors.accent },
  update: { label: "Update", bg: colors.mediumBg, fg: colors.mediumText },
  delete: { label: "Delete", bg: colors.dangerSoft, fg: colors.danger },
} as const;

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
      <Text style={shared.eyebrow}>ORBYN SUGGESTS</Text>
      <Text style={shared.body}>{proposal.summary}</Text>
      {proposal.actions.map((a, n) => {
        const op = OPERATION[a.operation];
        return (
          <View key={n} style={s.action}>
            <View style={s.actionHead}>
              <View style={[s.op, { backgroundColor: op.bg }]}>
                <Text style={[s.opText, { color: op.fg }]}>{op.label}</Text>
              </View>
              <Text style={s.actionTitle} numberOfLines={2}>
                {a.data?.title ||
                  items.find((i) => i.id === a.item_id)?.title ||
                  a.item_id}
              </Text>
            </View>
            {a.data && (
              <>
                {!!a.data.notes && (
                  <Text style={shared.body}>{a.data.notes}</Text>
                )}
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
        );
      })}
      {proposal.actions.length > 0 && (
        <View style={s.buttons}>
          <Button
            title={`Approve ${proposal.actions.length} ${proposal.actions.length === 1 ? "change" : "changes"}`}
            icon="check"
            disabled={busy}
            onPress={onApprove}
          />
          <Button secondary title="Discard" onPress={onDiscard} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  action: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: 14,
    marginTop: 12,
    gap: 6,
  },
  actionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  op: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  opText: { fontFamily: fonts.semibold, fontSize: 11 },
  actionTitle: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },
  buttons: { marginTop: 8 },
});
