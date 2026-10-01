/** Bounds shared by the isolated diagram renderer and its host. */
export const MERMAID_MAX_SOURCE = 65_536;
export const MERMAID_MAX_SVG = 2_097_152;

/** Keep diagram configuration owned by Orbyn; retain rejected text in the editor. */
export function prepareMermaidSource(source: string): string {
  if (source.length > MERMAID_MAX_SOURCE)
    throw new Error(
      "This diagram is too large. Split it into smaller diagrams.",
    );
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error("Add diagram source to draw a preview.");
  if (text.split("\n").length > 2_048)
    throw new Error(
      "This diagram has too many lines. Split it into smaller diagrams.",
    );
  if (/%%\s*\{/.test(text) || /^\s*---(?:\n|$)/.test(text))
    throw new Error(
      "Diagram configuration directives are not supported. Keep the diagram source without its configuration header.",
    );
  return text;
}
