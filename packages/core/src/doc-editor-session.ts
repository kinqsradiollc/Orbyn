import {
  DocContentFormatError,
  parseVersionedDocContent,
  versionedDocContentKey,
  type VersionedDocContent,
} from "./doc-content-format.js";
import {
  applyDocContentOperation,
  type DocContentOperation,
} from "./doc-content-operations.js";
import {
  DocContentMergeConflict,
  mergeVersionedDocContent,
} from "./doc-content-merge.js";
import type { DocContainerNode } from "./doc-containers.js";

/** A single authorized page revision, including its complete ownership tree. */
export interface DocEditorRevision {
  id: string;
  version: number;
  title: string;
  document: VersionedDocContent;
}

/** Server baseline and local draft stay separate throughout queued saves. */
export interface DocEditorSession {
  readonly saved: DocEditorRevision;
  readonly title: string;
  readonly document: VersionedDocContent;
}

/** A detached snapshot of exactly what one serialized save sends. */
export type DocEditorSaveTicket = DocEditorRevision;

const key = (value: VersionedDocContent) =>
  versionedDocContentKey(value, { projected: true });

function ownership(value: VersionedDocContent): string {
  const leaf = (block: { type: string; id?: string }) => ({
    type: block.type,
    ...(block.id ? { id: block.id } : {}),
  });
  const tree = (nodes: DocContainerNode[]): unknown[] =>
    nodes.map((node) =>
      node.kind === "block"
        ? { kind: "block", block: leaf(node.block) }
        : node.kind === "quote"
          ? { ...node, children: tree(node.children) }
          : {
              ...node,
              items: node.items.map((item) => ({
                ...item,
                ...(item.checked === undefined ? {} : { checked: false }),
                children: tree(item.children),
              })),
            },
    );
  return JSON.stringify(
    value.format === 1
      ? { format: 1, blocks: value.blocks.map(leaf) }
      : { format: 2, nodes: tree(value.nodes) },
  );
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function revision(value: DocEditorRevision): DocEditorRevision {
  if (
    typeof value.id !== "string" ||
    !value.id ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.title !== "string"
  )
    throw new DocContentFormatError("Invalid editor page revision.");
  return freeze({
    id: value.id,
    version: value.version,
    title: value.title,
    document: parseVersionedDocContent(value.document, { projected: true }),
  });
}

function titleMerge(base: string, mine: string, theirs: string): string {
  if (mine === base || mine === theirs) return theirs;
  if (theirs === base) return mine;
  throw new DocContentMergeConflict(
    "The page title changed in both copies. Keep your draft for review.",
  );
}

/** Open complete ownership without sharing mutable arrays with a network receipt. */
export function openDocEditorSession(
  value: DocEditorRevision,
): DocEditorSession {
  const saved = revision(value);
  return freeze({ saved, title: saved.title, document: saved.document });
}

/** Compare complete ownership, including wrappers, metadata and empty owners. */
export function docEditorSessionDirty(state: DocEditorSession): boolean {
  return (
    state.title !== state.saved.title ||
    key(state.document) !== key(state.saved.document)
  );
}

/** Change the title against the exact rendered draft, preserving its content. */
export function titleDocEditorSession(
  state: DocEditorSession,
  expected: string,
  title: string,
): DocEditorSession {
  if (state.title !== expected || typeof title !== "string")
    throw new DocContentFormatError(
      "The title changed before this edit could be applied.",
    );
  return freeze({ ...state, title });
}

/** Apply a rich-widget command to its exact owner; never infer structure from flat leaves. */
export function editDocEditorSession(
  state: DocEditorSession,
  expected: VersionedDocContent,
  operation: DocContentOperation,
): DocEditorSession {
  return freeze({
    ...state,
    document: applyDocContentOperation(state.document, expected, operation, {
      projected: true,
    }),
  });
}

/** Accept an explicitly parsed Source edit against the owner that produced its buffer. */
export function sourceDocEditorSession(
  state: DocEditorSession,
  expected: VersionedDocContent,
  document: VersionedDocContent,
): DocEditorSession {
  if (key(state.document) !== key(expected))
    throw new DocContentFormatError(
      "The document changed before this source edit could be applied.",
    );
  return freeze({
    ...state,
    document: parseVersionedDocContent(document, { projected: true }),
  });
}

/** Capture immediately before dispatch, after the preceding serialized save has settled. */
export function prepareDocEditorSave(
  state: DocEditorSession,
): DocEditorSaveTicket {
  return revision({
    id: state.saved.id,
    version: state.saved.version,
    title: state.title,
    document: state.document,
  });
}

/**
 * Take an exact save receipt while keeping newer local typing. Server task ticks
 * merge against the sent snapshot, not the older server baseline. A conflicting
 * receipt throws without changing the caller's complete draft or baseline.
 */
export function acceptDocEditorSave(
  state: DocEditorSession,
  ticket: DocEditorSaveTicket,
  value: DocEditorRevision,
): DocEditorSession {
  const sent = revision(ticket);
  const saved = revision(value);
  if (
    sent.id !== state.saved.id ||
    saved.id !== state.saved.id ||
    sent.version !== state.saved.version ||
    saved.version !== sent.version + 1 ||
    ownership(saved.document) !== ownership(sent.document)
  )
    throw new DocContentFormatError(
      "The save receipt does not match this page revision.",
    );
  return freeze({
    saved,
    title: titleMerge(sent.title, state.title, saved.title),
    document: mergeVersionedDocContent(
      sent.document,
      state.document,
      saved.document,
    ),
  });
}

/** Reconcile a newer authorized page; overlapping ownership remains an explicit conflict. */
export function reconcileDocEditorSession(
  state: DocEditorSession,
  value: DocEditorRevision,
): DocEditorSession {
  const saved = revision(value);
  if (saved.id !== state.saved.id)
    throw new DocContentFormatError(
      "The remote revision belongs to a different page.",
    );
  if (saved.version < state.saved.version)
    throw new DocContentFormatError(
      "The remote page revision is older than the editor baseline.",
    );
  if (saved.version === state.saved.version) {
    if (
      saved.title !== state.saved.title ||
      key(saved.document) !== key(state.saved.document)
    )
      throw new DocContentFormatError(
        "The same page revision has conflicting content.",
      );
    return state;
  }
  return freeze({
    saved,
    title: titleMerge(state.saved.title, state.title, saved.title),
    document: mergeVersionedDocContent(
      state.saved.document,
      state.document,
      saved.document,
    ),
  });
}
