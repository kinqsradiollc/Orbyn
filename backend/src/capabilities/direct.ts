import {
  reviewChange,
  type ReviewChange,
  type ReviewChangeInput,
  type ReviewDeletable,
} from "@orbyn/core";
import { lockItem } from "../modules/items/service.js";
import { applyChange, staleness } from "../modules/proposals/service.js";
import { announceDocChange } from "../modules/docs/live.js";
import { pool } from "../db/pool.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";
import { appUrl } from "./refs.js";
import { entryOf } from "./shared.js";
import { snapshot, SNAPSHOT_SPECS, type SnapshotKind } from "./snapshot.js";
import type { UndoOp } from "./undo.js";
import { actorOf, dbOf, type DoneEntry } from "./write.js";

/**
 * Making a change directly that used to always wait for review: deletes,
 * moves, restoring a page's version, removing steps, sessions and links,
 * and the other "action" changes. At full power these are made at once
 * (policy in write.ts destination()), through the same services the Review
 * inbox uses (proposals/service.ts applyChange), with the steps that take
 * each one back recorded for 30 days: what a delete took away is kept
 * whole (snapshot.ts), a trashed page comes back from Trash, a restored
 * version is restored again.
 */

export type Applied = {
  done: DoneEntry;
  undo: UndoOp[];
  after: (() => Promise<void>)[];
};

const stale = (why: string) =>
  new CapabilityError(
    "STALE",
    why,
    "Fetch it again and decide with what is there now.",
  );

/** Apply one change now, as the person (the agent's label stays). */
export async function applyDirect(
  ctx: CapabilityContext,
  input: ReviewChangeInput,
): Promise<Applied> {
  const db = dbOf(ctx);
  const actor = actorOf(ctx.principal);
  const c: ReviewChange = reviewChange.parse(input);
  const why = await staleness(db, ctx.principal.user.id, c);
  if (why) throw stale(why);
  const undo: UndoOp[] = [];
  const after: (() => Promise<void>)[] = [];
  const kept = async (kind: SnapshotKind, id: string, label: string) =>
    undo.push({
      op: "rows.recreate",
      label,
      ...(await snapshot(db, kind, [id])),
    });
  let done: DoneEntry;
  switch (c.type) {
    case "task.delete": {
      await kept("item", c.item_id, c.title);
      await applyChange(db, actor, c);
      done = entryOf("task", c.item_id, c.title, null, "Deleted");
      break;
    }
    case "task.update":
    case "task.complete": {
      const row = await lockItem(db, c.item_id);
      const before =
        c.type === "task.update" ? c.before : { status: row.status };
      await applyChange(db, actor, c);
      const now = await lockItem(db, c.item_id);
      undo.push({
        op: "item.restore",
        id: now.id,
        version: now.version,
        fields: before,
      });
      const moved =
        c.type === "task.update" &&
        "team_id" in c.patch &&
        c.patch.team_id !== row.team_id;
      done = entryOf(
        now.kind === "event" ? "event" : "task",
        now.id,
        now.title,
        now.version,
        c.type === "task.complete"
          ? c.done
            ? "Completed"
            : "Reopened"
          : moved
            ? "Moved"
            : "Changed",
      );
      break;
    }
    case "checklist.remove":
    case "checklist.edit": {
      const steps = (
        await db.query<{
          id: string;
          title: string;
          done: boolean;
          position: number;
        }>(
          "SELECT id, title, done, position FROM item_steps WHERE item_id = $1 ORDER BY position",
          [c.item_id],
        )
      ).rows;
      await applyChange(db, actor, c);
      undo.push({ op: "steps.restore", item_id: c.item_id, steps });
      done = entryOf(
        "task",
        c.item_id,
        c.title,
        null,
        c.type === "checklist.remove"
          ? "Removed a step"
          : "Edited the checklist",
      );
      break;
    }
    case "doc.delete": {
      await applyChange(db, actor, c);
      undo.push({ op: "doc.untrash", doc_id: c.doc_id });
      after.push(() =>
        announceDocChange(pool, c.doc_id, c.version, "agent", {
          trashed: true,
        }),
      );
      done = entryOf("doc", c.doc_id, c.title, null, "Moved to Trash");
      break;
    }
    case "doc.restore_version": {
      await applyChange(db, actor, c);
      const now = (
        await db.query<{ version: number }>(
          "SELECT version FROM docs WHERE id = $1",
          [c.doc_id],
        )
      ).rows[0];
      undo.push({
        op: "doc.restore",
        doc_id: c.doc_id,
        version: now.version,
        to_version: c.version,
      });
      after.push(() => announceDocChange(pool, c.doc_id, now.version, "agent"));
      done = entryOf(
        "doc",
        c.doc_id,
        c.title,
        now.version,
        `Restored version ${c.to_version}`,
      );
      break;
    }
    case "project.delete": {
      await kept("project", c.project_id, c.title);
      await applyChange(db, actor, c);
      done = entryOf("project", c.project_id, c.title, null, "Deleted");
      break;
    }
    case "session.remove": {
      const b = (
        await db.query<{
          id: string;
          item_id: string;
          start_at: Date;
          end_at: Date;
          source: string;
          plan_id: string | null;
        }>(
          `SELECT id, item_id, start_at, end_at, source, plan_id
             FROM time_blocks WHERE id = $1`,
          [c.block_id],
        )
      ).rows[0];
      await applyChange(db, actor, c);
      if (b)
        undo.push({
          op: "blocks.restore",
          blocks: [
            {
              ...b,
              start_at: b.start_at.toISOString(),
              end_at: b.end_at.toISOString(),
            },
          ],
        });
      done = entryOf("task", c.item_id, c.title, null, "Removed a session");
      break;
    }
    case "link.remove": {
      if (c.kind === "project") {
        const row = await lockItem(db, c.from_id);
        await applyChange(db, actor, c);
        const now = await lockItem(db, c.from_id);
        undo.push({
          op: "item.restore",
          id: now.id,
          version: now.version,
          fields: { project_id: row.project_id, stage_id: row.stage_id },
        });
      } else {
        const block =
          c.kind === "doc_task"
            ? (
                await db.query<{ block_id: string }>(
                  "SELECT block_id FROM doc_task_links WHERE item_id = $1 AND doc_id = $2 LIMIT 1",
                  [c.from_id, c.to_id],
                )
              ).rows[0]?.block_id
            : undefined;
        await applyChange(db, actor, c);
        undo.push({
          op: "link.set",
          kind: c.kind,
          item_id: c.from_id,
          other_id: c.to_id,
          ...(block ? { block_id: block } : {}),
          present: true,
        });
      }
      done = entryOf("task", c.from_id, c.title, null, "Unlinked");
      break;
    }
    case "action": {
      // A project's stages as they were, to put back.
      const project =
        c.action === "project.update" && c.target_id
          ? (
              await db.query<{
                name: string;
                summary: string;
                status: string;
                deadline: Date | null;
                doc_id: string | null;
              }>(
                "SELECT name, summary, status, deadline, doc_id FROM projects WHERE id = $1",
                [c.target_id],
              )
            ).rows[0]
          : undefined;
      const stages = project
        ? (
            await db.query<{ id: string; name: string }>(
              "SELECT id, name FROM project_stages WHERE project_id = $1 ORDER BY position",
              [c.target_id],
            )
          ).rows
        : null;
      if (c.action === "delete") {
        const what = String(c.input.kind) as ReviewDeletable;
        if (what in SNAPSHOT_SPECS && c.target_id)
          await kept(what as SnapshotKind, c.target_id, c.title);
      }
      // Stages it removes, kept whole (with their tasks' places).
      const staying = new Set(
        (
          ((c.input.patch as { stages?: { id?: string }[] } | undefined)
            ?.stages ?? []) as { id?: string }[]
        )
          .map((x) => x.id)
          .filter(Boolean),
      );
      const dropped =
        project && (c.input.patch as { stages?: unknown })?.stages
          ? (stages ?? []).filter((x) => !staying.has(x.id)).map((x) => x.id)
          : [];
      const stageCopy = dropped.length
        ? await snapshot(db, "stage", dropped)
        : null;
      await applyChange(db, actor, c);
      if (project && c.target_id) {
        const now = (
          await db.query<{ updated_at: Date }>(
            "SELECT updated_at FROM projects WHERE id = $1",
            [c.target_id],
          )
        ).rows[0];
        undo.push({
          op: "project.restore",
          id: c.target_id,
          updated_at: now.updated_at.toISOString(),
          fields: {
            ...project,
            deadline: project.deadline?.toISOString() ?? null,
          },
          stages,
        });
        // Undone last first: the stages come back, then the fields.
        if (stageCopy)
          undo.push({ op: "rows.recreate", label: c.title, ...stageCopy });
      }
      done = {
        id: c.target_id ? `${c.action}:${c.target_id}` : c.action,
        title: c.title,
        url: `${appUrl()}/app`,
        version: null,
        change: c.headline,
      };
      break;
    }
    default: {
      // Adds and edits have their own direct paths in their tools; one that
      // arrives here is made as the inbox would make it.
      await applyChange(db, actor, c);
      done = {
        id: c.type,
        title: c.title,
        url: `${appUrl()}/app`,
        version: null,
        change: "Made",
      };
    }
  }
  return { done, undo, after };
}
