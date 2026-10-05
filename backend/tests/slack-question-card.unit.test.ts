import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  slackQuestionCard,
  slackQuestionDigest,
} from "../src/modules/agent-channels/question-card.js";
import { slackAgentMessage } from "../src/modules/agent-channels/slack-delivery.js";

const deliveryId = randomUUID();
const question = {
  id: randomUUID(),
  kind: "person" as const,
  question: "Which source?",
  choices: ["First", "Second"],
};
const base = slackAgentMessage({
  event: "waiting",
  appUrl: "https://example.com",
  question: question.question,
});

test("question card displays every choice and only mints exact-delivery option buttons", () => {
  const card = slackQuestionCard(base, deliveryId, question)!;
  assert.ok(card.text.includes(question.question));
  assert.ok(card.text.includes("1. First\n2. Second"));
  assert.ok(card.text.includes("within 15 minutes"));
  assert.ok(!card.text.includes("thread"));
  const actions = card.blocks.at(-1) as {
    elements: { value: string; action_id: string }[];
  };
  assert.deepEqual(
    actions.elements.map((x) => [x.action_id, x.value]),
    [
      ["orbyn.choice.0", deliveryId],
      ["orbyn.choice.1", deliveryId],
    ],
  );
  assert.ok(!JSON.stringify(card).includes("orbyn.approve"));
});
test("free text requires reviewed thread capability and does not render unsupported input blocks", () => {
  const free = { ...question, choices: [] };
  assert.equal(slackQuestionCard(base, deliveryId, free), null);
  const card = slackQuestionCard(base, deliveryId, free, true)!;
  assert.ok(card.text.includes("reply in this message’s thread"));
  assert.equal(card.blocks.length, 2);
  assert.ok(!JSON.stringify(card).includes("plain_text_input"));
  assert.ok(!JSON.stringify(card).includes('"type":"input"'));
});
test("a card cannot bind content that was omitted, truncated or too large to display", () => {
  const card = slackQuestionCard(
    { ...base, text: "Heading" },
    deliveryId,
    question,
  )!;
  assert.ok(card.text.includes(question.question));
  const longChoice = "x".repeat(100);
  const long = slackQuestionCard(base, deliveryId, {
    ...question,
    choices: [longChoice],
  })!;
  assert.ok(long.text.includes(longChoice));
  assert.equal(
    (long.blocks.at(-1) as { elements: { text: { text: string } }[] })
      .elements[0].text.text,
    "Option 1",
  );
  assert.equal(
    slackQuestionCard(base, deliveryId, {
      ...question,
      choices: Array(5).fill("x".repeat(1000)),
    }),
    null,
  );
  assert.equal(slackQuestionCard(base, "invalid", question), null);
  assert.equal(
    slackQuestionCard(base, deliveryId, { ...question, question: "" }),
    null,
  );
  assert.equal(
    slackQuestionCard(base, deliveryId, { ...question, choices: [""] }),
    null,
  );
});
test("binding digest changes with delivery, waiting ID, question, choice contents and order", () => {
  const digest = slackQuestionDigest(deliveryId, question);
  assert.equal(digest.length, 64);
  assert.equal(digest, slackQuestionDigest(deliveryId, { ...question }));
  for (const changed of [
    { ...question, id: randomUUID() },
    { ...question, question: "Changed?" },
    { ...question, choices: ["First", "Changed"] },
    { ...question, choices: [...question.choices].reverse() },
  ])
    assert.notEqual(digest, slackQuestionDigest(deliveryId, changed));
  assert.notEqual(digest, slackQuestionDigest(randomUUID(), question));
});
