import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { createChatgptCredentialResolver: create } = createRequire(
  import.meta.url,
)("../../desktop/chatgpt-credentials.cjs");

function fixture() {
  const binding = {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  let revision = "original",
    calls = 0,
    writes = 0,
    live = true;
  let credentials: any = {
    clientId: binding.client_id,
    idToken: "old-id",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    tokenType: "Bearer",
    scopes: ["chatgpt.tokens.use.direct"],
    sharingGranted: true,
    savedAt: Date.now() - 3600000,
    expiresAt: Date.now() + 1000,
  };
  const options = {
    binding,
    vault: {
      read: async () => ({
        revision,
        credentials: structuredClone(credentials),
      }),
      revokeObserved: async (_binding: unknown, expected: string) => {
        assert.equal(expected, revision);
        credentials = null;
        revision = randomUUID();
      },
      write: async (_binding: unknown, next: any, expected: string) => {
        assert.equal(expected, revision);
        credentials = structuredClone(next);
        revision = randomUUID();
        writes++;
        return revision;
      },
    },
    requireLiveConnection: async () => {
      if (!live) throw new Error("Connection changed");
    },
    verifyIdentity: async (_token: string, expected: any) => {
      assert.deepEqual(expected, {
        clientId: binding.client_id,
        subject: binding.subject,
      });
      return {
        issuer: binding.issuer,
        clientId: binding.client_id,
        subject: binding.subject,
      };
    },
    refresh: async (saved: any, _options: any) => {
      calls++;
      return {
        ...saved,
        accessToken: "new-access",
        refreshToken: "new-refresh",
        idToken: "new-id",
        savedAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };
    },
  };
  return {
    options,
    snapshot: () => structuredClone(credentials),
    calls: () => calls,
    writes: () => writes,
    disconnect: () => {
      live = false;
    },
  };
}

test("concurrent resolver instances sharing one vault rotate a grant once and use its replacement", async () => {
  const f = fixture();
  const a = await create(f.options),
    b = await create(f.options);
  const values = await Promise.all([
    a.current(),
    b.current(),
    a.current(),
    b.current(),
  ]);
  assert.equal(f.calls(), 1);
  assert.equal(f.writes(), 1);
  for (const value of values) {
    assert.equal(value.accessToken, "new-access");
    assert.equal(value.refreshToken, "new-refresh");
  }
  values[0].scopes.length = 0;
  assert.equal((await a.current()).scopes.length, 1);
  a.close();
  b.close();
});

test("wrong refreshed identity or registration cannot replace the stored grant", async () => {
  for (const mode of ["identity", "registration"]) {
    const f = fixture(),
      original = f.snapshot();
    if (mode === "identity")
      f.options.verifyIdentity = async () => ({
        issuer: f.options.binding.issuer,
        clientId: f.options.binding.client_id,
        subject: "other",
      });
    if (mode === "registration") {
      const refresh = f.options.refresh;
      f.options.refresh = async (...args) => ({
        ...(await refresh(...args)),
        clientId: "other-issued-client",
      });
    }
    const resolver = await create(f.options);
    await assert.rejects(resolver.current(), /changed/);
    assert.deepEqual(f.snapshot(), original);
    assert.equal(f.writes(), 0);
    resolver.close();
  }
});

test("connection revocation or local stop during refresh prevents storage and later requests", async () => {
  for (const close of [true, false]) {
    const f = fixture();
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const refresh = f.options.refresh;
    f.options.refresh = async (...args) => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return refresh(...args);
    };
    const resolver = await create(f.options);
    const pending = resolver.current();
    await waiting;
    if (close) resolver.close();
    else f.disconnect();
    release();
    await assert.rejects(pending);
    await assert.rejects(resolver.current());
    assert.equal(f.writes(), 0);
    resolver.close();
  }
});

test("lost plan permission is saved but never supplied as an inference credential", async () => {
  const f = fixture(),
    refresh = f.options.refresh;
  f.options.refresh = async (...args) => ({
    ...(await refresh(...args)),
    scopes: ["openid"],
    sharingGranted: false,
  });
  const resolver = await create(f.options);
  await assert.rejects(resolver.current(), /Enable ChatGPT plan usage/);
  assert.equal(f.writes(), 1);
  assert.equal(f.snapshot().sharingGranted, false);
  resolver.close();
});

test("a competing credential replacement is not overwritten by a late refresh", async () => {
  const f = fixture(),
    refresh = f.options.refresh;
  f.options.refresh = async (...args) => {
    const result = await refresh(...args);
    await f.options.vault.write(
      f.options.binding,
      { ...result, accessToken: "competing-access" },
      "original",
    );
    return result;
  };
  const resolver = await create(f.options);
  await assert.rejects(resolver.current());
  assert.equal(f.snapshot().accessToken, "competing-access");
  assert.equal(f.writes(), 1);
  resolver.close();
});

test("confirmed terminal desktop refresh erases only its observed vault revision", async () => {
  const f = fixture();
  f.options.refresh = async () => {
    throw Object.assign(new Error("safe failure"), {
      code: "AUTH_REFRESH_EXPIRED",
    });
  };
  let invalidated = 0;
  const resolver = await create({
    ...f.options,
    onInvalidated: () => invalidated++,
  });
  await assert.rejects(resolver.current(), /Reconnect/);
  assert.equal(invalidated, 1);
  assert.equal(f.snapshot(), null);
  await assert.rejects(resolver.current(), /Reconnect/);
  resolver.close();
});
test("desktop terminal refresh preserves a concurrently installed credential revision", async () => {
  const f = fixture();
  f.options.refresh = async () => {
    await f.options.vault.write(
      f.options.binding,
      { ...f.snapshot(), accessToken: "newer-sign-in" },
      "original",
    );
    throw Object.assign(new Error("safe failure"), {
      code: "AUTH_REFRESH_EXPIRED",
    });
  };
  const resolver = await create(f.options);
  await assert.rejects(resolver.current());
  assert.equal(f.snapshot().accessToken, "newer-sign-in");
  resolver.close();
});
test("desktop temporary refresh failure retains credentials", async () => {
  const f = fixture(),
    original = f.snapshot();
  f.options.refresh = async () => {
    throw Object.assign(new Error("safe failure"), { code: "AUTH_FAILED" });
  };
  const resolver = await create(f.options);
  await assert.rejects(resolver.current());
  assert.deepEqual(f.snapshot(), original);
  resolver.close();
});
test("desktop late terminal refresh cannot erase after its connection changes", async () => {
  const f = fixture(),
    original = f.snapshot();
  f.options.refresh = async () => {
    f.disconnect();
    throw Object.assign(new Error("safe failure"), {
      code: "AUTH_REFRESH_EXPIRED",
    });
  };
  const resolver = await create(f.options);
  await assert.rejects(resolver.current(), /changed/);
  assert.deepEqual(f.snapshot(), original);
  resolver.close();
});
