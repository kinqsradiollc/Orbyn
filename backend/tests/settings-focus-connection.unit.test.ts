import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const file = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
test("settings search retains the shared focus outline with a neutral wrapper border", async () => {
  const css = await file("../../desktop/src/features/settings/settings.css");
  assert.doesNotMatch(
    css,
    /\.settings-search-field:focus-within\s*\{[^}]*border-color:\s*var\(--color-accent\)/s,
  );
  assert.match(
    css,
    /\.settings-search-field\s*\{[^}]*border: 1px solid var\(--color-border\)/s,
  );
  const global = await file("../../desktop/src/styles/global.css");
  assert.match(
    global,
    /\.settings-search-field,[\s\S]*?\):focus-within\s*\{\s*outline: 2px solid var\(--color-focus\)/,
  );
});
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
test("web shows remote ChatGPT models separately from MCP settings", async () => {
  const web = (
    await file("../../desktop/src/features/settings/ChatgptRemoteModels.tsx")
  ).replace(/\s+/g, " ");
  assert.ok(!web.includes("Connect to ChatGPT"));
  assert.ok(!web.includes("startChatgptConnectRequest"));
  assert.ok(!web.includes("window.location.href = request.launch_url"));
  assert.ok(!web.includes("startOAuth"));
  assert.ok(web.includes("View ChatGPT usage"));
  assert.ok(web.includes("AiProviderChoiceControls"));
});
