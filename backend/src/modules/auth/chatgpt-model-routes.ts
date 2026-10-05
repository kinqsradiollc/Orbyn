import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  chatgptCatalogSelection,
  chatgptCatalogRead,
  chatgptCatalogDefaultUpdate,
  chatgptModelPreference,
} from "@orbyn/core";
import { authenticateSessionBinding } from "../../lib/auth.js";
import { strictRateLimit } from "../../lib/params.js";
import {
  readChatgptModelCatalog,
  selectChatgptDefaultModel,
} from "./chatgpt-model-catalog.js";

/** First-party metadata/defaults; plugin grants and provider tokens never enter this API. */
export async function chatgptModelRoutes(app: FastifyInstance) {
  app.get("/models", async (r, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await authenticateSessionBinding(r);
    const { include_capabilities, ...selection } = chatgptCatalogSelection
      .extend({
        include_capabilities: z.literal("1").optional(),
      })
      .strict()
      .parse(r.query);
    const result = chatgptCatalogRead.parse(
      await readChatgptModelCatalog(session, selection),
    );
    // Older clients validate an exact response shape. Extra capability metadata
    // is explicit opt-in, and omission never grants inference authority.
    if (!include_capabilities) delete result.capabilities;
    return result;
  });
  app.put("/models/default", strictRateLimit, async (r, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = await authenticateSessionBinding(r);
    return chatgptModelPreference.parse(
      await selectChatgptDefaultModel(
        session,
        chatgptCatalogDefaultUpdate.parse(r.body),
      ),
    );
  });
}
