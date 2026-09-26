import type { FastifyInstance } from "fastify";
import {
  IMPORT_LIMITS,
  fail,
  importCreateInput,
  importRefusal,
  importTypeOf,
} from "@orbyn/core";
import { pool } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { requireTeam } from "../../lib/teams.js";
import { announceTo } from "../presence/live.js";
import { importsEnabled, uploadToken } from "./tokens.js";
import {
  cancelImport,
  importCapabilities,
  jobs,
  startImport,
} from "./service.js";

export async function importRoutes(app: FastifyInstance) {
  /** What this server can read, so the apps can say so before an upload. */
  app.get("/imports/capabilities", async (r) => {
    await authenticate(r);
    return importCapabilities();
  });

  /**
   * Start an import: returns the import and a link to upload the file to,
   * good for ten minutes and one upload. The file store queues it for the
   * converter as soon as the upload finishes.
   */
  app.post("/imports", async (r, reply) => {
    const u = await authenticate(r);
    const d = importCreateInput.parse(r.body ?? {});
    const started = await startImport(pool, u, d);
    reply.code(201);
    return started;
  });

  /** Your imports: everything still going, and the last week's finished ones. */
  app.get("/imports", async (r) => {
    const u = await authenticate(r);
    return jobs(pool, u.id);
  });

  app.get("/imports/:id", async (r) => {
    const u = await authenticate(r);
    const job = (await jobs(pool, u.id, idParam(r)))[0];
    if (!job) fail(404, "Import not found");
    return job;
  });

  /**
   * Cancel an import still going, or clear a finished one from the list.
   * A cancelled import's file is deleted by the converter or the file
   * store's sweep, whichever gets there first.
   */
  app.delete("/imports/:id", async (r, reply) => {
    const u = await authenticate(r);
    await cancelImport(pool, u.id, idParam(r));
    return reply.code(204).send();
  });
}
