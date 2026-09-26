// Search by meaning: `node dist/services/measure.js` (Compose `measure`,
// profile `semantic`). Measures pages waiting in doc_embedding_queue with
// the embedding model an admin chose, in its own process, so a slow or
// failing provider never holds up reminders. Off by default: it does
// nothing until an admin turns search by meaning on (Admin, AI), which
// needs pgvector in the database image. No HTTP port; it reports liveness
// through a heartbeat row the status service and Admin read.
import { closeDatabase } from "../db/pool.js";
import { runMeasurer } from "../modules/search/semantic.js";

await runMeasurer();
await closeDatabase();
process.exit(0);
