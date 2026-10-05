import {
  parseDoc,
  serializeDoc,
  type DocBlock,
  type CalloutKind,
  CALLOUT_KINDS,
  CALLOUT_LABELS,
  footnoteNumbers,
  docReferenceLinks,
  docReferenceDefinition,
} from "./docs.js";
import {
  parseDocContentLeaves,
  DOC_PROJECTED_TOTAL_MAX,
  type DocContentValidationOptions,
} from "./doc-content-leaves.js";
import { blocksHtml, docToText, type HtmlOptions } from "./export.js";
import { docFragmentIndex, docLinkDestination } from "./doc-navigation.js";

/** A structured Markdown candidate. Leaves keep the existing editor/comment identity. */
export type DocContainerNode =
  | { kind: "block"; block: DocBlock }
  | {
      kind: "quote";
      id?: string;
      children: DocContainerNode[];
      callout?: { tone: CalloutKind; folded: boolean };
    }
  | {
      kind: "list";
      id?: string;
      ordered: boolean;
      start: number;
      delimiter: string;
      loose: boolean;
      items: DocContainerItem[];
    };
export type DocContainerItem = {
  checked?: boolean;
  children: DocContainerNode[];
};
export const DOC_CONTAINER_LIMITS = {
  source: 2_000_000,
  nodes: 2000,
  depth: 12,
} as const;
export class DocContainerError extends Error {}

type SourceLine = { text: string; line: number };
type Span = { start: number; end: number };
export type DocContainerParseOptions = {
  anchors?: boolean;
  onSourceRange?: (path: number[], start: number, end: number) => void;
};
const ownAnchor = /^\^([A-Za-z0-9_-]{1,64})\s*$/;
const blank = (text: string) => !text.trim();
function quote(text: string): [string, string] | null {
  const match = /^( {0,3})>(.*)$/.exec(text);
  if (!match) return null;
  const rest = match[2];
  const content = rest.startsWith(" ")
    ? rest.slice(1)
    : rest.startsWith("\t")
      ? " ".repeat(4 - ((match[1].length + 1) % 4) - 1) + rest.slice(1)
      : rest;
  return [match[0], content];
}
const thematic = (text: string) =>
  /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(text);
const fence = (text: string) => /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(text);
function marker(text: string) {
  if (thematic(text)) return null;
  const m = /^( {0,3})([-+*]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/.exec(text);
  if (!m) return null;
  const ordered = /^\d/.test(m[2]);
  const spacing = m[3] ?? " ";
  let column = m[1].length + m[2].length;
  let expanded = "";
  for (const character of spacing) {
    const size = character === "\t" ? 4 - (column % 4) : 1;
    expanded += " ".repeat(size);
    column += size;
  }
  const padding = expanded.length <= 4 ? expanded.length : 1;
  return {
    indent: m[1].length,
    delimiter: ordered ? m[2].at(-1)! : m[2],
    ordered,
    start: ordered ? Number.parseInt(m[2], 10) : 1,
    column: m[1].length + m[2].length + padding,
    text: (expanded.length > 4 ? expanded.slice(1) : "") + (m[4] ?? ""),
  };
}
function deindent(text: string, column: number): string | null {
  let at = 0,
    width = 0;
  while (at < text.length && /[ \t]/.test(text[at]) && width < column) {
    width += text[at] === "\t" ? 4 - (width % 4) : 1;
    at++;
  }
  return width >= column ? " ".repeat(width - column) + text.slice(at) : null;
}
function startsBlock(text: string) {
  return (
    blank(text) ||
    !!quote(text) ||
    !!marker(text) ||
    !!fence(text) ||
    thematic(text) ||
    /^ {0,3}(?:#{1,6}(?:\s|$)|\$\$|\^\w|\||<[A-Za-z!/?])/.test(text)
  );
}
function paragraphTail(lines: SourceLine[]): boolean {
  if (!lines.length || startsBlock(lines.at(-1)!.text)) return false;
  const blocks = parseDoc(lines.map((line) => line.text).join("\n"));
  return blocks.at(-1)?.type === "paragraph";
}

/** Parse containers without flattening their child blocks. Not yet a persisted API format. */
export function parseDocContainers(
  markdown: string,
  options: DocContainerParseOptions = {},
): DocContainerNode[] {
  if (markdown.length > DOC_CONTAINER_LIMITS.source)
    throw new DocContainerError("Document source is too large.");
  let count = 0;
  const spans = new WeakMap<DocContainerNode, Span>();
  const add = (node: DocContainerNode, start: number, end: number) => {
    if (++count > DOC_CONTAINER_LIMITS.nodes)
      throw new DocContainerError("Document has too many blocks.");
    spans.set(node, { start, end });
    return node;
  };
  const parse = (lines: SourceLine[], depth: number): DocContainerNode[] => {
    if (depth > DOC_CONTAINER_LIMITS.depth)
      throw new DocContainerError("Document containers are too deeply nested.");
    const out: DocContainerNode[] = [];
    let at = 0;
    while (at < lines.length) {
      if (blank(lines[at].text)) {
        at++;
        continue;
      }
      const anchor = options.anchors
        ? ownAnchor.exec(lines[at].text.trim())
        : null;
      if (anchor && out.length) {
        const previous = out.at(-1)!;
        if (previous.kind === "block")
          previous.block = { ...previous.block, id: anchor[1] };
        else previous.id = anchor[1];
        spans.get(previous)!.end = lines[at].line;
        at++;
        continue;
      }
      const q = quote(lines[at].text);
      if (q) {
        const callout =
          /^\[!(note|tip|warning|question|summary)\]([+-])?(?:[ \t]+(.*))?$/i.exec(
            q[1],
          );
        const begin = at;
        const body: SourceLine[] = [];
        while (at < lines.length) {
          const prefix = quote(lines[at].text);
          if (prefix) {
            body.push({
              ...lines[at],
              text:
                at === begin && callout
                  ? (callout[3] ?? "")
                  : at === begin
                    ? prefix[1].replace(
                        /^(\\+)\[!(note|tip|warning|question|summary)\]/i,
                        (match) => match.slice(1),
                      )
                    : prefix[1],
            });
            at++;
          } else if (!startsBlock(lines[at].text) && paragraphTail(body)) {
            body.push(lines[at++]);
          } else break;
        }
        out.push(
          add(
            {
              kind: "quote",
              children: parse(body, depth + 1),
              ...(callout
                ? {
                    callout: {
                      tone: callout[1].toLowerCase() as CalloutKind,
                      folded: callout[2] === "-",
                    },
                  }
                : {}),
            },
            lines[begin].line,
            lines[at - 1].line,
          ),
        );
        continue;
      }
      const first = marker(lines[at].text);
      if (first) {
        const begin = at;
        const items: DocContainerItem[] = [];
        let loose = false;
        while (at < lines.length) {
          const current = marker(lines[at].text);
          if (
            !current ||
            current.indent !== first.indent ||
            current.ordered !== first.ordered ||
            current.delimiter !== first.delimiter
          )
            break;
          const task = /^\[([ xX])\](?:[ \t]+|$)(.*)$/.exec(current.text);
          const body: SourceLine[] = [
            {
              ...lines[at],
              text: task
                ? task[2]
                : current.text.replace(
                    /^(\\+)\[([ xX])\](?=[ \t]|$)/,
                    (match) => match.slice(1),
                  ),
            },
          ];
          at++;
          while (at < lines.length) {
            if (blank(lines[at].text)) {
              let next = at;
              while (next < lines.length && blank(lines[next].text)) next++;
              const sibling =
                next < lines.length ? marker(lines[next].text) : null;
              if (
                sibling &&
                sibling.indent === first.indent &&
                sibling.ordered === first.ordered &&
                sibling.delimiter === first.delimiter
              ) {
                loose = true;
                at = next;
                break;
              }
              if (
                next < lines.length &&
                deindent(lines[next].text, current.column) !== null
              ) {
                loose = true;
                while (at < next) body.push(lines[at++]);
                continue;
              }
              break;
            }
            const content = deindent(lines[at].text, current.column);
            if (content !== null) {
              body.push({ ...lines[at], text: content });
              at++;
            } else if (!startsBlock(lines[at].text) && paragraphTail(body)) {
              body.push(lines[at++]);
            } else break;
          }
          items.push({
            ...(task ? { checked: task[1].toLowerCase() === "x" } : {}),
            children: parse(body, depth + 1),
          });
          if (++count > DOC_CONTAINER_LIMITS.nodes)
            throw new DocContainerError("Document has too many list items.");
        }
        out.push(
          add(
            {
              kind: "list",
              ordered: first.ordered,
              start: first.start,
              delimiter: first.delimiter,
              loose,
              items,
            },
            lines[begin].line,
            lines[Math.max(begin, at - 1)].line,
          ),
        );
        continue;
      }
      if (deindent(lines[at].text, 4) !== null) {
        const begin = at;
        const body: string[] = [];
        while (at < lines.length) {
          const content = deindent(lines[at].text, 4);
          if (content !== null) {
            body.push(content);
            at++;
            continue;
          }
          if (blank(lines[at].text)) {
            let next = at;
            while (next < lines.length && blank(lines[next].text)) next++;
            if (next < lines.length && deindent(lines[next].text, 4) !== null) {
              while (at < next) {
                body.push("");
                at++;
              }
              continue;
            }
          }
          break;
        }
        out.push(
          add(
            {
              kind: "block",
              block: { type: "code", lang: "", text: body.join("\n") },
            },
            lines[begin].line,
            lines[at - 1].line,
          ),
        );
        continue;
      }
      const begin = at;
      let open: { character: string; length: number } | null = null;
      while (at < lines.length) {
        const text = lines[at].text;
        if (
          at > begin &&
          !open &&
          (quote(text) ||
            marker(text) ||
            (blank(lines[at - 1].text) && deindent(text, 4) !== null) ||
            (options.anchors && ownAnchor.test(text.trim())))
        )
          break;
        const f = fence(text);
        if (!open && f) open = { character: f[1][0], length: f[1].length };
        else if (
          open &&
          new RegExp(
            `^ {0,3}${open.character === "`" ? "`" : "~"}{${open.length},}[ \\t]*$`,
          ).test(text)
        )
          open = null;
        at++;
      }
      const chunk = lines.slice(begin, at);
      const ranges: Span[] = [];
      const blocks = parseDoc(chunk.map((line) => line.text).join("\n"), {
        anchors: options.anchors,
        onSourceRange: (_index, start, end) =>
          ranges.push({
            start: chunk[start - 1]?.line ?? chunk[0].line,
            end: chunk[end - 1]?.line ?? chunk.at(-1)!.line,
          }),
      });
      blocks.forEach((block, index) =>
        out.push(
          add(
            { kind: "block", block },
            ranges[index]?.start ?? chunk[0].line,
            ranges[index]?.end ?? chunk.at(-1)!.line,
          ),
        ),
      );
    }
    return out;
  };
  const nodes = parse(
    markdown
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((text, index) => ({ text, line: index + 1 })),
    0,
  );
  validateDocContainers(nodes);
  if (options.onSourceRange)
    visitDocContainers(nodes, (node, path) => {
      const span = spans.get(node)!;
      options.onSourceRange!(path, span.start, span.end);
    });
  return nodes;
}

/** Visit every leaf/container in source order, including list children. */
export function visitDocContainers(
  nodes: readonly DocContainerNode[],
  visit: (node: DocContainerNode, path: number[]) => void,
): void {
  const active = new Set<DocContainerNode>();
  let count = 0;
  const walk = (
    current: readonly DocContainerNode[],
    path: number[],
    depth: number,
  ) => {
    if (depth > DOC_CONTAINER_LIMITS.depth)
      throw new DocContainerError("Document containers are too deeply nested.");
    if (!Array.isArray(current))
      throw new DocContainerError("Invalid container children.");
    current.forEach((node: DocContainerNode, index: number) => {
      if (
        !node ||
        typeof node !== "object" ||
        !["block", "quote", "list"].includes(node.kind)
      )
        throw new DocContainerError("Invalid document node.");
      if (++count > DOC_CONTAINER_LIMITS.nodes || active.has(node))
        throw new DocContainerError("Invalid or oversized document tree.");
      const here = [...path, index];
      active.add(node);
      visit(node, here);
      if (node.kind === "quote") walk(node.children, here, depth + 1);
      else if (node.kind === "list") {
        if (!Array.isArray(node.items))
          throw new DocContainerError("Invalid list items.");
        node.items.forEach((item: DocContainerItem, index: number) => {
          if (++count > DOC_CONTAINER_LIMITS.nodes)
            throw new DocContainerError("Document has too many list items.");
          if (
            !item ||
            typeof item !== "object" ||
            (item.checked !== undefined && typeof item.checked !== "boolean")
          )
            throw new DocContainerError("Invalid list item.");
          walk(item.children, [...here, index], depth + 1);
        });
      }
      active.delete(node);
    });
  };
  walk(nodes, [], 0);
}

/** Validate tree budgets and global IDs before a recursive consumer touches it. */
export function validateDocContainers(
  nodes: readonly DocContainerNode[],
  options: DocContentValidationOptions = {},
): void {
  const ids = new Set<string>();
  let textSize = 0;
  visitDocContainers(nodes, (node) => {
    if (node.kind === "block") {
      try {
        parseDocContentLeaves([node.block], options);
      } catch {
        throw new DocContainerError("Invalid typed document leaf.");
      }
      if ("text" in node.block) textSize += node.block.text.length;
      if (
        textSize >
        (options.projected
          ? DOC_PROJECTED_TOTAL_MAX
          : DOC_CONTAINER_LIMITS.source)
      )
        throw new DocContainerError("Document text is too large.");
    }
    if (
      node.kind === "quote" &&
      node.callout &&
      (!CALLOUT_KINDS.includes(node.callout.tone) ||
        typeof node.callout.folded !== "boolean")
    )
      throw new DocContainerError("Invalid callout metadata.");
    const id = node.kind === "block" ? node.block.id : node.id;
    if (
      id !== undefined &&
      (typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        ids.has(id))
    )
      throw new DocContainerError("Invalid or duplicate document block ID.");
    if (id) ids.add(id);
    if (
      node.kind === "list" &&
      (typeof node.ordered !== "boolean" ||
        typeof node.loose !== "boolean" ||
        !Number.isInteger(node.start) ||
        node.start < 0 ||
        node.start > 999999999 ||
        node.items.length === 0 ||
        (node.ordered && node.start + node.items.length - 1 > 999999999) ||
        !(node.ordered ? /^[.)]$/ : /^[-+*]$/).test(node.delimiter))
    )
      throw new DocContainerError("Invalid list marker.");
  });
}

/** All typed leaves, in document order, for references, permissions and search. */
export function docContainerBlocks(
  nodes: readonly DocContainerNode[],
  options: DocContentValidationOptions = {},
): DocBlock[] {
  const blocks: DocBlock[] = [];
  validateDocContainers(nodes, options);
  visitDocContainers(nodes, (node) => {
    if (node.kind === "block") blocks.push(node.block);
  });
  return blocks;
}

/** Map every leaf while preserving containment; callers must project authorization first. */
export function mapDocContainerBlocks(
  nodes: readonly DocContainerNode[],
  map: (block: DocBlock, index: number) => DocBlock,
  options: DocContentValidationOptions = {},
): DocContainerNode[] {
  validateDocContainers(nodes, options);
  let index = 0;
  const walk = (current: readonly DocContainerNode[]): DocContainerNode[] =>
    current.map((node) =>
      node.kind === "block"
        ? { kind: "block", block: map(node.block, index++) }
        : node.kind === "quote"
          ? { ...node, children: walk(node.children) }
          : {
              ...node,
              items: node.items.map((item) => ({
                ...item,
                children: walk(item.children),
              })),
            },
    );
  const result = walk(nodes);
  validateDocContainers(result, options);
  return result;
}

/** Serialize typed children with their ownership indentation, rather than lifting them to the page. */
export function serializeDocContainers(
  nodes: readonly DocContainerNode[],
  options: { anchors?: boolean } & DocContentValidationOptions = {},
): string {
  validateDocContainers(nodes, options);
  const write = (
    current: readonly DocContainerNode[],
    separator = "\n\n",
  ): string =>
    current
      .map((node) => {
        if (node.kind === "block")
          return serializeDoc([node.block], options).slice(0, -1);
        let source: string;
        if (node.kind === "quote") {
          let body = write(node.children);
          if (
            !node.callout &&
            node.children[0]?.kind === "block" &&
            node.children[0].block.type === "paragraph"
          )
            body = body.replace(
              /^(\\*)\[!(note|tip|warning|question|summary)\]/i,
              (match) => "\\" + match,
            );
          source = (
            (node.callout
              ? `[!${node.callout.tone}]${node.callout.folded ? "-" : ""}\n`
              : "") + body
          )
            .split("\n")
            .map((line) => `>${line ? " " + line : ""}`)
            .join("\n");
        } else
          source = node.items
            .map((item, index) => {
              const marker = node.ordered
                ? `${node.start + index}${node.delimiter}`
                : node.delimiter;
              const prefix =
                marker +
                " " +
                (item.checked !== undefined
                  ? `[${item.checked ? "x" : " "}] `
                  : "");
              const lines = write(
                item.children,
                node.loose ? "\n\n" : "\n",
              ).split("\n");
              if (
                item.checked === undefined &&
                item.children[0]?.kind === "block" &&
                item.children[0].block.type === "paragraph"
              )
                lines[0] = lines[0].replace(
                  /^(\\*)\[([ xX])\](?=[ \t]|$)/,
                  (match) => "\\" + match,
                );
              // Task metadata belongs to the item; continuation indentation follows the list marker.
              const indent = " ".repeat(marker.length + 1);
              return (
                prefix +
                (lines[0] ?? "") +
                lines
                  .slice(1)
                  .map((line) => "\n" + (line ? indent + line : ""))
                  .join("")
              );
            })
            .join(node.loose ? "\n\n" : "\n");
        return options.anchors && node.id ? source + `\n^${node.id}` : source;
      })
      .join(separator);
  return write(nodes);
}

/** Project the complete page context before redistributing authorized leaves into containers. */
export function projectDocContainers(
  nodes: readonly DocContainerNode[],
  project: (blocks: DocBlock[]) => DocBlock[],
  options: DocContentValidationOptions = {},
): DocContainerNode[] {
  const blocks = docContainerBlocks(nodes, options);
  const projected = project(blocks);
  if (
    projected.length !== blocks.length ||
    projected.some((block, index) => block.id !== blocks[index].id)
  )
    throw new DocContainerError(
      "Document projection changed its structure or identity.",
    );
  return mapDocContainerBlocks(
    nodes,
    (_block, index) => projected[index],
    options,
  );
}

/** Render authorized typed children with shared inline/file/math policies and page-wide references. */
export function docContainersHtml(
  nodes: readonly DocContainerNode[],
  options: HtmlOptions & DocContentValidationOptions = {},
): string {
  const blocks = docContainerBlocks(nodes, options);
  const notes = options.notes ?? footnoteNumbers(blocks);
  const references = options.references ?? docReferenceLinks(blocks);
  const positions = new Map<DocContainerNode, number>();
  let index = 0;
  visitDocContainers(nodes, (node) => {
    if (node.kind === "block") positions.set(node, index++);
  });
  const htmlOptions: HtmlOptions = {
    ...options,
    anchors: false,
    notes,
    references,
    linkUrl: (href) => {
      if (options.anchors && href.startsWith("#")) {
        const destination = docLinkDestination(href, null);
        const found =
          destination?.kind === "fragment"
            ? docFragmentIndex(blocks, destination.fragment)
            : null;
        return found !== null && blocks[found].type === "heading"
          ? `#h-${found}`
          : null;
      }
      return options.linkUrl ? options.linkUrl(href) : href;
    },
  };
  const write = (current: readonly DocContainerNode[], tight = false): string =>
    current
      .map((node) => {
        if (node.kind === "block") {
          if (node.block.type === "footnote") return "";
          let html = blocksHtml([node.block], htmlOptions);
          if (options.anchors && node.block.type === "heading")
            html = html.replace(
              `<h${node.block.level}>`,
              `<h${node.block.level} id="h-${positions.get(node)}">`,
            );
          return tight && node.block.type === "paragraph"
            ? html.replace(/^<p>([\s\S]*)<\/p>$/, "$1")
            : html;
        }
        if (node.kind === "quote")
          return node.callout
            ? `<blockquote class="c ${node.callout.tone}"><strong>${CALLOUT_LABELS[node.callout.tone]}</strong>${write(node.children)}</blockquote>`
            : `<blockquote>${write(node.children)}</blockquote>`;
        const tag = node.ordered ? "ol" : "ul";
        const start =
          node.ordered && node.start !== 1 ? ` start="${node.start}"` : "";
        return `<${tag}${start}>${node.items.map((item) => `<li${item.checked !== undefined ? ' class="t"' : ""}>${item.checked !== undefined ? `<input type="checkbox" disabled${item.checked ? " checked" : ""}> ` : ""}${write(item.children, !node.loose)}</li>`).join("")}</${tag}>`;
      })
      .join("");
  return (
    write(nodes) +
    blocksHtml(
      blocks.filter((block) => block.type === "footnote"),
      htmlOptions,
    )
  );
}

/** Plain text keeps quote/list ownership and resolves page-wide reference labels. */
export function docContainersText(
  title: string,
  nodes: readonly DocContainerNode[],
  options: DocContentValidationOptions = {},
): string {
  const blocks = docContainerBlocks(nodes, options);
  const references = docReferenceLinks(blocks);
  const notes = footnoteNumbers(blocks);
  const leaf = (block: DocBlock): string => {
    if (block.type === "paragraph" && docReferenceDefinition(block.text))
      return "";
    return docToText("", [block], { references, notes }).slice(2, -1);
  };
  const prefix = (text: string, first: string, continuation: string) =>
    text
      .split("\n")
      .map((line, index) => (index ? continuation : first) + line)
      .join("\n");
  const write = (children: readonly DocContainerNode[]): string =>
    children
      .map((node) => {
        if (node.kind === "block") return leaf(node.block);
        if (node.kind === "quote")
          return prefix(
            (node.callout ? `${CALLOUT_LABELS[node.callout.tone]}:\n` : "") +
              write(node.children),
            "> ",
            "> ",
          );
        return node.items
          .map((item, index) => {
            const marker =
              (node.ordered ? `${node.start + index}${node.delimiter}` : "•") +
              " " +
              (item.checked === undefined
                ? ""
                : `[${item.checked ? "x" : " "}] `);
            return prefix(
              write(item.children),
              marker,
              " ".repeat(marker.length),
            );
          })
          .join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  return `${title}\n\n${write(nodes)}\n`;
}
