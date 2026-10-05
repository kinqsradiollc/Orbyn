import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaRewriteFeedback } from "@orbyn/core";

test("Agenda feedback identifies a completed ChatGPT summary", () => {
  assert.equal(
    agendaRewriteFeedback({
      brief: true,
      briefing: {
        status: "completed",
        provider: {
          source: "chatgpt",
          model: "selected-model",
          fallback: false,
        },
      },
    }),
    "Agenda updated · ChatGPT · selected-model",
  );
});
test("Agenda feedback identifies the actual consented fallback", () => {
  assert.equal(
    agendaRewriteFeedback({
      brief: true,
      briefing: {
        status: "completed",
        provider: {
          source: "default",
          model: "workspace-model",
          fallback: true,
        },
      },
    }),
    "Agenda updated · Orbyn fallback · workspace-model",
  );
});
test("Agenda feedback separates the successful calendar rewrite from a failed summary", () => {
  assert.equal(
    agendaRewriteFeedback({
      brief: false,
      briefing: {
        status: "failed",
        message: "ChatGPT plan usage limit reached. Manage usage in ChatGPT.",
      },
    }),
    "Calendar updated. ChatGPT plan usage limit reached. Manage usage in ChatGPT.",
  );
});
test("Agenda feedback remains compatible with responses without summary metadata", () => {
  assert.equal(
    agendaRewriteFeedback({ brief: false }),
    "Agenda updated from your calendar.",
  );
  assert.equal(
    agendaRewriteFeedback({ brief: true }),
    "Agenda updated with an AI summary.",
  );
});
