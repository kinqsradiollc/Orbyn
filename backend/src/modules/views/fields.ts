import type { FastifyInstance } from "fastify";
import {
  checkFieldValue,
  customFieldInput,
  customFieldUpdate,
  fail,
  fieldDatesQuery,
  fieldValueInput,
  fieldValuesQuery,
  hasTeamPermission,
  MAX_FIELDS_PER_SPACE,
  type CustomField,
  type FieldDate,
  type FieldTarget,
  type FieldValue,
  type FieldValues,
  type TargetFields,
  type TeamRole,
} from "@orbyn/core";
import { pool, reader, transaction, type Queryable } from "../../db/pool.js";
import { authenticate, type UserRow } from "../../lib/auth.js";
import { docVisibleTo } from "../../lib/doc-visibility.js";
import { announceDocChange } from "../docs/live.js";
import { idParam } from "../../lib/params.js";
import { membershipRole, requireTeam } from "../../lib/teams.js";
import { visibleOwned } from "../../lib/visibility.js";

/**
 * Your own fields on pages and projects (ORG-02). A field belongs to a
 * space — your own things, or a team's — and every page (or project) there
 * shares it. Anyone who can change a team's pages can add a field there;
 * renaming, changing choices and removing it (which clears every value) is
 * for whoever made it and the team's owners and admins. Values are set by
 * anyone who can change the page or project, and read by anyone who can
 * open it. A date field can show on the calendar as a deadline (DATA-07).
 */

type FieldRow = Omit<CustomField, "created_at" | "can_manage"> & {
  created_at: Date;
  role: TeamRole | null;
};

const FIELD_COLUMNS = `f.id, f.user_id, f.team_id, t.name AS team_name,
  f.applies_to, f.name, f.type, f.options, f.on_calendar, f.position,
  f.created_at, tm.role`;
const FIELD_FROM = `custom_fields f
  LEFT JOIN teams t ON t.id = f.team_id
  LEFT JOIN team_members tm ON tm.team_id = f.team_id AND tm.user_id = $1`;
/** Fields `$1` can see: their own, and their teams'. */
const fieldSeen = visibleOwned("f", "user_id");

const canManage = (row: FieldRow, userId: string) =>
  row.team_id
    ? (row.user_id === userId &&
        !!row.role &&
        hasTeamPermission(row.role, "items:write")) ||
      (!!row.role && hasTeamPermission(row.role, "team:update"))
    : row.user_id === userId;

const toField = (row: FieldRow, userId: string): CustomField => ({
  id: row.id,
  user_id: row.user_id,
  team_id: row.team_id,
  team_name: row.team_name ?? null,
  applies_to: row.applies_to,
  name: row.name,
  type: row.type,
  options: row.options ?? [],
  on_calendar: row.on_calendar,
  position: row.position,
  created_at: row.created_at.toISOString(),
  can_manage: canManage(row, userId),
});

/** Every field `userId` can see, for pages or projects or both. */
export async function visibleFields(
  db: Queryable,
  userId: string,
  appliesTo?: FieldTarget,
): Promise<CustomField[]> {
  return (
    await db.query<FieldRow>(
      `SELECT ${FIELD_COLUMNS} FROM ${FIELD_FROM}
        WHERE ${fieldSeen} AND ($2::text IS NULL OR f.applies_to = $2)
        ORDER BY f.team_id NULLS FIRST, f.applies_to, f.position, lower(f.name), f.id`,
      [userId, appliesTo ?? null],
    )
  ).rows.map((r) => toField(r, userId));
}

/** A field, for someone who may change it (404 when they can't see it). */
async function requireField(
  db: Queryable,
  id: string,
  u: UserRow,
  manage: boolean,
): Promise<CustomField> {
  const row = (
    await db.query<FieldRow>(
      `SELECT ${FIELD_COLUMNS} FROM ${FIELD_FROM}
        WHERE f.id = $2 AND ${fieldSeen}`,
      [u.id, id],
    )
  ).rows[0];
  if (!row) fail(404, "Field not found");
  if (manage && !canManage(row, u.id))
    fail(
      403,
      "Only whoever made this field, or the team's owners and admins, can change it.",
    );
  return toField(row, u.id);
}

type TargetRow = {
  id: string;
  user_id: string;
  team_id: string | null;
  title: string;
  role: TeamRole | null;
};

/** The page or project a value is for, if `userId` can open it. */
async function loadTarget(
  db: Queryable,
  userId: string,
  target: FieldTarget,
  id: string,
): Promise<(TargetRow & { can_write: boolean }) | null> {
  const table = target === "page" ? "docs" : "projects";
  const title = target === "page" ? "x.title" : "x.name";
  const row = (
    await db.query<TargetRow>(
      `SELECT x.id, x.user_id, x.team_id, ${title} AS title, tm.role
         FROM ${table} x
         LEFT JOIN team_members tm ON tm.team_id = x.team_id AND tm.user_id = $1
        WHERE x.id = $2
          AND ${
            target === "page"
              ? docVisibleTo("$1", "x")
              : "((x.team_id IS NULL AND x.user_id = $1) OR tm.user_id IS NOT NULL)"
          }`,
      [userId, id],
    )
  ).rows[0];
  if (!row) return null;
  return {
    ...row,
    can_write: row.team_id
      ? !!row.role && hasTeamPermission(row.role, "items:write")
      : row.user_id === userId,
  };
}

/** The people a Person field in a space can name: you, or the team's members. */
async function spacePeople(
  db: Queryable,
  userId: string,
  teamId: string | null,
): Promise<{ id: string; name: string }[]> {
  return (
    await db.query<{ id: string; name: string }>(
      teamId
        ? `SELECT u.id, u.name FROM team_members m JOIN users u ON u.id = m.user_id
            WHERE m.team_id = $1 ORDER BY lower(u.name), u.id`
        : "SELECT id, name FROM users WHERE id = $1",
      [teamId ?? userId],
    )
  ).rows;
}

/**
 * The values of fields on pages or projects, by id then field. Only values
 * of fields in the page's (or project's) own space count, so a page moved
 * to another team leaves the old team's fields behind.
 */
export async function fieldValuesFor(
  db: Queryable,
  target: FieldTarget,
  ids: string[],
): Promise<Map<string, FieldValues>> {
  const out = new Map<string, FieldValues>();
  if (!ids.length) return out;
  const table = target === "page" ? "docs" : "projects";
  const column = target === "page" ? "doc_id" : "project_id";
  const rows = (
    await db.query<{ target_id: string; field_id: string; value: FieldValue }>(
      `SELECT v.${column} AS target_id, v.field_id, v.value
         FROM custom_field_values v
         JOIN custom_fields f ON f.id = v.field_id
         JOIN ${table} x ON x.id = v.${column}
        WHERE v.${column} = ANY ($1::uuid[])
          AND f.team_id IS NOT DISTINCT FROM x.team_id
          AND (f.team_id IS NOT NULL OR f.user_id = x.user_id)`,
      [ids],
    )
  ).rows;
  for (const r of rows) {
    const values = out.get(r.target_id) ?? {};
    values[r.field_id] = r.value;
    out.set(r.target_id, values);
  }
  return out;
}

/**
 * Date fields shown on the calendar, from `from` to `to` (days), on the
 * pages and projects `userId` can open: "Essay due · Lab 3 notes".
 */
export async function fieldDates(
  db: Queryable,
  userId: string,
  from: string,
  to: string,
  teams?: string[] | null,
): Promise<FieldDate[]> {
  const rows = (
    await db.query<FieldDate>(
      `SELECT f.id AS field_id, f.name AS field_name, 'page' AS target,
              d.id AS target_id, d.title, v.value #>> '{}' AS date, d.team_id
         FROM custom_field_values v
         JOIN custom_fields f ON f.id = v.field_id AND f.on_calendar AND f.type = 'date'
         JOIN docs d ON d.id = v.doc_id AND d.deleted_at IS NULL
        WHERE jsonb_typeof(v.value) = 'string'
          AND v.value #>> '{}' BETWEEN $2 AND $3
          AND f.team_id IS NOT DISTINCT FROM d.team_id
          AND ${visibleOwned("d", "user_id")}
          AND (d.team_id IS NOT NULL OR f.user_id = $1)
          AND ($4::uuid[] IS NULL OR d.team_id IS NULL OR d.team_id = ANY ($4::uuid[]))
       UNION ALL
       SELECT f.id, f.name, 'project', p.id, p.name, v.value #>> '{}', p.team_id
         FROM custom_field_values v
         JOIN custom_fields f ON f.id = v.field_id AND f.on_calendar AND f.type = 'date'
         JOIN projects p ON p.id = v.project_id
        WHERE jsonb_typeof(v.value) = 'string'
          AND v.value #>> '{}' BETWEEN $2 AND $3
          AND f.team_id IS NOT DISTINCT FROM p.team_id
          AND ${visibleOwned("p", "user_id")}
          AND (p.team_id IS NOT NULL OR f.user_id = $1)
          AND ($4::uuid[] IS NULL OR p.team_id IS NULL OR p.team_id = ANY ($4::uuid[]))
        ORDER BY date, field_name, title
        LIMIT 1000`,
      [userId, from, to, teams ?? null],
    )
  ).rows;
  return rows;
}

export async function fieldRoutes(app: FastifyInstance) {
  /** Every field you can see (yours and your teams'), for pages and projects. */
  app.get("/fields", async (r): Promise<CustomField[]> => {
    const u = await authenticate(r);
    return visibleFields(reader(r.headers), u.id);
  });

  app.post("/fields", async (r, reply): Promise<CustomField> => {
    const u = await authenticate(r);
    const data = customFieldInput.parse(r.body ?? {});
    if (data.team_id) await requireTeam(data.team_id, u, "items:write");
    const field = await transaction(async (db) => {
      // One writer at a time per space, so the cap and the position hold.
      await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `fields:${data.team_id ?? u.id}:${data.applies_to}`,
      ]);
      const { count, taken } = (
        await db.query<{ count: number; taken: boolean }>(
          `SELECT count(*)::int AS count,
                  bool_or(lower(name) = lower($4)) AS taken
             FROM custom_fields
            WHERE applies_to = $3
              AND (CASE WHEN $2::uuid IS NULL THEN team_id IS NULL AND user_id = $1
                        ELSE team_id = $2 END)`,
          [u.id, data.team_id, data.applies_to, data.name],
        )
      ).rows[0];
      if (taken) fail(409, `There's already a field called ${data.name} here.`);
      if (count >= MAX_FIELDS_PER_SPACE)
        fail(
          409,
          `A space can have ${MAX_FIELDS_PER_SPACE} fields for ${data.applies_to === "page" ? "pages" : "projects"}. Remove one first.`,
        );
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO custom_fields
             (user_id, team_id, applies_to, name, type, options, on_calendar, position)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
          [
            u.id,
            data.team_id,
            data.applies_to,
            data.name,
            data.type,
            JSON.stringify(data.options),
            data.on_calendar,
            count,
          ],
        )
      ).rows[0].id;
      return requireField(db, id, u, false);
    });
    reply.code(201);
    return field;
  });

  app.put("/fields/:id", async (r): Promise<CustomField> => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = customFieldUpdate.parse(r.body ?? {});
    return transaction(async (db) => {
      const field = await requireField(db, id, u, true);
      if (body.on_calendar && field.type !== "date")
        fail(400, "Only a date field can show on the calendar.");
      if (body.options && field.type !== "select")
        fail(400, "Only a choice field has choices.");
      if (body.options && !body.options.length)
        fail(400, "A choice field needs at least one choice.");
      if (body.name && body.name.toLowerCase() !== field.name.toLowerCase()) {
        const taken = (
          await db.query(
            `SELECT 1 FROM custom_fields
              WHERE id <> $1 AND applies_to = $2 AND lower(name) = lower($3)
                AND (CASE WHEN $4::uuid IS NULL THEN team_id IS NULL AND user_id = $5
                          ELSE team_id = $4 END)`,
            [id, field.applies_to, body.name, field.team_id, field.user_id],
          )
        ).rowCount;
        if (taken)
          fail(409, `There's already a field called ${body.name} here.`);
      }
      await db.query(
        `UPDATE custom_fields SET name = coalesce($2, name),
           options = coalesce($3::jsonb, options),
           on_calendar = coalesce($4, on_calendar),
           position = coalesce($5, position), updated_at = now()
         WHERE id = $1`,
        [
          id,
          body.name ?? null,
          body.options ? JSON.stringify(body.options) : null,
          body.on_calendar ?? null,
          body.position ?? null,
        ],
      );
      // A choice that was taken away no longer names anything.
      if (body.options)
        await db.query(
          `DELETE FROM custom_field_values
            WHERE field_id = $1 AND NOT ($2::jsonb @> jsonb_build_array(value))`,
          [id, JSON.stringify(body.options)],
        );
      return requireField(db, id, u, false);
    });
  });

  /** Removing a field clears it from every page or project that had it. */
  app.delete("/fields/:id", async (r, reply) => {
    const u = await authenticate(r);
    const id = idParam(r);
    await transaction(async (db) => {
      await requireField(db, id, u, true);
      await db.query("DELETE FROM custom_fields WHERE id = $1", [id]);
    });
    reply.code(204);
  });

  /** A page's or project's fields and values, for its Info panel. */
  app.get("/fields/values", async (r): Promise<TargetFields> => {
    const u = await authenticate(r);
    const q = fieldValuesQuery.parse(r.query ?? {});
    const db = reader(r.headers);
    const target = await loadTarget(db, u.id, q.target, q.id);
    if (!target)
      fail(
        404,
        q.target === "page" ? "Document not found" : "Project not found",
      );
    const fields = (await visibleFields(db, u.id, q.target)).filter(
      (f) =>
        f.team_id === target.team_id &&
        (target.team_id !== null || f.user_id === target.user_id),
    );
    const values = (await fieldValuesFor(db, q.target, [q.id])).get(q.id) ?? {};
    return {
      target: q.target,
      target_id: q.id,
      team_id: target.team_id,
      fields,
      values,
      can_write: target.can_write,
      people: await spacePeople(db, target.user_id, target.team_id),
    };
  });

  /** Set one field on one page or project; null (or empty text) clears it. */
  app.put("/fields/:id/value", async (r) => {
    const u = await authenticate(r);
    const id = idParam(r);
    const body = fieldValueInput.parse(r.body ?? {});
    const out = await transaction(async (db) => {
      const field = await requireField(db, id, u, false);
      if (field.applies_to !== body.target)
        fail(
          400,
          `${field.name} is a field for ${field.applies_to === "page" ? "pages" : "projects"}.`,
        );
      const target = await loadTarget(db, u.id, body.target, body.target_id);
      if (!target)
        fail(
          404,
          body.target === "page" ? "Document not found" : "Project not found",
        );
      if (
        field.team_id !== target.team_id ||
        (target.team_id === null && field.user_id !== target.user_id)
      )
        fail(
          400,
          `${field.name} belongs to another space, so it can't be set here.`,
        );
      if (!target.can_write) fail(403, "You can read this, but not change it.");
      const checked = checkFieldValue(field, body.value);
      if (!checked.ok) fail(400, checked.reason);
      if (field.type === "person" && checked.value !== null) {
        const allowed = target.team_id
          ? !!(await membershipRole(target.team_id, String(checked.value), db))
          : checked.value === target.user_id;
        if (!allowed)
          fail(
            400,
            target.team_id
              ? "Only someone in the team can be named here."
              : "Only you can be named on your own things.",
          );
      }
      const column = body.target === "page" ? "doc_id" : "project_id";
      if (checked.value === null)
        await db.query(
          `DELETE FROM custom_field_values WHERE field_id = $1 AND ${column} = $2`,
          [id, body.target_id],
        );
      else
        await db.query(
          `INSERT INTO custom_field_values (field_id, ${column}, value, updated_by)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (field_id, ${column}) WHERE ${column} IS NOT NULL
           DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
                         updated_at = now()`,
          [id, body.target_id, JSON.stringify(checked.value), u.id],
        );
      // A value is a change to the page or project: "Last changed" and
      // "changed in the last N days" count it. A page's version stays, so
      // an editor that has it open saves on without a conflict.
      const touched = (
        await db.query<{ version: number }>(
          body.target === "page"
            ? "UPDATE docs SET updated_at = now() WHERE id = $1 RETURNING version"
            : "UPDATE projects SET updated_at = now() WHERE id = $1 RETURNING 0 AS version",
          [body.target_id],
        )
      ).rows[0];
      return {
        field_id: id,
        value: checked.value,
        version: touched?.version ?? 0,
      };
    });
    // Open pages hear of it, so their Info panel reads the values afresh.
    if (body.target === "page")
      await announceDocChange(
        pool,
        body.target_id,
        out.version,
        typeof r.headers["x-orbyn-editor"] === "string"
          ? r.headers["x-orbyn-editor"].slice(0, 64)
          : "",
        { fields: true },
      ).catch(() => {});
    return { field_id: out.field_id, value: out.value };
  });

  /** Date fields on the calendar between two days (DATA-07). */
  app.get("/fields/dates", async (r): Promise<FieldDate[]> => {
    const u = await authenticate(r);
    const q = fieldDatesQuery.parse(r.query ?? {});
    return fieldDates(reader(r.headers), u.id, q.from, q.to);
  });
}
