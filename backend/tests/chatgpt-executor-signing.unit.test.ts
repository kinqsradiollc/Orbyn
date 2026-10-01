import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  createHash,
  verify,
} from "node:crypto";
import {
  chatgptCatalogSigningInput,
  CHATGPT_CATALOG_SIGNATURE_DOMAIN,
  chatgptLeaseHeartbeatMessage,
} from "@orbyn/core";

const { createChatgptExecutorSigner: create } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-executor-signing.cjs",
);

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-executor-key-"));
  const secret = randomBytes(32);
  let available = true,
    active = true;
  const encrypt = (value: string) => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, nonce);
    return Buffer.concat([
      nonce,
      cipher.update(value),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  };
  const decrypt = (value: Buffer) => {
    const cipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      value.subarray(0, 12),
    );
    cipher.setAuthTag(value.subarray(-16));
    return Buffer.concat([
      cipher.update(value.subarray(12, -16)),
      cipher.final(),
    ]).toString();
  };
  const binding = {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture-subject",
    client_id: "oaiapp_fixture",
  };
  const options = {
    directory,
    apiBaseUrl: "https://fixture.orbyn.invalid/api",
    binding,
    hostId: randomUUID(),
    platform: "darwin",
    requireLiveConnection: async () => {
      if (!active) throw new Error("Connection changed");
    },
    safeStorage: {
      isEncryptionAvailable: () => available,
      isAsyncEncryptionAvailable: async () => available,
      encryptStringAsync: async (value: string) => encrypt(value),
      decryptStringAsync: async (value: Buffer) => ({
        result: decrypt(value),
        shouldReEncrypt: false,
      }),
    },
  };
  const signer = await create(options);
  return {
    directory,
    options,
    binding,
    signer,
    lock: () => {
      available = false;
    },
    disconnect: () => {
      active = false;
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("executor key is encrypted, persists on restart, and exposes only public metadata", async () => {
  const f = await fixture();
  try {
    const values = await Promise.all(
      Array.from({ length: 12 }, () => f.signer.metadata()),
    );
    for (const value of values) assert.deepEqual(value, values[0]);
    assert.deepEqual(Object.keys(values[0]).sort(), [
      "host_id",
      "public_key",
      "public_key_fingerprint",
    ]);
    const namespace = path.join(
      f.directory,
      createHash("sha256").update(f.options.apiBaseUrl).digest("hex"),
      "executor-key",
    );
    const files = await readdir(namespace);
    assert.equal(files.length, 1);
    const filename = path.join(namespace, files[0]);
    const ciphertext = await readFile(filename);
    assert.equal(ciphertext.includes(Buffer.from("privateKey")), false);
    assert.equal(ciphertext.includes(Buffer.from(values[0].public_key)), false);
    assert.equal((await stat(filename)).mode & 0o777, 0o600);
    assert.deepEqual(await (await create(f.options)).metadata(), values[0]);
    const other = await create({
      ...f.options,
      binding: { ...f.binding, connection_id: randomUUID() },
    });
    assert.notEqual((await other.metadata()).public_key, values[0].public_key);
  } finally {
    await f.cleanup();
  }
});

test("executor enrollment signs the exact bound server challenge and rejects tampering", async () => {
  const f = await fixture();
  try {
    const metadata = await f.signer.metadata();
    const id = randomUUID();
    const message = [
      "orbyn:executor:enroll:v1",
      id,
      randomUUID(),
      f.binding,
      f.options.hostId,
      metadata.public_key_fingerprint,
      0,
      null,
      randomBytes(32).toString("base64url"),
    ];
    const challenge = {
      id,
      binding: f.binding,
      host_id: f.options.hostId,
      public_key_fingerprint: metadata.public_key_fingerprint,
      proof_message: JSON.stringify(message),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const proof = await f.signer.proveEnrollment(challenge);
    const publicKey = createPublicKey({
      key: Buffer.from(metadata.public_key, "base64url"),
      format: "der",
      type: "spki",
    });
    assert.equal(proof.challenge_id, id);
    assert.equal(
      verify(
        null,
        Buffer.from(challenge.proof_message),
        publicKey,
        Buffer.from(proof.signature, "base64url"),
      ),
      true,
    );
    await assert.rejects(
      f.signer.proveEnrollment({ ...challenge, host_id: randomUUID() }),
    );
    await assert.rejects(
      f.signer.proveEnrollment({
        ...challenge,
        binding: { ...f.binding, subject: "other" },
      }),
    );
    await assert.rejects(
      f.signer.proveEnrollment({
        ...challenge,
        expires_at: new Date(0).toISOString(),
      }),
    );
    message[0] = "different-domain";
    await assert.rejects(
      f.signer.proveEnrollment({
        ...challenge,
        proof_message: JSON.stringify(message),
      }),
    );
  } finally {
    await f.cleanup();
  }
});

test("executor catalog uses shared canonical digest, rejects wrong account and cannot sign after revoke", async () => {
  const f = await fixture();
  try {
    const metadata = await f.signer.metadata();
    const catalog = {
      executor_id: randomUUID(),
      binding: f.binding,
      lease_epoch: 1,
      sequence: 1,
      models: [{ slug: "fixture-model", display_name: "Fixture model" }],
    };
    const signed = await f.signer.signCatalog(catalog);
    const message = `${CHATGPT_CATALOG_SIGNATURE_DOMAIN}\n${createHash("sha256").update(chatgptCatalogSigningInput(catalog)).digest("base64url")}`;
    const publicKey = createPublicKey({
      key: Buffer.from(metadata.public_key, "base64url"),
      format: "der",
      type: "spki",
    });
    assert.equal(
      verify(
        null,
        Buffer.from(message),
        publicKey,
        Buffer.from(signed.signature, "base64url"),
      ),
      true,
    );
    await assert.rejects(
      f.signer.signCatalog({
        ...catalog,
        binding: { ...f.binding, connection_id: randomUUID() },
      }),
    );
    await f.signer.revoke();
    await assert.rejects(f.signer.signCatalog(catalog), /disconnected/);
    await assert.rejects(f.signer.metadata(), /disconnected/);
    assert.notEqual(
      (await (await create(f.options)).metadata()).public_key,
      metadata.public_key,
    );
  } finally {
    await f.cleanup();
  }
});

test("executor signing fails closed when OS storage or current connection is unavailable", async () => {
  for (const lock of [true, false]) {
    const f = await fixture();
    try {
      await f.signer.metadata();
      if (lock) f.lock();
      else f.disconnect();
      await assert.rejects(
        f.signer.metadata(),
        lock ? /storage is unavailable/ : /Connection changed/,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test("lease proofs bind the server challenge and heartbeats use the shared signed message", async () => {
  const f = await fixture();
  try {
    const metadata = await f.signer.metadata();
    const id = randomUUID(),
      executorId = randomUUID();
    const message = [
      "orbyn:executor:lease-claim:v1",
      id,
      randomUUID(),
      f.binding,
      executorId,
      2,
      3,
      randomBytes(32).toString("base64url"),
    ];
    const challenge = {
      id,
      executor_id: executorId,
      binding: f.binding,
      enrollment_epoch: 2,
      expected_lease_epoch: 3,
      proof_message: JSON.stringify(message),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const publicKey = createPublicKey({
      key: Buffer.from(metadata.public_key, "base64url"),
      format: "der",
      type: "spki",
    });
    const signed = await f.signer.proveLease(challenge);
    assert.equal(
      verify(
        null,
        Buffer.from(challenge.proof_message),
        publicKey,
        Buffer.from(signed.signature, "base64url"),
      ),
      true,
    );
    for (const changed of [
      { ...challenge, enrollment_epoch: 1 },
      { ...challenge, expected_lease_epoch: 2 },
      { ...challenge, executor_id: randomUUID() },
      { ...challenge, expires_at: new Date(0).toISOString() },
      { ...challenge, binding: { ...f.binding, subject: "wrong-account" } },
    ])
      await assert.rejects(f.signer.proveLease(changed));
    const heartbeat = { executor_id: executorId, lease_epoch: 4, sequence: 1 };
    const renewal = await f.signer.signHeartbeat(heartbeat);
    assert.equal(
      verify(
        null,
        Buffer.from(chatgptLeaseHeartbeatMessage(heartbeat)),
        publicKey,
        Buffer.from(renewal.signature, "base64url"),
      ),
      true,
    );
    await assert.rejects(f.signer.signHeartbeat({ ...heartbeat, sequence: 0 }));
    await assert.rejects(
      f.signer.signHeartbeat({ ...heartbeat, accessToken: "forbidden" }),
    );
  } finally {
    await f.cleanup();
  }
});

test("a proof that expires while secure storage is opening is never signed", async () => {
  const f = await fixture();
  try {
    const metadata = await f.signer.metadata();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let pause = false;
    const signer = await create({
      ...f.options,
      requireLiveConnection: async () => {
        if (!pause) return;
        pause = false;
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });
    const id = randomUUID();
    const message = [
      "orbyn:executor:enroll:v1",
      id,
      randomUUID(),
      f.binding,
      f.options.hostId,
      metadata.public_key_fingerprint,
      0,
      null,
      randomBytes(32).toString("base64url"),
    ];
    const expiresAt = Date.now() + 80;
    pause = true;
    const result = signer.proveEnrollment({
      id,
      binding: f.binding,
      host_id: f.options.hostId,
      public_key_fingerprint: metadata.public_key_fingerprint,
      proof_message: JSON.stringify(message),
      expires_at: new Date(expiresAt).toISOString(),
    });
    await waiting;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, expiresAt - Date.now()) + 20),
    );
    release();
    await assert.rejects(result, /expired/);
  } finally {
    await f.cleanup();
  }
});
