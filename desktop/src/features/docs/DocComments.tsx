import { useEffect, useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import type { DocComment } from "@orbyn/core";
import { client } from "../../lib/api";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Remarks on a document: one thread, so a note survives the blocks being
 * rewritten around it. Resolved remarks fold away but are kept, since the
 * reason something changed is often worth reading later.
 */
export function DocComments({
  docId,
  userId,
  report,
}: {
  docId: string;
  userId?: string;
  report: (e: unknown) => void;
}) {
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    client.listDocComments(docId).then(setComments, () => setComments([]));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const add = () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    client
      .addDocComment(docId, body)
      .then((made) => {
        setComments((all) => [...(all ?? []), made]);
        setDraft("");
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const setResolved = (comment: DocComment, resolved: boolean) => {
    setBusy(true);
    client
      .resolveDocComment(docId, comment.id, resolved)
      .then(() => void load())
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remove = (comment: DocComment) => {
    if (!confirm("Remove this comment?")) return;
    setBusy(true);
    client
      .deleteDocComment(docId, comment.id)
      .then(() =>
        setComments((all) => all?.filter((c) => c.id !== comment.id) ?? all),
      )
      .catch(report)
      .finally(() => setBusy(false));
  };

  const open = (comments ?? []).filter((c) => !c.resolved_at);
  const done = (comments ?? []).filter((c) => c.resolved_at);

  return (
    <section className="doc-comments">
      <h3>
        <MessageSquare size={15} aria-hidden="true" /> Comments
        {open.length > 0 && (
          <span className="doc-comment-n">{open.length}</span>
        )}
      </h3>

      {comments === null ? (
        <p className="muted small">Loading…</p>
      ) : (
        <>
          {open.length === 0 && done.length === 0 && (
            <p className="muted small">
              No comments yet. Leave a note for whoever reads this next.
            </p>
          )}

          <ul className="doc-comment-list">
            {open.map((c) => (
              <li key={c.id}>
                <div className="doc-comment-head">
                  <strong>{c.author}</strong>
                  <small>{when(c.created_at)}</small>
                  <button
                    className="icon-button"
                    aria-label="Resolve this comment"
                    disabled={busy}
                    onClick={() => setResolved(c, true)}
                  >
                    <Check size={14} />
                  </button>
                  {c.user_id === userId && (
                    <button
                      className="icon-button"
                      aria-label="Remove this comment"
                      disabled={busy}
                      onClick={() => remove(c)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p>{c.body}</p>
              </li>
            ))}
          </ul>

          {done.length > 0 && (
            <>
              <button
                className="text-button"
                onClick={() => setShowResolved((v) => !v)}
              >
                {showResolved ? "Hide" : "Show"} {done.length} resolved
              </button>
              {showResolved && (
                <ul className="doc-comment-list is-resolved">
                  {done.map((c) => (
                    <li key={c.id}>
                      <div className="doc-comment-head">
                        <strong>{c.author}</strong>
                        <small>{when(c.created_at)}</small>
                        <button
                          className="icon-button"
                          aria-label="Bring this comment back"
                          disabled={busy}
                          onClick={() => setResolved(c, false)}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                      <p>{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="doc-comment-new">
            <textarea
              id="doc-comment-draft"
              value={draft}
              placeholder="Leave a comment…"
              maxLength={4000}
              rows={2}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter starts a new line.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <button
              className="primary"
              onClick={add}
              disabled={busy || !draft.trim()}
            >
              Comment
            </button>
          </div>
        </>
      )}
    </section>
  );
}
