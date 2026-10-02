import type { DocBlock } from "./docs.js";

export type DocExportDraft = { id: string; title: string; content: DocBlock[] };
export type DocExportSnapshot = DocExportDraft & { version: number };

/** Abort a file action when its owning editor/account has changed or closed. */
export function assertDocExportActive(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw Object.assign(new Error("Document export was cancelled."), {
      name: "AbortError",
    });
}

const ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, ordered(v)]),
    );
  return value;
};

/** Structural content equality permits IDs assigned by the server to previously unnamed blocks. */
export function docExportMatches(
  draft: DocExportDraft,
  saved: DocExportSnapshot,
): boolean {
  if (draft.id !== saved.id || draft.title !== saved.title) return false;
  // The editor draws one empty unnamed paragraph when a saved page has no blocks.
  if (
    !saved.content.length &&
    draft.content.length === 1 &&
    draft.content[0].type === "paragraph" &&
    draft.content[0].text === "" &&
    Object.keys(draft.content[0]).every(
      (key) => key === "type" || key === "text",
    )
  )
    return true;
  if (draft.content.length !== saved.content.length) return false;
  return draft.content.every((block, index) => {
    const confirmed = saved.content[index];
    const local = { ...block },
      remote = { ...confirmed };
    if (local.id === undefined) {
      delete local.id;
      delete remote.id;
    }
    return JSON.stringify(ordered(local)) === JSON.stringify(ordered(remote));
  });
}

/** Flush once and require server-confirmed content; failed/offline saves never authorize a stale export. */
export async function prepareDocExport({
  flush,
  current,
  saved,
  editable,
  signal,
}: {
  flush: () => Promise<void>;
  current: () => DocExportDraft;
  saved: () => DocExportSnapshot;
  editable: boolean;
  signal: AbortSignal;
}): Promise<number> {
  assertDocExportActive(signal);
  await flush();
  assertDocExportActive(signal);
  const confirmed = saved();
  if (
    !Number.isSafeInteger(confirmed.version) ||
    confirmed.version < 1 ||
    current().id !== confirmed.id ||
    (editable && !docExportMatches(current(), confirmed))
  )
    throw new Error("This page has unsaved changes. Save it before exporting.");
  return confirmed.version;
}
