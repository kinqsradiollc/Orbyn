// Realtime service: `node dist/services/realtime.js` (Compose `realtime`).
// Holds the apps' long-lived streams (live news, live documents) so the API
// copies only ever serve short requests.
import { buildRealtimeService } from "../app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

await startService(await buildRealtimeService(), env.PORT);
