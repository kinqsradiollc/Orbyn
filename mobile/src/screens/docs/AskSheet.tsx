import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import {
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  plainText,
  type DocAiAction,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, radii, themed } from "../../theme";

/**
 * What to ask the assistant for, once some words are chosen.
 *
 * The answer arrives as a proposal beside the page, not as a change to it,
 * so this is a list of ways of asking rather than a list of edits.
 */
export function AskSheet({
  quote,
  busy,
  onAsk,
  onCancel,
}: {
  quote: string;
  busy: boolean;
  onAsk: (action: DocAiAction, instruction: string) => void;
  onCancel: () => void;
}) {
  const [custom, setCustom] = useState("");

  return (
    <View style={s.wrap}>
      <Text style={s.quote}>“{plainText(quote)}”</Text>
      <View style={s.actions}>
        {DOC_AI_ACTIONS.filter((a) => a !== "custom").map((a) => (
          <SmallAction
            key={a}
            label={DOC_AI_LABELS[a].name}
            disabled={busy}
            onPress={() => onAsk(a, "")}
          />
        ))}
      </View>
      <TextInput
        style={s.input}
        value={custom}
        placeholder="Or say what to do with them…"
        placeholderTextColor={colors.faint}
        maxLength={500}
        onChangeText={setCustom}
        accessibilityLabel="What the assistant should do"
      />
      <View style={s.foot}>
        <SmallAction label="Cancel" disabled={false} onPress={onCancel} />
        <Button
          title="Ask"
          disabled={busy || !custom.trim()}
          onPress={() => onAsk("custom", custom.trim())}
        />
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: {
      gap: 10,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quote: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    input: {
      color: colors.text,
      fontSize: 15,
      minHeight: 40,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontFamily: fonts.regular,
    },
    foot: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  }),
);
