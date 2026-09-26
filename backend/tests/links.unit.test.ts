import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blocksWithWebLinks,
  dateOptions,
  dateTitle,
  docObjectLinks,
  insertLink,
  linkContext,
  linkMarkdown,
  linkQueryAt,
  linkResolveQuery,
  parseDoc,
  parseDocInline,
  parseObjectHref,
  serializeDoc,
  snippetRuns,
  webLinks,
  type DocBlock,
} from "@orbyn/core";

/** Links made with the link picker, as the pages keep them (D3a). */

const PAGE = "0b7f6d1e-3c1a-4f7e-9d59-2f0a4b6c8e11";
const TASK = "5e3c2a10-7b4d-4a8e-9c1f-6d2e8b0a4c33";

test("a link is an ordinary Markdown link to orbyn://", () => {
  const md = linkMarkdown({ kind: "doc", id: PAGE }, "Lab 3 notes");
  assert.equal(md, `[Lab 3 notes](orbyn://doc/${PAGE})`);
  const [run] = parseDocInline(md);
  assert.equal(run.text, "Lab 3 notes");
  assert.deepEqual(parseObjectHref(run.link), { kind: "doc", id: PAGE });
  // Titles can't break out of the brackets or style the pill.
  assert.equal(
    linkMarkdown({ kind: "task", id: TASK }, "Fix [this] **now**\nplease"),
    `[Fix (this) now please](orbyn://task/${TASK})`,
  );
  assert.equal(parseObjectHref("orbyn://folder/" + PAGE), null);
  assert.equal(parseObjectHref("orbyn://doc/nope"), null);
  assert.equal(parseObjectHref("https://example.com"), null);
  assert.deepEqual(parseObjectHref("orbyn://date/2026-09-26"), {
    kind: "date",
    id: "2026-09-26",
  });
});

test("links survive the page's Markdown both ways, and never look like [[ ]]", () => {
  const blocks: DocBlock[] = [
    {
      type: "paragraph",
      text: `Read ${linkMarkdown({ kind: "doc", id: PAGE }, "Lab")} first`,
    },
    {
      type: "todo",
      text: `Do ${linkMarkdown({ kind: "task", id: TASK }, "the report")}`,
      done: false,
    },
  ];
  const md = serializeDoc(blocks);
  assert.ok(!md.includes("[["));
  assert.deepEqual(parseDoc(md), blocks);
  // Search's [[ ]] snippet markers still read as matches, not links.
  assert.deepEqual(snippetRuns("a [[lab]] b"), [
    { text: "a ", hit: false },
    { text: "lab", hit: true },
    { text: " b", hit: false },
  ]);
});

test("docObjectLinks finds each link once per line, and none in code", () => {
  const link = linkMarkdown({ kind: "doc", id: PAGE }, "Lab");
  const found = docObjectLinks([
    { type: "paragraph", text: `${link} and ${link}`, id: "a" },
    { type: "code", lang: "", text: link },
    { type: "bullet", text: `[x](orbyn://event/${TASK})` },
  ]);
  assert.deepEqual(
    found.map((f) => [f.block, f.ref.kind]),
    [
      ["a", "doc"],
      ["#2", "event"],
    ],
  );
});

test("linkContext picks the linked words out of the line", () => {
  const line = `Before the lab, read ${linkMarkdown({ kind: "doc", id: PAGE }, "Lab 3 notes")} and **bring** goggles`;
  assert.deepEqual(linkContext(line, { kind: "doc", id: PAGE }), {
    before: "Before the lab, read ",
    linked: "Lab 3 notes",
    after: " and bring goggles",
  });
  // A task linked as an event is the same thing.
  const ev = `See [x](orbyn://event/${TASK})`;
  assert.equal(linkContext(ev, { kind: "task", id: TASK }).linked, "x");
  // No link to it: the line's words.
  assert.deepEqual(linkContext("Draft the *method*", null), {
    before: "Draft the method",
    linked: "",
    after: "",
  });
  const long = "word ".repeat(80);
  assert.ok(linkContext(long, null).before.length <= 141);
});

test("[[ opens the picker until a ], a new line or 60 characters", () => {
  assert.deepEqual(linkQueryAt("Read [[lab", 10), { start: 5, query: "lab" });
  assert.deepEqual(linkQueryAt("[[", 2), { start: 0, query: "" });
  assert.equal(linkQueryAt("Read [[lab]] x", 14), null);
  assert.equal(linkQueryAt("no brackets", 5), null);
  assert.equal(linkQueryAt(`[[${"x".repeat(61)}`, 63), null);
  const put = insertLink(
    "Read [[lab now",
    5,
    10,
    { kind: "doc", id: PAGE },
    "Lab 3",
  );
  assert.equal(put.text, `Read [Lab 3](orbyn://doc/${PAGE}) now`);
  assert.equal(put.text.slice(put.caret), "now");
});

test("dates in the picker", () => {
  const now = new Date(2026, 8, 26, 10); // Saturday 26 September 2026
  assert.equal(dateTitle("2026-09-26"), "Sat 26 Sep 2026");
  assert.deepEqual(
    dateOptions("tom", now).map((o) => o.id),
    ["2026-09-27"],
  );
  assert.deepEqual(
    dateOptions("fri", now).map((o) => o.id),
    ["2026-10-02"],
  );
  assert.deepEqual(
    dateOptions("sat", now).map((o) => o.id),
    ["2026-10-03"],
    "the next one, not today",
  );
  assert.deepEqual(
    dateOptions("2026-12-01", now).map((o) => o.title),
    ["Tue 1 Dec 2026"],
  );
  assert.deepEqual(dateOptions("2026-13-01", now), []);
  assert.deepEqual(dateOptions("", now), []);
});

test("export makes pages, tasks and projects web links; people and dates words", () => {
  const text = `${linkMarkdown({ kind: "doc", id: PAGE }, "Lab")} by [Sam](orbyn://person/${TASK}) on [d](orbyn://date/2026-09-26), [e](orbyn://event/${TASK})`;
  assert.equal(
    webLinks(text, "https://orbyn.dev/"),
    `[Lab](https://orbyn.dev/app/doc/${PAGE}) by Sam on Sat 26 Sep 2026, [e](https://orbyn.dev/app/task/${TASK})`,
  );
  const code: DocBlock = { type: "code", lang: "", text };
  assert.deepEqual(blocksWithWebLinks([code], "https://x"), [code]);
});

test("resolve takes at most 60 known links", () => {
  const ok = linkResolveQuery.parse({
    refs: `doc:${PAGE},date:2026-09-26,event:${TASK.toUpperCase()}`,
  });
  assert.deepEqual(ok.refs[2], { kind: "event", id: TASK });
  assert.throws(() => linkResolveQuery.parse({ refs: "doc:1" }));
  assert.throws(() =>
    linkResolveQuery.parse({
      refs: Array.from({ length: 61 }, () => `doc:${PAGE}`).join(","),
    }),
  );
});

test("the page's last line says how many places link to it", async () => {
  const { pageFooter } = await import("@orbyn/core");
  assert.equal(
    pageFooter({ words: 1204, minutes: 5, linked: 3 }),
    "1,204 words · 5 min read · 3 linked here",
  );
  assert.equal(pageFooter({ words: 1, minutes: 0, linked: 0 }), "1 word");
});
