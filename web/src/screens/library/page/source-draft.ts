import {
  parseVersionedDocContent,
  versionedDocContentKey,
  type VersionedDocContent,
} from "@orbyn/core";
import { leafList } from "./tree";

export type LatexSourceSelector =
  | { kind: "whole" }
  | { kind: "block"; id: string }
  | { kind: "legacy"; ordinal: number; path: number[] };

export type LatexSourceDraft = {
  schema: 1;
  id: string;
  userId: string;
  docId: string;
  selector: LatexSourceSelector;
  base: VersionedDocContent;
  version: number;
  raw: string;
  at: string;
};

type Stored = { ok: true } | { ok: false; error: string };
const prefix = (userId: string, docId: string) =>
  `orbyn-page-source-draft:${encodeURIComponent(userId)}:${encodeURIComponent(docId)}:latex:`;
const selectorKey = (selector: LatexSourceSelector) =>
  selector.kind === "whole"
    ? "whole"
    : selector.kind === "block"
      ? `block-${encodeURIComponent(selector.id)}`
      : `legacy-${selector.ordinal}`;
const key = (draft: LatexSourceDraft) =>
  `${prefix(draft.userId, draft.docId)}${selectorKey(draft.selector)}:${draft.id}`;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse(value: unknown): LatexSourceDraft {
  if (
    !object(value) ||
    value.schema !== 1 ||
    typeof value.id !== "string" ||
    !uuid.test(value.id) ||
    typeof value.userId !== "string" ||
    !value.userId ||
    typeof value.docId !== "string" ||
    !value.docId ||
    typeof value.raw !== "string" ||
    typeof value.at !== "string" ||
    !Number.isFinite(Date.parse(value.at)) ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    !object(value.selector)
  )
    throw new Error("Invalid source recovery record.");
  const selected = value.selector;
  let selector: LatexSourceSelector;
  if (selected.kind === "whole") selector = { kind: "whole" };
  else if (
    selected.kind === "block" &&
    typeof selected.id === "string" &&
    selected.id.length > 0
  )
    selector = { kind: "block", id: selected.id };
  else if (
    selected.kind === "legacy" &&
    typeof selected.ordinal === "number" &&
    Number.isSafeInteger(selected.ordinal) &&
    selected.ordinal >= 0 &&
    Array.isArray(selected.path) &&
    selected.path.length > 0 &&
    selected.path.every((index) => Number.isSafeInteger(index) && index >= 0)
  )
    selector = {
      kind: "legacy",
      ordinal: selected.ordinal,
      path: [...selected.path],
    };
  else throw new Error("Invalid source selection.");
  return {
    schema: 1,
    id: value.id,
    userId: value.userId,
    docId: value.docId,
    selector,
    base: parseVersionedDocContent(value.base, { projected: true }),
    version: value.version,
    raw: value.raw,
    at: value.at,
  };
}

export function readSourceDrafts(userId: string, docId: string) {
  const drafts: LatexSourceDraft[] = [];
  let error = "";
  try {
    const start = prefix(userId, docId);
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index);
      if (!name?.startsWith(start)) continue;
      try {
        const draft = parse(JSON.parse(localStorage.getItem(name) ?? "null"));
        if (
          draft.userId !== userId ||
          draft.docId !== docId ||
          key(draft) !== name
        )
          throw new Error("Source recovery owner mismatch.");
        drafts.push(draft);
      } catch {
        // Preserve unreadable records so inspection never destroys recovery data.
        error = "Some source recovery copies couldn't be read on this device.";
      }
    }
  } catch {
    error = "Source recovery couldn't be checked on this device.";
  }
  return { drafts: drafts.sort((a, b) => b.at.localeCompare(a.at)), error };
}

export function writeSourceDraft(draft: LatexSourceDraft): Stored {
  try {
    localStorage.setItem(key(draft), JSON.stringify(draft));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        "This source is only in this view. Save a source copy before leaving.",
    };
  }
}

export function removeSourceDraft(draft: LatexSourceDraft): Stored {
  try {
    const name = key(draft);
    const previous = localStorage.getItem(name);
    if (previous) {
      const saved = parse(JSON.parse(previous));
      if (saved.at !== draft.at || saved.raw !== draft.raw)
        return {
          ok: false,
          error:
            "This recovery copy changed in another tab. Reopen it before discarding.",
        };
    }
    localStorage.removeItem(name);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "The source recovery copy couldn't be removed from this device.",
    };
  }
}

export function latexSourceSelector(
  document: VersionedDocContent,
  ordinal: number,
): LatexSourceSelector {
  if (ordinal < 0) return { kind: "whole" };
  const leaf = leafList(document).filter(
    ({ block }) => block.type === "code" && block.lang === "latex-document",
  )[ordinal];
  if (!leaf) throw new Error("This LaTeX note is no longer available.");
  return leaf.block.id
    ? { kind: "block", id: leaf.block.id }
    : { kind: "legacy", ordinal, path: [...leaf.path] };
}

export function sameSourceBase(
  draft: LatexSourceDraft,
  document: VersionedDocContent,
) {
  return (
    versionedDocContentKey(draft.base, { projected: true }) ===
    versionedDocContentKey(document, { projected: true })
  );
}

export function sourceOrdinal(
  selector: LatexSourceSelector,
  document: VersionedDocContent,
): number | null {
  if (selector.kind === "whole") return -1;
  const leaves = leafList(document).filter(
    ({ block }) => block.type === "code" && block.lang === "latex-document",
  );
  if (selector.kind === "block") {
    const index = leaves.findIndex(({ block }) => block.id === selector.id);
    return index < 0 ? null : index;
  }
  const leaf = leaves[selector.ordinal];
  return leaf &&
    leaf.path.join("/") === selector.path.join("/") &&
    !leaf.block.id
    ? selector.ordinal
    : null;
}
