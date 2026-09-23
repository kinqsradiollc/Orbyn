// Import converter: `node dist/services/converter.js` (Compose `converter`).
// Turns uploaded PDFs, Word files and photos into Orbyn pages in Uploads,
// sending scanned pages to the OCR service when OCR_URL is set. No HTTP
// port; it reports liveness through a heartbeat row the status service reads.
import { closeDatabase } from "../db/pool.js";
import { runConverter } from "../modules/imports/converter.js";

await runConverter();
await closeDatabase();
process.exit(0);
