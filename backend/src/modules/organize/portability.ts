import { itemData, type SystemRole } from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import { mutate } from "../items/service.js";
import { loadHabits } from "../planner/habits.js";

export type ExportArchive = {
  version: 1;
  exported_at: string;
  lists: { name: string; color: string }[];
  tags: { name: string; color: string }[];
  habits: unknown[];
  items: ExportItem[];
};
type ExportItem = {
  title: string;
  notes: string;
  kind: string;
  status: string;
  priority: string;
  due_at: string | null;
  end_at: string | null;
  estimate_minutes: number | null;
  location: string;
  rrule: string | null;
  list: string | null;
  tags: string[];
};

export type ImportSummary = {
  created: number;
  skipped: number;
  lists_added: number;
  tags_added: number;
  /** First few titles, so a dry run shows what would come in. */
  sample: string[];
  errors: string[];
};

/** Everything a person can take with them: their personal planner data. */
export async function exportData(
  db: Queryable,
  userId: string,
): Promise<ExportArchive> {
  const lists = (
    await db.query<{ name: string; color: string }>(
      "SELECT name, color FROM lists WHERE user_id=$1 AND team_id IS NULL ORDER BY position, name",
      [userId],
    )
  ).rows;
  const tags = (
    await db.query<{ name: string; color: string }>(
      "SELECT name, color FROM tags WHERE user_id=$1 AND team_id IS NULL ORDER BY name",
      [userId],
    )
  ).rows;
  const habits = await loadHabits(db, userId);
  const rows = (
    await db.query<
      Omit<ExportItem, "due_at" | "end_at"> & {
        due_at: Date | null;
        end_at: Date | null;
      }
    >(
      `SELECT i.title, i.notes, i.kind, i.status, i.priority, i.due_at, i.end_at,
              i.estimate_minutes, i.location, i.rrule,
              (SELECT name FROM lists l WHERE l.id = i.list_id) AS list,
              coalesce((SELECT array_agg(t.name ORDER BY t.name) FROM item_tags it
                        JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id), '{}') AS tags
         FROM items i
        WHERE i.user_id=$1 AND i.team_id IS NULL AND i.parent_id IS NULL
        ORDER BY i.created_at`,
      [userId],
    )
  ).rows;
  const items: ExportItem[] = rows.map((r) => ({
    ...r,
    due_at: r.due_at ? r.due_at.toISOString() : null,
    end_at: r.end_at ? r.end_at.toISOString() : null,
  }));
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    lists,
    tags,
    habits,
    items,
  };
}

/** A minimal RFC-4180 CSV parser: quotes, commas and newlines in fields. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) =>
      Object.fromEntries(keys.map((k, n) => [k, (r[n] ?? "").trim()])),
    );
}

/** Turn CSV rows into the archive item shape (title required). */
function itemsFromCsv(rows: Record<string, string>[]): ExportItem[] {
  const pick = (r: Record<string, string>, ...keys: string[]) => {
    for (const k of keys) if (r[k]) return r[k];
    return "";
  };
  const out: ExportItem[] = [];
  for (const r of rows) {
    const title = pick(r, "title", "name", "task");
    if (!title) continue;
    const due = pick(r, "due_at", "due", "due date", "date");
    out.push({
      title: title.slice(0, 200),
      notes: pick(r, "notes", "description", "content"),
      kind:
        pick(r, "kind", "type").toLowerCase() === "event" ? "event" : "task",
      status: "todo",
      priority:
        ["low", "medium", "high"].find(
          (p) => p === pick(r, "priority").toLowerCase(),
        ) ?? "medium",
      due_at: due ? isoOf(due) : null,
      end_at: null,
      estimate_minutes: Number(pick(r, "estimate_minutes", "estimate")) || null,
      location: pick(r, "location"),
      rrule: null,
      list: pick(r, "list", "project") || null,
      tags: pick(r, "tags", "labels")
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }
  return out;
}

/** Parse a date or datetime to an ISO string with offset, or null. */
function isoOf(s: string): string | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s.trim())
    ? new Date(`${s.trim()}T09:00:00`)
    : new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Bring items in from an Orbyn archive or CSV. Lists and tags are matched to
 * the person's own by name (case-insensitive) and created when missing.
 * A dry run validates and counts without writing anything.
 */
export async function importData(
  db: Db,
  user: { id: string; role: SystemRole },
  format: "orbyn" | "csv",
  data: string,
  dryRun: boolean,
): Promise<ImportSummary> {
  let items: ExportItem[];
  try {
    items =
      format === "csv"
        ? itemsFromCsv(parseCsv(data))
        : ((JSON.parse(data) as ExportArchive).items ?? []);
  } catch {
    return {
      created: 0,
      skipped: 0,
      lists_added: 0,
      tags_added: 0,
      sample: [],
      errors: ["The file couldn't be read. Check it's the right format."],
    };
  }

  // Existing lists/tags by lower-cased name, so imports reuse them.
  const listByName = new Map<string, string>();
  for (const r of (
    await db.query<{ id: string; name: string }>(
      "SELECT id, name FROM lists WHERE user_id=$1 AND team_id IS NULL",
      [user.id],
    )
  ).rows)
    listByName.set(r.name.toLowerCase(), r.id);
  const tagByName = new Map<string, string>();
  for (const r of (
    await db.query<{ id: string; name: string }>(
      "SELECT id, name FROM tags WHERE user_id=$1 AND team_id IS NULL",
      [user.id],
    )
  ).rows)
    tagByName.set(r.name.toLowerCase(), r.id);

  let created = 0;
  let skipped = 0;
  let listsAdded = 0;
  let tagsAdded = 0;
  const errors: string[] = [];
  const sample: string[] = [];

  const listId = async (name: string) => {
    const key = name.toLowerCase();
    const found = listByName.get(key);
    if (found) return found;
    if (dryRun) {
      listByName.set(key, "dry");
      listsAdded++;
      return null;
    }
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO lists (user_id, name, position)
         VALUES ($1, $2, (SELECT coalesce(max(position),-1)+1 FROM lists WHERE user_id=$1))
         RETURNING id`,
        [user.id, name.slice(0, 80)],
      )
    ).rows[0].id;
    listByName.set(key, id);
    listsAdded++;
    return id;
  };
  const tagId = async (name: string) => {
    const key = name.toLowerCase();
    const found = tagByName.get(key);
    if (found && found !== "dry") return found;
    if (found === "dry") return null;
    if (dryRun) {
      tagByName.set(key, "dry");
      tagsAdded++;
      return null;
    }
    const id = (
      await db.query<{ id: string }>(
        "INSERT INTO tags (user_id, name) VALUES ($1, $2) RETURNING id",
        [user.id, name.slice(0, 40)],
      )
    ).rows[0].id;
    tagByName.set(key, id);
    tagsAdded++;
    return id;
  };

  for (const raw of items.slice(0, 2000)) {
    try {
      const list = raw.list ? await listId(raw.list) : null;
      const tagIds: string[] = [];
      for (const t of raw.tags ?? []) {
        const id = await tagId(t);
        if (id) tagIds.push(id);
      }
      const parsed = itemData.parse({
        title: raw.title,
        notes: raw.notes ?? "",
        kind: raw.kind === "event" ? "event" : "task",
        status: raw.status ?? "todo",
        priority: raw.priority ?? "medium",
        due_at: raw.due_at ?? null,
        end_at: raw.end_at ?? null,
        estimate_minutes: raw.estimate_minutes ?? null,
        location: raw.location ?? "",
        rrule: raw.rrule ?? null,
        ...(list ? { list_id: list } : {}),
        ...(tagIds.length ? { tag_ids: tagIds } : {}),
      });
      // An event with no start time can't be created; import it as a task.
      if (parsed.kind === "event" && !parsed.due_at) parsed.kind = "task";
      if (sample.length < 5) sample.push(parsed.title);
      if (dryRun) {
        created++;
        continue;
      }
      await mutate(
        db,
        { id: user.id, role: user.role },
        {
          operation: "create",
          data: parsed,
        },
      );
      created++;
    } catch (e) {
      skipped++;
      if (errors.length < 5)
        errors.push(`${raw.title || "(untitled)"}: ${(e as Error).message}`);
    }
  }

  return {
    created,
    skipped,
    lists_added: listsAdded,
    tags_added: tagsAdded,
    sample,
    errors,
  };
}
