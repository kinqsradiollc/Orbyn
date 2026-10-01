import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { desktopChatgptConfiguration: parse } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-config.cjs",
);

test("desktop configuration accepts only a fixed HTTPS or loopback API address", () => {
  assert.deepEqual(
    parse({ version: 1, apiBaseUrl: "https://fixture.orbyn.invalid/api/" }),
    { apiBaseUrl: "https://fixture.orbyn.invalid/api" },
  );
  for (const url of [
    "http://localhost:8008",
    "http://127.0.0.1:8008",
    "http://[::1]:8008",
  ])
    assert.equal(parse({ version: 1, apiBaseUrl: url }).apiBaseUrl, url);
  for (const url of [
    "/api",
    "file:///private/config",
    "javascript:alert(1)",
    "http://other.invalid/api",
    "http://localhost.other.invalid",
    "https://user:secret@fixture.invalid/api",
    "https://fixture.invalid/api?token=secret",
    "https://fixture.invalid/api#secret",
  ])
    assert.throws(() => parse({ version: 1, apiBaseUrl: url }));
  for (const value of [
    null,
    { version: 2, apiBaseUrl: "https://fixture.invalid" },
    {
      version: 1,
      apiBaseUrl: "https://fixture.invalid",
      endpoint: "https://other.invalid",
    },
    { version: 1, apiBaseUrl: 123 },
    { version: 1, apiBaseUrl: "x".repeat(4097) },
  ])
    assert.throws(() => parse(value));
});
