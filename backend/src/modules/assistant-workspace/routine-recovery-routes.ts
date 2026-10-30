import type { FastifyInstance } from "fastify";
import { transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { firstParty } from "../proposals/service.js";
import {
  readRoutineRetryPolicy,
  saveRoutineRetryPolicy,
  stopRoutineRecovery,
} from "./routine-recovery.js";
import { readRoutineRecoveryDetails } from "./routine-recovery-evidence.js";
export async function routineRecoveryRoutes(app: FastifyInstance) {
  app.get("/me/agent-routines/:id/retry-policy", async (r) => {
    const user = await firstParty(r);
    return transaction((db) => readRoutineRetryPolicy(db, user.id, idParam(r)));
  });
  app.put("/me/agent-routines/:id/retry-policy", async (r) => {
    const user = await firstParty(r);
    return transaction((db) =>
      saveRoutineRetryPolicy(db, user.id, idParam(r), r.body),
    );
  });
  app.get("/me/agent-routines/:id/runs/:runId/recovery", async (r) => {
    const user = await authenticate(r);
    return transaction((db) =>
      readRoutineRecoveryDetails(db, user.id, idParam(r), idParam(r, "runId")),
    );
  });
  app.post("/me/agent-routines/:id/runs/:runId/stop", async (r) => {
    const user = await firstParty(r),
      routine = idParam(r),
      id = idParam(r, "runId");
    const { jobs } = await transaction((db) =>
      stopRoutineRecovery(db, user.id, routine, id, r.body),
    );
    const { stopAssistantJob } = await import("../ai/agent/run.js");
    for (const job of jobs) await stopAssistantJob(job, user, app.log);
    return transaction((db) =>
      readRoutineRecoveryDetails(db, user.id, routine, id),
    );
  });
}
