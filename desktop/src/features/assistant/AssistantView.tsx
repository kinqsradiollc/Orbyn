import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Flag,
  History,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  PenLine,
  Lightbulb,
  Sparkles,
  SquarePen,
  Sunrise,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  assistantSuggestions as SUGGESTIONS,
  type AssistantSource,
  type Item,
  type Plan,
  type AiChatSummary,
  type ChatTraceEntry,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { useConfirm } from "../../components/Confirm";
import { useToast } from "../../components/Toast";
import { errorText } from "../../lib/errors";
import {
  changeKindWords,
  progressText,
  stepLabel,
  traceLines,
} from "../../lib/assistant-labels";
import { TurnChanges } from "./TurnChanges";
import { ReminderNudge } from "./ReminderNudge";
import { ProposalReview } from "../../components/ProposalReview";
import { AssistantUpcoming } from "./AssistantUpcoming";
import { client } from "../../lib/api";
import type { Assistant } from "../../hooks/useAssistant";
import { stagger } from "../../lib/motion";
import "./assistant.css";

/** One icon per suggestion, in the shared list's order. */
const SUGGESTION_ICONS: LucideIcon[] = [CalendarDays, Flag, Sunrise, PenLine];

type Props = {
  items: Item[];
  busy: boolean;
  assistant: Assistant;
  /** Saves a plan the assistant made; resolves with a message. */
  onApplyPlan: (plan: Plan, moves?: string[]) => Promise<string>;
  /** Shows a plan in the calendar's planner. */
  onOpenPlan: (plan: Plan) => void;
  /** After a plan is applied: the calendar at its first changed session. */
  onShowOnCalendar?: (at: string) => void;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: AssistantSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
  /** Bumped to open Upcoming (goals and routines), as Home's panels do. */
  openUpcoming?: number;
};

export function AssistantView({
  items,
  busy,
  assistant,
  onApplyPlan,
  onOpenPlan,
  onShowOnCalendar,
  onOpenSource,
  onKeptNote,
  openUpcoming = 0,
}: Props) {
  const {
    message,
    setMessage,
    turns,
    thinking,
    runProgress,
    answerWaiting,
    approveWaiting,
    stopRun,
    ask,
    draftProject,
    apply,
    dismiss,
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
  } = assistant;
  const { ask: confirm } = useConfirm();
  const toast = useToast();
  const suggestions = scope
    ? scope.kind === "project"
      ? [
          { title: "Where does it stand?", hint: "Summarise this project" },
          {
            title: "What's at risk before the deadline?",
            hint: "Check this project's plan",
          },
          {
            title: "What changed since I last looked?",
            hint: "Catch up on this project",
          },
        ]
      : [
          {
            title: "Will I finish this by the deadline?",
            hint: "Check this task's plan",
          },
          {
            title: "What should I plan next?",
            hint: "Find the next step for this task",
          },
        ]
    : SUGGESTIONS;
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [quickMenu, setQuickMenu] = useState<DOMRect | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatMenu, setChatMenu] = useState<{
    chat: AiChatSummary;
    anchor: DOMRect;
  } | null>(null);
  // The rename being typed, for the chat it belongs to.
  const [rename, setRename] = useState<{ id: string; draft: string } | null>(
    null,
  );
  const renameDraft =
    rename && rename.id === chatMenu?.chat.id ? rename.draft : null;
  const closeChatMenu = () => {
    setChatMenu(null);
    setRename(null);
  };
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState("");
  const [personAnswer, setPersonAnswer] = useState("");
  const [upcomingOpen, setUpcomingOpen] = useState(openUpcoming > 0);
  useEffect(() => {
    if (openUpcoming > 0) setUpcomingOpen(true);
  }, [openUpcoming]);
  const [approveMenu, setApproveMenu] = useState<DOMRect | null>(null);
  const activeChat = savedChats?.find((chat) => chat.id === activeChatId);
  useEffect(() => {
    if (!identity) return;
    setIdentityName(identity.name);
    setIdentityPersona(identity.persona);
  }, [identity]);
  /** Runs a chat menu action, closing the menu or showing why it failed. */
  const chatAction = (run: () => Promise<unknown>, failed: string) =>
    void run().then(closeChatMenu, (e: unknown) =>
      toast({ tone: "warn", text: `${failed} ${errorText(e)}` }),
    );
  const saveIdentity = async (e: FormEvent) => {
    e.preventDefault();
    if (identitySaving) return;
    setIdentitySaving(true);
    setIdentityError("");
    try {
      setIdentity(
        await client.updateAgentSettings({
          name: identityName.trim() || "Orbyn",
          persona: identityPersona,
        }),
      );
    } catch {
      setIdentityError("Your assistant details could not be saved. Try again.");
    } finally {
      setIdentitySaving(false);
    }
  };
  const skipIdentity = async () => {
    if (identitySaving) return;
    setIdentitySaving(true);
    setIdentityError("");
    try {
      setIdentity(
        await client.updateAgentSettings({ name: "Orbyn", persona: "" }),
      );
    } catch {
      setIdentityError("Your assistant details could not be saved. Try again.");
    } finally {
      setIdentitySaving(false);
    }
  };
  const waiting = runProgress?.state === "waiting" ? runProgress.waiting : null;
  const locked = busy || thinking || !!waiting;
  useEffect(() => setPersonAnswer(""), [runProgress?.waiting?.question]);
  const empty = turns.length === 0 && !thinking;
  // Quick replies only make sense on the newest assistant reply.
  const latestReplyId = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")?.id;

  // Mobile keyboards resize the visual viewport even when 100dvh stays unchanged.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--chat-viewport-height",
        `${viewport.height}px`,
      );
    update();
    viewport.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--chat-viewport-height");
    };
  }, []);

  // Keep the newest message in view by scrolling the conversation itself,
  // never the page, so the composer stays where it is. Once per message,
  // not on every render.
  useEffect(() => {
    const el = threadRef.current;
    if (!el || (turns.length === 0 && !thinking && !runProgress)) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [
    turns.length,
    thinking,
    runProgress?.state,
    runProgress?.waiting?.question,
  ]);

  // One line at rest; grows with its text up to the stylesheet's max-height
  // (about eight lines), then scrolls inside. Text rewraps when the window
  // changes size, so it is measured again then.
  useEffect(() => {
    const fit = () => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = "auto";
      const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
      el.style.height = Math.min(el.scrollHeight, max) + "px";
      el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [message]);

  const send = () => {
    if (!locked && message.trim()) void ask();
  };

  const suggest = (text: string) => {
    setQuickMenu(null);
    void ask(text);
  };
  const startProject = () => {
    setQuickMenu(null);
    if (!locked && message.trim()) void draftProject();
  };

  return (
    <section className={"ai-chat" + (empty ? " is-empty" : "")}>
      <aside
        className={"ai-history" + (historyOpen ? " is-open" : "")}
        aria-label="Chat history"
      >
        <div className="ai-history-head">
          <div className="ai-history-title">
            <History size={16} aria-hidden="true" />
            <h2>Chats</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="New chat"
              title="New chat"
              disabled={locked}
              onClick={() => {
                setHistoryOpen(false);
                reset();
              }}
            >
              <SquarePen size={16} aria-hidden="true" />
            </button>
          </div>
          <a href="/app/overnight">Overnight</a>
          <input
            type="search"
            aria-label="Search chats"
            placeholder="Search chats"
            value={chatSearch}
            onChange={(event) => searchChats(event.target.value)}
          />
        </div>
        <div className="ai-history-list">
          {savedChats?.map((chat) => (
            <div
              key={chat.id}
              className={
                "ai-history-row" +
                (chat.id === activeChatId ? " is-active" : "")
              }
            >
              <button
                type="button"
                className="ai-history-open"
                disabled={locked}
                onClick={() => {
                  closeChatMenu();
                  setHistoryOpen(false);
                  void openChat(chat.id).catch(() => undefined);
                }}
                title={chat.title}
              >
                <span className="ai-history-chat-title">
                  {chat.pinned && <Pin size={12} aria-label="Pinned" />}
                  <span>{chat.title}</span>
                  {chat.active && (
                    <small className="ai-op ai-op-update" role="status">
                      {chat.active === "needs_you" ? "Needs you" : "Working"}
                    </small>
                  )}
                </span>
                <small>
                  {chat.swept_at
                    ? "Summary saved"
                    : (chat.project_name ??
                      new Date(chat.last_used_at).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      }))}
                </small>
              </button>
              <button
                type="button"
                className="icon-button ai-history-options"
                aria-label={`Options for ${chat.title}`}
                title="Chat options"
                disabled={locked}
                onClick={(event) =>
                  setChatMenu({
                    chat,
                    anchor: event.currentTarget.getBoundingClientRect(),
                  })
                }
              >
                <MoreHorizontal size={16} aria-hidden="true" />
              </button>
            </div>
          ))}
          {savedChats?.length === 0 && (
            <p className="ai-history-empty">
              {chatSearch.trim() ? "No chats match" : "No chats yet"}
            </p>
          )}
          {savedChats === null && (
            <p className="ai-history-empty">Loading chats…</p>
          )}
        </div>
      </aside>
      <div className="ai-main">
        {identity && !identity.named_at && (
          <div className="modal-backdrop">
            <section
              className="modal modal-small scale-in"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ai-name-title"
            >
              <div className="section-heading">
                <h2 id="ai-name-title">Give your assistant a name</h2>
              </div>
              <form onSubmit={saveIdentity}>
                <p className="muted modal-lead">
                  Choose a name and, if you like, how it should come across. You
                  can change both later in Settings.
                </p>
                <label>
                  Name
                  <input
                    autoFocus
                    required
                    maxLength={40}
                    value={identityName}
                    onChange={(e) => setIdentityName(e.target.value)}
                  />
                </label>
                <label>
                  Persona
                  <textarea
                    maxLength={1000}
                    rows={3}
                    placeholder="Warm, direct, and concise"
                    value={identityPersona}
                    onChange={(e) => setIdentityPersona(e.target.value)}
                  />
                  <span className="field-hint">Optional.</span>
                </label>
                {identityError && (
                  <p className="error" role="alert">
                    {identityError}
                  </p>
                )}
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={identitySaving}
                    onClick={() => void skipIdentity()}
                  >
                    Keep “Orbyn”
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={identitySaving}
                  >
                    Save
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
        <div className="ai-chat-head">
          {/* History and New chat live in the Chats panel; on a phone the
              panel is hidden, so these two open it or start afresh. */}
          <button
            type="button"
            className="icon-button ai-narrow-only"
            aria-label={historyOpen ? "Close chat history" : "Chat history"}
            aria-expanded={historyOpen}
            title={historyOpen ? "Close chat history" : "Chat history"}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <History size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button ai-narrow-only"
            onClick={() => {
              setHistoryOpen(false);
              reset();
            }}
            disabled={locked}
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen size={18} aria-hidden="true" />
          </button>
          {scope && (
            <button
              type="button"
              className="secondary ai-scope"
              disabled={locked}
              onClick={() => setScope(null)}
              title="Remove assistant scope"
            >
              In: {scope.name} <X size={14} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="secondary ai-upcoming-trigger"
            aria-expanded={upcomingOpen}
            aria-controls="ai-upcoming"
            onClick={() => setUpcomingOpen((open) => !open)}
          >
            <CalendarClock size={15} aria-hidden="true" />
            Upcoming
          </button>
        </div>

        <div className="ai-thread" aria-live="polite" ref={threadRef}>
          {empty && <h2 className="ai-greeting">What’s on your mind today?</h2>}

          {activeChat?.swept_at && (
            <div className="ai-swept-note">
              <strong>This chat has been saved as a summary note.</strong>
              {activeChat.summary_doc_id && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onKeptNote?.(activeChat.summary_doc_id!)}
                >
                  Open summary
                </button>
              )}
            </div>
          )}

          {turns.map((turn) =>
            turn.role === "user" ? (
              <div key={turn.id} className="ai-row ai-row-user">
                <div className="ai-bubble ai-bubble-user">{turn.text}</div>
              </div>
            ) : (
              <div key={turn.id} className="ai-row">
                <div className="ai-reply">
                  <ProposalReview
                    proposal={turn.proposal}
                    items={items}
                    before={turn.before}
                    busy={locked}
                    state={turn.nudge ? "info" : turn.state}
                    onApply={(giveTasksDeadlines) =>
                      void apply(turn.id, giveTasksDeadlines)
                    }
                    onDismiss={() => dismiss(turn.id)}
                    onApplyPlan={onApplyPlan}
                    onOpenPlan={onOpenPlan}
                    onShowOnCalendar={onShowOnCalendar}
                    onOpenSource={onOpenSource}
                    onKeptNote={onKeptNote}
                    onFollowUp={
                      turn.id === latestReplyId
                        ? (text) => void ask(text)
                        : undefined
                    }
                  />
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
                  <TurnSteps entries={turn.trace} />
                </div>
              </div>
            ),
          )}

          {waiting && (
            <div className="ai-row">
              <section className="ai-run-card" aria-live="polite">
                {waiting.kind === "person" ? (
                  <>
                    <strong>{agentName} has a question</strong>
                    <p>{waiting.question}</p>
                    {!!waiting.choices.length && (
                      <div className="ai-run-choices">
                        {waiting.choices.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            className="secondary"
                            disabled={busy}
                            onClick={() => void answerWaiting(choice)}
                          >
                            {choice}
                          </button>
                        ))}
                      </div>
                    )}
                    <form
                      className="ai-run-answer"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const answer = personAnswer.trim();
                        if (!busy && answer) {
                          setPersonAnswer("");
                          void answerWaiting(answer);
                        }
                      }}
                    >
                      <label className="settings-field">
                        <span className="settings-label">
                          {waiting.choices.length
                            ? "Or write your own answer"
                            : "Your answer"}
                        </span>
                        <input
                          maxLength={4000}
                          value={personAnswer}
                          onChange={(event) =>
                            setPersonAnswer(event.target.value)
                          }
                        />
                      </label>
                      <div className="button-row">
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() => void stopRun()}
                        >
                          Stop
                        </button>
                        <button
                          type="submit"
                          className="primary"
                          disabled={busy || !personAnswer.trim()}
                        >
                          Answer
                        </button>
                      </div>
                    </form>
                  </>
                ) : (
                  <>
                    <strong>Check these changes before they’re made</strong>
                    <p>{waiting.question}</p>
                    {waiting.summary && (
                      <p className="muted">{waiting.summary}</p>
                    )}
                    {waiting.detail && (
                      <p className="muted">{waiting.detail}</p>
                    )}
                    {!!waiting.steps.length && (
                      <ul className="ai-run-steps">
                        {waiting.steps.slice(0, 20).map((step, index) => {
                          const label = stepLabel(step);
                          return <li key={`${label}-${index}`}>{label}</li>;
                        })}
                      </ul>
                    )}
                    <div className="button-row">
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() => void stopRun()}
                      >
                        Stop
                      </button>
                      {(!!waiting.automation_kind ||
                        !!waiting.change_kinds?.length) && (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="More ways to approve"
                          title="More ways to approve"
                          aria-haspopup="dialog"
                          aria-expanded={!!approveMenu}
                          disabled={busy}
                          onClick={(event) =>
                            setApproveMenu(
                              approveMenu
                                ? null
                                : event.currentTarget.getBoundingClientRect(),
                            )
                          }
                        >
                          <MoreHorizontal size={18} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void approveWaiting(false)}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void approveWaiting(true, "once")}
                      >
                        Apply changes
                      </button>
                    </div>
                    {approveMenu && (
                      <Popover
                        anchor={approveMenu}
                        label="More ways to approve"
                        onClose={() => setApproveMenu(null)}
                      >
                        <div className="popover-actions">
                          {waiting.automation_kind && (
                            <button
                              type="button"
                              onClick={() => {
                                setApproveMenu(null);
                                void approveWaiting(
                                  true,
                                  waiting.automation_kind,
                                );
                              }}
                            >
                              Apply and don’t ask again for this{" "}
                              {waiting.automation_kind}
                            </button>
                          )}
                          {!!waiting.change_kinds?.length && (
                            <button
                              type="button"
                              onClick={() => {
                                setApproveMenu(null);
                                void approveWaiting(true, "always");
                              }}
                            >
                              Apply and always allow{" "}
                              {changeKindWords(waiting.change_kinds)}
                            </button>
                          )}
                        </div>
                      </Popover>
                    )}
                  </>
                )}
              </section>
            </div>
          )}

          {thinking && (
            <div className="ai-run-status" role="status">
              <Loader2 size={15} className="spin" aria-hidden="true" />
              <span>
                {progressText(runProgress?.label) ||
                  `${agentName} is thinking…`}
              </span>
              {runProgress?.state === "running" && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void stopRun()}
                >
                  Stop
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ai-dock">
          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <button
              type="button"
              className="ai-tool"
              aria-label="Suggestions"
              title="Suggestions"
              aria-haspopup="dialog"
              aria-expanded={!!quickMenu}
              disabled={locked}
              onClick={(e) =>
                setQuickMenu(
                  quickMenu ? null : e.currentTarget.getBoundingClientRect(),
                )
              }
            >
              {/* Suggested requests, not attachments: the assistant takes
                text only, so a "+" would promise files it can't read. */}
              <Lightbulb size={19} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              aria-label="Message your assistant"
              aria-describedby="ai-composer-hint"
              placeholder={`Ask ${agentName}…`}
              value={message}
              maxLength={4000}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <span id="ai-composer-hint" className="sr-only">
              Enter to send, Shift+Enter for a new line
            </span>
            <button
              className="ai-send"
              aria-label="Send"
              disabled={locked || !message.trim()}
            >
              <ArrowUp size={18} />
            </button>
          </form>

          {empty && (
            <div className="ai-suggestions" aria-label="Suggestions">
              {suggestions.map((s, n) => {
                const Icon = SUGGESTION_ICONS[n % SUGGESTION_ICONS.length];
                return (
                  <button
                    key={s.title}
                    className="fade-up stagger"
                    style={stagger(n)}
                    type="button"
                    disabled={locked}
                    title={s.hint}
                    onClick={() => suggest(s.title)}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{s.title}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <small className="ai-note">
          {scope?.kind === "project"
            ? `Your question, this project's tasks, notes and decisions, and any pages the assistant opens are sent to the AI service Orbyn uses to answer you.`
            : scope?.kind === "task"
              ? `Your question, this task and its sessions, and any pages the assistant opens are sent to the AI service Orbyn uses to answer you.`
              : `Your question, recent tasks, the next few days of your calendar and any pages the assistant opens are sent to the AI service Orbyn uses to answer you.`}
        </small>

        {chatMenu && (
          <Popover
            anchor={chatMenu.anchor}
            label={`Options for ${chatMenu.chat.title}`}
            onClose={closeChatMenu}
          >
            {renameDraft !== null ? (
              <form
                className="ai-rename-chat"
                onSubmit={(event) => {
                  event.preventDefault();
                  const title = renameDraft.trim();
                  if (!title) return;
                  chatAction(
                    () => renameChat(chatMenu.chat.id, title),
                    "The chat could not be renamed.",
                  );
                }}
              >
                <div className="settings-field">
                  <label htmlFor="ai-rename-chat">Chat name</label>
                  <input
                    id="ai-rename-chat"
                    autoFocus
                    maxLength={120}
                    value={renameDraft}
                    onChange={(event) =>
                      setRename({
                        id: chatMenu.chat.id,
                        draft: event.target.value,
                      })
                    }
                  />
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setRename(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="primary"
                    disabled={!renameDraft.trim()}
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <div className="popover-actions">
                <button
                  type="button"
                  onClick={() =>
                    chatAction(
                      () => pinChat(chatMenu.chat.id, !chatMenu.chat.pinned),
                      chatMenu.chat.pinned
                        ? "The chat could not be unpinned."
                        : "The chat could not be pinned.",
                    )
                  }
                >
                  <Pin size={15} aria-hidden="true" />
                  {chatMenu.chat.pinned ? "Unpin chat" : "Pin chat"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setRename({
                      id: chatMenu.chat.id,
                      draft: chatMenu.chat.title,
                    })
                  }
                >
                  <Pencil size={15} aria-hidden="true" />
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() =>
                    chatAction(
                      () =>
                        keepChatAsNote(chatMenu.chat.id).then((note) =>
                          onKeptNote?.(note.id),
                        ),
                      "The chat could not be saved as a note.",
                    )
                  }
                >
                  <History size={15} aria-hidden="true" />
                  Save as Agent note
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const chat = chatMenu.chat;
                    closeChatMenu();
                    void confirm({
                      title: `Delete “${chat.title}”?`,
                      body: "It will be removed from your chat history.",
                      confirmLabel: "Delete",
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      deleteChat(chat.id).catch((e: unknown) =>
                        toast({
                          tone: "warn",
                          text: `The chat could not be deleted. ${errorText(e)}`,
                        }),
                      );
                    });
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  Delete chat
                </button>
              </div>
            )}
          </Popover>
        )}

        {quickMenu && (
          <Popover
            anchor={quickMenu}
            label="Suggestions"
            onClose={() => setQuickMenu(null)}
          >
            <div className="popover-actions">
              {!scope && (
                <button
                  type="button"
                  disabled={locked || !message.trim()}
                  title="Turn what you typed into a project of tasks to review"
                  onClick={startProject}
                >
                  <Sparkles size={15} aria-hidden="true" />
                  Draft a project from this
                </button>
              )}
              {suggestions.map((s, n) => {
                const Icon = SUGGESTION_ICONS[n % SUGGESTION_ICONS.length];
                return (
                  <button
                    key={s.title}
                    type="button"
                    disabled={locked}
                    onClick={() => suggest(s.title)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {s.title}
                  </button>
                );
              })}
            </div>
          </Popover>
        )}
      </div>
      {upcomingOpen && (
        <AssistantUpcoming
          agentName={agentName}
          onClose={() => setUpcomingOpen(false)}
        />
      )}
    </section>
  );
}

/** A reply's steps, folded away under one line until asked for. */
function TurnSteps({ entries }: { entries: ChatTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const lines = traceLines(entries);
  if (!lines.length) return null;
  return (
    <div className="ai-trace">
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        Steps ({lines.length})
      </button>
      {open && (
        <ol>
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
