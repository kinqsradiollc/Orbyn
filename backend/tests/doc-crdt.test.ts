import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {
  blocksToYDoc,
  yDocToBlocks,
  loadBlocks,
  yTextOf,
  insertBlock,
  patchBlock,
  encodeYDoc,
  applyYUpdate,
  yStateVector,
  yUpdatesSince,
  mergeYUpdates,
  type DocBlock,
} from "@orbyn/core";

const page: DocBlock[] = [
  { type: "heading", level: 1, text: "Launch brief", id: "b1" },
  { type: "paragraph", text: "Pricing stays **unchanged**.", id: "b2" },
  { type: "todo", text: "Tell the team", done: false, id: "b3" },
  { type: "bullet", text: "Beta on 8 September", depth: 1, id: "b4" },
  { type: "numbered", text: "Then general release", start: 5, id: "b5" },
  { type: "quote", text: "Nothing ships in December.", id: "b6" },
  { type: "code", text: "npm test", lang: "sh", id: "b7" },
  { type: "math", text: "x^2 + y^2", id: "b8" },
  { type: "callout", kind: "tip", text: "Read this first", id: "b9" },
  { type: "table", text: "| a | b |\n| --- | --- |\n| 1 | 2 |", id: "b10" },
  { type: "image", file: "f1", text: "A chart", width: 60, id: "b11" },
  { type: "file", file: "f2", text: "Deck.pdf", id: "b12" },
  { type: "footnote", label: "1", text: "See the plan.", id: "b13" },
  { type: "divider", id: "b14" },
];

/**
 * The rule the whole architecture rests on: every replica grows from the
 * server's snapshot (the genesis update), never from an independent
 * `blocksToYDoc` — two independent histories would treat the same line as
 * two different objects, and one side's edits would be discarded whole.
 */
const genesis = encodeYDoc(blocksToYDoc(page));
const fork = (): Y.Doc => {
  const doc = new Y.Doc();
  applyYUpdate(doc, genesis);
  return doc;
};

test("every kind of line round-trips through the CRDT", () => {
  assert.deepEqual(yDocToBlocks(blocksToYDoc(page)), page);
});

test("a page with unnamed lines is given them, and still round-trips", () => {
  const doc = blocksToYDoc([
    { type: "paragraph", text: "one" },
    { type: "paragraph", text: "two" },
  ]);
  const back = yDocToBlocks(doc);
  assert.equal(back.length, 2);
  for (const block of back) assert.ok(block.id, "each line has an id");
  assert.deepEqual(yDocToBlocks(blocksToYDoc(back)), back);
});

test("two editors editing different lines converge", () => {
  const a = fork();
  const b = fork();
  const ta = yDocToBlocks(a);
  ta[1] = { ...ta[1], type: "paragraph", text: "Pricing changed.", id: "b2" };
  loadBlocks(a, ta);
  const tb = yDocToBlocks(b);
  tb[5] = { ...tb[5], type: "quote", text: "Nothing ships in June.", id: "b6" };
  loadBlocks(b, tb);
  applyYUpdate(a, encodeYDoc(b));
  applyYUpdate(b, encodeYDoc(a));
  assert.deepEqual(yDocToBlocks(a), yDocToBlocks(b));
  const back = yDocToBlocks(a);
  assert.equal(back[1].text, "Pricing changed.");
  assert.equal(back[5].text, "Nothing ships in June.");
});

test("two editors typing in the same line both land, without losing words", () => {
  const a = fork();
  const b = fork();
  // A types at the end of the line, as an editor does: at the character.
  yTextOf(a, "b2")?.insert(28, " until May.");
  // B, who has not seen that, types at the start of the same line.
  yTextOf(b, "b2")?.insert(0, "Our ");
  applyYUpdate(a, encodeYDoc(b));
  applyYUpdate(b, encodeYDoc(a));
  const merged = yDocToBlocks(a);
  assert.deepEqual(yDocToBlocks(b), merged);
  const words = merged[1].text as string;
  assert.equal(words, "Our Pricing stays **unchanged**. until May.");
  for (const word of ["Pricing", "unchanged", "May"]) {
    assert.ok(words.includes(word), `"${word}" survives: ${words}`);
  }
});

test("a line deleted here is gone from every replica, and stays gone", () => {
  const a = fork();
  const b = fork();
  // Both are caught up to the server's version 1.
  loadBlocks(a, page, 1);
  loadBlocks(b, page, 1);
  // A deletes the todo line; the deletion travels as an update.
  const order = a.getMap("doc").get("order") as Y.Array<string>;
  order.delete(2, 1);
  assert.equal(yDocToBlocks(a).length, 13);
  applyYUpdate(b, encodeYDoc(a));
  assert.equal(yDocToBlocks(b).length, 13);
  // A stale copy of version 1 (a refetch, a save that raced) arrives and
  // must be skipped: it still carries the line, but it is old news.
  loadBlocks(b, page, 1);
  assert.equal(yDocToBlocks(b).length, 13);
  // The server's version 2 — saved after the deletion — folds cleanly.
  loadBlocks(
    b,
    page.filter((block) => block.id !== "b3"),
    2,
  );
  assert.equal(yDocToBlocks(b).length, 13);
});

test("lines added at the same moment by different editors both survive", () => {
  const a = fork();
  const b = fork();
  insertBlock(a, 2, { type: "paragraph", text: "A's new line" });
  insertBlock(b, 2, { type: "paragraph", text: "B's new line" });
  applyYUpdate(a, encodeYDoc(b));
  applyYUpdate(b, encodeYDoc(a));
  const merged = yDocToBlocks(a);
  assert.deepEqual(yDocToBlocks(b), merged);
  const texts = merged.map((block) => ("text" in block ? block.text : ""));
  assert.ok(texts.includes("A's new line"));
  assert.ok(texts.includes("B's new line"));
});

test("a tick on one side and words on the other both come through", () => {
  const a = fork();
  const b = fork();
  patchBlock(a, "b3", { done: true });
  patchBlock(b, "b3", { text: "Tell the whole team" });
  applyYUpdate(a, encodeYDoc(b));
  applyYUpdate(b, encodeYDoc(a));
  const merged = yDocToBlocks(a);
  assert.deepEqual(yDocToBlocks(b), merged);
  const line = merged.find((block) => block.id === "b3") as {
    text: string;
    done: boolean;
  };
  assert.equal(line.text, "Tell the whole team");
  assert.equal(line.done, true);
});

test("folding a server copy keeps lines typed since, where they were typed", () => {
  const doc = fork();
  // The server's copy: without the last three lines, and a renamed heading.
  const saved = page
    .slice(0, 11)
    .map((block) =>
      block.id === "b1" ? { ...block, text: "Launch brief (draft)" } : block,
    );
  // Someone typed a line at the top before the save came back.
  insertBlock(doc, 0, { type: "paragraph", text: "Typed just now" });
  loadBlocks(doc, saved, 2);
  const back = yDocToBlocks(doc);
  const texts = back.map((block) => ("text" in block ? block.text : ""));
  assert.ok(texts.includes("Typed just now"), "the typed line survives");
  assert.equal(back[0].text, "Typed just now");
  assert.equal(back[1].id, "b1");
  assert.equal(back[1].text, "Launch brief (draft)");
  assert.equal(back.length, 12);
});

test("updates travel as binary and catch a reader up from a vector", () => {
  const doc = fork();
  const reader = new Y.Doc();
  applyYUpdate(reader, encodeYDoc(doc));
  assert.deepEqual(yDocToBlocks(reader), page);
  // The reader goes away; the page moves on.
  const vector = yStateVector(reader);
  const saved = yDocToBlocks(doc);
  saved[0] = { ...saved[0], text: "Renamed while away", id: "b1" };
  loadBlocks(doc, saved);
  // It comes back and asks only for what it missed.
  applyYUpdate(reader, yUpdatesSince(doc, vector));
  assert.equal(yDocToBlocks(reader)[0].text, "Renamed while away");
  assert.deepEqual(yDocToBlocks(reader), yDocToBlocks(doc));
});

test("an update log folds into one update, and the result still converges", () => {
  const a = fork();
  const b = fork();
  const ta = yDocToBlocks(a);
  ta[1] = { ...ta[1], text: "From A", id: "b2" };
  loadBlocks(a, ta);
  const tb = yDocToBlocks(b);
  tb[3] = { ...tb[3], text: "From B", id: "b4" };
  loadBlocks(b, tb);
  const log = [encodeYDoc(a), encodeYDoc(b)];
  const folded = log.reduce(mergeYUpdates);
  const reader = new Y.Doc();
  applyYUpdate(reader, folded);
  const texts = yDocToBlocks(reader).map((block) =>
    "text" in block ? block.text : "",
  );
  assert.ok(texts.includes("From A"));
  assert.ok(texts.includes("From B"));
});
