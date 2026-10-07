import {
  docReferenceDefinition,
  docReferenceLinks,
  docReferenceSpans,
  parseDocInline,
  type DocBlock,
} from "./docs.js";
const normalized = (label: string) =>
  label.trim().replace(/\s+/g, " ").toUpperCase().toLowerCase();

/** Keep source references and footnotes bound to their own definitions after page concatenation. */
export function mergeDocReferences(
  target: readonly DocBlock[],
  source: readonly DocBlock[],
): DocBlock[] {
  const destination = docReferenceLinks([...target]);
  const references = docReferenceLinks([...source]);
  const reserved = new Set([...destination.keys(), ...references.keys()]);
  const renamed = new Map<string, string>();
  let nextReference = 0;
  for (const [label, href] of references) {
    if (!destination.has(label)) continue;
    if (
      destination.get(label) === href &&
      destination.titleFor?.(label, href) === references.titleFor?.(label, href)
    )
      continue;
    let next: string;
    do {
      next = `merged-reference-${++nextReference}`;
    } while (reserved.has(next));
    reserved.add(next);
    renamed.set(label, next);
  }
  const noteLabels = (blocks: readonly DocBlock[]) =>
    new Set(
      blocks.flatMap((block) => {
        if (block.type === "footnote") return [block.label];
        if (
          !("text" in block) ||
          ["code", "math", "image", "file"].includes(block.type)
        )
          return [];
        return parseDocInline(block.text).flatMap((run) =>
          run.footnote ? [run.footnote] : [],
        );
      }),
    );
  const destinationNotes = noteLabels(target),
    sourceNotes = noteLabels(source);
  const reservedNotes = new Set([...destinationNotes, ...sourceNotes]);
  const renamedNotes = new Map<string, string>();
  let nextNote = 0;
  for (const label of sourceNotes) {
    if (!destinationNotes.has(label)) continue;
    let next: string;
    do {
      next = `merged-note-${++nextNote}`;
    } while (reservedNotes.has(next));
    reservedNotes.add(next);
    renamedNotes.set(label, next);
  }
  return source.map((block) => {
    if (
      !("text" in block) ||
      ["code", "math", "image", "file"].includes(block.type)
    )
      return block;
    const definition =
      block.type === "paragraph" ? docReferenceDefinition(block.text) : null;
    if (definition) {
      const label = renamed.get(normalized(definition.label));
      return label
        ? {
            ...block,
            text: block.text.replace(/^( {0,3})\[[^\]\n]+\]/, `$1[${label}]`),
          }
        : block;
    }
    const changes: { start: number; end: number; text: string }[] = [];
    for (const span of docReferenceSpans(block.text, references)) {
      const label = renamed.get(span.reference);
      if (label)
        changes.push({
          start: span.start,
          end: span.end,
          text: `[${span.label}][${label}]`,
        });
    }
    for (const run of parseDocInline(block.text, references)) {
      const label = run.footnote && renamedNotes.get(run.footnote);
      if (label)
        changes.push({
          start: run.start - 2,
          end: run.start + run.footnote!.length + 1,
          text: `[^${label}]`,
        });
    }
    let text = block.text;
    for (const change of changes.sort((a, b) => b.start - a.start))
      text = text.slice(0, change.start) + change.text + text.slice(change.end);
    return {
      ...block,
      text,
      ...(block.type === "footnote" && renamedNotes.has(block.label)
        ? { label: renamedNotes.get(block.label)! }
        : {}),
    };
  });
}
