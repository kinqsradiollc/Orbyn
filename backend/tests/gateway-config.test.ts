import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The gateway is configured by a template the deploy renders with envsubst.
 * Its limits are easy to break silently: a request from the browser passes
 * two servers (the web port re-enters the API port for /api), and nginx
 * counts a request against a shared zone at every hop that names it — a
 * stream held open at three hops eats three slots for its whole 15-minute
 * cycle. These tests pin the invariants that keep counting exactly once
 * (the May 2026 production 429s came from exactly this double-count).
 */

/** The variables entrypoint.sh actually substitutes, with test values. */
function render(): string {
  const template = readFileSync(
    fileURLToPath(
      new URL("../../gateway/nginx.conf.template", import.meta.url),
    ),
    "utf8",
  );
  const vars: Record<string, string> = {
    UPSTREAM_API: "    server api:8000;",
    UPSTREAM_AI: "    server ai:8000;",
    UPSTREAM_REALTIME: "    server realtime:8000;",
    UPSTREAM_STATUS: "    server status:8000;",
    UPSTREAM_WEB: "    server desktop:8080;",
    UPSTREAM_FILES: "    server files:8000;",
    UPSTREAM_MCP: "    server mcp:8000;",
    MCP_GATE: "# MCP is on (MCP_DISABLED unset).",
    RESOLVER: "127.0.0.11",
    REAL_IP:
      "  set_real_ip_from 127.0.0.1;\n  set_real_ip_from 172.16.0.0/12;\n  real_ip_header X-Forwarded-For;\n  real_ip_recursive on;",
    LIMIT_EXEMPT: "",
  };
  return template.replace(/\$\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole;
    return vars[name];
  });
}

/** Body of the server block listening on `port` (balanced braces). */
function serverBlock(conf: string, port: string): string {
  const opener = new RegExp(`server \\{\\s*listen ${port};`);
  const start = conf.search(opener);
  assert.notEqual(start, -1, `a server listens on ${port}`);
  let depth = 0;
  for (let i = conf.indexOf("{", start); i < conf.length; i++) {
    if (conf[i] === "{") depth++;
    else if (conf[i] === "}") {
      depth--;
      if (depth === 0) return conf.slice(start, i + 1);
    }
  }
  throw new Error(`server block on ${port} never closes`);
}

test("the web port marks what it forwards, and the marker empties every zone key", () => {
  const conf = render();
  const web = serverBlock(conf, "8081");
  // The /api pass-through carries the marker.
  assert.match(
    web,
    /location \/api\/ \{[\s\S]*?proxy_set_header X-Orbyn-Via web;/,
    "the web port's /api pass-through marks its requests",
  );
  // Every map from the marker to an empty key is present, and every zone
  // whose key could double-count is keyed through one of them.
  assert.ok(
    conf.includes(
      'map "$server_port:$realip_remote_addr:$http_x_orbyn_via" $req_key {',
    ),
  );
  assert.ok(
    conf.includes(
      'map "$server_port:$realip_remote_addr:$http_x_orbyn_via" $sse_key {',
    ),
  );
  assert.match(conf, /limit_req_zone \$req_key zone=per_client/);
  assert.match(conf, /limit_conn_zone \$sse_key zone=sse_per_client/);
});

test("the API port names no shared zone outside locations, and its catch-all is marked-safe", () => {
  const conf = render();
  const api = serverBlock(conf, "8080");
  // A server-level limit_conn would count browser requests twice (the web
  // port has already counted them), so there must be none. Server-level
  // directives sit at exactly 4 spaces in the template; location ones at 6.
  assert.doesNotMatch(
    api,
    /^ {4}limit_conn /m,
    "no server-level limit_conn on the API port",
  );
  // Every location on the API port that names a shared zone must do so via
  // a key that goes empty for marked requests (never the raw address key).
  const zonesUsingAddressKey = [
    ...api.matchAll(/limit_(?:req|conn) zone=(\w+)/g),
  ]
    .map((m) => m[1])
    .filter(
      (zone) =>
        !["per_client", "sse_per_client", "mcp_token", "mcp_conn"].includes(
          zone,
        ),
    );
  assert.deepEqual(
    zonesUsingAddressKey,
    [],
    "the API port only uses zones keyed through the marker (or MCP's own)",
  );
});

test("event streams have a per-address ceiling sized for a household, at one hop", () => {
  const conf = render();
  // The browser's stream locations on the web port: /api/events (with and
  // without a doc id) and the doc-live stream.
  assert.match(
    conf,
    /location ~ \^\/api\/events\(\?:\/docs\/\[\^\/\]\+\)\?\$ \{[\s\S]*?limit_conn sse_per_client (\d+);/,
  );
  assert.match(
    conf,
    /location ~ \^\/api\/docs\/\[\^\/\]\+\/live\$ \{[\s\S]*?limit_conn sse_per_client (\d+);/,
  );
  const cap = Number(conf.match(/limit_conn sse_per_client (\d+);/)?.[1]);
  // A home shares one address: phones, laptops, open tabs each hold a
  // stream for 15 minutes at a time, and a deploy reconnects them all at
  // once. The old cap of 20 (halved by double-counting to ~10) 429ed a
  // single person's session; anything under 50 invites that back.
  assert.ok(cap >= 50, `stream ceiling ${cap} covers a household (>= 50)`);
  // Direct API clients reach the same streams at /events on the API port,
  // under the same ceiling.
  assert.match(
    serverBlock(conf, "8080"),
    /location \/events \{[\s\S]*?limit_conn sse_per_client/,
  );
});

test("429 answers are JSON with Retry-After, in every server that serves people", () => {
  const conf = render();
  for (const port of ["8080", "8081"]) {
    const block = serverBlock(conf, port);
    assert.match(
      block,
      /error_page 429 = @limited;/,
      `port ${port} maps 429 to a handler`,
    );
    assert.match(
      block,
      /location @limited \{[\s\S]*?add_header Retry-After \d+ always;[\s\S]*?return 429 '\{"message":"/,
      `port ${port}'s 429 carries Retry-After and the JSON error shape`,
    );
  }
});

test("the web port keeps its own per-address connection ceiling for browser requests", () => {
  const conf = render();
  assert.match(
    serverBlock(conf, "8081"),
    /limit_conn conn_per_client \d+;/,
    "the web port still bounds concurrent browser connections",
  );
});

test("only the gateway loopback hop can skip duplicate counting", () => {
  const conf = render();
  for (const name of ["req_key", "sse_key"]) {
    const map = conf
      .slice(
        conf.indexOf(
          `map "$server_port:$realip_remote_addr:$http_x_orbyn_via" $${name}`,
        ),
      )
      .split("}")[0];
    assert.match(map, /default \$limit_key;/);
    assert.match(map, /"8080:127\.0\.0\.1:web" "";/);
    assert.match(map, /"8080:::1:web" "";/);
    assert.equal(
      [...map.matchAll(/"";/g)].length,
      2,
      "no web-port or remote-address exemption",
    );
    assert.doesNotMatch(map, /"web" "";/);
  }
});
