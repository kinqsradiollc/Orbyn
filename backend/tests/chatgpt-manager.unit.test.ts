import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  randomUUID,
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { chatgptLeaseHeartbeatMessage, chatgptDesktopState } from "@orbyn/core";
import {
  verifyChatgptExecutorProof,
  verifyChatgptCatalogProof,
} from "../src/modules/auth/chatgpt-executor-proof.js";
const { createChatgptManager: create } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-manager.cjs",
);

async function fixture(identityOnly = false) {
  const directory = await mkdtemp(
    path.join(tmpdir(), "orbyn-chatgpt-manager-"),
  );
  const secret = randomBytes(32),
    userA = randomUUID(),
    userB = randomUUID();
  const connections = new Map<string, any>(),
    enrollments = new Map<string, any>();
  const challenges = new Map<string, any>(),
    leases = new Map<string, any>(),
    catalogs = new Map<string, any>();
  const preferences = new Map<string, any>();
  let providerCalls = 0,
    revokeConfirmed = false;
  const encrypt = (text: string) => {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", secret, nonce);
    return Buffer.concat([
      nonce,
      cipher.update(text),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  };
  const decrypt = (bytes: Buffer) => {
    const cipher = createDecipheriv(
      "aes-256-gcm",
      secret,
      bytes.subarray(0, 12),
    );
    cipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([
      cipher.update(bytes.subarray(12, -16)),
      cipher.final(),
    ]).toString();
  };
  const publicConnection = (c: any) => ({
    id: c.id,
    issuer: c.issuer,
    subject: c.subject,
    client_id: c.client_id,
  });
  const client = async (token: string) => {
    const userId = token === "account-a" ? userA : userB,
      sessionId = randomUUID();
    const own = (id: string) => {
      const value = connections.get(id);
      assert.equal(value?.user_id, userId);
      assert.equal(value?.revoked, false);
      return value;
    };
    const binding = (id: string) => {
      const c = own(id);
      return {
        user_id: userId,
        connection_id: c.id,
        issuer: c.issuer,
        subject: c.subject,
        client_id: c.client_id,
      };
    };
    return {
      me: async () => ({ id: userId }),
      startChatgptConnection: async (input: any) => {
        const value = {
          id: randomUUID(),
          client_id: input.client_id ?? `oaiapp_${randomUUID()}`,
        };
        challenges.set(value.id, value);
        return value;
      },
      finishChatgptConnection: async (input: any) => {
        assert.ok(challenges.has(input.challenge_id));
        let c = [...connections.values()].find(
          (value) =>
            value.user_id === userId && value.client_id === input.client_id,
        );
        if (!c) {
          c = {
            id: randomUUID(),
            user_id: userId,
            issuer: "https://auth.openai.com",
            subject: `fixture-${randomUUID()}`,
            client_id: input.client_id,
          };
          connections.set(c.id, c);
        }
        c.revoked = false;
        return publicConnection(c);
      },
      chatgptConnections: async () =>
        [...connections.values()]
          .filter((c) => c.user_id === userId && !c.revoked)
          .map((c) => ({
            ...publicConnection(c),
            verified_at: new Date().toISOString(),
          })),
      beginChatgptExecutor: async (input: any) => {
        const b = binding(input.connection_id),
          id = randomUUID();
        const fingerprint = createHash("sha256")
          .update(Buffer.from(input.public_key, "base64url"))
          .digest("base64url");
        const previous = [...enrollments.values()].find(
          (e) =>
            e.binding.connection_id === input.connection_id &&
            e.host_id === input.host_id,
        );
        const message = JSON.stringify([
          "orbyn:executor:enroll:v1",
          id,
          sessionId,
          b,
          input.host_id,
          fingerprint,
          previous?.enrollment_epoch ?? 0,
          previous?.id ?? null,
          randomBytes(32).toString("base64url"),
        ]);
        const challenge = {
          id,
          binding: b,
          host_id: input.host_id,
          public_key_fingerprint: fingerprint,
          proof_message: message,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        };
        challenges.set(id, {
          challenge,
          public_key: input.public_key,
          previous,
        });
        return challenge;
      },
      finishChatgptExecutor: async (input: any) => {
        const { challenge, public_key, previous } = challenges.get(
          input.challenge_id,
        );
        assert.equal(
          verifyChatgptExecutorProof(
            public_key,
            challenge.proof_message,
            input.signature,
          ),
          challenge.public_key_fingerprint,
        );
        const enrolled = {
          id: previous?.id ?? randomUUID(),
          binding: challenge.binding,
          host_id: challenge.host_id,
          public_key_fingerprint: challenge.public_key_fingerprint,
          enrollment_epoch: (previous?.enrollment_epoch ?? 0) + 1,
        };
        enrollments.set(enrolled.id, { ...enrolled, public_key });
        return enrolled;
      },
      beginChatgptExecutorLease: async ({ executor_id }: any) => {
        const e = enrollments.get(executor_id);
        own(e.binding.connection_id);
        const id = randomUUID(),
          epoch = leases.get(executor_id)?.lease_epoch ?? 0;
        const challenge = {
          id,
          executor_id,
          binding: e.binding,
          enrollment_epoch: e.enrollment_epoch,
          expected_lease_epoch: epoch,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          proof_message: JSON.stringify([
            "orbyn:executor:lease-claim:v1",
            id,
            sessionId,
            e.binding,
            executor_id,
            e.enrollment_epoch,
            epoch,
            randomBytes(32).toString("base64url"),
          ]),
        };
        challenges.set(id, challenge);
        return challenge;
      },
      finishChatgptExecutorLease: async (input: any) => {
        const c = challenges.get(input.challenge_id),
          e = enrollments.get(c.executor_id);
        verifyChatgptExecutorProof(
          e.public_key,
          c.proof_message,
          input.signature,
        );
        const lease = {
          executor_id: e.id,
          binding: e.binding,
          enrollment_epoch: e.enrollment_epoch,
          lease_epoch: c.expected_lease_epoch + 1,
          expires_at: new Date(Date.now() + 120_000).toISOString(),
        };
        leases.set(e.id, lease);
        return lease;
      },
      renewChatgptExecutorLease: async (input: any) => {
        const e = enrollments.get(input.heartbeat.executor_id);
        verifyChatgptExecutorProof(
          e.public_key,
          chatgptLeaseHeartbeatMessage(input.heartbeat),
          input.signature,
        );
        return leases.get(e.id);
      },
      publishChatgptModels: async ({ catalog, signature }: any) => {
        const e = enrollments.get(catalog.executor_id);
        own(e.binding.connection_id);
        verifyChatgptCatalogProof(e.public_key, catalog, signature);
        assert.equal(catalog.lease_epoch, leases.get(e.id).lease_epoch);
        catalogs.set(e.id, catalog);
        return {
          executor_id: e.id,
          lease_epoch: catalog.lease_epoch,
          sequence: catalog.sequence,
          published_at: new Date().toISOString(),
        };
      },
      chatgptModels: async (selection: any) => {
        const b = binding(selection.connection_id),
          catalog = catalogs.get(selection.executor_id);
        assert.deepEqual(catalog.binding, b);
        return {
          executor_id: selection.executor_id,
          binding: b,
          status: "ready",
          models: catalog.models,
          preference: preferences.get(b.connection_id) ?? {
            binding: b,
            model: null,
            version: 0,
          },
          published_at: new Date().toISOString(),
          expires_at: leases.get(selection.executor_id).expires_at,
          sequence: catalog.sequence,
        };
      },
      selectChatgptDefault: async ({ selection, preference }: any) => {
        const b = binding(selection.connection_id);
        assert.deepEqual(preference.binding, b);
        assert.equal(
          preference.version,
          preferences.get(b.connection_id)?.version ?? 0,
        );
        const next = { ...preference, version: preference.version + 1 };
        preferences.set(b.connection_id, next);
        return next;
      },
      revokeChatgptConnection: async (id: string) => {
        own(id).revoked = true;
      },
    };
  };
  const options = {
    directory,
    apiBaseUrl: "https://fixture.orbyn.invalid/api",
    platform: "darwin",
    safeStorage: {
      isEncryptionAvailable: () => true,
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (text: string) => encrypt(text),
      decryptStringAsync: async (bytes: Buffer) => ({
        result: decrypt(bytes),
        shouldReEncrypt: false,
      }),
    },
    createClient: client,
    openAuthorization: async () => {},
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "https://api.openai.com/v1/models");
      assert.equal(
        (init.headers as any).Authorization,
        "Bearer private-fixture-access",
      );
      providerCalls++;
      return Response.json({
        models: [
          {
            slug: "fixture-model",
            display_name: "Fixture model",
            visibility: "list",
          },
        ],
      });
    },
    signIn: async (input: any) => {
      input.signal.throwIfAborted();
      const registration = await input.registrationStore.read();
      const challenge = await input.beginConnection(
        registration.clientId ? { client_id: registration.clientId } : {},
      );
      const retained = await input.registrationStore.retain(
        challenge.client_id,
        registration.revision,
      );
      const c = await input.finishConnection({
        challenge_id: challenge.id,
        client_id: challenge.client_id,
        id_token: "private-fixture-proof",
      });
      const b = {
        user_id: input.userId,
        connection_id: c.id,
        issuer: c.issuer,
        subject: c.subject,
        client_id: c.client_id,
      };
      if (input.reconnectBinding) assert.deepEqual(b, input.reconnectBinding);
      await input.registrationStore.linkVerifiedConnection(
        b,
        retained.revision,
      );
      const saved = await input.vault.read(b);
      await input.vault.write(
        b,
        {
          clientId: b.client_id,
          idToken: "private-fixture-proof",
          accessToken: "private-fixture-access",
          refreshToken: "private-fixture-refresh",
          tokenType: "Bearer",
          scopes: identityOnly
            ? ["openid"]
            : ["openid", "chatgpt.tokens.use.direct"],
          savedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
        saved.revision,
      );
      return { binding: b };
    },
    revoke: async () => ({ revoked: revokeConfirmed }),
  };
  const manager = await create(options);
  return {
    options,
    manager,
    preferences,
    catalogs,
    userA,
    userB,
    calls: () => providerCalls,
    confirmed: () => {
      revokeConfirmed = true;
    },
    cleanup: async () => {
      manager.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("manager composes real encrypted storage, signing and plan catalog with account-bound server defaults", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.manager.setSession("account-a")).connections.length,
      0,
    );
    const connected = await f.manager.connect();
    assert.equal(connected.busy, false);
    assert.equal(connected.catalog.status, "ready");
    chatgptDesktopState.parse(connected);
    const first = connected.connections[0].registration_id;
    const saved = await f.manager.setDefault("fixture-model", 0);
    assert.equal(saved.catalog.preference.version, 1);
    assert.equal(saved.catalog.preference.model, "fixture-model");
    const other = await f.manager.connect();
    assert.equal(other.connections.length, 2);
    assert.equal(other.catalog.preference.model, null);
    const selected = await f.manager.select(first, other.selection.revision);
    assert.equal(selected.catalog.preference.model, "fixture-model");
    await assert.rejects(
      f.manager.setDefault(null, 0),
      /default model changed/,
    );
    const state = JSON.stringify(await f.manager.snapshot());
    for (const secret of [
      "private-fixture-proof",
      "private-fixture-access",
      "private-fixture-refresh",
      "privateKey",
    ])
      assert.equal(state.includes(secret), false);
    f.manager.close();
    const restarted = await create(f.options);
    try {
      const restored = await restarted.setSession("account-a");
      assert.equal(restored.catalog.preference.model, "fixture-model");
      assert.equal(restored.connections.length, 2);
      assert.equal(restored.selection.registrationId, first);
    } finally {
      restarted.close();
    }
  } finally {
    await f.cleanup();
  }
});

test("an unavailable executor retains its default without leaking it into another selection", async () => {
  const f = await fixture();
  const scheduled: (() => Promise<void>)[] = [];
  let offline = false;
  const manager = await create({
    ...f.options,
    createClient: async (
      ...args: Parameters<typeof f.options.createClient>
    ) => {
      const client = await f.options.createClient(...args);
      const renew = client.renewChatgptExecutorLease;
      client.renewChatgptExecutorLease = async (input: any) => {
        if (offline) throw new Error("private upstream failure");
        return renew(input);
      };
      return client;
    },
    fetch: async (...args: Parameters<typeof f.options.fetch>) => {
      if (offline) throw new Error("private upstream failure");
      return f.options.fetch(...args);
    },
    schedule: (fn: () => Promise<void>) => {
      scheduled.push(fn);
      return scheduled.length;
    },
    cancelSchedule: () => {},
  });
  try {
    await manager.setSession("account-a");
    const connected = await manager.connect();
    await manager.setDefault("fixture-model", 0);
    offline = true;
    await scheduled[0]();
    const failed = await manager.snapshot();
    assert.equal(failed.catalog.status, "unavailable");
    assert.deepEqual(failed.catalog.models, []);
    assert.equal(failed.catalog.preference.model, "fixture-model");
    chatgptDesktopState.parse(failed);
    offline = false;
    const another = await manager.connect();
    assert.notEqual(
      another.selection.registrationId,
      connected.selection.registrationId,
    );
    assert.equal(another.catalog.preference.model, null);
    chatgptDesktopState.parse(another);
  } finally {
    manager.close();
    await f.cleanup();
  }
});

test("switching the Orbyn account hides previous registrations and stops its executor", async () => {
  const f = await fixture();
  try {
    await f.manager.setSession("account-a");
    await f.manager.connect();
    const before = f.calls();
    const switched = await f.manager.setSession("account-b");
    assert.equal(switched.user_id, f.userB);
    assert.equal(switched.connections.length, 0);
    assert.equal(switched.catalog, null);
    await assert.rejects(f.manager.setDefault("fixture-model", 0));
    assert.equal(f.calls(), before);
    assert.equal((await f.manager.setSession(null)).status, "signed-out");
    assert.throws(() => f.manager.connect(), /Sign in to Orbyn/);
  } finally {
    await f.cleanup();
  }
});

test("identity-only consent remains connected without loading models or enrolling an executor", async () => {
  const f = await fixture(true);
  try {
    await f.manager.setSession("account-a");
    const connected = await f.manager.connect();
    assert.equal(connected.connections.length, 1);
    assert.equal(connected.connections[0].sharing_granted, false);
    assert.equal(connected.catalog, null);
    assert.equal(f.calls(), 0);
    assert.equal(f.catalogs.size, 0);
    assert.match(connected.error, /identity/);
    chatgptDesktopState.parse(connected);
  } finally {
    await f.cleanup();
  }
});

test("disconnect clears the grant, preserves registration for reconnect, and reports revocation confirmation", async () => {
  const f = await fixture();
  try {
    await f.manager.setSession("account-a");
    const connected = await f.manager.connect();
    const id = connected.selection.registrationId;
    const originalBinding = connected.connections[0].binding;
    const disconnected = await f.manager.disconnect(id);
    assert.equal(disconnected.remote_revocation_confirmed, false);
    assert.equal(disconnected.state.busy, false);
    assert.equal(disconnected.state.selection.registrationId, null);
    assert.equal(disconnected.state.catalog, null);
    const reconnected = await f.manager.reconnect(id);
    assert.deepEqual(reconnected.connections[0].binding, originalBinding);
    assert.equal(reconnected.catalog.status, "ready");
    f.confirmed();
    assert.equal(
      (await f.manager.disconnect(id)).remote_revocation_confirmed,
      true,
    );
  } finally {
    await f.cleanup();
  }
});

test("cancelled sign-in cannot activate an account or leave a second browser authorization queued", async () => {
  const f = await fixture();
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const manager = await create({
    ...f.options,
    signIn: async (input: any) => {
      entered();
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener(
          "abort",
          () => reject(new Error("Cancelled")),
          { once: true },
        );
      });
    },
  });
  try {
    await manager.setSession("account-a");
    const pending = manager.connect();
    await waiting;
    assert.throws(() => manager.connect(), /Finish or cancel/);
    assert.deepEqual(manager.cancelSignIn(), { cancelled: true });
    await assert.rejects(pending, /Cancelled/);
    const state = await manager.snapshot();
    assert.equal(state.busy, false);
    assert.equal(state.connections.length, 0);
    assert.equal(state.catalog, null);
  } finally {
    manager.close();
    await f.cleanup();
  }
});

test("a slow Orbyn session check cannot replace a newer verified account", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const manager = await create({
    ...f.options,
    createClient: async (token: string) => {
      const client = await f.options.createClient(token);
      if (token !== "account-a") return client;
      return {
        ...client,
        me: async () => {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return { id: f.userA };
        },
      };
    },
  });
  try {
    const old = manager.setSession("account-a");
    await waiting;
    await manager.setSession("account-b");
    release();
    await assert.rejects(old, /account changed/);
    assert.equal((await manager.snapshot()).user_id, f.userB);
  } finally {
    manager.close();
    await f.cleanup();
  }
});

test("a late provider catalog cannot publish after an Orbyn account switch", async () => {
  const f = await fixture();
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const manager = await create({
    ...f.options,
    fetch: async (url: string, init: RequestInit) => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return f.options.fetch(url, init);
    },
  });
  try {
    await manager.setSession("account-a");
    const connecting = manager.connect();
    await waiting;
    await manager.setSession("account-b");
    release();
    await assert.rejects(connecting);
    assert.equal(f.catalogs.size, 0);
    assert.equal((await manager.snapshot()).user_id, f.userB);
    assert.equal((await manager.snapshot()).catalog, null);
  } finally {
    manager.close();
    await f.cleanup();
  }
});

test("background lease renewals stop with the selected runtime and a stale pulse cannot affect a replacement", async () => {
  const f = await fixture();
  const scheduled: (() => Promise<void>)[] = [];
  const cancelled: unknown[] = [];
  const manager = await create({
    ...f.options,
    schedule: (fn: () => Promise<void>, ms: number) => {
      assert.equal(ms, 40_000);
      scheduled.push(fn);
      return scheduled.length;
    },
    cancelSchedule: (value: unknown) => {
      cancelled.push(value);
    },
  });
  try {
    await manager.setSession("account-a");
    await manager.connect();
    assert.equal(scheduled.length, 1);
    await scheduled[0]();
    assert.equal(scheduled.length, 2);
    await manager.connect();
    assert.ok(cancelled.includes(2));
    const before = f.calls();
    await scheduled[1]();
    assert.equal(f.calls(), before);
    assert.equal((await manager.snapshot()).error, null);
    manager.close();
    const count = scheduled.length;
    await scheduled[count - 1]();
    assert.equal(scheduled.length, count);
  } finally {
    manager.close();
    await f.cleanup();
  }
});
