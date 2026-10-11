import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { keyBlockedRoute } from "../src/lib/auth.js";
import { clientHosts, disallowedHost } from "../src/modules/oauth/clients.js";
import {
  boundedProviderText,
  json,
  ProviderError,
  send,
} from "../src/modules/ai/providers/adapters.js";
import { outbound } from "../src/lib/netguard.js";

test("personal keys cannot create public release but retain read/revoke routes", () => {
  for (const [method, route] of [
    ["PUT", "/docs/:id/publication"],
    ["POST", "/booking-pages"],
    ["PUT", "/booking-pages/:id"],
  ])
    assert.equal(keyBlockedRoute(method, route), true);
  assert.equal(keyBlockedRoute("GET", "/docs/:id/publication"), false);
  assert.equal(keyBlockedRoute("DELETE", "/docs/:id/publication"), false);
});
test("CIMD policy covers all HTTPS recipients including mixed cross-host callbacks", () => {
  const client = {
    kind: "cimd",
    host: "allowed.example",
    redirect_uris: [
      "https://allowed.example/cb",
      "https://other.example/cb",
      "http://127.0.0.1:1455/cb",
    ],
  };
  assert.deepEqual(clientHosts(client), ["allowed.example", "other.example"]);
  assert.equal(disallowedHost(client, ["allowed.example"]), "other.example");
  assert.equal(
    disallowedHost(client, ["allowed.example", "other.example"]),
    null,
  );
  assert.equal(disallowedHost(client, []), null);
});
test("provider body cap applies to chunked success and error replies", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(5));
      c.enqueue(new Uint8Array(5));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(
    boundedProviderText(new Response(stream), 8),
    (e) => e instanceof ProviderError && e.reason === "response_too_large",
  );
  assert.equal(canceled, true);
  assert.deepEqual(await json(new Response('{"ok":true}')), { ok: true });
});
test("provider network uses the validated address without a second lookup", async () => {
  const lookup = outbound.lookup,
    request = outbound.request;
  let lookups = 0;
  try {
    outbound.lookup = async () => {
      lookups++;
      return [
        {
          address: lookups === 1 ? "93.184.215.14" : "169.254.169.254",
          family: 4,
        },
      ];
    };
    outbound.request = async (checked) => {
      assert.equal(checked.pinned?.address, "93.184.215.14");
      return new Response('{"ok":true}');
    };
    const r = await send(
      "https://provider.example/v1",
      {},
      AbortSignal.timeout(1000),
    );
    assert.equal(lookups, 1);
    assert.deepEqual(await r.json(), { ok: true });
    outbound.lookup = async () => [{ address: "169.254.169.254", family: 4 }];
    await assert.rejects(
      send("https://provider.example/v1", {}, AbortSignal.timeout(1000)),
    );
    for (const host of [
      "::ffff:a9fe:a9fe",
      "::ffff:169.254.169.254",
      "fe90::1",
    ])
      await assert.rejects(
        send(`http://[${host}]/v1`, {}, AbortSignal.timeout(1000)),
      );
  } finally {
    outbound.lookup = lookup;
    outbound.request = request;
  }
});
test("gateway defaults avoid bearer paths and public-subnet exemptions", async () => {
  const template = await readFile(
    new URL("../../gateway/nginx.conf.template", import.meta.url),
    "utf8",
  );
  const format = template.match(/log_format safe ([^;]+);/)![1];
  assert.doesNotMatch(
    format,
    /\$request(?:\s|'|")|\$request_uri|\$uri|\$args|referer/,
  );
  const compose = await readFile(
    new URL("../../compose.yaml", import.meta.url),
    "utf8",
  );
  assert.match(compose, /RATE_LIMIT_EXEMPT: \$\{GATEWAY_RATE_LIMIT_EXEMPT:-\}/);
});

test("pinned provider transport preserves multipart recording bodies", async () => {
  const { createServer } = await import("node:http");
  const { transcribe } =
    await import("../src/modules/ai/providers/adapters.js");
  let contentType = "",
    body = "";
  const server = createServer((req, res) => {
    contentType = String(req.headers["content-type"]);
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "fixture transcription" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    assert.equal(
      await transcribe(
        {
          kind: "custom",
          format: "openai",
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: "inert",
          model: "fixture",
        },
        new TextEncoder().encode("fixture-audio-bytes"),
        "audio/webm",
      ),
      "fixture transcription",
    );
    assert.match(contentType, /multipart\/form-data; boundary=/);
    assert.match(body, /fixture-audio-bytes/);
    assert.match(body, /name="model"/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
