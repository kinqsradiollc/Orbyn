import { approvalScopesInput } from "@orbyn/core";
import type { FastifyInstance } from "fastify";
import { pool, readTransaction, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { routineQuietCheckRoutes } from "./quiet-check-routes.js";
import { routineSetupRoutes } from "./routine-setup-routes.js";
import { routineRecoveryRoutes } from "./routine-recovery-routes.js";
import { readRoutineRuns } from "./routine-runs.js";
import {
  deleteAgentRoutine,
  listAgentRoutines,
  saveAgentRoutine,
} from "./routines.js";

export async function assistantRoutineRoutes(app: FastifyInstance) {
  await routineSetupRoutes(app);
  await routineRecoveryRoutes(app);
  await routineQuietCheckRoutes(app);
  app.get("/me/agent-routines", async (r) => {
    const user = await authenticate(r);
    return listAgentRoutines(pool, user.id);
  });
  app.get("/me/agent-routines/:id/runs", async (r) => {
    const user = await authenticate(r);
    return readTransaction(
      (db) => readRoutineRuns(db, user.id, idParam(r), r.query),
      { primary: true, isolation: "repeatable read" },
    );
  });
  app.post("/me/agent-routines", async (r, reply) => {
    const user = await authenticate(r);
    const routine = await transaction((db) =>
      saveAgentRoutine(db, user.id, null, r.body),
    );
    reply.code(201);
    return routine;
  });
  app.put("/me/agent-routines/:id", async (r) => {
    const user = await authenticate(r);
    return transaction((db) =>
      saveAgentRoutine(db, user.id, idParam(r), r.body),
    );
  });
  app.delete("/me/agent-routines/:id", async (r) => {
    const user = await authenticate(r);
    await transaction((db) => deleteAgentRoutine(db, user.id, idParam(r)));
    return { deleted: true };
  });
  app.get("/me/assistant/approval-scopes", async (r) => {
    const user = await authenticate(r);
    const grant = await assistantPrincipal(user);
    const row = (
      await pool.query<{ approval_scopes: unknown }>(
        "SELECT approval_scopes FROM agent_grants WHERE id = $1 AND user_id = $2",
        [grant.grant_id, user.id],
      )
    ).rows[0];
    return approvalScopesInput.parse(row?.approval_scopes ?? {});
  });
  app.put("/me/assistant/approval-scopes", async (r) => {
    const user = await authenticate(r);
    const grant = await assistantPrincipal(user);
    const scopes = approvalScopesInput.parse(r.body ?? {});
    await pool.query(
      "UPDATE agent_grants SET approval_scopes = $3::jsonb WHERE id = $1 AND user_id = $2",
      [grant.grant_id, user.id, JSON.stringify(scopes)],
    );
    return scopes;
  });
}
