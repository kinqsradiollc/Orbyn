import type { FastifyInstance } from "fastify";
import {
  chatgptConnectionStart,
  chatgptConnectionFinish,
  chatgptConnectionChallenge,
  chatgptConnection,
  chatgptConnectionList,
} from "@orbyn/core";
import { authenticateSessionBinding } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import {
  beginChatgptConnection,
  finishChatgptConnection,
  listChatgptConnections,
  revokeChatgptConnection,
} from "./chatgpt-connections.js";

/** First-party identity metadata only. Plan credentials and plugin grants stay separate. */
export async function chatgptConnectionRoutes(app: FastifyInstance) {
  app.post(
    "/ai/connections/chatgpt/challenges",
    strictRateLimit,
    async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      const input = chatgptConnectionStart.parse(r.body);
      reply.header("Cache-Control", "no-store");
      return chatgptConnectionChallenge.parse(
        await beginChatgptConnection(binding, input.client_id),
      );
    },
  );
  app.post(
    "/ai/connections/chatgpt/complete",
    strictRateLimit,
    async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      const input = chatgptConnectionFinish.parse(r.body);
      reply.header("Cache-Control", "no-store");
      return chatgptConnection.parse(
        await finishChatgptConnection(binding, {
          challengeId: input.challenge_id,
          clientId: input.client_id,
          idToken: input.id_token,
        }),
      );
    },
  );
  app.get("/ai/connections/chatgpt", async (r, reply) => {
    const binding = await authenticateSessionBinding(r);
    reply.header("Cache-Control", "no-store");
    return chatgptConnectionList.parse(await listChatgptConnections(binding));
  });
  app.delete(
    "/ai/connections/chatgpt/:id",
    strictRateLimit,
    async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      await revokeChatgptConnection(binding, idParam(r));
      return reply.header("Cache-Control", "no-store").code(204).send();
    },
  );
}
