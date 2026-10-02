import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDoc,
  serializeDoc,
  serializeBlock,
  docContent,
  blocksHtml,
} from "@orbyn/core";

const metadata =
  '---\ntitle: "Notes: week 3"\ntags: [study, work]\nbody: |\n  # literal heading\n  - literal list\n  <script>alert(1)</script>\n---';

test("frontmatter remains one literal editable block and exports its original delimiters", () => {
  const blocks = parseDoc(metadata + "\n\n# Lecture\n");
  assert.equal(blocks[0].type, "code");
  assert.equal(blocks[0].text, metadata);
  assert.ok(docContent.safeParse(blocks).success);
  assert.equal(serializeDoc(blocks), metadata + "\n\n# Lecture\n");
  assert.equal(serializeBlock(blocks[0]), metadata);
});

test("frontmatter with anchors preserves its block identity and literal anchor-like YAML", () => {
  const source =
    "---\ntitle: notes ^not-an-anchor\n...\n^meta\n\n# Lecture ^heading";
  const blocks = parseDoc(source, { anchors: true });
  assert.equal(blocks[0].id, "meta");
  assert.equal(blocks[0].text, "---\ntitle: notes ^not-an-anchor\n...");
  assert.deepEqual(
    parseDoc(serializeDoc(blocks, { anchors: true }), { anchors: true }),
    blocks,
  );
});

test("only initial closed frontmatter is recognized; later rules and unclosed input stay Markdown", () => {
  assert.equal(parseDoc("---\ntitle: unfinished")[0].type, "divider");
  assert.equal(
    parseDoc("# Intro\n\n---\ntitle: notes\n---")[1].type,
    "divider",
  );
  assert.equal(parseDoc("---\n---\n")[0].text, "---\n---");
});

test("moved or delimiter-edited frontmatter exports safely as a fence and round-trips", () => {
  const block = parseDoc(metadata)[0];
  const moved = [
    { type: "heading" as const, level: 1 as const, text: "Intro" },
    block,
  ];
  assert.deepEqual(parseDoc(serializeDoc(moved)), moved);
  const changed = { ...block, text: metadata + "\ntrailing metadata" };
  assert.deepEqual(parseDoc(serializeDoc([changed])), [changed]);
});

test("frontmatter preserves BOM, CRLF normalization, blank lines and YAML without evaluation", () => {
  const source =
    "\uFEFF---\r\nunsafe: !!js/function >\r\n  function () { return 1; }\r\n\r\n...";
  const normalized = source.replace(/\r\n/g, "\n");
  assert.equal(serializeDoc(parseDoc(source)), normalized + "\n");
});

test("a leading thematic rule never becomes frontmatter on export, including old anchored source", () => {
  const blocks = parseDoc("---\n^rule\n\n# Intro ^intro\n\n---\n^end", {
    anchors: true,
  });
  assert.equal(blocks[0].type, "divider");
  assert.deepEqual(
    parseDoc(serializeDoc(blocks, { anchors: true }), { anchors: true }),
    blocks,
  );
  const plain = [
    { type: "divider" as const },
    { type: "paragraph" as const, text: "notes" },
    { type: "divider" as const },
  ];
  assert.deepEqual(parseDoc(serializeDoc(plain)), plain);
});

test("frontmatter HTML export escapes active content and creates no external resource", () => {
  const html = blocksHtml(parseDoc(metadata));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|<iframe|src=/);
});
