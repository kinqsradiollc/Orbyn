import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { fail } from "@orbyn/core";
import { strictRateLimit } from "../../lib/params.js";
import {
  configuredSlack,
  configuredSlackSigningSecret,
} from "./slack-config.js";
import type { SlackOAuthConfig } from "./slack-oauth.js";
import { readSlackReply, SlackInteractionError } from "./slack-interactions.js";
import { readSlackEvent } from "./slack-events.js";
import { captureSlackQuestionReply } from "./question-replies.js";

/** Provider callbacks authenticate raw bytes; they never accept app sessions or MCP grants as substitutes. */
export function createSlackReplyRoutes(
  capture = captureSlackQuestionReply,
  configuration: () => SlackOAuthConfig | undefined = configuredSlack,
  signingSecret: () => string | undefined = configuredSlackSigningSecret,
): FastifyPluginAsync {
  return async (app) => {
    // This plugin is encapsulated: ordinary settings/OAuth JSON keeps its parser.
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
      ["application/json", "application/x-www-form-urlencoded"],
      { parseAs: "buffer", bodyLimit: 65536 },
      (_r, body, done) => done(null, body),
    );
    for (const kind of ["interactions", "events"] as const) {
      app.post(
        `/agent-channels/slack/${kind}`,
        { ...strictRateLimit, bodyLimit: 65536 },
        async (r, response) => {
          response.header("Cache-Control", "no-store");
          z.object({}).strict().parse(r.query);
          const config = configuration(),
            secret = signingSecret();
          if (!config || !secret)
            fail(503, "Slack replies are not configured.");
          if (!Buffer.isBuffer(r.body))
            fail(400, "Slack reply is unavailable.");
          let authenticatedReply = false;
          try {
            let input;
            if (kind === "interactions")
              input = readSlackReply(r.body, r.headers, secret, config.appId);
            else {
              const event = readSlackEvent(
                r.body,
                r.headers,
                secret,
                config.appId,
              );
              if (event.kind === "challenge")
                return { challenge: event.challenge };
              if (event.kind === "ignored") return { received: true };
              input = event.reply;
            }
            authenticatedReply = true;
            const deadline = Date.now() + 2200;
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                capture(input, config, secret, deadline),
                new Promise<never>((_resolve, reject) => {
                  timer = setTimeout(
                    () => reject(new Error("Reply capture timed out")),
                    2500,
                  );
                }),
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          } catch (error) {
            if (error instanceof SlackInteractionError) {
              // Unbound or stale signed thread events are ignored, without storing
              // text or asking Slack to retry them. Button refusals remain visible.
              if (
                kind === "events" &&
                authenticatedReply &&
                [403, 409].includes(error.status)
              )
                return { received: true };
              fail(error.status, error.message);
            }
            fail(503, "Slack reply is unavailable. Try again later.");
          }
        },
      );
    }
  };
}
