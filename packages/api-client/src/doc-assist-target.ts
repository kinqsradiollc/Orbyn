import {
  docContainerBlocks,
  docEditorSessionDirty,
  type DocBlock,
} from "@orbyn/core";
import type { DocEditorStore } from "./doc-editor-store.js";
import type { OrbynClient } from "./client.js";

/** Name a saved passage before requesting a proposal; never guess a duplicate's position. */
export async function prepareDocAssistTarget(
  store: Pick<DocEditorStore, "state" | "refresh">,
  client: Pick<OrbynClient, "anchorLine">,
  docId: string,
  target: DocBlock,
  isCurrent: () => boolean,
): Promise<DocBlock & { id: string; text: string }> {
  const saved = () => {
    const state = store.state,
      session = state.session;
    if (
      !isCurrent() ||
      !session ||
      state.busy ||
      state.error ||
      state.conflict ||
      state.source !== null ||
      state.sourceInvalid ||
      docEditorSessionDirty(session)
    )
      throw new Error("Save or resolve your draft before asking for changes.");
    return session.document.format === 2
      ? docContainerBlocks(session.document.nodes, { projected: true })
      : session.document.blocks;
  };
  if (!("text" in target) || !target.text.trim())
    throw new Error("Select some text before asking the assistant.");
  const blocks = saved();
  const version = store.state.session!.saved.version;
  const index = target.id
    ? blocks.findIndex((block) => block.id === target.id)
    : blocks.indexOf(target);
  const selected = blocks[index];
  if (!selected || !("text" in selected) || selected.text !== target.text)
    throw new Error(
      "The selected text changed. Select it again before asking.",
    );
  const id =
    target.id ??
    (await client.anchorLine(docId, index, target.text, version)).block_id;
  if (!isCurrent())
    throw new Error("The account or page changed. Reopen this request.");
  if (!target.id) {
    // A local edit that arrived while naming the passage must not be overwritten.
    saved();
    await store.refresh();
  }
  const current = saved().find((block) => block.id === id);
  if (!current || !("text" in current) || current.text !== target.text)
    throw new Error(
      "The selected text changed. Select it again before asking.",
    );
  return { ...current, id, text: current.text };
}
