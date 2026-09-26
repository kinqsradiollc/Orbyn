import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A code check: every write path labels its transaction through actAs()
 * (lib/actor.ts), which sets both orbyn.user_id and orbyn.agent_grant, so a
 * change an outside agent made is never recorded as the person's own and a
 * person's is never recorded as an agent's. No other file sets either
 * setting by hand.
 */
const src = fileURLToPath(new URL("../src", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? files(path)
      : path.endsWith(".ts")
        ? [path]
        : [];
  });
}

test("only lib/actor.ts sets orbyn.user_id or orbyn.agent_grant", () => {
  const offenders = files(src)
    .filter((f) => relative(src, f) !== join("lib", "actor.ts"))
    .filter((f) =>
      /set_config\(\s*'orbyn\.(user_id|agent_grant)'/.test(
        readFileSync(f, "utf8"),
      ),
    )
    .map((f) => relative(src, f));
  assert.deepEqual(offenders, []);
});

test("actAs sets both settings together", () => {
  const text = readFileSync(join(src, "lib", "actor.ts"), "utf8");
  assert.match(text, /set_config\('orbyn\.user_id'/);
  assert.match(text, /set_config\('orbyn\.agent_grant'/);
});
