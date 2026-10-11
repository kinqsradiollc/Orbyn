import { blocksHtml, parseDoc, serializeDoc } from "@orbyn/core";
import type { ToolResult } from "../../capabilities/execute.js";
import type { Principal } from "../../capabilities/policy.js";
import { registry } from "../../capabilities/index.js";

/** Build only from the authorized result already delivered; no extra source reads. */
export function withResultPreview(
  result: ToolResult,
  principal: Principal,
): ToolResult {
  const value = result.structuredContent;
  if (result.isError || !value) return result;
  if (Array.isArray(value.done) || typeof value.job === "string") {
    result = {
      ...result,
      _meta: {
        ...result._meta,
        "orbyn/receipt": {
          canUndo: registry.for(principal).some((cap) => cap.name === "undo"),
        },
      },
    };
  }
  const metadata = value.metadata as Record<string, unknown> | undefined;
  if (metadata?.type !== "doc" || typeof value.text !== "string") return result;
  // fetch already bounds each page; retain its pagination and source text as-is.
  const parsed = parseDoc(value.text, { anchors: true });
  const blocks: typeof parsed = [];
  let size = 0;
  for (const block of parsed) {
    const length = serializeDoc([block]).length;
    if (size + length > 60000) break;
    blocks.push(block);
    size += length;
  }
  const locallyClipped = blocks.length < parsed.length;
  const anchored = blocks.filter(
    (block) => block.id && /^b[\w-]{1,63}$/.test(block.id),
  );
  const editable =
    !locallyClipped &&
    registry.for(principal).some((cap) => cap.name === "edit_doc");
  return {
    ...result,
    _meta: {
      ...result._meta,
      "orbyn/document-preview": {
        html: blocksHtml(blocks, {
          diagramSources: true,
          fileUrl: () => null,
          linkUrl: (href) => (/^https:\/\/[^\s]+$/.test(href) ? href : null),
        }),
        id: value.id,
        version: metadata.version,
        editable,
        truncated: metadata.truncated === true || locallyClipped,
        paginated: metadata.truncated === true,
        locallyClipped,
        editListLimited: anchored.length > 100,
        nextBlock:
          typeof metadata.next_block === "string" ? metadata.next_block : null,
        lines: anchored.slice(0, 100).map((block) => ({
          anchor: block.id,
          markdown: serializeDoc([block]),
        })),
      },
    },
  };
}
