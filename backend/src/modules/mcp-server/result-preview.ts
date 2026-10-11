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
  const source = value.text.slice(0, 60000);
  const blocks = parseDoc(source, { anchors: true });
  const editable = registry
    .for(principal)
    .some((cap) => cap.name === "edit_doc");
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
        truncated: metadata.truncated === true,
        lines: blocks
          .filter((block) => block.id && /^b[\w-]{1,63}$/.test(block.id))
          .slice(0, 100)
          .map((block) => ({
            anchor: block.id,
            markdown: serializeDoc([block]),
          })),
      },
    },
  };
}
