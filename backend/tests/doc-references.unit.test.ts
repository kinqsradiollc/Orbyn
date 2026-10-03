import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDoc,
  serializeDoc,
  parseDocInline,
  docReferenceLinks,
  blocksHtml,
  redactValue,
  keepLinkLabels,
  objectRefsInValue,
  hiddenLinkLabels,
  docObjectLinks,
  redactLine,
  redactQuote,
  docReferenceDefinition,
} from "@orbyn/core";

const source =
  '[Guide]: https://example.test/guide "Study guide"\n\nRead [the guide][guide], [Guide][] and [Guide].';

test("full, collapsed and shortcut references share document definitions and original offsets", () => {
  const refs = docReferenceLinks(parseDoc(source));
  const text = "Read [the guide][guide], [Guide][] and [Guide].";
  const links = parseDocInline(text, refs).filter((run) => run.link);
  assert.deepEqual(
    links.map((run) => [run.text, run.start, run.link]),
    [
      ["the guide", 6, "https://example.test/guide"],
      ["Guide", 26, "https://example.test/guide"],
      ["Guide", 40, "https://example.test/guide"],
    ],
  );
});

test("definitions preserve their source, normalize labels and honor the first duplicate", () => {
  const blocks = parseDoc(
    "[Some   Label]: <https://example.test/first>\n[some label]: https://example.test/second\n\n[words][SOME LABEL]",
  );
  assert.equal(
    docReferenceLinks(blocks).get("some label"),
    "https://example.test/first",
  );
  assert.deepEqual(parseDoc(serializeDoc(blocks)), blocks);
});

test("unsafe and missing definitions remain literal, even when a caller supplies an unsafe map", () => {
  const blocks = parseDoc("[bad]: javascript:alert(1)\n\n[bad] [missing]");
  assert.equal(docReferenceLinks(blocks).size, 0);
  assert.deepEqual(
    parseDocInline("[bad]", new Map([["bad", "javascript:alert(1)"]])),
    [{ text: "[bad]", start: 0 }],
  );
});

test("code, math, escapes, frontmatter and fenced examples do not create references", () => {
  const blocks = parseDoc(
    "---\n[meta]: https://example.test/meta\n---\n\n```md\n[code]: https://example.test/code\n```\n\n[guide]: https://example.test/guide",
  );
  const refs = docReferenceLinks(blocks);
  assert.equal(refs.size, 1);
  for (const text of ["`[guide]`", "$[guide]$", "\\[guide]", "![guide][guide]"])
    assert.ok(!parseDocInline(text, refs).some((run) => run.link), text);
});

test("HTML export resolves references through publication link filtering and escapes text", () => {
  const blocks = parseDoc(source);
  assert.match(blocksHtml(blocks), /href="https:\/\/example.test\/guide"/);
  assert.doesNotMatch(blocksHtml(blocks), /\[Guide\]:/);
  assert.match(serializeDoc(blocks), /\[Guide\]:/);
  assert.doesNotMatch(blocksHtml(blocks, { linkUrl: () => null }), /href=/);
});

test("an unsafe first definition cannot be replaced by a later duplicate and definitions are page scoped", () => {
  const refs = docReferenceLinks(
    parseDoc(
      "[guide]: javascript:alert(1)\n[guide]: https://example.test/second",
    ),
  );
  assert.equal(refs.size, 0);
  const other = docReferenceLinks(
    parseDoc("[other]: https://example.test/other"),
  );
  assert.deepEqual(parseDocInline("[guide]", other), [
    { text: "[guide]", start: 0 },
  ]);
});

const PRIVATE_DOC = "11111111-1111-4111-8111-111111111111";
const OPEN_DOC = "44444444-4444-4444-8444-444444444444";
const hidePrivate = (ref: { id: string }) => ref.id === PRIVATE_DOC;
function privatePage() {
  return parseDoc(
    `[Secret budget]: orbyn://doc/${PRIVATE_DOC} "Secret tooltip"\n^definition\n\nRead [Secret budget], [Cost details][Secret budget] and [Secret budget][].\n^paragraph`,
    { anchors: true },
  );
}

test("private reference display words, definition keys and tooltips are all neutral in a read projection", () => {
  const stored = privatePage();
  const visible = redactValue(stored, hidePrivate);
  const markdown = serializeDoc(visible);
  assert.doesNotMatch(markdown, /Secret|Cost details/);
  assert.match(markdown, /Private page/);
  assert.equal(objectRefsInValue(stored)[0].id, PRIVATE_DOC);
  assert.equal(
    docObjectLinks(stored).filter((link) => link.ref.id === PRIVATE_DOC).length,
    2,
  );
  assert.equal(
    hiddenLinkLabels(stored, hidePrivate).get("Cost details"),
    "Private page",
  );
  assert.equal(
    redactValue(stored, () => false),
    stored,
  );
});

test("saving a private read projection restores original reference syntax without overwriting other edits", () => {
  const stored = privatePage();
  const visible = redactValue(stored, hidePrivate);
  assert.deepEqual(keepLinkLabels(visible, stored, hidePrivate), stored);
  const changed = visible.map((block) =>
    block.type === "paragraph" && block.id === "paragraph"
      ? { ...block, text: "Updated: " + block.text }
      : block,
  );
  const restored = keepLinkLabels(changed, stored, hidePrivate);
  assert.equal(restored[1].text, "Updated: " + stored[1].text);
  assert.deepEqual(restored[0], stored[0]);
  assert.equal(
    keepLinkLabels(visible, stored, () => false),
    visible,
  );
});

test("batch redaction and save restoration cannot borrow another page's reference definitions", () => {
  const first = privatePage();
  const second = parseDoc(
    `[Secret budget]: orbyn://doc/${OPEN_DOC}\n\n[Secret budget]`,
  );
  const batch = { pages: [{ content: first }, { content: second }] };
  const shown = redactValue(batch, hidePrivate);
  assert.doesNotMatch(serializeDoc(shown.pages[0].content), /Secret budget/);
  assert.equal(shown.pages[1].content, second);
  assert.deepEqual(keepLinkLabels(shown, batch, hidePrivate), batch);
});

test("reference privacy maps comment positions and restores line-level proposals in the original block", () => {
  const stored = privatePage();
  const original = stored[1].text;
  const visible = redactLine(original, hidePrivate, docReferenceLinks(stored));
  const at = visible.text.indexOf("before");
  assert.equal(visible.toStored(at), original.indexOf("before"));
  assert.equal(visible.toStored(at + 6, true), original.indexOf("before") + 6);
  assert.equal(visible.toShown(original.indexOf("before")), at);
  const proposed = "Updated: " + visible.text;
  assert.equal(
    keepLinkLabels(proposed, stored, hidePrivate, "paragraph"),
    "Updated: " + original,
  );
});

for (const title of [
  '"Secret tooltip"',
  "'Secret tooltip'",
  "(Secret tooltip)",
]) {
  test(`private reference ${title} is protected in detached historical quotes`, () => {
    const stored = parseDoc(
      `[Budget]: orbyn://doc/${PRIVATE_DOC} ${title}\n\n[Budget]`,
    );
    const labels = hiddenLinkLabels(stored, hidePrivate);
    assert.equal(
      docReferenceDefinition(stored[0].text)?.title,
      "Secret tooltip",
    );
    assert.equal(
      redactQuote("See Secret tooltip today", hidePrivate, labels),
      "See Private page today",
    );
    assert.equal(redactQuote("cret tooltip", hidePrivate, labels), null);
  });
}
