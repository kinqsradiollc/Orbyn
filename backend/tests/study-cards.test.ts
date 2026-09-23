import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOZE_BLANK,
  cardsInBlocks,
  clozeCards,
  newCardState,
  projectKnown,
  review,
  type DocBlock,
} from "@orbyn/core";

test("a cloze line makes one card per hidden part", () => {
  assert.deepEqual(clozeCards("The {{leader}} sends {{heartbeats}}."), [
    { question: `The ${CLOZE_BLANK} sends heartbeats.`, answer: "leader" },
    { question: `The leader sends ${CLOZE_BLANK}.`, answer: "heartbeats" },
  ]);
});

test("pages give plain, both-ways and cloze cards with stable keys", () => {
  const blocks: DocBlock[] = [
    {
      type: "bullet",
      id: "b1",
      text: "What is CAP? :: Consistency, availability, partition tolerance",
    },
    { type: "bullet", id: "b2", text: "Raft ::: A consensus algorithm" },
    { type: "paragraph", id: "b3", text: "A {{term}} only increases." },
    { type: "paragraph", text: "Just a sentence." },
  ];
  const cards = cardsInBlocks(blocks);
  assert.deepEqual(
    cards.map((c) => [c.key, c.question, c.answer]),
    [
      ["b1", "What is CAP?", "Consistency, availability, partition tolerance"],
      ["b2", "Raft", "A consensus algorithm"],
      ["b2#r", "A consensus algorithm", "Raft"],
      ["b3#c1", `A ${CLOZE_BLANK} only increases.`, "term"],
    ],
  );
});

test("the exam projection: keeping up gets cards known by the exam", () => {
  const now = new Date("2026-09-01T09:00:00Z");
  const fresh = Array.from({ length: 10 }, () => newCardState(now));
  // Plenty of time: every card is learnt and reviewed until it's stable.
  assert.equal(projectKnown(fresh, new Date("2026-10-15T09:00:00Z"), now), 1);
  // The exam is tomorrow: nothing can be stable for a week by then.
  assert.equal(projectKnown(fresh, new Date("2026-09-02T09:00:00Z"), now), 0);
  // Cards already known stay known.
  let known = newCardState(now);
  for (let i = 0; i < 4; i++)
    known = review(known, "good", new Date(known.due_at));
  assert.equal(projectKnown([known], new Date("2026-09-03T09:00:00Z"), now), 1);
  assert.equal(projectKnown([], new Date(), now), null);
});
