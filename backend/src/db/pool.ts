import pg from "pg";
import { env } from "../config/env.js";

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
});

export type Db = pg.PoolClient;

/** Run `fn` inside a transaction, rolling back on any thrown error. */
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

/** Run a query on a transaction client when given one, otherwise on the pool. */
export const query = <R extends pg.QueryResultRow = any>(
  text: string,
  values: unknown[] = [],
  db?: Db,
) => (db ? db.query<R>(text, values) : pool.query<R>(text, values));
