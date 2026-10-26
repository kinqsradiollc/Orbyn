import { providerDetailLines } from "@orbyn/core";
import { ReminderNudge } from "../components/ReminderNudge";
import {
  ConversationSeen,
  type ConversationViewport,
} from "../components/ConversationSeen";
import {
  AskAboutMessage,
  CopyMessage,
  UserMessage,
} from "../components/ConversationMessage";
import { ConversationDetails } from "../components/ConversationDetails";
import { ConversationUpdate } from "../components/ConversationUpdate";
import { session } from "../lib/session";
import React, {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  assistantSuggestions,
  assistantDateLabel,
  type AssistantSource,
  type Item,
  type Plan,
  type ChatTraceEntry,
  type AiChatSummary,
  type Project,
} from "@orbyn/core";
import { BottomSheet } from "../components/BottomSheet";
import { Button } from "../components/Button";
import { Icon, type IconName } from "../components/Icon";
import { AssistantAgents } from "./AssistantAgents";
import { AssistantDrawer } from "../components/AssistantDrawer";
import { PlanView, tickedMoves } from "../components/PlanView";
import { SmallAction } from "../components/SmallAction";
import { AssistantUpcoming } from "../components/AssistantUpcoming";
import { SavedConversationHistory } from "../components/SavedConversationHistory";
import { TurnChanges } from "../components/TurnChanges";
import { ActionSheet, type MoreAction } from "../components/MoreMenu";
import { ProposalReview } from "../components/ProposalReview";
import { Field } from "../components/Field";
import { InlineDetails } from "../components/InlineDetails";
import { client } from "../lib/api";
import {
  changeKindWords,
  progressText,
  stepLabel,
  traceLines,
} from "../lib/assistant-labels";
import type { Assistant } from "../hooks/useAssistant";
import { Pressable } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** Same starter prompts as the desktop assistant, one icon each. */
const SUGGESTIONS = assistantSuggestions;
const SUGGESTION_ICONS: IconName[] = ["calendar", "flag", "sun", "squarePen"];

/** Starter prompts for what the chat is about. */
function suggestionsFor(
  scope: Assistant["scope"],
): { title: string; prompt: string }[] {
  if (!scope) return SUGGESTIONS;
  const titles =
    scope.kind === "project"
      ? [
          "Where does it stand?",
          "What's at risk before the deadline?",
          "What changed since I last looked?",
        ]
      : ["Will I finish this by the deadline?", "What should I plan next?"];
  return titles.map((title) => ({ title, prompt: title }));
}

/**
 * The assistant's top bar: the side menu on the left, its name in the
 * middle, New chat on the right. It stays put while the chat scrolls.
 */
export function AssistantTopBar({
  assistant,
  busy,
  onMenu,
  onActivity,
}: {
  assistant: Assistant;
  busy: boolean;
  onMenu: () => void;
  onActivity: () => void;
}) {
  const { agentName, activeChatId, personalChatId, savedChats } = assistant;
  const title =
    activeChatId && activeChatId === personalChatId
      ? agentName
      : (savedChats?.find((chat) => chat.id === activeChatId)?.title ??
        "New chat");
  return (
    <View style={s.topBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Chats and more"
        onPress={onMenu}
        style={({ pressed }) => [s.round, pressed && s.roundPressed]}
      >
        <Icon name="menu" size={20} color={colors.text} strokeWidth={2} />
      </Pressable>
      <View style={s.topIdentity}>
        <Text style={s.modeText} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <SmallAction label="Activity" disabled={false} onPress={onActivity} />
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
  conversationViewport,
  onConversationFocus,
  onPrepareEarlier,
  onPreserveConversationPosition,
  conversationVisibility = 0,
  conversationVisible = true,
  centerComposer = false,
  openActivity = 0,
  onActivityOpened,
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
  conversationViewport?: ConversationViewport;
  onPrepareEarlier?: () => void;
  onPreserveConversationPosition?: (delta: number) => void;
  onConversationFocus?: (view: React.ComponentRef<typeof View>) => void;
  conversationVisibility?: number;
  conversationVisible?: boolean;
  centerComposer?: boolean;
  openActivity?: number;
  onActivityOpened?: () => void;
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
    agentName,
  } = assistant;
  const initializedHome = useRef<string | null>(null);
  useEffect(() => {
    if (!assistant.conversationEnabled) {
      initializedHome.current = null;
      return;
    }
    if (initializedHome.current === session.token) return;
    initializedHome.current = session.token;
    if (!activeChatId && !scope) void assistant.openPersonalConversation();
  }, [assistant.conversationEnabled, session.token]);
  const conversationRows = useRef(
    new Map<string, React.ComponentRef<typeof View>>(),
  );
  const registerConversationRow = useCallback(
    (sequence: string, view: React.ComponentRef<typeof View> | null) => {
      if (view) conversationRows.current.set(sequence, view);
      else conversationRows.current.delete(sequence);
    },
    [],
  );
  const earlierAnchor = useRef<{
    sequence: string;
    top: number;
    destination: string;
  } | null>(null);
  const loadEarlier = async () => {
    const destination = assistant.conversation.destination?.id;
    if (!destination || !conversationViewport?.current) return;
    onPrepareEarlier?.();
    const viewport = await new Promise<{ top: number; bottom: number }>(
      (resolve) =>
        conversationViewport.current!.measureInWindow((_x, y, _w, h) =>
          resolve({ top: y, bottom: y + h }),
        ),
    );
    const rows = await Promise.all(
      [...conversationRows.current].map(
        ([sequence, view]) =>
          new Promise<{ sequence: string; top: number; bottom: number }>(
            (resolve) =>
              view.measureInWindow((_x, y, _w, h) =>
                resolve({ sequence, top: y, bottom: y + h }),
              ),
          ),
      ),
    );
    const first = rows
      .filter((row) => row.bottom > viewport.top && row.top < viewport.bottom)
      .sort((a, b) => a.top - b.top)[0];
    if (first)
      earlierAnchor.current = {
        sequence: first.sequence,
        top: first.top,
        destination,
      };
    await assistant.loadEarlierConversation();
  };
  useEffect(() => {
    const anchor = earlierAnchor.current;
    if (!anchor || assistant.conversation.loading) return;
    earlierAnchor.current = null;
    if (anchor.destination !== assistant.conversation.destination?.id) return;
    const frame = requestAnimationFrame(() =>
      conversationRows.current
        .get(anchor.sequence)
        ?.measureInWindow((_x, y) =>
          onPreserveConversationPosition?.(y - anchor.top),
        ),
    );
    return () => cancelAnimationFrame(frame);
  }, [assistant.conversation.entries, assistant.conversation.loading]);
  const owner = session.token;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const actionPending = useRef(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => {
    if (openActivity > 0) {
      setActivityOpen(true);
      onActivityOpened?.();
    }
  }, [openActivity]);
  const [detailsEntryId, setDetailsEntryId] = useState<string | null>(null);
  const detailsEntry = assistant.conversation.entries.find(
    (entry) => entry.id === detailsEntryId,
  );
  useEffect(() => {
    if (!detailsEntry || !assistant.conversation.destination)
      setDetailsEntryId(null);
  }, [detailsEntry, assistant.conversation.destination]);
  const [deleteTarget, setDeleteTarget] = useState<AiChatSummary | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [agentLane, setAgentLane] = useState<"background" | "overnight" | null>(
    null,
  );
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [savedHistoryOpen, setSavedHistoryOpen] = useState(false);
  useEffect(() => setSavedHistoryOpen(false), [owner, activeChatId]);
  const [renameTarget, setRenameTarget] = useState<AiChatSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");
  // What opens once the side menu has gone (iOS shows one sheet at a time).
  const afterDrawer = useRef<{ owner: string; run: () => void } | null>(null);
  const closeDrawerThen = (next: () => void) => {
    afterDrawer.current = { owner, run: next };
    onDrawerChange(false);
  };
  const [personAnswer, setPersonAnswer] = useState("");
  const activeChat = savedChats?.find((chat) => chat.id === activeChatId);
  const runHistoryAction = async (
    action: () => Promise<void>,
    failed: string,
    onError: (message: string) => void = setActionError,
  ) => {
    if (actionPending.current || !alive.current || session.token !== owner)
      return;
    actionPending.current = true;
    setActionBusy(true);
    setActionError("");
    const current = () => alive.current && session.token === owner;
    try {
      await action();
    } catch {
      if (current()) onError(failed);
    } finally {
      actionPending.current = false;
      if (alive.current) setActionBusy(false);
    }
  };
  useEffect(() => {
    setRenameTarget(null);
    setDeleteTarget(null);
    setActionError("");
    setAgentLane(null);
    setActivityOpen(false);
    setDetailsEntryId(null);
    afterDrawer.current = null;
  }, [owner]);
  const chatActions = (chat: AiChatSummary): MoreAction[] => [
    {
      label: chat.pinned ? "Unpin chat" : "Pin chat",
      disabled: actionBusy,
      onPress: () =>
        void runHistoryAction(
          () => pinChat(chat.id, !chat.pinned),
          `Couldn't ${chat.pinned ? "unpin" : "pin"} chat. Try again.`,
        ),
    },
    {
      label: "Rename",
      disabled: actionBusy,
      onPress: () => {
        setRenameError("");
        setRenameDraft(chat.title);
        closeDrawerThen(() => setRenameTarget(chat));
      },
    },
    {
      label: "Save as Agent note",
      disabled: actionBusy,
      onPress: () =>
        void runHistoryAction(async () => {
          const note = await keepChatAsNote(chat.id);
          if (alive.current && session.token === owner) onKeptNote?.(note.id);
        }, "Couldn't save this chat as a note. Try again."),
    },
    {
      label: "Delete chat",
      destructive: true,
      disabled: actionBusy,
      onPress: () => {
        setDeleteError("");
        closeDrawerThen(() => setDeleteTarget(chat));
      },
    },
  ];
  const waiting = runProgress?.state === "waiting" ? runProgress.waiting : null;
  const locked =
    busy ||
    thinking ||
    !!waiting ||
    actionBusy ||
    !assistant.conversationReady ||
    !!assistant.replyStatus;
  useEffect(() => setPersonAnswer(""), [runProgress?.waiting?.question]);
  // Quick replies only make sense on the newest assistant reply.
  const latestReplyId = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")?.id;

  return (
    <View style={centerComposer ? s.newChat : undefined}>
      <AssistantDrawer
        visible={drawerOpen}
        onClose={() => onDrawerChange(false)}
        afterClose={() => {
          const next = afterDrawer.current;
          afterDrawer.current = null;
          if (next?.owner === session.token) next.run();
        }}
        agentName={agentName}
        primaryConversation={
          assistant.conversationEnabled
            ? {
                id: assistant.personalChatId,
                onOpen: () => {
                  onDrawerChange(false);
                  void assistant.openPersonalConversation();
                },
              }
            : undefined
        }
        chats={savedChats}
        activeChatId={activeChatId}
        search={chatSearch}
        onSearch={searchChats}
        locked={locked}
        chatActions={chatActions}
        onOpenChat={(chat) => {
          onDrawerChange(false);
          void runHistoryAction(
            () => openChat(chat.id),
            "Couldn't open chat. Try again.",
          );
        }}
        onNewChat={() => {
          onDrawerChange(false);
          reset();
        }}
        shortcuts={[
          {
            icon: "folder" as const,
            label: "New project chat",
            onPress: () =>
              closeDrawerThen(() => {
                const draft = assistant.message;
                reset();
                assistant.setHistoryKind("work");
                assistant.setMessage(draft);
              }),
          },
          ...(assistant.legacyHistoryAvailable && assistant.legacyHistoryTarget
            ? [
                {
                  icon: "fileText" as const,
                  label: "Previous saved history",
                  onPress: () =>
                    closeDrawerThen(() => setSavedHistoryOpen(true)),
                },
              ]
            : []),
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
        ]}
        onSettings={
          onOpenSettings ? () => closeDrawerThen(onOpenSettings) : undefined
        }
      />
      <ActionSheet
        visible={activityOpen}
        label="Activity"
        title="Activity"
        onClose={() => setActivityOpen(false)}
        actions={[
          { label: "Background", onPress: () => setAgentLane("background") },
          { label: "Overnight", onPress: () => setAgentLane("overnight") },
          { label: "Upcoming", onPress: () => setUpcomingOpen(true) },
        ]}
      />
      {detailsEntry && assistant.conversation.destination && (
        <ConversationDetails
          key={`${assistant.conversation.destination.id}:${detailsEntry.id}`}
          destinationId={assistant.conversation.destination.id}
          entryId={detailsEntry.id}
          onRefresh={() => void assistant.refreshConversation()}
          revision={JSON.stringify([
            detailsEntry.revision,
            detailsEntry.kind === "update"
              ? [
                  detailsEntry.actionable,
                  detailsEntry.waiting_kind,
                  detailsEntry.execution_chat_id,
                ]
              : null,
          ])}
          onClose={() => setDetailsEntryId(null)}
          onSource={onOpenSource}
          onWork={(id) => {
            void openChat(id);
          }}
          onActivity={setAgentLane}
        />
      )}
      <AssistantAgents
        visible={agentLane !== null}
        lane={agentLane ?? "background"}
        onClose={() => setAgentLane(null)}
        canOpen={!locked}
        onOpenChat={(id) => {
          void runHistoryAction(
            () => openChat(id),
            "Couldn't open chat. Try again.",
          );
        }}
      />
      <BottomSheet
        visible={!!renameTarget}
        title="Rename chat"
        closeDisabled={renameBusy || actionBusy}
        onClose={() => {
          if (!renameBusy && !actionPending.current) setRenameTarget(null);
        }}
        footer={
          <View style={s.sheetActions}>
            <Button
              title="Save"
              disabled={renameBusy || actionBusy || !renameDraft.trim()}
              style={s.sheetAction}
              onPress={() => {
                if (renameBusy || !renameTarget || !renameDraft.trim()) return;
                if (actionPending.current) return;
                const target = renameTarget;
                const title = renameDraft.trim();
                setRenameError("");
                setRenameBusy(true);
                void runHistoryAction(
                  async () => {
                    await renameChat(target.id, title);
                    if (alive.current && session.token === owner)
                      setRenameTarget(null);
                  },
                  "Couldn't rename chat. Try again.",
                  setRenameError,
                ).finally(() => {
                  if (alive.current) setRenameBusy(false);
                });
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
            editable={!renameBusy}
            onChangeText={setRenameDraft}
            style={shared.input}
            accessibilityLabel="Chat title"
          />
        </Field>
        {!!renameError && (
          <Text accessibilityRole="alert" style={s.renameError}>
            {renameError}
          </Text>
        )}
      </BottomSheet>
      <BottomSheet
        visible={!!deleteTarget}
        title="Delete chat?"
        closeDisabled={actionBusy}
        onClose={() => {
          if (!actionPending.current) setDeleteTarget(null);
        }}
        footer={
          <View style={s.sheetActions}>
            <Button
              title={actionBusy ? "Deleting…" : "Delete"}
              disabled={actionBusy}
              style={s.sheetAction}
              onPress={() => {
                if (!deleteTarget || actionPending.current) return;
                const target = deleteTarget;
                setDeleteError("");
                void runHistoryAction(
                  async () => {
                    await deleteChat(target.id);
                    if (alive.current && session.token === owner)
                      setDeleteTarget(null);
                  },
                  "Couldn't delete chat. Try again.",
                  setDeleteError,
                );
              }}
            />
            <Button
              title="Cancel"
              secondary
              disabled={actionBusy}
              style={s.sheetAction}
              onPress={() => setDeleteTarget(null)}
            />
          </View>
        }
      >
        <Text style={s.runBody}>
          “{deleteTarget?.title}” will be removed from your chat history.
        </Text>
        {deleteError ? (
          <Text accessibilityRole="alert" style={s.renameError}>
            {deleteError}
          </Text>
        ) : null}
      </BottomSheet>
      {actionError ? (
        <Text accessibilityRole="alert" style={s.renameError}>
          {actionError}
        </Text>
      ) : null}
      <AssistantUpcoming
        conversationEnabled={assistant.conversationEnabled}
        agentName={agentName}
        visible={upcomingOpen}
        onClose={() => setUpcomingOpen(false)}
      />
      {savedHistoryOpen && assistant.legacyHistoryTarget && (
        <SavedConversationHistory
          key={assistant.legacyHistoryTarget.destinationId}
          destinationId={assistant.legacyHistoryTarget.destinationId}
          chatId={assistant.legacyHistoryTarget.chatId}
          onClose={() => setSavedHistoryOpen(false)}
        />
      )}
      {scope && (
        <View style={s.scopeRow}>
          <SmallAction
            label={`In: ${scope.name} ×`}
            disabled={locked}
            onPress={() => setScope(null)}
          />
          {scope.kind === "project" && onBackToProject && (
            <SmallAction
              label="Open project"
              disabled={thinking}
              onPress={() => onBackToProject(scope.id)}
            />
          )}
        </View>
      )}
      {assistant.conversationItems.length === 0 && (
        <View style={s.welcome}>
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
              <Text style={s.introTitle}>What would you like to work on?</Text>
            </View>
          )}
        </View>
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
        {!!assistant.conversationIssue && (
          <Text style={shared.small}>{assistant.conversationIssue}</Text>
        )}
        {assistant.conversationEnabled && !assistant.conversationReady && (
          <SmallAction
            label="Open conversation"
            disabled={busy || thinking || !!restoringChat}
            onPress={() => void assistant.openPersonalConversation()}
          />
        )}

        {assistant.conversation.hasEarlier && (
          <SmallAction
            label="Earlier messages"
            disabled={assistant.conversation.loading}
            onPress={() => void loadEarlier()}
          />
        )}
        {assistant.conversation.error && (
          <SmallAction
            label="Retry loading conversation"
            disabled={assistant.conversation.loading}
            onPress={() => void assistant.refreshConversation()}
          />
        )}
        {assistant.conversationItems.map((item, index) => {
          const entryDate = assistant.conversation.entries.find(
            (entry) => entry.id === item.id,
          );
          const previousDate = assistant.conversation.entries.find(
            (entry) => entry.id === assistant.conversationItems[index - 1]?.id,
          );
          const date = entryDate
            ? assistantDateLabel(
                entryDate.created_at,
                previousDate?.created_at,
                Intl.DateTimeFormat().resolvedOptions().timeZone,
              )
            : null;
          const wrap = (children: React.ReactNode) => (
            <ConversationSeen
              key={item.id}
              sequence={item.sequence}
              viewport={conversationViewport}
              revision={conversationVisibility}
              active={
                conversationVisible &&
                !drawerOpen &&
                !agentLane &&
                !upcomingOpen &&
                !savedHistoryOpen &&
                !detailsEntryId &&
                !activityOpen &&
                !renameTarget &&
                !deleteTarget
              }
              onSeen={assistant.acknowledgeConversation}
              onRow={registerConversationRow}
              focused={item.sequence === assistant.focusedConversationSequence}
              onFocus={onConversationFocus}
            >
              {date && (
                <Text
                  style={[
                    shared.small,
                    { textAlign: "center", marginVertical: 16 },
                  ]}
                >
                  {date}
                </Text>
              )}
              {children}
            </ConversationSeen>
          );
          if (item.kind === "update")
            return wrap(
              <ConversationUpdate
                key={item.id}
                entry={item.entry}
                busy={locked}
                onReply={() => assistant.selectReply(item.entry)}
                onWork={(id) => void openChat(id)}
                onActivity={setAgentLane}
                onSelectExcerpt={(excerpt) =>
                  assistant.selectExcerpt(item.entry, excerpt)
                }
                onDetails={() => setDetailsEntryId(item.entry.id)}
              />,
            );
          const turn = item.turn;
          const retainedEntry = assistant.conversation.entries.find(
            (entry) => entry.id === item.id,
          );
          const askAbout = retainedEntry ? (
            <AskAboutMessage
              text={
                retainedEntry.kind === "turn"
                  ? retainedEntry.turn.text
                  : retainedEntry.text
              }
              onSelect={(excerpt) =>
                assistant.selectExcerpt(retainedEntry, excerpt)
              }
            />
          ) : null;
          return wrap(
            turn.role === "user" ? (
              <View key={turn.id} style={s.userRow}>
                <View style={s.userBubble}>
                  <UserMessage text={turn.text} textStyle={s.userText} />
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <CopyMessage text={turn.text} />
                  {askAbout}
                </View>
              </View>
            ) : (
              <View key={turn.id} style={s.botRow}>
                <View style={s.botBubble}>
                  <ProposalReview
                    hideSourceDetails={!!retainedEntry}
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
                  {providerDetailLines(turn.trace).map((label) => (
                    <Text key={label} style={shared.small}>
                      {label}
                    </Text>
                  ))}
                  <ChatTrace trace={turn.trace} />
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}
                  >
                    <CopyMessage text={turn.proposal.summary} />
                    {retainedEntry && (
                      <SmallAction
                        quiet
                        label="Details"
                        disabled={false}
                        onPress={() => setDetailsEntryId(retainedEntry.id)}
                      />
                    )}
                    {askAbout}
                  </View>
                </View>
              </View>
            ),
          );
        })}
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
                    editable={!busy}
                    onChangeText={setPersonAnswer}
                    placeholder="Or type your answer…"
                    placeholderTextColor={colors.faint}
                    accessibilityLabel="Your answer"
                    returnKeyType="send"
                    onSubmitEditing={() => {
                      const answer = personAnswer.trim();
                      if (!busy && answer) {
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
                    if (!busy && answer) {
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
                    {waiting.steps.map((step, index) => {
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
            <Text style={s.workingText}>
              {progressText(runProgress?.label) || "Orbyn is thinking…"}
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

      {centerComposer && (
        <AssistantComposer assistant={assistant} busy={busy} />
      )}
      <View style={s.sharing}>
        <Text style={shared.small}>
          Messages and relevant Orbyn content go to your AI provider.
        </Text>
        <InlineDetails title="What is shared">
          <Text style={shared.small}>
            {scope?.kind === "project"
              ? "Your question, project tasks, notes, decisions and pages opened by the assistant."
              : scope?.kind === "task"
                ? "Your question, this task, its sessions and pages opened by the assistant."
                : "Your question, recent tasks, the next few calendar days and pages opened by the assistant."}
          </Text>
        </InlineDetails>
      </View>
    </View>
  );
}

/**
 * The message box and Send. It grows with what's typed up to about four
 * lines, then scrolls inside itself.
 */
function WorkProjectPicker({
  assistant,
  disabled,
}: {
  assistant: Assistant;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ assistant, disabled, projects });
  latest.current = { assistant, disabled, projects };
  const matches =
    projects?.filter((project) =>
      project.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  const selected = useRef<{ project: Project; token: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!open) return;
    let active = true;
    const token = session.token;
    setProjects(null);
    setFailed(false);
    client.listProjects().then(
      (rows) => {
        if (active && token === session.token) setProjects(rows);
      },
      () => {
        if (active && token === session.token) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [open, attempt]);
  return (
    <>
      <SmallAction
        label={
          assistant.scope?.kind === "project"
            ? assistant.scope.name
            : "Choose project"
        }
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      <BottomSheet
        visible={open}
        title="Choose project"
        onClose={() => {
          selected.current = null;
          setOpen(false);
        }}
        afterClose={() => {
          const selection = selected.current;
          selected.current = null;
          const current = latest.current;
          const project = current.projects?.find(
            (project) => project.id === selection?.project.id,
          );
          if (
            !selection ||
            current.disabled ||
            selection.token !== session.token ||
            !project ||
            project.assistant_off
          )
            return;
          const draft = current.assistant.message;
          current.assistant.setScope({
            kind: "project",
            id: project.id,
            name: project.name,
          });
          current.assistant.setMessage(draft);
        }}
      >
        {failed ? (
          <View>
            <Text style={s.renameError} accessibilityRole="alert">
              Couldn't load projects.
            </Text>
            <SmallAction
              label="Retry"
              disabled={false}
              onPress={() => setAttempt((value) => value + 1)}
            />
          </View>
        ) : projects === null ? (
          <Text style={shared.small}>Loading projects…</Text>
        ) : projects.length === 0 ? (
          <Text style={shared.small}>No projects yet</Text>
        ) : (
          <View style={s.projectChoices}>
            <TextInput
              style={shared.input}
              value={query}
              onChangeText={setQuery}
              accessibilityLabel="Search projects"
              placeholder="Search projects"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView
              style={s.projectList}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {matches.length ? (
                matches.map((project) => (
                  <SmallAction
                    key={project.id}
                    label={`${project.name}${project.assistant_off ? " · AI off" : ""}`}
                    disabled={disabled || !!project.assistant_off}
                    onPress={() => {
                      if (latest.current.disabled || project.assistant_off)
                        return;
                      selected.current = { project, token: session.token };
                      setOpen(false);
                    }}
                  />
                ))
              ) : (
                <Text style={shared.small}>No matching projects</Text>
              )}
            </ScrollView>
          </View>
        )}
      </BottomSheet>
    </>
  );
}

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
  const locked =
    busy ||
    thinking ||
    !!restoringChat ||
    runProgress?.state === "waiting" ||
    !assistant.conversationReady ||
    !!assistant.replyStatus;
  const workMode =
    assistant.historyKind === "work" || scope?.kind === "project";
  const needsProject = workMode && scope?.kind !== "project";
  const canSend = !locked && !needsProject && !!message.trim();
  // Four lines at the user's text size, not four lines of the default size.
  const { fontScale, width } = useWindowDimensions();
  const [inputHeight, setInputHeight] = useState(44);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  useEffect(() => {
    if (assistant.replyTarget) inputRef.current?.focus();
  }, [assistant.replyTarget?.id, assistant.replyTarget?.excerpt]);
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const element = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!element) return;
    // scrollHeight includes the current box height. Reset it before measuring
    // so deleting text can shrink the composer instead of retaining four lines.
    element.style.height = "0px";
    const height = Math.max(
      44,
      Math.min(element.scrollHeight, LINE * 4 * fontScale + 20),
    );
    element.style.height = `${height}px`;
    setInputHeight(height);
  }, [message, fontScale, width]);
  useEffect(() => {
    if (!message) setInputHeight(44);
  }, [message]);
  const suggestions = suggestionsFor(scope);
  return (
    <View>
      {needsProject && (
        <WorkProjectPicker assistant={assistant} disabled={locked} />
      )}
      {assistant.failedAnswers.map((answer) => (
        <View key={answer.id} style={s.replyContext}>
          <Text style={[shared.small, s.replyContextText]}>
            Answer draft: {answer.text}
            {!assistant.canRestoreFailedAnswer(answer.id) &&
              " · Clear your current draft and reply to restore this answer."}
          </Text>
          <SmallAction
            label="Restore answer"
            disabled={locked || !assistant.canRestoreFailedAnswer(answer.id)}
            onPress={() => assistant.restoreFailedAnswer(answer.id)}
          />
        </View>
      ))}
      {!!assistant.replyStatus && (
        <View>
          <Text style={shared.small}>
            {assistant.replyStatus === "loading"
              ? "Restoring reply…"
              : "This update is no longer available."}
          </Text>
          <SmallAction
            label="Cancel reply"
            disabled={busy || thinking}
            onPress={assistant.clearReply}
          />
        </View>
      )}
      {assistant.replyTarget && (
        <View style={s.replyContext}>
          <Text numberOfLines={2} style={[shared.small, s.replyContextText]}>
            Replying to:{" "}
            {assistant.replyTarget.excerpt ??
              (assistant.replyTarget.kind === "turn"
                ? assistant.replyTarget.turn.text
                : assistant.replyTarget.text)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            disabled={locked}
            onPress={assistant.clearReply}
            style={s.replyCancel}
          >
            <Icon name="x" size={18} color={colors.textSoft} />
          </Pressable>
        </View>
      )}
      <View style={s.composer}>
        <TextInput
          ref={inputRef}
          style={[
            s.input,
            ...(Platform.OS === "web"
              ? [{ resize: "none", overflowY: "auto" } as never]
              : []),
            {
              height: Math.max(
                LINE * fontScale + 20,
                Math.min(inputHeight, LINE * 4 * fontScale + 20),
              ),
              maxHeight: LINE * 4 * fontScale + 20,
            },
          ]}
          multiline
          scrollEnabled
          onContentSizeChange={
            Platform.OS === "web"
              ? undefined
              : (event) => setInputHeight(event.nativeEvent.contentSize.height)
          }
          placeholder={
            workMode ? `Work with ${agentName}…` : `Message ${agentName}…`
          }
          placeholderTextColor={colors.faint}
          value={message}
          onChangeText={setMessage}
          maxLength={4000}
          textAlignVertical="center"
          accessibilityLabel="Message Orbyn"
        />
        {running ? (
          <Pressable
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
              color={colors.onAccent}
              strokeWidth={3}
            />
          </Pressable>
        ) : (
          <Pressable
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
              color={colors.onAccent}
              strokeWidth={2.2}
            />
          </Pressable>
        )}
      </View>
      {assistant.conversationItems.length === 0 && !thinking && (
        <View style={s.suggestions}>
          {suggestions.map((suggestion, n) => (
            <Pressable
              key={suggestion.title}
              accessibilityRole="button"
              disabled={locked}
              onPress={() =>
                needsProject
                  ? setMessage(suggestion.prompt)
                  : ask(suggestion.prompt)
              }
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
              <Text style={s.suggestionText}>{suggestion.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
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
    <View style={s.plan}>
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
    </View>
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

/** Line height of the message box; it grows to four lines before scrolling. */
const LINE = 21;

const s = themed(() =>
  StyleSheet.create({
    projectChoices: { gap: 8, minWidth: 0 },
    projectList: { maxHeight: 300 },
    sheetIntro: { marginBottom: 14 },
    multiline: { minHeight: 78, textAlignVertical: "top" },
    sheetActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    sheetAction: { flexGrow: 1, flexShrink: 1, flexBasis: 120, minWidth: 0 },
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
    newChat: { flex: 1, justifyContent: "center", minWidth: 0 },
    modeText: { color: colors.text, fontSize: 15, fontFamily: fonts.medium },
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
      flex: 1,
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    topStatus: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
    intro: { paddingVertical: 20, paddingHorizontal: 16, alignSelf: "stretch" },
    introTitle: {
      fontFamily: fonts.medium,
      fontSize: 18,
      lineHeight: 26,
      color: colors.text,
      textAlign: "center",
    },
    introBody: {
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 23,
      color: colors.textSoft,
    },
    suggestions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 10,
    },
    suggestion: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: controls.tap,
      maxWidth: "100%",
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.input,
    },
    suggestionText: {
      flexShrink: 1,
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
    userRow: { flexDirection: "column", alignItems: "flex-end" },
    userBubble: {
      maxWidth: "85%",
      backgroundColor: colors.surfaceMuted,
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
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 2,
    },
    botBubble: {
      minWidth: 0,
      width: "100%",
      backgroundColor: "transparent",
      borderRadius: radii.card,
      paddingVertical: 8,
    },
    trace: {
      marginTop: 8,
      paddingTop: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    renameError: {
      color: colors.danger,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
    traceToggle: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minHeight: controls.tap,
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
      flexWrap: "wrap",
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
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      padding: 5,
      paddingLeft: 12,
    },
    replyContext: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 6,
    },
    replyContextText: { flex: 1, minWidth: 0 },
    replyCancel: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      fontFamily: fonts.regular,
      fontSize: Platform.OS === "web" ? 16 : 15,
      lineHeight: LINE,
      color: colors.text,
      paddingTop: 10,
      paddingBottom: 10,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: radii.pill,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sharing: { minWidth: 0, marginTop: 8 },
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
