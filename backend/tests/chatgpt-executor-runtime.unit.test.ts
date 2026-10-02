import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { createChatgptExecutorRuntime: create } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-executor-runtime.cjs",
);

async function fixture() {
  const binding = {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture-account",
    client_id: "oaiapp_fixture",
  };
  const hostId = randomUUID(),
    executorId = randomUUID();
  const metadata = {
    host_id: hostId,
    public_key: "A".repeat(59),
    public_key_fingerprint: "A".repeat(43),
  };
  const enrollment = {
    id: executorId,
    binding,
    host_id: hostId,
    public_key_fingerprint: metadata.public_key_fingerprint,
    enrollment_epoch: 1,
  };
  const lease = {
    executor_id: executorId,
    binding,
    enrollment_epoch: 1,
    lease_epoch: 1,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
  };
  const published: any[] = [],
    heartbeats: any[] = [];
  let live = true,
    catalogReads = 0;
  const client = {
    beginChatgptExecutor: async () => ({ id: randomUUID() }),
    finishChatgptExecutor: async () => enrollment,
    beginChatgptExecutorLease: async () => ({
      id: randomUUID(),
      executor_id: executorId,
      enrollment_epoch: 1,
    }),
    finishChatgptExecutorLease: async () => lease,
    renewChatgptExecutorLease: async (value: any) => {
      heartbeats.push(value.heartbeat);
      return lease;
    },
    publishChatgptModels: async (value: any) => {
      published.push(value.catalog);
      return {
        executor_id: executorId,
        lease_epoch: lease.lease_epoch,
        sequence: value.catalog.sequence,
        published_at: new Date().toISOString(),
      };
    },
  };
  const options = {
    binding,
    client,
    signer: {
      metadata: async () => metadata,
      proveEnrollment: async (value: any) => ({
        challenge_id: value.id,
        signature: "A".repeat(86),
      }),
      proveLease: async (value: any) => ({
        challenge_id: value.id,
        signature: "A".repeat(86),
      }),
      signCatalog: async (catalog: any) => ({
        catalog,
        signature: "A".repeat(86),
      }),
      signHeartbeat: async (heartbeat: any) => ({
        heartbeat,
        signature: "A".repeat(86),
      }),
    },
    models: async (_signal: AbortSignal) => {
      catalogReads++;
      return [{ slug: "fixture-model", display_name: "Fixture model" }];
    },
    requireLiveConnection: async () => {
      if (!live) throw new Error("Account changed");
    },
  };
  const runtime = await create(options);
  return {
    binding,
    enrollment,
    lease,
    client,
    options,
    published,
    heartbeats,
    runtime,
    disconnect: () => {
      live = false;
    },
    reads: () => catalogReads,
  };
}

test("executor controller enrolls, claims and publishes only metadata, then serializes sequences", async () => {
  const f = await fixture();
  const result = await f.runtime.start();
  assert.equal(result.selection.executor_id, f.enrollment.id);
  assert.equal(f.reads(), 1);
  assert.equal(f.published[0].sequence, 1);
  await Promise.all([
    f.runtime.heartbeat(),
    f.runtime.refreshCatalog(),
    f.runtime.heartbeat(),
    f.runtime.refreshCatalog(),
  ]);
  assert.deepEqual(
    f.heartbeats.map((v: any) => v.sequence),
    [1, 2],
  );
  assert.deepEqual(
    f.published.map((v: any) => v.sequence),
    [1, 2, 3],
  );
  for (const value of f.published)
    assert.deepEqual(Object.keys(value).sort(), [
      "binding",
      "executor_id",
      "lease_epoch",
      "models",
      "sequence",
    ]);
  f.runtime.close();
});

test("private inference requires a lease and lets its heartbeat run while waiting", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((done) => {
    entered = done;
  });
  const calls: any[] = [];
  const runtime = await create({
    ...f.options,
    complete: async (request: any, options: any) => {
      calls.push(request);
      entered();
      await new Promise<void>((done) => {
        release = done;
      });
      assert.equal(options.signal.aborted, false);
      return "leased answer";
    },
  });
  try {
    await assert.rejects(runtime.completeDefault({ input: [] }), /not ready/);
    assert.equal(calls.length, 0);
    await runtime.start();
    const answer = runtime.completeDefault({
      input: [{ role: "user", content: "hello" }],
    });
    await waiting;
    await runtime.heartbeat();
    assert.equal(f.heartbeats.length, 1);
    release();
    assert.equal(await answer, "leased answer");
  } finally {
    runtime.close();
    f.runtime.close();
  }
});

test("an executor lease replaced during inference cannot return output", async () => {
  const f = await fixture();
  const runtime = await create({
    ...f.options,
    complete: async () => {
      f.lease.lease_epoch++;
      await runtime.start();
      return "superseded answer";
    },
  });
  try {
    await runtime.start();
    await assert.rejects(
      runtime.completeDefault({ input: [] }),
      /lease changed/,
    );
  } finally {
    runtime.close();
    f.runtime.close();
  }
});
test("an executor lease expiring during inference cannot return output", async () => {
  const f = await fixture();
  const now = Date.now;
  const runtime = await create({
    ...f.options,
    complete: async () => {
      Date.now = () => now() + 240_000;
      return "expired answer";
    },
  });
  try {
    await runtime.start();
    await assert.rejects(
      runtime.completeDefault({ input: [] }),
      /lease changed/,
    );
  } finally {
    Date.now = now;
    runtime.close();
    f.runtime.close();
  }
});

test("executor controller rejects wrong server account, lease epoch and catalog receipt", async () => {
  for (const changed of ["account", "epoch", "receipt"]) {
    const f = await fixture();
    if (changed === "account")
      f.enrollment.binding = { ...f.binding, subject: "different" };
    if (changed === "epoch") f.lease.enrollment_epoch = 2;
    if (changed === "receipt")
      f.client.publishChatgptModels = async () => ({
        executor_id: randomUUID(),
        lease_epoch: 1,
        sequence: 1,
        published_at: new Date().toISOString(),
      });
    await assert.rejects(f.runtime.start(), /changed/);
    assert.equal(f.published.length, 0);
    f.runtime.close();
  }
});

test("revoked connection cannot make a provider catalog call or renew a lease", async () => {
  const f = await fixture();
  await f.runtime.start();
  f.disconnect();
  await assert.rejects(f.runtime.refreshCatalog(), /Account changed/);
  await assert.rejects(f.runtime.heartbeat(), /Account changed/);
  assert.equal(f.reads(), 1);
  assert.equal(f.heartbeats.length, 0);
  f.runtime.close();
});

test("closing during a provider read aborts it and prevents publication or queued heartbeat", async () => {
  const f = await fixture();
  let entered!: () => void, resume!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let providerSignal!: AbortSignal;
  f.options.models = async (signal) => {
    providerSignal = signal;
    entered();
    await new Promise<void>((resolve) => {
      resume = resolve;
    });
    return [{ slug: "fixture-model", display_name: "Fixture model" }];
  };
  const runtime = await create(f.options);
  const start = runtime.start();
  await waiting;
  const heartbeat = runtime.heartbeat();
  runtime.close();
  assert.equal(providerSignal.aborted, true);
  resume();
  await assert.rejects(start, /stopped/);
  await assert.rejects(heartbeat, /stopped/);
  assert.equal(f.published.length, 0);
  assert.equal(f.heartbeats.length, 0);
  f.runtime.close();
});
