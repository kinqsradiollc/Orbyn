import React, { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  aiFeatureProviderLabel,
  type AiFeatureProvider,
  DOC_AI_ACTIONS,
  DOC_AI_LABELS,
  blockText,
  plainText,
  serializeBlock,
  type DocAiAction,
  type DocAnswer,
  type DocAskExcerpt,
  type DocBlock,
  type DocSuggestion,
} from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Sheet";
import { client } from "../../lib/api";
import { session as authSession } from "../../lib/session";
import { InlineDetails } from "../../components/InlineDetails";
import { Pressable } from "../../motion";
import {
  inputFontSize,
  colors,
  fonts,
  radii,
  spacing,
  themed,
} from "../../theme";
import { errorText } from "../../lib/errors";

/** The actions worth one tap; "custom" is whatever gets typed instead. */
const QUICK = DOC_AI_ACTIONS.filter((a) => a !== "custom");
const LINE = 21;

type Turn = {
  id: string;
  role: "you" | "orbyn";
  text: string;
  sources?: DocAnswer["sources"];
  provider?: AiFeatureProvider;
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
export function DocAsk(props: Parameters<typeof DocAskBody>[0]) {
  return <DocAskBody key={props.docId} {...props} />;
}

function DocAskBody({
  visible,
  docId,
  blocks,
  canWrite,
  onClose,
  onGoToBlock,
  onNameBlock,
  onSuggested,
  excerpt,
  isSelectionCurrent,
}: {
  visible: boolean;
  docId: string;
  excerpt?: DocAskExcerpt | null;
  isSelectionCurrent?: () => boolean;
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
  const selectionOwner = useRef({ excerpt, isSelectionCurrent });
  selectionOwner.current = { excerpt, isSelectionCurrent };
  const explained = useRef<number | null>(null);
  useEffect(() => {
    if (excerpt) setTarget(null);
  }, [excerpt?.requestId]);
  const mutation = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!canWrite) setTarget(null);
  }, [canWrite]);
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
    if (!mounted.current) return;
    setTurns((list) => [...list, { ...turn, id: nextId() }]);
    requestAnimationFrame(() =>
      scroller.current?.scrollToEnd({ animated: false }),
    );
  };

  const fail = (e: unknown) =>
    say({
      role: "orbyn",
      text: errorText(e),
    });

  const ask = async (question: string) => {
    if (mutation.current) return;
    const owner = excerpt;
    const account = authSession.token;
    const current = () =>
      mounted.current &&
      authSession.token === account &&
      selectionOwner.current.excerpt?.requestId === owner?.requestId;
    mutation.current = true;
    setBusy(true);
    try {
      if (owner && isSelectionCurrent && !isSelectionCurrent())
        throw new Error(
          "The selection or page changed. Select the excerpt again.",
        );
      const answer = await client.askDoc(docId, question, owner?.selection);
      if (!current()) return;
      if (owner && selectionOwner.current.isSelectionCurrent?.() === false)
        throw new Error(
          "The selection or page changed. Select the excerpt again.",
        );
      say({
        role: "orbyn",
        text: answer.answer,
        sources: answer.sources,
        provider: answer.provider,
      });
    } catch (e) {
      if (current()) {
        fail(e);
        setMessage(question);
      }
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const change = async (action: DocAiAction, instruction = "") => {
    if (excerpt || mutation.current || !canWrite || target === null || !line)
      return;
    mutation.current = true;
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
      if (!mounted.current) return;
      onSuggested(made);
      say({
        role: "orbyn",
        text: "Change proposed. Review it before applying.",
        proposed: made,
        provider: made.provider,
      });
    } catch (e) {
      fail(e);
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const send = () => {
    const said = message.trim();
    if (!canSend) return;
    setMessage("");
    say({ role: "you", text: said });
    if (excerpt || target === null) void ask(said);
    else void change("custom", said);
  };

  useEffect(() => {
    if (
      !excerpt?.explain ||
      explained.current === excerpt.requestId ||
      !visible ||
      mutation.current
    )
      return;
    explained.current = excerpt.requestId;
    const question = "Explain this selected text.";
    say({ role: "you", text: question });
    void ask(question);
    // One explicit Explain action per retained selection request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excerpt?.requestId, visible, busy]);

  return (
    <Sheet
      visible={visible}
      title="Page assistant"
      onClose={() => {
        if (!mutation.current) onClose();
      }}
    >
      <View style={s.screen}>
        {/* What the conversation is pointed at. The page answers questions;
            a line is something that can be changed. */}
        {excerpt && (
          <View style={s.excerpt}>
            <Text style={s.sourceText}>
              Selected text · {excerpt.selection.format}
            </Text>
            <ScrollView style={{ maxHeight: 120 }}>
              <Text selectable style={s.orbynText}>
                {excerpt.selection.quote}
              </Text>
            </ScrollView>
          </View>
        )}
        {!excerpt && (
          <InlineDetails
            title={
              target === null
                ? "Scope: whole page"
                : `Scope: line ${target + 1}`
            }
          >
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
                  label="Whole page"
                  disabled={busy}
                  selected={target === null}
                  onPress={() => setTarget(null)}
                />
                {canWrite &&
                  lines.map((l) => (
                    <Chip
                      key={l.index}
                      compact
                      label={`Line ${l.index + 1}: ${plainText(l.text).slice(0, 40)}${plainText(l.text).length > 40 ? "…" : ""}`}
                      accessibilityLabel={`Line ${l.index + 1}: ${plainText(l.text)}`}
                      disabled={busy}
                      selected={target === l.index}
                      onPress={() => setTarget(l.index)}
                    />
                  ))}
              </ChipRow>
            </ScrollView>
          </InlineDetails>
        )}

        <ScrollView
          ref={scroller}
          style={s.thread}
          contentContainerStyle={s.threadInner}
          keyboardShouldPersistTaps="handled"
        >
          {turns.length === 0 && (
            <Text style={s.empty}>
              {excerpt
                ? "Ask about the selected text. Your document stays unchanged."
                : target === null
                  ? "Answers use this page and cite their sources."
                  : "Changes are proposals. Review before applying."}
            </Text>
          )}

          {turns.map((turn) => (
            <View key={turn.id} style={s.row}>
              <View style={[s.bubble, turn.role === "you" ? s.you : s.orbyn]}>
                <Text style={turn.role === "you" ? s.youText : s.orbynText}>
                  {turn.text}
                </Text>
                {turn.provider && (
                  <Text style={s.sourceText}>
                    {aiFeatureProviderLabel(turn.provider)}
                  </Text>
                )}
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
                  disabled={busy}
                  onPress={() => {
                    if (mutation.current) return;
                    onClose();
                    onGoToBlock(source.block_id);
                  }}
                  style={({ pressed }) => [s.source, pressed && s.pressed]}
                >
                  <Text style={s.sourceText}>“{plainText(source.quote)}”</Text>
                </Pressable>
              ))}
            </View>
          ))}

          {busy && <Text style={s.empty}>Reading…</Text>}
        </ScrollView>

        <View style={s.footer}>
          {/* One tap each, when there is a line to point them at. */}
          {!excerpt && target !== null && canWrite && (
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
              editable={!busy}
              multiline
              maxLength={1000}
              placeholder={
                excerpt
                  ? "Ask about the selected text…"
                  : target === null
                    ? "Ask about this page…"
                    : "Say what it should become…"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel={
                excerpt
                  ? "Question about selected text"
                  : "Your message about this page"
              }
              textAlignVertical="top"
              onChangeText={setMessage}
            />
            <Pressable
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
                color={colors.onAccent}
                strokeWidth={2.2}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1 },
    excerpt: {
      gap: 6,
      padding: 12,
      marginHorizontal: spacing.page,
      borderLeftWidth: 2,
      borderLeftColor: colors.accent,
      backgroundColor: colors.surfaceMuted,
    },
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
    youText: { color: colors.onAccent, fontSize: 15, lineHeight: LINE },
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
      minHeight: 44,
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
      minHeight: 44,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
      lineHeight: LINE,
      color: colors.text,
      paddingTop: 11,
      paddingBottom: 11,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
