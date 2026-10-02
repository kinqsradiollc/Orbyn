import { linesOf, type PageText } from "@orbyn/core";

/** Reconstruct lines by position: font runs and ligatures can split a single printed word. */
export function pdfTextLines(pages: readonly { text: PageText }[]): string[] {
  return pages.flatMap((page) =>
    linesOf(page.text.spans).map((line) =>
      line.spans
        .map((span) => span.text)
        .join("")
        .normalize("NFKC")
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
}
