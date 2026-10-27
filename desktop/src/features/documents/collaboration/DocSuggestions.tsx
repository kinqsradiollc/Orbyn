import { Check, X, Undo2 } from "lucide-react";
import { activityOriginLabel, type DocSuggestion } from "@orbyn/core";

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
  onDecideAll,
  sourceBlockIds,
}: {
  suggestions: DocSuggestion[];
  /** Only someone who may change the page can take a proposal into it. */
  canDecide: boolean;
  userId?: string;
  busy: boolean;
  onDecide: (s: DocSuggestion, take: boolean) => void;
  onWithdraw: (s: DocSuggestion) => void;
  onDecideAll?: (suggestions: DocSuggestion[], take: boolean) => void;
  sourceBlockIds?: ReadonlySet<string>;
}) {
  const open = suggestions.filter((s) => s.status === "open");
  if (!open.length) return null;
  const live = open.filter((s) => !s.detached);
  return (
    <section className="doc-suggestions" aria-label="Proposed changes">
      <h3>
        {open.length} proposed change{open.length === 1 ? "" : "s"}
      </h3>
      {canDecide && onDecideAll && live.length > 1 && (
        <div className="doc-suggest-all">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => onDecideAll?.(live, true)}
          >
            <Check size={13} aria-hidden="true" /> Accept all
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => onDecideAll?.(live, false)}
          >
            <X size={13} aria-hidden="true" /> Reject all
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
            <small>
              {when(s.created_at)}
              {s.via_agent
                ? ` · ${activityOriginLabel({ via_agent: s.via_agent })}`
                : ""}
            </small>
          </header>
          <details className="doc-suggest-details" open={open.length === 1}>
            <summary>Review change</summary>
            <div
              className={
                "doc-suggest-change" +
                (sourceBlockIds?.has(s.block_id) ? " is-source" : "")
              }
            >
              {!!s.quote && (
                <div>
                  <span className="muted">Before</span>
                  <pre>{s.quote}</pre>
                </div>
              )}
              {!!s.text && (
                <div>
                  <span className="muted">After</span>
                  <pre>{s.text}</pre>
                </div>
              )}
              {!s.text && <p className="muted">Remove selected text</p>}
            </div>
          </details>
          {!!s.note && <p className="doc-suggest-note">{s.note}</p>}
          {s.detached ? (
            <p className="doc-suggest-stale">
              The original text was removed. This change cannot be applied.
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
                    <X size={13} aria-hidden="true" /> Reject
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => onDecide(s, true)}
                  >
                    <Check size={13} aria-hidden="true" /> Accept
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
