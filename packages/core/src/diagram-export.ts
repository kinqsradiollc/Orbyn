import { colors } from "./presentation.js";
import { MERMAID_MAX_SVG, prepareMermaidSource } from "./mermaid.js";

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const decode = (text: string) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
const abort = () =>
  Object.assign(new Error("Document export was cancelled."), {
    name: "AbortError",
  });

/** Self-contained files use the application's light palette against white paper. */
export const DIAGRAM_EXPORT_PALETTE = {
  background: colors.surface,
  primaryColor: colors.surface,
  primaryBorderColor: colors.accent,
  primaryTextColor: colors.text,
  secondaryColor: colors.soft,
  tertiaryColor: colors.surfaceMuted,
  lineColor: colors.muted,
  textColor: colors.text,
  noteBkgColor: colors.highBg,
  noteTextColor: colors.text,
  highText: colors.highText,
  mediumText: colors.mediumText,
  lowText: colors.lowText,
};

/** Enrich only marked source in the backend-authorized export snapshot, never raw document data. */
export async function renderHtmlDiagrams(
  html: string,
  render: (source: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw abort();
  if (html.length > 20 * 1024 * 1024)
    throw new Error("This document is too large to render for export.");
  const pattern =
    /<pre class="diagram-source" data-orbyn-diagram="mermaid"><code>([\s\S]*?)<\/code><\/pre>/g;
  const parts: string[] = [];
  let cursor = 0,
    count = 0,
    images = 0;
  for (const match of html.matchAll(pattern)) {
    if (signal?.aborted) throw abort();
    parts.push(html.slice(cursor, match.index));
    const source = decode(match[1]);
    const retained = `<details><summary>Diagram source</summary><pre><code>${escape(source)}</code></pre></details>`;
    try {
      if (++count > 100) throw new Error("Too many diagrams.");
      const svg = await render(prepareMermaidSource(source));
      if (signal?.aborted) throw abort();
      if (
        typeof svg !== "string" ||
        !/^\s*<svg(?:\s|>)/.test(svg) ||
        svg.length > MERMAID_MAX_SVG ||
        (images += svg.length) > 10 * 1024 * 1024
      )
        throw new Error("Rendered diagrams are too large.");
      // SVG as an image is inert; the trusted isolated renderer also strips external resources.
      const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      parts.push(
        `<figure class="export-diagram"><img alt="Mermaid diagram" src="${uri}">${retained}</figure>`,
      );
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === "AbortError")
      )
        throw abort();
      parts.push(
        `<figure class="export-diagram"><figcaption>Diagram rendering unavailable; source retained.</figcaption>${retained}</figure>`,
      );
    }
    cursor = match.index! + match[0].length;
  }
  if (signal?.aborted) throw abort();
  return parts.join("") + html.slice(cursor);
}

let bridgeSequence = 0;

export type DiagramExportBridge = {
  signal: AbortSignal;
  render: (source: string) => Promise<string>;
  receive: (data: string) => void;
  dispose: () => void;
};

/** A per-editor bridge to a strict isolated renderer; queued work never replaces an active request. */
export function createDiagramExportBridge(
  send: (request: string | undefined) => void,
  timeoutMs = 30_000,
): DiagramExportBridge {
  const controller = new AbortController();
  const instance = ++bridgeSequence;
  let sequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  let active:
    | {
        id: string;
        resolve: (svg: string) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const finish = (svg?: string, error?: Error) => {
    const pending = active;
    if (!pending) return;
    active = undefined;
    clearTimeout(pending.timer);
    send(undefined);
    if (error) pending.reject(error);
    else pending.resolve(svg!);
  };
  return {
    signal: controller.signal,
    render(source: string): Promise<string> {
      const request = tail.then(() => {
        if (controller.signal.aborted) throw abort();
        const prepared = prepareMermaidSource(source);
        return new Promise<string>((resolve, reject) => {
          const id = `export-${instance}-${++sequence}`;
          const timer = setTimeout(
            () => finish(undefined, new Error("Diagram export timed out.")),
            timeoutMs,
          );
          active = { id, timer, resolve, reject };
          send(
            JSON.stringify({
              type: "orbyn-diagram",
              id,
              source: prepared,
              palette: DIAGRAM_EXPORT_PALETTE,
              actualSize: true,
              viewportWidth: 768,
            }),
          );
        });
      });
      tail = request.catch(() => {});
      return request;
    },
    receive(data: string) {
      if (!active || data.length > MERMAID_MAX_SVG + 100_000) return;
      let value: { type?: string; id?: string; error?: unknown; svg?: unknown };
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      if (
        !value ||
        value.type !== "orbyn-diagram-result" ||
        value.id !== active.id
      )
        return;
      if (typeof value.error === "string")
        finish(undefined, new Error("Diagram rendering failed."));
      else if (
        typeof value.svg === "string" &&
        value.svg.length <= MERMAID_MAX_SVG &&
        /^\s*<svg(?:\s|>)/.test(value.svg)
      )
        finish(value.svg);
      else finish(undefined, new Error("Invalid diagram export result."));
    },
    dispose() {
      controller.abort();
      finish(undefined, abort());
    },
  };
}
