// AI assistant service: `node dist/services/ai.js` (Compose `ai`).
import { buildAiService } from "../app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

await startService(await buildAiService(), env.PORT);
