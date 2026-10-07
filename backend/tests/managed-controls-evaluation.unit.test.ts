import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateManagedControls,
  estimatedInputCostUnits,
} from "../src/modules/ai/providers/evaluation.js";
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
  assert.ok(report.samples.every((s) => s.estimated_input_cost_units === null));
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

const observed = {
  input_tokens: 2000,
  output_tokens: 1,
  reasoning_tokens: null,
  cached_input_tokens: 0,
  cache_write_tokens: 0,
};
test("Sol estimate charges writes and discounted reads without double-counting", () => {
  assert.equal(estimatedInputCostUnits("gpt-6.1-sol", observed), 2000);
  assert.equal(
    estimatedInputCostUnits("gpt-6.1-sol", {
      ...observed,
      cache_write_tokens: 2000,
    }),
    2500,
  );
  assert.equal(
    estimatedInputCostUnits("gpt-6.1-sol", {
      ...observed,
      cached_input_tokens: 2000,
    }),
    100,
  );
  assert.equal(
    estimatedInputCostUnits("gpt-6.1-sol", {
      ...observed,
      cached_input_tokens: 1000,
      cache_write_tokens: 500,
    }),
    1175,
  );
  assert.equal(
    estimatedInputCostUnits("gpt-6.1-sol", { ...observed, input_tokens: 0 }),
    0,
  );
});
test("input cost stays unknown for absent, invalid, contradictory or unmapped observations", () => {
  assert.equal(estimatedInputCostUnits("gpt-6.1-sol", null), null);
  assert.equal(estimatedInputCostUnits("gpt-6-astra", observed), null);
  for (const field of [
    "input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
  ] as const)
    for (const value of [null, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.equal(
        estimatedInputCostUnits("gpt-6.1-sol", { ...observed, [field]: value }),
        null,
      );
  assert.equal(
    estimatedInputCostUnits("gpt-6.1-sol", {
      ...observed,
      cached_input_tokens: 1500,
      cache_write_tokens: 1000,
    }),
    null,
  );
});
test("fixed report derives its estimate only from returned usage", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "ORBYN_OK" }],
        },
      ],
      usage: {
        input_tokens: 2000,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 500 },
      },
    }),
  );
  const report = await evaluateManagedControls(ai);
  assert.ok(report.samples.every((s) => s.estimated_input_cost_units === 1175));
  assert.match(report.input_cost_estimate.excludes, /actual billing/);
});
