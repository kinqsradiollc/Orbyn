import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { listNotifications } from "../src/modules/notifications/service.js";
import type { Queryable } from "../src/db/pool.js";
const cursorAt = "2026-10-04 00:00:00.000123+00";
const notice = (kind = "at_risk", ref: string | null = null) => ({
  id: randomUUID(),
  title: "Deadline",
  body: "Soon",
  read: false,
  created_at: new Date("2026-10-04T00:00:00Z"),
  kind,
  ref,
  item_id: null,
  via_agent: null,
});
test("ordinary planner notices avoid all assistant source query branches", async () => {
  const row = notice();
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [{ ...row, cursor_at: cursorAt }] };
    },
  } as unknown as Queryable;
  assert.deepEqual(await listNotifications(db, randomUUID()), [row]);
  assert.equal(calls.length, 1);
  assert.ok(Buffer.byteLength(calls[0]) < 6000);
  assert.doesNotMatch(
    calls[0],
    /assistant_chat_sources|assistant_job_sources|assistant_nudges/,
  );
});
test("hidden source notices do not consume the visible limit and equal timestamps use an ID cursor", async () => {
  const hidden = Array.from({ length: 100 }, () =>
    notice("review", "proposal:missing"),
  );
  const final = notice();
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    query: async (sql: string, values: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("n.id=ANY")) return { rows: [] };
      return {
        rows: (calls.length === 1 ? hidden : [final]).map((n) => ({
          ...n,
          cursor_at: cursorAt,
        })),
      };
    },
  } as unknown as Queryable;
  assert.deepEqual(await listNotifications(db, randomUUID(), 1), [final]);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].values[2], cursorAt);
  assert.equal(calls[2].values[3], hidden[99].id);
  assert.match(calls[2].sql, /ORDER BY n.created_at DESC, n.id DESC/);
});
test("malformed chat references and source-bound reviews/nudges fail closed independently", async () => {
  const rows = [
    notice("assistant", "chat"),
    notice("review", "proposal:missing"),
    notice("reminder_nudge"),
  ];
  const guards: string[] = [];
  const db = {
    query: async (sql: string) => {
      if (sql.includes("n.id=ANY")) {
        guards.push(sql);
        return { rows: [] };
      }
      return { rows: rows.map((n) => ({ ...n, cursor_at: cursorAt })) };
    },
  } as unknown as Queryable;
  assert.deepEqual(await listNotifications(db, randomUUID()), []);
  assert.equal(guards.length, 3);
  assert.match(guards[0], /assistant_job_sources/);
  assert.match(guards[1], /assistant_guard/);
  assert.match(guards[2], /assistant_nudges/);
});
