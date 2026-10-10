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
): { target: DocBlock[]; source: DocBlock[] } {
  const destination = docReferenceLinks([...target]);
  const references = docReferenceLinks([...source]);
  // An unsafe definition still occupies its label in Markdown's first-definition
  // rule. Do not let it suppress a valid moved source definition.
  const destinationDefinitions = new Set(
    target.flatMap((block) => {
      const definition =
        block.type === "paragraph" ? docReferenceDefinition(block.text) : null;
      return definition ? [normalized(definition.label)] : [];
    }),
  );
  const reserved = new Set([...destination.keys(), ...references.keys()]);
  // Generated labels must not turn an existing unresolved shortcut into a link.
  // Reserve literal examples too; over-reserving a name is harmless.
  for (const block of [...target, ...source]) {
    if (!("text" in block)) continue;
    for (const match of block.text.matchAll(
      /\[([^\]\n]{1,999})\](?:\[([^\]\n]{0,999})\])?/g,
    ))
      reserved.add(normalized(match[2] || match[1]));
  }
  const renamed = new Map<string, string>();
  let nextReference = 0;
  for (const [label, href] of references) {
    if (!destinationDefinitions.has(label)) continue;
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
  const boundSource = source.map((block) => {
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
  const combined = docReferenceLinks([...target, ...boundSource]);
  const preserveUnresolved = (blocks: readonly DocBlock[]): DocBlock[] => {
    const before = docReferenceLinks([...blocks]);
    return blocks.map((block) => {
      if (
        !("text" in block) ||
        ["code", "math", "image", "file"].includes(block.type) ||
        (block.type === "paragraph" && docReferenceDefinition(block.text))
      )
        return block;
      const activated = docReferenceSpans(block.text, combined).filter(
        (span) => !before.has(span.reference),
      );
      let text = block.text;
      for (const span of activated.reverse()) {
        const literal = text
          .slice(span.start, span.end)
          .replace(/[\[\]]/g, "\\$&");
        text = text.slice(0, span.start) + literal + text.slice(span.end);
      }
      return text === block.text ? block : { ...block, text };
    });
  };
  return {
    target: preserveUnresolved(target),
    source: preserveUnresolved(boundSource),
  };
}
