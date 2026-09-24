import pg from "pg";
import { env } from "../config/env.js";

/** The primary: every write, every transaction, and reads that must be fresh. */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
});

/** A read replica when DATABASE_READ_URL is set; otherwise the primary. */
export const readPool = env.DATABASE_READ_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_READ_URL,
      max: env.DB_POOL_MAX,
    })
  : pool;

/** Clients send "primary" here for a few seconds after their own writes. */
export const CONSISTENCY_HEADER = "x-orbyn-consistency";

/**
 * Where a request's lag-tolerant reads go: the replica, unless none is
 * configured or the client has just written and asks for the primary so it
 * sees its own change (read-your-writes). Sign-in checks never use this.
 */
export function reader(
  headers?: Record<string, string | string[] | undefined>,
): pg.Pool {
  return readPool !== pool && headers?.[CONSISTENCY_HEADER] !== "primary"
    ? readPool
    : pool;
}

/**
 * An idle connection can drop when PgBouncer or Postgres restarts. pg emits
 * that as an "error" event on the pool, which would crash the process if no
 * one listened; log it instead; the pool replaces the connection on next use.
 */
const onIdleError = (which: string) => (error: Error) =>
  console.error(
    JSON.stringify({
      event: "db_idle_connection_error",
      pool: which,
      message: error.message,
    }),
  );
pool.on("error", onIdleError("primary"));
if (readPool !== pool) readPool.on("error", onIdleError("replica"));

export async function closeDatabase() {
  await pool.end();
  if (readPool !== pool) await readPool.end();
}

export type Db = pg.PoolClient;
/** Anything that runs queries: the pool, the read replica, or a transaction. */
export type Queryable = Pick<pg.Pool, "query">;

/** Run `fn` inside a transaction on the primary, rolling back on any error. */
export async function transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

/**
 * Run `fn` in a read-only transaction (BEGIN READ ONLY), on the replica
 * unless `primary` is asked for. Postgres itself then refuses any write, so
 * a read that turns out to write (a sync hidden in a helper) fails loudly
 * instead of changing data. Used for every read an outside agent makes.
 */
export async function readTransaction<T>(
  fn: (db: Db) => Promise<T>,
  options: { primary?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const db = await (options.primary ? pool : readPool).connect();
  try {
    await db.query("BEGIN READ ONLY");
    if (options.timeoutMs)
      await db.query(
        `SET LOCAL statement_timeout = ${Math.max(100, Math.round(options.timeoutMs))}`,
      );
    const result = await fn(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

/** Run a query on a transaction client when given one, otherwise on the primary. */
export const query = <R extends pg.QueryResultRow = any>(
  text: string,
  values: unknown[] = [],
  db?: Db,
) => (db ? db.query<R>(text, values) : pool.query<R>(text, values));
