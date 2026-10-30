import { test } from "node:test";
import assert from "node:assert/strict";
import { OrbynClient } from "@orbyn/api-client";
import { HttpError } from "@orbyn/core";

const client = (
  fetcher: typeof fetch,
  getToken = () => "fixture-a",
  timeoutMs = 120_000,
) =>
  new OrbynClient({
    baseUrl: "http://fixture.invalid",
    getToken,
    fetch: fetcher,
    timeoutMs,
  });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function gate() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { waiting, release };
}

test("overlapping refresh readers share one fetch and receive independent values", async () => {
  const hold = gate();
  let count = 0;
  const api = client(async () => {
    count++;
    await hold.waiting;
    return Response.json({ rows: [{ title: "original" }] });
  });
  const one = api.request<{ rows: { title: string }[] }>("/lists");
  const two = api.request<{ rows: { title: string }[] }>("/lists");
  await tick();
  assert.equal(count, 1);
  hold.release();
  const [a, b] = await Promise.all([one, two]);
  a.rows[0].title = "changed";
  assert.equal(b.rows[0].title, "original");
  await api.request("/lists");
  assert.equal(count, 2, "settled reads must be refreshed");
});

test("an account switch cannot reuse another account’s pending read", async () => {
  const hold = gate();
  const auth: string[] = [];
  let token = "fixture-a";
  const api = client(
    async (_url, init) => {
      auth.push(new Headers(init?.headers).get("Authorization")!);
      await hold.waiting;
      return Response.json({});
    },
    () => token,
  );
  const one = api.request("/me", { signal: new AbortController().signal });
  await tick();
  token = "fixture-b";
  const two = api.request("/me", { signal: new AbortController().signal });
  await tick();
  hold.release();
  await Promise.all([one, two]);
  assert.deepEqual(auth, ["Bearer fixture-a", "Bearer fixture-b"]);
});

test("post-mutation reads never join pre-mutation reads", async () => {
  const hold = gate();
  let reads = 0;
  const api = client(async (_url, init) => {
    if (init?.method === "GET") {
      reads++;
      if (reads === 1) await hold.waiting;
    }
    return Response.json({});
  });
  const old = api.request("/items", { signal: new AbortController().signal });
  await tick();
  await api.request("/items", { method: "POST", body: {} });
  await api.request("/items", { signal: new AbortController().signal });
  assert.equal(reads, 2);
  hold.release();
  await old;
});

test("external mutation fences pending reads and asks the primary for the replacement", async () => {
  const hold = gate();
  const consistency: (string | null)[] = [];
  const api = client(async (_url, init) => {
    consistency.push(new Headers(init?.headers).get("X-Orbyn-Consistency"));
    const read = consistency.length;
    if (read === 1) await hold.waiting;
    return Response.json({ read });
  });
  const old = api.request("/today", { signal: new AbortController().signal });
  await tick();
  api.noteExternalMutation();
  const replacement = await api.request("/today", {
    signal: new AbortController().signal,
  });
  assert.deepEqual(replacement, { read: 2 });
  assert.deepEqual(consistency, [null, "primary"]);
  hold.release();
  assert.deepEqual(await old, { read: 1 });
});

test("custom headers, fresh reads, bodies and raw responses have independent transports", async () => {
  for (const options of [
    { headers: { "X-Mode": "a" } },
    { fresh: true },
    { body: {} },
    { raw: true },
  ]) {
    const hold = gate();
    let count = 0;
    const api = client(async () => {
      count++;
      await hold.waiting;
      return Response.json({});
    });
    const one = api.request("/me", options);
    const two = api.request("/me", options);
    await tick();
    assert.equal(count, 2);
    hold.release();
    await Promise.all([one, two]);
  }
});

test("one subscriber can cancel while other readers retain one transport and independent results", async () => {
  const hold = gate();
  const stop = new AbortController();
  const signals: AbortSignal[] = [];
  const api = client(async (_url, init) => {
    signals.push(init!.signal!);
    await hold.waiting;
    return Response.json({ rows: [{ title: "original" }] });
  });
  const abandoned = api.request("/lists", { signal: stop.signal });
  const failure = assert.rejects(abandoned, { name: "AbortError" });
  const one = api.request<{ rows: { title: string }[] }>("/lists", {
    signal: new AbortController().signal,
  });
  const two = api.request<{ rows: { title: string }[] }>("/lists");
  await tick();
  assert.equal(signals.length, 1);
  stop.abort();
  await failure;
  assert.equal(signals[0].aborted, false);
  hold.release();
  const [a, b] = await Promise.all([one, two]);
  a.rows[0].title = "changed";
  assert.equal(b.rows[0].title, "original");
});

test("the last cancellation aborts and evicts transport before an immediate new reader", async () => {
  const hold = gate();
  const first = new AbortController();
  const second = new AbortController();
  const signals: AbortSignal[] = [];
  const validators: (string | null)[] = [];
  const api = client(async (_url, init) => {
    signals.push(init!.signal!);
    validators.push(new Headers(init?.headers).get("If-None-Match"));
    const read = signals.length;
    if (read === 1) await hold.waiting;
    // Deliberately ignore abort to exercise late completion and cache fencing.
    return Response.json(
      { read },
      {
        headers: { ETag: `"fixture-${read}"` },
      },
    );
  });
  const one = api.request("/lists", { signal: first.signal });
  const two = api.request("/lists", { signal: second.signal });
  const failures = Promise.all([
    assert.rejects(one, { name: "AbortError" }),
    assert.rejects(two, { name: "AbortError" }),
  ]);
  await tick();
  first.abort();
  assert.equal(signals[0].aborted, false);
  second.abort();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(await api.request("/lists"), { read: 2 });
  assert.equal(signals.length, 2);
  hold.release();
  await failures;
  await tick();
  assert.deepEqual(await api.request("/lists"), { read: 3 });
  assert.equal(
    validators[2],
    '"fixture-2"',
    "abandoned late read cannot replace the current validator",
  );
});

test("already-cancelled readers never dispatch or join a live read", async () => {
  const stop = new AbortController();
  stop.abort();
  let count = 0;
  const api = client(async () => {
    count++;
    return Response.json({});
  });
  await assert.rejects(api.request("/lists", { signal: stop.signal }), {
    name: "AbortError",
  });
  assert.equal(count, 0);
  await api.request("/lists");
  assert.equal(count, 1);
});

test("custom header variants and fresh reads cannot reuse or overwrite ordinary validators", async () => {
  const seen: Headers[] = [];
  const api = client(async (_url, init) => {
    const headers = new Headers(init?.headers);
    seen.push(headers);
    if (headers.has("X-Mode"))
      return Response.json(
        { mode: "variant" },
        { headers: { ETag: '"variant"' } },
      );
    if (headers.has("Cache-Control"))
      return Response.json({ mode: "fresh" }, { headers: { ETag: '"fresh"' } });
    if (headers.get("If-None-Match") === '"ordinary"')
      return new Response(null, { status: 304 });
    return Response.json(
      { mode: "ordinary" },
      { headers: { ETag: '"ordinary"' } },
    );
  });
  await api.request("/me");
  assert.deepEqual(await api.request("/me", { headers: { "X-Mode": "a" } }), {
    mode: "variant",
  });
  assert.equal(seen[1].has("If-None-Match"), false);
  assert.deepEqual(await api.request("/me"), { mode: "ordinary" });
  assert.equal(seen[2].get("If-None-Match"), '"ordinary"');
  await api.request("/me", { fresh: true });
  assert.equal(seen[3].has("If-None-Match"), false);
  assert.deepEqual(await api.request("/me"), { mode: "ordinary" });
  assert.equal(seen[4].get("If-None-Match"), '"ordinary"');
});

test("no-store and Vary star responses remove existing ordinary validators", async () => {
  for (const policy of [
    { "Cache-Control": "private, No-Store" },
    { Vary: "Origin, *" },
  ]) {
    const validators: (string | null)[] = [];
    let count = 0;
    const api = client(async (_url, init) => {
      validators.push(new Headers(init?.headers).get("If-None-Match"));
      count++;
      return Response.json(
        {},
        {
          headers: {
            ETag: `"fixture-${count}"`,
            ...(count > 1 ? policy : {}),
          },
        },
      );
    });
    await api.request("/me");
    await api.request("/me");
    await api.request("/me");
    assert.deepEqual(validators, [null, '"fixture-1"', null]);
  }
});

test("a 304 that forbids retention serves its validated body once and drops the validator", async () => {
  for (const policy of [{ "Cache-Control": "no-store" }, { Vary: "*" }]) {
    const validators: (string | null)[] = [];
    const api = client(async (_url, init) => {
      validators.push(new Headers(init?.headers).get("If-None-Match"));
      if (validators.length === 2)
        return new Response(null, { status: 304, headers: policy });
      return Response.json(
        { title: "validated" },
        {
          headers: { ETag: '"fixture"' },
        },
      );
    });
    await api.request("/me");
    assert.deepEqual(await api.request("/me"), { title: "validated" });
    await api.request("/me");
    assert.deepEqual(validators, [null, '"fixture"', null]);
  }
});

test("failed shared reads are evicted so a later refresh can recover", async () => {
  const hold = gate();
  let count = 0;
  const api = client(async () => {
    count++;
    await hold.waiting;
    return count === 1
      ? Response.json({ message: "Blocked" }, { status: 403 })
      : Response.json({ recovered: true });
  });
  const results = Promise.allSettled([
    api.request("/me", { signal: new AbortController().signal }),
    api.request("/me", { signal: new AbortController().signal }),
  ]);
  await tick();
  hold.release();
  assert.ok((await results).every((r) => r.status === "rejected"));
  assert.deepEqual(await api.request("/me"), { recovered: true });
  assert.equal(count, 2);
});

test("GET 429 honors Retry-After and recovers once without exposing an initial error", async () => {
  let count = 0;
  const api = client(async () =>
    ++count === 1
      ? Response.json(
          { message: "Slow down" },
          { status: 429, headers: { "Retry-After": "0" } },
        )
      : Response.json({ recovered: true }),
  );
  assert.deepEqual(await api.request("/me"), { recovered: true });
  assert.equal(count, 2);
});

test("HTTP-date Retry-After is accepted for a bounded read recovery", async () => {
  let count = 0;
  const api = client(async () =>
    ++count === 1
      ? Response.json(
          {},
          {
            status: 429,
            headers: {
              "Retry-After": new Date(Date.now() - 1000).toUTCString(),
            },
          },
        )
      : Response.json({ recovered: true }),
  );
  assert.deepEqual(await api.request("/me"), { recovered: true });
  assert.equal(count, 2);
});

test("continued 429 fails after one recovery and preserves server metadata", async () => {
  let count = 0;
  const api = client(async () => {
    count++;
    return Response.json(
      { message: "Still limited" },
      { status: 429, headers: { "Retry-After": "0" } },
    );
  });
  await assert.rejects(
    api.request("/me"),
    (e: unknown) =>
      e instanceof HttpError && e.status === 429 && e.retryAfterMs === 0,
  );
  assert.equal(count, 2);
});

test("missing, malformed, negative, blank and excessive Retry-After do not loop", async () => {
  for (const value of [null, "nonsense", "-1", "", "61", "Infinity"]) {
    let count = 0;
    const api = client(async () => {
      count++;
      return Response.json(
        {},
        {
          status: 429,
          headers: value === null ? {} : { "Retry-After": value },
        },
      );
    });
    await assert.rejects(
      api.request("/me"),
      (e: unknown) => e instanceof HttpError && e.status === 429,
    );
    assert.equal(count, 1, String(value));
  }
});

test("429 writes are not replayed even with an idempotency key", async () => {
  let count = 0;
  const api = client(async () => {
    count++;
    return Response.json({}, { status: 429, headers: { "Retry-After": "0" } });
  });
  await assert.rejects(
    api.request("/items", {
      method: "POST",
      body: {},
      idempotencyKey: "fixture-write",
    }),
    (e: unknown) => e instanceof HttpError && e.status === 429,
  );
  assert.equal(count, 1);
});

test("abort interrupts a Retry-After wait and prevents recovery fetch", async () => {
  const stop = new AbortController();
  let count = 0;
  const api = client(async () => {
    count++;
    return Response.json({}, { status: 429, headers: { "Retry-After": "10" } });
  });
  const request = api.request("/me", { signal: stop.signal });
  await tick();
  stop.abort();
  await assert.rejects(
    request,
    (e: unknown) => e instanceof Error && e.name === "AbortError",
  );
  assert.equal(count, 1);
});

test("401, 403 and 400 are surfaced without recovery fetches", async () => {
  for (const status of [400, 401, 403]) {
    let count = 0;
    const api = client(async () => {
      count++;
      return Response.json({}, { status });
    });
    await assert.rejects(
      api.request("/me"),
      (e: unknown) => e instanceof HttpError && e.status === status,
    );
    assert.equal(count, 1);
  }
});

test("shared 204 replies retain undefined and settle cleanly", async () => {
  const hold = gate();
  let count = 0;
  const api = client(async () => {
    count++;
    await hold.waiting;
    return new Response(null, { status: 204 });
  });
  const replies = Promise.all([api.request("/empty"), api.request("/empty")]);
  await tick();
  hold.release();
  assert.deepEqual(await replies, [undefined, undefined]);
  assert.equal(count, 1);
});

// React Native supplies the abort-controller signal, without the newer browser
// convenience method or a reason. Exercise that shape without replacing globals.
test("legacy native signals can read and cancel without throwIfAborted or reason", async () => {
  const hold = gate();
  const stop = new AbortController();
  Object.defineProperty(stop.signal, "throwIfAborted", { value: undefined });
  Object.defineProperty(stop.signal, "reason", { value: undefined });
  let count = 0;
  const api = client(async () => {
    count++;
    if (count === 1) return Response.json({ read: true });
    await hold.waiting;
    return Response.json({ read: true });
  });
  assert.deepEqual(await api.request("/me", { signal: stop.signal }), {
    read: true,
  });
  const cancelled = api.request("/me", { signal: stop.signal });
  const failure = assert.rejects(cancelled, { name: "AbortError" });
  await tick();
  stop.abort();
  await failure;
  await assert.rejects(api.request("/me", { signal: stop.signal }), {
    name: "AbortError",
  });
  assert.equal(
    count,
    2,
    "an already cancelled native reader must not dispatch",
  );
  hold.release();
  await tick();
});
