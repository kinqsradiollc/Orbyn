import { startPluginAiWorker } from "../modules/plugin/inference-worker.js";
import { buildPluginService } from "../app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

const app = await buildPluginService();
const stop = startPluginAiWorker(
  { mcp: env.MCP_PUBLIC_URL, plugin: env.PLUGIN_PUBLIC_URL },
  () => app.log.error("Plugin inference worker failed"),
);
app.addHook("onClose", async () => stop());
await startService(app, env.PORT, stop);
