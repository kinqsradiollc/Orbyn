import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRichText, parseInline, proposalNote } from "@orbyn/core";

test("assistant replies become headings, lists and inline styles", () => {
  const blocks = parseRichText(
    "Here's your week.\n\n**Tasks and events**\n\n* **Call Mum** (task) - due Friday\n* **Test** (event)\n\n1. First\n2. Second\n---\nRegarding the second part of your request, **",
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["paragraph", "heading", "list", "list", "paragraph"],
  );
  const bullets = blocks[2] as {
    ordered: boolean;
    items: { text: string; bold?: boolean }[][];
  };
  assert.equal(bullets.ordered, false);
  assert.deepEqual(bullets.items[0][0], { text: "Call Mum", bold: true });
  assert.equal((blocks[3] as { ordered: boolean }).ordered, true);
  // A reply cut off mid-bold shows no stray markers.
  assert.equal(
    (blocks[4] as { inlines: { text: string }[] }).inlines
      .map((i) => i.text)
      .join(""),
    "Regarding the second part of your request, ",
  );
  assert.deepEqual(parseInline("use `code` and *this*"), [
    { text: "use " },
    { text: "code", code: true },
    { text: " and " },
    { text: "this", italic: true },
  ]);
});

test("earlier proposals are summarised for the model with their outcome", () => {
  assert.equal(proposalNote([], "applied"), "");
  assert.equal(
    proposalNote([{ operation: "delete", item_id: "x" }], "applied", {
      x: "Call Mum",
    }),
    '(Proposed changes: delete "Call Mum". The user approved them and they are saved.)',
  );
  assert.match(
    proposalNote(
      [{ operation: "create", data: { title: "Gym" } }],
      "discarded",
    ),
    /discarded them, so nothing changed/,
  );
});

test("Markdown tables become a header and rows", () => {
  const blocks = parseRichText(
    "Your week:\n\n| Day | Plan |\n|---|:---:|\n| **Fri** | Call Mum |\n| Sat | Gym | extra |\n\nThat's it.",
  );
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["paragraph", "table", "paragraph"],
  );
  const table = blocks[1] as {
    header: { text: string }[][];
    rows: { text: string; bold?: boolean }[][][];
  };
  assert.deepEqual(
    table.header.map((c) => c[0].text),
    ["Day", "Plan"],
  );
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0][0][0], { text: "Fri", bold: true });
  assert.equal(
    table.rows[1].length,
    2,
    "extra cells are trimmed to the header",
  );
});
