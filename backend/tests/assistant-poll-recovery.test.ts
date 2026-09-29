import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
import { HttpError } from "@orbyn/core";

for (const failure of [429, 500, "network"] as const) {
  test(`run polling recovers from ${failure} without starting another run`, async () => {
    const paths: string[] = [];
    const client = new OrbynClient({
      baseUrl: "http://orbyn.test",
      getToken: () => null,
      fetch: async (input) => {
        paths.push(String(input));
        if (paths.length <= (failure === "network" ? 2 : 1)) {
          if (failure === "network") throw new TypeError("Connection dropped");
          return Response.json(
            { message: "Temporary failure" },
            { status: failure },
          );
        }
        return Response.json({ state: "done", answer: "Saved answer" });
      },
    });
    const result = await client.pollAssistantRun("existing-run", {
      chatId: "existing-chat",
      turnId: "existing-turn",
    });
    assert.equal(result.answer, "Saved answer");
    assert.ok(paths.length >= 2);
    assert.ok(paths.every((path) => path.endsWith("/ai/chat/existing-run")));
  });
}

test("run polling preserves definitive access failures", async () => {
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => null,
    fetch: async () => Response.json({ message: "Missing" }, { status: 404 }),
  });
  await assert.rejects(
    client.pollAssistantRun("missing", { chatId: "chat", turnId: "turn" }),
    (error: unknown) => error instanceof HttpError && error.statusCode === 404,
  );
});

test("Stop aborts the rate-limit recovery wait", async () => {
  const controller = new AbortController();
  const client = new OrbynClient({
    baseUrl: "http://orbyn.test",
    getToken: () => null,
    fetch: async () => {
      setTimeout(() => controller.abort(), 50);
      return Response.json({ message: "Slow down" }, { status: 429 });
    },
  });
  await assert.rejects(
    client.pollAssistantRun(
      "run",
      { chatId: "chat", turnId: "turn" },
      undefined,
      controller.signal,
    ),
    { name: "AbortError" },
  );
});
