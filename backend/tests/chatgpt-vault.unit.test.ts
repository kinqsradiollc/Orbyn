import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtemp,
  readdir,
  readFile,
  stat,
  copyFile,
  writeFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  randomUUID,
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
} from "node:crypto";
const { createChatgptVault: create } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-vault.cjs",
);
const binding = {
  user_id: randomUUID(),
  connection_id: randomUUID(),
  issuer: "https://auth.openai.com",
  subject: "fixture-account",
  client_id: "oaiapp_fixture",
};
const credentials = {
  clientId: binding.client_id,
  idToken: "fixture-id-token",
  accessToken: "fixture-access-token",
  refreshToken: "fixture-refresh-token",
  tokenType: "Bearer",
  scopes: ["openid", "chatgpt.tokens.use.direct"],
  savedAt: 1000,
  expiresAt: 3601000,
};
const apiBaseUrl = "https://fixture.orbyn.invalid/api";
const status = (code: string) => (e: any) => e.code === code;
const filename = (root: string, owner = binding, base = apiBaseUrl) =>
  path.join(
    root,
    createHash("sha256").update(base).digest("hex"),
    `${createHash("sha256").update(JSON.stringify(owner)).digest("hex")}.enc`,
  );
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-vault-test-"));
  const key = randomBytes(32);
  let available = true,
    rotate = false,
    failed = false;
  const encrypt = (text: string) => {
    if (failed) throw new Error("private-provider-detail");
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, nonce);
    return Buffer.concat([
      nonce,
      cipher.update(text),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  };
  const decrypt = (bytes: Buffer) => {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      decipher.update(bytes.subarray(12, -16)),
      decipher.final(),
    ]).toString();
  };
  const provider = {
    isEncryptionAvailable: () => available,
    isAsyncEncryptionAvailable: async () => available,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: encrypt,
    decryptString: decrypt,
    encryptStringAsync: async (text: string) => encrypt(text),
    decryptStringAsync: async (bytes: Buffer) => ({
      result: decrypt(bytes),
      shouldReEncrypt: rotate,
    }),
  };
  const options = {
    directory,
    apiBaseUrl,
    safeStorage: provider,
    platform: "darwin",
  };
  return {
    directory,
    provider,
    options,
    vault: await create(options),
    lock: () => {
      available = false;
    },
    unlock: () => {
      available = true;
    },
    rotate: () => {
      rotate = true;
    },
    fail: () => {
      failed = true;
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("executor keys validate the exact Ed25519 pair and reject credential fields", async () => {
  const f = await fixture();
  try {
    const vault = await create({ ...f.options, purpose: "executor-key" });
    const keys = generateKeyPairSync("ed25519");
    const record = {
      privateKey: keys.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64url"),
      publicKey: keys.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64url"),
      createdAt: Date.now(),
    };
    for (const invalid of [
      { ...record, accessToken: "not-a-key" },
      { ...record, privateKey: "A".repeat(64) },
      { ...record, publicKey: "A".repeat(59) },
      { ...record, createdAt: -1 },
      credentials,
    ])
      await assert.rejects(
        vault.write(binding, invalid, null),
        status("STORAGE_INVALID"),
      );
    await vault.write(binding, record, null);
    assert.deepEqual((await vault.read(binding)).credentials, record);
    await assert.rejects(
      f.vault.write(binding, record, null),
      status("STORAGE_INVALID"),
    );
  } finally {
    await f.cleanup();
  }
});

test("encrypted executor keys and OAuth credentials cannot be substituted across purposes", async () => {
  const f = await fixture();
  try {
    const vault = await create({ ...f.options, purpose: "executor-key" });
    const keys = generateKeyPairSync("ed25519");
    await vault.write(
      binding,
      {
        privateKey: keys.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64url"),
        publicKey: keys.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64url"),
        createdAt: Date.now(),
      },
      null,
    );
    await f.vault.write(binding, credentials, null);
    const credentialPath = filename(f.directory);
    const keyPath = path.join(
      path.dirname(credentialPath),
      "executor-key",
      path.basename(credentialPath),
    );
    const keyBytes = await readFile(keyPath),
      credentialBytes = await readFile(credentialPath);
    await writeFile(keyPath, credentialBytes);
    await writeFile(credentialPath, keyBytes);
    await assert.rejects(vault.read(binding), status("STORAGE_INVALID"));
    await assert.rejects(f.vault.read(binding), status("STORAGE_INVALID"));
  } finally {
    await f.cleanup();
  }
});

test("vault rejects a ciphertext symlink without decrypting its target", async () => {
  const f = await fixture();
  try {
    await f.vault.write(binding, credentials, null);
    const file = filename(f.directory);
    await rename(file, `${file}.target`);
    await symlink(`${file}.target`, file);
    await assert.rejects(f.vault.read(binding), status("STORAGE_INVALID"));
  } finally {
    await f.cleanup();
  }
});

test("an asynchronous keychain check cannot redirect an already-open vault read", async () => {
  const f = await fixture();
  try {
    const revision = await f.vault.write(binding, credentials, null);
    const file = filename(f.directory);
    const available = f.provider.isAsyncEncryptionAvailable;
    let replace = true;
    f.provider.isAsyncEncryptionAvailable = async () => {
      if (replace) {
        replace = false;
        await rename(file, `${file}.original`);
        await writeFile(file, "tampered-ciphertext");
      }
      return available();
    };
    const result = await f.vault.read(binding);
    assert.equal(result.revision, revision);
    assert.equal(result.credentials.accessToken, credentials.accessToken);
    await assert.rejects(f.vault.read(binding), status("STORAGE_INVALID"));
  } finally {
    await f.cleanup();
  }
});

test("vault encrypts metadata and credentials, persists across restart and uses private permissions", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.vault.read(binding), {
      revision: null,
      credentials: null,
    });
    const revision = await f.vault.write(binding, credentials, null);
    const bytes = await readFile(filename(f.directory));
    for (const privateValue of [
      credentials.accessToken,
      credentials.refreshToken,
      credentials.idToken,
      binding.subject,
    ])
      assert.ok(!bytes.includes(Buffer.from(privateValue)));
    assert.equal((await stat(filename(f.directory))).mode & 0o777, 0o600);
    assert.equal(
      (await stat(path.dirname(filename(f.directory)))).mode & 0o777,
      0o700,
    );
    const restarted = await create(f.options);
    const restored = await restarted.read(binding);
    assert.equal(restored.revision, revision);
    assert.equal(restored.credentials.accessToken, credentials.accessToken);
    assert.equal(restored.credentials.sharingGranted, true);
    assert.deepEqual(await readdir(path.dirname(filename(f.directory))), [
      path.basename(filename(f.directory)),
    ]);
  } finally {
    await f.cleanup();
  }
});

test("copied encrypted records cannot cross users, registrations or Orbyn servers", async () => {
  const f = await fixture();
  try {
    await f.vault.write(binding, credentials, null);
    const other = { ...binding, user_id: randomUUID() };
    assert.equal((await f.vault.read(other)).credentials, null);
    await copyFile(filename(f.directory), filename(f.directory, other));
    await assert.rejects(f.vault.read(other), status("STORAGE_INVALID"));
    const otherBase = "https://other.orbyn.invalid/api";
    const otherServer = await create({ ...f.options, apiBaseUrl: otherBase });
    assert.equal((await otherServer.read(binding)).credentials, null);
    // Make the destination directory through its own encrypted write, then replace it.
    await otherServer.write(binding, credentials, null);
    await copyFile(
      filename(f.directory),
      filename(f.directory, binding, otherBase),
    );
    await assert.rejects(otherServer.read(binding), status("STORAGE_INVALID"));
    await assert.rejects(
      f.vault.write(
        binding,
        { ...credentials, clientId: "oaiapp_other" },
        (await f.vault.read(binding)).revision,
      ),
      status("STORAGE_INVALID"),
    );
  } finally {
    await f.cleanup();
  }
});

test("concurrent replacement has one winner and an encryption failure keeps the old credentials", async () => {
  const f = await fixture();
  try {
    const original = await f.vault.write(binding, credentials, null);
    const outcomes = await Promise.allSettled([
      f.vault.write(
        binding,
        {
          ...credentials,
          accessToken: "next-access-a",
          refreshToken: "next-refresh-a",
        },
        original,
      ),
      f.vault.write(
        binding,
        {
          ...credentials,
          accessToken: "next-access-b",
          refreshToken: "next-refresh-b",
        },
        original,
      ),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    const rejected = outcomes.find(
      (o) => o.status === "rejected",
    ) as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "STORAGE_CONFLICT");
    const kept = await f.vault.read(binding);
    f.fail();
    await assert.rejects(
      f.vault.write(binding, credentials, kept.revision),
      status("STORAGE_UNAVAILABLE"),
    );
    assert.deepEqual(await f.vault.read(binding), kept);
  } finally {
    await f.cleanup();
  }
});

test("disconnect erases while keychain is locked and fences stale refresh generations", async () => {
  const f = await fixture();
  try {
    const old = await f.vault.write(binding, credentials, null);
    f.lock();
    const disconnected = await f.vault.revoke(binding);
    assert.notEqual(disconnected, old);
    assert.deepEqual(await f.vault.read(binding), {
      revision: disconnected,
      credentials: null,
    });
    f.unlock();
    await assert.rejects(
      f.vault.write(binding, credentials, old),
      status("STORAGE_CONFLICT"),
    );
    await assert.rejects(
      f.vault.write(binding, credentials, null),
      status("STORAGE_CONFLICT"),
    );
    assert.notEqual(
      await f.vault.write(binding, credentials, disconnected),
      disconnected,
    );
  } finally {
    await f.cleanup();
  }
});

test("disconnect intent immediately fences a pending OS encryption operation", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const encrypt = f.provider.encryptStringAsync;
  f.provider.encryptStringAsync = async (text: string) => {
    entered();
    await hold;
    return encrypt(text);
  };
  try {
    const writing = f.vault.write(binding, credentials, null);
    const observed = assert.rejects(writing, status("STORAGE_CONFLICT"));
    await started;
    const revoking = f.vault.revoke(binding);
    release();
    await observed;
    await revoking;
    assert.equal((await f.vault.read(binding)).credentials, null);
    assert.deepEqual(await readdir(f.directory), []);
  } finally {
    release();
    await f.cleanup();
  }
});

test("unprotected Linux fallback, unavailable keychains and corrupt records fail closed", async () => {
  const f = await fixture();
  try {
    const linux = await create({
      ...f.options,
      platform: "linux",
      safeStorage: {
        ...f.provider,
        getSelectedStorageBackend: () => "basic_text",
      },
    });
    await assert.rejects(
      linux.write(binding, credentials, null),
      status("STORAGE_UNAVAILABLE"),
    );
    f.lock();
    await assert.rejects(
      f.vault.write(binding, credentials, null),
      status("STORAGE_UNAVAILABLE"),
    );
    f.unlock();
    await f.vault.write(binding, credentials, null);
    await writeFile(filename(f.directory), "fixture-private-corrupt-file");
    await assert.rejects(
      f.vault.read(binding),
      (e: any) =>
        e.code === "STORAGE_INVALID" && !e.message.includes("fixture-private"),
    );
  } finally {
    await f.cleanup();
  }
});

test("OS key rotation reencrypts atomically without changing the credential generation", async () => {
  const f = await fixture();
  try {
    const revision = await f.vault.write(binding, credentials, null);
    const before = await readFile(filename(f.directory));
    f.rotate();
    const value = await f.vault.read(binding);
    assert.equal(value.revision, revision);
    assert.equal(value.credentials.accessToken, credentials.accessToken);
    assert.notDeepEqual(await readFile(filename(f.directory)), before);
  } finally {
    await f.cleanup();
  }
});

test("callback nonce survives code exchange and verified identity selects the encrypted registration", async () => {
  const { prepareChatgptAuthorization, exchangeChatgptCode } = createRequire(
    import.meta.url,
  )("../../desktop/chatgpt-oauth.cjs");
  const { createOpenAiIdentityVerifier } =
    await import("../src/modules/auth/openai-identity.js");
  const { generateKeyPairSync } = await import("node:crypto");
  const { SignJWT } = await import("jose");
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const verify = createOpenAiIdentityVerifier(async () => keys.publicKey);
  const f = await fixture();
  const attempt = await prepareChatgptAuthorization({
    hostId: `urn:uuid:${randomUUID()}`,
    nonce: "backend-challenge-nonce-1234567890",
    timeoutMs: 5000,
  });
  try {
    const auth = new URL(attempt.authorizationUrl);
    const callbackUrl = new URL(attempt.redirectUri);
    callbackUrl.searchParams.set("state", auth.searchParams.get("state")!);
    callbackUrl.searchParams.set("code", "fixture-code");
    callbackUrl.searchParams.set("client_id", binding.client_id);
    assert.equal((await fetch(callbackUrl)).status, 200);
    const pending = await attempt.result;
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ nonce: pending.nonce })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(binding.issuer)
      .setSubject(binding.subject)
      .setAudience(binding.client_id)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .sign(keys.privateKey);
    const granted = await exchangeChatgptCode(pending, {
      fetch: async () =>
        Response.json({
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          id_token: idToken,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "openid chatgpt.tokens.use.direct",
        }),
    });
    const identity = await verify(granted.idToken, {
      clientId: pending.clientId,
      nonce: pending.nonce,
    });
    assert.equal(identity.subject, binding.subject);
    await assert.rejects(
      verify(granted.idToken, {
        clientId: pending.clientId,
        nonce: "another-sign-in-nonce-1234567890",
      }),
    );
    const verifiedBinding = {
      ...binding,
      issuer: identity.issuer,
      subject: identity.subject,
      client_id: identity.clientId,
    };
    await f.vault.write(verifiedBinding, granted, null);
    const stored = await f.vault.read(verifiedBinding);
    assert.equal(stored.credentials.idToken, idToken);
    assert.equal(stored.credentials.sharingGranted, true);
    assert.ok(
      !(await readFile(filename(f.directory))).includes(Buffer.from(idToken)),
    );
  } finally {
    attempt.cancel();
    await f.cleanup();
  }
});

test("observed vault revocation preserves newer reconnects and erases matching credentials", async () => {
  const f = await fixture();
  try {
    const first = await f.vault.write(binding, credentials, null);
    const second = await f.vault.write(
      binding,
      { ...credentials, accessToken: "newer-token" },
      first,
    );
    await assert.rejects(
      f.vault.revokeObserved(binding, first),
      status("STORAGE_CONFLICT"),
    );
    assert.equal(
      (await f.vault.read(binding)).credentials.accessToken,
      "newer-token",
    );
    await f.vault.revokeObserved(binding, second);
    assert.equal((await f.vault.read(binding)).credentials, null);
  } finally {
    await f.cleanup();
  }
});

test("observed vault removal is cancelled if its owner stops during keychain read", async () => {
  const f = await fixture();
  try {
    const revision = await f.vault.write(binding, credentials, null);
    const controller = new AbortController();
    const decrypt = f.provider.decryptStringAsync;
    f.provider.decryptStringAsync = async (bytes: Buffer) => {
      const result = await decrypt(bytes);
      controller.abort();
      return result;
    };
    await assert.rejects(
      f.vault.revokeObserved(binding, revision, { signal: controller.signal }),
    );
    f.provider.decryptStringAsync = decrypt;
    assert.equal((await f.vault.read(binding)).revision, revision);
    assert.equal(
      (await f.vault.read(binding)).credentials.accessToken,
      credentials.accessToken,
    );
  } finally {
    await f.cleanup();
  }
});
