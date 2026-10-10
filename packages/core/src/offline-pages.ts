import { mergeDocs, type Doc, type DocBlock } from "./docs.js";
import { docContainerBlocks } from "./doc-containers.js";
import {
  parseVersionedDocContent,
  versionedDocContentKey,
  type VersionedDocContent,
} from "./doc-content-format.js";
import {
  mergeVersionedDocContent,
  DocContentMergeConflict,
} from "./doc-content-merge.js";

/** Validate a complete cached owner and its authorized flat projection together. */
function ownedDocument(value: {
  content: DocBlock[];
  document?: VersionedDocContent;
}): VersionedDocContent {
  const options = { projected: true };
  const document = parseVersionedDocContent(
    value.document === undefined
      ? { format: 1, blocks: value.content }
      : value.document,
    options,
  );
  const blocks =
    document.format === 1
      ? document.blocks
      : docContainerBlocks(document.nodes, options);
  if (
    versionedDocContentKey({ format: 1, blocks }, options) !==
    versionedDocContentKey({ format: 1, blocks: value.content }, options)
  )
    throw new Error(
      "The offline page projection does not match its complete content.",
    );
  return document;
}

/**
 * Pages on a phone with no signal (SHR-03).
 *
 * The phone keeps the pages opened last, so they open with no connection,
 * and keeps an edit made offline until it can be sent. When it is sent the
 * page may have moved on elsewhere; the edit is folded into the newer copy
 * line by line (`mergeDocs`), the same way two people typing at once are,
 * so nothing either side wrote is lost.
 *
 * This is the pure part: what is kept, in what order, and how a kept edit
 * meets the page as it is now. Storage and sending are the app's.
 */

/** How many pages a phone keeps to open offline. */
export const PAGE_CACHE_SIZE = 20;

/** A kept page is shown for up to 30 days; older ones are reloaded first. */
export const PAGE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Bump when a kept page's shape changes, so old ones are dropped. */
export const PAGE_CACHE_VERSION = 1;

export type CachedPage = { doc: Doc; opened_at: number };

type Envelope = { v: number; pages: CachedPage[] };

const looksLikeDoc = (d: unknown): d is Doc =>
  !!d &&
  typeof d === "object" &&
  typeof (d as Doc).id === "string" &&
  typeof (d as Doc).title === "string" &&
  typeof (d as Doc).version === "number" &&
  Array.isArray((d as Doc).content);

/** The kept pages as stored, newest first. */
export const encodePageCache = (pages: CachedPage[]) =>
  JSON.stringify({ v: PAGE_CACHE_VERSION, pages } satisfies Envelope);

/**
 * Read the kept pages back, dropping anything corrupt, from another version
 * of the app, or too old to trust.
 */
export function decodePageCache(
  raw: string | null | undefined,
  now = Date.now(),
): CachedPage[] {
  if (!raw) return [];
  try {
    const env = JSON.parse(raw) as Partial<Envelope>;
    if (env.v !== PAGE_CACHE_VERSION || !Array.isArray(env.pages)) return [];
    return env.pages
      .filter(
        (p) =>
          p &&
          typeof p.opened_at === "number" &&
          now - p.opened_at <= PAGE_CACHE_MAX_AGE_MS &&
          looksLikeDoc(p.doc),
      )
      .filter((p) => {
        if (p.doc.document === undefined) return true;
        try {
          ownedDocument(p.doc);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, PAGE_CACHE_SIZE);
  } catch {
    return [];
  }
}

/**
 * A page was opened or saved: it leads the kept list, and the oldest past
 * the limit is let go. A page in Trash is not kept.
 */
export function keepPage(
  pages: CachedPage[],
  doc: Doc,
  now = Date.now(),
  size = PAGE_CACHE_SIZE,
): CachedPage[] {
  const rest = pages.filter((p) => p.doc.id !== doc.id);
  if ((doc as Doc & { deleted_at?: string | null }).deleted_at) return rest;
  return [{ doc, opened_at: now }, ...rest].slice(0, size);
}

/** Forget a page (deleted, or no longer shared with this person). */
export const dropPage = (pages: CachedPage[], id: string) =>
  pages.filter((p) => p.doc.id !== id);

/**
 * Keep only team pages from teams the person is still in (left, or removed
 * from, a team: its pages go). Their own pages stay.
 */
export const keepTeamPages = (
  pages: CachedPage[],
  teamIds: Iterable<string>,
) => {
  const mine = new Set(teamIds);
  return pages.filter((p) => !p.doc.team_id || mine.has(p.doc.team_id));
};

export const cachedPage = (pages: CachedPage[], id: string) =>
  pages.find((p) => p.doc.id === id)?.doc ?? null;

// ------------------------------------------------------------ saves offline

/** An edit to a page kept on the phone until it can be sent. */
export type PageSave = {
  id: string;
  title: string;
  content: DocBlock[];
  document?: VersionedDocContent;
  /** The page as it was when the edit began: what "changed" is measured from. */
  base: {
    version: number;
    title: string;
    content: DocBlock[];
    document?: VersionedDocContent;
  };
};

/**
 * Another edit to a page that already has one waiting: the waiting one takes
 * the newer words but keeps its start, so the edit is measured from where it
 * really began.
 */
export function combinePageSaves(earlier: PageSave, later: PageSave): PageSave {
  if (earlier.id !== later.id)
    throw new Error("Cannot combine edits from different pages.");
  if (!!earlier.document !== !!later.document)
    throw new Error("Cannot combine different offline editor protocols.");
  return { ...later, base: earlier.base };
}

/**
 * What to send for a kept edit, given the page as the server has it now.
 * Unchanged there since: the edit as it stands. Changed there too: both,
 * line by line, with a line both changed keeping theirs and then this one
 * below it (`conflicts` counts those). The title changed here wins only if
 * it was changed here.
 */
export function resolvePageSave(
  save: PageSave,
  server: Pick<Doc, "version" | "title" | "content" | "document"> & {
    id?: string;
  },
): {
  title: string;
  content: DocBlock[];
  version: number;
  conflicts: number;
  document?: VersionedDocContent;
} {
  if (server.id !== undefined && server.id !== save.id)
    throw new DocContentMergeConflict(
      "The offline edit belongs to another page.",
    );
  if (save.document || save.base.document || server.document?.format === 2) {
    if (!save.document || !save.base.document || !server.document)
      throw new DocContentMergeConflict(
        "The offline edit does not contain complete document ownership.",
      );
    const base = ownedDocument(save.base),
      mine = ownedDocument(save),
      remote = ownedDocument(server);
    if (
      server.version < save.base.version ||
      (server.version === save.base.version &&
        versionedDocContentKey(remote, { projected: true }) !==
          versionedDocContentKey(base, { projected: true }))
    )
      throw new DocContentMergeConflict(
        "The saved page revision does not match the offline edit.",
      );
    if (
      save.title !== save.base.title &&
      server.title !== save.base.title &&
      save.title !== server.title
    )
      throw new DocContentMergeConflict(
        "The page title changed in both copies. Your edit is kept for review.",
      );
    const document = mergeVersionedDocContent(base, mine, remote);
    return {
      title: save.title !== save.base.title ? save.title : server.title,
      content:
        document.format === 1
          ? document.blocks
          : docContainerBlocks(document.nodes, { projected: true }),
      version: server.version,
      conflicts: 0,
      document,
    };
  }
  const title =
    save.title !== save.base.title ? save.title : server.title || save.title;
  if (server.version === save.base.version)
    return {
      title: save.title,
      content: save.content,
      version: server.version,
      conflicts: 0,
    };
  const merge = mergeDocs(save.base.content, save.content, server.content);
  return {
    title,
    content: merge.blocks,
    version: server.version,
    conflicts: merge.conflicts.length,
  };
}

/** The page as the phone should show it: kept, with its waiting edit laid on. */
export function withPendingSave(doc: Doc, save: PageSave | null): Doc {
  if (!save || save.id !== doc.id) return doc;
  if (save.document) {
    const document = ownedDocument(save);
    return { ...doc, title: save.title, content: save.content, document };
  }
  if (doc.document?.format === 2)
    throw new DocContentMergeConflict(
      "A flat offline edit cannot replace nested ownership.",
    );
  return {
    ...doc,
    title: save.title,
    content: save.content,
    ...(doc.document
      ? { document: { format: 1 as const, blocks: save.content } }
      : {}),
  };
}
