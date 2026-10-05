import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDoc,
  serializeDoc,
  plainText,
  docContent,
  DOC_FOOTNOTE_MAX,
  footnoteNumbers,
  docToHtml,
} from "@orbyn/core";
import { docToDocx } from "../src/modules/docs/docx.js";
import {
  docxToMarkdown,
  readZip,
  NotAWordFile,
} from "../src/modules/imports/docx.js";
import { zip } from "../src/modules/docs/zip.js";

const date = new Date("2026-10-06T00:00:00Z");
const type =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes";
const rel = (target = "footnotes.xml", extra = "") =>
  `<Relationship Id="footnotes" Type="${type}" Target="${target}" ${extra}/>`;
const run = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;
const note = (id: string, text: string, kind = "") =>
  `<w:footnote w:id="${id}" ${kind ? `w:type="${kind}"` : ""}><w:p>${run(text)}</w:p></w:footnote>`;
const word = (
  notes: string,
  relation = rel(),
  body = '<w:r><w:footnoteReference w:id="0"/></w:r>',
) =>
  zip(
    [
      {
        name: "word/document.xml",
        body: `<w:document><w:body><w:p>${body}</w:p></w:body></w:document>`,
      },
      {
        name: "word/_rels/document.xml.rels",
        body: `<Relationships>${relation}</Relationships>`,
      },
      {
        name: "word/footnotes.xml",
        body: `<w:footnotes>${notes}</w:footnotes>`,
      },
    ],
    date,
  );

test("multiline footnotes preserve source, anchors, breaks and ranges", () => {
  const ranges: number[][] = [];
  const blocks = parseDoc(
    "First[^note]\n\n[^note]: **Source**  \n    next\\\n    last",
    { onSourceRange: (...range) => ranges.push(range) },
  );
  assert.deepEqual(blocks[1], {
    type: "footnote",
    label: "note",
    text: "**Source**  \nnext\\\nlast",
  });
  assert.deepEqual(ranges, [
    [0, 1, 1],
    [1, 3, 5],
  ]);
  assert.deepEqual(parseDoc(serializeDoc(blocks)), blocks);
  const named = blocks.map((block, index) => ({ ...block, id: `b${index}` }));
  assert.deepEqual(
    parseDoc(serializeDoc(named, { anchors: true }), { anchors: true }),
    named,
  );
  assert.ok(docContent.safeParse(blocks).success);
});

test("footnote continuation grouping cannot exceed the existing stored limit", () => {
  const blocks = parseDoc(`[^note]: ${"a".repeat(DOC_FOOTNOTE_MAX)}\n    more`);
  assert.equal(blocks[0].type, "footnote");
  assert.equal(blocks.length, 2);
  assert.ok(docContent.safeParse(blocks).success);
});

test("Word round trip preserves references, formatted note text, links, hints and hard breaks", () => {
  const blocks = parseDoc(
    'Read[^source] and again[^source].\n\n[^source]: **Source** [guide](https://example.test/guide "Guide hint")  \n    second line',
  );
  const imported = parseDoc(
    docxToMarkdown(docToDocx("Notes", blocks, date)).markdown,
  );
  const footnote = imported.find((block) => block.type === "footnote")!;
  assert.ok(footnote);
  assert.match(footnote.text, /\*\*Source\*\*/);
  assert.match(footnote.text, /Guide hint/);
  assert.match(footnote.text, /https:\/\/example.test\/guide/);
  assert.equal(plainText(footnote.text), "Source guide\nsecond line");
  const paragraph = imported.find((block) => block.type === "paragraph")!;
  assert.equal(paragraph.text, "Read[^word-1] and again[^word-1].");
  assert.equal(footnoteNumbers(imported).get("word-1"), 1);
  assert.match(docToHtml("Notes", imported), /Source/);
});

test("normal footnote zero is imported while separator types are omitted", () => {
  const imported = parseDoc(
    docxToMarkdown(
      word(
        note("-1", "Separator", "separator") +
          note("1", "Continuation", "continuationSeparator") +
          note("0", "Actual", "normal"),
      ),
    ).markdown,
  );
  assert.equal(imported[0].text, "[^word-0]");
  assert.deepEqual(imported[1], {
    type: "footnote",
    label: "word-0",
    text: "Actual",
  });
});

for (const [id, label] of [
  ["+0002", "word-2"],
  ["-2", "word--2"],
  ["2147483647", "word-2147483647"],
]) {
  test(`signed integer footnote ID ${id} matches its normalized label`, () => {
    const imported = parseDoc(
      docxToMarkdown(
        word(
          note(id, "Source"),
          rel(),
          `<w:r><w:footnoteReference w:id="${id}"/></w:r>`,
        ),
      ).markdown,
    );
    assert.equal(imported[0].text, `[^${label}]`);
    assert.equal(imported[1].type, "footnote");
    assert.equal("label" in imported[1] ? imported[1].label : null, label);
  });
}

test("ambiguous or invalid footnote IDs fail instead of silently replacing text", () => {
  for (const notes of [
    note("0", "First") + note("00", "Second"),
    note("2147483648", "Too large"),
    note("not-id", "Malformed"),
  ])
    assert.throws(() => docxToMarkdown(word(notes)), NotAWordFile);
});

for (const [target, extra] of [
  ["https://external.invalid/notes.xml", 'TargetMode="External"'],
  ["//external.invalid/word/footnotes.xml", ""],
  ["../../notes.xml", ""],
  ["file:///private/notes.xml", ""],
]) {
  test(`footnote part ${target} cannot select a remote or filesystem source`, () => {
    assert.throws(
      () => docxToMarkdown(word(note("0", "Source"), rel(target, extra))),
      NotAWordFile,
    );
  });
}

test("footnote part ambiguity, missing parts and oversize notes fail explicitly", () => {
  assert.throws(
    () => docxToMarkdown(word(note("0", "Source"), rel() + rel())),
    NotAWordFile,
  );
  assert.throws(
    () => docxToMarkdown(word(note("0", "Source"), rel("missing.xml"))),
    NotAWordFile,
  );
  assert.throws(
    () => docxToMarkdown(word(note("0", "x".repeat(DOC_FOOTNOTE_MAX + 1)))),
    NotAWordFile,
  );
});

test("unrelated archive footnotes are not read without a document relationship", () => {
  const imported = docxToMarkdown(word(note("0", "Unrelated"), "")).markdown;
  assert.equal(imported, "[^word-0]");
  assert.ok(!imported.includes("Unrelated"));
});

test("Word footnote hyperlinks use that part own relationships", () => {
  const original = docToDocx(
    "Notes",
    parseDoc(
      'Read[^n].\n\n[^n]: [link](https://example.test/source "Source hint")',
    ),
    date,
  );
  const files = readZip(original);
  assert.ok(files.has("word/_rels/footnotes.xml.rels"));
  const imported = docxToMarkdown(original).markdown;
  assert.match(imported, /Source hint/);
  assert.match(imported, /https:\/\/example.test\/source/);
});

test("empty normal notes and markers inside mixed runs retain their IDs", () => {
  const body =
    '<w:r><w:t>Before</w:t><w:footnoteReference w:id="0"/><w:t>After</w:t></w:r>';
  const blocks = parseDoc(
    docxToMarkdown(word('<w:footnote w:id="0"/>', rel(), body)).markdown,
  );
  assert.equal(blocks[0].text, "Before[^word-0]After");
  assert.deepEqual(blocks[1], { type: "footnote", label: "word-0", text: "" });
});

test("normal note count stays bounded even for short unreferenced notes", () => {
  const notes = Array.from({ length: 2001 }, (_, id) =>
    note(String(id), "Source"),
  ).join("");
  assert.throws(() => docxToMarkdown(word(notes)), /too many footnotes/);
});

test("archive-local footnote parts can live in a subdirectory with spaces", () => {
  const files = readZip(word(note("0", "Source")));
  const moved = zip(
    [...files].map(([name, body]) => ({
      name: name === "word/footnotes.xml" ? "word/notes/foot notes.xml" : name,
      body:
        name === "word/_rels/document.xml.rels"
          ? `<Relationships>${rel("notes/foot notes.xml")}</Relationships>`
          : body(),
    })),
    date,
  );
  const blocks = parseDoc(docxToMarkdown(moved).markdown);
  assert.deepEqual(blocks[1], {
    type: "footnote",
    label: "word-0",
    text: "Source",
  });
});

test("literal anchor words inside multiline note text never change its stored ID", () => {
  const blocks = [
    {
      type: "footnote" as const,
      id: "real",
      label: "source",
      text: "First ^literal\nSecond ^other",
    },
  ];
  assert.deepEqual(
    parseDoc(serializeDoc(blocks, { anchors: true }), { anchors: true }),
    blocks,
  );
});

test("footnote reference marks inside a table stay linked to their imported definition", () => {
  const files = readZip(word(note("0", "Source")));
  const table = `<w:tbl><w:tr><w:tc><w:p>${run("Header")}</w:p></w:tc><w:tc><w:p>${run("Value")}</w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:footnoteReference w:id="0"/></w:r></w:p></w:tc><w:tc><w:p>${run("Data")}</w:p></w:tc></w:tr></w:tbl>`;
  const data = zip(
    [...files].map(([name, body]) => ({
      name,
      body:
        name === "word/document.xml"
          ? `<w:document><w:body>${table}</w:body></w:document>`
          : body(),
    })),
    date,
  );
  const blocks = parseDoc(docxToMarkdown(data).markdown);
  assert.equal(blocks[0].type, "table");
  assert.match(blocks[0].text, /\[\^word-0\]/);
  assert.equal(footnoteNumbers(blocks).get("word-0"), 1);
  assert.equal(blocks[1].type, "footnote");
});

test("invalid footnote references fail explicitly rather than disappearing", () => {
  for (const id of ["", "oops", "2147483648", "1.5"]) {
    assert.throws(
      () =>
        docxToMarkdown(
          word(
            note("0", "Source"),
            rel(),
            `<w:r><w:footnoteReference w:id="${id}"/></w:r>`,
          ),
        ),
      NotAWordFile,
    );
  }
});
