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
test("legacy web handoff remains explicit while native Settings uses local sign-in", async () => {
  const web = await readFile(
    new URL(
      "../../desktop/src/features/settings/ChatgptRemoteModels.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(web, /chatgptConnectFeedback\(next\.state/);
  assert.doesNotMatch(web, /window\.location\.href\s*=\s*request\.launch_url/);
  const native = await readFile(
    new URL(
      "../../mobile/src/screens/settings/ChatgptModelsSection.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(native, /await signInNativeChatgpt\(userId, \{/);
  assert.match(native, /await prepareNativeChatgptAccounts\(userId, \{/);
  assert.match(native, /chatgptForeground\.restart\(\)/);
  assert.doesNotMatch(
    native,
    /startChatgptConnectRequest|Requires Orbyn desktop open/,
  );
  assert.match(native, /Browser connection unavailable/);
});
