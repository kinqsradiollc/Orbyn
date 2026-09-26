import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { plainText, type DocSuggestion } from "@orbyn/core";
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
}: {
  suggestions: DocSuggestion[];
  canDecide: boolean;
  userId?: string;
  busy: boolean;
  onDecide: (s: DocSuggestion, take: boolean) => void;
  onWithdraw: (s: DocSuggestion) => void;
}) {
  const open = suggestions.filter((s) => s.status === "open");
  if (!open.length) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>
        {open.length} PROPOSED CHANGE{open.length === 1 ? "" : "S"}
      </Text>
      {open.map((one) => (
        <View key={one.id} style={[s.card, one.detached && s.faded]}>
          <Text style={s.author}>{one.author}</Text>
          <Text style={s.change}>
            {!!one.quote && <Text style={s.was}>{plainText(one.quote)}</Text>}
            {!!one.quote && !!one.text && <Text style={s.arrow}> → </Text>}
            {!!one.text && <Text style={s.now}>{plainText(one.text)}</Text>}
          </Text>
          {!!one.note && <Text style={s.note}>{one.note}</Text>}
          {one.detached ? (
            <Text style={s.note}>
              The words this was about have gone. Nothing to apply it to.
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
                    label="Leave"
                    disabled={busy}
                    onPress={() => onDecide(one, false)}
                  />
                  <Button
                    title="Take"
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
      letterSpacing: 0.8,
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
    change: { fontSize: 15, lineHeight: 20 },
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
