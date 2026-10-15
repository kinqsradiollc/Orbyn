import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { type DocSuggestion } from "@orbyn/core";
import { InlineDetails } from "../../components/InlineDetails";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * Changes people have proposed, waiting to be taken or left.
 *
 * Each card shows the words as they stand and the words proposed instead,
 * so the decision can be made without reading the page twice. A proposal
 * whose words have since gone is kept and shown, but not offered as a
 * decision: there is nothing left to apply it to.
 */
export function DocSuggestions({
  suggestions,
  canDecide,
  userId,
  busy,
  onDecide,
  onWithdraw,
  sourceBlockIds,
}: {
  suggestions: DocSuggestion[];
  canDecide: boolean;
  userId?: string;
  busy: boolean;
  onDecide: (s: DocSuggestion, take: boolean) => void;
  onWithdraw: (s: DocSuggestion) => void;
  sourceBlockIds?: ReadonlySet<string>;
}) {
  const open = suggestions.filter((s) => s.status === "open");
  if (!open.length) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>
        {open.length} proposed change{open.length === 1 ? "" : "s"}
      </Text>
      {open.map((one) => (
        <View key={one.id} style={[s.card, one.detached && s.faded]}>
          <Text style={s.author}>
            {one.author}
            {one.via_agent ? (
              <Text style={s.via}> · via {one.via_agent}</Text>
            ) : null}
          </Text>
          <InlineDetails title="Review change">
            <ScrollView
              style={{ maxHeight: 240 }}
              keyboardShouldPersistTaps="handled"
            >
              {!!one.quote && (
                <View style={s.excerpt}>
                  <Text style={s.note}>Before</Text>
                  <Text
                    selectable
                    style={[
                      s.change,
                      sourceBlockIds?.has(one.block_id) && s.source,
                    ]}
                  >
                    {one.quote}
                  </Text>
                </View>
              )}
              {!!one.text && (
                <View style={s.excerpt}>
                  <Text style={s.note}>After</Text>
                  <Text
                    selectable
                    style={[
                      s.change,
                      sourceBlockIds?.has(one.block_id) && s.source,
                    ]}
                  >
                    {one.text}
                  </Text>
                </View>
              )}
              {!one.text && <Text style={s.note}>Remove selected text</Text>}
            </ScrollView>
          </InlineDetails>
          {!!one.note && <Text style={s.note}>{one.note}</Text>}
          {one.detached ? (
            <Text style={s.note}>
              The original text was removed. This change cannot be applied.
            </Text>
          ) : (
            <View style={s.actions}>
              {one.user_id === userId && (
                <SmallAction
                  label="Withdraw"
                  disabled={busy}
                  onPress={() => onWithdraw(one)}
                />
              )}
              {canDecide && (
                <>
                  <SmallAction
                    label="Reject"
                    disabled={busy}
                    onPress={() => onDecide(one, false)}
                  />
                  <Button
                    title="Accept"
                    disabled={busy}
                    onPress={() => onDecide(one, true)}
                  />
                </>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8, marginBottom: 12 },
    eyebrow: {
      color: colors.muted,
      fontSize: 11,
      fontFamily: fonts.semibold,
    },
    card: {
      gap: 6,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    faded: { opacity: 0.7 },
    author: { color: colors.text, fontSize: 13, fontFamily: fonts.semibold },
    via: { color: colors.muted, fontFamily: fonts.regular },
    change: { fontSize: 14, lineHeight: 20, color: colors.text },
    source: { fontFamily: fonts.mono },
    excerpt: { gap: 4, paddingBottom: 12 },
    was: { color: colors.muted, textDecorationLine: "line-through" },
    arrow: { color: colors.muted },
    now: { color: colors.accent, fontFamily: fonts.semibold },
    note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
    actions: {
      flexDirection: "row",
      gap: 8,
      flexWrap: "wrap",
      alignItems: "center",
    },
  }),
);
