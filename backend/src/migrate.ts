// Entry point: `node dist/migrate.js` (Compose `migrate` service) or `npm run migrate`.
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";

await migrate();
await pool.end();
