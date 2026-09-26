import { fail } from "@orbyn/core";
import type { Db } from "../db/pool.js";
import { actAs } from "../lib/actor.js";
import { audit } from "../lib/audit.js";
import type { UserRow } from "../lib/auth.js";
import {
  lockItem,
  mutate,
  recomputeProgress,
  requireItemAccess,
} from "../modules/items/service.js";
import {
  requireDoc,
  restoreDocVersion,
  trashDoc,
} from "../modules/docs/service.js";
import { deleteProject, requireProject } from "../modules/projects/service.js";
import { mergedItem } from "../modules/proposals/service.js";
import { announceDocChange } from "../modules/docs/live.js";
import { pool } from "../db/pool.js";
import { announceTo } from "../modules/presence/live.js";

/**
 * Undo for what an outside agent changed: each change it makes records the
 * steps that take it back (agent_activity.undo, kept 30 days), never page
 * text itself (pages have versions, and undo puts the version back).
 *
 * Undoing runs as the person, through the same services, and only while
 * the thing is as the agent left it: a task edited since, a page saved
 * since or a session moved since is refused rather than overwritten.
 */
export type UndoOp =
  /** A task or event it made: delete it. */
  | { op: "item.delete"; id: string; version: number }
  /** A task it changed or completed: put the fields back. */
  | {
      op: "item.restore";
      id: string;
      version: number;
      fields: Record<string, unknown>;
    }
  /** Sessions it removed (completing a task clears them): put them back. */
  | {
      op: "blocks.restore";
      blocks: {
        id: string;
        item_id: string;
        start_at: string;
        end_at: string;
        source: string;
        plan_id: string | null;
      }[];
    }
  /** A session it added: remove it. */
  | { op: "block.delete"; id: string; start_at: string; end_at: string }
  /** A session it moved: move it back. */
  | {
      op: "block.move";
      id: string;
      start_at: string;
      end_at: string;
      to_start_at: string;
      to_end_at: string;
    }
  /** A page it edited: put the kept version back. */
  | { op: "doc.restore"; doc_id: string; version: number; to_version: number }
  /** A page it made: move it to Trash. */
  | { op: "doc.trash"; doc_id: string; version: number }
  /** Suggestions it left on a page: take them away while still open. */
  | { op: "suggestions.delete"; doc_id: string; ids: string[] }
  /** A project it made: delete it (its tasks go with their own ops). */
  | { op: "project.delete"; id: string }
  /** A task's checklist as it was. */
  | {
      op: "steps.restore";
      item_id: string;
      steps: { id: string; title: string; done: boolean; position: number }[];
    }
  /** A link it made or removed. */
  | {
      op: "link.set";
      kind: "depends_on" | "doc_task";
      item_id: string;
      other_id: string;
      block_id?: string;
      present: boolean;
    };

/** Undo is kept this long after the change. */
export const UNDO_DAYS = 30;

const changedSince = () =>
  fail(
    409,
    "It changed after the agent's edit, so it wasn't undone. Change it in Orbyn instead.",
  );

/** Run undo steps as `u`, last first, in the caller's transaction. */
export async function runUndo(db: Db, u: UserRow, ops: UndoOp[]) {
  await actAs(db, u.id, null);
  const after: (() => Promise<void>)[] = [];
  for (const op of [...ops].reverse()) {
    switch (op.op) {
      case "item.delete": {
        const row = await lockItem(db, op.id).catch(() => null);
        if (!row) break;
        if (row.version !== op.version) changedSince();
        await mutate(db, u, {
          operation: "delete",
          item_id: op.id,
          version: row.version,
        });
        break;
      }
      case "item.restore": {
        const row = await lockItem(db, op.id);
        if (row.version !== op.version) changedSince();
        await mutate(db, u, {
          operation: "update",
          item_id: op.id,
          version: row.version,
          data: mergedItem(row, op.fields),
        });
        break;
      }
      case "blocks.restore":
        for (const b of op.blocks)
          await db.query(
            `INSERT INTO time_blocks (id, item_id, user_id, start_at, end_at, source, plan_id)
             SELECT $1, $2, $3, $4, $5, $6, $7
              WHERE EXISTS (SELECT 1 FROM items WHERE id = $2)
             ON CONFLICT (id) DO NOTHING`,
            [b.id, b.item_id, u.id, b.start_at, b.end_at, b.source, b.plan_id],
          );
        break;
      case "block.delete": {
        const b = (
          await db.query<{ start_at: Date; end_at: Date }>(
            "SELECT start_at, end_at FROM time_blocks WHERE id = $1 AND user_id = $2 FOR UPDATE",
            [op.id, u.id],
          )
        ).rows[0];
        if (!b) break;
        if (
          b.start_at.getTime() !== Date.parse(op.start_at) ||
          b.end_at.getTime() !== Date.parse(op.end_at)
        )
          changedSince();
        await db.query("DELETE FROM time_blocks WHERE id = $1", [op.id]);
        break;
      }
      case "block.move": {
        const b = (
          await db.query<{ start_at: Date; end_at: Date }>(
            "SELECT start_at, end_at FROM time_blocks WHERE id = $1 AND user_id = $2 FOR UPDATE",
            [op.id, u.id],
          )
        ).rows[0];
        if (!b) fail(404, "That session is gone.");
        if (
          b.start_at.getTime() !== Date.parse(op.to_start_at) ||
          b.end_at.getTime() !== Date.parse(op.to_end_at)
        )
          changedSince();
        await db.query(
          "UPDATE time_blocks SET start_at = $2, end_at = $3 WHERE id = $1",
          [op.id, op.start_at, op.end_at],
        );
        break;
      }
      case "doc.restore": {
        const doc = await requireDoc(db, op.doc_id, u, "items:write");
        if (doc.version !== op.version) changedSince();
        const restored = await restoreDocVersion(
          db,
          u,
          op.doc_id,
          op.to_version,
        );
        after.push(() =>
          announceDocChange(pool, op.doc_id, restored.version, "undo"),
        );
        break;
      }
      case "doc.trash": {
        const doc = await requireDoc(db, op.doc_id, u, "items:write").catch(
          () => null,
        );
        if (!doc) break;
        if (doc.version !== op.version) changedSince();
        const gone = await trashDoc(db, u, op.doc_id);
        after.push(() =>
          announceDocChange(pool, op.doc_id, gone.version, "undo", {
            trashed: true,
          }),
        );
        break;
      }
      case "suggestions.delete":
        await requireDoc(db, op.doc_id, u, "items:read");
        await db.query(
          `DELETE FROM doc_suggestions
            WHERE doc_id = $1 AND id = ANY($2::uuid[]) AND status = 'open'`,
          [op.doc_id, op.ids],
        );
        break;
      case "project.delete": {
        const found = await requireProject(db, op.id, u, "items:write").catch(
          () => null,
        );
        if (found) await deleteProject(db, u, op.id);
        break;
      }
      case "steps.restore": {
        const item = await lockItem(db, op.item_id);
        await requireItemAccess(u, item, "items:write", db);
        await db.query("DELETE FROM item_steps WHERE item_id = $1", [
          op.item_id,
        ]);
        for (const s of op.steps)
          await db.query(
            `INSERT INTO item_steps (id, item_id, title, done, position)
             VALUES ($1, $2, $3, $4, $5)`,
            [s.id, op.item_id, s.title, s.done, s.position],
          );
        await recomputeProgress(db, op.item_id);
        break;
      }
      case "link.set": {
        const item = await lockItem(db, op.item_id);
        await requireItemAccess(u, item, "items:write", db);
        if (op.kind === "depends_on")
          await db.query(
            op.present
              ? `INSERT INTO item_dependencies (item_id, prerequisite_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`
              : "DELETE FROM item_dependencies WHERE item_id = $1 AND prerequisite_id = $2",
            [op.item_id, op.other_id],
          );
        else if (op.present && op.block_id)
          await db.query(
            `INSERT INTO doc_task_links (doc_id, block_id, item_id) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [op.other_id, op.block_id, op.item_id],
          );
        else if (!op.present)
          await db.query(
            "DELETE FROM doc_task_links WHERE doc_id = $1 AND item_id = $2",
            [op.other_id, op.item_id],
          );
        break;
      }
    }
  }
  return after;
}

/**
 * Undo one change an agent made for `u` (from its activity list): once,
 * within 30 days, and only while it's as the agent left it.
 */
export async function undoActivity(
  db: Db,
  u: UserRow,
  activityId: string,
): Promise<{ after: (() => Promise<void>)[]; summary: string }> {
  const row = (
    await db.query<{
      id: string;
      grant_id: string | null;
      summary: string;
      undo: UndoOp[] | null;
      undo_until: Date | null;
      undone_at: Date | null;
    }>(
      `SELECT id::text, grant_id, summary, undo, undo_until, undone_at
         FROM agent_activity WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [activityId, u.id],
    )
  ).rows[0];
  if (!row) fail(404, "That change isn't in your agents' activity.");
  if (row.undone_at) fail(409, "That change was already undone.");
  if (!row.undo?.length || !row.undo_until || row.undo_until <= new Date())
    fail(409, "That change can't be undone any more.");
  const after = await runUndo(db, u, row.undo);
  await db.query("UPDATE agent_activity SET undone_at = now() WHERE id = $1", [
    row.id,
  ]);
  await audit(
    {
      actorId: u.id,
      action: "agent.change_undone",
      targetType: "agent_grant",
      targetId: row.grant_id,
      details: { activity_id: row.id },
    },
    db,
  );
  await announceTo(db as never, { user_id: u.id }, "changed");
  return { after, summary: row.summary };
}
