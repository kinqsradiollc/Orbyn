import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ChatgptRemoteStore } from "@orbyn/api-client";
import type {
  ChatgptCatalogRead,
  ChatgptCatalogDefaultUpdate,
} from "@orbyn/core";

const mobileRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);
const nativeRequire = createRequire(
  mobileRequire.resolve("react-native/package.json"),
);
const { AbortController: NativeAbortController } =
  nativeRequire("abort-controller");

const device = () => ({
  executor_id: randomUUID(),
  connection_id: randomUUID(),
  host_id: randomUUID(),
});
const selection = (d: ReturnType<typeof device>) => ({
  connection_id: d.connection_id,
  executor_id: d.executor_id,
});
const userId = randomUUID();
function catalog(d: ReturnType<typeof device>): ChatgptCatalogRead {
  const binding = {
    user_id: userId,
    connection_id: d.connection_id,
    issuer: "https://auth.openai.com" as const,
    subject: "fixture",
    client_id: "fixture-client",
  };
  return {
    executor_id: d.executor_id,
    binding,
    status: "ready",
    models: [{ slug: "model-a", display_name: "Model A" }],
    preference: { binding, model: null, version: 0 },
    published_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    sequence: 1,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const a = device(),
    b = device();
  let token = "session-a";
  let devices: unknown = [a, b];
  let response: unknown = catalog(a);
  const writes: ChatgptCatalogDefaultUpdate[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const api = {
    async chatgptExecutors(signal?: AbortSignal): Promise<unknown> {
      signals.push(signal);
      return devices;
    },
    async chatgptModels(
      _value: unknown,
      signal?: AbortSignal,
    ): Promise<unknown> {
      signals.push(signal);
      return response;
    },
    async selectChatgptDefault(
      value: ChatgptCatalogDefaultUpdate,
      signal?: AbortSignal,
    ): Promise<unknown> {
      signals.push(signal);
      writes.push(value);
      return { ...value.preference, version: value.preference.version + 1 };
    },
  };
  const store = new ChatgptRemoteStore({ api, userId, getToken: () => token });
  return {
    store,
    api,
    a,
    b,
    writes,
    signals,
    setToken: (value: string) => {
      token = value;
    },
    setDevices: (value: unknown) => {
      devices = value;
    },
    setResponse: (value: unknown) => {
      response = value;
    },
  };
}

test("React Native abort signals support discovery, catalog selection and default writes", async () => {
  const original = globalThis.AbortController;
  globalThis.AbortController = NativeAbortController;
  const f = fixture();
  try {
    assert.equal(
      typeof new NativeAbortController().signal.throwIfAborted,
      "undefined",
    );
    await f.store.refresh();
    assert.equal(f.store.snapshot().status, "ready");
    await f.store.select(selection(f.a));
    assert.equal(f.store.snapshot().catalog?.status, "ready");
    await f.store.save("model-a");
    assert.equal(f.store.snapshot().catalog?.preference.model, "model-a");
    await f.store.save(null);
    assert.equal(f.store.snapshot().catalog?.preference.model, null);
    await f.store.refresh();
    assert.equal(f.store.snapshot().status, "ready");
    assert.equal(f.writes.length, 2);
  } finally {
    f.store.close();
    globalThis.AbortController = original;
  }
});

test("React Native cancellation still discards an ignored transport's late device reply", async () => {
  const original = globalThis.AbortController;
  globalThis.AbortController = NativeAbortController;
  const f = fixture();
  const pending = deferred<unknown>();
  f.api.chatgptExecutors = async (signal) => {
    f.signals.push(signal);
    return pending.promise;
  };
  try {
    const read = f.store.refresh();
    f.store.close();
    await read;
    assert.equal(f.signals[0]?.aborted, true);
    pending.resolve([f.a]);
    await Promise.resolve();
    assert.equal(f.store.snapshot().devices.length, 0);
  } finally {
    pending.resolve([]);
    f.store.close();
    globalThis.AbortController = original;
  }
});

test("device discovery requires explicit selection and snapshots are independent", async () => {
  const f = fixture();
  await f.store.refresh();
  assert.equal(f.store.snapshot().status, "ready");
  assert.equal(f.store.snapshot().selection, null);
  assert.equal(f.store.snapshot().catalog, null);
  f.store.snapshot().devices.pop();
  assert.equal(f.store.snapshot().devices.length, 2);
  await f.store.select(selection(f.a));
  assert.equal(f.store.snapshot().catalog?.status, "ready");
  await f.store.save("model-a");
  assert.equal(f.writes[0].preference.version, 0);
  assert.equal(f.store.snapshot().catalog?.preference.version, 1);
  assert.equal(f.store.snapshot().catalog?.preference.model, "model-a");
  await f.store.save(null);
  assert.equal(f.writes[1].preference.version, 1);
  assert.equal(f.store.snapshot().catalog?.preference.model, null);
  f.store.close();
});

test("refresh retains only an explicitly selected device still present in the owned list", async () => {
  const f = fixture();
  await f.store.refresh();
  await f.store.select(selection(f.a));
  await f.store.refresh();
  assert.equal(f.store.snapshot().selection?.executor_id, f.a.executor_id);
  f.setDevices([f.b]);
  await f.store.refresh();
  assert.equal(f.store.snapshot().selection, null);
  assert.equal(f.store.snapshot().catalog, null);
  f.store.close();
});

test("unlisted devices and absent/offline/stale models cannot authorize writes", async () => {
  const f = fixture();
  await f.store.select(selection(f.a));
  assert.equal(f.signals.length, 0);
  await f.store.refresh();
  for (const status of ["offline", "stale", "unavailable"] as const) {
    f.setResponse({ ...catalog(f.a), status });
    await f.store.select(selection(f.a));
    await f.store.save("model-a");
  }
  f.setResponse(catalog(f.a));
  await f.store.select(selection(f.a));
  await f.store.save("unknown-model");
  assert.equal(f.writes.length, 0);
  f.store.close();
});

test("catalog ownership, account/device binding and strict credential exclusion are enforced", async () => {
  const f = fixture();
  await f.store.refresh();
  const valid = catalog(f.a);
  for (const value of [
    { ...valid, executor_id: f.b.executor_id },
    {
      ...valid,
      binding: { ...valid.binding, user_id: randomUUID() },
      preference: {
        ...valid.preference,
        binding: { ...valid.binding, user_id: randomUUID() },
      },
    },
    {
      ...valid,
      binding: catalog(f.b).binding,
      preference: catalog(f.b).preference,
    },
    { ...valid, access_token: "must-not-enter-state" },
  ]) {
    f.setResponse(value);
    await f.store.select(selection(f.a));
    assert.equal(f.store.snapshot().status, "unavailable");
    assert.equal(f.store.snapshot().catalog, null);
  }
  f.store.close();
});

test("a newer device selection wins even when the previous request ignores cancellation", async () => {
  const f = fixture();
  await f.store.refresh();
  const old = deferred<unknown>();
  f.api.chatgptModels = async (value: unknown, signal?: AbortSignal) => {
    f.signals.push(signal);
    return (value as { executor_id: string }).executor_id === f.a.executor_id
      ? old.promise
      : catalog(f.b);
  };
  const pending = f.store.select(selection(f.a));
  const signal = f.signals.at(-1)!;
  await f.store.select(selection(f.b));
  assert.equal(signal.aborted, true);
  old.resolve(catalog(f.a));
  await pending;
  assert.equal(f.store.snapshot().catalog?.executor_id, f.b.executor_id);
  f.store.close();
});

test("session changes synchronously hide cached data and ignore pending results", async () => {
  const f = fixture();
  await f.store.refresh();
  await f.store.select(selection(f.a));
  const pending = deferred<unknown>();
  f.api.chatgptModels = async () => pending.promise;
  const read = f.store.select(selection(f.a));
  f.setToken("session-b");
  assert.equal(f.store.snapshot().catalog, null);
  assert.equal(f.store.snapshot().devices.length, 0);
  pending.resolve(catalog(f.a));
  await read;
  assert.equal(f.store.snapshot().catalog, null);
  f.setToken("");
  await f.store.refresh();
  assert.equal(f.store.snapshot().status, "idle");
  f.store.close();
});

test("a pending save cannot publish into a changed session or new selection", async () => {
  for (const change of ["session", "selection"] as const) {
    const f = fixture();
    await f.store.refresh();
    await f.store.select(selection(f.a));
    const pending = deferred<unknown>();
    f.api.selectChatgptDefault = async () => pending.promise;
    const save = f.store.save("model-a");
    assert.equal(f.store.snapshot().saving, true);
    if (change === "session") {
      f.setToken("session-b");
      f.store.snapshot();
    } else {
      f.setResponse(catalog(f.b));
      await f.store.select(selection(f.b));
    }
    pending.resolve({
      ...catalog(f.a).preference,
      model: "model-a",
      version: 1,
    });
    await save;
    assert.equal(f.store.snapshot().saving, false);
    assert.notEqual(f.store.snapshot().catalog?.preference.model, "model-a");
    f.store.close();
  }
});

test("failed or malformed default replies invalidate the CAS revision until refresh", async () => {
  for (const response of [
    "error",
    "binding",
    "version",
    "model",
    "credential",
  ] as const) {
    const f = fixture();
    await f.store.refresh();
    await f.store.select(selection(f.a));
    f.api.selectChatgptDefault = async (input) => {
      if (response === "error") throw { status: 409 };
      const next = {
        ...input.preference,
        version: input.preference.version + 1,
      };
      if (response === "binding") next.binding = catalog(f.b).binding;
      if (response === "version") next.version = 100;
      if (response === "model") next.model = null;
      return response === "credential"
        ? { ...next, access_token: "not-allowed" }
        : next;
    };
    await f.store.save("model-a");
    assert.equal(f.store.snapshot().status, "unavailable");
    assert.equal(f.store.snapshot().catalog, null);
    assert.equal(f.store.snapshot().saving, false);
    f.store.close();
  }
});

test("unmount cancels discovery, clears state and prevents late publication", async () => {
  const f = fixture();
  const pending = deferred<unknown>();
  f.api.chatgptExecutors = async (signal) => {
    f.signals.push(signal);
    return pending.promise;
  };
  const read = f.store.refresh();
  f.store.close();
  assert.equal(f.signals[0]?.aborted, true);
  pending.resolve([f.a]);
  await read;
  assert.equal(f.store.snapshot().devices.length, 0);
});

test("a timed-out request cannot publish a late response that ignored cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const pending = deferred<unknown>();
  f.api.chatgptExecutors = async (signal) => {
    f.signals.push(signal);
    return pending.promise;
  };
  const read = f.store.refresh();
  t.mock.timers.tick(30_000);
  assert.equal(f.signals[0]?.aborted, true);
  pending.resolve([f.a]);
  await read;
  assert.equal(f.store.snapshot().status, "unavailable");
  assert.equal(f.store.snapshot().devices.length, 0);
  f.store.close();
});

test("catalog expiry disables writes even before a suspended UI expiry timer fires", async () => {
  const f = fixture();
  await f.store.refresh();
  f.setResponse({
    ...catalog(f.a),
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  await f.store.select(selection(f.a));
  await f.store.save("model-a");
  assert.equal(f.writes.length, 0);
  assert.equal(f.store.snapshot().catalog?.status, "offline");
  f.store.close();
});

test("the earliest lease/catalog deadline updates availability without another backend read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const f = fixture();
  await f.store.refresh();
  await f.store.select(selection(f.a));
  let observed = 0;
  f.store.subscribe(() => observed++);
  t.mock.timers.tick(120_000);
  assert.equal(f.store.snapshot().catalog?.status, "offline");
  assert.equal(observed, 1);
  assert.equal(f.signals.length, 2);
  await f.store.save("model-a");
  assert.equal(f.writes.length, 0);
  f.store.close();
});
