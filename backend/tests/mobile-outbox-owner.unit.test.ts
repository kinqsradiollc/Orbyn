import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as core from "@orbyn/core";
import { OrbynClient } from "@orbyn/api-client";

const KEY = "orbyn-outbox-v2",
  LEGACY = "orbyn-outbox-v1";
const compiled = ts.transpileModule(
  readFileSync(
    new URL("../../mobile/src/lib/outbox.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  },
).outputText;
const create: core.OutboxOp = {
  type: "item.create",
  input: { id: "task", title: "Kept task" },
};
const entry = (owner_id = "A", op = create): core.OwnedOutboxEntry => ({
  owner_id,
  op,
  key: "stable-key",
  queued_at: new Date().toISOString(),
  attempts: 0,
  state: "pending",
});
const envelope = (entries: core.OwnedOutboxEntry[]) =>
  JSON.stringify({ version: 2, entries, recovery: [] });
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
type API = {
  whenSent(listener: () => void): void;
  loadOutbox(): Promise<void>;
  flush(): Promise<void>;
  run(op: core.OutboxOp): Promise<unknown>;
  savePageOffline(save: core.PageSave): Promise<void>;
  clearOutbox(): Promise<void>;
  recoveryCopy(): Promise<string>;
  discardRecovery(): Promise<void>;
  resolve(key: string, choice: "drop" | "retry" | "mine"): Promise<void>;
  outboxState(): {
    entries: core.OutboxEntry[];
    recovery: { count: number } | null;
    storageError: string | null;
    sending: boolean;
  };
};
function fixture(initial: Record<string, string> = {}, userId = "A") {
  const disk = new Map(Object.entries(initial));
  const listeners = new Set<() => void>();
  const session = {
    token: userId ? `token-${userId}` : "",
    userId,
    generation: 1,
  };
  const requests: {
    path: string;
    method: string;
    token: string | null;
    key: string | null;
    consistency: string | null;
  }[] = [];
  const writes: string[] = [];
  const timers: (() => void)[] = [];
  let send: (
    request: (typeof requests)[number],
  ) => Promise<Response> = async () =>
    Response.json({ id: "task", version: 1 });
  let write: (key: string, value: string) => Promise<void> = async () => {};
  let read: (key: string) => Promise<string | null> = async (key) =>
    disk.get(key) ?? null;
  const fetch: typeof globalThis.fetch = async (url, options) => {
    const headers = new Headers(options?.headers);
    const request = {
      path: new URL(String(url)).pathname,
      method: options?.method ?? "GET",
      token: headers.get("Authorization"),
      key: headers.get("Idempotency-Key"),
      consistency: headers.get("X-Orbyn-Consistency"),
    };
    requests.push(request);
    return send(request);
  };
  const plannerClient = new OrbynClient({
    baseUrl: "https://fixture.invalid",
    getToken: () => session.token,
    fetch,
  });
  const modules: Record<string, unknown> = {
    "@react-native-async-storage/async-storage": {
      getItem: (key: string) => read(key),
      setItem: async (key: string, value: string) => {
        await write(key, value);
        disk.set(key, value);
        writes.push(key);
      },
    },
    "expo-crypto": {
      CryptoDigestAlgorithm: { SHA256: "sha256" },
      digestStringAsync: async (_algorithm: string, value: string) =>
        createHash("sha256").update(value).digest("hex"),
    },
    "@orbyn/core": core,
    "@orbyn/api-client": { OrbynClient },
    "./api": { client: plannerClient },
    "./session": {
      session,
      subscribeSession: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    "./errors": { errorText: (e: unknown) => String(e) },
    "./pageCache": { rememberPage: async () => {} },
  };
  const api = {} as API;
  runInNewContext(compiled, {
    exports: api,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unmocked ${name}`);
      return modules[name];
    },
    fetch,
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
  });
  return {
    api,
    plannerClient,
    disk,
    session,
    requests,
    writes,
    timers,
    switchTo(userId: string, token = userId ? `token-${userId}` : "") {
      Object.assign(session, {
        userId,
        token,
        generation: session.generation + 1,
      });
      listeners.forEach((fn) => fn());
    },
    send(fn: typeof send) {
      send = fn;
    },
    write(fn: typeof write) {
      write = fn;
    },
    read(fn: typeof read) {
      read = fn;
    },
  };
}

test("automatic auth loss pauses A's commands; B cannot see/replay them; A resumes after reauthentication", async () => {
  const f = fixture({ [KEY]: envelope([entry()]) });
  f.send(async () => Response.json({ message: "Expired" }, { status: 401 }));
  await f.api.flush();
  await f.api.flush();
  assert.equal(f.requests.length, 1);
  f.switchTo("");
  assert.equal(f.api.outboxState().entries.length, 0);
  f.switchTo("B");
  await f.api.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.api.outboxState().entries.length, 0);
  f.switchTo("A", "replacement-A");
  f.send(async () => Response.json({ id: "task" }));
  await f.api.flush();
  assert.equal(f.requests[1].token, "Bearer replacement-A");
  assert.equal(f.requests[1].key, "stable-key");
  assert.equal(f.api.outboxState().entries.length, 0);
});

test("new commands are durably owned before the first request and survive restart", async () => {
  const f = fixture();
  f.send(async () => {
    const stored = JSON.parse(f.disk.get(KEY)!);
    assert.equal(stored.entries[0].owner_id, "A");
    throw new TypeError("Failed to fetch");
  });
  assert.equal(await f.api.run(create), null);
  const restarted = fixture(Object.fromEntries(f.disk));
  await restarted.api.loadOutbox();
  assert.equal(restarted.api.outboxState().entries.length, 1);
  await restarted.api.flush();
  assert.equal(restarted.api.outboxState().entries.length, 0);
});

test("queue read/write failures fail closed, retain memory, and can be retried", async () => {
  const f = fixture();
  f.read(async () => {
    throw new Error("Read unavailable");
  });
  await assert.rejects(f.api.run(create), /Read unavailable/);
  assert.equal(f.requests.length, 0);
  f.read(async (key) => f.disk.get(key) ?? null);
  await f.api.loadOutbox();
  f.write(async () => {
    throw new Error("Storage full");
  });
  await assert.rejects(f.api.run(create), /Storage full/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.api.outboxState().entries.length, 1);
  f.write(async () => {});
  await f.api.flush();
  assert.equal(f.requests.length, 1);
});

test("late success cannot remove B's command or acknowledge A's retained command", async () => {
  const f = fixture({
    [KEY]: envelope([entry(), { ...entry("B"), key: "B-key" }]),
  });
  const started = deferred(),
    result = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return result.promise;
  });
  const flushing = f.api.flush();
  await started.promise;
  f.switchTo("B");
  result.resolve(Response.json({ id: "task" }));
  await flushing;
  assert.equal(f.api.outboxState().entries[0].key, "B-key");
  const stored = JSON.parse(f.disk.get(KEY)!);
  assert.equal(stored.entries.length, 2);
  assert.equal(f.api.outboxState().sending, false);
});

test("read-then-write replay never switches credentials in the middle", async () => {
  const op: core.OutboxOp = {
    type: "item.delete",
    id: "task",
    version: 0,
    title: "Task",
  };
  const f = fixture({ [KEY]: envelope([entry("A", op)]) });
  const started = deferred(),
    result = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return result.promise;
  });
  const flushing = f.api.flush();
  await started.promise;
  f.switchTo("B");
  result.resolve(Response.json({ id: "task", version: 2 }));
  await flushing;
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, "GET");
  assert.equal(f.requests[0].token, "Bearer token-A");
});

test("a late direct-write failure cannot enqueue the old operation under the new account", async () => {
  const f = fixture();
  const started = deferred(),
    result = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return result.promise;
  });
  const running = f.api.run(create);
  const rejected = assert.rejects(running, /account changed/);
  await started.promise;
  f.switchTo("B");
  result.resolve(Response.json({ message: "Expired" }, { status: 401 }));
  await rejected;
  assert.equal(f.api.outboxState().entries.length, 0);
  assert.equal(JSON.parse(f.disk.get(KEY)!).entries[0].owner_id, "A");
});

test("same-token new session generations also fence late acknowledgements", async () => {
  const f = fixture({ [KEY]: envelope([entry()]) });
  const started = deferred(),
    result = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return result.promise;
  });
  const flushing = f.api.flush();
  await started.promise;
  f.switchTo("A");
  result.resolve(Response.json({ id: "task" }));
  await flushing;
  assert.equal(f.api.outboxState().entries.length, 1);
});

test("concurrent flush calls share one dispatcher and offline timers cannot cross accounts", async () => {
  const f = fixture({ [KEY]: envelope([entry()]) });
  f.send(async () => {
    throw new TypeError("Failed to fetch");
  });
  const first = f.api.flush();
  assert.equal(f.api.flush(), first);
  await first;
  assert.equal(f.timers.length, 1);
  const count = f.requests.length;
  f.switchTo("B");
  f.timers[0]();
  await tick();
  assert.equal(f.requests.length, count);
});

test("legacy work is quarantined and preserved before blocking old array readers", async () => {
  const legacy = JSON.stringify([{ ...entry(), owner_id: undefined }]);
  const f = fixture({ [LEGACY]: legacy });
  await f.api.loadOutbox();
  assert.equal(f.api.outboxState().entries.length, 0);
  assert.equal(f.api.outboxState().recovery?.count, 1);
  assert.equal(JSON.parse(f.disk.get(KEY)!).recovery[0].raw, legacy);
  assert.equal(Array.isArray(JSON.parse(f.disk.get(LEGACY)!)), false);
  assert.deepEqual(f.writes.slice(0, 2), [KEY, LEGACY]);
  await f.api.flush();
  assert.equal(f.requests.length, 0);
  assert.match(await f.api.recoveryCopy(), /Kept task/);
  await f.api.discardRecovery();
  assert.equal(f.api.outboxState().recovery, null);
});

test("partial migration failure preserves the original and retries without duplicate recovery", async () => {
  const legacy = JSON.stringify([entry()]);
  const f = fixture({ [LEGACY]: legacy });
  f.write(async (key) => {
    if (key === LEGACY) throw new Error("Interrupted migration");
  });
  await assert.rejects(f.api.loadOutbox(), /Interrupted migration/);
  assert.equal(f.disk.get(LEGACY), legacy);
  assert.equal(JSON.parse(f.disk.get(KEY)!).recovery.length, 1);
  f.write(async () => {});
  await f.api.loadOutbox();
  assert.equal(JSON.parse(f.disk.get(KEY)!).recovery.length, 1);
});

test("failed first migration write never replaces the legacy source", async () => {
  const legacy = JSON.stringify([entry()]);
  const f = fixture({ [LEGACY]: legacy });
  f.write(async () => {
    throw new Error("Full");
  });
  await assert.rejects(f.api.loadOutbox(), /Full/);
  assert.equal(f.disk.has(KEY), false);
  assert.equal(f.disk.get(LEGACY), legacy);
});

test("malformed queues are recoverable and unknown future formats are not overwritten", async () => {
  for (const raw of [
    "broken-json",
    envelope([{ ...entry(), owner_id: "" }]),
    envelope([entry(), entry()]),
  ]) {
    const f = fixture({ [KEY]: raw });
    await f.api.flush();
    assert.equal(f.requests.length, 0);
    assert.equal(JSON.parse(f.disk.get(KEY)!).recovery[0].raw, raw);
  }
  const raw = JSON.stringify({ version: 9, entries: [entry()] });
  const f = fixture({ [KEY]: raw });
  await assert.rejects(f.api.loadOutbox(), /newer version/);
  assert.equal(f.disk.get(KEY), raw);
  assert.equal(f.writes.length, 0);
});

test("unidentified legacy sessions cannot dispatch or accept newly owned commands", async () => {
  const f = fixture({ [KEY]: envelope([entry()]) }, "");
  f.session.token = "opaque-legacy-token";
  await f.api.flush();
  await assert.rejects(f.api.run(create), /Sign in/);
  assert.equal(f.requests.length, 0);
});

test("explicit discard only affects the active account", async () => {
  const f = fixture({
    [KEY]: envelope([entry(), { ...entry("B"), key: "B-key" }]),
  });
  await f.api.clearOutbox();
  const remaining = JSON.parse(f.disk.get(KEY)!).entries;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].owner_id, "B");
});

test("transport retry delay cannot start another request after the session changes", async () => {
  const f = fixture({ [KEY]: envelope([entry()]) });
  f.send(async () => {
    f.switchTo("B");
    return Response.json({ message: "Deploying" }, { status: 503 });
  });
  await f.api.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(f.disk.get(KEY)!).entries[0].owner_id, "A");
});

test("migration verification failure leaves the legacy source intact", async () => {
  const legacy = JSON.stringify([entry()]);
  const f = fixture({ [LEGACY]: legacy });
  let reads = 0;
  f.read(async (key) => {
    if (key === KEY && ++reads === 2) return "unexpected storage content";
    return f.disk.get(key) ?? null;
  });
  await assert.rejects(f.api.loadOutbox(), /verify/);
  assert.equal(f.disk.get(LEGACY), legacy);
  f.read(async (key) => f.disk.get(key) ?? null);
  await f.api.loadOutbox();
  assert.equal(JSON.parse(f.disk.get(KEY)!).recovery.length, 1);
});

test("failed recovery discard retains the recovery copy in memory and on disk", async () => {
  const f = fixture({ [LEGACY]: JSON.stringify([entry()]) });
  await f.api.loadOutbox();
  const before = await f.api.recoveryCopy();
  f.write(async () => {
    throw new Error("Full");
  });
  await assert.rejects(f.api.discardRecovery(), /Full/);
  assert.equal(f.api.outboxState().recovery?.count, 1);
  assert.equal(await f.api.recoveryCopy(), before);
  assert.equal(JSON.parse(f.disk.get(KEY)!).recovery.length, 1);
});

test("stale UI resolutions cannot discard another account or a new session's command", async () => {
  const f = fixture({ [KEY]: envelope([entry(), entry("B")]) });
  await f.api.loadOutbox();
  const api = f.api as API & {
    resolve(
      key: string,
      choice: "drop",
      binding: { userId: string; generation: number },
    ): Promise<void>;
  };
  const binding = { userId: "A", generation: f.session.generation };
  f.switchTo("B");
  await assert.rejects(
    api.resolve("stable-key", "drop", binding),
    /account changed/,
  );
  assert.equal(f.api.outboxState().entries.length, 1);
  f.switchTo("A");
  await assert.rejects(
    api.resolve("stable-key", "drop", binding),
    /account changed/,
  );
  assert.equal(f.api.outboxState().entries.length, 1);
});

test("discard while sending cannot acknowledge another queued command", async () => {
  const f = fixture({
    [KEY]: envelope([entry(), { ...entry(), key: "next" }]),
  });
  const started = deferred(),
    result = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return result.promise;
  });
  const flushing = f.api.flush();
  await started.promise;
  const dropping = f.api.resolve("stable-key", "drop");
  // Drop starts a new flush for the next command; allow only that one to complete.
  f.send(async () => Response.json({ id: "next" }));
  result.resolve(Response.json({ id: "old" }));
  await Promise.all([flushing, dropping]);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].key, "next");
});

test("in-flight page edits do not coalesce away a later saved draft", async () => {
  const doc: core.PageSave = {
    id: "page",
    title: "Page",
    content: [{ type: "paragraph", text: "First" }],
    base: { title: "Page", version: 1, content: [] },
  };
  const f = fixture();
  await f.api.savePageOffline(doc);
  const started = deferred(),
    read = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return read.promise;
  });
  const flushing = f.api.flush();
  await started.promise;
  await f.api.savePageOffline({
    ...doc,
    content: [{ type: "paragraph", text: "Later" }],
  });
  assert.equal(f.api.outboxState().entries.length, 2);
  f.switchTo("B");
  read.resolve(
    Response.json({ id: "page", title: "Page", version: 1, content: [] }),
  );
  await flushing;
  f.switchTo("A");
  assert.equal(f.api.outboxState().entries.length, 2);
  const later = f.api.outboxState().entries[1].op;
  assert.equal(later.type, "doc.save");
  if (later.type === "doc.save")
    assert.equal((later.save.content[0] as { text: string }).text, "Later");
});

test("a direct send and background flush share the same in-flight command", async () => {
  const f = fixture();
  const started = deferred(),
    result = deferred<Response>();
  f.send(async () => {
    started.resolve();
    return result.promise;
  });
  const running = f.api.run(create);
  await started.promise;
  const flushing = f.api.flush();
  await tick();
  assert.equal(f.requests.length, 1);
  result.resolve(Response.json({ id: "task" }));
  await Promise.all([running, flushing]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.api.outboxState().entries.length, 0);
});

test("a delayed storage acknowledgement cannot overwrite a new account's queued work", async () => {
  const f = fixture();
  await f.api.loadOutbox();
  const started = deferred(),
    release = deferred();
  let writes = 0;
  f.write(async () => {
    if (++writes === 1) {
      started.resolve();
      await release.promise;
    }
  });
  const savingA = f.api.run(create);
  const rejected = assert.rejects(savingA, /account changed/);
  await started.promise;
  f.switchTo("B");
  const savingB = f.api.run({
    ...create,
    input: { title: "B only" },
  } as core.OutboxOp);
  f.send(async () => {
    throw new TypeError("Failed to fetch");
  });
  release.resolve();
  await Promise.all([rejected, savingB]);
  const entries = JSON.parse(f.disk.get(KEY)!).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[0].owner_id, "A");
  assert.equal(entries[1].owner_id, "B");
  assert.equal(
    f.requests.every((request) => request.token === "Bearer token-B"),
    true,
  );
});

test("a draft saved during the first durable write is not swallowed by direct dispatch", async () => {
  const doc: core.PageSave = {
    id: "page",
    title: "Page",
    content: [{ type: "paragraph", text: "First" }],
    base: { title: "Page", version: 1, content: [] },
  };
  const f = fixture();
  await f.api.loadOutbox();
  const started = deferred(),
    release = deferred();
  let writes = 0;
  f.write(async () => {
    if (++writes === 1) {
      started.resolve();
      await release.promise;
    }
  });
  const running = f.api.run({ type: "doc.save", save: doc });
  await started.promise;
  const later = f.api.savePageOffline({
    ...doc,
    content: [{ type: "paragraph", text: "Later" }],
  });
  await tick();
  assert.equal(f.api.outboxState().entries.length, 2);
  f.send(async (request) =>
    Response.json(
      request.method === "GET"
        ? { id: "page", title: "Page", version: 1, content: [] }
        : { id: "page", title: "Page", version: 2, content: doc.content },
    ),
  );
  release.resolve();
  await Promise.all([running, later]);
  const remaining = f.api.outboxState().entries;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].op.type, "doc.save");
  if (remaining[0].op.type === "doc.save")
    assert.equal(
      (remaining[0].op.save.content[0] as { text: string }).text,
      "Later",
    );
});

test("guarded mutations preserve planner primary reads and invalidate pre-write read sharing", async () => {
  const f = fixture();
  const oldRead = deferred<Response>(),
    started = deferred();
  let firstRead = true;
  f.send(async (request) => {
    if (request.method === "GET" && firstRead) {
      firstRead = false;
      started.resolve();
      return oldRead.promise;
    }
    return Response.json(
      request.method === "GET" ? [] : { id: "task", version: 1 },
    );
  });
  const before = f.plannerClient.listItems();
  await started.promise;
  await f.api.run(create);
  const after = f.plannerClient.listItems();
  await after;
  assert.equal(
    f.requests.filter((request) => request.method === "GET").length,
    2,
  );
  // Record the actual transport headers, not an internal timestamp assertion.
  assert.equal(f.requests.at(-1)!.consistency, "primary");
  oldRead.resolve(Response.json([]));
  await before;
});

for (const status of [404, 409]) {
  test(`late ${status} cannot mutate the replacement session or invoke its refresh callback`, async () => {
    const op: core.OutboxOp =
      status === 404
        ? { type: "item.delete", id: "task", version: 1, title: "Task" }
        : {
            type: "item.update",
            id: "task",
            base: { id: "task", title: "Old", version: 1 } as core.Item,
            body: { title: "Edit", version: 1 },
          };
    const f = fixture({
      [KEY]: envelope([entry("A", op), { ...entry("B"), key: "B-key" }]),
    });
    const started = deferred(),
      response = deferred<Response>();
    let callbacks = 0;
    f.api.whenSent(() => {
      callbacks++;
    });
    f.send(async () => {
      started.resolve();
      return response.promise;
    });
    const flushing = f.api.flush();
    await started.promise;
    f.switchTo("B");
    response.resolve(Response.json({ message: "Changed" }, { status }));
    await flushing;
    assert.equal(f.requests.length, 1);
    assert.equal(callbacks, 0);
    assert.equal(f.api.outboxState().entries[0].key, "B-key");
    assert.equal(JSON.parse(f.disk.get(KEY)!).entries.length, 2);
  });
}

test("ambiguous committed work is held after same-account reauthentication, without a second effect", async () => {
  const f = fixture();
  // Match the backend receipt namespace: full Authorization header + key.
  const receipts = new Set<string>();
  let effects = 0;
  f.send(async (request) => {
    const receipt = `${request.token}:${request.key}`;
    if (!receipts.has(receipt)) {
      effects++;
      receipts.add(receipt);
    }
    assert.equal(!!JSON.parse(f.disk.get(KEY)!).entries[0].delivery, true);
    throw new TypeError("Response lost after commit");
  });
  await f.api.run({
    type: "habit.create",
    body: { name: "Habit" } as core.HabitInput,
  });
  assert.equal(effects, 1);
  const restarted = fixture(Object.fromEntries(f.disk));
  restarted.switchTo("A", "replacement-token-A");
  restarted.send(async () => {
    effects++;
    return Response.json({ id: "duplicate" });
  });
  await restarted.api.flush();
  assert.equal(restarted.requests.length, 0);
  assert.equal(effects, 1);
  const held = restarted.api.outboxState().entries[0];
  assert.equal(held.state, "failed");
  assert.equal((held as core.OwnedOutboxEntry).uncertain, true);
});

test("a lost response seals the page payload across restart and later edits get a distinct key", async () => {
  const doc: core.PageSave = {
    id: "page",
    title: "Page",
    content: [{ type: "paragraph", text: "First" }],
    base: { title: "Page", version: 1, content: [] },
  };
  const f = fixture();
  await f.api.savePageOffline(doc);
  let committed = false;
  f.send(async (request) => {
    if (request.method === "GET")
      return Response.json({
        id: "page",
        title: "Page",
        version: 1,
        content: [],
      });
    committed = true;
    throw new TypeError("Response lost");
  });
  await f.api.flush();
  assert.equal(committed, true);
  const original = f.api.outboxState().entries[0].key;
  assert.equal(!!JSON.parse(f.disk.get(KEY)!).entries[0].delivery, true);
  const restarted = fixture(Object.fromEntries(f.disk));
  await restarted.api.loadOutbox();
  await restarted.api.savePageOffline({
    ...doc,
    content: [{ type: "paragraph", text: "Later" }],
  });
  assert.equal(restarted.api.outboxState().entries.length, 2);
  assert.notEqual(restarted.api.outboxState().entries[1].key, original);
  // First key replays its committed result. Stop the next write so its newer draft remains.
  restarted.send(async (request) => {
    if (request.method === "GET")
      return Response.json({
        id: "page",
        title: "Page",
        version: 1,
        content: [],
      });
    if (request.key === original)
      return Response.json({
        id: "page",
        title: "Page",
        version: 2,
        content: doc.content,
      });
    throw new TypeError("Offline again");
  });
  await restarted.api.flush();
  assert.equal(restarted.api.outboxState().entries.length, 1);
  const remaining = restarted.api.outboxState().entries[0].op;
  assert.equal(remaining.type, "doc.save");
  if (remaining.type === "doc.save")
    assert.equal((remaining.save.content[0] as { text: string }).text, "Later");
});

test("expired idempotency windows hold uncertain work even with unchanged credentials", async () => {
  const pending = entry("A", {
    type: "habit.create",
    body: { name: "Habit" } as core.HabitInput,
  });
  pending.delivery = {
    credential_hash: createHash("sha256").update("token-A").digest("hex"),
    started_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
  };
  const f = fixture({ [KEY]: envelope([pending]) });
  await f.api.flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.api.outboxState().entries[0].uncertain, true);
});

test("in-progress receipt conflicts do not rotate the key or create another operation", async () => {
  const doc: core.PageSave = {
    id: "page",
    title: "Page",
    content: [],
    base: { title: "Page", version: 1, content: [] },
  };
  const f = fixture();
  await f.api.savePageOffline(doc);
  const key = f.api.outboxState().entries[0].key;
  f.send(async (request) =>
    request.method === "GET"
      ? Response.json({ id: "page", title: "Page", content: [], version: 1 })
      : Response.json(
          { message: "That change is still being made. Try again soon." },
          { status: 409 },
        ),
  );
  await f.api.flush();
  assert.equal(f.api.outboxState().entries[0].key, key);
  assert.equal(f.api.outboxState().entries[0].state, "pending");
  assert.equal(
    f.requests.filter((r) => r.method !== "GET").every((r) => r.key === key),
    true,
  );
});

test("transport retries cannot bypass a failed durable attempt seal", async () => {
  const f = fixture();
  await f.api.loadOutbox();
  f.write(async (key, value) => {
    if (
      key === KEY &&
      JSON.parse(value).entries.some(
        (entry: core.OutboxEntry) => entry.delivery,
      )
    )
      throw new Error("Cannot save attempt");
  });
  await assert.rejects(f.api.run(create), /Cannot save attempt/);
  assert.equal(f.requests.length, 0);
  assert.equal(JSON.parse(f.disk.get(KEY)!).entries[0].delivery, undefined);
});

test("lost conflict-merge responses require the uncertainty warning before manual retry", async () => {
  const base = {
    id: "task",
    title: "Base",
    notes: "",
    kind: "task",
    status: "todo",
    priority: "medium",
    due_at: null,
    end_at: null,
    team_id: null,
    progress: 0,
    version: 1,
  } as core.Item;
  const f = fixture({
    [KEY]: envelope([
      entry("A", {
        type: "item.update",
        id: "task",
        base,
        body: { ...core.itemBody(base), title: "Mine", version: 1 },
      }),
    ]),
  });
  f.send(async (request) => {
    if (request.method === "GET")
      return Response.json({ ...base, notes: "Remote", version: 2 });
    if (request.key === "stable-key")
      return Response.json({ message: "Version conflict" }, { status: 409 });
    throw new TypeError("Failed to fetch after merge commit");
  });
  await f.api.flush();
  assert.equal(f.api.outboxState().entries[0].state, "failed");
  assert.equal(f.api.outboxState().entries[0].uncertain, true);
  assert.equal(
    f.requests.some((request) => request.key === "stable-key-merged"),
    true,
  );
});

test("placement-bearing offline updates without an exact creation baseline never substitute a fresh version", async () => {
  const base = { id: "task", title: "Task", version: 0 } as core.Item;
  const f = fixture({
    [KEY]: envelope([
      entry("A", {
        type: "item.update",
        id: "task",
        base,
        body: { version: 0, project_id: null } as core.ItemInput & {
          version: number;
        },
      }),
    ]),
  });
  await f.api.flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.api.outboxState().entries[0].state, "failed");
  assert.match(
    f.api.outboxState().entries[0].error!,
    /confirmed creation version/,
  );
});

test("a persisted creation receipt supplies its exact version to a causally queued placement", async () => {
  const base = { id: "task", title: "Task", version: 0 } as core.Item;
  const f = fixture({
    [KEY]: envelope([
      entry(),
      {
        ...entry("A", {
          type: "item.update",
          id: "task",
          base,
          body: { version: 0, project_id: null } as core.ItemInput & {
            version: number;
          },
        }),
        key: "placement-key",
      },
    ]),
  });
  f.send(async (request) => {
    if (request.method === "POST")
      return Response.json({ id: "task", title: "Task", version: 1 });
    assert.equal(request.method, "PUT");
    // Simulate an outside edit after creation: expected version must stay 1.
    return Response.json({ message: "Version conflict" }, { status: 409 });
  });
  await f.api.flush();
  assert.equal(f.requests[0].method, "POST");
  assert.equal(f.requests[1].method, "PUT");
  const saved = JSON.parse(f.disk.get(KEY)!).entries[0];
  assert.equal(saved.op.base.version, 1);
  assert.equal(saved.op.body.version, 1);
});
