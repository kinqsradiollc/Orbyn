import { z } from "zod";
import {
  parseVersionedDocContent,
  type VersionedDocContent,
} from "../documents/doc-content-format.js";
import {
  docContainerBlocks,
  type DocContainerNode,
} from "../documents/doc-containers.js";

export const pagePublicationInput = z
  .object({
    expected_doc_version: z.number().int().positive(),
    expected_revision: z.number().int().nonnegative(),
    block_ids: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(2000)
      .refine((ids) => new Set(ids).size === ids.length),
    mode: z.enum(["snapshot", "live"]),
    expires_at: z.iso.datetime().nullable(),
    consent: z.literal(true),
  })
  .strict();
export type PagePublicationInput = z.input<typeof pagePublicationInput>;
export type PagePublication = {
  revision: number;
  mode: "snapshot" | "live";
  block_ids: string[];
  path: string;
  expires_at: string | null;
  source_version: number;
};

/** Only explicitly selected leaves survive; preserve their remaining container ownership. */
export function selectPublishedBlocks(
  value: unknown,
  ids: readonly string[],
): VersionedDocContent {
  const document = parseVersionedDocContent(value, { projected: true });
  const leaves =
    document.format === 1
      ? document.blocks
      : docContainerBlocks(document.nodes, { projected: true });
  const wanted = new Set(ids),
    seen = new Set<string>();
  for (const block of leaves) {
    if (!block.id || !wanted.has(block.id)) continue;
    if (seen.has(block.id)) throw new Error("Ambiguous published block.");
    seen.add(block.id);
  }
  if (wanted.size !== ids.length || seen.size !== wanted.size)
    throw new Error("Published blocks changed.");
  const keep = (nodes: DocContainerNode[]): DocContainerNode[] =>
    nodes.flatMap<DocContainerNode>((node) => {
      if (node.kind === "block")
        return node.block.id && wanted.has(node.block.id) ? [node] : [];
      if (node.kind === "quote") {
        const children = keep(node.children);
        return children.length ? [{ ...node, children }] : [];
      }
      const items = node.items
        .map((item) => ({ ...item, children: keep(item.children) }))
        .filter((item) => item.children.length);
      return items.length ? [{ ...node, items }] : [];
    });
  return document.format === 1
    ? {
        format: 1,
        blocks: leaves.filter((block) => block.id && wanted.has(block.id)),
      }
    : { format: 2, nodes: keep(document.nodes) };
}
