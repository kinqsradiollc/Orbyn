import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { blocksHtml, renderHtmlDiagrams } from "@orbyn/core";
import { renderPublicationDiagrams } from "../src/modules/publish/diagrams.js";

const request = {} as FastifyRequest,
  reply = {} as FastifyReply;
const body = () =>
  blocksHtml(
    [
      {
        type: "code",
        lang: "mermaid",
        text: "flowchart LR\nA --> B",
        id: "chart",
      },
    ],
    { diagramSources: true },
  );
const render = async (html: string) =>
  renderHtmlDiagrams(
    html,
    async () => '<svg viewBox="0 0 200 100"><text>Example</text></svg>',
  );
const status = (code: number) => (error: unknown) => {
  assert.equal((error as { statusCode: number }).statusCode, code);
  return true;
};

test("ordinary published content does not invoke the private renderer", async () => {
  const html =
    '<p>Notes</p><img src="/p/example/media/doc/file"><form action="/p/example/unlock"></form>';
  assert.equal(
    await renderPublicationDiagrams(html, request, reply, async () => {
      throw new Error("unexpected renderer");
    }),
    html,
  );
});

test("only marked diagram source enters the renderer; application links, images and forms remain outside", async () => {
  const html =
    '<p>Notes</p><img src="/p/example/media/doc/file">' +
    body() +
    '<form action="/p/example/unlock"></form>';
  const result = await renderPublicationDiagrams(
    html,
    request,
    reply,
    async (input) => {
      assert.doesNotMatch(input, /<form|\/p\/|<img/);
      return render(input);
    },
  );
  assert.match(result, /<img src="\/p\/example\/media\/doc\/file">/);
  assert.match(result, /<form action="\/p\/example\/unlock">/);
  assert.match(result, /data:image\/svg\+xml/);
  assert.match(result, /<details><summary>Diagram source/);
  assert.doesNotMatch(result, /data-orbyn-publication-diagram=/);
});

test("invalid diagrams retain escaped source with an explicit unavailable message", async () => {
  const result = await renderPublicationDiagrams(
    body(),
    request,
    reply,
    async (html) =>
      renderHtmlDiagrams(html, async () => {
        throw new Error("invalid");
      }),
  );
  assert.match(result, /Diagram rendering unavailable; source retained/);
  assert.match(result, /flowchart LR/);
});

for (const [label, change] of [
  [
    "missing section",
    (s: string) => s.replace(/<section[\s\S]*<\/section>/, ""),
  ],
  ["wrong index", (s: string) => s.replace('diagram="0"', 'diagram="1"')],
  [
    "executable fragment",
    (s: string) =>
      s.replace(
        '<figure class="export-diagram">',
        '<figure class="export-diagram"><script>bad</script>',
      ),
  ],
  [
    "external image",
    (s: string) =>
      s.replace(
        /data:image\/svg\+xml;charset=utf-8,[^"]+/,
        "https://example.invalid/secret",
      ),
  ],
] as const)
  test(`published diagrams reject ${label} results`, async () => {
    await assert.rejects(
      renderPublicationDiagrams(body(), request, reply, async (html) =>
        change(await render(html)),
      ),
      status(503),
    );
  });

test("diagram count and input bounds are enforced before a private job starts", async () => {
  const unexpected = async () => {
    throw new Error("unexpected renderer");
  };
  await assert.rejects(
    renderPublicationDiagrams(body().repeat(101), request, reply, unexpected),
    status(413),
  );
  await assert.rejects(
    renderPublicationDiagrams(
      "x".repeat(20 * 1024 * 1024 + 1),
      request,
      reply,
      unexpected,
    ),
    status(413),
  );
});
