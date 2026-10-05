import {
  readAiProviderChoice,
  saveAiProviderChoice,
} from "./ai-provider-choice.js";
import { pool } from "../../db/pool.js";
import { readCompletedChatgptUsage } from "./chatgpt-usage.js";
import {
  readAgendaPrivatePermission,
  saveAgendaPrivatePermission,
} from "./agenda-private-permission.js";
import { z } from "zod";
import {
  startChatgptConnectRequest,
  pendingChatgptConnectRequests,
  readChatgptConnectRequest,
  claimChatgptConnectRequest,
  finishChatgptConnectRequest,
} from "./chatgpt-connect-requests.js";
import type { FastifyInstance } from "fastify";
import {
  chatgptConnectionStart,
  chatgptConnectRequestFinish,
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
  app.get(
    "/ai/agenda/private-permission",
    strictRateLimit,
    async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.query);
      reply.header("Cache-Control", "no-store");
      return readAgendaPrivatePermission(binding);
    },
  );
  app.put(
    "/ai/agenda/private-permission",
    strictRateLimit,
    async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      reply.header("Cache-Control", "no-store");
      return saveAgendaPrivatePermission(binding, r.body);
    },
  );
  app.get(
    "/ai/connections/chatgpt/usage",
    strictRateLimit,
    async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.query);
      reply.header("Cache-Control", "no-store");
      return readCompletedChatgptUsage(binding);
    },
  );
  app.get("/ai/provider-choice", async (r, reply) => {
    const b = await authenticateSessionBinding(r);
    z.object({}).strict().parse(r.query);
    reply.header("Cache-Control", "no-store");
    return readAiProviderChoice(pool, b.userId);
  });
  app.put("/ai/provider-choice", strictRateLimit, async (r, reply) => {
    const b = await authenticateSessionBinding(r);
    reply.header("Cache-Control", "no-store");
    return saveAiProviderChoice(b, r.body);
  });
  app.post(
    "/ai/connections/chatgpt/connect-requests",
    strictRateLimit,
    async (r, reply) => {
      const b = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.body);
      reply.header("Cache-Control", "no-store");
      return startChatgptConnectRequest(b);
    },
  );
  app.get(
    "/ai/connections/chatgpt/connect-requests/pending",
    async (r, reply) => {
      const b = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.query);
      reply.header("Cache-Control", "no-store");
      return pendingChatgptConnectRequests(b);
    },
  );
  app.get("/ai/connections/chatgpt/connect-requests/:id", async (r, reply) => {
    const b = await authenticateSessionBinding(r);
    reply.header("Cache-Control", "no-store");
    return readChatgptConnectRequest(b, idParam(r));
  });
  app.post(
    "/ai/connections/chatgpt/connect-requests/:id/claim",
    strictRateLimit,
    async (r, reply) => {
      const b = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.body);
      reply.header("Cache-Control", "no-store");
      return claimChatgptConnectRequest(b, idParam(r));
    },
  );
  app.post(
    "/ai/connections/chatgpt/connect-requests/:id/finish",
    strictRateLimit,
    async (r, reply) => {
      const b = await authenticateSessionBinding(r);
      const body = chatgptConnectRequestFinish.parse(r.body);
      reply.header("Cache-Control", "no-store");
      return finishChatgptConnectRequest(b, idParam(r), body.connection_id);
    },
  );
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
