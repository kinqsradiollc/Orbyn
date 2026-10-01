import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { signInChatgpt } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-sign-in.cjs",
);

function fixture() {
  const steps: string[] = [];
  const controller = new AbortController();
  const connection = {
    id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  const challenge = {
    id: randomUUID(),
    nonce: "n".repeat(32),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  const options = {
    userId: randomUUID(),
    signal: controller.signal,
    registrationStore: {
      read: async () => ({
        hostId: randomUUID(),
        clientId: null,
        revision: "fixture-revision",
      }),
      retain: async () => {
        steps.push("retain");
        return { revision: "retained-fixture" };
      },
      linkVerifiedConnection: async (_binding: unknown, revision: string) => {
        assert.equal(revision, "retained-fixture");
        steps.push("record");
      },
    },
    vault: {
      read: async () => ({ revision: null, credentials: null }),
      write: async () => {
        steps.push("install");
        return randomUUID();
      },
      revoke: async () => {
        steps.push("revoke");
      },
    },
    beginConnection: async () => challenge,
    finishConnection: async () => {
      steps.push("link");
      return connection;
    },
    verifyIdentity: async (_token: string, expected: any) => {
      assert.equal(expected.nonce, challenge.nonce);
      steps.push("verify");
      return {
        issuer: connection.issuer,
        subject: connection.subject,
        clientId: connection.client_id,
      };
    },
    openAuthorization: async () => {
      steps.push("open");
    },
    prepare: async (input: any) => {
      assert.equal(input.nonce, challenge.nonce);
      assert.match(input.hostId, /^urn:uuid:[0-9a-f-]{36}$/);
      return {
        authorizationUrl: "https://auth.openai.com/fixture",
        result: Promise.resolve({ clientId: connection.client_id }),
        cancel: () => {},
      };
    },
    exchange: async () => {
      steps.push("exchange");
      return {
        idToken: "fixture-proof",
        accessToken: "fixture-secret",
        sharingGranted: true,
      };
    },
  };
  return { options, steps, controller, connection };
}

test("sign-in persists registration before exchange and verifies before installing metadata-only result", async () => {
  const f = fixture();
  const result = await signInChatgpt(f.options);
  assert.deepEqual(f.steps, [
    "open",
    "retain",
    "exchange",
    "verify",
    "link",
    "record",
    "install",
  ]);
  assert.equal(result.binding.subject, "fixture");
  assert.equal(result.binding.user_id, f.options.userId);
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
  assert.ok(!JSON.stringify(result).includes("fixture-proof"));
});

test("failed identity or mismatched backend connection cannot install credentials", async () => {
  for (const mode of ["identity", "account", "backend"]) {
    const f = fixture();
    if (mode === "identity")
      f.options.verifyIdentity = async () => {
        throw new Error("Bad identity");
      };
    if (mode === "backend")
      f.options.finishConnection = async () => ({
        ...f.connection,
        subject: "other",
      });
    const input =
      mode === "account"
        ? { ...f.options, expectedSubject: "other" }
        : f.options;
    await assert.rejects(signInChatgpt(input));
    assert.ok(!f.steps.includes("install"));
  }
});

test("cancellation at each asynchronous phase fences later work", async () => {
  for (const phase of [
    "openAuthorization",
    "exchange",
    "verifyIdentity",
    "finishConnection",
  ] as const) {
    const f = fixture();
    const original = f.options[phase];
    (f.options as any)[phase] = async (...args: any[]) => {
      const result = await (original as any)(...args);
      f.controller.abort();
      return result;
    };
    await assert.rejects(
      signInChatgpt(f.options),
      (e: any) => e.code === "AUTH_ABORTED",
    );
    assert.ok(!f.steps.includes("install"));
    assert.ok(!f.steps.includes("revoke"));
  }
});

test("an installed connection cannot be overwritten or erased by a new sign-in", async () => {
  const f = fixture();
  (f.options.vault as any).read = async () => ({
    revision: randomUUID(),
    credentials: { accessToken: "existing-secret" },
  });
  await assert.rejects(signInChatgpt(f.options), /Disconnect/);
  assert.ok(!f.steps.includes("install"));
  assert.ok(!f.steps.includes("revoke"));
});

test("concurrent sign-in is rejected until a cancelled attempt actually stops", async () => {
  const f = fixture();
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  f.options.openAuthorization = async () => {
    started();
    await new Promise<void>((done) => {
      release = done;
    });
  };
  const first = signInChatgpt(f.options);
  await ready;
  await assert.rejects(
    signInChatgpt(f.options),
    (e: any) => e.code === "AUTH_BUSY",
  );
  f.controller.abort();
  await assert.rejects(
    signInChatgpt(f.options),
    (e: any) => e.code === "AUTH_BUSY",
  );
  release();
  await assert.rejects(first, (e: any) => e.code === "AUTH_ABORTED");
  const next = fixture();
  next.options.vault = f.options.vault;
  next.options.userId = f.options.userId;
  await signInChatgpt(next.options);
});

test("cancellation during credential installation erases the attempted slot", async () => {
  const f = fixture();
  f.options.vault.write = async () => {
    f.steps.push("install");
    f.controller.abort();
    return randomUUID();
  };
  await assert.rejects(
    signInChatgpt(f.options),
    (e: any) => e.code === "AUTH_ABORTED",
  );
  assert.ok(f.steps.includes("revoke"));
});

function returningFixture() {
  const f = fixture();
  const binding = {
    user_id: f.options.userId,
    connection_id: f.connection.id,
    issuer: f.connection.issuer,
    subject: f.connection.subject,
    client_id: f.connection.client_id,
  };
  let revision = "existing-revision";
  let credentials: any = {
    idToken: "retained-private-id",
    accessToken: "existing-secret",
  };
  const originalRead = f.options.registrationStore.read;
  f.options.registrationStore.read = async () =>
    ({ ...(await originalRead()), clientId: binding.client_id }) as any;
  (f.options.registrationStore as any).connection = async () => binding;
  (f.options.vault as any).read = async () => ({
    revision,
    credentials: structuredClone(credentials),
  });
  (f.options.vault as any).write = async (
    _binding: unknown,
    value: any,
    expected: string,
  ) => {
    assert.deepEqual(_binding, binding);
    assert.equal(expected, revision);
    credentials = structuredClone(value);
    revision = randomUUID();
    f.steps.push("install");
    return revision;
  };
  const prepare = f.options.prepare;
  f.options.prepare = async (input: any) => {
    assert.equal(input.clientId, binding.client_id);
    assert.equal(input.idTokenHint, "retained-private-id");
    return prepare(input);
  };
  return {
    ...f,
    binding,
    input: { ...f.options, reconnectBinding: binding },
    snapshot: () => structuredClone(credentials),
  };
}

test("explicit returning sign-in reuses the issued registration and replaces only verified same-account credentials", async () => {
  const f = returningFixture();
  const result = await signInChatgpt(f.input);
  assert.deepEqual(result.binding, f.binding);
  assert.equal(f.snapshot().accessToken, "fixture-secret");
  assert.equal(f.steps.filter((step) => step === "install").length, 1);
  assert.equal(f.steps.includes("revoke"), false);
});

test("returning sign-in rejects another account and leaves the original slot intact", async () => {
  for (const change of ["identity", "connection"]) {
    const f = returningFixture(),
      original = f.snapshot();
    if (change === "identity")
      f.input.verifyIdentity = async () => ({
        issuer: f.connection.issuer,
        subject: "other-account",
        clientId: f.connection.client_id,
      });
    if (change === "connection")
      f.input.finishConnection = async () => ({
        ...f.connection,
        id: randomUUID(),
      });
    await assert.rejects(signInChatgpt(f.input), /changed/);
    assert.deepEqual(f.snapshot(), original);
    assert.equal(f.steps.includes("install"), false);
    assert.equal(f.steps.includes("revoke"), false);
  }
});

test("cancellation preserves returning credentials before exchange and restores only its own installed replacement", async () => {
  for (const duringWrite of [false, true]) {
    const f = returningFixture(),
      original = f.snapshot();
    if (duringWrite) {
      const write = f.input.vault.write as any;
      let calls = 0;
      (f.input.vault as any).write = async (...args: any[]) => {
        const result = await write(...args);
        if (++calls === 1) f.controller.abort();
        return result;
      };
    } else {
      const exchange = f.input.exchange;
      f.input.exchange = async () => {
        f.controller.abort();
        return exchange();
      };
    }
    await assert.rejects(
      signInChatgpt(f.input),
      (e: any) => e.code === "AUTH_ABORTED",
    );
    assert.deepEqual(f.snapshot(), original);
    assert.equal(f.steps.includes("revoke"), false);
  }
});

test("a competing credential update during returning OAuth cannot be overwritten", async () => {
  const f = returningFixture(),
    exchange = f.input.exchange;
  f.input.exchange = async () => {
    await (f.input.vault.write as any)(
      f.binding,
      { idToken: "competing-id", accessToken: "competing-secret" },
      "existing-revision",
    );
    return exchange();
  };
  await assert.rejects(signInChatgpt(f.input), /credentials changed/);
  assert.equal(f.snapshot().accessToken, "competing-secret");
  assert.equal(f.steps.filter((step) => step === "install").length, 1);
  assert.equal(f.steps.includes("revoke"), false);
});
