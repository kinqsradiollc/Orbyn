import type { Db } from "../db/pool.js";
import type { UserRow } from "../lib/auth.js";
import { audit } from "../lib/audit.js";
import {
  restoreDerivedItemPlacement,
  type ItemPlacementRestore,
} from "../modules/items/service.js";

/**
 * Keeping what an agent deleted, so Undo can bring it back: before a
 * delete made directly (full power), the rows it takes away are copied
 * whole into the change's undo (agent_activity.undo, kept 30 days): the
 * thing itself (with subtasks or replies), the rows that go with it (a
 * task's steps, sessions, tags, links …), and where other things pointed
 * at it (pages filed in a folder, tasks in a list or project), which the
 * database would otherwise just clear.
 *
 * Only the tables named here are ever copied or written back.
 */

type Spec = {
  table: string;
  /** A column pointing at a parent of the same table (subtasks, replies). */
  tree?: string;
  /** Rows that go with it: [table, column pointing at it]. */
  children: [string, string][];
  /** Rows elsewhere that point at it and are cleared: [table, column]. */
  relink: [string, string][];
};

export const SNAPSHOT_SPECS = {
  item: {
    table: "items",
    tree: "parent_id",
    children: [
      ["item_steps", "item_id"],
      ["item_tags", "item_id"],
      ["time_blocks", "item_id"],
      ["item_attendees", "item_id"],
      ["item_links", "item_id"],
      ["item_overrides", "item_id"],
      ["item_dependencies", "item_id"],
      ["item_dependencies", "prerequisite_id"],
      ["doc_task_links", "item_id"],
      ["item_updates", "item_id"],
      ["item_completions", "item_id"],
      ["task_asks", "item_id"],
      ["item_proofs", "item_id"],
      ["item_deadline_moves", "item_id"],
    ],
    relink: [
      ["docs", "item_id"],
      ["focus_sessions", "item_id"],
    ],
  },
  project: {
    table: "projects",
    children: [
      ["project_stages", "project_id"],
      ["project_links", "project_id"],
      ["project_milestones", "project_id"],
      ["project_activity", "project_id"],
      ["custom_field_values", "project_id"],
    ],
    relink: [
      ["items", "project_id"],
      ["docs", "project_id"],
      ["work_records", "project_id"],
    ],
  },
  stage: {
    table: "project_stages",
    children: [],
    relink: [["items", "stage_id"]],
  },
  list: { table: "lists", children: [], relink: [["items", "list_id"]] },
  tag: {
    table: "tags",
    children: [
      ["item_tags", "tag_id"],
      ["doc_tags", "tag_id"],
      ["page_template_tags", "tag_id"],
    ],
    relink: [],
  },
  folder: {
    table: "folders",
    children: [["published_pages", "folder_id"]],
    relink: [
      ["docs", "folder_id"],
      ["page_templates", "folder_id"],
    ],
  },
  view: {
    table: "saved_views",
    children: [["saved_view_pins", "view_id"]],
    relink: [],
  },
  template: { table: "project_templates", children: [], relink: [] },
  page_template: {
    table: "page_templates",
    children: [["page_template_tags", "template_id"]],
    relink: [],
  },
  frame: { table: "frames", children: [], relink: [] },
  habit: {
    table: "habits",
    children: [["habit_blocks", "habit_id"]],
    relink: [],
  },
  place: { table: "places", children: [], relink: [] },
  comment: {
    table: "doc_comments",
    tree: "parent_id",
    children: [["doc_comment_mentions", "comment_id"]],
    relink: [],
  },
  proof: { table: "item_proofs", children: [], relink: [] },
  project_link: { table: "project_links", children: [], relink: [] },
  habit_session: { table: "habit_blocks", children: [], relink: [] },
  field: {
    table: "custom_fields",
    children: [["custom_field_values", "field_id"]],
    relink: [],
  },
  milestone: {
    table: "project_milestones",
    children: [],
    relink: [["items", "milestone_id"]],
  },
} satisfies Record<string, Spec>;

export type SnapshotKind = keyof typeof SNAPSHOT_SPECS;

/** Every table a snapshot may write back, and every column it may re-point. */
const TABLES = new Set<string>(
  Object.values(SNAPSHOT_SPECS as Record<string, Spec>).flatMap((s) => [
    s.table,
    ...s.children.map(([t]) => t),
  ]),
);
const RELINKS = new Set<string>(
  Object.values(SNAPSHOT_SPECS as Record<string, Spec>).flatMap((s) =>
    s.relink.map(([t, c]) => `${t}.${c}`),
  ),
);
RELINKS.add("items.stage_id");

/** The copy kept in an undo step (see undo.ts "rows.recreate"). */
export type Snapshot = {
  /** Rows to put back, table by table, in order. */
  rows: { table: string; data: Record<string, unknown>[] }[];
  /** Rows elsewhere to point back at it (only while they point nowhere). */
  relink: { table: string; column: string; value: string; ids: string[] }[];
  /** Deleted tasks, so sync stops reporting them gone. */
  items: string[];
  /** Task versions before a project/stage deletion; its derived change increments each once. */
  placementVersions?: Record<string, number>;
};

/** Copy what deleting `ids` (of one kind) would take away. */
export async function snapshot(
  db: Db,
  kind: SnapshotKind,
  ids: string[],
): Promise<Snapshot> {
  const spec: Spec = SNAPSHOT_SPECS[kind];
  if (kind === "project" || kind === "stage") {
    // Capture and deletion share a transaction. Hold parent and task locks so
    // the expected +1 can only be the deletion's derived change, not a newer unfile.
    await db.query(
      kind === "project"
        ? "SELECT id FROM projects WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE"
        : "SELECT p.id FROM projects p WHERE p.id IN (SELECT project_id FROM project_stages WHERE id=ANY($1::uuid[])) ORDER BY p.id FOR UPDATE",
      [ids],
    );
    await db.query(
      `SELECT id FROM items WHERE kind='task' AND ${kind === "project" ? "project_id" : "stage_id"}=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [ids],
    );
  }
  const main = spec.tree
    ? (
        await db.query<{ row: Record<string, unknown> }>(
          `WITH RECURSIVE tree (id, depth) AS (
             SELECT id, 0 FROM ${spec.table} WHERE id = ANY ($1::uuid[])
             UNION
             SELECT c.id, tree.depth + 1 FROM ${spec.table} c
               JOIN tree ON c.${spec.tree} = tree.id)
           SELECT to_jsonb(t) AS row FROM ${spec.table} t
             JOIN (SELECT id, min(depth) AS depth FROM tree GROUP BY id) d
               ON d.id = t.id
            ORDER BY d.depth`,
          [ids],
        )
      ).rows.map((r) => r.row)
    : (
        await db.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(t) AS row FROM ${spec.table} t WHERE id = ANY ($1::uuid[])`,
          [ids],
        )
      ).rows.map((r) => r.row);
  const all = main.map((r) => String(r.id));
  const rows: Snapshot["rows"] = [{ table: spec.table, data: main }];
  const seen = new Set<string>();
  for (const [table, column] of spec.children) {
    const data = (
      await db.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${column} = ANY ($1::uuid[])`,
        [all],
      )
    ).rows
      .map((r) => r.row)
      .filter((r) => {
        const key = `${table}|${JSON.stringify(r)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (data.length) rows.push({ table, data });
  }
  const relink: Snapshot["relink"] = [];
  const placementVersions: Record<string, number> = {};
  const pointAt = async (table: string, column: string, values: string[]) => {
    const found = (
      await db.query<{ id: string; value: string; version?: number }>(
        `SELECT id::text, ${column}::text AS value ${table === "items" && (column === "project_id" || column === "stage_id") ? ", version" : ""} FROM ${table}
          WHERE ${column} = ANY ($1::uuid[])`,
        [values],
      )
    ).rows;
    const by = new Map<string, string[]>();
    for (const f of found) {
      by.set(f.value, [...(by.get(f.value) ?? []), f.id]);
      if (f.version !== undefined) placementVersions[f.id] = f.version;
    }
    for (const [value, list] of by)
      relink.push({ table, column, value, ids: list });
  };
  for (const [table, column] of spec.relink) await pointAt(table, column, all);
  if (kind === "project") {
    const stages = rows
      .find((r) => r.table === "project_stages")
      ?.data.map((s) => String(s.id));
    if (stages?.length) await pointAt("items", "stage_id", stages);
  }
  return {
    rows,
    relink,
    items: kind === "item" ? all : [],
    ...(Object.keys(placementVersions).length ? { placementVersions } : {}),
  };
}

/**
 * Put a snapshot back. Refused (false) when the thing is already back;
 * rows that no longer fit (what they pointed at is gone) are left out.
 */
export async function restoreSnapshot(
  db: Db,
  s: Snapshot,
  actor: UserRow,
  undoVersions?: Map<string, number>,
): Promise<boolean> {
  const [main, ...children] = s.rows;
  if (!main || !TABLES.has(main.table)) return false;
  const ids = main.data.map((r) => String(r.id));
  const back = (
    await db.query(`SELECT 1 FROM ${main.table} WHERE id = ANY ($1::uuid[])`, [
      ids,
    ])
  ).rowCount;
  if (back) return false;
  await db.query(
    `INSERT INTO ${main.table}
     SELECT * FROM jsonb_populate_recordset(NULL::${main.table}, $1::jsonb)`,
    [JSON.stringify(main.data)],
  );
  for (const part of children) {
    if (!TABLES.has(part.table)) continue;
    // One row at a time, so a row whose other end is gone (a page since
    // deleted) is simply left out.
    for (const row of part.data) {
      await db.query("SAVEPOINT snapshot_row");
      try {
        await db.query(
          `INSERT INTO ${part.table}
           SELECT * FROM jsonb_populate_record(NULL::${part.table}, $1::jsonb)
           ON CONFLICT DO NOTHING`,
          [JSON.stringify(row)],
        );
        await db.query("RELEASE SAVEPOINT snapshot_row");
      } catch {
        await db.query("ROLLBACK TO SAVEPOINT snapshot_row");
      }
    }
  }
  const placement = new Map<string, ItemPlacementRestore>();
  for (const r of s.relink) {
    if (!RELINKS.has(`${r.table}.${r.column}`)) continue;
    if (
      r.table === "items" &&
      (r.column === "project_id" || r.column === "stage_id")
    ) {
      for (const id of r.ids) {
        const before = s.placementVersions?.[id];
        const target = placement.get(id) ?? {
          id,
          ...(typeof before === "number" &&
          Number.isSafeInteger(before) &&
          before > 0 &&
          before < Number.MAX_SAFE_INTEGER
            ? { expectedVersion: before + 1 }
            : {}),
        };
        target[r.column] = r.value;
        placement.set(id, target);
      }
      continue;
    }
    await db.query(
      `UPDATE ${r.table} SET ${r.column} = $1::uuid
        WHERE id = ANY ($2::uuid[]) AND ${r.column} IS NULL`,
      [r.value, r.ids],
    );
  }
  if (placement.size) {
    const carried = new Map<string, number>();
    for (const id of placement.keys()) {
      const version = undoVersions?.get(`item:${id}`);
      if (version !== undefined) carried.set(id, version);
    }
    const result = await restoreDerivedItemPlacement(
      db,
      actor,
      [...placement.values()],
      carried,
    );
    for (const [id, version] of carried)
      undoVersions?.set(`item:${id}`, version);
    if (result.preserved)
      await audit(
        {
          actorId: actor.id,
          action: "agent.snapshot_placement_preserved",
          targetType: "user",
          targetId: actor.id,
          details: {
            preserved: result.preserved,
            restored: result.restored,
            reason: "legacy_or_changed_placement",
          },
        },
        db,
      );
  }
  if (s.items.length)
    await db.query(
      "DELETE FROM deleted_items WHERE item_id = ANY ($1::uuid[])",
      [s.items],
    );
  return true;
}
