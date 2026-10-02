import { Character } from "../components/Character";
import { CharacterEditor } from "../components/CharacterEditor";
import { ReminderNudge } from "../components/ReminderNudge";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  assistantSuggestions,
  characterAppearance,
  CHARACTER_PERSONAS,
  CHARACTER_STATE_LABELS,
  type AssistantSource,
  type Item,
  type Plan,
  type ChatTraceEntry,
  type AiChatSummary,
} from "@orbyn/core";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { AssistantDrawer } from "../components/AssistantDrawer";
import { PlanView, tickedMoves } from "../components/PlanView";
import { SmallAction } from "../components/SmallAction";
import { AssistantUpcoming } from "../components/AssistantUpcoming";
import { AssistantAgents } from "./AssistantAgents";
import { TurnChanges } from "../components/TurnChanges";
import type { MoreAction } from "../components/MoreMenu";
import { ProposalReview } from "../components/ProposalReview";
import { Field } from "../components/Field";
import { client } from "../lib/api";
import { errorText } from "../lib/errors";
import {
  changeKindWords,
  progressText,
  stepLabel,
  traceLines,
} from "../lib/assistant-labels";
import type { Assistant } from "../hooks/useAssistant";
import { FadeIn, PressableScale, Pressable } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** Same starter prompts as the desktop assistant, one icon each. */
const SUGGESTIONS = assistantSuggestions.map((s) => s.title);
const SUGGESTION_ICONS: IconName[] = ["calendar", "flag", "sun", "squarePen"];

/** Starter prompts for what the chat is about. */
function suggestionsFor(scope: Assistant["scope"]): string[] {
  if (!scope) return SUGGESTIONS;
  return scope.kind === "project"
    ? [
        "Where does it stand?",
        "What's at risk before the deadline?",
        "What changed since I last looked?",
      ]
    : ["Will I finish this by the deadline?", "What should I plan next?"];
}

/**
 * The assistant's top bar: the side menu on the left, its name in the
 * middle, New chat on the right. It stays put while the chat scrolls.
 */
export function AssistantTopBar({
  assistant,
  busy,
  onMenu,
}: {
  assistant: Assistant;
  busy: boolean;
  onMenu: () => void;
}) {
  const {
    agentName,
    reset,
    thinking,
    runProgress,
    turns,
    identity,
    characterState,
    setCustomizingCharacter,
  } = assistant;
  const locked = busy || thinking || runProgress?.state === "waiting";
  return (
    <View style={s.topBar}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Chats and more"
        onPress={onMenu}
        style={({ pressed }) => [s.round, pressed && s.roundPressed]}
      >
        <Icon name="menu" size={20} color={colors.text} strokeWidth={2} />
      </PressableScale>
      <PressableScale
        style={s.topIdentity}
        accessibilityRole="button"
        accessibilityLabel={`Customize ${agentName}`}
        disabled={!identity}
        onPress={() => setCustomizingCharacter(true)}
      >
        <Character
          appearance={identity?.character}
          state={characterState}
          size={72}
          name={agentName}
        />
        <Text style={s.topName} numberOfLines={1}>
          {agentName}
        </Text>
        <Text style={s.topStatus} numberOfLines={1}>
          {CHARACTER_STATE_LABELS[characterState]}
        </Text>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="New chat"
        disabled={locked || turns.length === 0}
        onPress={reset}
        style={({ pressed }) => [
          s.round,
          pressed && s.roundPressed,
          (locked || turns.length === 0) && { opacity: 0.45 },
        ]}
      >
        <Icon name="squarePen" size={19} color={colors.text} />
      </PressableScale>
    </View>
  );
}

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
  drawerOpen,
  onDrawerChange,
  onOpenMemory,
  onOpenAgentNotes,
  onOpenOvernight,
  onOpenSettings,
}: {
  assistant: Assistant;
  /** The side menu of chats and shortcuts, opened from the top bar. */
  drawerOpen: boolean;
  onDrawerChange: (open: boolean) => void;
  onOpenMemory?: () => void;
  onOpenAgentNotes?: () => void;
  onOpenOvernight?: () => void;
  /** Settings → Connected agents, where the assistant is set up. */
  onOpenSettings?: () => void;
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
    restoringChat,
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
    turnChanges,
    undoTurnChanges,
    identity,
    setIdentity,
    agentName,
    characterState,
    customizingCharacter,
    setCustomizingCharacter,
  } = assistant;
  const [identityName, setIdentityName] = useState("Orbyn");
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [identityPersona, setIdentityPersona] = useState("");
  const [appearance, setAppearance] = useState(() => characterAppearance({}));
  const [identitySaving, setIdentitySaving] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<AiChatSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  // What opens once the side menu has gone (iOS shows one sheet at a time).
  const afterDrawer = useRef<(() => void) | null>(null);
  const closeDrawerThen = (next: () => void) => {
    afterDrawer.current = next;
    onDrawerChange(false);
  };
  const [personAnswer, setPersonAnswer] = useState("");
  const activeChat = savedChats?.find((chat) => chat.id === activeChatId);
  const identityFormWasOpen = useRef(false);
  const identitySheetMode = useRef(false);
  if (identity && (!identity.named_at || customizingCharacter))
    identitySheetMode.current = customizingCharacter;
  useEffect(() => {
    const open = !!identity && (!identity.named_at || customizingCharacter);
    const alreadyOpen = identityFormWasOpen.current;
    identityFormWasOpen.current = open;
    // A foreground refresh must not replace edits in an open form.
    if (!identity || (open && alreadyOpen)) return;
    setIdentityName(identity.name);
    setIdentityPersona(identity.persona);
    setAppearance(characterAppearance(identity.character));
  }, [identity, customizingCharacter]);
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
                character: appearance,
              },
        ),
      );
      setCustomizingCharacter(false);
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
      onPress: () =>
        void pinChat(chat.id, !chat.pinned).catch((e: unknown) =>
          Alert.alert(
            chat.pinned ? "Couldn't unpin chat" : "Couldn't pin chat",
            errorText(e),
          ),
        ),
    },
    {
      label: "Rename",
      onPress: () => {
        setRenameDraft(chat.title);
        closeDrawerThen(() => setRenameTarget(chat));
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
              onPress: () =>
                void deleteChat(chat.id).catch((e: unknown) =>
                  Alert.alert("Couldn't delete chat", errorText(e)),
                ),
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

  return (
    <>
      <BottomSheet
        visible={!!identity && (!identity.named_at || customizingCharacter)}
        title={
          identitySheetMode.current
            ? "Make your assistant your own"
            : "Meet your Orbyn companion"
        }
        onClose={() => {
          if (!identitySaving) {
            if (customizingCharacter) setCustomizingCharacter(false);
            else void saveIdentity(true);
          }
        }}
        footer={
          <View style={s.sheetActions}>
            <Button
              title={identitySaving ? "Saving…" : "Save"}
              onPress={() => void saveIdentity()}
              disabled={identitySaving}
              style={s.sheetAction}
            />
            <Button
              title={identitySheetMode.current ? "Cancel" : "Keep Orbyn"}
              secondary
              onPress={() =>
                customizingCharacter
                  ? setCustomizingCharacter(false)
                  : void saveIdentity(true)
              }
              disabled={identitySaving}
              style={s.sheetAction}
            />
          </View>
        }
      >
        <Text style={[shared.small, s.sheetIntro]}>
          Choose a name, appearance, and communication style. You can change
          these whenever you like.
        </Text>
        <Field label="Name">
          <TextInput
            autoFocus
            maxLength={40}
            value={identityName}
            onChangeText={setIdentityName}
            placeholder="Orbyn"
            placeholderTextColor={colors.faint}
            style={shared.input}
          />
        </Field>
        <Field label="Persona (optional)">
          <TextInput
            multiline
            maxLength={1000}
            value={identityPersona}
            onChangeText={setIdentityPersona}
            placeholder="Warm, direct, and concise"
            placeholderTextColor={colors.faint}
            style={[shared.input, s.multiline]}
          />
        </Field>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {CHARACTER_PERSONAS.map((preset) => (
            <SmallAction
              key={preset.label}
              label={preset.label}
              disabled={identitySaving}
              onPress={() => setIdentityPersona(preset.persona)}
            />
          ))}
        </View>
        <CharacterEditor
          value={appearance}
          onChange={setAppearance}
          name={identityName}
          disabled={identitySaving}
        />
      </BottomSheet>
      <AssistantDrawer
        visible={drawerOpen}
        onClose={() => onDrawerChange(false)}
        afterClose={() => {
          const next = afterDrawer.current;
          afterDrawer.current = null;
          next?.();
        }}
        agentName={agentName}
        chats={savedChats}
        activeChatId={activeChatId}
        search={chatSearch}
        onSearch={searchChats}
        locked={locked}
        chatActions={chatActions}
        onOpenChat={(chat) => {
          onDrawerChange(false);
          void openChat(chat.id).catch(() =>
            Alert.alert("Couldn't open chat", "Try again."),
          );
        }}
        onNewChat={() => {
          onDrawerChange(false);
          reset();
        }}
        shortcuts={[
          {
            icon: "sparkles",
            label: "Your agents",
            onPress: () => closeDrawerThen(() => setAgentsOpen(true)),
          },
          {
            icon: "calendarCheck",
            label: "Upcoming",
            onPress: () => closeDrawerThen(() => setUpcomingOpen(true)),
          },
          ...(onOpenMemory
            ? [
                {
                  icon: "sparkles" as const,
                  label: "Memory",
                  onPress: () => closeDrawerThen(onOpenMemory),
                },
              ]
            : []),
          ...(onOpenAgentNotes
            ? [
                {
                  icon: "fileText" as const,
                  label: "Agent notes",
                  onPress: () => closeDrawerThen(onOpenAgentNotes),
                },
              ]
            : []),
          ...(onOpenOvernight
            ? [
                {
                  icon: "sparkles" as const,
                  label: "Overnight",
                  onPress: () => closeDrawerThen(onOpenOvernight),
                },
              ]
            : []),
        ]}
        onSettings={
          onOpenSettings ? () => closeDrawerThen(onOpenSettings) : undefined
        }
      />
      <BottomSheet
        visible={!!renameTarget}
        title="Rename chat"
        onClose={() => setRenameTarget(null)}
        footer={
          <View style={s.sheetActions}>
            <Button
              title="Save"
              disabled={renameBusy || !renameDraft.trim()}
              style={s.sheetAction}
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
              style={s.sheetAction}
              onPress={() => setRenameTarget(null)}
            />
          </View>
        }
      >
        <Field label="Title">
          <TextInput
            autoFocus
            maxLength={120}
            value={renameDraft}
            onChangeText={setRenameDraft}
            style={shared.input}
            accessibilityLabel="Chat title"
          />
        </Field>
      </BottomSheet>
      <AssistantUpcoming
        agentName={agentName}
        visible={upcomingOpen}
        onClose={() => setUpcomingOpen(false)}
      />
      <AssistantAgents
        visible={agentsOpen}
        identity={identity}
        onClose={() => setAgentsOpen(false)}
        canOpen={!locked}
        onOpenChat={(id) => {
          if (!locked)
            void openChat(id).catch((error) =>
              Alert.alert("Couldn't open output", errorText(error)),
            );
        }}
      />
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
      {turns.length === 0 && (
        <FadeIn style={s.welcome}>
          {activeChat?.swept_at ? (
            <View style={s.sweptNote}>
              <Text style={s.sweptTitle}>
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
          ) : (
            <View style={s.intro}>
              <Text style={s.introTitle}>Hi, I’m {agentName}.</Text>
              <Text style={s.introBody}>
                What’s on your mind? We can make a plan, untangle a task, or
                find a little room in your day.
              </Text>
              <SmallAction
                label="Make me yours"
                disabled={!identity}
                onPress={() => setCustomizingCharacter(true)}
              />
            </View>
          )}
        </FadeIn>
      )}

      {restoringChat && (
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          style={s.welcomeLine}
        >
          {restoringChat}
        </Text>
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
              <View style={s.botBubble}>
                <ProposalReview
                  proposal={turn.proposal}
                  items={items}
                  before={turn.before}
                  busy={locked}
                  state={turn.nudge ? "info" : turn.state}
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
                {turn.nudge && (
                  <ReminderNudge
                    card={turn.nudge}
                    busy={locked}
                    chatId={activeChatId}
                    turnId={turn.turnId}
                    skipped={turn.state === "discarded"}
                  />
                )}
                {turn.changesJob && (
                  <TurnChanges
                    job={turn.changesJob}
                    load={turnChanges}
                    undo={undoTurnChanges}
                  />
                )}
                <ChatTrace trace={turn.trace} />
              </View>
            </FadeIn>
          ),
        )}
        {waiting && (
          <View
            style={[shared.card, s.runCard]}
            accessibilityLiveRegion="polite"
          >
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
                <Field label="Your answer" style={s.runField}>
                  <TextInput
                    style={shared.input}
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
                </Field>
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
                <Button
                  title="Stop"
                  secondary
                  disabled={busy}
                  style={s.runButton}
                  onPress={() => void stopRun()}
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
                      const label = stepLabel(step);
                      return (
                        <Text key={`${label}-${index}`} style={s.runStep}>
                          {label}
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
                    title={`Always allow ${changeKindWords(waiting.change_kinds)}`}
                    secondary
                    disabled={busy}
                    style={s.runButton}
                    onPress={() => void approveWaiting(true, "always")}
                  />
                )}
                <Button
                  title="Decline"
                  secondary
                  disabled={busy}
                  style={s.runButton}
                  onPress={() => void approveWaiting(false)}
                />
                <Button
                  title="Stop"
                  secondary
                  disabled={busy}
                  style={s.runButton}
                  onPress={() => void stopRun()}
                />
              </>
            )}
          </View>
        )}
        {(thinking || runProgress?.state === "running") && !waiting && (
          <View
            style={s.working}
            accessibilityRole="progressbar"
            accessibilityLiveRegion="polite"
          >
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={s.workingText} numberOfLines={2}>
              {progressText(runProgress?.label) || `${agentName} is thinking…`}
            </Text>
            {runProgress?.state === "running" && (
              <Button
                title="Stop"
                secondary
                disabled={busy}
                style={s.runStop}
                onPress={() => void stopRun()}
              />
            )}
          </View>
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
  const {
    message,
    setMessage,
    thinking,
    restoringChat,
    runProgress,
    ask,
    stopRun,
    agentName,
    turns,
    scope,
  } = assistant;
  const running = runProgress?.state === "running";
  const locked = busy || thinking || runProgress?.state === "waiting";
  const canSend = !locked && !!message.trim();
  // Four lines at the user's text size, not four lines of the default size.
  const { fontScale } = useWindowDimensions();
  const suggestions = suggestionsFor(scope);
  return (
    <View>
      {turns.length === 0 && !thinking && (
        <FadeIn style={s.suggestions}>
          {suggestions.map((text, n) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              disabled={locked}
              onPress={() => ask(text)}
              style={({ pressed }) => [
                s.suggestion,
                pressed && { backgroundColor: colors.surfaceMuted },
                locked && { opacity: 0.5 },
              ]}
            >
              <Icon
                name={SUGGESTION_ICONS[n % SUGGESTION_ICONS.length]}
                size={18}
                color={colors.textSoft}
              />
              <Text style={s.suggestionText} numberOfLines={1}>
                {text}
              </Text>
            </Pressable>
          ))}
        </FadeIn>
      )}
      <View style={s.composer}>
        <TextInput
          style={[s.input, { maxHeight: LINE * 4 * fontScale + 20 }]}
          multiline
          placeholder={`Ask ${agentName}…`}
          placeholderTextColor={colors.faint}
          value={message}
          onChangeText={setMessage}
          maxLength={4000}
          textAlignVertical="center"
          accessibilityLabel={`Message ${agentName}`}
        />
        {running ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Stop"
            disabled={busy}
            onPress={() => void stopRun()}
            style={({ pressed }) => [
              s.send,
              pressed && { backgroundColor: colors.accentPressed },
            ]}
          >
            <Icon
              name="square"
              size={14}
              color={colors.white}
              strokeWidth={3}
            />
          </PressableScale>
        ) : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Send"
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
              name="arrowUp"
              size={18}
              color={colors.white}
              strokeWidth={2.2}
            />
          </PressableScale>
        )}
      </View>
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

/** A short, content-free account of the steps behind an assistant reply. */
function ChatTrace({ trace }: { trace: ChatTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const lines = traceLines(trace);
  if (!lines.length) return null;
  return (
    <View style={s.trace}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${open ? "Hide" : "Show"} steps`}
        onPress={() => setOpen((shown) => !shown)}
        style={({ pressed }) => [s.traceToggle, pressed && { opacity: 0.65 }]}
      >
        <Text style={s.traceToggleText}>Steps ({lines.length})</Text>
        <Icon
          name={open ? "chevronDown" : "chevronRight"}
          size={16}
          color={colors.muted}
        />
      </Pressable>
      {open && (
        <View style={s.traceList}>
          {lines.map((line, index) => (
            <Text key={`${index}-${line}`} style={s.traceLabel}>
              {line}
            </Text>
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
    sheetIntro: { marginBottom: 14 },
    multiline: { minHeight: 78, textAlignVertical: "top" },
    sheetActions: { flexDirection: "row", gap: 8 },
    sheetAction: { flex: 1 },
    sweptNote: {
      alignSelf: "stretch",
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
      gap: 10,
    },
    welcome: {
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 16,
    },
    welcomeLine: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.muted,
      textAlign: "center",
    },
    sweptTitle: {
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 6,
    },
    round: {
      width: controls.tap,
      height: controls.tap,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    roundPressed: { backgroundColor: colors.surfaceMuted },
    topIdentity: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      minHeight: controls.tap,
    },
    topName: {
      flexShrink: 1,
      textAlign: "center",
      fontFamily: fonts.bold,
      fontSize: 15,
      color: colors.text,
      paddingHorizontal: 12,
      paddingVertical: 3,
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.pill,
    },
    topStatus: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
    intro: {
      gap: 10,
      padding: 18,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
      alignSelf: "stretch",
    },
    introTitle: { fontFamily: fonts.medium, fontSize: 18, color: colors.text },
    introBody: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 23,
      color: colors.textSoft,
    },
    suggestions: { gap: 2, marginBottom: 10 },
    suggestion: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      minHeight: controls.tap,
      paddingHorizontal: 12,
      borderRadius: radii.input,
    },
    suggestionText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    scopeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 12,
    },
    thread: { gap: 12, marginBottom: 14 },
    userRow: { flexDirection: "row", justifyContent: "flex-end" },
    userBubble: {
      maxWidth: "85%",
      backgroundColor: colors.accentSoft,
      borderRadius: radii.card,
      paddingHorizontal: 15,
      paddingVertical: 11,
    },
    userText: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 21,
      color: colors.text,
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
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.card,
      padding: 16,
    },
    trace: {
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    traceToggle: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: 36,
    },
    traceToggleText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    traceList: { gap: 6, paddingBottom: 4 },
    traceLabel: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
    runCard: { gap: 9, marginBottom: 0 },
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
    runField: { marginBottom: 0 },
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
    working: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 4,
    },
    workingText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
    runStop: { marginBottom: 0 },
    composer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.pill,
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
