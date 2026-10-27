import { docInlineLinks } from "./doc-inline-links.js";
import { docInlineLiterals } from "./doc-inline-literals.js";
import { docReferenceDefinition, type DocBlock } from "./docs.js";

/** Rewrite actionable Markdown destinations while retaining labels, titles and literal source. */
export function rewriteDocBlockLinks(
  block: DocBlock,
  rewrite: (href: string) => string,
): DocBlock {
  if (
    !("text" in block) ||
    ["code", "math", "image", "file"].includes(block.type)
  )
    return block;
  const text = block.text;
  // Reference definitions use the same destination parser as inline links.
  if (block.type === "paragraph" && docReferenceDefinition(text)) {
    const prefix = /^ {0,3}\[[^\]\n]+\]:[ \t]*/.exec(text)!;
    const opening = "[reference](";
    const probe = opening + text.slice(prefix[0].length) + ")";
    const link = docInlineLinks(probe, probe)[0];
    if (!link) return block;
    const href = rewrite(link.href);
    if (href === link.href) return block;
    const offset = prefix[0].length - opening.length;
    return {
      ...block,
      text:
        text.slice(0, offset + link.hrefStart) +
        href +
        text.slice(offset + link.hrefEnd),
    };
  }
  const masked = text.split("");
  for (const literal of docInlineLiterals(text)) {
    if (literal.run.break) continue;
    masked.fill("\uE000", literal.start, literal.end);
  }
  // Raw HTML is preserved source, including link-like text in attributes/comments.
  for (const html of text.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^<>\n]*>/g))
    masked.fill("\uE000", html.index!, html.index! + html[0].length);
  const links = docInlineLinks(masked.join(""), text);
  let next = text;
  for (const link of links.reverse()) {
    if (link.image) continue;
    const href = rewrite(link.href);
    if (href !== link.href)
      next = next.slice(0, link.hrefStart) + href + next.slice(link.hrefEnd);
  }
  return next === text ? block : { ...block, text: next };
}
