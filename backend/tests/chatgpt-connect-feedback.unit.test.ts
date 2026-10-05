import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chatgptConnectFeedback } from "@orbyn/core";

test("connection feedback distinguishes starting, waiting and received requests", () => {
  assert.equal(
    chatgptConnectFeedback("starting").label,
    "Starting connection…",
  );
  const pending = chatgptConnectFeedback("pending");
  assert.equal(pending.label, "Waiting for Orbyn desktop…");
  assert.match(pending.message, /when it receives the request/);
  assert.match(
    chatgptConnectFeedback("claimed").message,
    /received the request/,
  );
});
test("an unclaimed request explains the missing handoff without asserting device availability", () => {
  assert.doesNotMatch(
    chatgptConnectFeedback("pending", 29_999).message,
    /No desktop/,
  );
  assert.match(
    chatgptConnectFeedback("pending", 30_000).message,
    /No desktop app has received/,
  );
  assert.match(
    chatgptConnectFeedback("pending", 90_000).message,
    /updated Orbyn desktop/,
  );
  assert.doesNotMatch(
    chatgptConnectFeedback("pending", 90_000).message,
    /offline|installed|authorized/,
  );
  assert.match(
    chatgptConnectFeedback("claimed", 90_000).message,
    /Complete ChatGPT sign-in/,
  );
});
test("web and mobile use the same server-state feedback without auto-launching a scheme", async () => {
  for (const path of [
    "../../desktop/src/features/settings/ChatgptRemoteModels.tsx",
    "../../mobile/src/screens/settings/ChatgptModelsSection.tsx",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /chatgptConnectFeedback\(next\.state/);
    assert.match(source, /connectFeedback\.label/);
    assert.match(source, /connectFeedback\.message/);
    assert.match(source, /Requires Orbyn desktop open/);
    assert.doesNotMatch(
      source,
      /window\.location\.href\s*=\s*request\.launch_url/,
    );
  }
});
