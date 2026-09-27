import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  CalendarDays,
  Flag,
  History,
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
  type PersonalAgentSettings,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { ProposalReview } from "../../components/ProposalReview";
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
}: Props) {
  const {
    message,
    setMessage,
    turns,
    thinking,
    ask,
    draftProject,
    apply,
    dismiss,
    reset,
    scope,
    setScope,
    savedChats,
    openChat,
    deleteChat,
  } = assistant;
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
  const [identity, setIdentity] = useState<PersonalAgentSettings | null>(null);
  const [identityName, setIdentityName] = useState("Orbyn");
  const [identityPersona, setIdentityPersona] = useState("");
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState("");
  useEffect(() => {
    void client
      .agentSettings()
      .then((value) => {
        setIdentity(value);
        setIdentityName(value.name);
        setIdentityPersona(value.persona);
      })
      .catch(() => undefined)
      .finally(() => setIdentityLoading(false));
  }, []);
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
  const locked = busy || thinking;
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
    if (!el || (turns.length === 0 && !thinking)) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns.length, thinking]);

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
      {!identityLoading && identity && !identity.named_at && (
        <div className="ai-name-overlay">
          <form
            className="ai-name-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-name-title"
            onSubmit={saveIdentity}
          >
            <h2 id="ai-name-title">Give your assistant a name</h2>
            <p>
              Choose a name and an optional persona. You can change both later
              in Settings.
            </p>
            <label>
              Name
              <input
                autoFocus
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
            </label>
            {identityError && <p role="alert">{identityError}</p>}
            <div>
              <button
                type="submit"
                className="ai-primary"
                disabled={identitySaving}
              >
                Save
              </button>
              <button
                type="button"
                className="ai-ghost"
                disabled={identitySaving}
                onClick={() => void skipIdentity()}
              >
                Skip
              </button>
            </div>
          </form>
        </div>
      )}
      <div className="ai-chat-head">
        {scope && (
          <button
            type="button"
            className="ai-ghost ai-scope"
            disabled={thinking}
            onClick={() => setScope(null)}
            title="Remove assistant scope"
          >
            In: {scope.name} <X size={14} aria-hidden="true" />
          </button>
        )}
        {turns.length > 0 && (
          <button
            type="button"
            className="ai-ghost ai-icon"
            onClick={reset}
            disabled={thinking}
            aria-label="New chat"
            title="New chat"
          >
            <SquarePen size={16} />
          </button>
        )}
      </div>

      <div className="ai-thread" aria-live="polite" ref={threadRef}>
        {empty && <h2 className="ai-greeting">What’s on your mind today?</h2>}

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
                  state={turn.state}
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
              </div>
            </div>
          ),
        )}

        {thinking && (
          <div className="ai-row">
            <div
              className="ai-bubble ai-bubble-bot ai-typing"
              role="status"
              aria-label="Orbyn is thinking"
            >
              <span />
              <span />
              <span />
            </div>
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
            placeholder="Ask Orbyn…"
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

        {empty && scope?.kind === "project" && !!savedChats?.length && (
          <div className="ai-saved" aria-labelledby="ai-saved-title">
            <h3 id="ai-saved-title">
              <History size={14} aria-hidden="true" /> Saved chats about{" "}
              {scope.name}
            </h3>
            <ul>
              {savedChats.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="ai-saved-open"
                    disabled={locked}
                    onClick={() => void openChat(c.id).catch(() => undefined)}
                  >
                    <span>{c.title}</span>
                    <small>
                      {new Date(c.updated_at).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      })}
                    </small>
                  </button>
                  <button
                    type="button"
                    className="icon-button ai-saved-delete"
                    aria-label={`Delete the chat “${c.title}”`}
                    onClick={() => void deleteChat(c.id).catch(() => undefined)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
            <small className="muted">
              Only you see these. They go after a year unused.
            </small>
          </div>
        )}
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
    </section>
  );
}
