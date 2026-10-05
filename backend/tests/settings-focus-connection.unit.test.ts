import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const file = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
test("compound settings searches override focus-visible on the inner input", async () => {
  const css = await file("../../desktop/src/features/settings/settings.css");
  assert.match(
    css,
    /input\[type="search"\]:focus-visible\s*\{[^}]*outline: none/s,
  );
  const global = await file("../../desktop/src/styles/global.css");
  const section = global.slice(
    global.indexOf("/* Compound fields own"),
    global.indexOf("/* In a stacked form"),
  );
  for (const field of [
    ".settings-search-field",
    ".search",
    ".db-search",
    ".command-input",
    ".ai-composer",
  ])
    assert.ok(section.includes(field));
  assert.ok(section.includes(":focus-visible"));
  assert.ok(section.includes(":focus-within"));
  assert.ok(section.includes("var(--color-focus)"));
  assert.ok(section.includes(".settings-dialog"));
});
test("web offers one provider authorization action separate from usage and MCP settings", async () => {
  const web = (
    await file("../../desktop/src/features/settings/ChatgptRemoteModels.tsx")
  ).replace(/\s+/g, " ");
  assert.ok(web.includes("Connect to ChatGPT"));
  assert.ok(/startChatgptConnectRequest\(\s*controller\.signal/.test(web));
  assert.ok(web.includes("window.location.href = request.launch_url"));
  assert.ok(!web.includes("Connect on desktop"));
  assert.ok(!web.includes("Open ChatGPT sign-in settings"));
  assert.ok(!web.includes("startOAuth"));
  assert.ok(web.includes("Manage ChatGPT usage"));
});
