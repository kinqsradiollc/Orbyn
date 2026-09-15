/**
 * Imported first by every test that touches PostgreSQL. Tests use their own
 * database and refuse to run unless it is provably a test database:
 *
 * 1. Only TEST_DATABASE_URL is used, never DATABASE_URL (the app's database).
 * 2. The database name must end in "_test".
 * 3. The database must carry the server-side marker orbyn.environment = 'test',
 *    set when the test database is created (backend/tests/db/init-test-db.sql).
 *    Development and production databases never have it.
 */
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import pg from "pg";

loadEnv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    "Set TEST_DATABASE_URL to the test database (see docs/setup.md#tests). Tests never use DATABASE_URL.",
  );

let name: string;
try {
  name = decodeURIComponent(new URL(url).pathname.slice(1));
} catch {
  throw new Error("TEST_DATABASE_URL is not a valid PostgreSQL URL.");
}
if (!name.endsWith("_test"))
  throw new Error(
    `Refusing to run tests: database "${name}" does not end in "_test".`,
  );
if (
  process.env.DATABASE_URL &&
  process.env.DATABASE_URL === url &&
  !process.env.CI
)
  console.warn(
    "DATABASE_URL points at the test database; tests only use TEST_DATABASE_URL.",
  );

const client = new pg.Client({ connectionString: url });
await client.connect();
const marker = (
  await client.query<{ env: string | null }>(
    "SELECT current_setting('orbyn.environment', true) AS env",
  )
).rows[0].env;
await client.end();
if (marker !== "test")
  throw new Error(
    `Refusing to run tests: database "${name}" is not marked as a test database. ` +
      `If it really is disposable, run: ALTER DATABASE ${name} SET orbyn.environment TO 'test';`,
  );

// Everything the tests import after this point connects to the test database.
process.env.DATABASE_URL = url;
