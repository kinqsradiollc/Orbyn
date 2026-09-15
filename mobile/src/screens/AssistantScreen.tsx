import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Item } from "@orbyn/core";
import { Icon } from "../components/Icon";
import { ProposalReview } from "../components/ProposalReview";
import type { Assistant } from "../hooks/useAssistant";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

/** Same starter prompts as the desktop assistant. */
const SUGGESTIONS = [
  "Summarize my week",
  "What needs my attention?",
  "Help me plan tomorrow",
];

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
  const canSend = !busy && !!message.trim();
  return (
    <>
      <View style={shared.softCard}>
        <View style={s.badge}>
          <Icon name="sparkles" size={18} color={colors.accent} />
        </View>
        <Text style={shared.sectionTitle}>What’s on your mind?</Text>
        <Text style={[shared.subtitle, s.intro]}>
          Ask for a summary, create a plan, or adjust your existing items.
          You’ll review all changes before they’re saved.
        </Text>
        <View style={s.chips}>
          {SUGGESTIONS.map((text) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => ask(text)}
              style={({ pressed }) => [
                s.chip,
                pressed && s.chipPressed,
                busy && { opacity: 0.5 },
              ]}
            >
              <Text style={s.chipText}>{text}</Text>
            </Pressable>
          ))}
        </View>
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
      <View style={s.composer}>
        <TextInput
          style={s.input}
          multiline
          placeholder="Make a little space. Ask Orbyn…"
          placeholderTextColor={colors.faint}
          value={message}
          onChangeText={setMessage}
          maxLength={4000}
          accessibilityLabel="Message your assistant"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={busy ? "Thinking" : "Send"}
          disabled={!canSend}
          onPress={() => ask()}
          style={({ pressed }) => [
            s.send,
            pressed && { backgroundColor: colors.accentPressed },
            !canSend && { opacity: 0.4 },
          ]}
        >
          <Icon
            name="arrowRight"
            size={18}
            color={colors.white}
            strokeWidth={2.2}
          />
        </Pressable>
      </View>
      {busy && <Text style={[shared.small, s.status]}>Thinking…</Text>}
      <Text style={[shared.small, s.note]}>
        Your request and up to 100 recent items are shared with your configured
        AI provider.
      </Text>
    </>
  );
}

const s = StyleSheet.create({
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  intro: { marginBottom: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.softBorder,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipPressed: { backgroundColor: colors.accentSoft },
  chipText: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: 8,
    paddingLeft: 14,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
    paddingTop: 10,
    paddingBottom: 10,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  status: { marginTop: 10, color: colors.accent },
  note: { marginTop: 12, textAlign: "center" },
});
