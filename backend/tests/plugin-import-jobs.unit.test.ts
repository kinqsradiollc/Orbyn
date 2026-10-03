import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readPluginImportEvents,
  trackPluginImport,
} from "../src/modules/plugin/import-jobs.js";
import type { Principal } from "../src/capabilities/policy.js";
import type { Queryable } from "../src/db/pool.js";

const owner = "00000000-0000-4000-8000-000000000001";
const grant = "00000000-0000-4000-8000-000000000002";
const importId = "00000000-0000-4000-8000-000000000003";
const jobId = "00000000-0000-4000-8000-000000000004";
const docId = "00000000-0000-4000-8000-000000000005";
const p = (): Principal => ({
  via: "plugin",
  user: { id: owner, name: "Owner", role: "member" },
  grant_id: grant,
  client: { id: "client", name: "Client" },
  access: "write",
  personal: true,
  team_ids: [],
  teams: [],
  toolsets: ["files"],
  flags: {
    readonly: false,
    notify_teammates: false,
    hide_outside_content: false,
  },
  trust: { level: "full", spaces: {}, acts_alone: [] },
});
const key = Buffer.alloc(32, 7);
const resource = "https://plugin.example.test/api";
function fixture({
  ready = false,
  visible = true,
  retained = true,
  inserted = true,
} = {}) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const job = {
    id: jobId,
    import_id: importId,
    source_project_id: null,
    expires_at: new Date(Date.now() + 60_000),
  };
  const producer = {
    id: importId,
    project_id: null,
    doc_id: ready ? docId : null,
    status: ready ? "ready" : "waiting",
  };
  const db = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      let rows: unknown[] = [];
      if (sql.includes("SELECT id,project_id,doc_id,status FROM imports"))
        rows = [producer];
      else if (sql.includes("SELECT project_id FROM docs"))
        rows = [{ project_id: null }];
      else if (sql.startsWith("SELECT 1 WHERE")) rows = visible ? [{}] : [];
      else if (sql.includes("SELECT sequence,status,created_at"))
        rows = [{ sequence: "7", status: "waiting", created_at: new Date() }];
      else if (sql.includes("INSERT INTO plugin_import_jobs"))
        rows = inserted ? [job] : [];
      else if (sql.includes("FROM plugin_import_jobs"))
        rows = retained ? [job] : [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as Queryable;
  return { db, calls };
}

test("tracking uses the caller owner/grant and records one initial status event", async () => {
  const f = fixture();
  assert.equal((await trackPluginImport(f.db, p(), importId)).id, jobId);
  const insert = f.calls.find((c) =>
    c.sql.includes("INSERT INTO plugin_import_jobs"),
  )!;
  assert.deepEqual(insert.values, [owner, grant, importId, null]);
  assert.equal(
    f.calls.filter((c) => c.sql.includes("INSERT INTO plugin_import_events"))
      .length,
    1,
  );
  const replay = fixture({ inserted: false });
  await trackPluginImport(replay.db, p(), importId);
  assert.equal(
    replay.calls.filter((c) =>
      c.sql.includes("INSERT INTO plugin_import_events"),
    ).length,
    0,
  );
});

test("event reads bind account/grant and preserve producer-before-job lock order", async () => {
  const f = fixture();
  const page = await readPluginImportEvents(f.db, p(), jobId, resource, key);
  assert.equal(page.events.length, 1);
  assert.equal(page.status, "waiting");
  assert.equal(page.has_more, false);
  assert.ok(!("result" in page));
  assert.deepEqual(f.calls[0].values, [jobId, owner, grant]);
  assert.ok(
    f.calls.findIndex((c) => c.sql.includes("FROM imports")) <
      f.calls.findIndex(
        (c) =>
          c.sql.includes("FROM plugin_import_jobs") &&
          c.sql.includes("FOR SHARE"),
      ),
  );
  const resumed = fixture();
  await readPluginImportEvents(
    resumed.db,
    p(),
    jobId,
    resource,
    key,
    page.cursor,
  );
  assert.deepEqual(
    resumed.calls.find((c) =>
      c.sql.includes("SELECT sequence,status,created_at"),
    )!.values,
    [jobId, 7],
  );
});

test("completed results require current document visibility before events or links are returned", async () => {
  const allowed = fixture({ ready: true });
  const page = await readPluginImportEvents(
    allowed.db,
    p(),
    jobId,
    resource,
    key,
  );
  assert.equal(page.result?.id, `doc:${docId}`);
  assert.ok(
    allowed.calls.some(
      (c) =>
        c.sql.startsWith("SELECT 1 WHERE") &&
        c.sql.includes("assistant_off") &&
        c.sql.includes("deleted_at IS NULL"),
    ),
  );
  const denied = fixture({ ready: true, visible: false });
  await assert.rejects(
    readPluginImportEvents(denied.db, p(), jobId, resource, key),
    /unavailable/,
  );
  assert.equal(
    denied.calls.filter((c) =>
      c.sql.includes("SELECT sequence,status,created_at"),
    ).length,
    0,
  );
});

test("unavailable grants, owners, original personal scope and malformed ids reveal no job data", async () => {
  const missing = fixture({ retained: false });
  await assert.rejects(
    readPluginImportEvents(missing.db, p(), jobId, resource, key),
    /unavailable/,
  );
  assert.equal(missing.calls.length, 1);
  const personal = fixture();
  await assert.rejects(
    readPluginImportEvents(
      personal.db,
      { ...p(), personal: false },
      jobId,
      resource,
      key,
    ),
    /unavailable/,
  );
  assert.ok(
    !personal.calls.some((c) =>
      c.sql.includes("SELECT sequence,status,created_at"),
    ),
  );
  for (const principal of [
    { ...p(), via: "session" as const },
    { ...p(), access: "read" as const },
    { ...p(), toolsets: [] },
  ]) {
    const f = fixture();
    await assert.rejects(
      readPluginImportEvents(f.db, principal, jobId, resource, key),
      /not available/,
    );
    assert.equal(f.calls.length, 0);
  }
  await assert.rejects(
    readPluginImportEvents(fixture().db, p(), "bad", resource, key),
    /unavailable/,
  );
});
