/**
 * Pasting into a page: what was copied, as the lines a page is made of.
 *
 * Copying from Google Docs, Word or a web page puts HTML on the clipboard.
 * That is read here into headings, lists (nested ones too), checklists,
 * quotes, code, links and simple emphasis, and tables become one bullet per
 * row the way an imported Word file's do. Everything else — fonts, colours,
 * pictures, layout — is left behind, so a paste reads as Orbyn rather than
 * as wherever it came from.
 *
 * The HTML is read by a small reader of its own rather than the browser's,
 * so the same code runs on the web, on a phone and in tests.
 */
import { MAX_DEPTH, parseDoc, withDepth, type DocBlock } from "./docs.js";
import { rowsToBullets } from "./imports.js";

type HtmlNode =
  | { text: string }
  | { tag: string; attrs: Record<string, string>; children: HtmlNode[] };
type HtmlElement = Extract<HtmlNode, { tag: string }>;

const VOID = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "col",
  "wbr",
  "source",
  "area",
  "base",
]);
/** Elements whose contents are never text on a page. */
const SKIP = new Set([
  "script",
  "style",
  "head",
  "title",
  "noscript",
  "template",
  "svg",
  "button",
  "select",
  "textarea",
]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  times: "×",
  copy: "©",
};

/** Turn `&amp;`, `&#39;` and `&#x2014;` back into the characters they are. */
export function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Read HTML into a tree. Forgiving: stray closing tags are ignored. */
function readHtml(html: string): HtmlElement {
  // A clipboard copy marks where the copied part starts and ends.
  const fragment = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/.exec(
    html,
  );
  const source = (fragment ? fragment[1] : html)
    .replace(/<!--[\s\S]*?-->/g, "")
    // Word's "if supportLists" markers are neither tags nor text.
    .replace(/<!\[(end)?if[^\]]*\]>/gi, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\?xml[^>]*>/gi, "");
  const root: HtmlElement = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElement[] = [root];
  const TOKEN =
    /<\/?([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|[^<]+|</g;
  let skipping: string | null = null;
  for (const m of source.matchAll(TOKEN)) {
    const whole = m[0];
    const top = stack[stack.length - 1];
    if (!m[1]) {
      if (!skipping) top.children.push({ text: decodeHtml(whole) });
      continue;
    }
    const tag = m[1].toLowerCase();
    const closing = whole[1] === "/";
    if (skipping) {
      if (closing && tag === skipping) skipping = null;
      continue;
    }
    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    if (SKIP.has(tag)) {
      if (!whole.endsWith("/>")) skipping = tag;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of (m[2] ?? "").matchAll(
      /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    ))
      attrs[a[1].toLowerCase()] = decodeHtml(a[2] ?? a[3] ?? a[4] ?? "");
    const el: HtmlElement = { tag, attrs, children: [] };
    top.children.push(el);
    if (!VOID.has(tag) && !whole.endsWith("/>")) stack.push(el);
  }
  return root;
}

/** Everything written inside an element, as plain text. */
const textOf = (node: HtmlNode): string =>
  "text" in node ? node.text : node.children.map(textOf).join("");

type Style = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  highlight?: boolean;
  link?: string;
};
type Run = Style & { text: string };

/** Elements that sit inside a line, where a background is a highlighter's. */
const INLINE = new Set([
  "span",
  "font",
  "b",
  "strong",
  "i",
  "em",
  "cite",
  "u",
  "s",
  "strike",
  "del",
  "ins",
  "sub",
  "sup",
  "small",
  "big",
  "a",
  "abbr",
  "q",
  "time",
  "label",
]);

/** The named colours a background is written in, as red, green and blue. */
const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  yellow: [255, 255, 0],
  lime: [0, 255, 0],
  green: [0, 128, 0],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  fuchsia: [255, 0, 255],
  magenta: [255, 0, 255],
  pink: [255, 192, 203],
  orange: [255, 165, 0],
  gold: [255, 215, 0],
  red: [255, 0, 0],
  blue: [0, 0, 255],
  lightyellow: [255, 255, 224],
  lightgreen: [144, 238, 144],
  lightpink: [255, 182, 193],
  lightblue: [173, 216, 230],
  palegreen: [152, 251, 152],
  khaki: [240, 230, 140],
  greenyellow: [173, 255, 47],
};

/** A CSS colour as red, green, blue and opacity (0–1), or null. */
function readColour(value: string): [number, number, number, number] | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,8})$/.exec(v)?.[1];
  if (hex) {
    const full =
      hex.length <= 4
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    if (full.length !== 6 && full.length !== 8) return null;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [at(0), at(2), at(4), full.length === 8 ? at(6) / 255 : 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) =>
      p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
    const alpha = parts[3]
      ? parts[3].endsWith("%")
        ? parseFloat(parts[3]) / 100
        : parseFloat(parts[3])
      : 1;
    const out: [number, number, number, number] = [
      channel(parts[0]),
      channel(parts[1]),
      channel(parts[2]),
      alpha,
    ];
    return out.every(Number.isFinite) ? out : null;
  }
  const named = NAMED[v];
  return named ? [...named, 1] : null;
}

/**
 * Whether a background reads as a highlighter pen: clearly coloured and not
 * dark, once any see-through colour is laid over a white page. White,
 * off-white, grey, dark-mode and see-through grounds are a page's, not a
 * pen's.
 */
function isHighlighter([r, g, b, a]: [number, number, number, number]) {
  if (a < 0.25) return false;
  const over = (c: number) => 255 - (255 - Math.min(255, Math.max(0, c))) * a;
  const rgb = [over(r), over(g), over(b)];
  const most = Math.max(...rgb);
  const least = Math.min(...rgb);
  return most - least >= 20 && (most + least) / 2 >= 115;
}

/** The colour a style attribute gives a background, the last one set. */
function groundOf(css: string): [number, number, number, number] | null {
  let found: [number, number, number, number] | null = null;
  for (const m of css.matchAll(/background(?:-color)?\s*:\s*([^;]+)/g)) {
    // `background` may carry an image and a position along with a colour.
    for (const token of m[1].match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+/g) ??
      []) {
      const colour = readColour(token);
      if (colour) {
        found = colour;
        break;
      }
    }
  }
  return found;
}

/**
 * Bold, italic and highlighting as a style attribute says them (how Google
 * Docs and Word write). `ground` says whether a background here can be a
 * highlighter: only on words within a line, and not on whatever wraps the
 * whole copy, which carries the page's own background.
 */
function cssStyle(el: HtmlElement, style: Style, ground = false): Style {
  const css = (el.attrs.style ?? "").toLowerCase();
  const next = { ...style };
  const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(css)?.[1];
  if (weight)
    next.bold =
      weight === "bold" || weight === "bolder" || Number(weight) >= 600;
  if (/font-style\s*:\s*italic/.test(css)) next.italic = true;
  if (/font-style\s*:\s*normal/.test(css)) next.italic = false;
  // Word names its highlighter outright.
  const word = /mso-highlight\s*:\s*([a-z]+)/.exec(css)?.[1];
  if (word && word !== "none" && word !== "auto") next.highlight = true;
  else if (ground) {
    const colour = groundOf(css);
    if (colour && isHighlighter(colour)) next.highlight = true;
  }
  return next;
}

/**
 * The elements that wrap the whole copy, one inside the other. A browser
 * puts the page's own background on the outermost one, so theirs is never
 * a highlighter. Google Docs is the exception: its wrapper carries no
 * background, and a copy of one highlighted word is that word's own span.
 */
function wrappersOf(root: HtmlElement, html: string): Set<HtmlElement> {
  const out = new Set<HtmlElement>();
  if (/docs-internal-guid/.test(html)) return out;
  let at = root;
  for (;;) {
    const full = at.children.filter((c) => textOf(c).trim() !== "");
    if (full.length !== 1 || "text" in full[0]) break;
    at = full[0];
    out.add(at);
  }
  return out;
}

/** Word marks a list paragraph by style rather than with <li>. */
const wordList = (el: HtmlElement) =>
  /mso-list\s*:\s*l\d+\s+level(\d)/i.exec(el.attrs.style ?? "");

/** The bullet or number Word writes in front of a list paragraph. */
const wordMarker = (el: HtmlElement): string => {
  for (const c of el.children) {
    if ("text" in c) continue;
    if (/mso-list\s*:\s*ignore/i.test(c.attrs.style ?? "")) return textOf(c);
    const inner = wordMarker(c);
    if (inner) return inner;
  }
  return "";
};

/** A line's runs as the Markdown a page line holds. */
function runsToMarkdown(runs: Run[]): string {
  // Neighbouring runs with the same style are one run.
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      !!last.bold === !!r.bold &&
      !!last.italic === !!r.italic &&
      !!last.code === !!r.code &&
      !!last.highlight === !!r.highlight &&
      last.link === r.link
    )
      last.text += r.text;
    else merged.push({ ...r });
  }
  return merged
    .map((r) => {
      const lead = /^\s*/.exec(r.text)![0];
      const trail = /\s*$/.exec(r.text.slice(lead.length))![0];
      const core = r.text.slice(lead.length, r.text.length - trail.length);
      if (!core) return r.text;
      let body = core;
      // Styles don't nest in a page line, so the strongest one is kept.
      if (r.link && /^(https?:|mailto:)/i.test(r.link))
        body = `[${core.replace(/[[\]]/g, "")}](${r.link
          .replace(/\s/g, "%20")
          .replace(/\(/g, "%28")
          .replace(/\)/g, "%29")})`;
      else if (r.code && !core.includes("`")) body = `\`${core}\``;
      else if (r.bold && !core.includes("*")) body = `**${core}**`;
      else if (r.italic && !core.includes("*")) body = `*${core}*`;
      else if (r.highlight && !core.includes("=")) body = `==${core}==`;
      return lead + body + trail;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * HTML from the clipboard as page lines. Returns an empty list when there is
 * nothing on it but layout.
 */
export function htmlToBlocks(html: string): DocBlock[] {
  const root = readHtml(html);
  const wrappers = wrappersOf(root, html);
  /** Whether a background on `el` can be a highlighter. */
  const inline = (el: HtmlElement) => INLINE.has(el.tag) && !wrappers.has(el);
  const out: DocBlock[] = [];
  /** The line being gathered, and what kind of line it will be. */
  let runs: Run[] = [];
  let pending: DocBlock | null = null;

  const flush = () => {
    const text = runsToMarkdown(runs);
    runs = [];
    const kind = pending;
    pending = null;
    if (!text) return;
    // A heading is bold already; bold inside it only adds stars.
    if (kind?.type === "heading")
      out.push({ ...kind, text: text.replace(/\*\*([^*]+)\*\*/g, "$1") });
    else if (kind && kind.type !== "divider")
      out.push({ ...kind, text } as DocBlock);
    else out.push({ type: "paragraph", text });
  };

  type Context = {
    style: Style;
    /** The lists this is inside, innermost last. */
    lists: ("ul" | "ol")[];
    quote: boolean;
    /** Inside a list item, whose paragraphs are the item's own words. */
    item: boolean;
  };

  const startLine = (block: DocBlock | null) => {
    flush();
    pending = block;
  };

  const walk = (node: HtmlNode, ctx: Context) => {
    if ("text" in node) {
      if (node.text) runs.push({ ...ctx.style, text: node.text });
      return;
    }
    const el = node;
    const { tag } = el;
    const children = (next: Context = ctx) =>
      el.children.forEach((c) => walk(c, next));
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      startLine({
        type: "heading",
        level: Math.min(3, Number(heading[1])) as 1 | 2 | 3,
        text: "",
      });
      children({ ...ctx, style: { ...ctx.style, bold: false } });
      flush();
      return;
    }
    switch (tag) {
      case "br":
        // A page line can't hold a line break: the words after it are a
        // line of their own, of the same kind.
        {
          const kind = pending;
          flush();
          pending =
            kind && kind.type !== "heading" && kind.type !== "divider"
              ? kind
              : null;
        }
        return;
      case "hr":
        flush();
        out.push({ type: "divider" });
        return;
      case "img":
        return;
      case "ul":
      case "ol":
        flush();
        children({ ...ctx, lists: [...ctx.lists, tag], item: false });
        flush();
        return;
      case "li": {
        const kind = ctx.lists[ctx.lists.length - 1] ?? "ul";
        const level = Number(el.attrs["aria-level"]);
        const depth = Math.min(
          MAX_DEPTH,
          Math.max(
            0,
            Number.isFinite(level) && level > 0
              ? level - 1
              : ctx.lists.length - 1,
          ),
        );
        const box = findCheckbox(el);
        const block: DocBlock =
          box !== null
            ? { type: "todo", text: "", done: box }
            : kind === "ol"
              ? { type: "numbered", text: "" }
              : { type: "bullet", text: "" };
        startLine(withDepth(block, depth));
        children({ ...ctx, item: true });
        flush();
        return;
      }
      case "input":
        return;
      case "blockquote":
        startLine({ type: "quote", text: "" });
        children({ ...ctx, quote: true });
        flush();
        return;
      case "pre": {
        flush();
        const text = textOf(el).replace(/\n$/, "");
        if (text.trim()) out.push({ type: "code", text, lang: "" });
        return;
      }
      case "table": {
        flush();
        const rows = rowsOf(el);
        for (const line of rowsToBullets(rows)) out.push(...parseDoc(line));
        return;
      }
      case "p":
      case "div":
      case "section":
      case "article":
      case "header":
      case "footer":
      case "main":
      case "figure":
      case "figcaption":
      case "dd":
      case "dt":
        // Inside a list item a paragraph is the item's own words.
        if (ctx.item) {
          if (runs.length) runs.push({ text: " " });
          children({ ...ctx, style: cssStyle(el, ctx.style) });
          return;
        }
        {
          const word = wordList(el);
          if (word) {
            const numbered = /^\s*(\d+|[a-z]{1,4})[.)]/i.test(wordMarker(el));
            startLine(
              withDepth(
                numbered
                  ? { type: "numbered", text: "" }
                  : { type: "bullet", text: "" },
                Number(word[1]) - 1,
              ),
            );
            children({ ...ctx, style: cssStyle(el, ctx.style) });
            flush();
            return;
          }
        }
        startLine(ctx.quote ? { type: "quote", text: "" } : null);
        children({ ...ctx, style: cssStyle(el, ctx.style) });
        flush();
        return;
      case "b":
      case "strong":
        // Google Docs wraps a whole copy in <b style="font-weight:normal">.
        children({
          ...ctx,
          style: cssStyle(el, { ...ctx.style, bold: true }, inline(el)),
        });
        return;
      case "i":
      case "em":
      case "cite":
        children({
          ...ctx,
          style: cssStyle(el, { ...ctx.style, italic: true }, inline(el)),
        });
        return;
      case "code":
      case "kbd":
      case "samp":
      case "tt":
        children({ ...ctx, style: { ...ctx.style, code: true } });
        return;
      case "mark":
        children({ ...ctx, style: { ...ctx.style, highlight: true } });
        return;
      case "a": {
        const href = el.attrs.href ?? "";
        children({
          ...ctx,
          style: /^(https?:|mailto:)/i.test(href)
            ? { ...ctx.style, link: href }
            : ctx.style,
        });
        return;
      }
      default:
        // Word's own bullet or number, already given by the line's kind.
        if (/mso-list\s*:\s*ignore/i.test(el.attrs.style ?? "")) return;
        children({ ...ctx, style: cssStyle(el, ctx.style, inline(el)) });
    }
  };

  walk(root, { style: {}, lists: [], quote: false, item: false });
  flush();
  return out.slice(0, 2000);
}

/** A ticked or unticked box at the start of a list item, or null for none. */
function findCheckbox(li: HtmlElement): boolean | null {
  const checked = li.attrs["aria-checked"];
  if (checked === "true" || checked === "false") return checked === "true";
  const look = (node: HtmlNode, depth: number): boolean | null => {
    if ("text" in node || depth > 3) return null;
    if (node.tag === "ul" || node.tag === "ol") return null;
    if (node.tag === "input" && node.attrs.type?.toLowerCase() === "checkbox")
      return "checked" in node.attrs;
    for (const c of node.children) {
      const found = look(c, depth + 1);
      if (found !== null) return found;
    }
    return null;
  };
  return look(li, 0);
}

/** A table's rows as the text of their cells. */
function rowsOf(table: HtmlElement): string[][] {
  const rows: string[][] = [];
  const visit = (node: HtmlNode) => {
    if ("text" in node) return;
    if (node.tag === "tr") {
      rows.push(
        node.children
          .filter(
            (c): c is HtmlElement =>
              !("text" in c) && (c.tag === "td" || c.tag === "th"),
          )
          .map((c) => textOf(c).replace(/\s+/g, " ").trim()),
      );
      return;
    }
    node.children.forEach(visit);
  };
  visit(table);
  return rows;
}

/**
 * Plain text from the clipboard as page lines. Written Markdown is read as
 * Markdown, so a list copied from a text file stays a list; `plain` takes
 * every line as it is, for ⌘⇧V.
 */
export function textToBlocks(text: string, plain = false): DocBlock[] {
  if (!plain) return parseDoc(text).slice(0, 2000);
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2000)
    .map((line) => ({ type: "paragraph", text: line }) as DocBlock);
}

/**
 * Whether a line being typed went from `before` to `after` by taking in
 * lines at once — a paste — rather than by Return, for an editor (the phone
 * app's) that only sees the new text. Only the stretch that changed is
 * looked at: Return puts in one line break with nothing after it, even over
 * selected words or just after autocorrect fixed the word before it, while
 * pasted lines have words after a break, however long the selection they
 * replaced.
 */
export function pastedLines(before: string, after: string): boolean {
  const most = Math.min(before.length, after.length);
  let start = 0;
  while (start < most && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < most - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return /\n[^]/.test(after.slice(start, after.length - end));
}
