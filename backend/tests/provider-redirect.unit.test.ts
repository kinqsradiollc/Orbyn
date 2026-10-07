import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { send, ProviderError } from "../src/modules/ai/providers/adapters.js";
const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as { port: number }).port),
    ),
  );
const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));
for (const status of [301, 302, 303, 307, 308]) {
  for (const header of ["Authorization", "x-api-key", "api-key"]) {
    test(`saved recipient rejects HTTP${status} redirects with ${header}`, async () => {
      let targetCalls = 0;
      const target = createServer((req, res) => {
        targetCalls++;
        res.end("redirect target");
      });
      const port = await listen(target);
      const source = createServer((req, res) => {
        res.writeHead(status, {
          Location: `http://127.0.0.1:${port}/unexpected`,
        });
        res.end();
      });
      const sourcePort = await listen(source);
      try {
        await assert.rejects(
          send(
            `http://127.0.0.1:${sourcePort}/saved`,
            {
              method: "POST",
              redirect: "follow",
              headers: {
                [header]: "inert-sentinel",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ input: "inert fixture text" }),
            },
            AbortSignal.timeout(1000),
            "inert-sentinel",
          ),
          (e) =>
            e instanceof ProviderError &&
            e.reason === "redirect" &&
            !e.message.includes("inert-sentinel"),
        );
        assert.equal(
          targetCalls,
          0,
          "redirect target must receive neither credentials nor input",
        );
      } finally {
        await close(source);
        await close(target);
      }
    });
  }
}
test("direct saved recipient request still succeeds", async () => {
  let calls = 0;
  const source = createServer((req, res) => {
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end('{"ok":true}');
  });
  const port = await listen(source);
  try {
    const result = await send(
      `http://127.0.0.1:${port}/saved`,
      { headers: { "x-api-key": "inert-sentinel" } },
      AbortSignal.timeout(1000),
      "inert-sentinel",
    );
    assert.deepEqual(await result.json(), { ok: true });
    assert.equal(calls, 1);
  } finally {
    await close(source);
  }
});

test("same-origin redirects require an explicit saved endpoint too", async () => {
  let targetCalls = 0;
  const source = createServer((req, res) => {
    if (req.url === "/saved") {
      res.writeHead(307, { Location: "/next" });
      res.end();
    } else {
      targetCalls++;
      res.end("unexpected target");
    }
  });
  const port = await listen(source);
  try {
    await assert.rejects(
      send(
        `http://127.0.0.1:${port}/saved`,
        { headers: { "x-api-key": "inert-sentinel" } },
        AbortSignal.timeout(1000),
        "inert-sentinel",
      ),
      (e) => e instanceof ProviderError && e.reason === "redirect",
    );
    assert.equal(targetCalls, 0);
  } finally {
    await close(source);
  }
});
test("redirect error is actionable and excludes Location/body details", async () => {
  const source = createServer((req, res) => {
    res.writeHead(302, { Location: "/inert-sentinel" });
    res.end("inert-sentinel");
  });
  const port = await listen(source);
  try {
    await assert.rejects(
      send(
        `http://127.0.0.1:${port}/saved`,
        {},
        AbortSignal.timeout(1000),
        "inert-sentinel",
      ),
      (e) =>
        e instanceof ProviderError &&
        e.reason === "redirect" &&
        e.message.includes("Update the saved base URL") &&
        !e.message.includes("inert-sentinel"),
    );
  } finally {
    await close(source);
  }
});

test("redirect rejection cancels a streaming response body promptly", async () => {
  let bodyClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    bodyClosed = resolve;
  });
  const source = createServer((req, res) => {
    res.writeHead(307, { Location: "/unused" });
    res.write("inert redirect body");
    res.on("close", bodyClosed);
  });
  const port = await listen(source);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await assert.rejects(
      send(`http://127.0.0.1:${port}/saved`, {}, AbortSignal.timeout(5000)),
      (error) => error instanceof ProviderError && error.reason === "redirect",
    );
    await Promise.race([
      closed,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("redirect body was left open")),
          2000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    source.closeAllConnections();
    await close(source);
  }
});
