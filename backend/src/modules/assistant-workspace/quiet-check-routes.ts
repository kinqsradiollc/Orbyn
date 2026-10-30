import type { FastifyInstance } from "fastify";
import { transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { firstParty } from "../proposals/service.js";
import {
  readRoutineQuietPolicy,
  saveRoutineQuietPolicy,
} from "./routine-quiet-checks.js";
import { readRoutineQuietChecks } from "./quiet-check-evidence.js";
export async function routineQuietCheckRoutes(app: FastifyInstance) {
  app.get("/me/agent-routines/:id/quiet-check-policy", async (r) => {
    const user = await firstParty(r);
    return transaction((db) => readRoutineQuietPolicy(db, user.id, idParam(r)));
  });
  app.put("/me/agent-routines/:id/quiet-check-policy", async (r) => {
    const user = await firstParty(r);
    return transaction((db) =>
      saveRoutineQuietPolicy(db, user.id, idParam(r), r.body),
    );
  });
  app.get("/me/agent-routines/:id/runs/:runId/quiet-checks", async (r) => {
    const user = await authenticate(r);
    return transaction((db) =>
      readRoutineQuietChecks(db, user.id, idParam(r), idParam(r, "runId")),
    );
  });
}
