import { versionedDocSource } from "@orbyn/core";
import { parseBackup, type Backup } from "./backup";

export type DraftCopyFile =
  | {
      kind: "markdown";
      extension: "md";
      type: "text/markdown;charset=utf-8";
      text: string;
    }
  | {
      kind: "snapshot";
      extension: "orbyn-draft.json";
      type: "application/json";
      text: string;
    };

/** Markdown is offered only when its round trip preserves the stored document. */
export function draftCopyFile(
  backup: Backup,
  userId: string,
  docId: string,
): DraftCopyFile {
  const draft = parseBackup(backup);
  if (!userId || !docId)
    throw new Error("Open your account and page before saving a draft copy.");
  try {
    return {
      kind: "markdown",
      extension: "md",
      type: "text/markdown;charset=utf-8",
      text:
        draft.source ?? versionedDocSource(draft.document, { projected: true }),
    };
  } catch (failure) {
    // Validation and unrelated serialization failures must remain visible.
    if (
      !(failure instanceof Error) ||
      failure.message !==
        "Markdown source cannot preserve this document structure."
    )
      throw failure;
    return {
      kind: "snapshot",
      extension: "orbyn-draft.json",
      type: "application/json",
      text: JSON.stringify(
        { kind: "orbyn-page-draft", version: 1, userId, docId, draft },
        null,
        2,
      ),
    };
  }
}

/** A snapshot can only become a review offer for its original account and page. */
export function readDraftCopy(
  raw: string,
  userId: string,
  docId: string,
): Backup {
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("kind" in value) ||
    value.kind !== "orbyn-page-draft" ||
    !("version" in value) ||
    value.version !== 1 ||
    !("userId" in value) ||
    !userId ||
    value.userId !== userId ||
    !("docId" in value) ||
    !docId ||
    value.docId !== docId ||
    !("draft" in value)
  )
    throw new Error(
      "This draft copy doesn't match this account and page, or its format isn't supported.",
    );
  return parseBackup(value.draft);
}
