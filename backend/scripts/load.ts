/**
 * Load test for the Orbyn API, with no extra dependencies. Signs up one test
 * account, seeds items, then runs each scenario for a fixed time with a fixed
 * number of concurrent connections and reports throughput and latency.
 *
 *   LOAD_URL=http://localhost:8008 LOAD_SECONDS=15 LOAD_CONCURRENCY=64 \
 *   npm run load -w backend
 *
 * Point it at a disposable environment: it creates an account and items.
 */
import { randomUUID } from "node:crypto";

const base = process.env.LOAD_URL || "http://localhost:8008";
const seconds = Number(process.env.LOAD_SECONDS || 15);
const concurrency = Number(process.env.LOAD_CONCURRENCY || 64);
const seedItems = Number(process.env.LOAD_SEED_ITEMS || 50);
const only = (process.env.LOAD_SCENARIOS || "").split(",").filter(Boolean);

type Result = { ok: boolean; status: number; ms: number };

async function timed(url: string, init?: RequestInit): Promise<Result> {
  const start = performance.now();
  try {
    const response = await fetch(url, init);
    await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      ms: performance.now() - start,
    };
  } catch {
    return { ok: false, status: 0, ms: performance.now() - start };
  }
}

const pct = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
    : 0;

async function run(name: string, request: () => Promise<Result>) {
  const latencies: number[] = [];
  const statuses = new Map<number, number>();
  let errors = 0;
  const deadline = performance.now() + seconds * 1000;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const r = await request();
        latencies.push(r.ms);
        statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
        if (!r.ok) errors++;
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const rps = latencies.length / elapsed;
  const codes = [...statuses.entries()]
    .map(([c, n]) => `${c || "network"}:${n}`)
    .join(" ");
  console.log(
    `${name.padEnd(22)} ${rps.toFixed(0).padStart(7)} req/s   p50 ${pct(latencies, 50).toFixed(1).padStart(6)} ms   p95 ${pct(latencies, 95).toFixed(1).padStart(6)} ms   p99 ${pct(latencies, 99).toFixed(1).padStart(7)} ms   errors ${((errors / Math.max(1, latencies.length)) * 100).toFixed(2)}%   [${codes}]`,
  );
  return {
    name,
    rps,
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    errors,
  };
}

const json = { "Content-Type": "application/json" };
const email = `load-${randomUUID()}@example.com`;
const signup = await fetch(`${base}/auth/register`, {
  method: "POST",
  headers: json,
  body: JSON.stringify({
    email,
    password: "load-test-password",
    name: "Load test",
  }),
});
if (!signup.ok)
  throw new Error(
    `Sign-up failed: HTTP ${signup.status} ${await signup.text()}`,
  );
const { token } = (await signup.json()) as { token: string };
const auth = { ...json, Authorization: `Bearer ${token}` };
for (let i = 0; i < seedItems; i++)
  await fetch(`${base}/items`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      title: `Seed ${i}`,
      due_at: new Date(Date.now() + i * 3.6e6).toISOString(),
    }),
  });

console.log(
  `Orbyn load test: ${base}, ${concurrency} connections, ${seconds}s per scenario, ${seedItems} seeded items\n`,
);
const scenarios: [string, () => Promise<Result>][] = [
  ["gateway /health", () => timed(`${base}/health`)],
  ["GET /status (cached)", () => timed(`${base}/status`)],
  ["GET /me", () => timed(`${base}/me`, { headers: auth })],
  ["GET /items", () => timed(`${base}/items?limit=50`, { headers: auth })],
  [
    "POST /items",
    () =>
      timed(`${base}/items`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ title: "Load item" }),
      }),
  ],
];
const results = [];
for (const [name, request] of scenarios)
  if (!only.length || only.some((o) => name.includes(o)))
    results.push(await run(name, request));
console.log(
  `\nJSON ${JSON.stringify(results.map((r) => ({ ...r, rps: Math.round(r.rps) })))}`,
);
