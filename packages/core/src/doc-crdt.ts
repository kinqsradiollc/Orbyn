import * as Y from "yjs";
import { newBlockId, type DocBlock } from "./docs.js";

/**
 * The page as a CRDT (Yjs), the shape live editing converges on.
 *
 * A page is an ordered list of lines, each with a kind and its own words.
 * In the CRDT the order is one shared sequence (`order`), and each line is
 * a map keyed by its block id (`blocks`) whose words are a `Y.Text` — so
 * two people typing into the same line both land, character for character,
 * while lines added at the same moment by different editors all survive.
 *
 * The mapping is deliberately total: every `DocBlock` round-trips, so the
 * CRDT stays a second view of the same document the server stores, not a
 * rival one. Blocks without an id are given one on the way in; ids are how
 * comments, suggestions and tasks keep pointing at the same line.
 */

const ORDER = "order";
const BLOCKS = "blocks";

/** Where the line's words live in its map, as character-level text. */
const TEXT = "text";

/** Fields a line carries besides its kind, words and id. */
const FIELDS = [
  "level",
  "done",
  "lang",
  "kind",
  "folded",
  "check",
  "width",
  "file",
  "label",
  "start",
  "depth",
] as const;

type Field = (typeof FIELDS)[number];

/** The id of each line, in page order — creating it if absent. Only for
 * local writes on a document that is already the page's own (seeded from
 * the server's copy): a replica that creates containers before the first
 * sync races the genesis update for the same root keys, and the loser's
 * contents vanish. Reads go through `orderOf`'s read-only siblings. */
const orderOf = (doc: Y.Doc): Y.Array<string> => {
  const root = doc.getMap("doc");
  let order = root.get(ORDER) as Y.Array<string> | undefined;
  if (!order) {
    order = new Y.Array<string>();
    root.set(ORDER, order);
  }
  return order;
};

/** The page's order as it stands, or null when this document has none
 * yet — what a pure reader (or a replica waiting for its seed) wants. */
const orderView = (doc: Y.Doc): Y.Array<string> | null =>
  (doc.getMap("doc").get(ORDER) as Y.Array<string> | undefined) ?? null;

/** Each line's own map, keyed by block id — creating it if absent. As
 * with `orderOf`: local writes on a seeded document only. */
const blocksOf = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => {
  const root = doc.getMap("doc");
  let blocks = root.get(BLOCKS) as Y.Map<Y.Map<unknown>> | undefined;
  if (!blocks) {
    blocks = new Y.Map();
    root.set(BLOCKS, blocks);
  }
  return blocks;
};

/** The lines as they stand, or null before the first seed. */
const blocksView = (doc: Y.Doc): Y.Map<Y.Map<unknown>> | null =>
  (doc.getMap("doc").get(BLOCKS) as Y.Map<Y.Map<unknown>> | undefined) ?? null;

/**
 * The ids the server has been known to hold. A fold that stops sending an
 * id on this list means the line was deleted elsewhere; an id missing from
 * both this list and the fold is a line typed here that was never saved,
 * and survives.
 */
const seenOf = (doc: Y.Doc): Y.Map<true> => {
  const root = doc.getMap("doc");
  let seen = root.get("seen") as Y.Map<true> | undefined;
  if (!seen) {
    seen = new Y.Map();
    root.set("seen", seen);
  }
  return seen;
};

/**
 * Replace the words in a line's map, keeping the `Y.Text` object itself so
 * character-level edits anyone has already merged with stay meaningful.
 * Only the stretch that actually changed is rewritten.
 */
function setText(map: Y.Map<unknown>, text: string): void {
  const live = map.get(TEXT);
  if (!(live instanceof Y.Text)) {
    map.set(TEXT, new Y.Text(text));
    return;
  }
  const old = live.toString();
  if (old === text) return;
  let start = 0;
  const max = Math.min(old.length, text.length);
  while (start < max && old[start] === text[start]) start++;
  let endOld = old.length;
  let endNew = text.length;
  while (
    endOld > start &&
    endNew > start &&
    old[endOld - 1] === text[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }
  if (endOld > start) live.delete(start, endOld - start);
  if (endNew > start) live.insert(start, text.slice(start, endNew));
}

/** Write a line — whole, from the server, or a patch typed here — into
 * its map. Only what differs is written: re-asserting a value the line
 * already has would race a concurrent change to it, and the race is
 * resolved by client id rather than by sense. A `full` fill is the whole
 * line as the server holds it, so absent fields mean removal; a patch
 * speaks only for the keys it carries. */
function fill(
  map: Y.Map<unknown>,
  block: Partial<DocBlock>,
  full: boolean,
): void {
  const any = block as Record<string, unknown>;
  if (block.type !== undefined && map.get("type") !== block.type)
    map.set("type", block.type);
  if (any.text !== undefined) setText(map, any.text as string);
  else if (full && map.get(TEXT) !== undefined) map.delete(TEXT);
  for (const field of FIELDS) {
    const value = any[field];
    if (field in block) {
      if (map.get(field) !== value) map.set(field, value);
    } else if (full && map.get(field) !== undefined) map.delete(field);
  }
}

/** Read one line back out of its map. */
function read(id: string, map: Y.Map<unknown>): DocBlock {
  const block: Record<string, unknown> = {
    id,
    type: map.get("type") as DocBlock["type"],
  };
  const text = map.get(TEXT);
  if (text instanceof Y.Text) block.text = text.toString();
  for (const field of FIELDS) {
    const value = map.get(field);
    if (value !== undefined) block[field] = value;
  }
  return block as DocBlock;
}

/** Give every line a name, so the CRDT and everything anchored to it can. */
const withIds = (blocks: readonly DocBlock[]): DocBlock[] =>
  blocks.map((block) => (block.id ? block : { ...block, id: newBlockId() }));

/**
 * The page's blocks as a fresh CRDT document. This is the shape a server
 * snapshot takes: whoever forks from its update stream inherits the `seen`
 * ledger below, and so can tell a line the server deleted from one that
 * was typed here and never saved.
 */
export function blocksToYDoc(blocks: readonly DocBlock[]): Y.Doc {
  const doc = new Y.Doc();
  const lines = withIds(blocks);
  doc.transact(() => {
    const order = orderOf(doc);
    const blocks = blocksOf(doc);
    const seen = seenOf(doc);
    lines.forEach((block, index) => {
      const id = block.id as string;
      const map = new Y.Map();
      blocks.set(id, map);
      fill(map, block, true);
      order.insert(index, [id]);
      seen.set(id, true);
    });
  });
  return doc;
}

/**
 * Fold a copy of the page that came from the server into a live CRDT
 * document, changing only what differs. Lines both sides have keep their
 * `Y.Text` (only the changed stretch of words is rewritten) and take the
 * server's order; a line the server once held and no longer sends was
 * deleted elsewhere, and goes; a line typed here that the server has never
 * saved stays, slotted in where it was typed. Nothing typed is dropped.
 *
 * Pass the copy's `version` when you know it: a fold no newer than the
 * last one folded is skipped outright, so a stale copy (a save that raced
 * a deletion, a refetch of an older state) cannot resurrect a line that
 * was deleted here. Unversioned folds always apply.
 */
export function loadBlocks(
  doc: Y.Doc,
  incoming: readonly DocBlock[],
  version?: number,
): void {
  const root = doc.getMap("doc");
  if (version !== undefined) {
    const folded = (root.get("foldedAt") as number | undefined) ?? 0;
    if (version <= folded) return;
    root.set("foldedAt", version);
  }
  const lines = withIds(incoming);
  doc.transact(() => {
    const order = orderOf(doc);
    const blocks = blocksOf(doc);
    const seen = seenOf(doc);
    const serverIds = new Set(lines.map((b) => b.id as string));

    // Gone elsewhere: everything the ledger remembers that the server no
    // longer sends, whether or not it is on this page's screen.
    for (const id of [...seen.keys()]) {
      if (!serverIds.has(id)) {
        let at: number;
        while ((at = order.toArray().indexOf(id)) >= 0) order.delete(at, 1);
        blocks.delete(id);
        seen.delete(id);
      }
    }

    for (const block of lines) {
      const id = block.id as string;
      let map = blocks.get(id);
      if (!map) {
        map = new Y.Map();
        blocks.set(id, map);
      }
      fill(map, block, true);
      if (!seen.get(id)) seen.set(id, true);
    }
    // Orphaned maps — leftovers with no line pointing at them — go, so
    // they don't resurface at compaction.
    for (const id of [...blocks.keys()]) {
      if (!serverIds.has(id) && !order.toArray().includes(id))
        blocks.delete(id);
    }

    // The order the page should now read: the server's lines in its
    // sequence, with each locally-unsaved line kept just after the server
    // line it followed (or at the top, if it preceded them all).
    const current = order.toArray();
    const strays = new Map<string | null, string[]>();
    let after: string | null = null;
    for (const id of current) {
      if (serverIds.has(id)) after = id;
      else {
        const held = strays.get(after) ?? [];
        held.push(id);
        strays.set(after, held);
      }
    }
    const wanted: string[] = [...(strays.get(null) ?? [])];
    for (const id of lines.map((b) => b.id as string))
      wanted.push(id, ...(strays.get(id) ?? []));

    // Move the live order onto it. Everything below `want` is still
    // unplaced, so lifting a line to `want` — removing it from wherever it
    // sits first — is right whether it came from ahead or behind.
    const placed = [...current];
    for (let want = 0; want < wanted.length; want++) {
      const id = wanted[want];
      const at = placed.indexOf(id);
      if (at === want) continue;
      if (at >= 0) {
        order.delete(at, 1);
        placed.splice(at, 1);
      }
      order.insert(want, [id]);
      placed.splice(want, 0, id);
    }
    // Anything still unplaced was a stray the loop above already filed;
    // by construction there is none, but a stale duplicate would linger.
    for (let i = placed.length - 1; i >= wanted.length; i--) {
      order.delete(i, 1);
      placed.splice(i, 1);
    }
  });
}

/**
 * A page's CRDT document back into the plain blocks the server stores.
 * Reads nothing into the document: a viewer that has not been seeded yet
 * simply sees an empty page, rather than racing the seed for the root.
 */
export function yDocToBlocks(doc: Y.Doc): DocBlock[] {
  const order = orderView(doc);
  const blocks = blocksView(doc);
  const out: DocBlock[] = [];
  if (!order || !blocks) return out;
  for (const id of order) {
    const map = blocks.get(id);
    if (map) out.push(read(id, map));
  }
  return out;
}

/**
 * A line's words as live `Y.Text`, for typing into directly. This is how
 * an editor writes: at the character, in place — not by handing the whole
 * line back, which would clobber whoever else was typing in it.
 */
export function yTextOf(doc: Y.Doc, id: string): Y.Text | null {
  const text = blocksView(doc)?.get(id)?.get(TEXT);
  return text instanceof Y.Text ? text : null;
}

/**
 * Type a new line in at `index`. Unlike a fold, this does not mark the
 * line as server-known: until its own save comes back, a fold must leave
 * it alone rather than treat its absence as a deletion elsewhere.
 * Returns the line's id (given one if it arrived without).
 */
export function insertBlock(
  doc: Y.Doc,
  index: number,
  block: DocBlock,
): string {
  const id = block.id ?? newBlockId();
  doc.transact(() => {
    const map = new Y.Map();
    blocksOf(doc).set(id, map);
    fill(map, { ...block, id }, true);
    orderOf(doc).insert(Math.min(index, orderOf(doc).length), [id]);
  });
  return id;
}

/**
 * Change one thing about a line — a tick, a kind, an indentation — the
 * way an editor does, without touching its neighbours or its words.
 */
export function patchBlock(
  doc: Y.Doc,
  id: string,
  patch: Partial<DocBlock>,
): void {
  const map = blocksOf(doc).get(id);
  if (!map) return;
  doc.transact(() => fill(map, patch, false));
}

/** The document's whole state, as one binary update to send or store. */
export const encodeYDoc = (doc: Y.Doc): Uint8Array =>
  Y.encodeStateAsUpdate(doc);

/** The part of the document one reader has yet to see, for catching up. */
export const yStateVector = (doc: Y.Doc): Uint8Array =>
  Y.encodeStateVector(doc);

/** The updates since a vector, without holding the whole document. */
export const yUpdatesSince = (doc: Y.Doc, vector: Uint8Array): Uint8Array =>
  Y.encodeStateAsUpdate(doc, vector);

/** Fold a binary update from elsewhere into this document. */
export function applyYUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}

/** One update out of two, for a server or a log that keeps both. */
export const mergeYUpdates = (a: Uint8Array, b: Uint8Array): Uint8Array =>
  Y.mergeUpdates([a, b]);
