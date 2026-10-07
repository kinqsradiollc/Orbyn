import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateManagedControls } from "../src/modules/ai/providers/evaluation.js";
const ai = {
  kind: "openai" as const,
  format: "openai" as const,
  requestFormat: "responses" as const,
  baseUrl: "https://api.openai.com/v1",
  apiKey: "fixture-secret",
  model: "gpt-6.1-sol",
  source: "database" as const,
  providerId: "fixture",
  options: {},
};
test("fixed evaluation exercises all modes without exposing keys or inventing measurements", async (t) => {
  const calls: any[] = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "ORBYN_OK" }],
        },
      ],
    });
  });
  const report = await evaluateManagedControls(ai);
  assert.equal(report.samples.length, 6);
  assert.ok(
    report.samples.every(
      (s) => s.output_check_passed && s.usage?.input_tokens === null,
    ),
  );
  assert.deepEqual(
    report.samples.map((s) => s.mode),
    ["off", "off", "implicit", "implicit", "explicit", "explicit"],
  );
  assert.equal(calls[0].prompt_cache_key, calls[1].prompt_cache_key);
  assert.notEqual(calls[0].prompt_cache_key, calls[2].prompt_cache_key);
  assert.equal(calls[0].prompt_cache_options.mode, "explicit");
  assert.equal(
    calls[4].input[0].content[0].prompt_cache_breakpoint.mode,
    "explicit",
  );
  assert.ok(!JSON.stringify(report).includes("fixture-secret"));
  assert.match(report.limits, /billing are unverified/);
});
test("unsupported/private evaluation refuses before dispatch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw new Error("should not dispatch");
  });
  await assert.rejects(
    evaluateManagedControls({ ...ai, model: "unknown-model" }),
  );
  await assert.rejects(
    evaluateManagedControls({ ...ai, textTransport: async () => "private" }),
  );
  assert.equal(calls, 0);
});
