import type { FastifyInstance } from "fastify";
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
    return chatgptCatalogRead.parse(
      await readChatgptModelCatalog(
        session,
        chatgptCatalogSelection.parse(r.query),
      ),
    );
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
