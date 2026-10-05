import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  fail,
  teamsChannelStatus,
  teamsChannelPermission,
  teamsChannelConnection,
  teamsInstallationStart,
  teamsInstallationRequest,
  teamsInstallationConfirm,
  teamsChannelDisconnect,
  teamsConversationChallenge,
} from "@orbyn/core";
import { authenticateSessionBinding } from "../../lib/auth.js";
import { idParam, strictRateLimit } from "../../lib/params.js";
import { type TeamsOAuthConfig } from "./teams-oauth.js";
import * as service from "./teams-installations.js";
import { configuredTeams, configuredTeamsBot } from "./teams-config.js";

/** Injectable boundary for HTTP shield tests; the production registration uses only real services. */
export function createTeamsChannelRoutes(
  dependencies: typeof service = service,
  configuration: () => TeamsOAuthConfig | undefined = configuredTeams,
): FastifyPluginAsync {
  return async (app) => {
    const requireConfig = () => {
      const config = configuration();
      if (!config) fail(503, "Teams connection is not configured.");
      return config;
    };
    app.get("/agent-channels/teams", strictRateLimit, async (r, reply) => {
      const binding = await authenticateSessionBinding(r);
      z.object({}).strict().parse(r.query);
      reply.header("Cache-Control", "no-store");
      const config = configuration();
      return teamsChannelStatus.parse({
        configured: !!config,
        delivery_available: !!config && !!configuredTeamsBot(),
        connection: await dependencies.readTeamsChannel(binding, config),
      });
    });
    app.post(
      "/agent-channels/teams/installations",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        z.object({}).strict().parse(r.body);
        reply.header("Cache-Control", "no-store");
        return teamsInstallationStart.parse(
          await dependencies.beginTeamsInstallation(binding, requireConfig()),
        );
      },
    );
    app.get(
      "/agent-channels/teams/installations/:id",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        reply.header("Cache-Control", "no-store");
        return teamsInstallationRequest.parse(
          await dependencies.readTeamsInstallationRequest(
            binding,
            idParam(r),
            requireConfig(),
          ),
        );
      },
    );
    app.post(
      "/agent-channels/teams/installations/:id/confirm",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = teamsInstallationConfirm.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return teamsConversationChallenge.parse(
          await dependencies.confirmTeamsInstallation(
            binding,
            idParam(r),
            requireConfig(),
            body,
          ),
        );
      },
    );
    app.post(
      "/agent-channels/teams/conversation-link",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = teamsChannelDisconnect.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return teamsConversationChallenge.parse(
          await dependencies.restartTeamsConversationLink(
            binding,
            body.expected_version,
            requireConfig(),
          ),
        );
      },
    );
    app.put(
      "/agent-channels/teams/permission",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = teamsChannelPermission.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return teamsChannelConnection.parse(
          await dependencies.setTeamsDmPermission(
            binding,
            body,
            configuration(),
            configuredTeamsBot(),
          ),
        );
      },
    );
    app.post(
      "/agent-channels/teams/disconnect",
      strictRateLimit,
      async (r, reply) => {
        const binding = await authenticateSessionBinding(r);
        z.object({}).strict().parse(r.query);
        const body = teamsChannelDisconnect.parse(r.body);
        reply.header("Cache-Control", "no-store");
        return teamsChannelConnection.parse(
          await dependencies.disconnectTeamsInstallation(
            binding,
            body.expected_version,
          ),
        );
      },
    );
    app.get(
      "/agent-channels/teams/callback",
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
            code: z.string().min(1).max(8192).optional(),
            error: z.string().min(1).max(512).optional(),
          })
          .strict()
          .refine((value) => !!value.code !== !!value.error)
          .parse(r.query);
        const result = await dependencies.captureTeamsInstallation(
          requireConfig(),
          query,
        );
        return reply
          .type("text/html; charset=utf-8")
          .send(
            result.captured
              ? "<!doctype html><title>Return to Orbyn</title><h1>Return to Orbyn</h1><p>Review your Microsoft account in Orbyn, then link its personal Teams conversation.</p>"
              : "<!doctype html><title>Teams connection cancelled</title><h1>Connection cancelled</h1><p>You can close this tab.</p>",
          );
      },
    );
  };
}

export const teamsChannelRoutes = createTeamsChannelRoutes();
