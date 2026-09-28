import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Alert,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  assistantSuggestions,
  type AssistantSource,
  type Item,
  type Plan,
  type PersonalAgentSettings,
  type ChatTraceEntry,
  type AiChatSummary,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { PlanView, tickedMoves } from "../components/PlanView";
import { SmallAction } from "../components/SmallAction";
import { MoreMenu, type MoreAction } from "../components/MoreMenu";
import { ProposalReview } from "../components/ProposalReview";
import { Field } from "../components/Field";
import { client } from "../lib/api";
import type { Assistant } from "../hooks/useAssistant";
import { FadeIn, PressableScale, useReducedMotion, Pressable } from "../motion";
import { colors, fonts, radii, themed, tint } from "../theme";
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
  onShowOnCalendar,
  onBackToProject,
}: {
  assistant: Assistant;
  items: Item[];
  busy: boolean;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: AssistantSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
  /** After a plan is applied: the calendar at its first changed session. */
  onShowOnCalendar?: (at: string) => void;
  onBackToProject?: (projectId: string) => void;
}) {
  const {
    turns,
    thinking,
    runProgress,
    answerWaiting,
    approveWaiting,
    stopRun,
    ask,
    apply,
    discard,
    reset,
    scope,
    setScope,
    savedChats,
    activeChatId,
    chatSearch,
    searchChats,
    openChat,
    deleteChat,
    renameChat,
    pinChat,
    keepChatAsNote,
  } = assistant;
  const { height } = useWindowDimensions();
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AiChatSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [personAnswer, setPersonAnswer] = useState("");
  const activeChat = savedChats?.find((chat) => chat.id === activeChatId);
  useEffect(() => {
    void client
      .agentSettings()
      .then((value) => {
        setIdentity(value);
        setIdentityName(value.name);
        setIdentityPersona(value.persona);
      })
      .catch(() => undefined);
  }, []);
  const saveIdentity = async (skip = false) => {
    if (identitySaving) return;
    setIdentitySaving(true);
    try {
      setIdentity(
        await client.updateAgentSettings(
          skip
            ? { name: "Orbyn", persona: "" }
            : {
                name: identityName.trim() || "Orbyn",
                persona: identityPersona,
              },
        ),
      );
    } catch {
      Alert.alert(
        "Couldn't save",
        "Your assistant details could not be saved. Try again.",
      );
    } finally {
      setIdentitySaving(false);
    }
  };
  const chatActions = (chat: AiChatSummary): MoreAction[] => [
    {
      label: chat.pinned ? "Unpin chat" : "Pin chat",
      onPress: () => void pinChat(chat.id, !chat.pinned).catch(() => undefined),
    },
    {
      label: "Rename",
      onPress: () => {
        setRenameTarget(chat);
        setRenameDraft(chat.title);
      },
    },
    {
      label: "Save as Agent note",
      onPress: () =>
        void keepChatAsNote(chat.id)
          .then((note) => onKeptNote?.(note.id))
          .catch(() =>
            Alert.alert(
              "Couldn't save",
              "Try saving this chat as a note again.",
            ),
          ),
    },
    {
      label: "Delete chat",
      destructive: true,
      onPress: () =>
        Alert.alert(
          "Delete chat?",
          `“${chat.title}” will be removed from your chat history.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => void deleteChat(chat.id).catch(() => undefined),
            },
          ],
        ),
    },
  ];
  const waiting = runProgress?.state === "waiting" ? runProgress.waiting : null;
  const locked = busy || thinking || !!waiting;
  useEffect(() => setPersonAnswer(""), [runProgress?.waiting?.question]);
  // Quick replies only make sense on the newest assistant reply.
  const latestReplyId = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")?.id;
  const suggestions = scope
    ? scope.kind === "project"
      ? [
          "Where does it stand?",
          "What's at risk before the deadline?",
          "What changed since I last looked?",
        ]
      : ["Will I finish this by the deadline?", "What should I plan next?"]
    : SUGGESTIONS;

  return (
    <>
      <Modal
        visible={!!identity && !identity.named_at}
        transparent
        animationType="fade"
        onRequestClose={() => void saveIdentity(true)}
      >
        <View style={s.identityBackdrop}>
          <View style={s.identitySheet}>
            <Text style={shared.title}>Give your assistant a name</Text>
            <Text style={[shared.subtitle, s.identityIntro]}>
              Choose a name and an optional persona. You can change both later
              in Settings.
            </Text>
            <Field label="Name">
              <TextInput
                autoFocus
                maxLength={40}
                value={identityName}
                onChangeText={setIdentityName}
                style={shared.input}
              />
            </Field>
            <Field label="Persona">
              <TextInput
                multiline
                maxLength={1000}
                value={identityPersona}
                onChangeText={setIdentityPersona}
                placeholder="Warm, direct, and concise"
                style={[shared.input, s.identityPersona]}
              />
            </Field>
            <View style={s.identityActions}>
              <Button
                title="Save"
                onPress={() => void saveIdentity()}
                disabled={identitySaving}
              />
              <Button
                title="Skip"
                secondary
                onPress={() => void saveIdentity(true)}
                disabled={identitySaving}
              />
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={historyOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={s.historyBackdrop}>
          <View style={s.historySheet}>
            <View style={s.historyHead}>
              <Text style={shared.title}>Chats</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close chat history"
                hitSlop={8}
                onPress={() => setHistoryOpen(false)}
              >
                <Icon name="x" size={20} color={colors.textSoft} />
              </Pressable>
            </View>
            <TextInput
              style={[shared.input, s.historySearch]}
              value={chatSearch}
              onChangeText={searchChats}
              placeholder="Search chats"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Search chats"
            />
            <ScrollView
              style={s.historyList}
              keyboardShouldPersistTaps="handled"
            >
              {savedChats?.map((chat) => (
                <View
                  key={chat.id}
                  style={[
                    s.historyRow,
                    chat.id === activeChatId && s.historyRowActive,
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open the chat “${chat.title}”`}
                    onPress={() => {
                      setHistoryOpen(false);
                      void openChat(chat.id).catch(() =>
                        Alert.alert("Couldn't open chat", "Try again."),
                      );
                    }}
                    style={s.historyOpen}
                  >
                    <Text style={s.historyTitle} numberOfLines={1}>
                      {chat.pinned ? "Pinned · " : ""}
                      {chat.title}
                    </Text>
                    <Text style={shared.small} numberOfLines={1}>
                      {chat.swept_at
                        ? "Summary saved"
                        : (chat.project_name ??
                          new Date(chat.last_used_at).toLocaleDateString([], {
                            day: "numeric",
                            month: "short",
                          }))}
                    </Text>
                  </Pressable>
                  <MoreMenu
                    label={`Options for ${chat.title}`}
                    title={chat.title}
                    disabled={locked}
                    actions={chatActions(chat)}
                  />
                </View>
              ))}
              {savedChats?.length === 0 && (
                <Text style={[shared.small, s.historyEmpty]}>
                  No matching chats.
                </Text>
              )}
              {savedChats === null && (
                <Text style={[shared.small, s.historyEmpty]}>
                  Loading chats…
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal
        visible={!!renameTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={s.identityBackdrop}>
          <View style={s.identitySheet}>
            <Text style={shared.title}>Rename chat</Text>
            <TextInput
              autoFocus
              maxLength={120}
              value={renameDraft}
              onChangeText={setRenameDraft}
              style={shared.input}
              accessibilityLabel="Chat title"
            />
            <View style={s.identityActions}>
              <Button
                title="Save"
                disabled={renameBusy || !renameDraft.trim()}
                onPress={() => {
                  if (!renameTarget || !renameDraft.trim()) return;
                  setRenameBusy(true);
                  void renameChat(renameTarget.id, renameDraft.trim())
                    .then(() => setRenameTarget(null))
                    .catch(() =>
                      Alert.alert("Couldn't rename chat", "Try again."),
                    )
                    .finally(() => setRenameBusy(false));
                }}
              />
              <Button
                title="Cancel"
                secondary
                disabled={renameBusy}
                onPress={() => setRenameTarget(null)}
              />
            </View>
          </View>
        </View>
      </Modal>
      <View style={s.historyTrigger}>
        <SmallAction
          label="Chat history"
          disabled={locked}
          onPress={() => setHistoryOpen(true)}
        />
      </View>
      {scope && (
        <View style={s.scopeRow}>
          <SmallAction
            label={`In: ${scope.name} ×`}
            disabled={locked}
            onPress={() => setScope(null)}
          />
          {scope.kind === "project" && onBackToProject && (
            <SmallAction
              label={`Back to ${scope.name}`}
              disabled={thinking}
              onPress={() => onBackToProject(scope.id)}
            />
          )}
        </View>
      )}
      {turns.length === 0 ? (
        <FadeIn style={[s.welcome, { minHeight: Math.max(400, height - 480) }]}>
          <View style={s.badge}>
            <Icon name="sparkles" size={18} color={colors.accent} />
          </View>
          <Text style={s.welcomeTitle}>A little clarity for your day.</Text>
          <Text style={[shared.subtitle, s.intro]}>
            Plan your time, find an answer, or turn an idea into a next step.
            You’ll review every change before it’s saved.
          </Text>
          {activeChat?.swept_at && (
            <View style={s.sweptNote}>
              <Text style={s.historyTitle}>
                This chat has been saved as a summary note.
              </Text>
              {activeChat.summary_doc_id && (
                <SmallAction
                  label="Open summary"
                  disabled={locked}
                  onPress={() => onKeptNote?.(activeChat.summary_doc_id!)}
                />
              )}
            </View>
          )}
          <View style={s.chips}>
            {suggestions.map((text) => (
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
                <Icon name="arrowRight" size={18} color={colors.accent} />
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
                <Text selectable style={s.userText}>
                  {turn.text}
                </Text>
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
                  onApprove={(giveTasksDeadlines) =>
                    apply(turn.id, giveTasksDeadlines)
                  }
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
                    result={turn.planResult}
                    onShowOnCalendar={
                      onShowOnCalendar && turn.planAt
                        ? () => onShowOnCalendar(turn.planAt!)
                        : undefined
                    }
                    busy={locked}
                    onApply={(moves) =>
                      void assistant.applyPlan(turn.id, moves)
                    }
                  />
                )}
                <ChatTrace trace={turn.trace} />
              </View>
            </FadeIn>
          ),
        )}
        {waiting && (
          <View style={s.runCard} accessibilityLiveRegion="polite">
            {waiting.kind === "person" ? (
              <>
                <Text style={s.runTitle}>One quick question</Text>
                <Text style={s.runBody}>{waiting.question}</Text>
                {!!waiting.choices.length && (
                  <View style={s.runChoices}>
                    {waiting.choices.map((choice) => (
                      <Button
                        key={choice}
                        title={choice}
                        secondary
                        disabled={busy}
                        style={s.runChoice}
                        onPress={() => void answerWaiting(choice)}
                      />
                    ))}
                  </View>
                )}
                <TextInput
                  style={s.runInput}
                  maxLength={4000}
                  value={personAnswer}
                  onChangeText={setPersonAnswer}
                  placeholder="Or type your answer…"
                  placeholderTextColor={colors.faint}
                  accessibilityLabel="Your answer"
                  returnKeyType="send"
                  onSubmitEditing={() => {
                    const answer = personAnswer.trim();
                    if (!busy && answer) {
                      setPersonAnswer("");
                      void answerWaiting(answer);
                    }
                  }}
                />
                <Button
                  title="Answer"
                  disabled={busy || !personAnswer.trim()}
                  style={s.runButton}
                  onPress={() => {
                    const answer = personAnswer.trim();
                    if (answer) {
                      setPersonAnswer("");
                      void answerWaiting(answer);
                    }
                  }}
                />
              </>
            ) : (
              <>
                <Text style={s.runTitle}>Review the staged changes</Text>
                <Text style={s.runBody}>{waiting.question}</Text>
                <Text style={s.runBody}>{waiting.summary}</Text>
                {!!waiting.detail && (
                  <Text style={s.runBody}>{waiting.detail}</Text>
                )}
                {!!waiting.steps.length && (
                  <View style={s.runSteps}>
                    {waiting.steps.slice(0, 20).map((step, index) => {
                      const tool =
                        step && typeof step === "object" && "tool" in step
                          ? String(step.tool)
                          : "Change";
                      return (
                        <Text key={`${tool}-${index}`} style={s.runStep}>
                          • {tool}
                        </Text>
                      );
                    })}
                  </View>
                )}
                <Button
                  title="Apply this plan"
                  disabled={busy}
                  style={s.runButton}
                  onPress={() => void approveWaiting(true, "once")}
                />
                {waiting.automation_kind && (
                  <Button
                    title={`Apply and remember for this ${waiting.automation_kind}`}
                    secondary
                    disabled={busy}
                    style={s.runButton}
                    onPress={() =>
                      void approveWaiting(true, waiting.automation_kind)
                    }
                  />
                )}
                {!!waiting.change_kinds?.length && (
                  <Button
                    title={`Always allow: ${waiting.change_kinds.join(", ")}`}
                    secondary
                    disabled={busy}
                    style={s.runButton}
                    onPress={() => void approveWaiting(true, "always")}
                  />
                )}
                <Button
                  title="Hold changes"
                  secondary
                  disabled={busy}
                  style={s.runButton}
                  onPress={() => void approveWaiting(false)}
                />
              </>
            )}
          </View>
        )}
        {runProgress?.state === "running" && (
          <View style={s.runProgress} accessibilityLiveRegion="polite">
            <Text style={s.runBody}>
              {runProgress.label ?? "Working through your request…"}
            </Text>
            <Button
              title="Stop"
              secondary
              disabled={busy}
              style={s.runStop}
              onPress={() => void stopRun()}
            />
          </View>
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
        {scope?.kind === "project"
          ? "Your question, this project's tasks, notes and decisions, and any pages the assistant opens are sent to the AI service Orbyn uses to answer you."
          : scope?.kind === "task"
            ? "Your question, this task and its sessions, and any pages the assistant opens are sent to the AI service Orbyn uses to answer you."
            : "Your question, recent tasks, the next few days of your calendar and any pages the assistant opens are sent to the AI service Orbyn uses to answer you."}
      </Text>
    </>
  );
}

/**
 * The message box and Send. It grows with what's typed up to about four
 * lines, then scrolls inside itself.
 */
export function AssistantComposer({
  assistant,
  busy,
}: {
  assistant: Assistant;
  busy: boolean;
}) {
  const { message, setMessage, thinking, runProgress, ask } = assistant;
  const canSend =
    !busy && !thinking && runProgress?.state !== "waiting" && !!message.trim();
  // Four lines at the user's text size, not four lines of the default size.
  const { fontScale } = useWindowDimensions();
  return (
    <View style={s.composer}>
      <TextInput
        style={[s.input, { maxHeight: LINE * 4 * fontScale + 20 }]}
        multiline
        placeholder="Ask Orbyn…"
        placeholderTextColor={colors.faint}
        value={message}
        onChangeText={setMessage}
        maxLength={4000}
        textAlignVertical="center"
        accessibilityLabel="Message your assistant"
      />
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

/**
 * A schedule the assistant planned, to review and apply: its sessions, the
 * late sessions it can move before their deadline (the planner's own ticked,
 * yours unticked) and what's at risk. Once applied, it says what it did.
 */
function PlanCard({
  plan,
  applied,
  result,
  onShowOnCalendar,
  busy,
  onApply,
}: {
  plan: Plan;
  applied: boolean;
  /** What applying did, in words (when applied here). */
  result?: string;
  /** Once applied here: the calendar at the first session it changed. */
  onShowOnCalendar?: () => void;
  busy: boolean;
  onApply: (moves: string[]) => void;
}) {
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const chosen = tickedMoves(plan, ticks);
  return (
    <FadeIn style={s.plan}>
      <View style={s.planHead}>
        <Icon name="calendar" size={14} color={colors.accent} />
        <Text style={s.planTitle} accessibilityRole="header">
          Proposed schedule
        </Text>
      </View>
      <PlanView
        plan={applied ? { ...plan, applied: true } : plan}
        limit={6}
        ticks={ticks}
        onTick={
          applied || busy
            ? undefined
            : (id, on) => setTicks((t) => ({ ...t, [id]: on }))
        }
      />
      {applied ? (
        <View style={s.planDone}>
          <Icon
            name="check"
            size={14}
            color={colors.accent}
            strokeWidth={2.4}
          />
          <View style={s.planDoneBody}>
            <Text style={s.planDoneText} accessibilityRole="alert">
              {result ?? "Added to your calendar"}
            </Text>
            {onShowOnCalendar && (
              <SmallAction
                label="Show on calendar"
                disabled={false}
                onPress={onShowOnCalendar}
              />
            )}
          </View>
        </View>
      ) : (
        <Button
          title="Apply"
          icon="check"
          disabled={busy || (plan.blocks.length === 0 && chosen.length === 0)}
          style={s.planButton}
          onPress={() => onApply(chosen)}
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

/** A short, content-free account of the steps behind an assistant reply. */
function ChatTrace({ trace }: { trace: ChatTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  return (
    <View style={s.trace}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? "Hide" : "Show"} assistant steps`}
        onPress={() => setOpen((shown) => !shown)}
        style={({ pressed }) => [s.traceToggle, pressed && { opacity: 0.7 }]}
      >
        <Text style={s.traceToggleText}>
          {open ? "Hide steps" : `Steps (${trace.length})`}
        </Text>
      </PressableScale>
      {open && (
        <View style={s.traceList}>
          {trace.map((entry, index) => (
            <View
              key={`${entry.turn_id}-${entry.step}-${index}`}
              style={s.traceRow}
            >
              <Text style={s.traceLabel}>{entry.label}</Text>
              {entry.tool && <Text style={s.traceTool}>{entry.tool}</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Line height of the message box; it grows to five lines before scrolling. */
const LINE = 21;

const s = themed(() =>
  StyleSheet.create({
    identityBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 24,
      backgroundColor: "rgba(10, 15, 25, 0.55)",
    },
    identitySheet: {
      padding: 22,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      gap: 14,
    },
    identityIntro: { marginBottom: 2 },
    identityPersona: { minHeight: 78, textAlignVertical: "top" },
    identityActions: { flexDirection: "row", gap: 8, alignItems: "center" },
    historyBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 16,
      backgroundColor: tint(colors.shadow, 0.5),
    },
    historySheet: {
      maxHeight: "80%",
      padding: 16,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      gap: 12,
    },
    historyHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    historySearch: { marginBottom: 0 },
    historyList: { flexGrow: 0, maxHeight: 520 },
    historyRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 8,
      borderRadius: radii.input,
    },
    historyRowActive: { backgroundColor: colors.surfaceMuted },
    historyOpen: {
      flex: 1,
      minWidth: 0,
      minHeight: 52,
      justifyContent: "center",
      gap: 3,
    },
    historyTitle: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    historyEmpty: { marginVertical: 8, textAlign: "center" },
    historyTrigger: { flexDirection: "row", justifyContent: "flex-end" },
    sweptNote: {
      alignSelf: "stretch",
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
      gap: 10,
    },
    saved: {
      alignSelf: "stretch",
      gap: 6,
      marginTop: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    savedRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    savedOpen: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      minHeight: 40,
    },
    savedTitle: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    welcome: {
      justifyContent: "center",
      paddingVertical: 24,
      marginBottom: 20,
    },
    welcomeTitle: {
      fontFamily: fonts.display,
      fontSize: 36,
      lineHeight: 42,
      letterSpacing: -0.8,
      color: colors.text,
    },
    badge: {
      width: 52,
      height: 52,
      borderRadius: 18,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 14,
    },
    intro: { marginBottom: 16 },
    chips: { gap: 10 },
    scopeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    chip: {
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      // A finger's worth of height, like every other control on the phone.
      minHeight: 44,
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.softBorder,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 15,
    },
    chipPressed: { backgroundColor: colors.accentSoft },
    chipText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      lineHeight: 22,
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
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    newChatText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
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
    botRow: { gap: 8 },
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
      minWidth: 0,
      width: "100%",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      borderTopLeftRadius: 5,
      padding: 14,
    },
    trace: {
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    traceToggle: {
      alignSelf: "flex-start",
      minHeight: 36,
      justifyContent: "center",
    },
    traceToggleText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    traceList: { gap: 8, paddingBottom: 4 },
    traceRow: { gap: 2 },
    traceLabel: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
    traceTool: {
      fontFamily: fonts.regular,
      fontSize: 11,
      color: colors.muted,
    },
    runCard: {
      gap: 9,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    runTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      lineHeight: 21,
      color: colors.text,
    },
    runBody: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSoft,
    },
    runChoices: { gap: 4 },
    runChoice: { marginBottom: 0, minHeight: 44 },
    runInput: {
      minHeight: 48,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    runSteps: {
      gap: 4,
      padding: 10,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    runStep: {
      fontFamily: fonts.regular,
      fontSize: 11,
      lineHeight: 18,
      color: colors.textSoft,
    },
    runButton: { alignSelf: "flex-start", marginBottom: 0, minHeight: 44 },
    runProgress: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingHorizontal: 8,
    },
    runStop: { marginBottom: 0, minHeight: 44 },
    typing: {
      width: "auto",
      alignSelf: "flex-start",
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
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 27,
      padding: 5,
      paddingLeft: 16,
    },
    input: {
      flex: 1,
      minHeight: 44,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: LINE,
      color: colors.text,
      paddingTop: 10,
      paddingBottom: 10,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accent,
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
    planTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    planButton: { marginTop: 12, marginBottom: 0 },
    planDone: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 6,
      marginTop: 12,
    },
    // The message, with "Show on calendar" under it at its own width.
    planDoneBody: { flex: 1, gap: 8, alignItems: "flex-start" },
    planDoneText: {
      alignSelf: "stretch",
      fontFamily: fonts.semibold,
      fontSize: 13,
      lineHeight: 18,
      color: colors.accent,
    },
  }),
);
