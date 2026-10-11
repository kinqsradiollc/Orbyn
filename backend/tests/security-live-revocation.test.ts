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
