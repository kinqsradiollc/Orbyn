import { test } from "node:test";
import assert from "node:assert/strict";
import { mayChange, wantsAdvice } from "../src/modules/ai/guards.js";

test("the assistant stages changes only for requests that ask for them", () => {
  for (const message of [
    "Add milk",
    "Can you move my dentist to Friday?",
    "Dinner with Sam Thursday 7pm",
    "Push watering the plants to next week",
    "The oral defence is done",
    "I finished the report",
    "The team meeting got cancelled",
  ])
    assert.equal(mayChange(message), true, message);

  for (const message of [
    "What's the secret launch plan about?",
    "What's due on Friday?",
    "Is the gym on Friday?",
    "Summarize my week",
    "Show me what's due next week",
    "What did I finish this week?",
  ])
    assert.equal(mayChange(message), false, message);
});

test("advice stays read-only unless the person also asks for a change", () => {
  for (const message of [
    "Help me prioritize",
    "What should I do first?",
    "Which task should I work on next?",
    "What needs my attention?",
  ]) {
    assert.equal(wantsAdvice(message), true, message);
    assert.equal(mayChange(message), false, message);
  }
  assert.equal(
    wantsAdvice("What should I do first and move the rest to next week?"),
    false,
  );
  assert.equal(
    mayChange("What should I do first and move the rest to next week?"),
    true,
  );
});
