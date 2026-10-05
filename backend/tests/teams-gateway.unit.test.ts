import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("Teams callbacks and activities disable gateway query logs and upstream replay on both exposed ports", () => {
  const config = readFileSync(
    new URL("../../gateway/nginx.conf.template", import.meta.url),
    "utf8",
  );
  for (const suffix of ["callback", "activities"]) {
    for (const prefix of ["", "/api"]) {
      const marker = `location = ${prefix}/agent-channels/teams/${suffix} {`;
      const start = config.indexOf(marker);
      assert.ok(start >= 0);
      const block = config.slice(start, config.indexOf("\n    }", start));
      assert.match(block, /access_log off;/);
      assert.match(block, /error_log \/dev\/null crit;/);
      assert.match(block, /proxy_next_upstream off;/);
      if (prefix)
        assert.ok(
          block.includes(
            `proxy_pass http://127.0.0.1:8080/agent-channels/teams/${suffix};`,
          ),
        );
      else assert.match(block, /proxy_pass http:\/\/api;/);
    }
  }
});
