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
test("web and mobile expose truthful desktop connection actions without pretending to start web OAuth", async () => {
  const [webRaw, mobileRaw] = await Promise.all([
    file("../../desktop/src/features/settings/ChatgptRemoteModels.tsx"),
    file("../../mobile/src/screens/settings/ChatgptModelsSection.tsx"),
  ]);
  const web = webRaw.replace(/\s+/g, " ");
  const mobile = mobileRaw.replace(/\s+/g, " ");
  assert.ok(web.includes("Connect on desktop"));
  assert.ok(web.includes('href="orbyn://assistant"'));
  assert.ok(web.includes("Direct sign-in on web is not available yet"));
  assert.ok(mobile.includes('label="Connect on desktop"'));
  assert.ok(mobile.includes("Direct sign-in on mobile is not available yet"));
  assert.ok(!web.includes('action: "connect"'));
  assert.ok(web.includes("onClick={refresh}"));
  assert.ok(mobile.includes("onPress={refresh}"));
});
