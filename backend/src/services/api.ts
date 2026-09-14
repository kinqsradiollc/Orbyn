// Planner API service: `node dist/services/api.js` (Compose `api`).
import { buildApiService } from "../app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

await startService(await buildApiService(), env.PORT);
