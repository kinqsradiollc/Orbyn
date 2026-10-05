import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agendaPrivatePermissionInput } from "@orbyn/core";
import {
  captureAgendaScheduleGrant,
  assertAgendaScheduleGrant,
} from "../src/modules/auth/agenda-private-permission.js";
import type { Db } from "../src/db/pool.js";
import { EXCLUDED } from "../src/capabilities/exclusions.js";

function fixture() {
  const owner = randomUUID();
  const choice = {
    primary: "chatgpt",
    connection_id: randomUUID(),
    executor_id: randomUUID(),
    fallback_to_default: false,
    version: 1,
  };
  const row = {
    id: randomUUID(),
    enabled: true,
    version: "1",
    provider_choice: { ...choice },
    model: "chosen-model",
    preference_version: "1",
  };
  const selected = { model: "chosen-model", version: "1" };
  let permitted = true,
    present = true;
  const db = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.startsWith("SELECT id FROM users")) {
        assert.equal(params[0], owner);
        return { rowCount: permitted ? 1 : 0 };
      }
      if (sql.includes("FROM agenda_private_permissions")) {
        assert.equal(params[0], owner);
        return { rows: present ? [row] : [] };
      }
      if (sql.includes("FROM user_ai_provider_choice")) {
        assert.equal(params[0], owner);
        return { rows: [choice] };
      }
      if (sql.includes("FROM chatgpt_model_preferences"))
        return { rows: [selected] };
      throw new Error(`Unexpected grant query: ${sql}`);
    },
  } as unknown as Db;
  return {
    owner,
    choice,
    row,
    selected,
    db,
    account: (allowed: boolean) => {
      permitted = allowed;
    },
    permission: (exists: boolean) => {
      present = exists;
    },
  };
}

test("scheduled Agenda has no implied permission from account/session activity", async () => {
  const f = fixture();
  f.permission(false);
  assert.equal(await captureAgendaScheduleGrant(f.db, f.owner), null);
});
test("scheduled Agenda permission captures the reviewed choice/model and supports explicit revocation", async () => {
  const f = fixture();
  const grant = await captureAgendaScheduleGrant(f.db, f.owner);
  assert.ok(grant);
  assert.equal(grant.model, "chosen-model");
  await assertAgendaScheduleGrant(f.db, f.owner, grant);
  f.row.enabled = false;
  await assert.rejects(
    assertAgendaScheduleGrant(f.db, f.owner, grant),
    (e: any) => e.statusCode === 409,
  );
});
test("re-enable cannot restore an old scheduled permission version", async () => {
  const f = fixture();
  const grant = await captureAgendaScheduleGrant(f.db, f.owner);
  assert.ok(grant);
  f.row.version = "3";
  await assert.rejects(assertAgendaScheduleGrant(f.db, f.owner, grant));
});

test("stored JSON object key ordering does not invalidate an otherwise identical reviewed grant", async () => {
  const f = fixture();
  f.row.provider_choice = {
    version: f.choice.version,
    fallback_to_default: f.choice.fallback_to_default,
    executor_id: f.choice.executor_id,
    connection_id: f.choice.connection_id,
    primary: f.choice.primary,
  };
  const grant = await captureAgendaScheduleGrant(f.db, f.owner);
  assert.ok(grant);
  await assertAgendaScheduleGrant(f.db, f.owner, grant);
});
test("changes to account/device/fallback choice or model preferences invalidate scheduling authority", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.choice.version++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.choice.connection_id = randomUUID();
    },
    (f: ReturnType<typeof fixture>) => {
      f.choice.executor_id = randomUUID();
    },
    (f: ReturnType<typeof fixture>) => {
      f.choice.fallback_to_default = true;
    },
    (f: ReturnType<typeof fixture>) => {
      f.selected.version = "2";
    },
    (f: ReturnType<typeof fixture>) => {
      f.selected.model = "another-model";
    },
    (f: ReturnType<typeof fixture>) => {
      f.account(false);
    },
  ]) {
    const f = fixture();
    const grant = await captureAgendaScheduleGrant(f.db, f.owner);
    assert.ok(grant);
    mutate(f);
    assert.equal(await captureAgendaScheduleGrant(f.db, f.owner), null);
    await assert.rejects(assertAgendaScheduleGrant(f.db, f.owner, grant));
  }
});
test("permission writes require explicit versions and reject unrelated scopes/fields", () => {
  const input = {
    enabled: true,
    expected_version: 0,
    expected_provider_choice_version: 1,
    expected_preference_version: 1,
  };
  assert.ok(agendaPrivatePermissionInput.safeParse(input).success);
  assert.equal(
    agendaPrivatePermissionInput.safeParse({ ...input, scope: "all_ai" })
      .success,
    false,
  );
  assert.equal(
    agendaPrivatePermissionInput.safeParse({ enabled: true }).success,
    false,
  );
});

test("scheduled plan permission is a first-party credential control, never an MCP capability", () => {
  assert.equal(EXCLUDED["GET /ai/agenda/private-permission"], "credentials");
  assert.equal(EXCLUDED["PUT /ai/agenda/private-permission"], "credentials");
});
