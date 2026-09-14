import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: config.PORT });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
