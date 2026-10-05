import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assistantSuggestions } from "@orbyn/core";

test("context actions request model output rather than invent personal tasks", () => {
  assert.equal(assistantSuggestions.length, 4);
  const tasks = assistantSuggestions[0];
  assert.ok(tasks.prompt.includes("authorized"));
  assert.ok(tasks.prompt.includes("supporting evidence"));
  assert.ok(tasks.prompt.includes("Cite the sources"));
  assert.ok(tasks.prompt.includes("review before creating"));
  assert.ok(!JSON.stringify(assistantSuggestions).includes("Mum"));
  const reflection = assistantSuggestions[3];
  assert.ok(reflection.prompt.includes("AI-written reflection"));
  assert.ok(reflection.prompt.includes("quote it exactly"));
});

test("both surfaces send the contextual prompt, not just the action label", async () => {
  const desktop = await readFile(
    new URL(
      "../../desktop/src/features/assistant/AssistantView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const mobile = await readFile(
    new URL("../../mobile/src/screens/AssistantScreen.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(desktop.includes('suggest("prompt" in s ? s.prompt : s.title)'));
  assert.ok(mobile.includes("ask(suggestion.prompt)"));
});

test("chat viewport rules outrank workspace padding and obsolete character spacing is removed", async () => {
  const css = await readFile(
    new URL(
      "../../desktop/src/features/assistant/assistant.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(css.includes(".app.workspace .shell > .content:has(.ai-chat)"));
  assert.ok(!css.includes("min-height: 148px"));
  assert.ok(css.includes("align-self: center"));
  assert.ok(css.includes("flex: 0 1 38%"));
});

test("side panels use available chat width and share one open state", async () => {
  const view = await readFile(
    new URL(
      "../../desktop/src/features/assistant/AssistantView.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const css = await readFile(
    new URL(
      "../../desktop/src/features/assistant/assistant.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(view.includes("new ResizeObserver(measure)"));
  assert.ok(view.includes("node.clientWidth < 1280"));
  assert.ok(view.includes("old === next ? null : next"));
  assert.ok(view.includes("inert={compactPanels && !!panel}"));
  assert.ok(view.includes("if (navigationOpen) setPanel(null)"));
  assert.ok(view.includes('aria-label="Close chat history"'));
  assert.ok(view.includes('className="ai-panel-backdrop"'));
  assert.ok(css.includes(".ai-chat.is-compact.has-panel .ai-chat-head"));
  assert.ok(css.includes("width: min(320px, 100%)"));
  assert.ok(!css.includes("width: min(280px, calc(100vw - 56px))"));
});
