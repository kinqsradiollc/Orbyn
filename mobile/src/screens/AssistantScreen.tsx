import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  assistantSuggestions,
  type DocSource,
  type Item,
  type Plan,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PlanView } from "../components/PlanView";
import { ProposalReview } from "../components/ProposalReview";
import type { Assistant } from "../hooks/useAssistant";
import { FadeIn, PressableScale, useReducedMotion } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** Same starter prompts as the desktop assistant. */
const SUGGESTIONS = assistantSuggestions.map((s) => s.title);

/**
 * The conversation: starter prompts, then each message and reply. The message
 * box is `AssistantComposer`, which RootScreen keeps fixed above the keyboard
 * and tab bar while this scrolls with the page.
 */
export function AssistantScreen({
  assistant,
  items,
  busy,
  onOpenSource,
  onKeptNote,
}: {
  assistant: Assistant;
  items: Item[];
  busy: boolean;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: DocSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
}) {
  const { turns, thinking, ask, apply, discard, reset } = assistant;
  const locked = busy || thinking;
  // Quick replies only make sense on the newest assistant reply.
  const latestReplyId = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")?.id;

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
                  onOpenSource={onOpenSource}
                  onKeptNote={onKeptNote}
                  onFollowUp={
                    turn.id === latestReplyId
                      ? (text) => void ask(text)
                      : undefined
                  }
                />
                {turn.proposal.plan && (
                  <PlanCard
                    plan={turn.proposal.plan}
                    applied={turn.planApplied}
                    busy={locked}
                    onApply={() => void assistant.applyPlan(turn.id)}
                  />
                )}
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

      <Text style={[shared.small, s.note]}>
        Your request and up to 100 recent items are shared with your configured
        AI provider.
      </Text>
    </>
  );
}

/**
 * The message box and Send. It grows with what's typed up to about five
 * lines, then scrolls inside itself.
 */
export function AssistantComposer({
  assistant,
  busy,
}: {
  assistant: Assistant;
  busy: boolean;
}) {
  const { message, setMessage, thinking, ask, draftProject } = assistant;
  const canSend = !busy && !thinking && !!message.trim();
  // Five lines at the user's text size, not five lines of the default size.
  const { fontScale } = useWindowDimensions();
  return (
    <View style={s.composer}>
      <TextInput
        style={[s.input, { maxHeight: LINE * 5 * fontScale + 22 }]}
        multiline
        placeholder="Make a little space. Ask Orbyn…"
        placeholderTextColor={colors.faint}
        value={message}
        onChangeText={setMessage}
        maxLength={4000}
        textAlignVertical="top"
        accessibilityLabel="Message your assistant"
      />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Draft a project"
        accessibilityState={{ disabled: !canSend }}
        disabled={!canSend}
        onPress={() => draftProject()}
        style={({ pressed }) => [
          s.project,
          pressed && { opacity: 0.6 },
          !canSend && { opacity: 0.4 },
        ]}
      >
        <Icon
          name="sparkles"
          size={18}
          color={colors.accent}
          strokeWidth={2.2}
        />
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={thinking ? "Thinking" : "Send"}
        accessibilityState={{ disabled: !canSend }}
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
  );
}

/** A schedule the assistant planned, to review and apply as time blocks. */
function PlanCard({
  plan,
  applied,
  busy,
  onApply,
}: {
  plan: Plan;
  applied: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  return (
    <FadeIn style={s.plan}>
      <View style={s.planHead}>
        <Icon name="calendar" size={14} color={colors.accent} />
        <Text style={s.planTitle} accessibilityRole="header">
          Proposed schedule
        </Text>
      </View>
      <PlanView plan={plan} limit={6} />
      {applied ? (
        <View style={s.planDone}>
          <Icon
            name="check"
            size={14}
            color={colors.accent}
            strokeWidth={2.4}
          />
          <Text style={s.planDoneText}>Added to your calendar</Text>
        </View>
      ) : (
        <Button
          title="Apply plan"
          icon="check"
          disabled={busy || plan.blocks.length === 0}
          style={s.planButton}
          onPress={onApply}
        />
      )}
    </FadeIn>
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

/** Line height of the message box; it grows to five lines before scrolling. */
const LINE = 21;

const s = themed(() =>
  StyleSheet.create({
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
      maxWidth: "100%",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.softBorder,
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    chipPressed: { backgroundColor: colors.accentSoft },
    chipText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
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
      padding: 6,
      paddingLeft: 14,
    },
    input: {
      flex: 1,
      minHeight: 44,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: LINE,
      color: colors.text,
      paddingTop: 11,
      paddingBottom: 11,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    project: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: "center",
      justifyContent: "center",
    },
    note: { textAlign: "center" },
    plan: {
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    planHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginBottom: 8,
    },
    planTitle: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    planButton: { marginTop: 12, marginBottom: 0 },
    planDone: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 12,
    },
    planDoneText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
  }),
);
