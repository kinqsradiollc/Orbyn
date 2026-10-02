import { env } from "../config/env.js";
import { buildAssistantWorker } from "./assistant-worker.js";
import { startService } from "./http.js";

await startService(await buildAssistantWorker("overnight"), env.PORT);
