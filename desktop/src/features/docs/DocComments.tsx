import { watchDocRefresh } from "@orbyn/api-client";
import { session } from "../../lib/session";
import { usePaneLeaveGuard } from "../../app/page-commands";
import { useConfirm } from "../../components/Confirm";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { MessageSquare } from "lucide-react";
import {
  activityOriginLabel,
  anchorComments,
  threadComments,
  type DocBlock,
  type DocComment,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { Mark } from "./marks";
import { MentionBox, stillNamed } from "./MentionBox";

export function DocComments(props: Parameters<typeof DocCommentsBody>[0]) {
  return <DocCommentsBody key={`${session.get()}:${props.docId}`} {...props} />;
}

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
function DocCommentsBody({
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
  hidden = false,
  beforeAnchorChange,
}: {
  docId: string;
  hidden?: boolean;
  beforeAnchorChange?: MutableRefObject<(() => Promise<boolean>) | null>;
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
  const { ask } = useConfirm();
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
  const mutation = useRef(false);
  const mounted = useRef(true);
  const owner = useRef(docId);
  owner.current = docId;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mutationCurrent = (account: string) =>
    mounted.current && owner.current === docId && session.get() === account;
  const [busy, setBusy] = useState(false);
  const drafts = useRef({ draft, pageDraft, reply });
  drafts.current = { draft, pageDraft, reply };
  const draftDecision = useRef(false);
  usePaneLeaveGuard(async () => {
    if (mutation.current || draftDecision.current) return false;
    const before = drafts.current;
    if (
      !before.draft.trim() &&
      !before.pageDraft.trim() &&
      !before.reply?.text.trim()
    )
      return true;
    const account = session.get();
    draftDecision.current = true;
    try {
      if (
        !(await ask({
          title: "Discard unsent comments?",
          body: "Your unsent comments and reply will be lost.",
          confirmLabel: "Discard comments",
          cancelLabel: "Keep editing",
        }))
      )
        return false;
      if (
        !mutationCurrent(account) ||
        drafts.current.draft !== before.draft ||
        drafts.current.pageDraft !== before.pageDraft ||
        drafts.current.reply !== before.reply
      )
        return false;
      setDraft("");
      setPageDraft("");
      setReply(null);
      namedDraft.current.clear();
      namedPage.current.clear();
      namedReply.current.clear();
      setMentions([]);
      setPageMentions([]);
      setReplyMentions([]);
      onPendingChange(null);
      return true;
    } finally {
      draftDecision.current = false;
    }
  });
  const changeReply = async (next: { id: string; text: string } | null) => {
    if (mutation.current || draftDecision.current) return;
    const previous = drafts.current.reply;
    const account = session.get();
    draftDecision.current = true;
    try {
      if (
        previous?.text.trim() &&
        !(await ask({
          title: "Discard reply?",
          body: "Your unsent reply will be lost.",
          confirmLabel: "Discard reply",
          cancelLabel: "Keep editing",
        }))
      )
        return;
      if (!mutationCurrent(account) || drafts.current.reply !== previous)
        return;
      namedReply.current.clear();
      setReplyMentions([]);
      setReply(next);
    } finally {
      draftDecision.current = false;
    }
  };

  const prepareAnchorChange = async () => {
    if (mutation.current || draftDecision.current) return false;
    const previous = drafts.current.draft;
    const account = session.get();
    if (!previous.trim()) return mutationCurrent(account);
    draftDecision.current = true;
    try {
      if (
        !(await ask({
          title: "Discard unsent comment?",
          body: "Your comment on the selected text will be lost.",
          confirmLabel: "Discard comment",
          cancelLabel: "Keep editing",
        }))
      )
        return false;
      if (!mutationCurrent(account) || drafts.current.draft !== previous)
        return false;
      setDraft("");
      namedDraft.current.clear();
      setMentions([]);
      return true;
    } finally {
      draftDecision.current = false;
    }
  };
  const prepareAnchorRef = useRef(prepareAnchorChange);
  prepareAnchorRef.current = prepareAnchorChange;
  useEffect(() => {
    if (!beforeAnchorChange) return;
    const guard = () => prepareAnchorRef.current();
    beforeAnchorChange.current = guard;
    return () => {
      if (beforeAnchorChange.current === guard)
        beforeAnchorChange.current = null;
    };
  }, [beforeAnchorChange]);
  const cancelAnchor = async () => {
    const account = session.get();
    if (await prepareAnchorChange()) {
      if (mutationCurrent(account)) onPendingChange(null);
    }
  };

  /** Card tops, once measured; keyed the same as the groups below. */
  const [placed, setPlaced] = useState<Record<string, number>>({});
  /**
   * How tall the anchored cards reach. Every card is positioned absolutely,
   * so the canvas holding them has no height of its own and whatever comes
   * after it would sit on top of them.
   */
  const [canvasHeight, setCanvasHeight] = useState(0);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const railRef = useRef<HTMLDivElement>(null);
  const anchoredRef = useRef<HTMLDivElement>(null);

  const [failed, setFailed] = useState(false);
  const refreshRef = useRef<ReturnType<typeof watchDocRefresh> | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const load = () => refreshRef.current?.refresh() ?? Promise.resolve();
  useEffect(() => {
    setComments(null);
    setFailed(false);
    const watcher = watchDocRefresh({
      api: client,
      id: docId,
      session: () => session.get(),
      load: () => client.listDocComments(docId),
      received: (rows) => {
        setComments(rows);
        setFailed(false);
      },
      failed: (error) => {
        setFailed(true);
        reportRef.current(error);
      },
    });
    refreshRef.current = watcher;
    return () => {
      watcher.dispose();
      refreshRef.current = null;
    };
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
    setCanvasHeight(y > 0 ? y - GAP : 0);
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
    if (!text || mutation.current || draftDecision.current) return;
    mutation.current = true;
    setBusy(true);
    const account = session.get();
    client
      .addDocComment(docId, text, anchor)
      .then((made) => {
        if (!mutationCurrent(account)) return;
        void load();
        setComments((list) => [
          ...(list ?? []).filter((row) => row.id !== made.id),
          made,
        ]);
        if (
          made.parent_id &&
          drafts.current.reply?.id === made.parent_id &&
          drafts.current.reply.text.trim() === text
        ) {
          setReply(null);
          namedReply.current.clear();
          setReplyMentions([]);
        } else if (made.block_id && drafts.current.draft.trim() === text) {
          setDraft("");
          namedDraft.current.clear();
          setMentions([]);
          onPendingChange(null);
          onActiveChange(made.block_id);
        } else if (
          !made.parent_id &&
          !made.block_id &&
          drafts.current.pageDraft.trim() === text
        ) {
          setPageDraft("");
          namedPage.current.clear();
          setPageMentions([]);
        }
      })
      .catch((error) => {
        if (mutationCurrent(account)) reportRef.current(error);
      })
      .finally(() => {
        mutation.current = false;
        if (mutationCurrent(account)) setBusy(false);
      });
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
    if (mutation.current || draftDecision.current) return;
    mutation.current = true;
    setBusy(true);
    const account = session.get();
    client
      .resolveDocComment(docId, c.id, resolved)
      .then(() => {
        if (mutationCurrent(account)) return load();
      })
      .catch((error) => {
        if (mutationCurrent(account)) reportRef.current(error);
      })
      .finally(() => {
        mutation.current = false;
        if (mutationCurrent(account)) setBusy(false);
      });
  };

  const remove = async (c: DocComment) => {
    if (mutation.current || draftDecision.current) return;
    mutation.current = true;
    setBusy(true);
    const account = session.get();
    try {
      if (
        !(await ask({
          title: "Remove this comment?",
          body:
            drafts.current.reply?.id === c.id &&
            drafts.current.reply.text.trim()
              ? "Also removes its replies and discards your unsent reply."
              : "Also removes its replies.",
          confirmLabel: "Remove",
          destructive: true,
        }))
      )
        return;
      if (!mutationCurrent(account)) return;
      await client.deleteDocComment(docId, c.id);
      if (!mutationCurrent(account)) return;
      if (drafts.current.reply?.id === c.id) {
        setReply(null);
        namedReply.current.clear();
        setReplyMentions([]);
      }
      void load();
      setComments(
        (list) =>
          list?.filter((x) => x.id !== c.id && x.parent_id !== c.id) ?? list,
      );
    } catch (e) {
      if (mutationCurrent(account)) reportRef.current(e);
    } finally {
      mutation.current = false;
      if (mutationCurrent(account)) setBusy(false);
    }
  };

  const remark = (c: DocComment) => (
    <article
      key={c.id}
      className={"doc-remark" + (c.resolved_at ? " is-resolved" : "")}
    >
      <header>
        <strong>{c.author}</strong>
        <small>
          {when(c.created_at)}
          {c.via_agent
            ? ` · ${activityOriginLabel({ via_agent: c.via_agent })}`
            : ""}
        </small>
        <details className="doc-comment-actions">
          <summary aria-label={`Comment options for ${c.author}`}>…</summary>
          <div>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setResolved(c, !c.resolved_at)}
            >
              {c.resolved_at ? "Reopen" : "Resolve"}
            </button>
            {c.user_id === userId && (
              <button
                className="text-button is-danger"
                disabled={busy}
                onClick={() => {
                  void remove(c);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </details>
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
        <details className="doc-comment-quote">
          <summary>
            {t.comment.detached ? "Removed text" : "Quoted text"}
          </summary>
          <pre>{t.comment.quote}</pre>
        </details>
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
            onCancel={() => {
              void changeReply(null);
            }}
          />
          <div className="doc-card-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void changeReply(null)}
            >
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
            disabled={busy}
            onClick={() => {
              void changeReply({ id: t.comment.id, text: "" });
            }}
          >
            Reply
          </button>
        )
      )}
    </div>
  );

  if (comments === null && !failed)
    return (
      <div
        className="doc-margin"
        hidden={hidden}
        style={hidden ? { display: "none" } : undefined}
        aria-label="Comments"
      >
        <p className="muted small">Loading…</p>
      </div>
    );

  return (
    <div
      className="doc-margin"
      ref={railRef}
      hidden={hidden}
      style={hidden ? { display: "none" } : undefined}
      aria-label="Comments"
    >
      {failed && (
        <p role="alert">
          Couldn’t refresh comments.{" "}
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {/* First in the rail, so a card can reach the line it is about. With
          the page-wide remarks above it the canvas began below them, and no
          card could ever sit higher than that — every one hung too low, and
          the first line's card hung lowest of all. */}
      <div
        className="doc-margin-anchored"
        ref={anchoredRef}
        style={{ minHeight: canvasHeight }}
      >
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
                  <details className="doc-comment-quote">
                    <summary>Selected text</summary>
                    <pre>{pending.quote}</pre>
                  </details>
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
                      onCancel={() => {
                        void cancelAnchor();
                      }}
                    />
                    <div className="doc-card-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void cancelAnchor()}
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
              placeholder="Comment or ask @orbyn…"
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
