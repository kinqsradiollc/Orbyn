import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const documented = (text) =>
  new Set(
    [...text.matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
  );
const schema = [
  ...read("backend/src/config/env.ts").matchAll(/^  ([A-Z][A-Z0-9_]*):/gm),
].map((m) => m[1]);
const compose = [
  ...read("compose.yaml").matchAll(/\$\{([A-Z][A-Z0-9_]*)/g),
].map((m) => m[1]);
let failed = false;
for (const path of [".env.example", ".env.production.example"]) {
  const keys = documented(read(path));
  const missing = [...new Set([...schema, ...compose])].filter(
    (key) => !keys.has(key),
  );
  if (missing.length) {
    console.error(`${path}: undocumented variables: ${missing.join(", ")}`);
    failed = true;
  }
}
for (const [folder, prefix, expected] of [
  [
    "mobile",
    "EXPO_PUBLIC_",
    ["API_URL", "WEB_URL", "EAS_PROJECT_ID", "DEBUG_ERRORS"],
  ],
  [
    "desktop",
    "VITE_",
    ["API_URL", "WEB_URL", "DEBUG_ERRORS", "DOC_CRDT", "APP_VERSION"],
  ],
]) {
  for (const suffix of [".env.example", ".env.production.example"]) {
    const path = `${folder}/${suffix}`;
    const missing = expected.filter(
      (key) => !documented(read(path)).has(prefix + key),
    );
    if (missing.length) {
      console.error(
        `${path}: undocumented client variables: ${missing.join(", ")}`,
      );
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
else
  console.log(
    `Environment templates cover ${new Set([...schema, ...compose]).size} backend/Compose variables and both clients (${fileURLToPath(root)}).`,
  );
