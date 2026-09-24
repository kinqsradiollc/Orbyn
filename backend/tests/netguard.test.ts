import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * The guard on addresses users choose (webhooks, calendar links): https
 * only, public addresses only however they're written, and the call goes to
 * the address that was checked, never a second DNS answer.
 */

const { env } = await import("../src/config/env.js");
const { isPrivateAddress, checkPublicUrl, outbound, publicFetch } =
  await import("../src/lib/netguard.js");

test("private and special addresses are caught in every spelling", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "192.0.0.8",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    // IPv4-mapped, dotted and in hex (what the URL parser writes).
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::FFFF:7F00:0001",
    "::ffff:a9fe:a9fe",
    "::ffff:10.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
    // IPv4-translated, IPv4-compatible, NAT64 and 6to4 around a private one.
    "::ffff:0:7f00:1",
    "::7f00:1",
    "::127.0.0.1",
    "64:ff9b::7f00:1",
    "64:ff9b::10.0.0.1",
    "64:ff9b:1::1",
    "2002:7f00:1::1",
    "2002:c0a8:101::1",
    // Local, link-local, site-local, multicast, documentation, Teredo.
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fe80::1%en0",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "2001::1",
    "100::1",
    // Unreadable is never called.
    "not-an-address",
    "1::2::3",
  ])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of [
    "93.184.216.34",
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1",
    "::ffff:93.184.216.34",
    "::ffff:5db8:d822",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ])
    assert.equal(isPrivateAddress(ip), false, ip);
});

const refused = async (raw: string, pattern: RegExp) => {
  await assert.rejects(
    checkPublicUrl(raw),
    (e: Error & { statusCode?: number }) => {
      assert.equal(e.statusCode, 422, raw);
      assert.match(e.message, pattern, raw);
      return true;
    },
  );
};

test("only https to a public address passes, pinned to what was checked", async () => {
  await refused("http://93.184.216.34/hook", /start with https/);
  await refused("ftp://93.184.216.34/hook", /start with https/);
  await refused("not a link", /valid URL/);
  await refused("https://127.0.0.1/hook", /public address/);
  await refused("https://2130706433/hook", /public address/);
  await refused("https://0x7f.1/hook", /public address/);
  await refused("https://[::ffff:127.0.0.1]/hook", /public address/);
  await refused("https://[::ffff:7f00:1]/hook", /public address/);
  await refused("https://[::1]/hook", /public address/);
  await refused("https://[fd00::1]/hook", /public address/);
  // A name that resolves to a private address.
  await refused("https://localhost/hook", /public address/);
  await assert.rejects(
    checkPublicUrl("https://nothing-here.invalid/hook", "calendar"),
    /Couldn't find/,
  );
  const v4 = await checkPublicUrl("https://93.184.216.34/hook");
  assert.deepEqual(v4.pinned, { address: "93.184.216.34", family: 4 });
  const v6 = await checkPublicUrl("https://[2606:4700:4700::1111]/dns");
  assert.deepEqual(v6.pinned, { address: "2606:4700:4700::1111", family: 6 });
  await assert.rejects(
    checkPublicUrl("http://93.184.216.34/cal.ics", "calendar"),
    /Calendar links start with https/,
  );
});

test("local development may call plain http and private addresses", async () => {
  const before = env.ALLOW_PRIVATE_WEBHOOKS;
  env.ALLOW_PRIVATE_WEBHOOKS = "true";
  try {
    const local = await checkPublicUrl("http://127.0.0.1:9/hook");
    assert.equal(local.pinned, null);
    await refused("ftp://127.0.0.1/hook", /start with https/);
  } finally {
    env.ALLOW_PRIVATE_WEBHOOKS = before;
  }
});

/** A local server that records what reached it. */
async function listen(
  answer: (
    req: IncomingMessage,
    body: string,
  ) => {
    status: number;
    headers?: Record<string, string>;
    body?: string;
  } | null,
) {
  const seen: {
    host?: string;
    method?: string;
    body: string;
    length?: string;
  }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        host: req.headers.host,
        method: req.method,
        body,
        length: req.headers["content-length"],
      });
      const out = answer(req, body);
      if (!out) return; // Never answers.
      res.writeHead(out.status, out.headers).end(out.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("the call connects to the pinned address and never looks the name up again", async () => {
  const server = await listen(() => ({
    status: 200,
    headers: { "content-type": "text/plain", etag: '"v1"' },
    body: "delivered",
  }));
  try {
    // .invalid never resolves: reaching the server proves the pin was used.
    const res = await outbound.request(
      {
        url: new URL(`http://pinned.invalid:${server.port}/hook?x=1`),
        pinned: { address: "127.0.0.1", family: 4 },
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"ok":true}',
      },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("etag"), '"v1"');
    assert.equal(await res.text(), "delivered");
    assert.deepEqual(server.seen, [
      {
        host: `pinned.invalid:${server.port}`,
        method: "POST",
        body: '{"ok":true}',
        length: "11",
      },
    ]);
  } finally {
    await server.close();
  }
});

test("redirects come back unfollowed, 304 has no body, and timeouts say so", async () => {
  let reply: { status: number; headers?: Record<string, string> } | null = {
    status: 302,
    headers: { location: "https://127.0.0.1/steal" },
  };
  const server = await listen(() => reply);
  const checked = {
    url: new URL(`http://pinned.invalid:${server.port}/cal.ics`),
    pinned: { address: "127.0.0.1", family: 4 as const },
  };
  try {
    const moved = await outbound.request(checked);
    assert.equal(moved.status, 302);
    assert.equal(moved.headers.get("location"), "https://127.0.0.1/steal");
    reply = { status: 304 };
    const same = await outbound.request(checked);
    assert.equal(same.status, 304);
    assert.equal(same.body, null);
    reply = null;
    await assert.rejects(
      outbound.request(checked, { signal: AbortSignal.timeout(50) }),
      (e: Error) => e.name === "TimeoutError",
    );
    assert.equal(server.seen.length, 3);
  } finally {
    await server.close();
  }
});

test("publicFetch refuses before connecting", async () => {
  let called = false;
  const real = outbound.request;
  outbound.request = async () => {
    called = true;
    return new Response("no");
  };
  try {
    await assert.rejects(
      publicFetch("https://[::ffff:7f00:1]:5432/"),
      /public address/,
    );
    await assert.rejects(
      publicFetch("http://93.184.216.34/", {}, "calendar"),
      /start with https/,
    );
    assert.equal(called, false);
  } finally {
    outbound.request = real;
  }
});
