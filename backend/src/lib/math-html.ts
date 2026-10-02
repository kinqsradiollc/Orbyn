import katex from "katex";

const MAX_SOURCE_CHARS = 16_384;
const MAX_OUTPUT_BYTES = 524_288;
const DOCUMENT_SOURCE_CHARS = 131_072;
const DOCUMENT_OUTPUT_BYTES = 2_097_152;

/** Self-contained MathML for downloads/publication; null preserves the caller's source fallback. */
export function mathHtml(tex: string, display: boolean): string | null {
  if (tex.length > MAX_SOURCE_CHARS) return null;
  try {
    const html = katex.renderToString(tex, {
      output: "mathml",
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      maxSize: 20,
      maxExpand: 200,
      // Definitions belong to this expression only, never another page or user.
      macros: {},
    });
    const result = display ? `<div class="math">${html}</div>` : html;
    if (Buffer.byteLength(result, "utf8") > MAX_OUTPUT_BYTES) return null;
    return result;
  } catch {
    return null;
  }
}

/** One renderer per document/request bounds combined work and output without shared state. */
export function createMathHtml() {
  let source = DOCUMENT_SOURCE_CHARS,
    output = DOCUMENT_OUTPUT_BYTES;
  return (tex: string, display: boolean): string | null => {
    if (tex.length > MAX_SOURCE_CHARS || tex.length > source || output <= 0)
      return null;
    source -= tex.length;
    const html = mathHtml(tex, display);
    if (html === null) return null;
    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes > output) {
      output = 0;
      return null;
    }
    output -= bytes;
    return html;
  };
}
