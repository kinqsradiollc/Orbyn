import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import "./setup.js";
const { pool, closeDatabase } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { streamDocChanges, announceDocChange, closeLive } =
  await import("../src/modules/docs/live.js");
await migrate();
after(async () => {
  await closeLive();
  await closeDatabase();
});
test("existing document stream stops releasing notifications after access revocation", async () => {
  const docId = randomUUID();
  const writes: string[] = [];
  let allowed = true,
    checks = 0;
  const reply = {
    raw: {
      destroyed: false,
      writeHead() {},
      write(value: string) {
        writes.push(value);
      },
      end() {},
    },
    getHeaders: () => ({}),
  } as unknown as FastifyReply;
  const stop = await streamDocChanges(reply, docId, "reader", async () => {
    checks++;
    return allowed;
  });
  const waitFor = async (expected: number) => {
    const until = Date.now() + 2000;
    while (checks < expected && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(checks >= expected, "notification reached authorization guard");
  };
  try {
    await announceDocChange(pool, docId, 1, "writer");
    await waitFor(1);
    assert.ok(writes.some((value) => value.includes('"version":1')));
    allowed = false;
    await announceDocChange(pool, docId, 2, "writer");
    await waitFor(2);
    assert.ok(!writes.some((value) => value.includes('"version":2')));
  } finally {
    stop();
  }
});

test("authenticated CRDT SSE closes a revoked session and retains the authorized reader", async () => {
  const { buildApp } = await import("../src/app.js");
  const { announceCrdtUpdate } = await import("../src/modules/docs/live.js");
  const { get } = await import("node:http");
  const { createHash } = await import("node:crypto");
  const app = await buildApp();
  const email = `sse-${randomUUID()}@example.com`;
  const password = "a-long-test-password";
  const registered = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password, name: "SSE fixture" },
    })
  ).json();
  const login = (
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    })
  ).json();
  const token: string = registered.token;
  const controlToken: string = login.token;
  assert.ok(token && controlToken);
  const page = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "SSE fixture", content: [] },
    })
  ).json();
  assert.ok(page.id);
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const open = (bearer: string) =>
    new Promise<{ text: string; ended: boolean; stop: () => void }>(
      (resolve, reject) => {
        const request = get(
          `${address}/events/docs/${page.id}?since=1`,
          { headers: { authorization: `Bearer ${bearer}` } },
          (response) => {
            assert.equal(response.statusCode, 200);
            const state = {
              text: "",
              ended: false,
              stop: () => {
                response.destroy();
                request.destroy();
              },
            };
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              state.text += chunk;
            });
            response.on("end", () => {
              state.ended = true;
            });
            response.on("error", reject);
            resolve(state);
          },
        );
        request.on("error", reject);
      },
    );
  const revoked = await open(token);
  const control = await open(controlToken);
  const until = async (condition: () => boolean, description: string) => {
    const deadline = Date.now() + 3000;
    while (!condition() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(condition(), description);
  };
  const update = async (bytes: Buffer) => {
    const row = (
      await pool.query(
        "INSERT INTO doc_updates(doc_id,editor_id,update) VALUES($1,'writer',$2) RETURNING seq",
        [page.id, bytes],
      )
    ).rows[0];
    await announceCrdtUpdate(pool, page.id, "writer");
    return `"seq":${row.seq},`;
  };
  try {
    await until(
      () => revoked.text.includes(": open") && control.text.includes(": open"),
      "both authenticated streams opened",
    );
    const initial = await update(Buffer.from("authorized-initial-update"));
    await until(
      () => revoked.text.includes(initial) && control.text.includes(initial),
      "both readers received the initial CRDT parcel",
    );
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      createHash("sha256").update(token).digest("hex"),
    ]);
    const later = await update(Buffer.from("must-not-reach-revoked-reader"));
    await until(
      () => revoked.ended && control.text.includes(later),
      "revoked stream closed; authorized control received the later CRDT parcel",
    );
    assert.ok(!revoked.text.includes(later));
    assert.ok(
      !revoked.text.includes(
        Buffer.from("must-not-reach-revoked-reader").toString("base64"),
      ),
    );
    assert.equal(control.ended, false);
  } finally {
    revoked.stop();
    control.stop();
    await app.close();
    await pool.query("DELETE FROM docs WHERE id=$1", [page.id]);
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
  }
});
