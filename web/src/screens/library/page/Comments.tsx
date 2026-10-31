import { watchDocRefresh } from "@orbyn/api-client";
import { blockText, type DocBlock, type DocComment } from "@orbyn/core";
import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client, getToken } from "../../../lib/session";
import { pageWatcher } from "../streams";
import {
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  Menu,
  TextArea,
  useConfirm,
  useToast,
} from "../../../ui/kit";
import { when } from "../model";
import type { Mark } from "./marks";

type Pending = {
  blockId: string;
  quote: string;
  range_start?: number;
  range_end?: number;
};

/** Remarks on a page. A draft waits until someone chooses to drop it. */
export function CommentsPanel({
  docId,
  blocks,
  userId,
  pending,
  onPending,
  active,
  onActive,
  onMarks,
  onGoTo,
  onClose,
}: {
  docId: string;
  blocks: DocBlock[];
  userId?: string;
  pending: Pending | null;
  onPending: (next: Pending | null) => void;
  active: string | null;
  onActive: (id: string | null) => void;
  onMarks: (marks: Record<string, Mark[]>) => void;
  onGoTo: (blockId: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [pageDraft, setPageDraft] = useState("");
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    client.docPeople(docId).then(
      (list) => live && setPeople(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [docId]);

  useEffect(() => {
    const watcher = watchDocRefresh({
      api: pageWatcher,
      id: docId,
      session: getToken,
      load: () => client.listDocComments(docId),
      received: (list) => {
        setComments(list);
        setError("");
      },
      failed: (failure) =>
        setError(messageOf(failure, "Couldn't load comments.")),
    });
    refresh.current = watcher.refresh;
    return watcher.dispose;
  }, [docId]);

  const open = useMemo(
    () => (comments ?? []).filter((one) => !one.resolved_at),
    [comments],
  );
  const done = useMemo(
    () => (comments ?? []).filter((one) => one.resolved_at && !one.parent_id),
    [comments],
  );

  useEffect(() => {
    const marks: Record<string, Mark[]> = {};
    for (const comment of open) {
      if (
        !comment.block_id ||
        comment.detached ||
        comment.range_start === null ||
        comment.range_end === null
      )
        continue;
      (marks[comment.block_id] ??= []).push({
        start: comment.range_start,
        end: comment.range_end,
        active: active === comment.block_id,
      });
    }
    onMarks(marks);
    return () => onMarks({});
  }, [open, active, onMarks]);

  const threads = useCallback(
    (list: DocComment[]) =>
      list
        .filter((one) => !one.parent_id)
        .map((comment) => ({
          comment,
          replies: (comments ?? []).filter(
            (one) => one.parent_id === comment.id,
          ),
        })),
    [comments],
  );

  const report = (failure: unknown, fallback: string) =>
    toast({ text: messageOf(failure, fallback), error: true });

  const add = async (
    body: string,
    anchor?: Parameters<typeof client.addDocComment>[2],
  ) => {
    if (!body.trim() || busy) return false;
    setBusy(true);
    try {
      const named = people
        .filter((person) => body.includes(`@${person.name}`))
        .map((person) => person.id);
      await client.addDocComment(docId, body.trim(), {
        ...anchor,
        ...(named.length ? { mentions: named } : {}),
      });
      await refresh.current();
      return true;
    } catch (failure) {
      report(failure, "Couldn't add the comment. Your words are still here.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setResolved = async (comment: DocComment, resolved: boolean) => {
    try {
      await client.resolveDocComment(
        docId,
        comment.id,
        resolved,
        comment.revision,
      );
      await refresh.current();
    } catch (failure) {
      report(failure, "Couldn't change this comment.");
    }
  };
  const remove = async (comment: DocComment) => {
    const ok = await confirm({
      title: "Delete this comment?",
      action: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await client.deleteDocComment(docId, comment.id);
      await refresh.current();
    } catch (failure) {
      report(failure, "Couldn't delete this comment.");
    }
  };

  const row = (comment: DocComment, nested: boolean) => (
    <div key={comment.id} className={`doc-comment${nested ? " is-reply" : ""}`}>
      <div className="doc-comment-head">
        <strong className="small" dir="auto">
          {comment.author}
        </strong>
        <span className="small muted">{when(comment.created_at)}</span>
        <Menu
          label={`Comment options for ${comment.author}`}
          trigger={(show, expanded) => (
            <IconButton
              label={`Comment options for ${comment.author}`}
              aria-expanded={expanded}
              onClick={show}
            >
              <MoreHorizontal />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              {!nested && (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    void setResolved(comment, !comment.resolved_at);
                  }}
                >
                  {comment.resolved_at ? "Reopen" : "Resolve"}
                </button>
              )}
              {comment.user_id === userId && (
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    close();
                    void remove(comment);
                  }}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </Menu>
      </div>
      <p dir="auto">{comment.body}</p>
    </div>
  );

  const thread = ({
    comment,
    replies,
  }: {
    comment: DocComment;
    replies: DocComment[];
  }) => (
    <article
      key={comment.id}
      className="doc-thread"
      data-active={
        (comment.block_id && comment.block_id === active) || undefined
      }
    >
      {comment.quote && (
        <button
          type="button"
          className="doc-comment-quote small"
          disabled={comment.detached}
          dir="auto"
          onClick={() => {
            if (!comment.block_id) return;
            onActive(comment.block_id);
            onGoTo(comment.block_id);
          }}
        >
          {comment.quote}
          {comment.detached && (
            <span className="muted"> · No longer on the page</span>
          )}
        </button>
      )}
      {row(comment, false)}
      {replies.map((one) => row(one, true))}
      {reply?.id === comment.id ? (
        <form
          className="doc-comment-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add(reply.text, { parent_id: comment.id }).then(
              (ok) => ok && setReply(null),
            );
          }}
        >
          <TextArea
            autoFocus
            aria-label="Reply"
            placeholder="Reply…"
            value={reply.text}
            onChange={(event) =>
              setReply({ id: comment.id, text: event.currentTarget.value })
            }
          />
          <div className="doc-comment-actions">
            <Button variant="ghost" onClick={() => setReply(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!reply.text.trim()}
            >
              Reply
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setReply({ id: comment.id, text: "" })}
        >
          Reply
        </Button>
      )}
    </article>
  );

  const pendingBlock =
    pending && blocks.find((block) => block.id === pending.blockId);
  return (
    <div className="page-panel-body">
      <div className="page-panel-head">
        <h2>Comments</h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {error && (
        <ErrorNotice message={error} onRetry={() => void refresh.current()} />
      )}
      {pending && (
        <form
          className="doc-comment-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add(draft, {
              block_id: pending.blockId,
              quote: pending.quote,
              range_start: pending.range_start,
              range_end: pending.range_end,
            }).then((ok) => {
              if (ok) {
                setDraft("");
                onPending(null);
              }
            });
          }}
        >
          <p className="doc-comment-quote small" dir="auto">
            {pending.quote || (pendingBlock ? blockText(pendingBlock) : "")}
          </p>
          <TextArea
            autoFocus
            aria-label="Comment"
            placeholder="Comment or ask @orbyn…"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <div className="doc-comment-actions">
            <Button variant="ghost" onClick={() => onPending(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={busy}
              disabled={!draft.trim()}
            >
              Comment
            </Button>
          </div>
        </form>
      )}
      {!comments && !error && <Loading label="Loading comments" />}
      {comments && !open.length && !pending && (
        <p className="small muted">
          No comments yet. Select words on the page to comment on them.
        </p>
      )}
      {threads(open).map(thread)}
      {done.length > 0 && (
        <Button variant="ghost" onClick={() => setShowResolved(!showResolved)}>
          {showResolved ? "Hide" : "Show"} {done.length} resolved
        </Button>
      )}
      {showResolved && threads(done).map(thread)}
      <form
        className="doc-comment-form page-panel-foot"
        onSubmit={(event) => {
          event.preventDefault();
          void add(pageDraft).then((ok) => ok && setPageDraft(""));
        }}
      >
        <TextArea
          aria-label="Comment on the page"
          placeholder="Comment on the page"
          value={pageDraft}
          onChange={(event) => setPageDraft(event.currentTarget.value)}
        />
        <div className="doc-comment-actions">
          <Button type="submit" busy={busy} disabled={!pageDraft.trim()}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
