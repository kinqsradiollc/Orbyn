import { AssistantProfileStore } from "@orbyn/api-client";
import { session, onSessionChange } from "../../lib/session";
import { providerDetailLines } from "@orbyn/core";
import {
  useEffect,
  useId,
  useMemo,
  useSyncExternalStore,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  type Project,
} from "@orbyn/core";
import { Select } from "../../components/Select";
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
  navigationOpen?: boolean;
  onOpenSidePanel?: () => void;
  agentWorkspace: (
    lane: "background" | "overnight",
    openChat: (id: string) => void,
  ) => ReactNode;
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
  navigationOpen = false,
  onOpenSidePanel,
  agentWorkspace,
}: Props) {
  const profileStore = useMemo(
    () => new AssistantProfileStore(client, session.get),
    [],
  );
  const profiles = useSyncExternalStore(
    profileStore.subscribe,
    profileStore.getSnapshot,
  );
  useEffect(() => {
    void profileStore.refresh();
    const stop = onSessionChange(() => {
      profileStore.reset();
      setAgentLane(null);
      void profileStore.refresh();
    });
    const refresh = () => {
      if (!document.hidden) void profileStore.refresh();
    };
    const timer = window.setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stop();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      profileStore.reset();
    };
  }, [profileStore]);
  const [agentLane, setAgentLane] = useState<"background" | "overnight" | null>(
    null,
  );
  const {
    message,
    setMessage,
    turns,
    thinking,
    restoringChat,
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
    agentName,
  } = assistant;
  const { ask: confirm } = useConfirm();
  const toast = useToast();
  const workMode =
    assistant.historyKind === "work" || scope?.kind === "project";
  const [workProjects, setWorkProjects] = useState<Project[] | null>(null);
  const [workProjectError, setWorkProjectError] = useState(false);
  const [projectAttempt, setProjectAttempt] = useState(0);
  useEffect(() => {
    if (!workMode) return;
    let active = true;
    const token = session.get();
    setWorkProjects(null);
    setWorkProjectError(false);
    client.listProjects().then(
      (rows) => {
        if (active && session.get() === token) setWorkProjects(rows);
      },
      () => {
        if (active && session.get() === token) setWorkProjectError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [workMode, projectAttempt]);
  const chooseProject = (id: string) => {
    const project = workProjects?.find((row) => row.id === id);
    if (!project || project.assistant_off || locked) return;
    const draft = message;
    setScope({ kind: "project", id: project.id, name: project.name });
    setMessage(draft);
  };
  const switchMode = (kind: "chat" | "work") => {
    if (locked || kind === (workMode ? "work" : "chat")) return;
    const draft = message;
    reset();
    assistant.setHistoryKind(kind);
    if (kind === "chat" || scope?.kind === "task") setScope(null);
    setMessage(draft);
  };
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
  const upcomingId = useId();
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [quickMenu, setQuickMenu] = useState<DOMRect | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const [compactPanels, setCompactPanels] = useState(true);
  const [panel, setPanel] = useState<"history" | "upcoming" | null>(
    openUpcoming > 0 ? "upcoming" : null,
  );
  const historyOpen = panel === "history";
  const upcomingOpen = panel === "upcoming";
  const navigationOpenRef = useRef(navigationOpen);
  navigationOpenRef.current = navigationOpen;
  const panelOrigin = useRef<HTMLElement | null>(null);
  const closePanels = () => setPanel(null);
  const togglePanel = (next: "history" | "upcoming") => {
    if (!panel)
      panelOrigin.current = document.activeElement as HTMLElement | null;
    onOpenSidePanel?.();
    setPanel((old) => (old === next ? null : next));
  };
  useEffect(() => {
    const node = chatRef.current!;
    const measure = () => setCompactPanels(node.clientWidth < 1280);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (navigationOpen) setPanel(null);
  }, [navigationOpen]);
  useEffect(() => {
    if (!compactPanels || !panel) return;
    const previous = panelOrigin.current ?? inputRef.current;
    const node = chatRef.current?.querySelector<HTMLElement>(
      panel === "history" ? ".ai-history" : ".ai-upcoming",
    );
    const controls = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (
        document.querySelector(".modal-backdrop, .popover") ||
        event.defaultPrevented
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setPanel(null);
      }
      if (event.key !== "Tab") return;
      const fields = controls();
      const first = fields[0],
        last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      if (previous?.isConnected && !navigationOpenRef.current) previous.focus();
    };
  }, [compactPanels, panel]);
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
  const [chatActionPending, setChatActionPending] = useState(false);
  const [personAnswer, setPersonAnswer] = useState("");
  useEffect(() => {
    if (openUpcoming > 0) {
      onOpenSidePanel?.();
      setPanel("upcoming");
    }
  }, [openUpcoming]);
  const [approveMenu, setApproveMenu] = useState<DOMRect | null>(null);
  const activeChat = savedChats?.find((chat) => chat.id === activeChatId);
  /** Runs a chat menu action, closing the menu or showing why it failed. */
  const chatAction = (run: () => Promise<unknown>, failed: string) => {
    if (chatActionPending) return;
    setChatActionPending(true);
    void run()
      .then(closeChatMenu, (e: unknown) =>
        toast({ tone: "warn", text: `${failed} ${errorText(e)}` }),
      )
      .finally(() => setChatActionPending(false));
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
    agentLane,
    turns.length,
    thinking,
    runProgress?.state,
    runProgress?.waiting?.question,
  ]);

  // One line at rest; grows with its text up to the stylesheet's max-height
  // (four lines), then scrolls inside. Text rewraps when the window
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
    // A split pane can change width without resizing the browser window.
    const container = inputRef.current?.parentElement;
    let width = container?.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fit();
      }
    });
    if (container) observer.observe(container);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [message, agentLane]);

  const send = () => {
    if (!locked && (!workMode || scope?.kind === "project") && message.trim())
      void ask();
  };

  const suggest = (text: string) => {
    setQuickMenu(null);
    if (workMode && scope?.kind !== "project") setMessage(text);
    else void ask(text);
  };
  const startProject = () => {
    setQuickMenu(null);
    if (!locked && message.trim()) void draftProject();
  };

  return (
    <section
      ref={chatRef}
      className={
        "ai-chat" +
        (workMode ? " is-work" : "") +
        (empty && !agentLane ? " is-empty" : "") +
        (compactPanels ? " is-compact" : "") +
        (compactPanels && panel ? " has-panel" : "")
      }
    >
      {compactPanels && panel && (
        <button
          type="button"
          className="ai-panel-backdrop"
          aria-label="Close side panel"
          tabIndex={-1}
          onClick={closePanels}
        />
      )}
      <aside
        className={"ai-history" + (historyOpen ? " is-open" : "")}
        role={compactPanels && historyOpen ? "dialog" : undefined}
        aria-modal={compactPanels && historyOpen ? true : undefined}
        aria-label="Chat history"
      >
        <div className="ai-history-head">
          <div className="ai-history-title">
            <History size={16} aria-hidden="true" />
            <h2>Chats</h2>
            {compactPanels && (
              <button
                type="button"
                className="icon-button"
                aria-label="Close chat history"
                onClick={closePanels}
              >
                <X size={18} />
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="New chat"
              title="New chat"
              disabled={locked}
              onClick={() => {
                closePanels();
                setAgentLane(null);
                reset();
              }}
            >
              <SquarePen size={16} aria-hidden="true" />
            </button>
          </div>
          <input
            type="search"
            aria-label="Search chats"
            placeholder="Search chats"
            value={chatSearch}
            onChange={(event) => searchChats(event.target.value)}
          />
        </div>
        <div className="ai-history-list">
          {(["background", "overnight"] as const)
            .filter((lane) => {
              const profile = profiles.data?.profiles.find(
                (item) => item.lane === lane,
              );
              return `${profile?.identity?.name ?? ""} ${lane}`
                .toLowerCase()
                .includes(chatSearch.trim().toLowerCase());
            })
            .map((lane) => (
              <div
                className={
                  "ai-history-row" + (agentLane === lane ? " is-active" : "")
                }
                key={lane}
              >
                <button
                  type="button"
                  className="ai-history-open"
                  aria-current={agentLane === lane ? "page" : undefined}
                  disabled={locked}
                  onClick={() => {
                    closeChatMenu();
                    closePanels();
                    setAgentLane(lane);
                  }}
                >
                  <span className="ai-history-chat-title">
                    <Sparkles size={16} aria-hidden="true" />
                    <span>
                      {profiles.data?.profiles.find(
                        (item) => item.lane === lane,
                      )?.identity?.name ??
                        (lane === "background" ? "Background" : "Overnight")}
                    </span>
                  </span>
                  <small>
                    {lane === "background" ? "Background" : "Overnight"}
                    {(() => {
                      const profile = profiles.data?.profiles.find(
                        (item) => item.lane === lane,
                      );
                      if (!profile)
                        return profiles.error ? " · Status unavailable" : "";
                      const state = {
                        idle: "Idle",
                        queued: "Queued",
                        working: "Working",
                        waiting: "Needs you",
                        scheduled: "Scheduled",
                      }[profile.state];
                      return ` · ${state}`;
                    })()}
                  </small>
                </button>
              </div>
            ))}
          {savedChats?.map((chat) => (
            <div
              key={chat.id}
              className={
                "ai-history-row" +
                (!agentLane && chat.id === activeChatId ? " is-active" : "")
              }
            >
              <button
                type="button"
                className="ai-history-open"
                aria-current={
                  !agentLane && chat.id === activeChatId ? "page" : undefined
                }
                disabled={locked}
                onClick={() => {
                  closeChatMenu();
                  closePanels();
                  setAgentLane(null);
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
      {agentLane ? (
        <div
          className="ai-main ai-agent-workspace"
          inert={compactPanels && !!panel}
        >
          <header className="ai-chat-head">
            <span className="ai-chat-label">
              {agentLane === "background" ? "Background" : "Overnight"}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() => togglePanel("history")}
            >
              Chats
            </button>
          </header>
          <div className="ai-agent-content">
            {agentWorkspace(agentLane, (id) => {
              setAgentLane(null);
              void openChat(id).catch(() => undefined);
            })}
          </div>
        </div>
      ) : (
        <div className="ai-main" inert={compactPanels && !!panel}>
          <div className="ai-chat-head">
            <div className="ai-mode-switch" aria-label="Workspace mode">
              <button
                type="button"
                aria-pressed={!workMode}
                disabled={locked}
                onClick={() => switchMode("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                aria-pressed={workMode}
                disabled={locked}
                onClick={() => switchMode("work")}
              >
                Work
              </button>
            </div>
            <span
              className="ai-chat-label"
              title={activeChat?.title ?? "New chat"}
            >
              {activeChat?.title ?? "New chat"}
            </span>
            {/* History and New chat live in the Chats panel; on a phone the
              panel is hidden, so these two open it or start afresh. */}
            <button
              type="button"
              className="icon-button ai-narrow-only"
              aria-label={historyOpen ? "Close chat history" : "Chat history"}
              aria-expanded={historyOpen}
              title={historyOpen ? "Close chat history" : "Chat history"}
              onClick={() => togglePanel("history")}
            >
              <History size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button ai-narrow-only"
              onClick={() => {
                closePanels();
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
              aria-controls={upcomingId}
              onClick={() => togglePanel("upcoming")}
            >
              <CalendarClock size={15} aria-hidden="true" />
              Upcoming
            </button>
          </div>

          <div className="ai-thread" aria-live="polite" ref={threadRef}>
            {restoringChat && <p role="status">{restoringChat}</p>}
            {empty && !restoringChat && (
              <>
                <div className="ai-intro">
                  <h2>
                    {workMode
                      ? "What should we work on?"
                      : "What's on your mind?"}
                  </h2>
                </div>
              </>
            )}

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
                    {providerDetailLines(turn.trace).map((label) => (
                      <small
                        key={label}
                        className="muted"
                        style={{ display: "block", overflowWrap: "anywhere" }}
                      >
                        {label}
                      </small>
                    ))}
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
                      <strong>Orbyn has a question</strong>
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
                            disabled={busy}
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
                          {waiting.steps.map((step, index) => {
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
                  {progressText(runProgress?.label) || "Orbyn is thinking…"}
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
            {workMode && (
              <div className="ai-work-context">
                <Select
                  aria-label="Work project"
                  value={scope?.kind === "project" ? scope.id : ""}
                  disabled={locked || workProjects === null}
                  onChange={(event) => chooseProject(event.target.value)}
                >
                  <option value="">
                    {workProjectError
                      ? "Projects unavailable"
                      : workProjects === null
                        ? "Loading projects…"
                        : "Choose project"}
                  </option>
                  {workProjects?.map((project) => (
                    <option
                      key={project.id}
                      value={project.id}
                      disabled={project.assistant_off}
                    >
                      {project.name}
                      {project.assistant_off ? " · AI off" : ""}
                    </option>
                  ))}
                </Select>
                {workProjectError && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setProjectAttempt((attempt) => attempt + 1)}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            {empty && (
              <div className="ai-suggestions" aria-label="Suggestions">
                {suggestions.map((s, n) => {
                  const Icon = SUGGESTION_ICONS[n % SUGGESTION_ICONS.length];
                  return (
                    <button
                      key={s.title}
                      type="button"
                      disabled={locked}
                      title={s.hint}
                      onClick={() =>
                        suggest("prompt" in s ? s.prompt : s.title)
                      }
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{s.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
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
                placeholder={workMode ? "Work with Orbyn…" : "Ask Orbyn…"}
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
                disabled={
                  locked ||
                  !message.trim() ||
                  (workMode && scope?.kind !== "project")
                }
              >
                <ArrowUp size={18} />
              </button>
            </form>
          </div>

          <small className="ai-note">
            {scope?.kind === "project"
              ? `Sent to your AI provider: your question, project tasks, notes, decisions and pages opened by the assistant.`
              : scope?.kind === "task"
                ? `Sent to your AI provider: your question, this task, its sessions and pages opened by the assistant.`
                : `Sent to your AI provider: your question, recent tasks, the next few calendar days and pages opened by the assistant.`}
          </small>

          {chatMenu && (
            <Popover
              anchor={chatMenu.anchor}
              label={`Options for ${chatMenu.chat.title}`}
              onClose={() => {
                if (!chatActionPending) closeChatMenu();
              }}
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
                      disabled={chatActionPending}
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
                      disabled={chatActionPending}
                      onClick={() => setRename(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="primary"
                      disabled={chatActionPending || !renameDraft.trim()}
                    >
                      {chatActionPending ? "Saving…" : "Save"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="popover-actions">
                  <button
                    type="button"
                    disabled={chatActionPending}
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
                    disabled={chatActionPending}
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
                    disabled={chatActionPending}
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
                    disabled={chatActionPending}
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
                      onClick={() =>
                        suggest("prompt" in s ? s.prompt : s.title)
                      }
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
      )}
      {upcomingOpen && (
        <AssistantUpcoming
          id={upcomingId}
          agentName={agentName}
          modal={compactPanels}
          onClose={() => closePanels()}
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
