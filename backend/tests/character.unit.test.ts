import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CHARACTER_BODIES,
  CHARACTER_EYES,
  CHARACTER_RINGS,
  CHARACTER_ACCESSORIES,
  DEFAULT_CHARACTER,
  characterAppearance,
  characterAppearanceInput,
  characterArt,
  characterPose,
  characterLayerTransform,
  STILL_CHARACTER_POSE,
  characterState,
  personalAgentSettingsInput,
  agentSettingsInput,
} from "@orbyn/core";
import { OrbynClient } from "@orbyn/api-client";
import { pool } from "../src/db/pool.js";
import { digest } from "../src/lib/auth.js";
import { createService } from "../src/services/http.js";
import { agentContextRoutes } from "../src/modules/agent-context/routes.js";

test("appearance defaults migrate legacy records and reject arbitrary assets and invalid parts", () => {
  assert.deepEqual(characterAppearance({}), DEFAULT_CHARACTER);
  assert.deepEqual(characterAppearance(undefined), DEFAULT_CHARACTER);
  assert.deepEqual(characterAppearance({ body: "unknown" }), DEFAULT_CHARACTER);
  for (const bad of [
    { url: "https://other.example/tracker" },
    { body: "<script>" },
    { presence: "always" },
    { palette: "#ffffff" },
  ])
    assert.equal(characterAppearanceInput.safeParse(bad).success, false);
  assert.equal(
    personalAgentSettingsInput.safeParse({
      name: "Orb",
      character: { body: "spark" },
    }).success,
    true,
  );
  assert.equal(
    agentSettingsInput.safeParse({ name: "Orb", character: {} }).success,
    false,
    "MCP identity changes retain their existing scope",
  );
});

test("actual activity chooses decision, failure, stopped and success expressions in order", () => {
  assert.equal(characterState({ thinking: false }), "ready");
  assert.equal(
    characterState({ thinking: true, runState: "waiting" }),
    "waiting",
  );
  assert.equal(
    characterState({ thinking: false, runState: "running" }),
    "working",
  );
  assert.equal(
    characterState({ thinking: false, needsApproval: true, outcome: "done" }),
    "waiting",
  );
  assert.equal(
    characterState({ thinking: false, needsApproval: true, outcome: "error" }),
    "error",
  );
  assert.equal(
    characterState({ thinking: false, outcome: "interrupted" }),
    "interrupted",
  );
  assert.equal(characterState({ thinking: false, outcome: "done" }), "done");
  for (const body of CHARACTER_BODIES)
    for (const eyes of CHARACTER_EYES)
      for (const ring of CHARACTER_RINGS)
        for (const accessory of CHARACTER_ACCESSORIES) {
          const appearance = {
            ...DEFAULT_CHARACTER,
            body,
            eyes,
            ring,
            accessory,
          };
          for (const state of [
            "ready",
            "working",
            "waiting",
            "done",
            "error",
            "interrupted",
          ] as const) {
            const art = characterArt(appearance, state);
            assert.equal(new Set(art.map((part) => part.key)).size, art.length);
            assert.ok(art.some((part) => part.key === "body"));
            assert.ok(
              art.every(
                (part) =>
                  part.d.length && !/NaN|undefined|Infinity/.test(part.d),
              ),
            );
          }
        }
  const art = (state: Parameters<typeof characterArt>[1]) =>
    characterArt({ ...DEFAULT_CHARACTER }, state).find(
      (part) => part.key === "mouth",
    )?.d;
  assert.notEqual(art("done"), art("error"));
  assert.notEqual(art("ready"), art("waiting"));
});

test("shared rig blinks, waves, celebrates briefly and keeps errors distinct", () => {
  const idle = characterPose("ready", 0);
  assert.equal(idle.blink, 1);
  assert.equal(characterPose("ready", 3990).blink, 0.08);
  assert.ok(characterPose("ready", 500, 400).rightPaw < -40);
  assert.ok(Math.abs(characterPose("ready", 2500, 2000).rightPaw) <= 3);
  assert.ok(characterPose("done", 200).y < -3);
  assert.ok(Math.abs(characterPose("done", 2500).y) < 2);
  assert.equal(
    characterPose("error", 200).leftPaw,
    characterPose("ready", 200).leftPaw,
  );
  assert.equal(
    characterLayerTransform("eyes", STILL_CHARACTER_POSE),
    "translate(0 61) scale(1 1) translate(0 -61)",
  );
  const soft = { ...DEFAULT_CHARACTER, eyes: "soft" as const };
  assert.notEqual(
    characterArt(soft, "done").find((p) => p.key === "eyes")?.d,
    characterArt(soft, "error").find((p) => p.key === "eyes")?.d,
  );
});

test("identity API saves appearance per person, preserves it for legacy edits, and enforces the route shield", async () => {
  const id = randomUUID(),
    otherId = randomUUID();
  const records = new Map<string, Record<string, unknown>>();
  let failRead = false;
  const query = async (sql: string, args: unknown[] = []) => {
    const user = {
      id: args[0] === digest("other") ? otherId : id,
      name: "Fixture",
      role: "member",
      disabled: args[0] === digest("disabled"),
      email_verified: true,
    };
    if (sql.includes("JOIN sessions"))
      return { rows: args[0] === digest("expired") ? [] : [user], rowCount: 1 };
    if (sql.includes("JOIN api_keys")) return { rows: [user], rowCount: 1 };
    if (sql.includes("INSERT INTO agent_settings")) {
      const userId = String(args[0]);
      assert.ok(
        sql.includes("coalesce($4::jsonb, agent_settings.character)"),
        "omitted appearance must not erase a saved character",
      );
      const saved = {
        name: args[1],
        persona: args[2],
        character: args[3]
          ? JSON.parse(String(args[3]))
          : (records.get(userId)?.character ?? {}),
        named_at: new Date(),
        updated_at: new Date(),
      };
      records.set(userId, saved);
      return { rows: [saved], rowCount: 1 };
    }
    if (sql.includes("FROM agent_settings WHERE user_id")) {
      if (failRead) throw new Error("fixture unavailable");
      assert.ok(
        sql.includes("user_id = $1"),
        "reads must be scoped to the signed-in person",
      );
      const row = records.get(String(args[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  mock.method(pool, "query", query);
  mock.method(pool, "connect", async () => ({ query, release: () => {} }));
  const app = await createService("api", [agentContextRoutes]);
  let address = 1;
  const call = (
    method: "GET" | "PUT",
    token?: string,
    payload?: object | string,
    remoteAddress = `10.76.0.${address++}`,
  ) =>
    app.inject({
      method,
      url: "/me/agent",
      remoteAddress,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(typeof payload === "string"
          ? { "content-type": "application/json" }
          : {}),
      },
      payload,
    });
  try {
    for (const method of ["GET", "PUT"] as const) {
      assert.equal((await call(method)).statusCode, 401);
      assert.equal((await call(method, "expired")).statusCode, 401);
      assert.equal((await call(method, "disabled")).statusCode, 403);
      assert.equal((await call(method, "ok_fixture")).statusCode, 403);
    }
    assert.equal((await call("PUT", "session", "{")).statusCode, 400);
    assert.equal(
      (
        await call("PUT", "session", {
          name: "Orb",
          character: { body: "unknown" },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (await call("PUT", "session", { name: "Orb", user_id: otherId }))
        .statusCode,
      422,
    );
    assert.deepEqual(
      (await call("GET", "session")).json().character,
      DEFAULT_CHARACTER,
    );
    const appearance = {
      ...DEFAULT_CHARACTER,
      body: "spark",
      accessory: "glasses",
      presence: "static",
    };
    const saved = await call("PUT", "session", {
      name: "Nova",
      persona: "Direct",
      character: appearance,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().character, appearance);
    assert.deepEqual(
      (await call("GET", "session")).json().character,
      appearance,
    );
    assert.deepEqual(
      (await call("GET", "other")).json().character,
      DEFAULT_CHARACTER,
    );
    assert.deepEqual(
      (await call("PUT", "session", { name: "Renamed", persona: "" })).json()
        .character,
      appearance,
    );
    failRead = true;
    assert.equal((await call("GET", "session")).statusCode, 500);
    failRead = false;
    for (let i = 0; i < 30; i++)
      await call("PUT", undefined, undefined, "10.77.0.1");
    const limited = await call("PUT", undefined, undefined, "10.77.0.1");
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers["retry-after"]);
  } finally {
    await app.close();
    mock.restoreAll();
  }
});

test("SDK settings notifications update mounted clients only after successful writes in the same session", async () => {
  let token = "one";
  let reject = false;
  let switchAccount = false;
  const saved = {
    name: "Nova",
    persona: "",
    character: { ...DEFAULT_CHARACTER },
    named_at: null,
    updated_at: new Date().toISOString(),
  };
  const client = new OrbynClient({
    baseUrl: "http://fixture.invalid",
    getToken: () => token,
    fetch: async () => {
      if (switchAccount) token = "two";
      return new Response(
        JSON.stringify(reject ? { error: "fixture" } : saved),
        {
          status: reject ? 422 : 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });
  let notifications = 0;
  const unsubscribe = client.onAgentSettings((settings) => {
    notifications++;
    assert.deepEqual(settings, saved);
  });
  await client.updateAgentSettings({ name: "Nova" });
  assert.equal(notifications, 1);
  reject = true;
  await assert.rejects(client.updateAgentSettings({ name: "Nova" }));
  assert.equal(notifications, 1);
  reject = false;
  switchAccount = true;
  await client.updateAgentSettings({ name: "Nova" });
  assert.equal(notifications, 1);
  unsubscribe();
  switchAccount = false;
  await client.updateAgentSettings({ name: "Nova" });
  assert.equal(notifications, 1);
});
