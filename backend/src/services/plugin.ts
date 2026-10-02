import { buildPluginService } from "../app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

await startService(await buildPluginService(), env.PORT);
