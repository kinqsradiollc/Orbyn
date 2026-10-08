import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const script = readFileSync(
  new URL("../../scripts/deploy.sh", import.meta.url),
  "utf8",
);
const helper = script.match(/pause_notifier\(\) \{\n[\s\S]*?\n\}\n/)?.[0];
assert.ok(helper, "exercise the actual deployment helper");
function run(stopped: boolean) {
  return spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
log() { :; }
compose() { printf '%s\\n' "$*"; if [ "$1" = stop ]; then [ "$STOP_OK" = 1 ]; fi; }
${helper}
pause_notifier
compose run --rm migrate
`,
    ],
    { encoding: "utf8", env: { ...process.env, STOP_OK: stopped ? "1" : "0" } },
  );
}
test("maintenance deployment stops the old notifier before schema changes and restarts only the updated image", () => {
  const result = run(true);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), [
    "stop -t 30 notifier",
    "run --rm migrate",
  ]);
  const pause = script.indexOf("\npause_notifier\n"),
    migrate = script.indexOf("compose run --rm migrate"),
    roll = script.indexOf('rollout notifier "$(setting NOTIFIER_REPLICAS 1)"');
  assert.ok(pause > 0 && pause < migrate && roll > migrate);
  assert.match(
    script,
    /if \[ "\$have" -eq 0 \]; then[\s\S]*?compose up -d --no-deps --scale/,
  );
});
test("a refused notifier stop prevents migration rather than leaving an old bypass worker active", () => {
  const result = run(false);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "stop -t 30 notifier");
});
