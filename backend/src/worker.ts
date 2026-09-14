// Entry point: `node dist/worker.js` (Compose `worker` service) or `npm run worker`.
import { runWorker } from "./worker/index.js";

await runWorker();
