import { watchDocRefresh } from "@orbyn/api-client";
import { session } from "../../lib/session";
import { useCallback, useEffect, useRef, useState } from "react";
import { anchorComments, type DocBlock, type DocComment } from "@orbyn/core";
import { client } from "../../lib/api";

/**
 * A document's comments, held once for the whole page.
 *
 * A phone has no margin to put a card in, so a remark about a line is shown
 * under that line instead — which means the editor and the page-level
 * section both need the same comments. Keeping them here saves fetching
 * twice and keeps the two from disagreeing.
 */
export function useDocComments(
  docId: string,
  blocks: DocBlock[],
  report: (e: unknown) => void,
) {
  const accountAtRender = session.token;
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const reportRef = useRef(report);
  reportRef.current = report;
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  /** A tap can land twice before the button re-renders as disabled. */
  const mutation = useRef<object | null>(null);
  const owner = useRef({ id: docId, mounted: true });
  owner.current.id = docId;

  const refreshRef = useRef<ReturnType<typeof watchDocRefresh> | null>(null);
  const load = useCallback(
    () => refreshRef.current?.refresh() ?? Promise.resolve(),
    [],
  );
  useEffect(() => {
    owner.current.mounted = true;
    mutation.current = null;
    setBusy(false);
    setComments(null);
    setFailed(false);
    const watcher = watchDocRefresh({
      api: client,
      id: docId,
      session: () => session.token,
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
      owner.current.mounted = false;
      mutation.current = null;
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
  const resolved = all.filter((c) => c.resolved_at);
  const { anchored, loose } = anchorComments(showResolved ? all : open, blocks);

  const runMutation = async (write: () => Promise<void>): Promise<boolean> => {
    if (
      mutation.current ||
      !owner.current.mounted ||
      owner.current.id !== docId ||
      session.token !== accountAtRender
    )
      return false;
    const ticket = {};
    const account = session.token;
    mutation.current = ticket;
    setBusy(true);
    const current = () =>
      owner.current.mounted &&
      owner.current.id === docId &&
      session.token === account &&
      mutation.current === ticket;
    try {
      await write();
      if (!current()) return false;
      // Refresh supersedes any comment read started before this write.
      await load();
      return current();
    } catch (error) {
      if (current()) reportRef.current(error);
      return false;
    } finally {
      if (mutation.current === ticket) {
        mutation.current = null;
        if (owner.current.mounted && owner.current.id === docId) setBusy(false);
      }
    }
  };
  const add = (
    body: string,
    anchor?: Parameters<typeof client.addDocComment>[2],
  ): Promise<boolean> => {
    const text = body.trim();
    if (!text) return Promise.resolve(false);
    return runMutation(async () => {
      await client.addDocComment(docId, text, anchor);
    });
  };
  const setResolved = (comment: DocComment, next: boolean) => {
    void runMutation(async () => {
      await client.resolveDocComment(docId, comment.id, next);
    });
  };
  const remove = (comment: DocComment) => {
    void runMutation(async () => {
      await client.deleteDocComment(docId, comment.id);
    });
  };

  /**
   * How many open remarks each line carries, for the marks in the page.
   * Replies are part of the remark they answer, not remarks of their own,
   * so a thread counts once however long it runs.
   */
  const counts: Record<string, number> = {};
  for (const [blockId, list] of anchored)
    counts[blockId] = list.filter((c) => !c.parent_id).length;

  return {
    /** The page these belong to, so a composer can ask who may be named. */
    docId,
    loading: comments === null && !failed,
    failed,
    reload: load,
    anchored,
    loose,
    counts,
    resolvedCount: resolved.length,
    showResolved,
    setShowResolved,
    busy,
    add,
    setResolved,
    remove,
  };
}

export type DocCommentsState = ReturnType<typeof useDocComments>;
