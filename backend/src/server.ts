// Entry point: `node dist/server.js` (Compose `api` service) or `npm run dev`.
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/pool.js";

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: env.PORT });

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
