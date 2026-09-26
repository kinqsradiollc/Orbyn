import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  editScopeQuery,
  fail,
  habitInput,
  isClosed,
  itemData,
  itemPositionInput,
  itemsQuery,
  parseQuickAdd,
  priorityScore,
  deadlineOf,
  planningDeadline,
  progressUpdateInput,
  quickAddInput,
  skipOccurrenceInput,
  stepInput,
  stepUpdate,
  timeLogInput,
  type ItemDetail,
  type ItemContext,
  type DocBlock,
  quoteOf,
  type ItemSort,
  type ItemSyncPage,
  type OccurrenceChanges,
  type QuickAddCreated,
  type QuickAddList,
  type QuickAddMember,
  type QuickAddResult,
} from "@orbyn/core";
import type { QueryResult } from "pg";
import { pool, reader, transaction, type Db } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam, VISIBLE_ITEMS } from "../../lib/teams.js";
import { loadPrefs } from "../planner/calendar.js";
import { createHabit } from "../planner/habits.js";
import { largestFreeMinutes } from "../planner/plans.js";
import {
  deleteOccurrences,
  editFollowing,
  editOccurrence,
  skipOccurrence,
} from "./occurrences.js";
import {
  ITEM_COLUMNS,
  ITEM_FROM,
  loadItem,
  lockItem,
  moveItem,
  mutate,
  recomputeProgress,
  requireItemAccess,
  setItemStatus,
  type ItemRow,
} from "./service.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";

type Run = (text: string, values: unknown[]) => Promise<QueryResult>;
/** Runs queries on a transaction client. */
const via =
  (db: Db): Run =>
  (text, values) =>
    db.query(text, values);

/**
 * A task with its checklist and its 100 most recent updates, newest first;
 * an event with the people invited and their answers; a repeating item with
 * the occurrences changed on their own.
 */
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
  const attendees = (
    await run(
      `SELECT id, email, name, status, responded_at FROM item_attendees
       WHERE item_id = $1 ORDER BY created_at, email`,
      [id],
    )
  ).rows;
  const overrides = (
    await run(
      "SELECT occurrence, data FROM item_overrides WHERE item_id = $1 ORDER BY occurrence",
      [id],
    )
  ).rows.map((o: { occurrence: Date; data: OccurrenceChanges }) => ({
    ...o.data,
    occurrence: o.occurrence.toISOString(),
  }));
  const links = (
    await run(
      "SELECT id, url, title, position FROM item_links WHERE item_id = $1 ORDER BY position, id",
      [id],
    )
  ).rows;
  return { ...item, steps, updates, attendees, overrides, links };
}

/** ORDER BY for each list order but the score, which is worked out in code. */
const ORDER: Record<Exclude<ItemSort, "score">, string> = {
  newest: "i.created_at DESC, i.id",
  created: "i.created_at, i.id",
  due: "i.due_at NULLS LAST, i.created_at DESC, i.id",
  priority:
    "CASE i.priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, i.due_at NULLS LAST, i.id",
  estimate: "i.estimate_minutes NULLS LAST, i.due_at NULLS LAST, i.id",
  title: "lower(i.title), i.id",
  position: "i.position, i.created_at, i.id",
};

/**
 * A place in the change history: a time in microseconds since 1970 and an
 * id, so items changed in the same microsecond keep a stable order.
 */
type SyncPoint = { us: bigint; id: string };
const LAST_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const encodeCursor = (p: SyncPoint) =>
  Buffer.from(`${p.us}.${p.id}`).toString("base64url");
function decodeCursor(cursor: string): SyncPoint {
  const [us, id] = Buffer.from(cursor, "base64url").toString().split(".");
  if (!/^\d{1,20}$/.test(us ?? "") || !z.uuid().safeParse(id).success)
    fail(422, "That cursor isn't valid. Start again with updated_after.");
  return { us: BigInt(us), id };
}
/** A row's place in the change history, from Postgres to the microsecond. */
const SYNC_US = (column: string) =>
  `(extract(epoch FROM ${column}) * 1000000)::bigint::text AS sync_us`;
/** "Changed after this point", on a time column and an id column. */
const AFTER = (time: string, id: string, us: string, after: string) =>
  `(${time}, ${id}) > (timestamptz 'epoch' + ${us}::bigint * interval '1 microsecond', ${after}::uuid)`;
/** Most items a score-sorted list ranks before taking the page asked for. */
const MAX_SCORED = 5000;

type ScoreRow = {
  id: string;
  kind: string;
  status: string;
  priority: "low" | "medium" | "high";
  due_at: Date | string | null;
  end_at: Date | string | null;
  all_day: boolean;
  timezone: string;
  estimate_minutes: number | null;
  spent_minutes: number;
  created_at: Date | string;
  /** Its project's deadline: a latest date the score counts to. */
  project_deadline?: Date | string | null;
};

const isoOrNull = (v: Date | string | null) =>
  v ? new Date(v).toISOString() : null;

/**
 * The priority score of an open task; null for events and closed tasks.
 * Its urgency counts to the task's deadline (`deadlineOf`), or its project's
 * when that comes first, as the planner does.
 */
const scoreOf = (i: ScoreRow, now: Date, slot: number) => {
  if (i.kind !== "task" || isClosed(i.status)) return null;
  const task = {
    ...i,
    due_at: isoOrNull(i.due_at),
    end_at: isoOrNull(i.end_at),
  };
  return priorityScore(
    {
      ...task,
      deadline_at: planningDeadline(
        deadlineOf(task),
        isoOrNull(i.project_deadline ?? null),
      ),
    },
    now,
    slot,
  );
};

export async function itemRoutes(app: FastifyInstance) {
  app.get("/items", async (r) => {
    const u = await authenticate(r);
    const q = itemsQuery.parse(r.query);
    if (q.team_id) await requireTeam(q.team_id, u, "items:read");
    const db = reader(r.headers);
    const words = (q.q ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const where = `${VISIBLE_ITEMS} AND ($2::uuid IS NULL OR i.team_id=$2)
           AND ($3::uuid IS NULL OR i.list_id=$3)
           AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM item_tags x WHERE x.item_id=i.id AND x.tag_id=$4))
           AND ($5::uuid IS NULL OR i.assignee_id=$5)
           AND NOT EXISTS (SELECT 1 FROM unnest($6::text[]) w WHERE (i.title || ' ' || i.notes) NOT ILIKE w)
           AND ($7::uuid IS NULL OR i.parent_id=$7)`;
    const filters = [
      u.id,
      q.team_id ?? null,
      q.list_id ?? null,
      q.tag_id ?? null,
      q.assignee_id ?? null,
      words,
      q.parent_id ?? null,
    ];
    const now = new Date();
    let rows: (ScoreRow & Record<string, unknown>)[];
    let slot: number | null = null;
    const withScores = async (list: typeof rows) => {
      // The score's size term needs today's largest free slot; only look it
      // up when there's an open task to score.
      if (
        slot === null &&
        list.some((i) => i.kind === "task" && !isClosed(i.status))
      )
        slot = await largestFreeMinutes(db, u.id, now);
      return list.map((i) => ({ ...i, score: scoreOf(i, now, slot ?? 0) }));
    };

    // Incremental sync: what changed after a point, oldest change first, with
    // deleted items as tombstones, and a cursor to carry on from.
    if (q.updated_after || q.cursor) {
      const from: SyncPoint = q.cursor
        ? decodeCursor(q.cursor)
        : { us: BigInt(Date.parse(q.updated_after!)) * 1000n, id: LAST_ID };
      const changed = (
        await db.query(
          `SELECT ${ITEM_COLUMNS}, ${SYNC_US("i.updated_at")} FROM ${ITEM_FROM}
           WHERE ${where} AND ${AFTER("i.updated_at", "i.id", "$8", "$9")}
           ORDER BY i.updated_at, i.id LIMIT $10`,
          [...filters, from.us.toString(), from.id, q.limit + 1],
        )
      ).rows as (ScoreRow & { sync_us: string } & Record<string, unknown>)[];
      const deleted = q.include_deleted
        ? (
            await db.query<{ id: string; deleted_at: Date; sync_us: string }>(
              `SELECT d.item_id AS id, d.deleted_at, ${SYNC_US("d.deleted_at")}
               FROM deleted_items d
               WHERE ((d.team_id IS NULL AND d.user_id = $1)
                   OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))
                 AND ($2::uuid IS NULL OR d.team_id = $2)
                 AND ${AFTER("d.deleted_at", "d.item_id", "$3", "$4")}
               ORDER BY d.deleted_at, d.item_id LIMIT $5`,
              [
                u.id,
                q.team_id ?? null,
                from.us.toString(),
                from.id,
                q.limit + 1,
              ],
            )
          ).rows
        : [];
      // One stream in change order; a page takes the first `limit` of it.
      const stream = [
        ...changed.map(({ sync_us, ...item }) => ({
          at: BigInt(sync_us),
          id: item.id,
          item,
        })),
        ...deleted.map((d) => ({
          at: BigInt(d.sync_us),
          id: d.id,
          gone: { id: d.id, deleted_at: new Date(d.deleted_at).toISOString() },
        })),
      ].sort((a, b) =>
        a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1,
      );
      const page = stream.slice(0, q.limit);
      const last = page.at(-1);
      return {
        items: await withScores(
          page.flatMap((p) => ("item" in p ? [p.item] : [])),
        ),
        deleted: page.flatMap((p) => ("gone" in p ? [p.gone] : [])),
        next_cursor: encodeCursor(last ? { us: last.at, id: last.id } : from),
        has_more: stream.length > q.limit,
      } as unknown as ItemSyncPage;
    }

    if (q.sort === "score") {
      // Rank every match by score, then load the page asked for.
      const ranked = (
        await db.query<ScoreRow>(
          `SELECT i.id, i.kind, i.status, i.priority, i.due_at, i.end_at, i.all_day,
                  i.timezone, i.estimate_minutes, i.spent_minutes, i.created_at,
                  (SELECT p.deadline FROM projects p WHERE p.id = i.project_id) AS project_deadline
           FROM items i WHERE ${where} LIMIT ${MAX_SCORED}`,
          filters,
        )
      ).rows;
      slot = await largestFreeMinutes(db, u.id, now);
      const score = new Map(ranked.map((i) => [i.id, scoreOf(i, now, slot!)]));
      const due = (i: ScoreRow) =>
        i.due_at ? new Date(i.due_at).getTime() : Infinity;
      const ids = ranked
        .sort(
          (a, b) =>
            (score.get(b.id) ?? -Infinity) - (score.get(a.id) ?? -Infinity) ||
            due(a) - due(b) ||
            new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime() ||
            a.id.localeCompare(b.id),
        )
        .slice(q.offset, q.offset + q.limit)
        .map((i) => i.id);
      const found = (
        await db.query(
          `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE i.id = ANY ($1::uuid[])`,
          [ids],
        )
      ).rows;
      const byId = new Map(found.map((i) => [i.id as string, i]));
      rows = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    } else
      rows = (
        await db.query(
          `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE ${where}
           ORDER BY ${ORDER[q.sort]} LIMIT $8 OFFSET $9`,
          [...filters, q.limit, q.offset],
        )
      ).rows;
    return withScores(rows);
  });

  // Manual order. Like checklist steps, this doesn't change the edit
  // version, so an open editor never conflicts because of a drag.
  app.put("/items/:id/position", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const d = itemPositionInput.parse(r.body);
    return transaction(async (db) => {
      const item = await lockItem(db, id);
      await requireItemAccess(u, item, "items:write", db);
      await moveItem(db, item, d);
      return loadItem(db, id);
    });
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
      await skipOccurrence(db, u, id, d.occurrence);
      return itemDetail(id, via(db));
    });
  });

  // Quick add: one line of text, parsed without AI, into a new item.
  app.post(
    "/items/quick",
    async (r, reply): Promise<QuickAddResult | QuickAddCreated> => {
      const u = await authenticate(r);
      const d = quickAddInput.parse(r.body);
      const timeZone = d.timezone ?? (await loadPrefs(pool, u.id)).timezone;
      const mine = `(x.team_id IS NULL AND x.user_id = $1)
        OR x.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)`;
      const [lists, tags, members] = await Promise.all([
        pool.query<QuickAddList>(
          `SELECT x.id, x.name, x.team_id FROM lists x WHERE ${mine}`,
          [u.id],
        ),
        pool.query<QuickAddList>(
          `SELECT x.id, x.name, x.team_id FROM tags x WHERE ${mine}`,
          [u.id],
        ),
        // Everyone who shares a team with you, and which of your teams.
        pool.query<QuickAddMember>(
          `SELECT p.id AS user_id, p.name, p.email, array_agg(m.team_id) AS team_ids
           FROM team_members m JOIN users p ON p.id = m.user_id AND NOT p.disabled
           WHERE m.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
           GROUP BY p.id, p.name, p.email`,
          [u.id],
        ),
      ]);
      const parsed = parseQuickAdd(d.text, {
        timeZone,
        lists: lists.rows,
        tags: tags.rows,
        members: members.rows,
        selfId: u.id,
      });
      if (!parsed.input.title)
        fail(422, 'Add a title, such as "Lunch with Sam tomorrow 1pm".');
      if (d.preview) return parsed;
      if (parsed.habit) {
        const habit = await createHabit(
          pool,
          u.id,
          habitInput.parse(parsed.habit),
        );
        reply.code(201);
        return { item: null, habit, chips: parsed.chips };
      }
      const item = await transaction((db) =>
        mutate(db, u, {
          operation: "create",
          data: itemData.parse(parsed.input),
        }),
      );
      reply.code(201);
      return { item: item!, chips: parsed.chips };
    },
  );

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

  /** The task's project and readable source pages, including its source line. */
  app.get("/items/:id/context", async (r): Promise<ItemContext> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const db = reader(r.headers);
    const item = (
      await db.query<ItemRow>("SELECT * FROM items WHERE id = $1", [id])
    ).rows[0];
    if (!item) fail(404, "Item not found");
    await requireItemAccess(u, item, "items:read");
    const project = item.project_id
      ? ((
          await db.query<NonNullable<ItemContext["project"]>>(
            `SELECT p.id, p.name, p.team_id, p.status, p.deadline,
                    s.id AS stage_id, s.name AS stage_name
               FROM projects p LEFT JOIN project_stages s
                 ON s.id = $2 AND s.project_id = p.id
              WHERE p.id = $1 AND ((p.team_id IS NULL AND p.user_id = $3)
                OR p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $3))`,
            [item.project_id, item.stage_id, u.id],
          )
        ).rows[0] ?? null)
      : null;
    const docs = (
      await db.query<{
        id: string;
        title: string;
        kind: ItemContext["pages"][number]["kind"];
        team_id: string | null;
        updated_at: Date;
        content: DocBlock[];
        block_id: string | null;
      }>(
        `SELECT d.id, d.title, d.kind, d.team_id, d.updated_at, d.content,
                l.block_id
           FROM docs d LEFT JOIN LATERAL (
             SELECT block_id, created_at FROM doc_task_links
              WHERE doc_id = d.id AND item_id = $1
              ORDER BY created_at, block_id LIMIT 1
           ) l ON true
          WHERE (d.item_id = $1 OR l.block_id IS NOT NULL)
            AND ${docVisibleTo("$2")}
          ORDER BY (l.block_id IS NOT NULL) DESC,
                   l.created_at ASC NULLS LAST, d.updated_at DESC, d.id
          LIMIT 101`,
        [id, u.id],
      )
    ).rows;
    const source = docs.find((d) => d.block_id);
    const block = source?.content.find((b) => b.id === source.block_id);
    return {
      project,
      came_from: source
        ? {
            doc_id: source.id,
            title: source.title,
            kind: source.kind,
            block_id: source.block_id!,
            quote: quoteOf(block),
            todo: block?.type === "todo",
            done: block?.type === "todo" ? block.done : false,
          }
        : null,
      pages: docs
        .filter((d) => d.id !== source?.id)
        .slice(0, 100)
        .map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          team_id: d.team_id,
          updated_at: d.updated_at.toISOString(),
          block_id: d.block_id,
        })),
    };
  });

  // A device may name the item itself (made offline): sending it again is
  // the same item, never a second one.
  app.post("/items", async (r, reply) => {
    const u = await authenticate(r);
    const { id, ...raw } = z
      .object({ id: z.uuid().optional() })
      .passthrough()
      .parse(r.body);
    const data = itemData.parse(raw);
    if (id) {
      const existing = (
        await pool.query<ItemRow>("SELECT * FROM items WHERE id = $1", [id])
      ).rows[0];
      if (existing) {
        if (existing.user_id !== u.id) fail(409, "That item id is taken.");
        await requireItemAccess(u, existing, "items:read");
        return transaction((db) => loadItem(db, id));
      }
    }
    const item = await transaction((db) =>
      mutate(db, u, { operation: "create", data }, id),
    );
    reply.code(201);
    return item;
  });

  // ?scope=this|following changes one occurrence of a repeating item, or it
  // and every later one; the default (all) changes the whole item.
  app.put("/items/:id", async (r) => {
    const u = await authenticate(r);
    const scope = editScopeQuery.parse(r.query);
    const { version, ...raw } = z
      .object({ version: z.number().int().positive() })
      .passthrough()
      .parse(r.body);
    const data = itemData.parse(raw);
    const id = idParam(r);
    return transaction((db) =>
      scope.scope === "this"
        ? editOccurrence(db, u, id, version, scope.occurrence!, data)
        : scope.scope === "following"
          ? editFollowing(db, u, id, version, scope.occurrence!, data)
          : mutate(db, u, { operation: "update", data, item_id: id, version }),
    );
  });

  app.delete("/items/:id", async (r, reply) => {
    const u = await authenticate(r);
    const q = z
      .object({ version: z.coerce.number().int().positive() })
      .and(editScopeQuery)
      .parse(r.query);
    const id = idParam(r);
    await transaction((db) =>
      q.scope === "all"
        ? mutate(db, u, {
            operation: "delete",
            item_id: id,
            version: q.version,
          })
        : deleteOccurrences(db, u, id, q.version, q.scope, q.occurrence!),
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
      // A new status goes the way every edit does (see setItemStatus): a
      // finished task loses its future sessions, a repeating one moves on to
      // its next occurrence, and webhooks and open apps hear about it.
      const changed =
        d.status && d.status !== item.status
          ? await setItemStatus(db, u, id, d.status)
          : null;
      // A repeating task that moved on has already said so in its timeline,
      // so a bare tick doesn't add a second, empty entry.
      const movedOn = !!changed && changed.status !== d.status;
      if (d.body || d.progress !== undefined || !movedOn) {
        await db.query(
          "INSERT INTO item_updates(item_id, user_id, body, status, progress) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            u.id,
            d.body,
            movedOn ? null : (d.status ?? null),
            d.progress ?? null,
          ],
        );
        await db.query(
          "UPDATE items SET updates_count = updates_count + 1, last_update_at = now() WHERE id=$1",
          [id],
        );
      }
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
