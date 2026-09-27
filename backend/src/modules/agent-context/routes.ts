import type { FastifyInstance, FastifyRequest } from "fastify";
import { fail, type AgentContextSettings } from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate, isApiKeyRequest } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { contextSettings, ensureProfile, setInstructions } from "./service.js";

/**
 * Settings → Connected agents, "About me for agents" and "Instructions"
 * (H8), signed in to Orbyn's own apps only: agents reach the same through
 * get_context, create_doc (kind profile), edit_doc and organize.
 */
async function firstParty(r: FastifyRequest) {
  const u = await authenticate(r);
  if (isApiKeyRequest(r))
    fail(403, "Only you, signed in to Orbyn, can do this. Keys can't.");
  return u;
}

export async function agentContextRoutes(app: FastifyInstance) {
  app.get("/me/agent-context", async (r): Promise<AgentContextSettings> => {
    const u = await firstParty(r);
    return contextSettings(reader(r.headers), u.id);
  });

  // Open the profile page, making it first when there isn't one.
  app.post("/me/agent-profile", async (r, reply) => {
    const u = await firstParty(r);
    const made = await transaction((db) => ensureProfile(db, u));
    reply.code(made.created ? 201 : 200);
    return {
      doc_id: made.doc.id,
      title: made.doc.title,
      created: made.created,
    };
  });

  app.put(
    "/me/agent-instructions",
    async (r): Promise<AgentContextSettings> => {
      const u = await firstParty(r);
      await transaction((db) =>
        setInstructions(db, u, null, r.body as never, null, r.id),
      );
      return contextSettings(pool, u.id);
    },
  );

  app.put(
    "/teams/:id/agent-instructions",
    async (r): Promise<AgentContextSettings> => {
      const u = await firstParty(r);
      await transaction((db) =>
        setInstructions(db, u, idParam(r), r.body as never, null, r.id),
      );
      return contextSettings(pool, u.id);
    },
  );
}
