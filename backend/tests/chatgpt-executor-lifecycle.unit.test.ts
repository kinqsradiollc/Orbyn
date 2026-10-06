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
} from "../src/modules/auth/chatgpt-executor-proof.js";

function fixture(tamper?: "enrollment" | "lease" | "receipt" | "proof") {
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
      assert.equal(proof.catalog.capabilities, undefined);
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
