import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { assistantSuggestions, type Item } from "@orbyn/core";
import { Icon } from "../components/Icon";
import { ProposalReview } from "../components/ProposalReview";
import type { Assistant } from "../hooks/useAssistant";
import { FadeIn, PressableScale, useReducedMotion } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

/** Same starter prompts as the desktop assistant. */
const SUGGESTIONS = assistantSuggestions.map((s) => s.title);

export function AssistantScreen({
  assistant,
  items,
  busy,
}: {
  assistant: Assistant;
  items: Item[];
  busy: boolean;
}) {
  const { message, setMessage, turns, thinking, ask, apply, discard, reset } =
    assistant;
  const locked = busy || thinking;
  const canSend = !locked && !!message.trim();

  return (
    <>
      {turns.length === 0 ? (
        <FadeIn style={shared.softCard}>
          <View style={s.badge}>
            <Icon name="sparkles" size={18} color={colors.accent} />
          </View>
          <Text style={shared.sectionTitle}>What’s on your mind?</Text>
          <Text style={[shared.subtitle, s.intro]}>
            Ask for a summary, plan your day, or change items in plain language.
            You’ll review every change before it’s saved.
          </Text>
          <View style={s.chips}>
            {SUGGESTIONS.map((text) => (
              <PressableScale
                key={text}
                accessibilityRole="button"
                disabled={locked}
                onPress={() => ask(text)}
                style={({ pressed }) => [
                  s.chip,
                  pressed && s.chipPressed,
                  locked && { opacity: 0.5 },
                ]}
              >
                <Text style={s.chipText}>{text}</Text>
              </PressableScale>
            ))}
          </View>
        </FadeIn>
      ) : (
        <View style={s.threadHead}>
          <Text style={shared.eyebrow}>CONVERSATION</Text>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Start a new conversation"
            disabled={thinking}
            onPress={reset}
            style={({ pressed }) => [s.newChat, pressed && s.chipPressed]}
          >
            <Icon
              name="plus"
              size={14}
              color={colors.accent}
              strokeWidth={2.2}
            />
            <Text style={s.newChatText}>New chat</Text>
          </PressableScale>
        </View>
      )}

      <View style={s.thread}>
        {turns.map((turn) =>
          turn.role === "user" ? (
            <FadeIn key={turn.id} from="right" style={s.userRow}>
              <View style={s.userBubble}>
                <Text style={s.userText}>{turn.text}</Text>
              </View>
            </FadeIn>
          ) : (
            <FadeIn key={turn.id} from="left" style={s.botRow}>
              <View style={s.avatar}>
                <Icon name="sparkles" size={13} color={colors.accent} />
              </View>
              <View style={s.botBubble}>
                <ProposalReview
                  proposal={turn.proposal}
                  items={items}
                  before={turn.before}
                  busy={locked}
                  state={turn.state}
                  onApprove={() => apply(turn.id)}
                  onDiscard={() => discard(turn.id)}
                />
              </View>
            </FadeIn>
          ),
        )}
        {thinking && (
          <FadeIn from="left" style={s.botRow}>
            <View style={s.avatar}>
              <Icon name="sparkles" size={13} color={colors.accent} />
            </View>
            <TypingIndicator />
          </FadeIn>
        )}
      </View>

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
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={thinking ? "Thinking" : "Send"}
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
        </PressableScale>
      </View>
      <Text style={[shared.small, s.note]}>
        Your request and up to 100 recent items are shared with your configured
        AI provider.
      </Text>
    </>
  );
}

/** Three softly bouncing dots while the assistant is working (still under reduced motion). */
function TypingIndicator() {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      progress.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress, reduced]);
  return (
    <View
      style={[s.botBubble, s.typing]}
      accessibilityRole="progressbar"
      accessibilityLabel="Orbyn is thinking"
    >
      {[0, 1, 2].map((n) => {
        const start = n * 0.15;
        const translateY = progress.interpolate({
          inputRange: [0, start, start + 0.2, start + 0.4, 1],
          outputRange: [0, 0, -4, 0, 0],
        });
        const opacity = progress.interpolate({
          inputRange: [0, start, start + 0.2, start + 0.4, 1],
          outputRange: [0.45, 0.45, 1, 0.45, 0.45],
        });
        return (
          <Animated.View
            key={n}
            style={[s.dot, { opacity, transform: [{ translateY }] }]}
          />
        );
      })}
    </View>
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
  threadHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  newChatText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.accent,
  },
  thread: { gap: 12, marginBottom: 14 },
  userRow: { flexDirection: "row", justifyContent: "flex-end" },
  userBubble: {
    maxWidth: "85%",
    backgroundColor: colors.accent,
    borderRadius: 18,
    borderBottomRightRadius: 5,
    paddingHorizontal: 15,
    paddingVertical: 11,
  },
  userText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.white,
  },
  botRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  botBubble: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    borderTopLeftRadius: 5,
    padding: 14,
  },
  typing: {
    flex: 0,
    flexDirection: "row",
    gap: 5,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.dot,
  },
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
  note: { marginTop: 12, textAlign: "center" },
});
