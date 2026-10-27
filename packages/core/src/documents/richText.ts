/**
 * Light Markdown for assistant replies, shared by web and mobile so both show
 * the same structure: headings (`# Title` or a line that is all bold),
 * paragraphs, bulleted and numbered lists, and **bold**, *italic* and `code`.
 * Stray markers from a reply that was cut off (a lone `**`) are hidden.
 */
export type RichInline = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type RichBlock =
  | { type: "heading"; inlines: RichInline[] }
  | { type: "paragraph"; inlines: RichInline[] }
  | { type: "list"; ordered: boolean; items: RichInline[][] }
  /** A Markdown table: `| a | b |` rows under a `|---|---|` separator. */
  | { type: "table"; header: RichInline[][]; rows: RichInline[][][] };

const INLINE =
  /\*\*(.+?)\*\*|__(.+?)__|`([^`\n]+)`|\*([^*\s](?:[^*]*[^*\s])?)\*/g;

const plain = (text: string): RichInline[] => {
  // Unclosed bold markers are noise, not content.
  const cleaned = text.replace(/\*\*|__/g, "");
  return cleaned ? [{ text: cleaned }] : [];
};

export function parseInline(text: string): RichInline[] {
  const out: RichInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    out.push(...plain(text.slice(last, at)));
    const [, bold1, bold2, code, italic] = match;
    if (bold1 ?? bold2) out.push({ text: (bold1 ?? bold2)!, bold: true });
    else if (code) out.push({ text: code, code: true });
    else if (italic) out.push({ text: italic, italic: true });
    last = at + match[0].length;
  }
  out.push(...plain(text.slice(last)));
  return out;
}

const HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const BOLD_LINE = /^\*\*([^*]+?)\*\*:?$/;
const BULLET = /^\s*[-*•+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));

export function parseRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trimEnd();
    // A table: a header row, a separator row, then body rows.
    if (
      TABLE_ROW.test(line) &&
      n + 1 < lines.length &&
      TABLE_SEPARATOR.test(lines[n + 1])
    ) {
      const header = cells(line);
      const rows: RichInline[][][] = [];
      n += 2;
      while (n < lines.length && TABLE_ROW.test(lines[n])) {
        const row = cells(lines[n]);
        // Pad or trim to the header's width so renderers get a clean grid.
        rows.push(header.map((_, c) => row[c] ?? []));
        n++;
      }
      n--;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    if (!line.trim() || RULE.test(line)) continue;
    const heading = line.trim().match(HEADING) ?? line.trim().match(BOLD_LINE);
    const bullet = heading ? null : line.match(BULLET);
    const numbered = heading || bullet ? null : line.match(NUMBERED);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = !!numbered;
      const previous = blocks.at(-1);
      const inlines = parseInline(item[1].trim());
      if (previous?.type === "list" && previous.ordered === ordered)
        previous.items.push(inlines);
      else blocks.push({ type: "list", ordered, items: [inlines] });
    } else if (heading) {
      blocks.push({ type: "heading", inlines: parseInline(heading[1]) });
    } else {
      const inlines = parseInline(line.trim());
      if (inlines.length) blocks.push({ type: "paragraph", inlines });
    }
  }
  return blocks;
}

/** What happened to a reply's proposed changes. */
export type ProposalOutcome = "pending" | "applied" | "discarded" | "info";

/**
 * A note appended to an earlier assistant turn in the history sent back to the
 * model, so it knows those changes are finished and does not repeat them.
 */
export function proposalNote(
  actions: {
    operation: string;
    item_id?: string;
    data?: { title?: string } | null;
  }[],
  outcome: ProposalOutcome,
  titles: Record<string, string> = {},
): string {
  if (!actions.length) return "";
  const list = actions
    .map(
      (a) =>
        `${a.operation} "${a.data?.title ?? (a.item_id ? titles[a.item_id] : "") ?? ""}"`,
    )
    .join(", ");
  const result =
    outcome === "applied"
      ? "The user approved them and they are saved."
      : outcome === "discarded"
        ? "The user discarded them, so nothing changed."
        : "The user has not approved them.";
  return `(Proposed changes: ${list}. ${result})`;
}
