import type { FastifyInstance } from "fastify";
import { readTransaction, transaction } from "../../db/pool.js";
import { firstParty } from "../proposals/service.js";
import { readRoutineSetupContext, setupAgentRoutine } from "./routine-setup.js";

export async function routineSetupRoutes(app: FastifyInstance) {
  app.get("/me/agent-routines/setup-context", async (r) => {
    const user = await firstParty(r);
    return readTransaction((db) => readRoutineSetupContext(db, user.id), {
      primary: true,
      isolation: "repeatable read",
    });
  });
  app.post("/me/agent-routines/setup", async (r) => {
    const user = await firstParty(r);
    return transaction((db) => setupAgentRoutine(db, user.id, r.body));
  });
}
