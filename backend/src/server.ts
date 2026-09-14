// Single-process mode: every HTTP module plus the status prober in one
// process, for quick local development (`npm run dev -w backend`). Docker
// Compose runs each service separately behind the gateway instead.
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { startProber } from "./modules/status/prober.js";
import { startService } from "./services/http.js";

const stopProber = startProber();
await startService(await buildApp(), env.PORT, stopProber);
