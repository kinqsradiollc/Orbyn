import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDoc,
  parseDocInline,
  blocksHtml,
  docReferenceDefinition,
  docReferenceLinks,
  docReferenceEntries,
  docReferenceMap,
  redactValue,
} from "@orbyn/core";

for (const title of [
  '"Read <first> & second"',
  "'Read <first> & second'",
  "(Read <first> & second)",
]) {
  test(`reference title ${title} reaches full, collapsed and shortcut links`, () => {
    const blocks = parseDoc(
      `[Guide]: https://example.test/guide ${title}\n\n[words][guide] [Guide][] [Guide]`,
    );
    const references = docReferenceLinks(blocks);
    const links = parseDocInline(blocks[1].text!, references).filter(
      (run) => run.link,
    );
    assert.deepEqual(
      links.map((run) => run.linkTitle),
      Array(3).fill("Read <first> & second"),
    );
    assert.deepEqual(
      links.map((run) => run.start),
      [1, 16, 26],
    );
    const html = blocksHtml(blocks);
    assert.equal(
      (html.match(/title="Read &lt;first&gt; &amp; second"/g) ?? []).length,
      3,
    );
    assert.ok(!html.includes("<first>"));
    assert.ok(!blocksHtml(blocks, { linkUrl: () => null }).includes("title="));
  });
}

test("balanced and escaped destinations and titles use the same source-preserving scanner", () => {
  assert.deepEqual(
    docReferenceDefinition(
      String.raw`[Guide]: https://example.test/a(b)c "A \"quote\""`,
    ),
    { label: "Guide", href: "https://example.test/a(b)c", title: 'A "quote"' },
  );
  assert.deepEqual(
    docReferenceDefinition('[Guide]: <https://example.test/a\\(b\\)c> ""'),
    { label: "Guide", href: "https://example.test/a(b)c", title: "" },
  );
  assert.equal(
    docReferenceDefinition('[Guide]: https://example.test/a(b "truncated"'),
    null,
  );
});

test("portable context preserves titles without borrowing one after destination mutation", () => {
  const references = docReferenceLinks(
    parseDoc(
      '[Guide]: https://example.test/first "First"\n\n[guide]: https://example.test/second "Second"',
    ),
  );
  const entries = docReferenceEntries(references);
  assert.deepEqual(entries, [["guide", "https://example.test/first", "First"]]);
  assert.equal(
    parseDocInline("[Guide]", docReferenceMap(entries))[0].linkTitle,
    "First",
  );
  references.set("guide", "https://example.test/changed");
  assert.equal(parseDocInline("[Guide]", references)[0].linkTitle, undefined);
  assert.deepEqual(docReferenceEntries(references), [
    ["guide", "https://example.test/changed"],
  ]);
  assert.equal(
    parseDocInline(
      "[Guide]",
      new Map([["guide", "https://example.test/first"]]),
    )[0].linkTitle,
    undefined,
  );
});

test("unsafe first definitions cannot lend titles to later safe duplicates", () => {
  const references = docReferenceLinks(
    parseDoc(
      '[Guide]: javascript:alert(1) "Unsafe"\n\n[guide]: https://example.test/safe "Safe"',
    ),
  );
  assert.equal(references.size, 0);
  assert.deepEqual(parseDocInline("[Guide]", references), [
    { text: "[Guide]", start: 0 },
  ]);
});

test("private reference titles remain absent from authorized render and portable context", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const stored = parseDoc(
    `[Secret]: orbyn://doc/${id} "Hidden tooltip"\n\n[Secret]`,
  );
  const visible = redactValue(stored, (ref) => ref.id === id);
  assert.doesNotMatch(
    JSON.stringify(docReferenceEntries(docReferenceLinks(visible))),
    /Secret|Hidden tooltip/,
  );
  assert.doesNotMatch(blocksHtml(visible), /Secret|Hidden tooltip/);
  assert.equal(
    parseDocInline("[Secret]", docReferenceLinks(stored))[0].linkTitle,
    "Hidden tooltip",
  );
});
