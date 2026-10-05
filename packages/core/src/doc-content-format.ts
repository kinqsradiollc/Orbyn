import { z } from "zod";
import {
  parseDocContentLeaves,
  type DocContentValidationOptions,
} from "./doc-content-leaves.js";
import {
  parseDoc,
  serializeDoc,
  type CalloutKind,
  type DocBlock,
} from "./docs.js";
import {
  validateDocContainers,
  parseDocContainers,
  serializeDocContainers,
  DocContainerError,
  type DocContainerNode,
  type DocContainerItem,
} from "./doc-containers.js";

/** Content format is independent of the page's optimistic concurrency revision. */
export type DocContentFormat = 1 | 2;
export type VersionedDocContent =
  { format: 1; blocks: DocBlock[] } | { format: 2; nodes: DocContainerNode[] };

/** A refused content conversion must never fall back to an empty or flattened page. */
export class DocContentFormatError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DocContentFormatError("Invalid document content object.");
  return value as Record<string, unknown>;
}
function keys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new DocContentFormatError("Unknown document content field.");
}
function leaves(
  value: unknown,
  options: DocContentValidationOptions,
): DocBlock[] {
  try {
    return parseDocContentLeaves(value, options);
  } catch {
    throw new DocContentFormatError("Invalid document blocks.");
  }
}
function identity(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value))
    throw new DocContentFormatError("Invalid document block ID.");
  return value;
}

/** Read the experimental format without discarding unrecognized fields or taking shared references. */
export function parseVersionedDocContent(
  value: unknown,
  options: DocContentValidationOptions = {},
): VersionedDocContent {
  const content = record(value);
  if (content.format === 1) {
    keys(content, ["format", "blocks"]);
    const blocks = leaves(content.blocks, options);
    return { format: 1, blocks };
  }
  if (content.format !== 2)
    throw new DocContentFormatError("Unsupported document content format.");
  keys(content, ["format", "nodes"]);
  // Validate bounded traversal and cycles before walking attacker-controlled recursive objects.
  try {
    validateDocContainers(content.nodes as DocContainerNode[], options);
  } catch (error) {
    if (
      error instanceof DocContainerError &&
      error.message === "Invalid typed document leaf."
    )
      throw new DocContentFormatError("Invalid document blocks.");
    throw error;
  }
  const read = (input: readonly unknown[]): DocContainerNode[] =>
    input.map((raw) => {
      const node = record(raw);
      if (node.kind === "block") {
        keys(node, ["kind", "block"]);
        return { kind: "block", block: leaves([node.block], options)[0] };
      }
      const id = identity(node.id);
      if (node.kind === "quote") {
        keys(node, ["kind", "id", "children", "callout"]);
        let callout: { tone: CalloutKind; folded: boolean } | undefined;
        if (node.callout !== undefined) {
          const metadata = record(node.callout);
          keys(metadata, ["tone", "folded"]);
          callout = {
            tone: metadata.tone as CalloutKind,
            folded: metadata.folded as boolean,
          };
        }
        return {
          kind: "quote",
          ...(id ? { id } : {}),
          children: read(node.children as unknown[]),
          ...(callout ? { callout } : {}),
        };
      }
      keys(node, [
        "kind",
        "id",
        "ordered",
        "start",
        "delimiter",
        "loose",
        "items",
      ]);
      const items: DocContainerItem[] = (node.items as unknown[]).map(
        (rawItem) => {
          const item = record(rawItem);
          keys(item, ["checked", "children"]);
          return {
            ...(item.checked !== undefined
              ? { checked: item.checked as boolean }
              : {}),
            children: read(item.children as unknown[]),
          };
        },
      );
      return {
        kind: "list",
        ...(id ? { id } : {}),
        ordered: node.ordered as boolean,
        start: node.start as number,
        delimiter: node.delimiter as string,
        loose: node.loose as boolean,
        items,
      };
    });
  return { format: 2, nodes: read(content.nodes as unknown[]) };
}

/** Import existing stored arrays into an explicit format; no Markdown reparse or identity regeneration. */
export function legacyDocContent(
  value: unknown,
): VersionedDocContent & { format: 1 } {
  return parseVersionedDocContent({
    format: 1,
    blocks: value,
  }) as VersionedDocContent & { format: 1 };
}

/** Upgrade existing typed leaves without guessing new ownership from their text. */
export function upgradeDocContent(
  value: unknown,
): VersionedDocContent & { format: 2 } {
  const content = parseVersionedDocContent(value);
  return content.format === 2
    ? content
    : (parseVersionedDocContent({
        format: 2,
        nodes: content.blocks.map((block) => ({ kind: "block", block })),
      }) as VersionedDocContent & { format: 2 });
}

/** Only an actually flat document can be represented by legacy clients. */
export function downgradeDocContent(value: unknown): DocBlock[] {
  const content = parseVersionedDocContent(value);
  if (content.format === 1) return content.blocks;
  if (content.nodes.some((node) => node.kind !== "block"))
    throw new DocContentFormatError(
      "This document requires a client that supports nested content.",
    );
  return content.nodes.map(
    (node) => (node as Extract<DocContainerNode, { kind: "block" }>).block,
  );
}

/** Require explicit client capability before writing; a server caller cannot assume browser freshness. */
export function requireDocContentCapability(
  format: DocContentFormat,
  supported: readonly DocContentFormat[],
): void {
  if (
    (format !== 1 && format !== 2) ||
    !Array.isArray(supported) ||
    supported.some((item) => item !== 1 && item !== 2) ||
    !supported.includes(format)
  )
    throw new DocContentFormatError(
      "Update this client before editing this document format.",
    );
}

function canonical(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, sort(value)]),
    );
  };
  return JSON.stringify(sort(value));
}

/** Parse edited source in its declared format, retaining stable standalone/inline anchors. */
export function parseVersionedDocSource(
  source: string,
  format: DocContentFormat,
): VersionedDocContent {
  requireDocContentCapability(format, [1, 2]);
  return parseVersionedDocContent(
    format === 1
      ? { format: 1, blocks: parseDoc(source, { anchors: true }) }
      : { format: 2, nodes: parseDocContainers(source, { anchors: true }) },
  );
}

/** Refuse source switching when Markdown cannot preserve the exact stored structure and metadata. */
export function versionedDocSource(value: unknown): string {
  const content = parseVersionedDocContent(value);
  const source =
    content.format === 1
      ? serializeDoc(content.blocks, { anchors: true })
      : serializeDocContainers(content.nodes, { anchors: true });
  if (
    canonical(parseVersionedDocSource(source, content.format)) !==
    canonical(content)
  )
    throw new DocContentFormatError(
      "Markdown source cannot preserve this document structure.",
    );
  return source;
}

const validatedDocument = z.unknown().transform((value, context) => {
  try {
    return parseVersionedDocContent(value, { projected: true });
  } catch {
    context.addIssue({ code: "custom", message: "Invalid document content." });
    return z.NEVER;
  }
});
/** Content-only save keeps the optimistic revision separate from the content format. */
export const versionedDocSave = z
  .object({
    version: z.number().int().positive(),
    document: validatedDocument,
  })
  .strict();
/** Bounded structured editor read, shared by web/desktop and mobile. */
export const versionedDocRead = z
  .object({
    id: z.uuid(),
    title: z.string().max(200),
    version: z.number().int().positive(),
    document: validatedDocument,
  })
  .strict();
export type VersionedDocRead = z.infer<typeof versionedDocRead>;
