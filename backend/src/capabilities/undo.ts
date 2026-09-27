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
  saveDoc,
  trashDoc,
  untrashDoc,
} from "../modules/docs/service.js";
import {
  restoreExam,
  syncSavedPages,
  type ExamRow,
} from "../modules/study/service.js";
import { requireTeam } from "../lib/teams.js";
import { restoreSnapshot, type Snapshot } from "./snapshot.js";
import {
  deleteProject,
  requireProject,
  updateProject,
} from "../modules/projects/service.js";
import { mergedItem } from "../modules/proposals/service.js";
import { announceDocChange } from "../modules/docs/live.js";
import { pool } from "../db/pool.js";
import { announceTo } from "../modules/presence/live.js";
import { savePrefs } from "../modules/planner/routines.js";
import {
  deleteView,
  everySpace,
  findView,
  readDefinition,
  updateView,
} from "./view-store.js";

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
      /** Time spent before completing counted its past sessions. */
      spent_minutes?: number;
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
  /** A page it filed in a folder or project: put it back where it was. */
  | {
      op: "doc.file";
      doc_id: string;
      version: number;
      folder_id?: string | null;
      project_id?: string | null;
    }
  /** A page it made: move it to Trash. */
  | { op: "doc.trash"; doc_id: string; version: number }
  /** A page it moved to Trash: bring it back. */
  | { op: "doc.untrash"; doc_id: string }
  /** Something it deleted (a task, project, list …): put it back whole. */
  | ({ op: "rows.recreate"; label: string } & Snapshot)
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
    }
  /** A related link it made or removed. */
  | {
      op: "related.set";
      source_kind: "doc" | "task";
      source_id: string;
      target_kind: "doc" | "task" | "project";
      target_id: string;
      present: boolean;
    }
  /** A project it changed: put its fields (and stages) back. */
  | {
      op: "project.restore";
      id: string;
      /** When the agent's change left it, to tell a later change apart. */
      updated_at: string;
      fields: {
        name: string;
        summary: string;
        status: string;
        deadline: string | null;
        doc_id: string | null;
      };
      stages: { id: string; name: string }[] | null;
    }
  /** Habit sessions it planned: remove them. */
  | { op: "habit_blocks.delete"; ids: string[] }
  /** Planner settings it changed: put the old values back. */
  | { op: "prefs.restore"; fields: Record<string, unknown> }
  /** A saved view it made: remove it. */
  | { op: "view.delete"; id: string; version: number }
  /** A saved view it changed: put it back. */
  | {
      op: "view.restore";
      id: string;
      version: number;
      fields: { name: string; definition: unknown };
    }
  /** A source it saved (H2): remove it, with its links to pages. */
  | { op: "source.delete"; id: string }
  /** A source it changed: put its words back. */
  | {
      op: "source.restore";
      id: string;
      fields: {
        title: string;
        site: string;
        author: string | null;
        quote: string | null;
        accessed_on: string;
      };
    }
  /** Lines of a page it linked to a source that was already saved. */
  | { op: "source.unlink"; id: string; doc_id: string; lines: string[] }
  /**
   * A picture or file it sent (H2): delete it, unless another page shows
   * it now; `kept` is a page's original rather than a line's file.
   */
  | { op: "file.delete"; id: string; kept?: boolean }
  /** An exam it named or changed in Study (H4): put it back, or remove it. */
  | { op: "exam.restore"; key: string; was: ExamRow | null };

/** Undo is kept this long after the change. */
export const UNDO_DAYS = 30;

const changedSince = () =>
  fail(
    409,
    "It changed after the agent's edit, so it wasn't undone. Change it in Orbyn instead.",
  );

/**
 * Run undo steps as `u`, last first, in the caller's transaction.
 *
 * `carry` spans the changes of one job (apply_plan's steps, undone
 * together): a task or page an earlier undo step here already put back is
 * at the version that undo made, not the one the earlier change left, so
 * that version counts as unchanged. The first undo step to reach each thing
 * still checks it against what the agent left.
 */
export async function runUndo(
  db: Db,
  u: UserRow,
  ops: UndoOp[],
  carry: Map<string, number> = new Map(),
) {
  await actAs(db, u.id, null);
  const after: (() => Promise<void>)[] = [];
  const same = (key: string, now: number, want: number) =>
    now === want || carry.get(key) === now;
  for (const op of [...ops].reverse()) {
    switch (op.op) {
      case "item.delete": {
        const row = await lockItem(db, op.id).catch(() => null);
        if (!row) break;
        if (!same(`item:${op.id}`, row.version, op.version)) changedSince();
        await mutate(db, u, {
          operation: "delete",
          item_id: op.id,
          version: row.version,
        });
        break;
      }
      case "item.restore": {
        const row = await lockItem(db, op.id);
        if (!same(`item:${op.id}`, row.version, op.version)) changedSince();
        const put = await mutate(db, u, {
          operation: "update",
          item_id: op.id,
          version: row.version,
          data: mergedItem(row, op.fields),
        });
        if (put) carry.set(`item:${op.id}`, put.version);
        if (op.spent_minutes !== undefined)
          await db.query("UPDATE items SET spent_minutes = $2 WHERE id = $1", [
            op.id,
            op.spent_minutes,
          ]);
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
        if (!same(`doc:${op.doc_id}`, doc.version, op.version)) changedSince();
        const restored = await restoreDocVersion(
          db,
          u,
          op.doc_id,
          op.to_version,
        );
        carry.set(`doc:${op.doc_id}`, restored.version);
        after.push(
          () => announceDocChange(pool, op.doc_id, restored.version, "undo"),
          // Cards it added go from Study at once.
          () => syncSavedPages(op.doc_id),
        );
        break;
      }
      case "doc.file": {
        const doc = await requireDoc(db, op.doc_id, u, "items:write");
        if (!same(`doc:${op.doc_id}`, doc.version, op.version)) changedSince();
        const saved = await saveDoc(db, u, op.doc_id, {
          version: doc.version,
          ...(op.folder_id !== undefined ? { folder_id: op.folder_id } : {}),
          ...(op.project_id !== undefined ? { project_id: op.project_id } : {}),
        });
        carry.set(`doc:${op.doc_id}`, saved.version);
        after.push(() =>
          announceDocChange(pool, op.doc_id, saved.version, "undo"),
        );
        break;
      }
      case "doc.trash": {
        const doc = await requireDoc(db, op.doc_id, u, "items:write").catch(
          () => null,
        );
        if (!doc) break;
        if (!same(`doc:${op.doc_id}`, doc.version, op.version)) changedSince();
        const gone = await trashDoc(db, u, op.doc_id);
        after.push(
          () =>
            announceDocChange(pool, op.doc_id, gone.version, "undo", {
              trashed: true,
            }),
          () => syncSavedPages(op.doc_id),
        );
        break;
      }
      case "doc.untrash": {
        const doc = (
          await db.query<{ deleted_at: Date | null }>(
            "SELECT deleted_at FROM docs WHERE id = $1",
            [op.doc_id],
          )
        ).rows[0];
        if (!doc) fail(404, "That page was deleted for good.");
        if (!doc.deleted_at) changedSince();
        await untrashDoc(db, u, op.doc_id);
        const back = (
          await db.query<{ version: number }>(
            "SELECT version FROM docs WHERE id = $1",
            [op.doc_id],
          )
        ).rows[0];
        after.push(async () => {
          await announceDocChange(pool, op.doc_id, back.version, "undo");
          await syncSavedPages(op.doc_id);
        });
        break;
      }
      case "rows.recreate": {
        // Only where the person can still make things.
        const teams = new Set(
          (op.rows[0]?.data ?? [])
            .map((r) => r.team_id)
            .filter((t): t is string => typeof t === "string"),
        );
        for (const t of teams) await requireTeam(t, u, "items:write", db);
        if (!(await restoreSnapshot(db, op))) changedSince();
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
      case "related.set": {
        // Only while the person can still change the end it starts from.
        if (op.source_kind === "task") {
          const item = await lockItem(db, op.source_id);
          await requireItemAccess(u, item, "items:write", db);
        } else await requireDoc(db, op.source_id, u, "items:write");
        await db.query(
          op.present
            ? `INSERT INTO object_links (source_kind, source_id, target_kind, target_id, link_kind)
               VALUES ($1, $2, $3, $4, 'related') ON CONFLICT DO NOTHING`
            : `DELETE FROM object_links WHERE link_kind = 'related' AND source_kind = $1
                 AND source_id = $2 AND target_kind = $3 AND target_id = $4`,
          [op.source_kind, op.source_id, op.target_kind, op.target_id],
        );
        break;
      }
      case "project.restore": {
        await requireProject(db, op.id, u, "items:write");
        const now = (
          await db.query<{ updated_at: Date }>(
            "SELECT updated_at FROM projects WHERE id = $1",
            [op.id],
          )
        ).rows[0];
        if (!now) break;
        if (now.updated_at.toISOString() !== op.updated_at) changedSince();
        await updateProject(db, u, op.id, {
          name: op.fields.name,
          summary: op.fields.summary,
          status: op.fields.status as never,
          deadline: op.fields.deadline,
          doc_id: op.fields.doc_id,
          ...(op.stages ? { stages: op.stages } : {}),
        });
        break;
      }
      case "habit_blocks.delete":
        await db.query(
          "DELETE FROM habit_blocks WHERE id = ANY ($1::uuid[]) AND user_id = $2",
          [op.ids, u.id],
        );
        break;
      case "prefs.restore":
        await savePrefs(db, u.id, op.fields as never);
        break;
      case "view.delete": {
        const view = await findView(db, everySpace(u.id), op.id, true);
        if (!view) break;
        if (view.version !== op.version) changedSince();
        await deleteView(db, u, op.id);
        break;
      }
      case "source.delete":
        await db.query("DELETE FROM sources WHERE id = $1", [op.id]);
        break;
      case "source.restore":
        await db.query(
          `UPDATE sources SET title = $2, site = $3, author = $4, quote = $5,
                  accessed_on = $6, updated_at = now()
            WHERE id = $1`,
          [
            op.id,
            op.fields.title,
            op.fields.site,
            op.fields.author,
            op.fields.quote,
            op.fields.accessed_on,
          ],
        );
        break;
      case "source.unlink":
        await db.query(
          `DELETE FROM source_uses
            WHERE source_id = $1 AND doc_id = $2 AND block_id = ANY ($3::text[])`,
          [op.id, op.doc_id, op.lines],
        );
        break;
      case "file.delete":
        if (op.kept)
          await db.query(
            "DELETE FROM kept_files WHERE id = $1 AND user_id = $2",
            [op.id, u.id],
          );
        else
          // A page that still shows it keeps it (the line was copied on).
          await db.query(
            `DELETE FROM page_files f WHERE f.id = $1 AND f.user_id = $2
                AND NOT EXISTS (SELECT 1 FROM page_file_refs r
                                 WHERE r.file_id = f.id)`,
            [op.id, u.id],
          );
        break;
      case "exam.restore":
        await restoreExam(db, u.id, op.key, op.was);
        break;
      case "view.restore": {
        const view = await findView(db, everySpace(u.id), op.id, true);
        if (!view) break;
        if (view.version !== op.version) changedSince();
        await updateView(db, u, op.id, {
          version: view.version,
          name: op.fields.name,
          definition: readDefinition(op.fields.definition, view.source),
        });
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
