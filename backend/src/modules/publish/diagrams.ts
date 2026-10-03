import type { FastifyReply, FastifyRequest } from "fastify";
import { fail } from "@orbyn/core";
import { exportRenderedHtml } from "../docs/pdf-client.js";

const sourcePattern = () =>
  /<pre class="diagram-source" data-orbyn-diagram="mermaid"><code>([^<]*)<\/code><\/pre>/g;
const MAX_HTML = 20 * 1024 * 1024;
const inertFigure =
  /^<figure class="export-diagram">(?:<img alt="Mermaid diagram"(?: width="\d+" height="\d+")? src="data:image\/svg\+xml;charset=utf-8,[^"]+">|<figcaption>Diagram rendering unavailable; source retained\.<\/figcaption>)<details><summary>Diagram source<\/summary><pre><code>[^<]*<\/code><\/pre><\/details><\/figure>$/;

/** Render marked diagrams only; publication forms, links and live image URLs never enter the private browser. */
export async function renderPublicationDiagrams(
  body: string,
  request: FastifyRequest,
  reply: FastifyReply,
  render: typeof exportRenderedHtml = exportRenderedHtml,
): Promise<string> {
  if (Buffer.byteLength(body) > MAX_HTML)
    fail(413, "This published page is too large to render.");
  const sources = [...body.matchAll(sourcePattern())];
  if (!sources.length) return body;
  if (sources.length > 100)
    fail(413, "This published page has too many diagrams.");
  const batch = `<!doctype html><html><head><title>Publication diagrams</title></head><body>${sources.map((source, index) => `<section data-orbyn-publication-diagram="${index}">${source[0]}</section>`).join("")}</body></html>`;
  const rendered = await render(batch, request, reply);
  const sections = [
    ...rendered.matchAll(
      /<section data-orbyn-publication-diagram="(\d+)">([\s\S]*?)<\/section>/g,
    ),
  ];
  if (
    sections.length !== sources.length ||
    sections.some(
      (section, index) =>
        section[1] !== String(index) || !inertFigure.test(section[2]),
    )
  )
    fail(503, "Published diagram rendering is unavailable. Try again shortly.");
  let index = 0;
  const result = body.replace(sourcePattern(), () => sections[index++][2]);
  if (Buffer.byteLength(result) > MAX_HTML)
    fail(413, "This rendered published page is too large.");
  return result;
}
