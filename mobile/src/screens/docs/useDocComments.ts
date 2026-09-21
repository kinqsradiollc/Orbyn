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
  const [comments, setComments] = useState<DocComment[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  /** A tap can land twice before the button re-renders as disabled. */
  const sending = useRef(false);

  const load = useCallback(
    () =>
      client.listDocComments(docId).then(setComments, () => setComments([])),
    [docId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const all = comments ?? [];
  const open = all.filter((c) => !c.resolved_at);
  const resolved = all.filter((c) => c.resolved_at);
  const { anchored, loose } = anchorComments(showResolved ? all : open, blocks);

  const add = (
    body: string,
    anchor?: Parameters<typeof client.addDocComment>[2],
  ): Promise<boolean> => {
    const text = body.trim();
    if (!text || sending.current) return Promise.resolve(false);
    sending.current = true;
    setBusy(true);
    return client
      .addDocComment(docId, text, anchor)
      .then((made) => {
        setComments((list) => [...(list ?? []), made]);
        return true;
      })
      .catch((e) => {
        report(e);
        return false;
      })
      .finally(() => {
        sending.current = false;
        setBusy(false);
      });
  };

  const setResolved = (c: DocComment, next: boolean) => {
    setBusy(true);
    client
      .resolveDocComment(docId, c.id, next)
      .then(() => void load())
      .catch(report)
      .finally(() => setBusy(false));
  };

  const remove = (c: DocComment) => {
    setBusy(true);
    client
      .deleteDocComment(docId, c.id)
      .then(() =>
        setComments((list) => list?.filter((x) => x.id !== c.id) ?? list),
      )
      .catch(report)
      .finally(() => setBusy(false));
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
    loading: comments === null,
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
