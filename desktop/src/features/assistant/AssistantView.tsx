import { useEffect, useRef } from "react";
import { ArrowUp, ArrowUpRight, RotateCcw, Sparkles } from "lucide-react";
import {
  assistantSuggestions as SUGGESTIONS,
  type Item,
  type Plan,
} from "@orbyn/core";
import { ProposalReview } from "../../components/ProposalReview";
import type { Assistant } from "../../hooks/useAssistant";
import { stagger } from "../../lib/motion";
import "./assistant.css";

/** The composer grows with its text up to this share of the window. */
const COMPOSER_MAX_SHARE = 0.4;

type Props = {
  items: Item[];
  busy: boolean;
  assistant: Assistant;
  /** Saves a plan the assistant made; resolves with a message. */
  onApplyPlan: (plan: Plan) => Promise<string>;
  /** Shows a plan in the calendar's planner. */
  onOpenPlan: (plan: Plan) => void;
};

export function AssistantView({
  items,
  busy,
  assistant,
  onApplyPlan,
  onOpenPlan,
}: Props) {
  const { message, setMessage, turns, thinking, ask, apply, dismiss, reset } =
    assistant;
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const locked = busy || thinking;
  // Quick replies only make sense on the newest assistant reply.
  const latestReplyId = [...turns]
    .reverse()
    .find((t) => t.role === "assistant")?.id;

  // Keep the newest message in view by scrolling the conversation itself,
  // never the page, so the header and composer stay where they are.
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [turns.length, thinking]);

  // Grow the composer with its content (three lines at rest) up to about
  // 40% of the window; past that it scrolls inside.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * COMPOSER_MAX_SHARE);
    el.style.height = Math.min(el.scrollHeight, max) + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [message]);

  const send = () => {
    if (!locked && message.trim()) void ask();
  };

  return (
    <section className="card ai-chat">
      <header className="ai-chat-head">
        <span className="ai-avatar">
          <Sparkles size={16} />
        </span>
        <div className="ai-chat-title">
          <strong>Orbyn assistant</strong>
          <small>
            {thinking
              ? "Thinking…"
              : "Summaries, plans, and changes you approve"}
          </small>
        </div>
        {turns.length > 0 && (
          <button
            type="button"
            className="ai-ghost"
            onClick={reset}
            disabled={thinking}
          >
            <RotateCcw size={14} /> New conversation
          </button>
        )}
      </header>

      <div className="ai-thread" aria-live="polite" ref={threadRef}>
        {turns.length === 0 && (
          <div className="ai-empty">
            <span className="ai-empty-mark">
              <Sparkles size={26} />
            </span>
            <h2>What’s on your mind?</h2>
            <p>
              Ask for a summary, plan your day, or change items in plain
              language. You’ll review every change before it’s saved.
            </p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s, n) => (
                <button
                  key={s.title}
                  className="fade-up stagger"
                  style={stagger(n)}
                  type="button"
                  disabled={locked}
                  onClick={() => void ask(s.title)}
                >
                  <strong>{s.title}</strong>
                  <span>{s.hint}</span>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="ai-row ai-row-user">
              <div className="ai-bubble ai-bubble-user">{turn.text}</div>
            </div>
          ) : (
            <div key={turn.id} className="ai-row">
              <span className="ai-avatar ai-avatar-small">
                <Sparkles size={13} />
              </span>
              <div className="ai-bubble ai-bubble-bot">
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
            <span className="ai-avatar ai-avatar-small">
              <Sparkles size={13} />
            </span>
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

      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={3}
          aria-label="Message your assistant"
          aria-describedby="ai-composer-hint"
          placeholder="Make a little space. Ask Orbyn…"
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
        <div className="ai-composer-bar">
          <small id="ai-composer-hint" className="ai-muted ai-composer-hint">
            Enter to send · Shift+Enter for a new line
          </small>
          <button
            className="ai-send"
            aria-label="Send"
            disabled={locked || !message.trim()}
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </form>
      <small className="ai-note">
        Your request and up to 100 recent items are shared with your configured
        AI provider.
      </small>
    </section>
  );
}
