import { useEffect, useRef } from "react";
import { ArrowUp, ArrowUpRight, RotateCcw, Sparkles } from "lucide-react";
import type { Item } from "@orbyn/core";
import { ProposalReview } from "../../components/ProposalReview";
import type { Assistant } from "../../hooks/useAssistant";
import "./assistant.css";

const SUGGESTIONS = [
  { title: "Summarize my week", hint: "A calm overview of what’s coming" },
  {
    title: "What needs my attention?",
    hint: "Overdue and high-priority items",
  },
  { title: "Help me plan tomorrow", hint: "Turn tomorrow into a doable plan" },
  {
    title: "Add a task to call Mum on Friday at 6pm",
    hint: "Create items in plain language",
  },
];

type Props = {
  items: Item[];
  busy: boolean;
  assistant: Assistant;
};

export function AssistantView({ items, busy, assistant }: Props) {
  const { message, setMessage, turns, thinking, ask, apply, dismiss, reset } =
    assistant;
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const locked = busy || thinking;

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, thinking]);

  // Grow the composer with its content, up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
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

      <div className="ai-thread" aria-live="polite">
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
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
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
        <div ref={endRef} />
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
          rows={1}
          aria-label="Message your assistant"
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
        <button
          className="ai-send"
          aria-label="Send"
          disabled={locked || !message.trim()}
        >
          <ArrowUp size={18} />
        </button>
      </form>
      <small className="ai-note">
        Enter to send, Shift+Enter for a new line. Your request and up to 100
        recent items are shared with your configured AI provider.
      </small>
    </section>
  );
}
