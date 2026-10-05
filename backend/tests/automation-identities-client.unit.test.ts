import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
import { characterAppearance } from "@orbyn/core";
const identity = {
  lane: "background" as const,
  name: "Day",
  persona: "",
  character: characterAppearance({}),
  named_at: null,
  updated_at: null,
  revision: 1,
};
test("identity client checks lane and metadata before broadcasting saved settings", async () => {
  let token = "first";
  let mode = "normal";
  const client = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => token,
    fetch: async (url, options) => {
      assert.equal(
        new URL(String(url)).pathname,
        "/me/assistant/identity/background",
      );
      if (mode === "switch") token = "second";
      return Response.json(
        mode === "wrong-lane"
          ? { ...identity, lane: "overnight" }
          : mode === "malformed"
            ? { ...identity, revision: -1 }
            : identity,
      );
    },
  });
  const received: string[] = [];
  const stop = client.onAutomationAgentIdentity((value) => {
    received.push(value.name);
    value.name = "Mutation";
  });
  const input = { name: "Day", expected_revision: 0 };
  const first = await client.updateAutomationAgentIdentity("background", input);
  assert.equal(first.name, "Day");
  assert.deepEqual(received, ["Day"]);
  mode = "switch";
  await client.updateAutomationAgentIdentity("background", input);
  assert.deepEqual(received, ["Day"]);
  mode = "wrong-lane";
  await assert.rejects(client.automationAgentIdentity("background"));
  await assert.rejects(
    client.updateAutomationAgentIdentity("background", input),
  );
  mode = "malformed";
  await assert.rejects(client.automationAgentIdentity("background"));
  assert.deepEqual(received, ["Day"]);
  stop();
});
