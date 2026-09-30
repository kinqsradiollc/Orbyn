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
  const one = api.request("/me");
  await tick();
  token = "fixture-b";
  const two = api.request("/me");
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
  const old = api.request("/items");
  await tick();
  await api.request("/items", { method: "POST", body: {} });
  await api.request("/items");
  assert.equal(reads, 2);
  hold.release();
  await old;
});

test("signals, custom headers, fresh reads and raw responses have independent transports", async () => {
  for (const options of [
    { signal: new AbortController().signal },
    { headers: { "X-Mode": "a" } },
    { fresh: true },
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
  const results = Promise.allSettled([api.request("/me"), api.request("/me")]);
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
