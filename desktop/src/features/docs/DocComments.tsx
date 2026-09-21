import { useConfirm } from "../../components/Confirm";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import {
  anchorComments,
  plainText,
  threadComments,
  type DocBlock,
  type DocComment,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { Mark } from "./marks";
import { MentionBox, stillNamed } from "./MentionBox";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Make a name safe to put inside a regular expression. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Further than any line is long: how a whole-line remark shades its line. */
const WHOLE_LINE = Number.MAX_SAFE_INTEGER;

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
  /** Words the reader has chosen to comment on, before they have written. */
  pending: {
    blockId: string;
    quote: string;
    range_start?: number;
    range_end?: number;
  } | null;
  onPendingChange: (p: null) => void;
  /** The block whose card is singled out, from either side. */
  active: string | null;
  onActiveChange: (blockId: string | null) => void;
  /** The stretches of each line that carry remarks, so the page can shade them. */
  onAnchors: (marks: Record<string, Mark[]>) => void;
  report: (e: unknown) => void;
}) {
  const { ask, tell } = useConfirm();
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [pageDraft, setPageDraft] = useState("");
  /** A reply being written, by the thread it answers. */
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  /** Everyone each composer has named, kept by id so a rename still reads. */
  const namedDraft = useRef(new Map<string, string>());
  const namedPage = useRef(new Map<string, string>());
  const namedReply = useRef(new Map<string, string>());
  const [mentions, setMentions] = useState<string[]>([]);
  const [pageMentions, setPageMentions] = useState<string[]>([]);
  const [replyMentions, setReplyMentions] = useState<string[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Card tops, once measured; keyed the same as the groups below. */
  const [placed, setPlaced] = useState<Record<string, number>>({});
  const cardEls = useRef(new Map<string, HTMLElement>());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const anchoredRef = useRef<HTMLDivElement>(null);

  const load = () =>
    client.listDocComments(docId).then(setComments, () => setComments([]));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const all = comments ?? [];
  const resolvedThreads = new Set(
    all.filter((c) => c.resolved_at).map((c) => c.id),
  );
  const open = all.filter(
    (c) => !c.resolved_at && !resolvedThreads.has(c.parent_id ?? ""),
  );
  const done = all.filter((c) => c.resolved_at);
  const shown = showResolved ? all : open;
  const { anchored, loose } = anchorComments(shown, blocks);

  // A block being commented on gets a card before it has any comments.
  const groups = [...anchored.keys()];
  if (pending && !anchored.has(pending.blockId)) groups.push(pending.blockId);
  groups.sort((a, b) => (tops[a] ?? 0) - (tops[b] ?? 0));

  useEffect(() => {
    const observer = new ResizeObserver(() => setLayoutVersion((n) => n + 1));
    for (const element of cardEls.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [groups.join("|")]);

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
  }, [
    groups.join("|"),
    JSON.stringify(tops),
    comments,
    pending,
    active,
    layoutVersion,
  ]);

  /**
   * The shading the page should draw: one stretch per remark that names a
   * range, and nothing for a remark about a whole line, which the line's own
   * marker already shows.
   */
  const railMarks: Record<string, Mark[]> = {};
  for (const [blockId, list] of anchored)
    railMarks[blockId] = list
      .filter((c) => !c.parent_id)
      .map((c) =>
        // A remark about a whole line has no range of its own, so it shades
        // the line end to end; the cut is clamped to each run it meets.
        c.range_start !== null && c.range_end !== null
          ? {
              start: c.range_start,
              end: c.range_end,
              active: active === blockId,
            }
          : { start: 0, end: WHOLE_LINE, active: active === blockId },
      );
  if (pending?.range_start !== undefined && pending.range_end !== undefined)
    railMarks[pending.blockId] = [
      ...(railMarks[pending.blockId] ?? []),
      { start: pending.range_start, end: pending.range_end, active: true },
    ];
  const marked = JSON.stringify(railMarks);
  useEffect(() => {
    onAnchors(JSON.parse(marked) as Record<string, Mark[]>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marked]);

  const add = (
    body: string,
    anchor?: Parameters<typeof client.addDocComment>[2],
  ) => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    client
      .addDocComment(docId, text, anchor)
      .then((made) => {
        setComments((list) => [...(list ?? []), made]);
        if (made.parent_id) {
          setReply(null);
          namedReply.current.clear();
          setReplyMentions([]);
        } else if (made.block_id) {
          setDraft("");
          namedDraft.current.clear();
          setMentions([]);
          onPendingChange(null);
          onActiveChange(made.block_id);
        } else {
          setPageDraft("");
          namedPage.current.clear();
          setPageMentions([]);
        }
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  /** Write the remark the reader has been composing about their selection. */
  const addToSelection = () => {
    if (!pending) return;
    add(draft, {
      block_id: pending.blockId,
      quote: pending.quote,
      range_start: pending.range_start,
      range_end: pending.range_end,
      mentions,
    });
  };

  const setResolved = (c: DocComment, resolved: boolean) => {
    setBusy(true);
    client
      .resolveDocComment(docId, c.id, resolved)
      .then(() => load())
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remove = async (c: DocComment) => {
    if (
      !(await ask({
        title: "Remove this comment?",
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    client
      .deleteDocComment(docId, c.id)
      .then(() =>
        setComments(
          (list) =>
            list?.filter((x) => x.id !== c.id && x.parent_id !== c.id) ?? list,
        ),
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
      <p>{said(c)}</p>
    </article>
  );

  /**
   * A body with the people it names picked out. The names are plain words in
   * the text, so this is only about how they read; nothing depends on it.
   */
  function said(c: DocComment) {
    if (!c.mentions.length) return c.body;
    const names = c.mentions
      .map((m) => m.name)
      .sort((a, b) => b.length - a.length);
    const parts = c.body.split(
      new RegExp(`(@(?:${names.map(escape).join("|")}))`, "g"),
    );
    return parts.map((part, i) =>
      part.startsWith("@") && names.includes(part.slice(1)) ? (
        <b key={i} className="doc-named">
          {part}
        </b>
      ) : (
        part
      ),
    );
  }

  /** One thread: the remark, its replies, and a box to answer in. */
  const thread = (t: { comment: DocComment; replies: DocComment[] }) => (
    <div key={t.comment.id} className="doc-thread">
      {t.comment.quote && (
        <p
          className={
            "doc-card-quote" + (t.comment.detached ? " is-detached" : "")
          }
          title={
            t.comment.detached
              ? "These words have since gone from the page"
              : undefined
          }
        >
          “{plainText(t.comment.quote)}”
        </p>
      )}
      {remark(t.comment)}
      {t.replies.map(remark)}
      {reply?.id === t.comment.id ? (
        <div className="is-composer">
          <MentionBox
            disabled={busy}
            id={`doc-reply-${t.comment.id}`}
            autoFocus
            docId={docId}
            value={reply.text}
            named={namedReply.current}
            onNamed={setReplyMentions}
            onChange={(text) => setReply({ id: t.comment.id, text })}
            placeholder="Reply…"
            onSubmit={() =>
              add(reply.text, {
                parent_id: t.comment.id,
                mentions: replyMentions,
              })
            }
            onCancel={() => setReply(null)}
          />
          <div className="doc-card-actions">
            <button className="text-button" onClick={() => setReply(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !reply.text.trim()}
              onClick={() =>
                add(reply.text, {
                  parent_id: t.comment.id,
                  mentions: replyMentions,
                })
              }
            >
              Reply
            </button>
          </div>
        </div>
      ) : (
        !t.comment.resolved_at && (
          <button
            className="text-button doc-reply-open"
            onClick={() => {
              namedReply.current.clear();
              setReplyMentions([]);
              setReply({ id: t.comment.id, text: "" });
            }}
          >
            Reply
          </button>
        )
      )}
    </div>
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
          {threadComments(loose).map((t) => (
            <div key={t.comment.id} className="doc-card">
              {thread(t)}
            </div>
          ))}
          <div className="doc-card is-composer">
            <MentionBox
              disabled={busy}
              id="doc-comment-page"
              docId={docId}
              value={pageDraft}
              named={namedPage.current}
              onNamed={setPageMentions}
              onChange={setPageDraft}
              placeholder="Comment on the whole page…"
              onSubmit={() => add(pageDraft, { mentions: pageMentions })}
            />
            <button
              className="primary"
              disabled={busy || !pageDraft.trim()}
              onClick={() => add(pageDraft, { mentions: pageMentions })}
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
              {threadComments(list).map(thread)}
              {isPending && (
                <div className="doc-thread">
                  <p className="doc-card-quote">“{plainText(pending.quote)}”</p>
                  <div className="is-composer">
                    <MentionBox
                      disabled={busy}
                      id="doc-comment-draft"
                      autoFocus
                      docId={docId}
                      value={draft}
                      named={namedDraft.current}
                      onNamed={setMentions}
                      onChange={setDraft}
                      placeholder={
                        pending.range_start === undefined
                          ? "Comment on this line…"
                          : "Comment on these words…"
                      }
                      onSubmit={addToSelection}
                      onCancel={() => onPendingChange(null)}
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
                        onClick={addToSelection}
                      >
                        Comment
                      </button>
                    </div>
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
