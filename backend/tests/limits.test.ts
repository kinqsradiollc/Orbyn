import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDERS } from "@orbyn/core";
const { buildMessages } = await import("../src/modules/ai/provider.js");

const items = Array.from({ length: 100 }, (_, n) => ({
  id: `item-${n}`,
  title: `Task ${n} ` + "x".repeat(300),
  notes: "y".repeat(200),
}));
const history = Array.from({ length: 12 }, (_, n) => ({
  role: (n % 2 ? "assistant" : "user") as "user" | "assistant",
  content: `turn ${n} ` + "z".repeat(20_000),
}));

test("Maincode requests are trimmed to its 64 KiB and 16,000-character limits", () => {
  const limits = AI_PROVIDERS.maincode.limits!;
  assert.deepEqual(limits, { maxBodyBytes: 65_536, maxMessageChars: 16_000 });
  const messages = buildMessages(
    { model: "matilda", limits },
    "What is due this week?",
    "Australia/Melbourne",
    items,
    history,
  );
  for (const m of messages)
    assert.ok(m.content.length <= limits.maxMessageChars, `${m.role} too long`);
  const body = JSON.stringify({ model: "matilda", messages });
  assert.ok(Buffer.byteLength(body) <= limits.maxBodyBytes);
  assert.equal(messages[0].role, "system");
  const last = JSON.parse(messages.at(-1)!.content);
  assert.equal(last.request, "What is due this week?");
  assert.ok(last.planner.length > 0 && last.planner.length < items.length);
  assert.match(last.planner_note, /of 100 items/);
  // Oldest history is dropped first; what remains is the most recent.
  const kept = messages.slice(1, -1);
  if (kept.length) assert.match(kept.at(-1)!.content, /^turn 11 /);
});

test("providers without limits get the full planner and history", () => {
  const messages = buildMessages({ model: "gpt" }, "Hi", "UTC", items, history);
  assert.equal(messages.length, 14);
  assert.equal(JSON.parse(messages.at(-1)!.content).planner.length, 100);
  assert.equal(messages[1].content, history[0].content);
});
