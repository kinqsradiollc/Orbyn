// Status service: `node dist/services/status.js` (Compose `status`).
// Probes every component on a schedule and serves the public status report.
import { buildStatusService } from "../app.js";
import { env } from "../config/env.js";
import { startProber } from "../modules/status/prober.js";
import { startService } from "./http.js";

const stopProber = startProber();
await startService(await buildStatusService(), env.PORT, stopProber);
