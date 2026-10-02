import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const { createChatgptModelRuntime: create } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-models.cjs",
);
const { createChatgptRegistrationStore: createStore } = createRequire(
  import.meta.url,
)("../../desktop/chatgpt-registration.cjs");

test("live picker and real registration store preserve defaults across restart and account-switch races", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "orbyn-model-runtime-"));
  const options = {
    directory,
    apiBaseUrl: "https://fixture.invalid",
    userId: randomUUID(),
    registrationId: randomUUID(),
  };
  const runtimes: any[] = [];
  try {
    const store = await createStore(options);
    const initial = await store.read();
    const retained = await store.retain("oaiapp_fixture", initial.revision);
    const binding = {
      user_id: options.userId,
      connection_id: randomUUID(),
      issuer: "https://auth.openai.com",
      subject: "fixture",
      client_id: "oaiapp_fixture",
    };
    await store.linkVerifiedConnection(binding, retained.revision);
    const selection = await store.select(options.registrationId, null);
    let calls = 0,
      release!: () => void,
      started!: () => void;
    const savingCatalog = new Promise<void>((done) => {
      started = done;
    });
    const adapter = {
      binding,
      registrationStore: store,
      vault: {
        read: async (requested: unknown) => {
          assert.deepEqual(requested, binding);
          return {
            credentials: {
              clientId: binding.client_id,
              accessToken: "synthetic-token",
              sharingGranted: true,
              scopes: ["chatgpt.tokens.use.direct"],
              expiresAt: Date.now() + 120000,
            },
          };
        },
      },
      requireLiveConnection: async (requested: unknown) => {
        assert.deepEqual(requested, binding);
      },
      fetch: async () => {
        if (++calls === 2) {
          started();
          await new Promise<void>((done) => {
            release = done;
          });
        }
        return new Response(
          JSON.stringify({
            models: [
              {
                slug: "fixture-model",
                display_name: "Fixture",
                visibility: "list",
              },
            ],
          }),
        );
      },
    };
    const runtime = await create(adapter);
    runtimes.push(runtime);
    await runtime.picker.load();
    const pending = runtime.picker.setDefault("fixture-model");
    await savingCatalog;
    const cleared = await store.select(null, selection.revision);
    release();
    await assert.rejects(pending);
    assert.equal((await store.modelPreference()).model, null);
    assert.equal((await store.modelPreference()).version, 0);
    assert.deepEqual(runtime.picker.snapshot().models, []);
    runtime.close();
    await store.select(options.registrationId, cleared.revision);
    const fresh = await create(adapter);
    runtimes.push(fresh);
    await fresh.picker.load();
    await fresh.picker.setDefault("fixture-model");
    const restarted = await createStore(options);
    assert.deepEqual(await restarted.modelPreference(), {
      binding,
      model: "fixture-model",
      version: 1,
    });
  } finally {
    for (const runtime of runtimes) runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const binding = {
    user_id: randomUUID(),
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  let selection = "selection",
    revoked = false,
    models = ["fixture-model"],
    version = 0,
    model: string | null = null,
    writes = 0,
    expiresAt = Date.now() + 120000;
  const options = {
    binding,
    registrationStore: {
      activeConnection: async () => ({
        status: "selected",
        binding,
        revision: selection,
      }),
      connection: async () => binding,
      modelPreference: async () => ({ binding, model, version }),
      saveModelPreference: async (input: any) => {
        writes++;
        model = input.model;
        return { ...input, version: ++version };
      },
    },
    vault: {
      read: async () => ({
        credentials: {
          clientId: binding.client_id,
          accessToken: "fixture-secret",
          sharingGranted: true,
          scopes: ["chatgpt.tokens.use.direct"],
          expiresAt,
        },
      }),
    },
    requireLiveConnection: async () => {
      if (revoked) throw new Error("revoked");
    },
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, "https://api.openai.com/v1/models");
      assert.equal(
        (init.headers as any).Authorization,
        "Bearer fixture-secret",
      );
      return new Response(
        JSON.stringify({
          models: models.map((slug) => ({
            slug,
            display_name: slug,
            visibility: "list",
          })),
        }),
      );
    },
  };
  return {
    options,
    switch: () => {
      selection = "new-selection";
    },
    revoke: () => {
      revoked = true;
    },
    expire: () => {
      expiresAt = 0;
    },
    remove: () => {
      models = [];
    },
    writes: () => writes,
  };
}
test("runtime loads live catalog and saves only a currently available bound default", async () => {
  const f = fixture(),
    runtime = await create(f.options);
  await runtime.picker.load();
  assert.equal(runtime.picker.snapshot().status, "ready");
  await runtime.picker.setDefault("fixture-model");
  assert.equal(f.writes(), 1);
  assert.ok(
    !JSON.stringify(runtime.picker.snapshot()).includes("fixture-secret"),
  );
  runtime.close();
});
test("private inference uses the saved default and never forwards caller model overrides", async () => {
  const f = fixture();
  const catalog = f.options.fetch;
  const posted: any[] = [];
  f.options.fetch = async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return catalog(url, init);
    assert.equal(url, "https://api.openai.com/v1/responses");
    posted.push(JSON.parse(String(init.body)));
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"completed text"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const runtime = await create(f.options);
  try {
    await runtime.picker.load();
    const request = {
      model: "caller-override",
      input: [{ role: "user", content: "hello" }],
    };
    await assert.rejects(runtime.completeDefault(request), /default model/);
    assert.equal(posted.length, 0);
    await runtime.picker.setDefault("fixture-model");
    assert.equal(await runtime.completeDefault(request), "completed text");
    assert.equal(posted[0].model, "fixture-model");
    f.remove();
    await assert.rejects(runtime.completeDefault(request), /unavailable/);
    assert.equal(posted.length, 1);
  } finally {
    runtime.close();
  }
});
test("revocation or account switch during inference cannot return completed output", async () => {
  for (const change of ["switch", "revoke"] as const) {
    const f = fixture();
    const catalog = f.options.fetch;
    f.options.fetch = async (url: string, init: RequestInit) => {
      if (url.endsWith("/models")) return catalog(url, init);
      f[change]();
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"private text"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const runtime = await create(f.options);
    try {
      await runtime.picker.load();
      await runtime.picker.setDefault("fixture-model");
      await assert.rejects(
        runtime.completeDefault({
          input: [{ role: "user", content: "hello" }],
        }),
      );
    } finally {
      runtime.close();
    }
  }
});
test("a running turn keeps its captured model when the saved default changes", async () => {
  const f = fixture();
  const catalog = f.options.fetch;
  let runtime: any;
  f.options.fetch = async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return catalog(url, init);
    assert.equal(JSON.parse(String(init.body)).model, "fixture-model");
    await runtime.picker.setDefault(null);
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"original model turn"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  runtime = await create(f.options);
  try {
    await runtime.picker.load();
    await runtime.picker.setDefault("fixture-model");
    assert.equal(
      await runtime.completeDefault({
        input: [{ role: "user", content: "hello" }],
      }),
      "original model turn",
    );
    assert.equal(runtime.picker.defaultStatus().status, "unselected");
    await assert.rejects(
      runtime.completeDefault({ input: [{ role: "user", content: "next" }] }),
      /default model/,
    );
  } finally {
    runtime.close();
  }
});
test("closing the credential runtime aborts inference before output can return", async () => {
  const f = fixture();
  const catalog = f.options.fetch;
  let runtime: any;
  let signal: AbortSignal | undefined;
  f.options.fetch = async (url: string, init: RequestInit) => {
    if (url.endsWith("/models")) return catalog(url, init);
    signal = init.signal as AbortSignal;
    runtime.close();
    return new Response(
      'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  runtime = await create(f.options);
  try {
    await runtime.picker.load();
    await runtime.picker.setDefault("fixture-model");
    await assert.rejects(
      runtime.completeDefault({ input: [{ role: "user", content: "hello" }] }),
    );
    assert.equal(signal?.aborted, true);
  } finally {
    runtime.close();
  }
});
test("removed models and changed selection cannot persist a default", async () => {
  for (const change of ["remove", "switch", "revoke"] as const) {
    const f = fixture(),
      runtime = await create(f.options);
    await runtime.picker.load();
    f[change]();
    await assert.rejects(runtime.picker.setDefault("fixture-model"));
    assert.equal(f.writes(), 0);
    runtime.close();
  }
});
test("expired credentials and revoked connections leave catalog unavailable", async () => {
  for (const change of ["expire", "revoke"] as const) {
    const f = fixture(),
      runtime = await create(f.options);
    f[change]();
    await runtime.picker.load();
    assert.equal(runtime.picker.snapshot().status, "unavailable");
    assert.deepEqual(runtime.picker.snapshot().models, []);
    runtime.close();
  }
});

test("closing a runtime aborts an in-flight catalog and cannot publish a late result", async () => {
  const f = fixture();
  let started!: () => void;
  const ready = new Promise<void>((done) => {
    started = done;
  });
  let observed: AbortSignal | undefined;
  f.options.fetch = async (_url: string, init: RequestInit) => {
    observed = init.signal as AbortSignal;
    started();
    await new Promise<void>((_resolve, reject) => {
      if (observed!.aborted) reject(new Error("aborted"));
      else
        observed!.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
    });
    return new Response();
  };
  const runtime = await create(f.options);
  const loading = runtime.picker.load();
  await ready;
  runtime.close();
  await loading;
  assert.equal(observed?.aborted, true);
  assert.equal(runtime.picker.snapshot().status, "idle");
  assert.deepEqual(runtime.picker.snapshot().models, []);
});

test("a default changed on mobile/web is read before a private turn without a paid fallback", async () => {
  const f = fixture();
  let remote = {
    binding: f.options.binding,
    model: "fixture-model" as string | null,
    version: 1,
  };
  const posted: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    if (url.endsWith("/models"))
      return Response.json({
        models: ["fixture-model", "remote-model"].map((slug) => ({
          slug,
          display_name: slug,
          visibility: "list",
        })),
      });
    posted.push(JSON.parse(String(init.body)).model);
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"answer"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  };
  const runtime = await create({
    ...f.options,
    fetch,
    preferenceStore: { read: async () => remote },
  });
  try {
    await runtime.picker.load();
    remote = { ...remote, model: "remote-model", version: 2 };
    const request = { input: [{ role: "user", content: "hello" }] };
    assert.equal(await runtime.completeDefault(request), "answer");
    assert.deepEqual(posted, ["remote-model"]);
    assert.equal(runtime.picker.snapshot().preference.model, "remote-model");
    await Promise.all([
      runtime.completeDefault(request),
      runtime.completeDefault(request),
    ]);
    assert.deepEqual(posted, ["remote-model", "remote-model", "remote-model"]);
    remote = { ...remote, model: null, version: 3 };
    await assert.rejects(runtime.completeDefault(request), /default model/);
    assert.equal(posted.length, 3);
    remote = { ...remote, model: "remote-model", version: 2 };
    await assert.rejects(runtime.completeDefault(request), /refreshed/);
    assert.equal(
      posted.length,
      3,
      "a regressed version cannot enable inference",
    );
  } finally {
    runtime.close();
  }
});

test("foreign or failed remote default refresh cannot fall back to the cached model", async () => {
  for (const failure of ["foreign", "error"] as const) {
    const f = fixture();
    let fail = false,
      inference = 0;
    const original = f.options.fetch;
    const runtime = await create({
      ...f.options,
      fetch: async (url: string, init: RequestInit) => {
        if (url.endsWith("/models")) return original(url, init);
        inference++;
        throw new Error("must not start inference");
      },
      preferenceStore: {
        read: async () => {
          if (fail && failure === "error") throw new Error("Offline");
          return {
            binding: fail
              ? { ...f.options.binding, connection_id: randomUUID() }
              : f.options.binding,
            model: "fixture-model",
            version: 1,
          };
        },
      },
    });
    try {
      await runtime.picker.load();
      fail = true;
      await assert.rejects(runtime.completeDefault({ input: [] }), /refreshed/);
      assert.equal(inference, 0);
      assert.equal(runtime.picker.snapshot().status, "unavailable");
    } finally {
      runtime.close();
    }
  }
});
