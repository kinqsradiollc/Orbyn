import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { anchorComments, type DocBlock, type DocComment } from "@orbyn/core";
import { client } from "../../lib/api";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Gap kept between two cards when their lines sit closer than that. */
const GAP = 10;

/**
 * Comments in the margin, beside the lines they are about.
 *
 * A card wants to sit level with its line. Where two lines are closer
 * together than their cards are tall, the cards stack downwards from the
 * first — so they stay in the page's order and never overlap, which is the
 * arrangement every margin-comment column ends up at.
 *
 * Remarks about the page as a whole, and remarks whose line has since been
 * deleted, gather at the top under their own heading: the words they were
 * written about are kept with them, so they still read.
 */
export function DocComments({
  docId,
  blocks,
  tops,
  userId,
  pending,
  onPendingChange,
  active,
  onActiveChange,
  onAnchors,
  report,
}: {
  docId: string;
  blocks: DocBlock[];
  /** Where each named block sits, measured from the top of the page. */
  tops: Record<string, number>;
  userId?: string;
  /** A block the reader has chosen to comment on, before they have written. */
  pending: { blockId: string; quote: string } | null;
  onPendingChange: (p: { blockId: string; quote: string } | null) => void;
  /** The block whose card is singled out, from either side. */
  active: string | null;
  onActiveChange: (blockId: string | null) => void;
  /** The lines that carry remarks, so the page can mark them. */
  onAnchors: (blockIds: string[]) => void;
  report: (e: unknown) => void;
}) {
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [pageDraft, setPageDraft] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Card tops, once measured; keyed the same as the groups below. */
  const [placed, setPlaced] = useState<Record<string, number>>({});
  const cardEls = useRef(new Map<string, HTMLElement>());
  const railRef = useRef<HTMLDivElement>(null);
  const anchoredRef = useRef<HTMLDivElement>(null);

  const load = () =>
    client.listDocComments(docId).then(setComments, () => setComments([]));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const all = comments ?? [];
  const open = all.filter((c) => !c.resolved_at);
  const done = all.filter((c) => c.resolved_at);
  const shown = showResolved ? all : open;
  const { anchored, loose } = anchorComments(shown, blocks);

  // A block being commented on gets a card before it has any comments.
  const groups = [...anchored.keys()];
  if (pending && !anchored.has(pending.blockId)) groups.push(pending.blockId);
  groups.sort((a, b) => (tops[a] ?? 0) - (tops[b] ?? 0));

  /**
   * Put each card level with its line, then push any that would overlap the
   * one above far enough down to clear it.
   */
  useLayoutEffect(() => {
    // A line's position is measured from the top of the page, but a card is
    // placed inside the anchored area, which starts below whatever sits
    // above it. Without taking that away, every card hangs too low by the
    // height of the "on the page" group.
    const rail = railRef.current?.getBoundingClientRect().top ?? 0;
    const origin =
      (anchoredRef.current?.getBoundingClientRect().top ?? rail) - rail;
    let y = 0;
    const next: Record<string, number> = {};
    for (const key of groups) {
      const wanted = (tops[key] ?? 0) - origin;
      const top = Math.max(wanted, y);
      next[key] = top;
      y = top + (cardEls.current.get(key)?.offsetHeight ?? 0) + GAP;
    }
    setPlaced((prev) => {
      const same =
        Object.keys(prev).length === Object.keys(next).length &&
        Object.entries(next).every(([k, v]) => prev[k] === v);
      return same ? prev : next;
    });
  }, [groups.join("|"), JSON.stringify(tops), comments, pending, active]);

  const marked = [...anchored.keys()].join("|");
  useEffect(() => {
    onAnchors(marked ? marked.split("|") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marked]);

  const add = (blockId: string | null, body: string, quote: string | null) => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    client
      .addDocComment(
        docId,
        text,
        blockId && quote !== null ? { block_id: blockId, quote } : undefined,
      )
      .then((made) => {
        setComments((list) => [...(list ?? []), made]);
        if (blockId) {
          setDraft("");
          onPendingChange(null);
          onActiveChange(blockId);
        } else setPageDraft("");
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  const setResolved = (c: DocComment, resolved: boolean) => {
    setBusy(true);
    client
      .resolveDocComment(docId, c.id, resolved)
      .then(() => void load())
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remove = (c: DocComment) => {
    if (!confirm("Remove this comment?")) return;
    setBusy(true);
    client
      .deleteDocComment(docId, c.id)
      .then(() =>
        setComments((list) => list?.filter((x) => x.id !== c.id) ?? list),
      )
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remark = (c: DocComment) => (
    <article
      key={c.id}
      className={"doc-remark" + (c.resolved_at ? " is-resolved" : "")}
    >
      <header>
        <strong>{c.author}</strong>
        <small>{when(c.created_at)}</small>
        <button
          className="icon-button"
          aria-label={
            c.resolved_at ? "Bring this comment back" : "Resolve this comment"
          }
          disabled={busy}
          onClick={() => setResolved(c, !c.resolved_at)}
        >
          {c.resolved_at ? <RotateCcw size={13} /> : <Check size={14} />}
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
      </header>
      <p>{c.body}</p>
    </article>
  );

  if (comments === null)
    return (
      <div className="doc-margin" aria-label="Comments">
        <p className="muted small">Loading…</p>
      </div>
    );

  return (
    <div className="doc-margin" ref={railRef} aria-label="Comments">
      {/* Always here: a remark about the page as a whole should not become
          unreachable the moment someone comments on a line. */}
      {
        <section className="doc-margin-loose">
          <h3>
            <MessageSquare size={14} aria-hidden="true" /> On the page
          </h3>
          {loose.map((c) => (
            <div key={c.id} className="doc-card">
              {c.quote && (
                <p className="doc-card-quote" title="This line has since gone">
                  “{c.quote}”
                </p>
              )}
              {remark(c)}
            </div>
          ))}
          <div className="doc-card is-composer">
            <textarea
              id="doc-comment-page"
              value={pageDraft}
              placeholder="Comment on the whole page…"
              maxLength={4000}
              rows={2}
              onChange={(e) => setPageDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  add(null, pageDraft, null);
                }
              }}
            />
            <button
              className="primary"
              disabled={busy || !pageDraft.trim()}
              onClick={() => add(null, pageDraft, null)}
            >
              Comment
            </button>
          </div>
        </section>
      }

      <div className="doc-margin-anchored" ref={anchoredRef}>
        {groups.map((blockId) => {
          const list = anchored.get(blockId) ?? [];
          const isPending = pending?.blockId === blockId;
          return (
            <div
              key={blockId}
              ref={(el) => {
                if (el) cardEls.current.set(blockId, el);
                else cardEls.current.delete(blockId);
              }}
              className={
                "doc-card is-anchored" +
                (active === blockId ? " is-active" : "")
              }
              style={{ top: placed[blockId] ?? 0 }}
              onClick={() => onActiveChange(blockId)}
            >
              <p className="doc-card-quote">
                “{list[0]?.quote ?? pending?.quote ?? ""}”
              </p>
              {list.map(remark)}
              {isPending && (
                <div className="is-composer">
                  <textarea
                    id="doc-comment-draft"
                    autoFocus
                    value={draft}
                    placeholder="Comment on this line…"
                    maxLength={4000}
                    rows={2}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        add(blockId, draft, pending.quote);
                      }
                      if (e.key === "Escape") onPendingChange(null);
                    }}
                  />
                  <div className="doc-card-actions">
                    <button
                      className="text-button"
                      onClick={() => onPendingChange(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary"
                      disabled={busy || !draft.trim()}
                      onClick={() => add(blockId, draft, pending.quote)}
                    >
                      Comment
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {done.length > 0 && (
        <button
          className="text-button doc-margin-resolved"
          onClick={() => setShowResolved((v) => !v)}
        >
          {showResolved ? "Hide" : "Show"} {done.length} resolved
        </button>
      )}
    </div>
  );
}
