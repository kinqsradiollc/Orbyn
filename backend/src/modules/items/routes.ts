import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  itemData,
  itemsQuery,
  progressUpdateInput,
  skipOccurrenceInput,
  stepInput,
  stepUpdate,
  timeLogInput,
  type ItemDetail,
} from "@orbyn/core";
import type { QueryResult } from "pg";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam, VISIBLE_ITEMS } from "../../lib/teams.js";
import {
  ITEM_COLUMNS,
  ITEM_FROM,
  lockItem,
  mutate,
  recomputeProgress,
  requireItemAccess,
  type ItemRow,
} from "./service.js";

type Run = (text: string, values: unknown[]) => Promise<QueryResult>;
/** Runs queries on a transaction client. */
const via =
  (db: Db): Run =>
  (text, values) =>
    db.query(text, values);

/** A task with its checklist and its 100 most recent updates, newest first. */
export async function itemDetail(
  id: string,
  run: Run = (text, values) => pool.query(text, values),
): Promise<ItemDetail> {
  const item = (
    await run(`SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE i.id = $1`, [id])
  ).rows[0];
  if (!item) fail(404, "Item not found");
  const steps = (
    await run(
      "SELECT id, item_id, title, done, position, created_at FROM item_steps WHERE item_id=$1 ORDER BY position, created_at, id",
      [id],
    )
  ).rows;
  const updates = (
    await run(
      `SELECT u.id, u.item_id, u.user_id, coalesce(a.name, 'Former member') AS author_name,
              u.body, u.status, u.progress, u.created_at
       FROM item_updates u LEFT JOIN users a ON a.id = u.user_id
       WHERE u.item_id = $1 ORDER BY u.created_at DESC, u.id DESC LIMIT 100`,
      [id],
    )
  ).rows;
  return { ...item, steps, updates };
}

export async function itemRoutes(app: FastifyInstance) {
  app.get("/items", async (r) => {
    const u = await authenticate(r);
    const q = itemsQuery.parse(r.query);
    if (q.team_id) await requireTeam(q.team_id, u, "items:read");
    const words = (q.q ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    return (
      await reader(r.headers).query(
        `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM}
         WHERE ${VISIBLE_ITEMS} AND ($4::uuid IS NULL OR i.team_id=$4)
           AND ($5::uuid IS NULL OR i.list_id=$5)
           AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id=i.id AND x.tag_id=$6))
           AND ($7::uuid IS NULL OR i.assignee_id=$7)
           AND NOT EXISTS (SELECT 1 FROM unnest($8::text[]) w WHERE (i.title || ' ' || i.notes) NOT ILIKE w)
         ORDER BY i.created_at DESC, i.id LIMIT $2 OFFSET $3`,
        [
          u.id,
          q.limit,
          q.offset,
          q.team_id ?? null,
          q.list_id ?? null,
          q.tag_id ?? null,
          q.assignee_id ?? null,
          words,
        ],
      )
    ).rows;
  });

  // Minutes worked with the focus timer. Like checklist steps, this doesn't
  // change the edit version, so an open editor never conflicts with it.
  app.post("/items/:id/time", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = timeLogInput.parse(r.body);
    return transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      await db.query(
        "UPDATE items SET spent_minutes = spent_minutes + $1, updated_at = now() WHERE id = $2",
        [d.minutes, id],
      );
      return itemDetail(id, via(db));
    });
  });

  // Remove one occurrence from a repeating item ("delete this one").
  app.post("/items/:id/skip", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = skipOccurrenceInput.parse(r.body);
    return transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      if (!item.rrule)
        fail(409, "Only repeating items have occurrences to skip.");
      await db.query(
        `UPDATE items SET exdates = array_append(exdates, $1::timestamptz),
           version = version + 1, updated_at = now()
         WHERE id = $2 AND NOT ($1::timestamptz = ANY (exdates))`,
        [d.occurrence, id],
      );
      return itemDetail(id, via(db));
    });
  });

  app.get("/items/:id", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const item = (
      await db.query<ItemRow>("SELECT * FROM items WHERE id=$1", [id])
    ).rows[0];
    if (!item) fail(404, "Item not found");
    await requireItemAccess(u, item, "items:read");
    return itemDetail(id, (text, values) => db.query(text, values));
  });

  app.post("/items", async (r, reply) => {
    const u = await authenticate(r);
    const data = itemData.parse(r.body);
    const item = await transaction((db) =>
      mutate(db, u, { operation: "create", data }),
    );
    reply.code(201);
    return item;
  });

  app.put("/items/:id", async (r) => {
    const u = await authenticate(r);
    const { version, ...raw } = z
      .object({ version: z.number().int().positive() })
      .passthrough()
      .parse(r.body);
    const data = itemData.parse(raw);
    return transaction((db) =>
      mutate(db, u, {
        operation: "update",
        data,
        item_id: idParam(r),
        version,
      }),
    );
  });

  app.delete("/items/:id", async (r, reply) => {
    const u = await authenticate(r);
    const q = z
      .object({ version: z.coerce.number().int().positive() })
      .parse(r.query);
    await transaction((db) =>
      mutate(db, u, {
        operation: "delete",
        item_id: idParam(r),
        version: q.version,
      }),
    );
    return reply.code(204).send();
  });

  // Checklist steps. These change progress but not the item's edit version,
  // so an open editor never hits a conflict because someone ticked a step.
  app.post("/items/:id/steps", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = stepInput.parse(r.body);
    const detail = await transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      await db.query(
        `INSERT INTO item_steps(item_id, title, position)
         VALUES($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM item_steps WHERE item_id=$1))`,
        [id, d.title],
      );
      await recomputeProgress(db, id);
      return itemDetail(id, via(db));
    });
    reply.code(201);
    return detail;
  });

  app.put("/items/:id/steps/:stepId", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const stepId = idParam(r, "stepId");
    const d = stepUpdate.parse(r.body);
    return transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      const updated = await db.query(
        "UPDATE item_steps SET title=coalesce($1, title), done=coalesce($2, done) WHERE id=$3 AND item_id=$4",
        [d.title ?? null, d.done ?? null, stepId, id],
      );
      if (!updated.rowCount) fail(404, "Step not found");
      await recomputeProgress(db, id);
      return itemDetail(id, via(db));
    });
  });

  app.delete("/items/:id/steps/:stepId", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const stepId = idParam(r, "stepId");
    return transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      const deleted = await db.query(
        "DELETE FROM item_steps WHERE id=$1 AND item_id=$2",
        [stepId, id],
      );
      if (!deleted.rowCount) fail(404, "Step not found");
      await recomputeProgress(db, id);
      return itemDetail(id, via(db));
    });
  });

  // Progress updates: a note in the task's timeline that can also change its
  // status or, when it has no checklist, its progress.
  app.post("/items/:id/updates", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = progressUpdateInput.parse(r.body);
    const detail = await transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      if (d.progress !== undefined) {
        const steps = (
          await db.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM item_steps WHERE item_id=$1",
            [id],
          )
        ).rows[0].n;
        if (steps > 0) fail(409, "This task's progress follows its checklist.");
      }
      await db.query(
        "INSERT INTO item_updates(item_id, user_id, body, status, progress) VALUES($1,$2,$3,$4,$5)",
        [id, u.id, d.body, d.status ?? null, d.progress ?? null],
      );
      await db.query(
        "UPDATE items SET updates_count = updates_count + 1, last_update_at = now() WHERE id=$1",
        [id],
      );
      if (d.status)
        await db.query(
          `UPDATE items SET
             status = $1::text,
             progress = CASE WHEN $1::text = 'done' THEN 100 ELSE progress END,
             reminder_version = CASE WHEN status = 'done' AND $1::text <> 'done'
               THEN reminder_version + 1 ELSE reminder_version END,
             updated_at = now()
           WHERE id = $2`,
          [d.status, id],
        );
      if (d.progress !== undefined)
        await db.query(
          `UPDATE items SET
             progress = $1::int,
             status = CASE WHEN status = 'todo' AND $1::int > 0 THEN 'in_progress' ELSE status END,
             updated_at = now()
           WHERE id = $2`,
          [d.progress, id],
        );
      return itemDetail(id, via(db));
    });
    reply.code(201);
    return detail;
  });
}
