import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

for (const legacy of [true, false]) {
  test(`deployment ${legacy ? "fences cached legacy writers" : "retains ordinary rollout"} before a failing migration`, () => {
    const fixture = mkdtempSync(join(tmpdir(), "orbyn-cutover-"));
    try {
      mkdirSync(join(fixture, "scripts"));
      mkdirSync(join(fixture, "bin"));
      mkdirSync(join(fixture, "gateway"));
      writeFileSync(join(fixture, "gateway/nginx.conf.template"), "# fixture");
      writeFileSync(join(fixture, "gateway/entrypoint.sh"), "# fixture");
      writeFileSync(
        join(fixture, "scripts/deploy.sh"),
        readFileSync(new URL("../../scripts/deploy.sh", import.meta.url)),
      );
      writeFileSync(
        join(fixture, ".env"),
        `SECRETS_KEY=${randomBytes(32).toString("base64")}\nDOC_PDF_KEY=${randomBytes(32).toString("hex")}\nDOCKER_SMTP_HOST=mailpit\n`,
      );
      writeFileSync(join(fixture, "legacy-running"), "cached wrapping key K");
      writeFileSync(
        join(fixture, "bin/docker"),
        `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE/trace"
case "$*" in
  *information_schema.tables*) echo t ;;
  *"SELECT EXISTS (SELECT 1 FROM app_secrets"*) echo "$LEGACY_EXISTS" ;;
  "compose stop -t 30 api "*) rm -f "$FIXTURE/legacy-running" ;;
  "compose rm -f api "*) touch "$FIXTURE/legacy-removed" ;;
  "compose run "*)
    # Model the old process attempting a late write with cached K when the
    # converter has visited a store. Quiescence must make this impossible.
    if [ "$LEGACY_EXISTS" = t ] && [ -f "$FIXTURE/legacy-running" ]; then
      touch "$FIXTURE/late-d1-write"
    fi
    exit 19 ;;
esac
`,
        { mode: 0o700 },
      );
      const run = spawnSync(
        "bash",
        [join(fixture, "scripts/deploy.sh"), "--no-pull", "--no-backup"],
        {
          env: {
            ...process.env,
            PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
            FIXTURE: fixture,
            LEGACY_EXISTS: legacy ? "t" : "f",
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(
        run.status,
        19,
        "injected migration failure reaches the deployment exit",
      );
      const commands = readFileSync(join(fixture, "trace"), "utf8").split("\n");
      const migration = commands.findIndex((line) =>
        line.startsWith("compose run "),
      );
      assert.ok(migration > 0);
      if (legacy) {
        const stop = commands.findIndex((line) =>
          line.startsWith("compose stop -t 30 api "),
        );
        const remove = commands.findIndex((line) =>
          line.startsWith("compose rm -f api "),
        );
        assert.ok(stop >= 0 && remove > stop && migration > remove);
        for (const service of [
          "ai",
          "assistant-background",
          "assistant-overnight",
          "notifier",
          "realtime",
          "mcp",
          "plugin",
          "status",
          "files",
          "converter",
          "measure",
        ])
          assert.ok(commands[remove].split(" ").includes(service));
        assert.ok(
          commands[migration].includes("LEGACY_SECRET_CUTOVER=quiesced"),
        );
        assert.ok(existsSync(join(fixture, "legacy-removed")));
        assert.ok(!existsSync(join(fixture, "legacy-running")));
        assert.ok(!existsSync(join(fixture, "late-d1-write")));
      } else {
        assert.ok(!commands[migration].includes("LEGACY_SECRET_CUTOVER"));
        assert.ok(!existsSync(join(fixture, "legacy-removed")));
      }
      assert.equal(
        commands.slice(migration + 1).filter(Boolean).length,
        0,
        "failure does not restart old or replacement replicas",
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
}
