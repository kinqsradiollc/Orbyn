// Reminder service: `node dist/services/notifier.js` (Compose `notifier`).
// Schedules and delivers in-app, email, and push reminders. No HTTP port; it
// reports liveness through a heartbeat row the status service reads.
import { runWorker } from "../worker/index.js";

await runWorker();
