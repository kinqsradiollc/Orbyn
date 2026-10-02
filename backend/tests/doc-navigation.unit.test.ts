import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docLinkDestination,
  docHeadingAnchors,
  docFragmentIndex,
  docFoldsForTarget,
  blocksHtml,
  docToHtml,
  appPath,
  appLinkFragment,
  parseAppLink,
  type DocBlock,
} from "@orbyn/core";
import {
  deepLinkOf,
  deepLinkOfUrl,
  deepLinkPath,
  fromAppLink,
} from "../../desktop/src/app/deep-link.js";

const id = "0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11";

test("Unicode and long heading fragments round-trip through mobile and desktop app links", () => {
  for (const block of [
    "résumé",
    "研究结果",
    "re\u0301sume\u0301",
    "heading-" + "a".repeat(100),
  ]) {
    const path = appPath({ kind: "doc", id, block });
    const url = new URL(path, "https://notes.example.test");
    const mobile = { kind: "doc" as const, id, block };
    const desktop = { kind: "doc" as const, id, block };
    assert.equal(appLinkFragment(url.hash), block);
    assert.deepEqual(parseAppLink(url.href), mobile);
    assert.deepEqual(parseAppLink(`orbyn://doc/${id}${url.hash}`), mobile);
    assert.deepEqual(deepLinkOf(url.pathname, url.hash), desktop);
    assert.deepEqual(deepLinkOfUrl(url.href), desktop);
    assert.deepEqual(fromAppLink(mobile), desktop);
    assert.equal(deepLinkPath(desktop), path);
    const destination = docLinkDestination(path, url.origin);
    assert.equal(destination?.kind, "app");
    assert.deepEqual(
      parseAppLink(destination?.kind === "app" ? destination.url : ""),
      mobile,
    );
  }
});

test("app heading fragments remain bounded and reject malformed or unsafe forms", () => {
  for (const hash of [
    "#",
    "#%ZZ",
    "#%00",
    "#not%20a%20line",
    "#%2Fpath",
    "#" + "a".repeat(513),
    "#%ED%A0%80",
  ]) {
    assert.equal(appLinkFragment(hash), null, hash);
    assert.deepEqual(deepLinkOf(`/app/doc/${id}`, hash), {
      kind: "doc",
      id,
      block: null,
    });
    assert.deepEqual(
      parseAppLink(`https://notes.example.test/app/doc/${id}${hash}`),
      { kind: "doc", id },
    );
  }
  for (const block of [
    "not a line",
    "a".repeat(513),
    "bad\nheading",
    "unsafe#fragment",
  ]) {
    assert.equal(appPath({ kind: "doc", id, block }), `/app/doc/${id}`);
  }
});
test("document links resolve local app routes and external relative resources safely", () => {
  const origin = "https://notes.example.test";
  assert.deepEqual(docLinkDestination(`/app/doc/${id}#b1`, origin), {
    kind: "app",
    url: `${origin}/app/doc/${id}#b1`,
  });
  assert.deepEqual(docLinkDestination(`${origin}/app/task/${id}`, origin), {
    kind: "app",
    url: `${origin}/app/task/${id}`,
  });
  assert.deepEqual(
    docLinkDestination(`https://other.test/app/doc/${id}`, origin),
    { kind: "external", url: `https://other.test/app/doc/${id}` },
  );
  assert.deepEqual(docLinkDestination("/help", origin), {
    kind: "external",
    url: `${origin}/help`,
  });
  assert.deepEqual(docLinkDestination("mailto:help@example.test", origin), {
    kind: "external",
    url: "mailto:help@example.test",
  });
  assert.deepEqual(docLinkDestination("#r%C3%A9sum%C3%A9", origin), {
    kind: "fragment",
    fragment: "résumé",
  });
  assert.deepEqual(docLinkDestination(`orbyn://doc/${id}`, null), {
    kind: "app",
    url: `orbyn://doc/${id}`,
  });
  assert.equal(docLinkDestination("/help", null), null);
  for (const href of [
    "//evil.test",
    "/\\evil.test",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "#%00",
    "#%ZZ",
  ])
    assert.equal(docLinkDestination(href, origin), null, href);
});

test("navigation unfolds nested covering sections and preserves unrelated folds", () => {
  const blocks: DocBlock[] = [
    { type: "heading", level: 1, text: "First", id: "first" },
    { type: "heading", level: 2, text: "Nested", id: "nested" },
    { type: "paragraph", text: "Target", id: "target" },
    { type: "heading", level: 1, text: "Second", id: "second" },
    { type: "paragraph", text: "Other" },
  ];
  const folds = new Set(["first", "nested", "second"]);
  assert.deepEqual([...docFoldsForTarget(blocks, folds, 2)], ["second"]);
  assert.deepEqual(
    [...docFoldsForTarget(blocks, folds, 1)],
    ["nested", "second"],
  );
  assert.deepEqual(
    [...docFoldsForTarget(blocks, folds, 4)],
    ["first", "nested"],
  );
  assert.deepEqual(
    [...folds],
    ["first", "nested", "second"],
    "navigation does not mutate persisted state",
  );
});

test("heading navigation handles duplicates, Unicode, explicit IDs and exported outline anchors", () => {
  const blocks: DocBlock[] = [
    { type: "heading", level: 1, text: "**A plan** & `code`", id: "b1" },
    { type: "paragraph", text: "Middle", id: "line-2" },
    { type: "heading", level: 2, text: "A plan & code" },
    { type: "heading", level: 3, text: "Résumé 中文" },
    { type: "heading", level: 2, text: "!!!" },
  ];
  assert.deepEqual(
    [...docHeadingAnchors(blocks).values()],
    ["a-plan--code", "a-plan--code-1", "résumé-中文", "section"],
  );
  assert.equal(docFragmentIndex(blocks, "b1"), 0);
  assert.equal(docFragmentIndex(blocks, "line-2"), 1);
  assert.equal(docFragmentIndex(blocks, "a-plan--code-1"), 2);
  assert.equal(docFragmentIndex(blocks, "h-3"), 3);
  assert.equal(docFragmentIndex(blocks, "résumé-中文"), 3);
  assert.equal(docFragmentIndex(blocks, "h-1"), null);
  assert.equal(docFragmentIndex(blocks, "missing"), null);
});

test("HTML heading links resolve without publishing private resource links", () => {
  const blocks: DocBlock[] = [
    {
      type: "paragraph",
      text: "[Go to result](#result) [Stored heading](#heading-id) [Missing](#missing)",
    },
    { type: "heading", level: 2, text: "Result", id: "heading-id" },
    { type: "paragraph", text: `[Private page](orbyn://doc/${id})` },
  ];
  const published = blocksHtml(blocks, { anchors: true, linkUrl: () => null });
  assert.match(published, /href="#h-1">Go to result/);
  assert.match(published, /href="#h-1">Stored heading/);
  assert.match(published, /<h2 id="h-1">Result/);
  assert.ok(!published.includes('href="#missing"'));
  assert.ok(!published.includes("orbyn://"));
  assert.match(docToHtml("Navigation", blocks), /href="#h-1">Go to result/);
});
