import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const script = readFileSync(
  new URL("../../scripts/deploy.sh", import.meta.url),
  "utf8",
);
const helper = (name: string) => {
  const match = script.match(
    new RegExp(`${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`),
  );
  assert.ok(match, `execute the actual ${name} shell helper`);
  return match[0];
};
function run(on: boolean, ids = "fixture-measurer", ready = true) {
  return spawnSync(
    "bash",
    [
      "-c",
      `set -euo pipefail
semantic_on=$SEMANTIC_FIXTURE_ON
log() { :; }
compose() {
  printf 'compose:%s\\n' "$*" >&2
  if [ "$1" = ps ]; then printf '%s' "$SEMANTIC_FIXTURE_IDS"; fi
}
wait_ready() { printf 'ready:%s\\n' "$*" >&2; [ "$SEMANTIC_FIXTURE_READY" = 1 ]; }
${helper("pause_measurer")}
${helper("resume_measurer")}
pause_measurer
resume_measurer
`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SEMANTIC_FIXTURE_ON: on ? "1" : "0",
        SEMANTIC_FIXTURE_IDS: ids,
        SEMANTIC_FIXTURE_READY: ready ? "1" : "0",
      },
    },
  );
}

test("semantic deployment drains the old worker and waits for its replacement", () => {
  const result = run(true);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stderr.trim().split("\n"), [
    "compose:stop -t 30 measure",
    "compose:up -d --no-deps measure",
    "compose:ps -q measure",
    "ready:fixture-measurer",
  ]);
  const migration = script.indexOf("compose run --rm migrate");
  assert.ok(script.indexOf("\npause_measurer\n") < migration);
  assert.ok(script.indexOf("\nresume_measurer\n") > migration);
  assert.match(script, /case ",\$profiles," in \*,semantic,\*\) semantic_on=1/);
});

test("disabled semantic profile stops stale workers without starting another", () => {
  const result = run(false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "compose:stop -t 30 measure");
});

test("semantic deployment fails if the replacement has no container or is not ready", () => {
  const missing = run(true, "");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /measuring service did not start/);
  assert.doesNotMatch(missing.stderr, /ready:/);
  const unhealthy = run(true, "fixture-measurer", false);
  assert.equal(unhealthy.status, 1);
});
