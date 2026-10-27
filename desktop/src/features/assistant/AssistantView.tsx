import { session, onSessionChange } from "../../lib/session";
import { providerDetailLines } from "@orbyn/core";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
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
  groupAssistantChats,
  assistantDateLabel,
  assistantExcerptMatches,
  type AssistantSource,
  type AssistantConversationEntry,
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
} from "./assistant-labels";
import { TurnChanges } from "./TurnChanges";
import { ReminderNudge } from "./ReminderNudge";
import { ProposalReview } from "../review/ProposalReview";
import { AssistantUpcoming } from "./AssistantUpcoming";
import { SavedConversationHistory } from "./SavedConversationHistory";
import { client } from "../../lib/api";
import type { Assistant } from "./useAssistant";
import "./assistant.css";
import { CopyMessage, UserMessage } from "./ConversationMessage";
import { ConversationDetails } from "./ConversationDetails";
import { ConversationUpdate } from "./ConversationUpdate";

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
  const [agentLane, setAgentLane] = useState<"background" | "overnight" | null>(
    null,
  );
  useEffect(
    () =>
      onSessionChange(() => {
        setAgentLane(null);
        setPanel(null);
      }),
    [],
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
  const needsProject = workMode && scope?.kind !== "project";
  const [workProjects, setWorkProjects] = useState<Project[] | null>(null);
  const [workProjectError, setWorkProjectError] = useState(false);
  const [projectAttempt, setProjectAttempt] = useState(0);
  useEffect(() => {
    if (!workMode || scope?.kind === "project") return;
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
  }, [workMode, projectAttempt, scope?.kind]);
  const chooseProject = (id: string) => {
    const project = workProjects?.find((row) => row.id === id);
    if (!project || project.assistant_off || locked) return;
    const draft = message;
    setScope({ kind: "project", id: project.id, name: project.name });
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
  const followingConversation = useRef(true);
  const readingAnchor = useRef<{ sequence: string; offset: number } | null>(
    null,
  );
  const previousConversation = useRef<string | null>(null);
  const previousTail = useRef<string | null>(null);
  const previousSubmission = useRef<string | null>(null);
  const [newConversationContent, setNewConversationContent] = useState(false);
  const rememberReadingPosition = () => {
    const thread = threadRef.current;
    if (!thread) return;
    followingConversation.current =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    if (followingConversation.current) setNewConversationContent(false);
    const top = thread.getBoundingClientRect().top;
    const row = [
      ...thread.querySelectorAll<HTMLElement>("[data-conversation-sequence]"),
    ].find((row) => row.getBoundingClientRect().bottom > top);
    readingAnchor.current = row
      ? {
          sequence: row.dataset.conversationSequence!,
          offset: row.getBoundingClientRect().top - top,
        }
      : null;
  };
  const showLatestConversation = () => {
    followingConversation.current = true;
    readingAnchor.current = null;
    setNewConversationContent(false);
    const thread = threadRef.current;
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: "auto" });
  };
  const earlierConversation = () => {
    rememberReadingPosition();
    followingConversation.current = false;
    void assistant.loadEarlierConversation();
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [quickMenu, setQuickMenu] = useState<DOMRect | null>(null);
  const [activityAnchor, setActivityAnchor] = useState<DOMRect | null>(null);
  const chatRef = useRef<HTMLElement>(null);
  const [compactPanels, setCompactPanels] = useState(true);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [panel, setPanel] = useState<
    "history" | "upcoming" | "legacy" | "details" | null
  >(openUpcoming > 0 ? "upcoming" : null);

  const initializedHome = useRef(false);
  useEffect(() => {
    if (!assistant.conversationEnabled) {
      initializedHome.current = false;
      return;
    }
    if (initializedHome.current) return;
    initializedHome.current = true;
    if (!activeChatId && !scope) void assistant.openPersonalConversation();
  }, [assistant.conversationEnabled]);
  useEffect(() => {
    const thread = threadRef.current;
    if (
      !thread ||
      agentLane ||
      panel ||
      document.hidden ||
      !assistant.conversation.destination
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (document.hidden || !document.hasFocus()) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) =>
            entry.target.getAttribute("data-conversation-sequence"),
          )
          .filter((value): value is string => !!value);
        if (visible.length)
          void assistant.acknowledgeConversation(
            visible.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b)),
          );
      },
      { root: thread, threshold: 0.5 },
    );
    const observe = () => {
      observer.disconnect();
      thread
        .querySelectorAll("[data-conversation-sequence]")
        .forEach((node) => observer.observe(node));
    };
    observe();
    window.addEventListener("focus", observe);
    document.addEventListener("visibilitychange", observe);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", observe);
      document.removeEventListener("visibilitychange", observe);
    };
  }, [assistant.conversation.entries, agentLane, panel]);

  useEffect(() => {
    const sequence = assistant.focusedConversationSequence;
    if (!sequence) return;
    followingConversation.current = false;
    const frame = requestAnimationFrame(() => {
      threadRef.current
        ?.querySelector<HTMLElement>(
          `[data-conversation-sequence="${sequence}"]`,
        )
        ?.scrollIntoView({ block: "center" });
      rememberReadingPosition();
      assistant.clearConversationFocus();
    });
    return () => cancelAnimationFrame(frame);
  }, [assistant.focusedConversationSequence]);

  const [detailsEntryId, setDetailsEntryId] = useState<string | null>(null);
  const detailsEntry = assistant.conversation.entries.find(
    (entry) => entry.id === detailsEntryId,
  );
  useEffect(() => {
    if (
      panel === "details" &&
      (!detailsEntry || !assistant.conversation.destination)
    )
      setPanel(null);
  }, [panel, detailsEntry, assistant.conversation.destination]);
  const [selectedText, setSelectedText] = useState<{
    entry: AssistantConversationEntry;
    text: string;
    anchor: DOMRect;
  } | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectingText = useRef(false);
  const settleSelection = () => {
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = setTimeout(() => {
      if (selectingText.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
        setSelectedText(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const start = range.startContainer.parentElement?.closest<HTMLElement>(
        "[data-conversation-sequence]",
      );
      const end = range.endContainer.parentElement?.closest<HTMLElement>(
        "[data-conversation-sequence]",
      );
      const text = selection.toString().trim();
      const entry = assistant.conversation.entries.find(
        (value) => value.sequence === start?.dataset.conversationSequence,
      );
      if (
        !start ||
        start !== end ||
        !threadRef.current?.contains(start) ||
        !entry ||
        !text ||
        text.length > 2000
      ) {
        setSelectedText(null);
        return;
      }
      const source = entry.kind === "turn" ? entry.turn.text : entry.text;
      if (!assistantExcerptMatches(source, text)) {
        setSelectedText(null);
        return;
      }
      setSelectedText({ entry, text, anchor: range.getBoundingClientRect() });
    }, 180);
  };
  useEffect(() => {
    setSelectedText(null);
    return () => {
      if (selectionTimer.current) clearTimeout(selectionTimer.current);
    };
  }, [activeChatId, panel]);
  const historyOpen = panel === "history";
  const upcomingOpen = panel === "upcoming";
  const navigationOpenRef = useRef(navigationOpen);
  navigationOpenRef.current = navigationOpen;
  const panelOrigin = useRef<HTMLElement | null>(null);
  const closePanels = () => setPanel(null);
  const togglePanel = (next: "history" | "upcoming" | "legacy" | "details") => {
    if (!panel)
      panelOrigin.current = document.activeElement as HTMLElement | null;
    onOpenSidePanel?.();
    setPanel((old) => (old === next ? null : next));
  };
  useEffect(() => {
    const node = chatRef.current!;
    const measure = () => setCompactPanels(node.clientWidth < 1040);
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
  const chatGroups = groupAssistantChats(
    savedChats ?? [],
    assistant.personalChatId,
  );
  const activeChat = savedChats?.find((chat) => chat.id === activeChatId);
  const conversationTitle =
    activeChatId && activeChatId === assistant.personalChatId
      ? agentName
      : (activeChat?.title ?? "New chat");
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
  const locked =
    busy ||
    thinking ||
    !!waiting ||
    !assistant.conversationReady ||
    !!assistant.replyStatus;
  useEffect(() => setPersonAnswer(""), [runProgress?.waiting?.question]);
  const empty = assistant.conversationItems.length === 0 && !thinking;
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

  // Preserve a reader's visible row; follow new content only while near the end.
  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    if (previousConversation.current !== activeChatId) {
      previousConversation.current = activeChatId;
      followingConversation.current = true;
      readingAnchor.current = null;
      setNewConversationContent(false);
      previousTail.current = null;
    }
    const submitted =
      turns
        .filter((turn) => turn.role === "user" && turn.id.startsWith("turn-"))
        .at(-1)?.id ?? null;
    if (submitted && submitted !== previousSubmission.current) {
      followingConversation.current = true;
      readingAnchor.current = null;
    }
    previousSubmission.current = submitted;
    const tail = assistant.conversationItems.at(-1)?.id ?? null;
    if (assistant.focusedConversationSequence) {
      followingConversation.current = false;
      return;
    }
    if (followingConversation.current) thread.scrollTop = thread.scrollHeight;
    else {
      const anchor = readingAnchor.current;
      const row =
        anchor &&
        thread.querySelector<HTMLElement>(
          `[data-conversation-sequence="${anchor.sequence}"]`,
        );
      if (row)
        thread.scrollTop +=
          row.getBoundingClientRect().top -
          thread.getBoundingClientRect().top -
          anchor!.offset;
      if (previousTail.current && tail !== previousTail.current)
        setNewConversationContent(true);
    }
    previousTail.current = tail;
    rememberReadingPosition();
  }, [
    panel,
    historyCollapsed,
    compactPanels,
    activeChatId,
    assistant.conversation.entries,
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
    if (!locked && !needsProject && message.trim()) void ask();
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
        (historyCollapsed && !compactPanels ? " is-history-hidden" : "") +
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
            {!compactPanels && !historyCollapsed && (
              <button
                type="button"
                className="icon-button"
                aria-label="Close chats"
                title="Focus conversation"
                onClick={() => setHistoryCollapsed(true)}
              >
                <ChevronRight size={16} />
              </button>
            )}
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
          {assistant.legacyHistoryAvailable &&
            assistant.legacyHistoryTarget && (
              <button
                type="button"
                className="text-button"
                onClick={() => togglePanel("legacy")}
              >
                Previous saved history
              </button>
            )}
          {assistant.conversationEnabled && (
            <button
              type="button"
              className="ai-primary-chat"
              disabled={locked}
              aria-current={
                !agentLane && activeChatId === assistant.personalChatId
                  ? "page"
                  : undefined
              }
              onClick={() => {
                setAgentLane(null);
                closePanels();
                void assistant.openPersonalConversation();
              }}
            >
              <Sparkles size={16} aria-hidden="true" /> {agentName}
            </button>
          )}
          <button
            type="button"
            className="text-button ai-project-start"
            disabled={locked}
            onClick={() => {
              const draft = message;
              reset();
              assistant.setHistoryKind("work");
              setMessage(draft);
              setAgentLane(null);
              closePanels();
            }}
          >
            New project chat
          </button>
          {!!chatGroups.projects.length && (
            <h3 className="ai-history-section">Projects</h3>
          )}
          {[
            ...chatGroups.projects.map((project) => ({
              key: project.id,
              title: project.name,
              chats: project.chats,
            })),
            { key: "pinned", title: "Pinned", chats: chatGroups.pinned },
            { key: "recent", title: "Recent", chats: chatGroups.recent },
          ]
            .filter((group) => group.chats.length > 0)
            .map((group) => (
              <section
                className="ai-chat-group"
                key={group.key}
                aria-label={group.title}
              >
                <h3>{group.title}</h3>
                {group.chats.map((chat) => (
                  <div
                    key={chat.id}
                    className={
                      "ai-history-row" +
                      (!agentLane && chat.id === activeChatId
                        ? " is-active"
                        : "")
                    }
                  >
                    <button
                      type="button"
                      className="ai-history-open"
                      aria-current={
                        !agentLane && chat.id === activeChatId
                          ? "page"
                          : undefined
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
                            {chat.active === "needs_you"
                              ? "Needs you"
                              : "Working"}
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
              </section>
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
              onClick={() =>
                compactPanels
                  ? togglePanel("history")
                  : setHistoryCollapsed(false)
              }
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
            <button
              type="button"
              className={
                "icon-button" + (!historyCollapsed ? " ai-narrow-only" : "")
              }
              aria-label={historyOpen ? "Close chats" : "Open chats"}
              aria-expanded={historyOpen}
              onClick={() =>
                compactPanels
                  ? togglePanel("history")
                  : setHistoryCollapsed(false)
              }
            >
              <History size={18} aria-hidden="true" />
            </button>
            <span className="ai-chat-label" title={conversationTitle}>
              {conversationTitle}
            </span>
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
              className="text-button ai-activity-menu"
              aria-expanded={!!activityAnchor}
              onClick={(event) =>
                setActivityAnchor(event.currentTarget.getBoundingClientRect())
              }
            >
              Activity
            </button>
          </div>

          <div
            className="ai-thread"
            ref={threadRef}
            onPointerDown={() => {
              selectingText.current = true;
              setSelectedText(null);
            }}
            onPointerUp={() => {
              selectingText.current = false;
              settleSelection();
            }}
            onPointerCancel={() => {
              selectingText.current = false;
              setSelectedText(null);
            }}
            onKeyUp={settleSelection}
            onScroll={rememberReadingPosition}
          >
            {!!assistant.conversationIssue && (
              <p role="status">{assistant.conversationIssue}</p>
            )}
            {restoringChat && <p role="status">{restoringChat}</p>}
            {assistant.conversation.destination && (
              <div className="ai-conversation-status">
                {assistant.conversation.hasEarlier && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={assistant.conversation.loading}
                    onClick={earlierConversation}
                  >
                    Earlier messages
                  </button>
                )}
                {assistant.conversation.error && (
                  <>
                    <span role="alert">Couldn’t load updates.</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void assistant.refreshConversation()}
                    >
                      Retry
                    </button>
                  </>
                )}
              </div>
            )}

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

            {assistant.conversationItems.map((item, index) => {
              const retained = assistant.conversation.entries.find(
                (entry) => entry.id === item.id,
              );
              const previous = assistant.conversation.entries.find(
                (entry) =>
                  entry.id === assistant.conversationItems[index - 1]?.id,
              );
              const date = retained
                ? assistantDateLabel(
                    retained.created_at,
                    previous?.created_at,
                    Intl.DateTimeFormat().resolvedOptions().timeZone,
                  )
                : null;
              const grouped = (content: ReactNode) => (
                <Fragment key={item.id}>
                  {date && <div className="ai-date-group">{date}</div>}
                  {content}
                </Fragment>
              );
              if (item.kind === "update")
                return grouped(
                  <ConversationUpdate
                    key={item.id}
                    entry={item.entry}
                    onReply={() => {
                      assistant.selectReply(item.entry);
                      inputRef.current?.focus();
                    }}
                    onWork={(id) => void openChat(id)}
                    onActivity={setAgentLane}
                    onDetails={() => {
                      setDetailsEntryId(item.entry.id);
                      togglePanel("details");
                    }}
                  />,
                );
              const turn = item.turn;
              return grouped(
                turn.role === "user" ? (
                  <div
                    key={item.id}
                    data-conversation-sequence={item.sequence ?? undefined}
                    className="ai-row ai-row-user"
                  >
                    <UserMessage text={turn.text} />
                  </div>
                ) : (
                  <div
                    key={item.id}
                    data-conversation-sequence={item.sequence ?? undefined}
                    className="ai-row"
                  >
                    <div className="ai-reply">
                      <ProposalReview
                        hideSourceDetails={!!retained}
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
                      <div className="ai-message-actions">
                        <CopyMessage text={turn.proposal.summary} />
                        {retained && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => {
                              setDetailsEntryId(retained.id);
                              togglePanel("details");
                            }}
                          >
                            Details
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ),
              );
            })}

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
            {needsProject && (
              <div className="ai-work-context">
                <Select
                  aria-label="Work project"
                  value=""
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
            {newConversationContent && (
              <button
                type="button"
                className="text-button ai-latest"
                onClick={showLatestConversation}
              >
                Latest <ChevronDown size={14} aria-hidden="true" />
              </button>
            )}
            {assistant.failedAnswers.map((answer) => (
              <div key={answer.id} className="ai-reply-target" role="status">
                <span>
                  Answer draft: {answer.text}
                  {!assistant.canRestoreFailedAnswer(answer.id) &&
                    " · Clear your current draft and reply to restore this answer."}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    busy ||
                    thinking ||
                    !assistant.canRestoreFailedAnswer(answer.id)
                  }
                  onClick={() => assistant.restoreFailedAnswer(answer.id)}
                >
                  Restore answer
                </button>
              </div>
            ))}
            {!!assistant.replyStatus && (
              <div className="ai-reply-target" role="status">
                <span>
                  {assistant.replyStatus === "loading"
                    ? "Restoring reply…"
                    : "This update is no longer available."}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy || thinking}
                  onClick={assistant.clearReply}
                >
                  Cancel reply
                </button>
              </div>
            )}
            {assistant.replyTarget && (
              <div className="ai-reply-target">
                <span>
                  Replying to{" "}
                  {assistant.replyTarget.excerpt
                    ? `“${assistant.replyTarget.excerpt}”`
                    : assistant.replyTarget.kind === "turn"
                      ? "message"
                      : assistant.replyTarget.lane === "overnight"
                        ? "Overnight"
                        : "Background"}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Cancel reply"
                  onClick={assistant.clearReply}
                >
                  <X size={16} />
                </button>
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
                disabled={locked || !message.trim() || needsProject}
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
      {activityAnchor && (
        <Popover
          anchor={activityAnchor}
          label="Activity"
          width={220}
          onClose={() => setActivityAnchor(null)}
        >
          <div className="popover-actions">
            {(["background", "overnight"] as const).map((lane) => (
              <button
                key={lane}
                type="button"
                onClick={() => {
                  setActivityAnchor(null);
                  setAgentLane(lane);
                }}
              >
                {lane === "background" ? "Background" : "Overnight"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setActivityAnchor(null);
                togglePanel("upcoming");
              }}
            >
              Upcoming
            </button>
          </div>
        </Popover>
      )}
      {selectedText && !panel && (
        <Popover
          anchor={selectedText.anchor}
          label="Selected text"
          takeFocus={false}
          width={160}
          onClose={() => setSelectedText(null)}
        >
          <button
            type="button"
            onClick={() => {
              if (
                assistant.selectExcerpt(selectedText.entry, selectedText.text)
              ) {
                setSelectedText(null);
                inputRef.current?.focus();
              }
            }}
          >
            Ask Orbyn
          </button>
        </Popover>
      )}
      {panel === "details" &&
        detailsEntry &&
        assistant.conversation.destination && (
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
            modal={compactPanels}
            onClose={closePanels}
            onSource={onOpenSource}
            onWork={(id) => {
              closePanels();
              void openChat(id);
            }}
            onActivity={(lane) => {
              closePanels();
              setAgentLane(lane);
            }}
          />
        )}
      {upcomingOpen && (
        <AssistantUpcoming
          conversationEnabled={assistant.conversationEnabled}
          id={upcomingId}
          agentName={agentName}
          modal={compactPanels}
          onClose={() => closePanels()}
        />
      )}
      {panel === "legacy" && assistant.legacyHistoryTarget && (
        <SavedConversationHistory
          key={assistant.legacyHistoryTarget.destinationId}
          destinationId={assistant.legacyHistoryTarget.destinationId}
          chatId={assistant.legacyHistoryTarget.chatId}
          modal={compactPanels}
          onClose={closePanels}
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
