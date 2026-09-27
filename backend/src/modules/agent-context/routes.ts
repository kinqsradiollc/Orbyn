import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  agentSettingsInput,
  fail,
  type AgentContextSettings,
  type PersonalAgentSettings,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate, isApiKeyRequest } from "../../lib/auth.js";
import { audit } from "../../lib/audit.js";
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
  app.get("/me/agent", async (r): Promise<PersonalAgentSettings> => {
    const u = await firstParty(r);
    const row = (
      await reader(r.headers).query<PersonalAgentSettings>(
        `SELECT name, persona, named_at, updated_at FROM agent_settings WHERE user_id = $1`,
        [u.id],
      )
    ).rows[0];
    return (
      row ?? {
        name: "Orbyn",
        persona: "",
        named_at: null,
        updated_at: new Date().toISOString(),
      }
    );
  });

  app.put("/me/agent", async (r): Promise<PersonalAgentSettings> => {
    const u = await firstParty(r);
    const input = agentSettingsInput.parse(r.body);
    const row = await transaction(async (db) => {
      const saved = (
        await db.query<PersonalAgentSettings>(
          `INSERT INTO agent_settings (user_id, name, persona, named_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name,
         persona = EXCLUDED.persona, named_at = coalesce(agent_settings.named_at, now()), updated_at = now()
       RETURNING name, persona, named_at, updated_at`,
          [u.id, input.name, input.persona],
        )
      ).rows[0];
      await audit(
        {
          actorId: u.id,
          action: "agent_identity.set",
          targetType: "user",
          targetId: u.id,
          details: { name: input.name, persona_length: input.persona.length },
          requestId: r.id,
        },
        db,
      );
      return saved;
    });
    return {
      ...row,
      named_at: row.named_at ? new Date(row.named_at).toISOString() : null,
      updated_at: new Date(row.updated_at).toISOString(),
    };
  });

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
