import React, { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
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
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { client } from "../../lib/api";
import { colors, radii, themed } from "../../theme";

/** The actions worth one tap; "custom" is whatever gets typed instead. */
const QUICK = DOC_AI_ACTIONS.filter((a) => a !== "custom");

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
 * A conversation about one page, the phone's side of what the desktop keeps
 * in a panel over the page.
 *
 * What it is pointed at decides what it does. Pointed at the page it answers
 * from that page alone and names the lines it leant on. Pointed at a line it
 * changes the words — improve, shorten, carry on, or whatever gets typed —
 * and what comes back is a proposal, waiting with every other proposal.
 * Nothing it writes reaches the page on its own.
 */
export function DocAsk({
  docId,
  blocks,
  canWrite,
  onGoToBlock,
  onNameBlock,
  onSuggested,
}: {
  docId: string;
  blocks: DocBlock[];
  /** Whether a proposal can be made at all from here. */
  canWrite: boolean;
  /** Opens the remarks on a line the answer leant on. */
  onGoToBlock: (blockId: string) => void;
  /** Gives a line a name so a proposal can point at it, and returns it. */
  onNameBlock: (index: number) => string;
  onSuggested: (made: DocSuggestion) => void;
}) {
  const sheet = sheetStyles;
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** Which line the conversation is about; null is the page as a whole. */
  const [target, setTarget] = useState<number | null>(null);
  const scroller = useRef<ScrollView>(null);

  const lines = blocks
    .map((block, index) => ({ index, text: blockText(block).trim() }))
    .filter((l) => l.text);
  const line = target === null ? null : blocks[target];

  const say = (turn: Omit<Turn, "id">) => {
    setTurns((list) => [...list, { ...turn, id: nextId() }]);
    requestAnimationFrame(() =>
      scroller.current?.scrollToEnd({ animated: true }),
    );
  };

  const fail = (e: unknown) =>
    say({
      role: "orbyn",
      text: (e as Error).message || "That did not come back.",
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
    if (!said || busy) return;
    setMessage("");
    say({ role: "you", text: said });
    if (target === null) void ask(said);
    else void change("custom", said);
  };

  return (
    <>
      <SmallAction
        label="Talk to this page"
        disabled={false}
        onPress={() => setOpen(true)}
      />
      <Sheet
        visible={open}
        title="Talk about this page"
        onClose={() => setOpen(false)}
      >
        <ScrollView
          ref={scroller}
          contentContainerStyle={sheet.body}
          keyboardShouldPersistTaps="handled"
        >
          <View style={sheet.column}>
            {/* What the conversation is pointed at. The page answers
                questions; a line is something that can be changed. */}
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
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

            {turns.length === 0 && (
              <Text style={s.empty}>
                {target === null
                  ? "Ask anything about this page. The answer comes from this page and nothing else, and names the lines it leant on."
                  : "Ask for this line to be changed. What comes back is a proposal, for anyone to take or leave."}
              </Text>
            )}

            {turns.map((turn) => (
              <View
                key={turn.id}
                style={[s.turn, turn.role === "you" ? s.you : s.orbyn]}
              >
                <Text style={turn.role === "you" ? s.youText : s.orbynText}>
                  {turn.text}
                </Text>
                {turn.proposed && (
                  <Text style={s.proposed}>
                    “{plainText(turn.proposed.quote)}” →{" "}
                    {plainText(turn.proposed.text)}
                  </Text>
                )}
                {turn.sources?.map((source) => (
                  <Pressable
                    key={source.block_id}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to “${plainText(source.quote)}”`}
                    onPress={() => {
                      setOpen(false);
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

            {/* One tap each, when there is a line to point them at. */}
            {target !== null && canWrite && (
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
              >
                <View style={s.quick}>
                  {QUICK.map((action) => (
                    <SmallAction
                      key={action}
                      label={DOC_AI_LABELS[action].name}
                      disabled={busy}
                      onPress={() => void change(action)}
                    />
                  ))}
                </View>
              </ScrollView>
            )}

            <TextInput
              style={s.input}
              value={message}
              multiline
              maxLength={1000}
              placeholder={
                target === null
                  ? "What did we decide about pricing?"
                  : "Say what this line should become…"
              }
              placeholderTextColor={colors.faint}
              accessibilityLabel="Your message about this page"
              onChangeText={setMessage}
            />
            <Button
              title={busy ? "Reading…" : target === null ? "Ask" : "Suggest"}
              style={s.send}
              disabled={
                busy || !message.trim() || (target !== null && !canWrite)
              }
              onPress={send}
            />
          </View>
        </ScrollView>
      </Sheet>
    </>
  );
}

const s = themed(() =>
  StyleSheet.create({
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    turn: {
      gap: 6,
      maxWidth: "88%",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radii.card,
    },
    you: { alignSelf: "flex-end", backgroundColor: colors.accent },
    orbyn: { alignSelf: "flex-start", backgroundColor: colors.surface },
    youText: { color: colors.white, fontSize: 14, lineHeight: 20 },
    orbynText: { color: colors.text, fontSize: 14, lineHeight: 20 },
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
      minHeight: 44,
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
    quick: { flexDirection: "row", gap: 8 },
    input: {
      minHeight: 64,
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      textAlignVertical: "top",
    },
    send: { marginBottom: 0 },
  }),
);
