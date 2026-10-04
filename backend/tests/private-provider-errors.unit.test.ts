import { test } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../src/modules/ai/providers/adapters.js";
import {
  privateProviderFailureMessage,
  ChatgptDeviceDeferred,
} from "../src/modules/ai/providers/user-choice.js";
test("private run failures expose fixed recovery messages, never raw provider text", () => {
  assert.equal(
    privateProviderFailureMessage(
      new ProviderError("chatgpt_usage_limit", "private-upstream-content"),
    ),
    "ChatGPT plan usage limit reached. Manage usage in ChatGPT.",
  );
  assert.match(
    privateProviderFailureMessage(
      new ProviderError("chatgpt_timeout", "private-upstream-content"),
    )!,
    /completion is unknown/,
  );
  assert.match(
    privateProviderFailureMessage(new ChatgptDeviceDeferred())!,
    /unfinished assignment/,
  );
  assert.equal(
    privateProviderFailureMessage(
      new ProviderError("http_500", "private-upstream-content"),
    ),
    null,
  );
  assert.equal(
    privateProviderFailureMessage(
      new ProviderError("constructor", "private-upstream-content"),
    ),
    null,
  );
  assert.equal(
    privateProviderFailureMessage(new Error("private-upstream-content")),
    null,
  );
});
