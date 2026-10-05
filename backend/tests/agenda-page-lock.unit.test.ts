import { test } from "node:test";
import assert from "node:assert/strict";
import { lockAgendaSourcePage } from "../src/lib/agenda-source-fence.js";

test("Agenda page lock adds NOWAIT and releases its savepoint", async () => {
  const queries: string[] = [],
    rows = [{ id: "page" }];
  const db = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows };
    },
  };
  assert.deepEqual(
    (await lockAgendaSourcePage(db as any, "SELECT id FROM docs FOR SHARE", []))
      .rows,
    rows,
  );
  assert.deepEqual(queries, [
    "SAVEPOINT agenda_source_page_lock",
    "SELECT id FROM docs FOR SHARE NOWAIT",
    "RELEASE SAVEPOINT agenda_source_page_lock",
  ]);
});
for (const code of ["55P03", "40P01"]) {
  test(`Agenda page lock restores its savepoint before reporting ${code} as conflict`, async () => {
    const queries: string[] = [];
    const db = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.endsWith(" NOWAIT"))
          throw Object.assign(new Error("lock conflict"), { code });
        return { rows: [] };
      },
    };
    await assert.rejects(
      lockAgendaSourcePage(db as any, "SELECT id FROM docs FOR SHARE", []),
      (error: any) => error.statusCode === 409,
    );
    assert.deepEqual(queries, [
      "SAVEPOINT agenda_source_page_lock",
      "SELECT id FROM docs FOR SHARE NOWAIT",
      "ROLLBACK TO SAVEPOINT agenda_source_page_lock",
      "RELEASE SAVEPOINT agenda_source_page_lock",
    ]);
  });
}
test("An unrelated page query error remains available to the outer transaction rollback", async () => {
  const error = Object.assign(new Error("broken query"), { code: "42601" });
  const db = {
    query: async (sql: string) => {
      if (sql.endsWith(" NOWAIT")) throw error;
      return { rows: [] };
    },
  };
  await assert.rejects(
    lockAgendaSourcePage(db as any, "SELECT broken FOR SHARE", []),
    (actual) => actual === error,
  );
});
