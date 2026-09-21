import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDays,
  Flag,
  PenLine,
  Plus,
  Sparkles,
  SquarePen,
  Sunrise,
  type LucideIcon,
} from "lucide-react";
import {
  assistantSuggestions as SUGGESTIONS,
  type DocSource,
  type Item,
  type Plan,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { ProposalReview } from "../../components/ProposalReview";
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
  onApplyPlan: (plan: Plan) => Promise<string>;
  /** Shows a plan in the calendar's planner. */
  onOpenPlan: (plan: Plan) => void;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: DocSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
};

export function AssistantView({
  items,
  busy,
  assistant,
  onApplyPlan,
  onOpenPlan,
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
  } = assistant;
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [quickMenu, setQuickMenu] = useState<DOMRect | null>(null);
  const locked = busy || thinking;
  const empty = turns.length === 0 && !thinking;
  // Quick replies only make sense on the newest assistant reply.
  const latestReplyId = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")?.id;

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
      <div className="ai-chat-head">
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
                  onApply={() => void apply(turn.id)}
                  onDismiss={() => dismiss(turn.id)}
                  onApplyPlan={onApplyPlan}
                  onOpenPlan={onOpenPlan}
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
            aria-label="Quick actions"
            aria-haspopup="dialog"
            aria-expanded={!!quickMenu}
            disabled={locked}
            onClick={(e) =>
              setQuickMenu(
                quickMenu ? null : e.currentTarget.getBoundingClientRect(),
              )
            }
          >
            <Plus size={20} />
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

        {empty && (
          <div className="ai-suggestions" aria-label="Suggestions">
            {SUGGESTIONS.map((s, n) => {
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
        Your request and up to 100 recent items are shared with your configured
        AI provider.
      </small>

      {quickMenu && (
        <Popover
          anchor={quickMenu}
          label="Quick actions"
          onClose={() => setQuickMenu(null)}
        >
          <div className="popover-actions">
            <button
              type="button"
              disabled={locked || !message.trim()}
              title="Turn what you typed into a project of tasks to review"
              onClick={startProject}
            >
              <Sparkles size={15} aria-hidden="true" />
              Draft a project from this
            </button>
            {SUGGESTIONS.map((s, n) => {
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
