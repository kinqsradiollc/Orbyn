/** A source-preserving inline link; validation of actionable protocols stays with Docs. */
export type DocInlineLink = {
  start: number;
  end: number;
  labelStart: number;
  labelEnd: number;
  href: string;
  title?: string;
  image: boolean;
};
const unescape = (value: string) =>
  value.replace(/\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g, "$1");
const space = (value: string) => /^[ \t\r\n]$/.test(value);

/** Balanced link syntax, with masked literal delimiters and no evaluation of source. */
export function docInlineLinks(
  masked: string,
  source: string,
): DocInlineLink[] {
  const closings = new Map<number, number>();
  const brackets: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "[") brackets.push(i);
    else if (masked[i] === "]" && brackets.length)
      closings.set(brackets.pop()!, i);
  }
  const links: DocInlineLink[] = [];
  let budget = masked.length * 4;
  for (let start = 0; start < masked.length && budget > 0; start++) {
    if (masked[start] !== "[") continue;
    const close = closings.get(start);
    if (close === undefined || masked[close + 1] !== "(") continue;
    let cursor = close + 2;
    const skipSpace = () => {
      while (space(masked[cursor] ?? "") && budget-- > 0) cursor++;
    };
    skipSpace();
    let hrefStart = cursor,
      hrefEnd = cursor;
    if (masked[cursor] === "<") {
      hrefStart = ++cursor;
      while (cursor < masked.length && masked[cursor] !== ">" && budget-- > 0) {
        if (masked[cursor] === "<" || /[\r\n]/.test(masked[cursor])) break;
        cursor++;
      }
      if (masked[cursor] !== ">") continue;
      hrefEnd = cursor++;
    } else {
      let depth = 0;
      while (cursor < masked.length && budget-- > 0) {
        const char = masked[cursor];
        if (space(char) || char === "<" || char === ">") break;
        if (char === "(" && ++depth > 32) break;
        if (char === ")") {
          if (!depth) break;
          depth--;
        }
        cursor++;
      }
      if (depth) continue;
      hrefEnd = cursor;
    }
    const beforeSpace = cursor;
    skipSpace();
    let title: string | undefined;
    if (cursor > beforeSpace && ['"', "'", "("].includes(masked[cursor])) {
      const closing = masked[cursor] === "(" ? ")" : masked[cursor];
      const titleStart = ++cursor;
      while (
        cursor < masked.length &&
        masked[cursor] !== closing &&
        budget-- > 0
      ) {
        if (masked[cursor] === "\\" && cursor + 1 < masked.length) cursor += 2;
        else cursor++;
      }
      if (masked[cursor] !== closing) continue;
      const raw = source.slice(titleStart, cursor);
      if (raw.includes("\n\n") || raw.length > 1000) continue;
      title = unescape(raw);
      cursor++;
      skipSpace();
    }
    if (masked[cursor] !== ")") continue;
    const image = masked[start - 1] === "!";
    links.push({
      start: image ? start - 1 : start,
      end: cursor + 1,
      labelStart: start + 1,
      labelEnd: close,
      href: unescape(source.slice(hrefStart, hrefEnd)),
      ...(title !== undefined ? { title } : {}),
      image,
    });
    start = cursor;
  }
  return links;
}
