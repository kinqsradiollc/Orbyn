// File store: `node dist/services/files.js` (Compose `files`). Holds files
// uploaded for importing into Docs, encrypted, until the converter has read
// them, and never longer than a day. Uploads reach it through the gateway's
// /files/u/ route; only the converter can read a file back.
import { buildFilesService } from "../app.js";
import { env } from "../config/env.js";
import { startService } from "./http.js";

await startService(await buildFilesService(), env.PORT);
