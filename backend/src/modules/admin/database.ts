import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  fail,
  type AdminDatabaseColumn,
  type AdminDatabaseIndex,
  type AdminDatabaseTable,
  type AdminDatabaseTableDetail,
  type AdminDatabaseRows,
} from "@orbyn/core";
import { reader } from "../../db/pool.js";
import { authorize } from "../../lib/auth.js";

const PAGE_SIZE = 25;
const SAFE_COLUMNS =
  /^(id|[a-z0-9_]+_id|role|status|state|kind|type|position|version|attempts|enabled|disabled|email_verified|[a-z0-9_]+_at)$/;
const EXTRA_COLUMNS: Record<string, string[]> = {
  users: ["name", "email"],
  teams: ["name"],
  migrations: ["name"],
  audit_log: ["action", "target_type", "actor_email"],
  status_checks: ["service"],
  service_heartbeats: ["service"],
};

const safeValue = (table: string, column: string, value: unknown) => {
  if (value === null) return null;
  if (!SAFE_COLUMNS.test(column) && !EXTRA_COLUMNS[table]?.includes(column))
    return "••••";
  if (typeof value === "object") return "••••";
  return typeof value === "string" && value.length > 160
    ? `${value.slice(0, 160)}…`
    : value;
};

const TABLES = `SELECT c.relname AS name,
  greatest(c.reltuples, 0)::int AS estimated_rows,
  pg_total_relation_size(c.oid)::float8 AS total_bytes,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
  obj_description(c.oid, 'pg_class') AS description
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')`;

/** Database structure for operators. No SQL execution or private row content. */
export function adminDatabaseRoutes(app: FastifyInstance) {
  app.get(
    "/admin/database/tables",
    async (r): Promise<AdminDatabaseTable[]> => {
      await authorize(r, "system:manage");
      return (
        await reader(r.headers).query<AdminDatabaseTable>(
          `${TABLES} ORDER BY c.relname`,
        )
      ).rows;
    },
  );

  app.get<{ Params: { name: string } }>(
    "/admin/database/tables/:name",
    async (r): Promise<AdminDatabaseTableDetail> => {
      await authorize(r, "system:manage");
      const { name } = r.params;
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) fail(400, "Invalid table name");
      const db = reader(r.headers);
      const table = (
        await db.query<AdminDatabaseTable>(`${TABLES} AND c.relname=$1`, [name])
      ).rows[0];
      if (!table) fail(404, "Table not found");
      const [columns, indexes] = await Promise.all([
        db.query<AdminDatabaseColumn>(
          `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS default_value,
            COALESCE(i.indisprimary, false) AS primary_key,
            col_description(c.oid, a.attnum) AS description
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
           LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
           LEFT JOIN pg_index i ON i.indrelid=c.oid AND i.indisprimary
             AND a.attnum=ANY(i.indkey)
           WHERE n.nspname='public' AND c.relname=$1 AND c.relkind IN ('r','p')
           ORDER BY a.attnum`,
          [name],
        ),
        db.query<AdminDatabaseIndex>(
          `SELECT indexname AS name, indexdef AS definition
           FROM pg_indexes WHERE schemaname='public' AND tablename=$1
           ORDER BY indexname`,
          [name],
        ),
      ]);
      return { table, columns: columns.rows, indexes: indexes.rows };
    },
  );

  app.get<{ Params: { name: string }; Querystring: { offset?: string } }>(
    "/admin/database/tables/:name/rows",
    async (r): Promise<AdminDatabaseRows> => {
      await authorize(r, "system:manage");
      const { name } = r.params;
      if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) fail(400, "Invalid table name");
      const { offset } = z
        .object({
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .parse(r.query);
      const db = reader(r.headers);
      const table = (
        await db.query<{ oid: number; relkind: string }>(
          `SELECT c.oid, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relname=$1 AND c.relkind IN ('r','p')`,
          [name],
        )
      ).rows[0];
      if (!table) fail(404, "Table not found");
      const keys = (
        await db.query<{ name: string }>(
          `SELECT a.attname AS name FROM pg_index i
           JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, position) ON true
           JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
           WHERE i.indrelid=$1 AND i.indisprimary ORDER BY k.position`,
          [table.oid],
        )
      ).rows;
      const order = keys.length
        ? ` ORDER BY ${keys.map(({ name: column }) => `t."${column.replaceAll('"', '""')}"`).join(", ")}`
        : table.relkind === "r"
          ? " ORDER BY t.ctid"
          : "";
      const connection = await db.connect();
      try {
        await connection.query("BEGIN READ ONLY");
        await connection.query("SET LOCAL statement_timeout = '3000ms'");
        // The identifier is checked above and resolved in pg_catalog first.
        const result = await connection.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(t) AS row FROM public."${name}" t${order} LIMIT $1 OFFSET $2`,
          [PAGE_SIZE + 1, offset],
        );
        await connection.query("COMMIT");
        const rows = result.rows
          .slice(0, PAGE_SIZE)
          .map(({ row }) =>
            Object.fromEntries(
              Object.entries(row).map(([column, value]) => [
                column,
                safeValue(name, column, value),
              ]),
            ),
          );
        return {
          rows,
          limit: PAGE_SIZE,
          offset,
          has_more: result.rows.length > PAGE_SIZE,
        };
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
    },
  );
}
