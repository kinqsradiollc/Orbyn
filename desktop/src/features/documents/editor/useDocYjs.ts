import { useEffect, useMemo, useRef } from "react";
import * as Y from "yjs";
import type { DocBlock } from "@orbyn/core";
import {
  blocksToYDoc,
  yDocToBlocks,
  loadBlocks,
  insertBlock,
  patchBlock,
  yTextOf,
  applyYUpdate,
  encodeYDoc,
} from "@orbyn/core";

/**
 * The flag that turns the CRDT path on. Off everywhere until the rollout
 * says otherwise: unset, or `0`, means the editor runs exactly as it did.
 */
export const docCrdtEnabled = () =>
  typeof import.meta.env?.VITE_DOC_CRDT === "string"
    ? import.meta.env.VITE_DOC_CRDT !== "0" &&
      import.meta.env.VITE_DOC_CRDT !== ""
    : false;

/**
 * The page as a CRDT, live (behind the doc-crdt flag).
 *
 * The editor holds its own `Y.Doc`, grown from the server's copy of the
 * page. Typing goes straight into the CRDT — at the character, not by
 * whole-line replacement — and every batch of local updates is pushed to
 * the log; updates from other editors arrive on the same page's stream
 * and are folded in as they land. Saves to the plain blocks the server
 * stores continue exactly as before: this hook only says *when* the
 * content has changed, and hands over the merged blocks to save.
 *
 * Nothing here replaces the editor's React state; the hook keeps a
 * mirror (`blocks`) that the editor reads on each CRDT change, the same
 * way it reads a fetched copy today.
 */
export function useDocYjs(
  doc: { id: string; version: number; content?: DocBlock[] | null },
  client: {
    sendDocUpdates: (id: string, updates: string[]) => Promise<void>;
    watchDoc: (
      id: string,
      onChange: (version: number, news: unknown) => void,
      onUpdate?: (update: string, seq: number, by: string) => void,
    ) => () => void;
  },
  /** The editor's own id, so it can skip its own echo. */
  editorId: string,
  /** Called with the merged blocks whenever the CRDT moves on. */
  onRemoteChange: (blocks: DocBlock[]) => void,
) {
  const ydoc = useMemo(() => new Y.Doc(), [doc.id]);
  const loaded = useRef(false);
  const pending = useRef<string[]>([]);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed from the fetched copy, once per page. Later fetches of the same
  // page (a refetch after save) fold in with their version, so a stale
  // copy cannot wind the CRDT back.
  useEffect(() => {
    if (loaded.current) {
      if (doc.content) loadBlocks(ydoc, doc.content, doc.version);
      return;
    }
    loaded.current = true;
    if (doc.content?.length) {
      const seed = blocksToYDoc(doc.content);
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(seed), "seed");
    }
  }, [doc.id, doc.version, doc.content, ydoc]);

  // Follow the page's stream: binary updates from other editors fold in
  // as they land, and each one says so through `onRemoteChange`.
  useEffect(() => {
    const stop = client.watchDoc(
      doc.id,
      () => {}, // version news is handled by the editor's own watcher
      (update, _seq, by) => {
        if (by === editorId) return;
        try {
          applyYUpdate(
            ydoc,
            new Uint8Array(
              atob(update)
                .split("")
                .map((ch) => ch.charCodeAt(0)),
            ),
          );
          onRemoteChange(yDocToBlocks(ydoc));
        } catch {
          // A bad row is skipped; the next full fold corrects us.
        }
      },
    );
    return stop;
  }, [client, doc.id, editorId, ydoc, onRemoteChange]);

  /** Flush the pending local updates to the log. */
  const flush = () => {
    if (!pending.current.length) return;
    const batch = pending.current;
    pending.current = [];
    void client.sendDocUpdates(doc.id, batch).catch(() => {
      // Lost updates are not fatal: the next save reconciles through the
      // server's blocks, as it does today.
    });
  };

  /** The words of a line, for typing into at the character. */
  const textOf = (id: string) => yTextOf(ydoc, id);

  /** Type into a line: replace [from, to) with the given words. */
  const typeInto = (id: string, from: number, to: number, insert: string) => {
    const text = yTextOf(ydoc, id);
    if (!text) return;
    text.delete(from, to - from);
    if (insert) text.insert(from, insert);
    queuePush();
  };

  /** Add a line at `index` and return its id. */
  const addBlock = (index: number, block: DocBlock) => {
    const id = insertBlock(ydoc, index, block);
    queuePush();
    return id;
  };

  /** Change one thing about a line — a tick, a kind, an indent. */
  const patch = (id: string, part: Partial<DocBlock>) => {
    patchBlock(ydoc, id, part);
    queuePush();
  };

  /** The page as it stands in the CRDT, for saving and for rendering. */
  const blocks = () => yDocToBlocks(ydoc);

  function queuePush() {
    pending.current.push(btoa(String.fromCharCode(...encodeYDoc(ydoc))));
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(flush, 150);
  }

  useEffect(
    () => () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      flush();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.id],
  );

  return { textOf, typeInto, addBlock, patch, blocks };
}
