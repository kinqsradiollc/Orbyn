// Entry point: `node dist/migrate.js` (Compose `migrate` service) or `npm run migrate`.
import { migrate } from "./db/migrate.js";
import { rewrapLegacySecrets } from "./lib/rewrap-secrets.js";
import { pool } from "./db/pool.js";

await migrate();
const rewrapped = await rewrapLegacySecrets();
if (rewrapped) console.log(`Rewrapped ${rewrapped} legacy encrypted values.`);
await pool.end();
