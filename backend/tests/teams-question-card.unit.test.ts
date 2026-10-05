import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  teamsQuestionCard,
  teamsQuestionDigest,
} from "../src/modules/agent-channels/teams-question-card.js";
const question = () => ({
  kind: "person" as const,
  id: randomUUID(),
  question: "Which draft?",
  choices: ["First", "Second"],
});
test("Teams card binds the complete question and every choice to its delivery", () => {
  const q = question(),
    delivery = randomUUID(),
    card = teamsQuestionCard(delivery, q)!;
  assert.equal(card.questionDigest, teamsQuestionDigest(delivery, q));
  assert.equal(card.attachment.content.version, "1.2");
  const body = card.attachment.content.body as any[];
  assert.equal(body[0].text, "Which draft?");
  assert.equal(body[1].text, "1\\. First");
  const actions = body.at(-1).actions;
  assert.equal(actions.length, 2);
  for (const [choice, action] of actions.entries()) {
    assert.equal(action.data.choice, choice);
    assert.equal(action.data.waiting_id, q.id);
    assert.equal(action.data.delivery_id, delivery);
    assert.equal(action.data.question_digest, card.questionDigest);
    assert.equal(
      createHash("sha256").update(action.data.card_nonce).digest("hex"),
      card.cardNonceHash,
    );
    assert.deepEqual(action.fallback.data, {
      ...action.data,
      orbyn_action: "orbyn.answer-question",
    });
    assert.equal(action.associatedInputs, "none");
  }
});
test("free answer cards collect only the bounded answer input", () => {
  const card = teamsQuestionCard(randomUUID(), { ...question(), choices: [] })!;
  const body = card.attachment.content.body as any[];
  assert.equal(body.at(-2).id, "answer");
  assert.equal(body.at(-2).maxLength, 4000);
  assert.equal(body.at(-1).actions[0].associatedInputs, "auto");
  assert.equal("choice" in body.at(-1).actions[0].data, false);
});
test("approval, incomplete or overlong questions never receive controls", () => {
  const q = question();
  for (const invalid of [
    { ...q, kind: "approval" },
    { ...q, plan: [] },
    { ...q, question: "" },
    { ...q, question: "a".repeat(1201) },
    { ...q, choices: Array(6).fill("x") },
    { ...q, choices: ["x".repeat(1001)] },
  ])
    assert.equal(teamsQuestionCard(randomUUID(), invalid), null);
  assert.equal(teamsQuestionCard("wrong", q), null);
});
test("fresh nonce for every card and digest changes for every binding change", () => {
  const q = question(),
    id = randomUUID();
  assert.notEqual(
    teamsQuestionCard(id, q)!.cardNonceHash,
    teamsQuestionCard(id, q)!.cardNonceHash,
  );
  const digest = teamsQuestionDigest(id, q);
  for (const changed of [
    { ...q, id: randomUUID() },
    { ...q, question: "Other?" },
    { ...q, choices: ["Second", "First"] },
  ])
    assert.notEqual(teamsQuestionDigest(id, changed), digest);
  assert.notEqual(teamsQuestionDigest(randomUUID(), q), digest);
});
test("question markup is displayed literally and UTF8 payload bounds never truncate", () => {
  const card = teamsQuestionCard(randomUUID(), {
    ...question(),
    question: "[Click](https://evil.invalid) **Hi**",
  })!;
  assert.match((card.attachment.content.body[0] as any).text, /^\\\[Click\\\]/);
  const large = {
    ...question(),
    question: "\\".repeat(1200),
    choices: Array(5).fill("\\".repeat(1000)),
  };
  assert.equal(teamsQuestionCard(randomUUID(), large), null);
});
