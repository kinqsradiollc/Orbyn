import { test } from "node:test";
import assert from "node:assert/strict";
import {
  keepLinkLabels,
  objectRefsInValue,
  PRIVATE_LINK_LABELS,
  redactLine,
  redactLinkLabels,
  redactValue,
  type ObjectRef,
} from "@orbyn/core";

/**
 * D3aF: the words of a link to something the reader can't open are shown as
 * "Private page" / "Private task" / "Private project", while the page keeps
 * them. These are the pure pieces every server path shares.
 */

const DOC = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const OPEN = "44444444-4444-4444-8444-444444444444";

const hideAllBut =
  (...open: string[]) =>
  (ref: ObjectRef) =>
    !open.includes(ref.id);

test("each kind has a neutral label that says nothing about the target", () => {
  assert.equal(PRIVATE_LINK_LABELS.doc, "Private page");
  assert.equal(PRIVATE_LINK_LABELS.task, "Private task");
  assert.equal(PRIVATE_LINK_LABELS.project, "Private project");
  for (const label of Object.values(PRIVATE_LINK_LABELS))
    assert.doesNotMatch(label, /[0-9a-f]{8}/);
});

test("hidden links lose their words; open ones, dates and plain links keep them", () => {
  const line =
    `See [Budget 2027](orbyn://doc/${DOC}), [Ship it](orbyn://task/${TASK}), ` +
    `[Moonshot](orbyn://project/${PROJECT}), [Lab notes](orbyn://doc/${OPEN}), ` +
    `[the day](orbyn://date/2026-10-02) and [a site](https://example.com).`;
  const out = redactLinkLabels(line, hideAllBut(OPEN));
  assert.equal(
    out,
    `See [Private page](orbyn://doc/${DOC}), [Private task](orbyn://task/${TASK}), ` +
      `[Private project](orbyn://project/${PROJECT}), [Lab notes](orbyn://doc/${OPEN}), ` +
      `[the day](orbyn://date/2026-10-02) and [a site](https://example.com).`,
  );
  // A link to one line of a hidden page is hidden too.
  assert.equal(
    redactLinkLabels(`[Costs](orbyn://doc/${DOC}#b1)`, hideAllBut()),
    `[Private page](orbyn://doc/${DOC}#b1)`,
  );
  // Nothing hidden: the very same string comes back.
  assert.equal(
    redactLinkLabels(line, () => false),
    line,
  );
});

test("a value is copied only where a string changed", () => {
  const blocks = [
    { type: "paragraph", id: "b1", text: `[Budget](orbyn://doc/${DOC})` },
    { type: "paragraph", id: "b2", text: "No links here" },
    {
      type: "table",
      id: "b3",
      rows: [[`[Ship it](orbyn://task/${TASK})`, "x"]],
    },
  ];
  const out = redactValue(blocks, hideAllBut());
  assert.notEqual(out, blocks);
  assert.equal(out[1], blocks[1], "unchanged lines are shared");
  assert.equal(out[0].text, `[Private page](orbyn://doc/${DOC})`);
  assert.deepEqual((out[2] as { rows: string[][] }).rows[0], [
    `[Private task](orbyn://task/${TASK})`,
    "x",
  ]);
  assert.equal(blocks[0].text, `[Budget](orbyn://doc/${DOC})`, "not in place");
  assert.equal(
    redactValue(blocks, () => false),
    blocks,
  );
  assert.deepEqual(
    objectRefsInValue(blocks).map((r) => r.kind),
    ["doc", "task"],
  );
});

test("places carry between the stored line and the one shown", () => {
  const stored = `Ask [Budget 2027](orbyn://doc/${DOC}) about fees`;
  const line = redactLine(stored, hideAllBut());
  assert.equal(line.changed, true);
  assert.equal(line.text, `Ask [Private page](orbyn://doc/${DOC}) about fees`);
  // "fees" after the link, as the reader counted it.
  const at = line.text.indexOf("fees");
  const back = line.toStored(at);
  assert.equal(stored.slice(back, back + 4), "fees");
  assert.equal(line.toShown(back), at);
  // Before the link nothing moves.
  assert.equal(line.toStored(1), 1);
  // Inside the link's words: the whole of them.
  const inside = line.text.indexOf("Private") + 3;
  assert.equal(line.toStored(inside), stored.indexOf("Budget"));
  assert.equal(
    line.toStored(inside, true),
    stored.indexOf("Budget") + "Budget 2027".length,
  );
  // A range ending right where the words start stays before them.
  const start = line.text.indexOf("Private");
  assert.equal(line.toStored(start, true), stored.indexOf("Budget"));
});

test("a save of the words shown puts the page's own words back", () => {
  const stored = [
    { type: "paragraph", id: "b1", text: `[Budget 2027](orbyn://doc/${DOC})` },
    { type: "paragraph", id: "b2", text: `[Ship it](orbyn://task/${TASK})` },
  ];
  const shown = redactValue(stored, hideAllBut());
  const edited = [
    { ...shown[0], text: `${shown[0].text} and more` },
    shown[1],
    // A new line that repeats a hidden link keeps its title too.
    {
      type: "paragraph",
      id: "b3",
      text: `Again [Private page](orbyn://doc/${DOC})`,
    },
  ];
  const kept = keepLinkLabels(edited, stored);
  assert.equal(kept[0].text, `[Budget 2027](orbyn://doc/${DOC}) and more`);
  assert.equal(kept[1].text, `[Ship it](orbyn://task/${TASK})`);
  assert.equal(kept[2].text, `Again [Budget 2027](orbyn://doc/${DOC})`);
  // A link the page never had keeps what was written.
  const fresh = [
    { type: "paragraph", text: `[Private task](orbyn://task/${PROJECT})` },
  ];
  assert.equal(keepLinkLabels(fresh, stored), fresh);
  // Words a person wrote themselves are theirs.
  const renamed = [
    { ...stored[0], text: `[Budget, final](orbyn://doc/${DOC})` },
  ];
  assert.deepEqual(keepLinkLabels(renamed, stored), renamed);
});
