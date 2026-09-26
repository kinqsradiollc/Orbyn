// The incident game day for outside agents: pulls each kill switch in turn,
// checks an agent is stopped the way docs/runbooks/agents.md says, times how
// long it took, and puts everything back.
//
//   L1  end one connection            → its next call is 401
//   L2  block an app                  → 403 for every connection of that app
//   L3  freeze agents' changes        → writes refused (READ_ONLY), reads fine
//   L4  switch outside agents off     → 503 on the MCP address
//
// Two ways to run it:
//
//   npm run gameday -w backend
//     In this process against DATABASE_URL (a test or development
//     database): makes a throwaway person and admin, runs the drills,
//     removes them. CI runs the same (tests/mcp-directory.test.ts).
//
//   GAMEDAY_URL=https://staging.orbyn.dev GAMEDAY_ADMIN_TOKEN=… \
//   GAMEDAY_AGENT_KEY=oak_… GAMEDAY_GRANT_ID=… npm run gameday -w backend
//     Against a running Orbyn (staging), through its gateway: an admin's
//     session token and an agent key that admin made for the drill (L1
//     revokes it). Switch changes reach every copy within 10 seconds; the
//     report shows how long each took. The gateway's own switch
//     (MCP_DISABLED=1, a restart) is checked by hand: see the runbook.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";

export type Drill = {
  level: "L1" | "L2" | "L3" | "L4";
  name: string;
  ok: boolean;
  /** How long until the switch took effect. */
  ms: number;
  detail: string;
};

type Answer = { status: number; body: any };

/** How the drills reach Orbyn: in this process, or over HTTP. */
export type Target = {
  mcp: (key: string, body: object) => Promise<Answer>;
  admin: (
    method: "GET" | "PUT",
    path: string,
    body?: object,
  ) => Promise<Answer>;
  revoke: (grantId: string) => Promise<Answer>;
};

const rpc = (method: string, params: object = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params,
});
const read = rpc("tools/call", { name: "get_context", arguments: {} });
const write = rpc("tools/call", {
  name: "create_tasks",
  arguments: { tasks: [{ title: "Game day check (safe to delete)" }] },
});

/** Calls `probe` until `done` says so or `limitMs` passes; the time it took. */
async function until(
  probe: () => Promise<Answer>,
  done: (a: Answer) => boolean,
  limitMs: number,
): Promise<{ ok: boolean; ms: number; last: Answer }> {
  const started = Date.now();
  let last = await probe();
  while (!done(last) && Date.now() - started < limitMs) {
    await new Promise((r) => setTimeout(r, 500));
    last = await probe();
  }
  return { ok: done(last), ms: Date.now() - started, last };
}

const errorCode = (a: Answer) =>
  a.body?.result?._meta?.["orbyn/error"]?.code ?? a.body?.error?.code;

/**
 * Runs the four drills against `target` with `key` (an agent key with
 * write access, whose connection is `grantId`). Always restores the
 * switches it touched, whatever happens.
 */
export async function runGameDay(
  target: Target,
  key: string,
  grantId: string,
  opts: { limitMs?: number } = {},
): Promise<Drill[]> {
  const limitMs = opts.limitMs ?? 15_000;
  const drills: Drill[] = [];
  const before = (await target.admin("GET", "/admin/agents")).body as {
    agents_enabled: boolean;
    agents_writes_enabled: boolean;
    blocked_client_ids: string[];
  };
  const restore = () =>
    target.admin("PUT", "/admin/agents", {
      agents_enabled: before.agents_enabled,
      agents_writes_enabled: before.agents_writes_enabled,
      blocked_client_ids: before.blocked_client_ids,
    });
  const baseline = await target.mcp(key, read);
  if (baseline.status !== 200 || baseline.body?.result?.isError)
    throw new Error(
      `The agent key doesn't work before the drill (${baseline.status}).`,
    );
  try {
    // L3: changes frozen, reads go on.
    await target.admin("PUT", "/admin/agents", {
      agents_writes_enabled: false,
    });
    const frozen = await until(
      () => target.mcp(key, write),
      (a) => errorCode(a) === "READ_ONLY",
      limitMs,
    );
    const stillReads = await target.mcp(key, read);
    drills.push({
      level: "L3",
      name: "Freeze agents' changes",
      ok:
        frozen.ok &&
        stillReads.status === 200 &&
        !stillReads.body?.result?.isError,
      ms: frozen.ms,
      detail: frozen.ok
        ? "Changes refused with READ_ONLY; reading still works."
        : `Changes weren't refused (last: ${frozen.last.status} ${JSON.stringify(errorCode(frozen.last))}).`,
    });
    await restore();

    // L4: every agent stopped.
    await target.admin("PUT", "/admin/agents", { agents_enabled: false });
    const off = await until(
      () => target.mcp(key, read),
      (a) => a.status === 503,
      limitMs,
    );
    drills.push({
      level: "L4",
      name: "Switch outside agents off",
      ok: off.ok,
      ms: off.ms,
      detail: off.ok
        ? "The MCP address answers 503 with Retry-After."
        : `Still answering (last ${off.last.status}).`,
    });
    await restore();

    // L2: the app blocked (agent keys connect as one app).
    await target.admin("PUT", "/admin/agents", {
      blocked_client_ids: [...before.blocked_client_ids, "orbyn-agent-key"],
    });
    const blocked = await until(
      () => target.mcp(key, read),
      (a) => a.status === 403,
      limitMs,
    );
    drills.push({
      level: "L2",
      name: "Block an app",
      ok: blocked.ok,
      ms: blocked.ms,
      detail: blocked.ok
        ? "Its connections get 403 until unblocked."
        : `Still answering (last ${blocked.last.status}).`,
    });
    await restore();
    const back = await until(
      () => target.mcp(key, read),
      (a) => a.status === 200,
      limitMs,
    );
    if (!back.ok)
      drills.push({
        level: "L2",
        name: "Unblock the app",
        ok: false,
        ms: back.ms,
        detail: `The key didn't work again after unblocking (${back.last.status}).`,
      });

    // L1: one connection ended, for good.
    await target.revoke(grantId);
    const revoked = await until(
      () => target.mcp(key, read),
      (a) => a.status === 401,
      limitMs,
    );
    drills.push({
      level: "L1",
      name: "End one connection",
      ok: revoked.ok,
      ms: revoked.ms,
      detail: revoked.ok
        ? "Its next call is 401; the key never works again."
        : `Still answering (last ${revoked.last.status}).`,
    });
  } finally {
    await restore();
  }
  return drills.sort((a, b) => a.level.localeCompare(b.level));
}

/** Drills in this process, with a throwaway person and admin. */
export async function localGameDay(app: FastifyInstance): Promise<Drill[]> {
  const { pool } = await import("../src/db/pool.js");
  const { invalidateSettings } = await import("../src/lib/settings.js");
  const { createAgentKey } = await import("../src/modules/agents/service.js");
  const register = async (prefix: string) => {
    const r = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: {
        email: `${prefix}-${randomUUID()}@gameday.test`,
        password: "a-long-game-day-password",
        name: prefix,
      },
    });
    return r.json() as { token: string; user: { id: string } };
  };
  const admin = await register("gameday-admin");
  const person = await register("gameday-person");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
    admin.user.id,
  ]);
  await pool.query(
    "UPDATE users SET role = 'member', email_verified = true WHERE id = $1",
    [person.user.id],
  );
  const made = await createAgentKey(person.user.id, {
    name: "Game day",
    access: "write",
  });
  const inject = async (
    method: "GET" | "PUT" | "POST" | "DELETE",
    url: string,
    token: string,
    payload?: object,
  ): Promise<Answer> => {
    const r = await app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload ? { "content-type": "application/json" } : {}),
      },
      ...(payload ? { payload: JSON.stringify(payload) } : {}),
    });
    let body: unknown = null;
    try {
      body = r.body ? JSON.parse(r.body) : null;
    } catch {
      body = r.body;
    }
    return { status: r.statusCode, body };
  };
  try {
    return await runGameDay(
      {
        mcp: (key, body) => inject("POST", "/mcp", key, body),
        admin: async (method, path, body) => {
          const a = await inject(method, path, admin.token, body);
          // This process re-reads the switches at once (other copies within 10 s).
          invalidateSettings();
          return a;
        },
        revoke: (id) => inject("DELETE", `/me/agents/${id}`, person.token),
      },
      made.key,
      made.grant.id,
      { limitMs: 3_000 },
    );
  } finally {
    // The throwaway people go (their audit rows may keep them: then they
    // stay, disabled).
    await pool
      .query("DELETE FROM users WHERE id = ANY ($1::uuid[])", [
        [admin.user.id, person.user.id],
      ])
      .catch(() =>
        pool.query(
          "UPDATE users SET disabled = true, role = 'member' WHERE id = ANY ($1::uuid[])",
          [[admin.user.id, person.user.id]],
        ),
      );
  }
}

/** Drills against a running Orbyn, through its gateway. */
export function remoteTarget(base: string, adminToken: string): Target {
  const root = base.replace(/\/+$/, "");
  const call = async (
    method: string,
    url: string,
    token: string,
    body?: object,
  ): Promise<Answer> => {
    const r = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON: keep the text.
    }
    return { status: r.status, body: parsed };
  };
  return {
    mcp: (key, body) => call("POST", `${root}/api/mcp`, key, body),
    admin: (method, path, body) =>
      call(method, `${root}/api${path}`, adminToken, body),
    revoke: (id) => call("DELETE", `${root}/api/me/agents/${id}`, adminToken),
  };
}

const print = (drills: Drill[]) =>
  process.stdout.write(
    [
      "Game day: outside agents' kill switches",
      ...drills.map(
        (d) =>
          `${d.ok ? "PASS" : "FAIL"}  ${d.level}  ${d.name.padEnd(28)} ${String(d.ms).padStart(6)} ms  ${d.detail}`,
      ),
      "Also by hand: MCP_DISABLED=1 on the gateway, restart it, and check the MCP host answers 503 (see docs/runbooks/agents.md).",
      "",
    ].join("\n"),
  );

async function main() {
  const url = process.env.GAMEDAY_URL;
  let drills: Drill[];
  if (url) {
    const admin = process.env.GAMEDAY_ADMIN_TOKEN;
    const key = process.env.GAMEDAY_AGENT_KEY;
    const grant = process.env.GAMEDAY_GRANT_ID;
    if (!admin || !key || !grant) {
      process.stderr.write(
        "Set GAMEDAY_ADMIN_TOKEN, GAMEDAY_AGENT_KEY and GAMEDAY_GRANT_ID (a key the admin made for the drill).\n",
      );
      process.exit(2);
    }
    drills = await runGameDay(remoteTarget(url, admin), key, grant);
  } else {
    if (process.env.NODE_ENV === "production") {
      process.stderr.write(
        "Refusing to run in this process against production. Use GAMEDAY_URL against staging.\n",
      );
      process.exit(2);
    }
    const { buildApp } = await import("../src/app.js");
    const { pool } = await import("../src/db/pool.js");
    const app = await buildApp();
    try {
      drills = await localGameDay(app);
    } finally {
      await app.close();
      await pool.end();
    }
  }
  print(drills);
  if (drills.some((d) => !d.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
