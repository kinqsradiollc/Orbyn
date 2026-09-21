import { Check, X, Undo2 } from "lucide-react";
import type { DocSuggestion } from "@orbyn/core";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Changes people have proposed, waiting to be taken or left.
 *
 * Each card shows the words as they stand and the words proposed instead,
 * so the decision can be made without reading the page twice. A proposal
 * whose words have since gone is not offered as a decision at all — there
 * is nothing left to apply it to — but it is kept and shown, because what
 * someone meant by it usually still matters.
 */
export function DocSuggestions({
  suggestions,
  canDecide,
  userId,
  busy,
  onDecide,
  onWithdraw,
}: {
  suggestions: DocSuggestion[];
  /** Only someone who may change the page can take a proposal into it. */
  canDecide: boolean;
  userId?: string;
  busy: boolean;
  onDecide: (s: DocSuggestion, take: boolean) => void;
  onWithdraw: (s: DocSuggestion) => void;
}) {
  const open = suggestions.filter((s) => s.status === "open");
  if (!open.length) return null;
  const live = open.filter((s) => !s.detached);
  return (
    <section className="doc-suggestions" aria-label="Proposed changes">
      <h3>
        {open.length} proposed change{open.length === 1 ? "" : "s"}
      </h3>
      {canDecide && live.length > 1 && (
        <div className="doc-suggest-all">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => live.forEach((s) => onDecide(s, true))}
          >
            <Check size={13} aria-hidden="true" /> Take all
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => live.forEach((s) => onDecide(s, false))}
          >
            <X size={13} aria-hidden="true" /> Leave all
          </button>
        </div>
      )}
      {open.map((s) => (
        <article
          key={s.id}
          className={"doc-suggest" + (s.detached ? " is-detached" : "")}
        >
          <header>
            <strong>{s.author}</strong>
            <small>{when(s.created_at)}</small>
          </header>
          <p className="doc-suggest-change">
            {!!s.quote && <del>{s.quote}</del>}
            {!!s.text && <ins>{s.text}</ins>}
          </p>
          {!!s.note && <p className="doc-suggest-note">{s.note}</p>}
          {s.detached ? (
            <p className="doc-suggest-stale">
              The words this was about have gone. Nothing to apply it to.
            </p>
          ) : (
            <div className="doc-card-actions">
              {s.user_id === userId && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => onWithdraw(s)}
                >
                  <Undo2 size={13} aria-hidden="true" /> Withdraw
                </button>
              )}
              {canDecide && (
                <>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => onDecide(s, false)}
                  >
                    <X size={13} aria-hidden="true" /> Leave
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => onDecide(s, true)}
                  >
                    <Check size={13} aria-hidden="true" /> Take
                  </button>
                </>
              )}
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
