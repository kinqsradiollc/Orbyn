import { ArrowRight, ArrowUpRight, Sparkles } from "lucide-react";
import type { Item } from "@orbyn/core";
import { ProposalReview } from "../../components/ProposalReview";
import type { Assistant } from "../../hooks/useAssistant";

const SUGGESTIONS = [
  "Summarize my week",
  "What needs my attention?",
  "Help me plan tomorrow",
];

type Props = {
  items: Item[];
  busy: boolean;
  assistant: Assistant;
};

export function AssistantView({ items, busy, assistant }: Props) {
  const { message, setMessage, proposal, ask, apply, dismiss } = assistant;
  return (
    <section className="card chat">
      <div className="assistant-intro">
        <Sparkles size={30} />
        <h2>What’s on your mind?</h2>
        <p>
          Ask for a summary, create a plan, or adjust your existing items.
          <br />
          You’ll review all changes before they’re saved.
        </p>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} disabled={busy} onClick={() => ask(s)}>
              {s}
              <ArrowUpRight size={14} />
            </button>
          ))}
        </div>
      </div>
      {proposal && (
        <ProposalReview
          proposal={proposal}
          items={items}
          busy={busy}
          onApply={() => void apply()}
          onDismiss={dismiss}
        />
      )}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          aria-label="Message your assistant"
          placeholder="Make a little space. Ask Orbyn…"
          value={message}
          maxLength={4000}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className="primary" disabled={busy || !message.trim()}>
          {busy ? "Thinking…" : "Send"}
          <ArrowRight size={16} />
        </button>
      </form>
      <small className="muted">
        Your request and up to 100 recent items are shared with your configured
        AI provider.
      </small>
    </section>
  );
}
