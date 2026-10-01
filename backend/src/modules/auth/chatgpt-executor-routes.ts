import type { FastifyInstance } from "fastify";
import {
  chatgptExecutorEnrolled,
  chatgptCatalogReceipt,
  chatgptExecutorStart,
  chatgptExecutorFinish,
  chatgptExecutorChallenge,
  chatgptLeaseStart,
  chatgptLeaseFinish,
  chatgptLeaseChallenge,
  chatgptExecutorLease,
  chatgptLeaseRenewal,
  chatgptCatalogPublication,
} from "@orbyn/core";
import { authenticateSessionBinding } from "../../lib/auth.js";
import { strictRateLimit, writeRateLimit } from "../../lib/params.js";
import {
  beginChatgptExecutorEnrollment,
  finishChatgptExecutorEnrollment,
} from "./chatgpt-connections.js";
import {
  beginChatgptExecutorLease,
  finishChatgptExecutorLease,
  renewChatgptExecutorLease,
  publishChatgptExecutorCatalog,
} from "./chatgpt-executor-leases.js";

/** Credential-free proofs/publications require the exact first-party device session. */
export async function chatgptExecutorRoutes(app: FastifyInstance) {
  app.post(
    "/ai/connections/chatgpt/executors/challenges",
    strictRateLimit,
    async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionBinding(r);
      return chatgptExecutorChallenge.parse(
        await beginChatgptExecutorEnrollment(
          session,
          chatgptExecutorStart.parse(r.body),
        ),
      );
    },
  );
  app.post(
    "/ai/connections/chatgpt/executors/complete",
    strictRateLimit,
    async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionBinding(r);
      return chatgptExecutorEnrolled.parse(
        await finishChatgptExecutorEnrollment(
          session,
          chatgptExecutorFinish.parse(r.body),
        ),
      );
    },
  );
  app.post(
    "/ai/connections/chatgpt/leases/challenges",
    strictRateLimit,
    async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionBinding(r);
      return chatgptLeaseChallenge.parse(
        await beginChatgptExecutorLease(
          session,
          chatgptLeaseStart.parse(r.body),
        ),
      );
    },
  );
  app.post(
    "/ai/connections/chatgpt/leases/complete",
    strictRateLimit,
    async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionBinding(r);
      return chatgptExecutorLease.parse(
        await finishChatgptExecutorLease(
          session,
          chatgptLeaseFinish.parse(r.body),
        ),
      );
    },
  );
  app.post(
    "/ai/connections/chatgpt/leases/heartbeat",
    writeRateLimit,
    async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionBinding(r);
      return chatgptExecutorLease.parse(
        await renewChatgptExecutorLease(
          session,
          chatgptLeaseRenewal.parse(r.body),
        ),
      );
    },
  );
  app.post(
    "/ai/connections/chatgpt/catalog",
    { ...writeRateLimit, bodyLimit: 2 * 1024 * 1024 },
    async (r, reply) => {
      reply.header("Cache-Control", "no-store");
      const session = await authenticateSessionBinding(r);
      return chatgptCatalogReceipt.parse(
        await publishChatgptExecutorCatalog(
          session,
          chatgptCatalogPublication.parse(r.body),
        ),
      );
    },
  );
}
