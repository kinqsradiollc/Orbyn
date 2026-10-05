import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  fail,
  slackChannelStatus,
  slackChannelConnection,
  slackInstallationStart,
  slackInstallationRequest,
  slackInstallationConfirm,
  slackChannelPermission,
  slackChannelDisconnect,
} from "@orbyn/core";
import { authenticateSessionBinding } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { type SlackOAuthConfig } from "./slack-oauth.js";
import * as service from "./slack-installations.js";
import { configuredSlack } from "./slack-config.js";

/** Injectable boundary for HTTP shield tests; the production registration uses only real services. */
export function createAgentChannelRoutes(
  dependencies: typeof service = service,
  configuration: () => SlackOAuthConfig | undefined = configuredSlack,
): FastifyPluginAsync {
  return async (app) => {
    const requireConfig = () => {
      const config = configuration();
      if (!config) fail(503, "Slack connection is not configured.");
      return config;
    };
    app.get("/agent-channels/slack", strictRateLimit, async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.query);
      reply.header("Cache-Control", "no-store");
      return slackChannelStatus.parse({
        configured: !!configuration(),
        connection: await dependencies.readSlackChannel(binding),
      });
    });
    app.post(
      "/agent-channels/slack/installations",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        z.object({}).strict().parse(r.body);
        reply.header("Cache-Control", "no-store");
        return slackInstallationStart.parse(
          await dependencies.beginSlackInstallation(binding, requireConfig()),
        );
      },
    );
    app.get(
      "/agent-channels/slack/installations/:id",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        reply.header("Cache-Control", "no-store");
        return slackInstallationRequest.parse(
          await dependencies.readSlackInstallationRequest(
            binding,
            idParam(r),
            configuration(),
          ),
        );
      },
    );
    app.post(
      "/agent-channels/slack/installations/:id/confirm",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = slackInstallationConfirm.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return slackChannelConnection.parse(
          await dependencies.confirmSlackInstallation(
            binding,
            idParam(r),
            requireConfig(),
            body,
          ),
        );
      },
    );
    app.put(
      "/agent-channels/slack/permission",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = slackChannelPermission.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return slackChannelConnection.parse(
          await dependencies.setSlackDmPermission(
            binding,
            body,
            configuration(),
          ),
        );
      },
    );
    app.post(
      "/agent-channels/slack/disconnect",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = slackChannelDisconnect.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return slackChannelConnection.parse(
          await dependencies.disconnectSlackInstallation(binding, body),
        );
      },
    );
    app.get(
      "/agent-channels/slack/callback",
      strictRateLimit,
      async (r, reply) => {
        // OAuth state authorizes capture only. Linking still requires the originating app session.
        reply.headers({
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "Content-Security-Policy":
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          "X-Content-Type-Options": "nosniff",
        });
        const query = z
          .object({
            state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
            code: z.string().min(1).max(4096).optional(),
            error: z.string().min(1).max(512).optional(),
          })
          .strict()
          .refine((value) => !!value.code !== !!value.error)
          .parse(r.query);
        const result = await dependencies.captureSlackInstallation(
          requireConfig(),
          query,
        );
        return reply
          .type("text/html; charset=utf-8")
          .send(
            result.captured
              ? "<!doctype html><title>Return to Orbyn</title><h1>Return to Orbyn</h1><p>Review the workspace and account to finish connecting Slack.</p>"
              : "<!doctype html><title>Slack connection cancelled</title><h1>Connection cancelled</h1><p>You can close this tab.</p>",
          );
      },
    );
  };
}

export const agentChannelRoutes = createAgentChannelRoutes();
