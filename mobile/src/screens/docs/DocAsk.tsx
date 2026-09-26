import React, { useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  blockText,
  plainText,
  serializeBlock,
  type DocAiAction,
  type DocAnswer,
  type DocBlock,
  type DocSuggestion,
} from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Sheet";
import { client } from "../../lib/api";
import { PressableScale, Pressable } from "../../motion";
import { controls, colors, fonts, radii, spacing, themed } from "../../theme";
import { errorText } from "../../lib/errors";

/** The actions worth one tap; "custom" is whatever gets typed instead. */
const QUICK = DOC_AI_ACTIONS.filter((a) => a !== "custom");
const LINE = 21;

type Turn = {
  id: string;
  role: "you" | "orbyn";
  text: string;
  sources?: DocAnswer["sources"];
  /** Set when this turn proposed a change rather than said something. */
  proposed?: DocSuggestion;
};

let seq = 0;
const nextId = () => `t${++seq}`;

/**
 * A conversation about one page — the same one the assistant tab holds, about
 * one page instead of everything.
 *
 * What it is pointed at decides what it does. Pointed at the page it answers
 * from that page alone and names the lines it leant on. Pointed at a line it
 * changes the words — improve, shorten, carry on, or whatever gets typed —
 * and what comes back is a proposal, waiting with every other proposal.
 * Nothing it writes reaches the page on its own.
 */
export function DocAsk({
  visible,
  docId,
  blocks,
  canWrite,
  onClose,
  onGoToBlock,
  onNameBlock,
  onSuggested,
}: {
  visible: boolean;
  docId: string;
  blocks: DocBlock[];
  /** Whether a proposal can be made at all from here. */
  canWrite: boolean;
  onClose: () => void;
  /** Opens the remarks on a line the answer leant on. */
  onGoToBlock: (blockId: string) => void;
  /** Gives a line a name so a proposal can point at it, and returns it. */
  onNameBlock: (index: number) => string;
  onSuggested: (made: DocSuggestion) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which line the conversation is about; null is the page as a whole. */
  const [target, setTarget] = useState<number | null>(null);
  const scroller = useRef<ScrollView>(null);
  const { fontScale } = useWindowDimensions();

  const lines = blocks
    .map((block, index) => ({ index, text: blockText(block).trim() }))
    .filter((l) => l.text);
  const line = target === null ? null : blocks[target];
  const canSend = !busy && !!message.trim() && (target === null || canWrite);

  const say = (turn: Omit<Turn, "id">) => {
    setTurns((list) => [...list, { ...turn, id: nextId() }]);
    requestAnimationFrame(() =>
      scroller.current?.scrollToEnd({ animated: true }),
    );
  };

  const fail = (e: unknown) =>
    say({
      role: "orbyn",
      text: errorText(e),
    });

  const ask = async (question: string) => {
    setBusy(true);
    try {
      const answer = await client.askDoc(docId, question);
      say({ role: "orbyn", text: answer.answer, sources: answer.sources });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const change = async (action: DocAiAction, instruction = "") => {
    if (target === null || !line) return;
    setBusy(true);
    try {
      const blockId = onNameBlock(target);
      const source = serializeBlock(line);
      const made = await client.assistDoc(docId, {
        block_id: blockId,
        range_start: 0,
        range_end: source.length,
        action,
        instruction,
      });
      onSuggested(made);
      say({
        role: "orbyn",
        text: "Proposed. It waits with the rest of them.",
        proposed: made,
      });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const said = message.trim();
    if (!canSend) return;
    setMessage("");
    say({ role: "you", text: said });
    if (target === null) void ask(said);
    else void change("custom", said);
  };

  return (
    <Sheet visible={visible} title="Talk about this page" onClose={onClose}>
      <View style={s.screen}>
        {/* What the conversation is pointed at. The page answers questions;
            a line is something that can be changed. */}
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          style={s.targets}
          contentContainerStyle={s.targetsInner}
        >
          <ChipRow label="What this is about">
            <Chip
              compact
              label="The whole page"
              selected={target === null}
              onPress={() => setTarget(null)}
            />
            {lines.map((l) => (
              <Chip
                key={l.index}
                compact
                label={plainText(l.text).slice(0, 28)}
                selected={target === l.index}
                onPress={() => setTarget(l.index)}
              />
            ))}
          </ChipRow>
        </ScrollView>

        <ScrollView
          ref={scroller}
          style={s.thread}
          contentContainerStyle={s.threadInner}
          keyboardShouldPersistTaps="handled"
        >
          {turns.length === 0 && (
            <Text style={s.empty}>
              {target === null
                ? "Ask anything about this page. The answer comes from this page and nothing else, and names the lines it leant on."
                : "Ask for this line to be changed. What comes back is a proposal, for anyone to take or leave."}
            </Text>
          )}

          {turns.map((turn) => (
            <View key={turn.id} style={s.row}>
              <View style={[s.bubble, turn.role === "you" ? s.you : s.orbyn]}>
                <Text style={turn.role === "you" ? s.youText : s.orbynText}>
                  {turn.text}
                </Text>
                {turn.proposed && (
                  <Text style={s.proposed}>
                    “{plainText(turn.proposed.quote)}” →{" "}
                    {plainText(turn.proposed.text)}
                  </Text>
                )}
              </View>
              {turn.sources?.map((source) => (
                <Pressable
                  key={source.block_id}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to “${plainText(source.quote)}”`}
                  onPress={() => {
                    onClose();
                    onGoToBlock(source.block_id);
                  }}
                  style={({ pressed }) => [s.source, pressed && s.pressed]}
                >
                  <Text style={s.sourceText} numberOfLines={3}>
                    “{plainText(source.quote)}”
                  </Text>
                </Pressable>
              ))}
            </View>
          ))}

          {busy && <Text style={s.empty}>Reading…</Text>}
        </ScrollView>

        <View style={s.footer}>
          {/* One tap each, when there is a line to point them at. */}
          {target !== null && canWrite && (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
            >
              <ChipRow label="What to do with this line" multi>
                {QUICK.map((action) => (
                  <Chip
                    key={action}
                    compact
                    label={DOC_AI_LABELS[action].name}
                    selected={false}
                    disabled={busy}
                    onPress={() => void change(action)}
                  />
                ))}
              </ChipRow>
            </ScrollView>
          )}

          {/* The composer the assistant tab has: the words, and one round
              way to send them. */}
          <View style={s.composer}>
            <TextInput
              style={[s.input, { maxHeight: LINE * 5 * fontScale + 22 }]}
              value={message}
              multiline
              maxLength={1000}
              placeholder={
                target === null
                  ? "Ask about this page…"
                  : "Say what it should become…"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel="Your message about this page"
              textAlignVertical="top"
              onChangeText={setMessage}
            />
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={target === null ? "Ask" : "Suggest"}
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={send}
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
        </View>
      </View>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1 },
    targets: { flexGrow: 0 },
    targetsInner: {
      paddingHorizontal: spacing.page,
      paddingTop: 12,
      paddingBottom: 10,
    },
    thread: { flex: 1 },
    threadInner: {
      gap: 10,
      paddingHorizontal: spacing.page,
      paddingBottom: 12,
    },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    row: { gap: 6 },
    bubble: {
      gap: 6,
      maxWidth: "88%",
      paddingVertical: 9,
      paddingHorizontal: 13,
      borderRadius: radii.card,
    },
    you: { alignSelf: "flex-end", backgroundColor: colors.accent },
    orbyn: {
      alignSelf: "flex-start",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    youText: { color: colors.white, fontSize: 15, lineHeight: LINE },
    orbynText: { color: colors.text, fontSize: 15, lineHeight: LINE },
    proposed: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      paddingLeft: 8,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
    },
    // A line the answer leant on: tapping it opens that line's remarks.
    source: {
      alignSelf: "flex-start",
      minHeight: controls.tap,
      maxWidth: "88%",
      justifyContent: "center",
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radii.input,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
      backgroundColor: colors.surfaceMuted,
    },
    pressed: { opacity: 0.6 },
    sourceText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    footer: {
      gap: 10,
      paddingHorizontal: spacing.page,
      paddingTop: 10,
      paddingBottom: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
      minHeight: controls.tap,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: LINE,
      color: colors.text,
      paddingTop: 11,
      paddingBottom: 11,
    },
    send: {
      width: controls.tap,
      height: controls.tap,
      borderRadius: controls.tap / 2,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
