import type { FastifyInstance } from "fastify";
import {
  fail,
  questionAnswerInput,
  type AgentInboxSettings,
  type AgentQuestion,
  type AgentRule,
  type NewAgentWake,
} from "@orbyn/core";
import type { FastifyRequest } from "fastify";
import { pool, reader } from "../../db/pool.js";
import { authenticate, isApiKeyRequest } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import {
  addRule,
  clearWake,
  deleteRule,
  inboxSettings,
  listRules,
  setInboxMutes,
  setWake,
  updateRule,
} from "./service.js";
import { answerQuestion, openQuestions } from "./questions.js";
import { testWake } from "./wake.js";

/**
 * The person's side of agents' inboxes (H0), signed in to Orbyn's own apps
 * only (keys are refused): what each connection is sent, its wake-up
 * address, standing rules, and answering the questions agents ask.
 */
/** The person signed in to Orbyn's own apps: keys are refused. */
async function firstParty(r: FastifyRequest) {
  const u = await authenticate(r);
  if (isApiKeyRequest(r))
    fail(403, "Only you, signed in to Orbyn, can do this. Keys can't.");
  return u;
}

export async function agentInboxRoutes(app: FastifyInstance) {
  app.get("/me/agents/:id/inbox", async (r): Promise<AgentInboxSettings> => {
    const u = await firstParty(r);
    const s = await inboxSettings(reader(r.headers), u.id, idParam(r));
    if (!s) fail(404, "Connection not found");
    return s;
  });

  // "Send to this agent" per kind.
  app.put("/me/agents/:id/inbox", async (r): Promise<AgentInboxSettings> =>
    setInboxMutes((await firstParty(r)).id, idParam(r), r.body as never, r.id),
  );

  // The wake-up address; its signing secret is shown once.
  app.put(
    "/me/agents/:id/wake",
    strictRateLimit,
    async (r): Promise<NewAgentWake> =>
      setWake((await firstParty(r)).id, idParam(r), r.body as never, r.id),
  );

  app.delete("/me/agents/:id/wake", async (r): Promise<AgentInboxSettings> =>
    clearWake((await firstParty(r)).id, idParam(r), r.id),
  );

  // Call the wake-up address now and say what it answered.
  app.post("/me/agents/:id/wake/test", strictRateLimit, async (r) =>
    testWake((await firstParty(r)).id, idParam(r)),
  );

  app.get("/me/agent-rules", async (r): Promise<AgentRule[]> => {
    const u = await firstParty(r);
    return listRules(reader(r.headers), u.id);
  });

  app.post("/me/agent-rules", async (r, reply): Promise<AgentRule> => {
    const u = await firstParty(r);
    const made = await addRule(u.id, r.body as never);
    reply.code(201);
    return made;
  });

  app.put("/me/agent-rules/:id", async (r): Promise<AgentRule> => {
    const u = await firstParty(r);
    return updateRule(pool, u.id, idParam(r), r.body as never);
  });

  app.delete("/me/agent-rules/:id", async (r, reply) => {
    const u = await firstParty(r);
    await deleteRule(pool, u.id, idParam(r));
    return reply.code(204).send();
  });

  // Questions from agents, waiting for an answer (Notifications).
  app.get("/me/questions", async (r): Promise<AgentQuestion[]> => {
    const u = await firstParty(r);
    return openQuestions(reader(r.headers), u.id);
  });

  // The card's buttons, or Approve/Decline on the phone's notification.
  app.post("/me/questions/:id/answer", async (r): Promise<AgentQuestion> => {
    const u = await firstParty(r);
    const d = questionAnswerInput.parse(r.body ?? {});
    return answerQuestion(u.id, idParam(r), d.answer, d.via);
  });
}
