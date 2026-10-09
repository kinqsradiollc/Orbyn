import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  createChatgptExecutorSigner,
  createChatgptExecutorLifecycle,
} from "@orbyn/api-client";
import {
  verifyChatgptExecutorProof,
  verifyChatgptCatalogProof,
  chatgptInferenceProofMessage,
} from "../src/modules/auth/chatgpt-executor-proof.js";

function fixture(
  tamper?: "enrollment" | "lease" | "receipt" | "proof",
  inferenceEnabled = false,
) {
  const binding = {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com" as const,
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  const hostId = randomUUID(),
    sessionId = randomUUID(),
    executorId = randomUUID();
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const fingerprint = createHash("sha256")
    .update(Buffer.from(publicKey, "base64url"))
    .digest("base64url");
  let available = true,
    removed = false;
  const messages: string[] = [],
    heartbeats: number[] = [],
    catalogs: number[] = [];
  const signer = createChatgptExecutorSigner({
    binding,
    hostId,
    requireLiveConnection: async () => {
      if (!available) throw new Error("Disconnected");
    },
    digest: async (message) =>
      createHash("sha256").update(message).digest("base64url"),
    keys: {
      metadata: async () => ({
        public_key: publicKey,
        public_key_fingerprint: fingerprint,
      }),
      sign: async (expected, message) => {
        assert.equal(expected, fingerprint);
        messages.push(message);
        return sign("sha256", Buffer.from(message), {
          key: pair.privateKey,
          dsaEncoding: "ieee-p1363",
        }).toString("base64url");
      },
      remove: async () => {
        removed = true;
      },
    },
  });
  const enrolled = {
    id: executorId,
    binding,
    host_id: hostId,
    public_key_fingerprint: fingerprint,
    enrollment_epoch: 1,
  };
  const lease = {
    executor_id: executorId,
    binding,
    enrollment_epoch: 1,
    lease_epoch: 1,
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  let enrollMessage = "",
    leaseMessage = "";
  const client = {
    beginChatgptExecutor: async () => {
      const id = randomUUID();
      enrollMessage = JSON.stringify([
        "orbyn:executor:enroll:v1",
        id,
        sessionId,
        binding,
        hostId,
        fingerprint,
        0,
        null,
        "n".repeat(43),
      ]);
      return {
        id,
        binding,
        host_id: hostId,
        public_key_fingerprint: fingerprint,
        proof_message:
          tamper === "proof"
            ? enrollMessage.replace("orbyn:executor:enroll:v1", "other-domain")
            : enrollMessage,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
    },
    finishChatgptExecutor: async (proof: { signature: string }) => {
      assert.equal(
        verifyChatgptExecutorProof(publicKey, enrollMessage, proof.signature),
        fingerprint,
      );
      return {
        ...enrolled,
        ...(tamper === "enrollment" ? { host_id: randomUUID() } : {}),
      };
    },
    beginChatgptExecutorLease: async () => {
      const id = randomUUID();
      leaseMessage = JSON.stringify([
        "orbyn:executor:lease-claim:v1",
        id,
        sessionId,
        binding,
        executorId,
        1,
        0,
        "l".repeat(43),
      ]);
      return {
        id,
        executor_id: executorId,
        binding,
        enrollment_epoch: 1,
        expected_lease_epoch: 0,
        proof_message: leaseMessage,
        expires_at: new Date(Date.now() + 60000).toISOString(),
      };
    },
    finishChatgptExecutorLease: async (proof: { signature: string }) => {
      assert.equal(
        verifyChatgptExecutorProof(publicKey, leaseMessage, proof.signature),
        fingerprint,
      );
      return { ...lease, ...(tamper === "lease" ? { lease_epoch: 2 } : {}) };
    },
    renewChatgptExecutorLease: async (proof: any) => {
      assert.equal(
        verifyChatgptExecutorProof(
          publicKey,
          JSON.stringify([
            "orbyn:executor:lease-heartbeat:v1",
            proof.heartbeat,
          ]),
          proof.signature,
        ),
        fingerprint,
      );
      heartbeats.push(proof.heartbeat.sequence);
      return lease;
    },
    publishChatgptModels: async (proof: any) => {
      assert.equal(
        verifyChatgptCatalogProof(publicKey, proof.catalog, proof.signature),
        fingerprint,
      );
      assert.deepEqual(
        proof.catalog.capabilities,
        inferenceEnabled ? ["plan_inference_v1"] : undefined,
      );
      catalogs.push(proof.catalog.sequence);
      return {
        executor_id: executorId,
        lease_epoch: 1,
        sequence: proof.catalog.sequence + (tamper === "receipt" ? 1 : 0),
        published_at: new Date().toISOString(),
      };
    },
  };
  const runtime = createChatgptExecutorLifecycle({
    binding,
    client,
    signer,
    requireLiveConnection: async () => {
      if (!available) throw new Error("Disconnected");
    },
    models: async () => [{ slug: "owned-model", display_name: "Owned model" }],
  });
  return {
    runtime,
    signer,
    client,
    binding,
    hostId,
    publicKey,
    fingerprint,
    lease,
    messages,
    heartbeats,
    catalogs,
    disconnect: () => {
      available = false;
    },
    removed: () => removed,
  };
}

test("portable native lifecycle enrolls with real P-256 proofs and serializes heartbeats/catalogs", async () => {
  const f = fixture();
  const result = await f.runtime.start();
  assert.equal(result.selection.connection_id, f.binding.connection_id);
  assert.deepEqual(f.catalogs, [1]);
  await Promise.all([
    f.runtime.heartbeat(),
    f.runtime.heartbeat(),
    f.runtime.refreshCatalog(),
  ]);
  assert.deepEqual(f.heartbeats, [1, 2]);
  assert.deepEqual(f.catalogs, [1, 2]);
  result.lease.binding.subject = "changed-return-copy";
  await f.runtime.heartbeat();
  f.runtime.close();
  await assert.rejects(f.runtime.heartbeat());
});
test("changed challenge domain, enrollment, lease generation or catalog receipt never completes start", async () => {
  for (const tamper of ["proof", "enrollment", "lease", "receipt"] as const) {
    const f = fixture(tamper);
    await assert.rejects(f.runtime.start());
    if (tamper === "proof") assert.equal(f.messages.length, 0);
    await assert.rejects(f.runtime.heartbeat());
    f.runtime.close();
  }
});
test("foreign binding, expired proofs and unrelated lease message are rejected before signing", async () => {
  const f = fixture();
  const challenge = await f.client.beginChatgptExecutor();
  const before = f.messages.length;
  for (const changed of [
    { ...challenge, binding: { ...f.binding, subject: "foreign" } },
    { ...challenge, expires_at: new Date(Date.now() - 1).toISOString() },
    { ...challenge, host_id: randomUUID() },
    { ...challenge, public_key_fingerprint: "x".repeat(43) },
  ])
    await assert.rejects(f.signer.proveEnrollment(changed));
  assert.equal(f.messages.length, before);
  const lease = await f.client.beginChatgptExecutorLease();
  await assert.rejects(
    f.signer.proveLease({
      ...lease,
      proof_message: lease.proof_message.replace("lease-claim", "other-proof"),
    }),
  );
  assert.equal(f.messages.length, before);
});
test("revocation erases only the owned key and permanently stops its signer", async () => {
  const f = fixture();
  await f.signer.revoke();
  assert.equal(f.removed(), true);
  await assert.rejects(f.signer.metadata());
  await assert.rejects(f.runtime.start());
});
test("disconnect and pre-aborted requests prevent publication without treating cancellation as success", async () => {
  const f = fixture();
  await assert.rejects(f.runtime.start(AbortSignal.abort()));
  assert.equal(f.messages.length, 0);
  await f.runtime.start();
  f.disconnect();
  await assert.rejects(f.runtime.refreshCatalog());
  assert.deepEqual(f.catalogs, [1]);
  f.runtime.close();
});

test("closing during a queued proof rejects the result and cannot complete enrollment", async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.signer.proveEnrollment;
  f.signer.proveEnrollment = async (value) => {
    entered();
    await blocked;
    return original(value);
  };
  const pending = f.runtime.start();
  const rejected = assert.rejects(pending);
  await started;
  f.runtime.close();
  release();
  await rejected;
  assert.equal(f.messages.length, 0);
  assert.equal(f.catalogs.length, 0);
});

test("portable native signer sends only a bounded v2 digest to its OS key for large inference", async () => {
  const f = fixture();
  const signed = await f.signer.signInference({
    request_id: randomUUID(),
    executor_id: randomUUID(),
    binding: f.binding,
    enrollment_epoch: 1,
    lease_epoch: 1,
    model: "fixture-model",
    nonce: "n".repeat(43),
    request_hash: "a".repeat(64),
    result: { status: "completed", text: "x".repeat(10000), usage: null },
  });
  assert.equal(signed.proof_format, "sha256_v2");
  assert.ok(Buffer.byteLength(f.messages[0]) < 128);
  assert.equal(
    verifyChatgptExecutorProof(
      f.publicKey,
      chatgptInferenceProofMessage(signed.receipt, signed.proof_format),
      signed.signature,
    ),
    f.fingerprint,
  );
  f.runtime.close();
});

function inferenceFixture() {
  const f = fixture(undefined, true);
  let assignment: any = {
    id: randomUUID(),
    job_id: randomUUID(),
    executor_id: f.lease.executor_id,
    binding: f.binding,
    enrollment_epoch: 1,
    lease_epoch: 1,
    model: "owned-model",
    nonce: "n".repeat(43),
    request_hash: "a".repeat(64),
    expires_at: new Date(Date.now() + 60000).toISOString(),
    payload: {
      instructions: "Private task",
      input: [{ role: "user", content: "Private message" }],
    },
  };
  assignment.request_hash = createHash("sha256")
    .update(
      JSON.stringify({
        binding: assignment.binding,
        model: assignment.model,
        payload: assignment.payload,
        job_id: assignment.job_id,
      }),
    )
    .digest("hex");
  let complete: (
    value: any,
    signal: AbortSignal,
  ) => Promise<unknown> = async () => ({
    status: "completed",
    text: "x".repeat(10000),
    usage: null,
  });
  const publications: any[] = [];
  let calls = 0;
  const runtime = createChatgptExecutorLifecycle({
    binding: f.binding,
    client: f.client,
    signer: f.signer,
    requireLiveConnection: async () => {
      await f.signer.metadata();
    },
    models: async () => [{ slug: "owned-model", display_name: "Owned" }],
    inference: {
      digest: async (message) =>
        createHash("sha256").update(message).digest("hex"),
      client: {
        claimChatgptInference: async () => assignment,
        finishChatgptInference: async (value: any) => {
          verifyChatgptExecutorProof(
            f.publicKey,
            chatgptInferenceProofMessage(value.receipt, value.proof_format),
            value.signature,
          );
          publications.push(value);
        },
      },
      complete: async (value, signal) => {
        calls++;
        return complete(value, signal);
      },
    },
  });
  return {
    ...f,
    runtime,
    assignment,
    publications,
    calls: () => calls,
    setAssignment: (value: any) => {
      assignment = value;
    },
    setComplete: (value: typeof complete) => {
      complete = value;
    },
  };
}
test("portable executor signs one assigned large result and keeps heartbeats independent", async () => {
  const f = inferenceFixture();
  await f.runtime.start();
  let resolve!: (value: unknown) => void;
  f.setComplete(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = f.runtime.executeNext();
  while (!resolve) await new Promise((done) => setImmediate(done));
  assert.deepEqual(await f.runtime.executeNext(), { processed: false });
  await f.runtime.heartbeat();
  resolve({ status: "completed", text: "x".repeat(10000), usage: null });
  assert.deepEqual(await pending, { processed: true });
  assert.equal(f.calls(), 1);
  assert.equal(f.publications.length, 1);
  assert.equal(f.publications[0].proof_format, "sha256_v2");
  f.runtime.close();
});
test("portable executor fences foreign, stale, expired and changed-input assignments before disclosure", async () => {
  for (const field of [
    "binding",
    "executor_id",
    "enrollment_epoch",
    "lease_epoch",
    "expires_at",
    "payload",
  ] as const) {
    const f = inferenceFixture();
    await f.runtime.start();
    const changed = { ...f.assignment };
    if (field === "binding")
      changed.binding = { ...changed.binding, subject: "foreign" };
    else if (field === "executor_id") changed.executor_id = randomUUID();
    else if (field === "expires_at")
      changed.expires_at = new Date(Date.now() - 1).toISOString();
    else if (field === "payload")
      changed.payload = { ...changed.payload, instructions: "changed" };
    else changed[field] = 2;
    f.setAssignment(changed);
    await assert.rejects(f.runtime.executeNext());
    assert.equal(f.calls(), 0);
    assert.equal(f.publications.length, 0);
    f.runtime.close();
  }
});
test("close aborts a provider that ignores its signal and late completion cannot publish", async () => {
  const f = inferenceFixture();
  await f.runtime.start();
  let resolve!: (value: unknown) => void;
  let providerSignal!: AbortSignal;
  f.setComplete((_, signal) => {
    providerSignal = signal;
    return new Promise((done) => {
      resolve = done;
    });
  });
  const pending = f.runtime.executeNext();
  while (!resolve) await new Promise((done) => setImmediate(done));
  f.runtime.close();
  await assert.rejects(pending, /interrupted/);
  assert.equal(providerSignal.aborted, true);
  resolve({ status: "completed", text: "late", usage: null });
  await new Promise((done) => setImmediate(done));
  assert.equal(f.publications.length, 0);
});
test("connection loss, malformed output and expired lease prevent result publication", async (t) => {
  for (const mode of ["disconnect", "invalid", "lease"]) {
    const f = inferenceFixture();
    await f.runtime.start();
    f.setComplete(async () => {
      if (mode === "disconnect") f.disconnect();
      if (mode === "lease")
        t.mock.method(Date, "now", () => Date.parse(f.lease.expires_at) + 1);
      return mode === "invalid"
        ? { status: "completed", text: 42, usage: null }
        : { status: "completed", text: "result", usage: null };
    });
    await assert.rejects(f.runtime.executeNext());
    assert.equal(f.publications.length, 0);
    f.runtime.close();
    t.mock.restoreAll();
  }
});
test("no assignment does no inference, and catalog-only executors cannot execute", async () => {
  const f = inferenceFixture();
  await f.runtime.start();
  f.setAssignment(null);
  assert.deepEqual(await f.runtime.executeNext(), { processed: false });
  assert.equal(f.calls(), 0);
  f.runtime.close();
  const catalog = fixture();
  await catalog.runtime.start();
  await assert.rejects(catalog.runtime.executeNext(), /unavailable/);
  catalog.runtime.close();
});

test("assignment deadline interrupts hung inference without retry or late publication", async () => {
  const f = inferenceFixture();
  await f.runtime.start();
  f.assignment.expires_at = new Date(Date.now() + 100).toISOString();
  f.setComplete(() => new Promise(() => {}));
  await assert.rejects(f.runtime.executeNext(), /interrupted/);
  assert.equal(f.calls(), 1);
  assert.equal(f.publications.length, 0);
  f.runtime.close();
});
test("explicit sanitized provider failures are signed and unknown transport failures are never retried", async () => {
  const f = inferenceFixture();
  await f.runtime.start();
  f.setComplete(async () => ({
    status: "failed",
    reason: "usage_limit",
    phase: "admission",
    http_status: 429,
    provider_code: "subscription_sharing_usage_limit_exceeded",
  }));
  assert.deepEqual(await f.runtime.executeNext(), { processed: true });
  assert.equal(f.publications[0].receipt.result.reason, "usage_limit");
  f.setComplete(async () => {
    throw new Error("unknown provider completion");
  });
  await assert.rejects(f.runtime.executeNext());
  assert.equal(f.calls(), 2);
  assert.equal(f.publications.length, 1);
  f.runtime.close();
});
