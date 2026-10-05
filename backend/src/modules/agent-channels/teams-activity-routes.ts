import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { configuredTeams } from "./teams-config.js";
import type { TeamsOAuthConfig } from "./teams-oauth.js";
import { receiveTeamsActivity } from "./teams-activity.js";
import { TeamsAuthenticationError } from "./teams-auth.js";
/** Encapsulated raw parser keeps normal app JSON routes intact; only Connector authentication grants access. */
export function createTeamsActivityRoutes(
  receive = receiveTeamsActivity,
  configuration: () => TeamsOAuthConfig | undefined = configuredTeams,
): FastifyPluginAsync {
  return async (app) => {
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 65536 },
      (_r, body, done) => done(null, body),
    );
    app.post(
      "/agent-channels/teams/activities",
      {
        bodyLimit: 65536,
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      },
      async (r, reply) => {
        reply.header("Cache-Control", "no-store");
        z.object({}).strict().parse(r.query);
        const config = configuration();
        if (!config) fail(503, "Teams connection is not configured.");
        if (!Buffer.isBuffer(r.body))
          fail(400, "This Teams event is unavailable.");
        try {
          return await receive(r.body, r.headers, config);
        } catch (error) {
          if (error instanceof TeamsAuthenticationError)
            fail(error.status, error.message);
          if (
            [400, 403, 409].includes(
              (error as { statusCode?: number })?.statusCode ?? 0,
            )
          )
            throw error;
          fail(503, "This Teams event is unavailable.");
        }
      },
    );
  };
}
