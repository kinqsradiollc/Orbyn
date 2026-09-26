import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { OAUTH_SCOPES, fail } from "@orbyn/core";
import { oauthIssuer } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import {
  authenticate,
  bearerToken,
  digest,
  isApiKeyRequest,
} from "../../lib/auth.js";
import { settings } from "../../lib/settings.js";
import { OAuthError, registerClient } from "./clients.js";
import { allowRequest, checkRequest, denyRequest } from "./consent.js";
import { exchangeCode, refreshTokens, revokeToken } from "./tokens.js";

/**
 * Orbyn's OAuth 2.1 authorization server for outside agents, in the api
 * service. The issuer is OAUTH_ISSUER (the web app's address); the page
 * people see is the web app's /oauth/authorize, which calls the consent
 * routes here. The endpoints apps call directly (metadata, token, revoke,
 * register) answer any origin, as browser-based clients need, and speak
 * RFC 6749 / 7009 / 7591 errors. /oauth/ stays open during maintenance, so
 * refreshing never breaks.
 */

/** RFC 8414 metadata. */
export function authorizationServerMetadata(dcr: boolean) {
  const issuer = oauthIssuer();
  const api = `${issuer}/api`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${api}/oauth/token`,
    revocation_endpoint: `${api}/oauth/revoke`,
    ...(dcr ? { registration_endpoint: `${api}/oauth/register` } : {}),
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // Public apps with PKCE only: no secrets and no signed client assertions.
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...OAUTH_SCOPES],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** Every failure on an app-facing endpoint, as an RFC 6749 error. */
function oauthErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
  if (error instanceof OAuthError) {
    if (error.status === 401)
      reply.header("WWW-Authenticate", 'Bearer error="invalid_client"');
    return reply
      .code(error.status)
      .send({ error: error.error, error_description: error.message });
  }
  const status = error.statusCode ?? 500;
  if (status === 429)
    return reply.code(429).send({
      error: "temporarily_unavailable",
      error_description: "That's a lot at once. Wait a moment and try again.",
    });
  if (status < 500)
    return reply.code(400).send({
      error: "invalid_request",
      error_description:
        status === 415
          ? "Send the request as application/x-www-form-urlencoded."
          : "That request couldn't be read.",
    });
  request.log.error({ err: error }, "OAuth request failed");
  return reply.code(500).send({
    error: "server_error",
    error_description:
      "Something went wrong on Orbyn's side. Try again in a moment.",
  });
}

/** A form (or JSON) body as flat strings. */
function fields(body: unknown): Record<string, string | undefined> {
  if (!body || typeof body !== "object") return {};
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>))
    if (typeof v === "string") out[k] = v;
  return out;
}

/** Token and revoke calls count per app, never per address (hosted apps share addresses). */
const perClient = (max: number) => ({
  config: {
    rateLimit: {
      max,
      timeWindow: "1 minute",
      hook: "preHandler" as const,
      keyGenerator: (r: FastifyRequest) => {
        const id = fields(r.body).client_id;
        return id ? `oauth-client:${digest(id).slice(0, 24)}` : r.ip;
      },
    },
  },
});

/** The consent routes need a signed-in person (never an API key or an agent). */
async function person(r: FastifyRequest) {
  const user = await authenticate(r);
  if (isApiKeyRequest(r))
    fail(403, "Only a person signed in to Orbyn can connect an agent.");
  return { user, tokenHash: digest(bearerToken(r)) };
}

export async function oauthRoutes(app: FastifyInstance) {
  // Token, revoke: application/x-www-form-urlencoded (RFC 6749 §3.2).
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 16_384 },
    (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  app.get("/.well-known/oauth-authorization-server", async (_r, reply) => {
    const s = await settings();
    return reply
      .header("Cache-Control", "public, max-age=300")
      .send(authorizationServerMetadata(s.agents.dcr_enabled));
  });

  // What the consent page shows. Works signed out (the app's name, so the
  // page can say who's asking before sign-in); signed in it adds your spaces.
  app.get(
    "/oauth/authorize/check",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const s = await settings();
      let who: {
        user: Awaited<ReturnType<typeof authenticate>>;
        tokenHash: string;
      } | null = null;
      if (r.headers.authorization) {
        try {
          who = await person(r);
        } catch (e) {
          // An expired session is simply signed out here; anything else stands.
          if ((e as { statusCode?: number }).statusCode !== 401) throw e;
        }
      }
      reply.header("Cache-Control", "no-store");
      return checkRequest(r.query, s, who);
    },
  );

  app.post(
    "/oauth/authorize",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const { user, tokenHash } = await person(r);
      const s = await settings();
      reply.header("Cache-Control", "no-store");
      return allowRequest(user, tokenHash, r.body as never, s, r.id);
    },
  );

  app.post(
    "/oauth/authorize/deny",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (r, reply) => {
      const s = await settings();
      reply.header("Cache-Control", "no-store");
      return denyRequest(r.body, s);
    },
  );

  app.post(
    "/oauth/token",
    { ...perClient(300), errorHandler: oauthErrorHandler },
    async (r, reply) => {
      const p = fields(r.body);
      const s = await settings();
      reply.header("Cache-Control", "no-store").header("Pragma", "no-cache");
      if (p.grant_type === "authorization_code") return exchangeCode(p, s);
      if (p.grant_type === "refresh_token") return refreshTokens(p, s);
      throw new OAuthError(
        p.grant_type ? "unsupported_grant_type" : "invalid_request",
        p.grant_type
          ? "Only authorization_code and refresh_token are supported."
          : "grant_type is required.",
      );
    },
  );

  app.post(
    "/oauth/revoke",
    { ...perClient(300), errorHandler: oauthErrorHandler },
    async (r, reply) => {
      const p = fields(r.body);
      await revokeToken(p.token, p.client_id);
      return reply.header("Cache-Control", "no-store").code(200).send({});
    },
  );

  // Apps registering themselves (RFC 7591), when admins allow it: at most
  // 10 an hour from one address, and 20 a day across every copy.
  app.post(
    "/oauth/register",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
      errorHandler: oauthErrorHandler,
    },
    async (r, reply) => {
      const s = await settings();
      if (!s.agents.dcr_enabled)
        throw new OAuthError(
          "access_denied",
          "This Orbyn doesn't let apps register themselves. Use the app's client metadata document, or ask the administrator.",
          403,
        );
      const made = await registerClient(pool, r.body, r.ip);
      return reply.code(201).header("Cache-Control", "no-store").send(made);
    },
  );
}
