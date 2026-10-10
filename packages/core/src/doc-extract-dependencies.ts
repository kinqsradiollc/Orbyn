import {
  docReferenceDefinition,
  docReferenceLinks,
  docReferenceSpans,
  parseDocInline,
  type DocBlock,
} from "./docs.js";
import { docContainerBlocks, type DocContainerNode } from "./doc-containers.js";
const normalized = (label: string) =>
  label.trim().replace(/\s+/g, " ").toUpperCase().toLowerCase();

/** Copy required supporting definitions into a split page, closing transitive footnote dependencies. */
export function retainExtractDependencies(
  nodes: DocContainerNode[],
  original: readonly DocBlock[],
  freshId: () => string,
): void {
  const references = docReferenceLinks([...original]);
  const definitions = new Map<string, DocBlock>();
  const notes = new Map<string, DocBlock>();
  for (const block of original) {
    const definition =
      block.type === "paragraph" ? docReferenceDefinition(block.text) : null;
    if (definition && !definitions.has(normalized(definition.label)))
      definitions.set(normalized(definition.label), block);
    // Match the renderer's last-definition policy for footnotes.
    if (block.type === "footnote") notes.set(block.label, block);
  }
  const queue = docContainerBlocks(nodes);
  const existingReferences = docReferenceLinks(queue);
  const existingNotes = new Map(
    queue.flatMap((block) =>
      block.type === "footnote" ? [[block.label, block.text] as const] : [],
    ),
  );
  const existingTitles = new Map(
    [...existingReferences].map(([label, href]) => [
      label,
      existingReferences.titleFor?.(label, href),
    ]),
  );
  const occupiedLabels = new Set(
    queue.flatMap((block) => {
      const definition =
        block.type === "paragraph" ? docReferenceDefinition(block.text) : null;
      return definition ? [normalized(definition.label)] : [];
    }),
  );
  const copy = (block: DocBlock, first = false) => {
    const added = { ...block, id: freshId() };
    if (first) nodes.unshift({ kind: "block", block: added });
    else nodes.push({ kind: "block", block: added });
    queue.push(added);
  };
  for (let index = 0; index < queue.length; index++) {
    const block = queue[index];
    if (
      !("text" in block) ||
      ["code", "math", "image", "file"].includes(block.type) ||
      (block.type === "paragraph" && docReferenceDefinition(block.text))
    )
      continue;
    for (const span of docReferenceSpans(block.text, references)) {
      const title = references.titleFor?.(span.reference, span.href);
      if (
        existingReferences.get(span.reference) === span.href &&
        existingTitles.get(span.reference) === title
      )
        continue;
      const definition = definitions.get(span.reference);
      if (!definition) continue;
      copy(definition, occupiedLabels.has(span.reference));
      occupiedLabels.add(span.reference);
      existingReferences.set(span.reference, span.href);
      existingTitles.set(span.reference, title);
    }
    for (const run of parseDocInline(block.text, references)) {
      if (!run.footnote) continue;
      const definition = notes.get(run.footnote);
      if (
        !definition ||
        definition.type !== "footnote" ||
        existingNotes.get(run.footnote) === definition.text
      )
        continue;
      existingNotes.set(run.footnote, definition.text);
      copy(definition);
    }
  }
}
