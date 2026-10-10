import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDocContainers,
  docContainerBlocks,
  projectDocContainers,
  blocksWithExportLinks,
  serializeDocContainers,
  docContainersHtml,
  docHtmlPage,
  docContainersText,
  applyVersionedDocSource,
  versionedDocSource,
} from "@orbyn/core";
const privateId = "00000000-0000-4000-8000-000000000001";
const source = `> # Nested\n>\n> - [Secret title][secret]\n>\n>   code context\n\n[secret]: orbyn://doc/${privateId} "Secret hint"`;

test("structured Markdown and HTML exports preserve ownership without private identifiers", () => {
  const nodes = parseDocContainers(source);
  const blocks = blocksWithExportLinks(
    docContainerBlocks(nodes),
    "https://orbyn.test",
    (ref) => ref.id === privateId,
  );
  const exported = projectDocContainers(nodes, () => blocks, {
    projected: true,
  });
  const md = serializeDocContainers(exported, { projected: true });
  const html = docHtmlPage(
    "Export",
    docContainersHtml(exported, { projected: true, anchors: true }),
  );
  for (const value of [md, html]) {
    assert.doesNotMatch(
      value,
      new RegExp(`${privateId}|Secret title|Secret hint|private-doc`),
    );
    assert.match(value, /Private page/);
  }
  assert.match(md, /> - Private page/);
  assert.match(html, /<blockquote><h1 id="h-0">Nested<\/h1><ul><li>/);
  assert.match(html, /<title>Export<\/title>/);
});

test("an authorized export keeps reference labels and hints", () => {
  const nodes = parseDocContainers(source);
  const blocks = blocksWithExportLinks(
    docContainerBlocks(nodes),
    "https://orbyn.test",
    () => false,
  );
  const exported = projectDocContainers(nodes, () => blocks);
  const html = docContainersHtml(exported);
  assert.match(html, /Secret title/);
  assert.match(html, /Secret hint/);
});

test("private inline links lose their destinations but literal code remains authored source", () => {
  const blocks = blocksWithExportLinks(
    [
      { type: "paragraph", text: `[Secret](orbyn://doc/${privateId} "Hint")` },
      { type: "code", text: `orbyn://doc/${privateId}`, lang: "text" },
    ],
    "https://orbyn.test",
    () => true,
  );
  assert.equal(
    blocks[0].type === "paragraph" && blocks[0].text,
    "Private page",
  );
  assert.equal(
    blocks[1].type === "code" && blocks[1].text,
    `orbyn://doc/${privateId}`,
  );
});

test("plain text keeps ordered tasks, continuation paragraphs and nested quote boundaries", () => {
  const nodes = parseDocContainers(
    "> 7. [x] First\n>\n>    Next paragraph\n>\n>    - Child\n>\n>      ```ts\n>      a();\n>      ```",
  );
  const text = docContainersText("Title", nodes);
  assert.match(text, /> 7\. \[x\] First/);
  assert.match(text, /Next paragraph/);
  assert.match(text, /• Child/);
  assert.match(text, /a\(\);/);
});

test("plain text resolves global references once and preserves escaped literal styling", () => {
  const nodes = parseDocContainers(
    "> \\*\\*literal\\*\\* and [Guide][ref] [^note]\n\n[ref]: https://example.test\n\n[^note]: Footnote",
  );
  const text = docContainersText("Title", nodes);
  assert.match(text, /> \*\*literal\*\* and Guide \[1\]/);
  assert.match(text, /\[1\] Footnote/);
  assert.doesNotMatch(text, /\[ref\]:|\[Guide\]/);
});

test("one structured draft imports, edits and exports a mixed Markdown page", () => {
  const source = [
    "# Plan",
    "",
    "1. Intro",
    "   - [x] Read notes",
    "",
    "| Day | Work |",
    "| --- | --- |",
    "| Mon | Draft |",
    "",
    "![Plan image](orbyn://file/00000000-0000-4000-8000-000000000001)",
    "",
    "```mermaid",
    "flowchart LR",
    "A --> B",
    "```",
  ].join("\n");
  const initial = { format: 2 as const, nodes: parseDocContainers(source) };
  const edited = applyVersionedDocSource(
    initial,
    initial,
    versionedDocSource(initial).replace("Intro", "Outline"),
  );
  if (edited.format !== 2) assert.fail("Expected a structured page");
  const markdown = serializeDocContainers(edited.nodes);
  const html = docContainersHtml(edited.nodes);
  for (const value of [markdown, html]) {
    assert.match(value, /Outline/);
    assert.match(value, /Read notes/);
    assert.match(value, /Mon/);
    assert.match(value, /Plan image/);
    assert.match(value, /flowchart LR/);
  }
  assert.match(markdown, /- \[x\] Read notes/);
  assert.match(markdown, /```mermaid/);
  assert.match(html, /<table>/);
});
