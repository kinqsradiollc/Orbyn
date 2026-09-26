import {
  AGENT_ACCESS_RANK,
  REAUTH_WINDOW_MINUTES,
  accessFromScopes,
  fail,
  grantedScopes,
  oauthConsentInput,
  oauthRequest,
  type AgentAccess,
  type OAuthCheck,
  type OAuthConsentInput,
  type OAuthRequest,
  type OAuthTeamChoice,
} from "@orbyn/core";
import { env, oauthIssuer } from "../../config/env.js";
import { pool, transaction, type Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import type { UserRow } from "../../lib/auth.js";
import type { LiveSettings } from "../../lib/settings.js";
import { MAX_GRANTS, grantView, noticeAgentEvent } from "../agents/service.js";
import {
  OAuthError,
  redirectAllowed,
  redirectHost,
  resolveClient,
  type OAuthClient,
} from "./clients.js";
import { PKCE_CHALLENGE, issueCode, toolsetsFor } from "./tokens.js";

/**
 * The consent page's side of signing in with Orbyn: checking a request
 * before anything is shown (GET /oauth/authorize/check), allowing it
 * (POST /oauth/authorize) and declining it (POST /oauth/authorize/deny).
 *
 * A request that doesn't check out is shown as an error on the page and
 * never sent anywhere: its redirect address can't be trusted until the app
 * and the address are known to belong together.
 */

/** A request that checked out. */
export type CheckedRequest = {
  client: OAuthClient;
  redirectUri: string;
  challenge: string;
  state: string | undefined;
  /** The scopes it asked for that Orbyn knows. */
  scopes: string[];
  /** The canonical MCP address the tokens will be for. */
  resource: string;
};

/** A request's problem, as the page shows it (400, or 403 for a blocked app). */
const refuse = (e: OAuthError): never =>
  fail(e.error === "unauthorized_client" ? 403 : 400, e.message);

/** Checks an authorization request (RFC 6749 §4.1.1, PKCE, RFC 8707). */
export async function validateRequest(
  raw: OAuthRequest | unknown,
  s: LiveSettings,
): Promise<CheckedRequest> {
  const parsed = oauthRequest.safeParse(raw ?? {});
  if (!parsed.success)
    fail(400, "This sign-in link is missing parts. Start again from the app.");
  const q = parsed.data;
  let client: OAuthClient;
  try {
    client = await resolveClient(q.client_id, s);
  } catch (e) {
    if (e instanceof OAuthError) refuse(e);
    throw e;
  }
  if (!redirectAllowed(client, q.redirect_uri))
    fail(
      400,
      "This app asked to send you back somewhere it didn't declare. Nothing was shared.",
    );
  if (q.response_type !== "code")
    fail(400, "This sign-in link asks for something Orbyn doesn't do.");
  if (
    q.code_challenge_method !== "S256" ||
    !PKCE_CHALLENGE.test(q.code_challenge)
  )
    fail(
      400,
      "This app didn't protect its sign-in (PKCE with S256 is required). Update the app and try again.",
    );
  const canonical = env.MCP_PUBLIC_URL;
  if (
    q.resource !== undefined &&
    q.resource.replace(/\/$/, "") !== canonical.replace(/\/$/, "")
  )
    fail(
      400,
      `This app asked for access to ${q.resource}, which isn't Orbyn's MCP address.`,
    );
  const known = new Set([
    "orbyn:read",
    "orbyn:propose",
    "orbyn:write",
    "orbyn:bookings",
    "offline_access",
  ]);
  return {
    client,
    redirectUri: q.redirect_uri,
    challenge: q.code_challenge,
    state: q.state,
    // Names Orbyn doesn't know are left out, not refused: some apps add
    // their own (openid, profile) to every sign-in.
    scopes: q.scope.split(/\s+/).filter((x) => known.has(x)),
    resource: canonical,
  };
}

/** The address to send the browser back to, with the answer on it. */
function backTo(
  req: CheckedRequest,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(req.redirectUri);
  for (const [k, v] of Object.entries(params))
    if (v !== undefined) url.searchParams.set(k, v);
  if (req.state !== undefined) url.searchParams.set("state", req.state);
  url.searchParams.set("iss", oauthIssuer());
  return url.toString();
}

/** The person's teams with their role and each team's agent policy. */
async function teamChoices(
  db: Queryable,
  userId: string,
): Promise<OAuthTeamChoice[]> {
  return (
    await db.query<OAuthTeamChoice>(
      `SELECT t.id, t.name, m.role, t.agent_access
         FROM team_members m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = $1 ORDER BY lower(t.name), t.id`,
      [userId],
    )
  ).rows;
}

/** Until when a session counts as just signed in, or null. */
export async function reauthUntil(tokenHash: string): Promise<Date | null> {
  const at = (
    await pool.query<{ reauthenticated_at: Date | null }>(
      "SELECT reauthenticated_at FROM sessions WHERE token_hash = $1",
      [tokenHash],
    )
  ).rows[0]?.reauthenticated_at;
  if (!at) return null;
  const until = new Date(at.getTime() + REAUTH_WINDOW_MINUTES * 60_000);
  return until.getTime() > Date.now() ? until : null;
}

/** What the consent page shows (signed in: with the account's choices). */
export async function checkRequest(
  raw: unknown,
  s: LiveSettings,
  who: { user: UserRow; tokenHash: string } | null,
): Promise<OAuthCheck> {
  const req = await validateRequest(raw, s);
  const back = redirectHost(req.redirectUri);
  const check: OAuthCheck = {
    client: {
      id: req.client.id,
      name: req.client.name,
      host: req.client.host,
      verified: req.client.verified,
      redirect_host: back.host,
      redirect_local: back.local,
    },
    requested_access: accessFromScopes(req.scopes.join(" ")),
    requested_bookings: req.scopes.includes("orbyn:bookings"),
    account: null,
  };
  if (!who) return check;
  const [teams, until, security, existing] = await Promise.all([
    teamChoices(pool, who.user.id),
    reauthUntil(who.tokenHash),
    pool.query<{ two_factor: boolean; passkeys: number }>(
      `SELECT EXISTS (SELECT 1 FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL) AS two_factor,
              (SELECT count(*) FROM webauthn_credentials WHERE user_id = $1)::int AS passkeys`,
      [who.user.id],
    ),
    pool.query<{ id: string }>(
      `SELECT id FROM agent_grants
        WHERE user_id = $1 AND kind = 'oauth' AND client_id = $2 AND revoked_at IS NULL
          AND authorized_at IS NOT NULL`,
      [who.user.id, req.client.id],
    ),
  ]);
  check.account = {
    name: who.user.name,
    email: who.user.email,
    teams,
    reauth_until: until?.toISOString() ?? null,
    two_factor: security.rows[0].two_factor,
    passkeys: security.rows[0].passkeys,
    existing: existing.rows[0]
      ? await grantView(pool, who.user.id, existing.rows[0].id)
      : null,
    max_grant_days: s.agents.max_grant_days,
  };
  return check;
}

/** Signing in is needed again before granting this. */
export const REAUTH_REQUIRED = "reauth_required";

/**
 * Allows a request: makes the connection (or updates the person's existing
 * one with this app), and answers with where to send the browser, a
 * one-time code on it. Write access and bookings need the person to have
 * confirmed it's them within the last 10 minutes.
 */
export async function allowRequest(
  user: UserRow,
  tokenHash: string,
  raw: OAuthConsentInput,
  s: LiveSettings,
  requestId?: string,
): Promise<{ redirect_to: string }> {
  const d = oauthConsentInput.parse(raw);
  const req = await validateRequest(d.request, s);
  if (!s.agents.agents_enabled)
    fail(
      503,
      "Outside agents are switched off on this Orbyn for now. Try again later.",
    );
  const teams = await teamChoices(pool, user.id);
  const teamIds = [...new Set(d.team_ids)];
  for (const id of teamIds) {
    const t = teams.find((x) => x.id === id);
    if (!t) fail(404, "Team not found");
    if (t.agent_access === "off")
      fail(
        403,
        `${t.name} has turned outside agents off. Ask its owners, or leave it out.`,
      );
  }
  if (d.access === "write" || d.bookings) {
    if (!(await reauthUntil(tokenHash))) fail(403, REAUTH_REQUIRED);
  }
  const toolsets = toolsetsFor(d.toolsets, d.bookings);
  const days = Math.min(d.expires_in_days, s.agents.max_grant_days);
  const flags = {
    notify_teammates: d.notify_teammates,
    hide_outside_content: d.hide_outside_content,
  };
  const scope = grantedScopes(
    d.access,
    d.bookings,
    req.scopes.includes("offline_access"),
  );
  let added = false;
  let raised = false;
  const grantId = await transaction(async (db) => {
    const before = (
      await db.query<{ id: string; access: AgentAccess; toolsets: string[] }>(
        `SELECT id, access, toolsets FROM agent_grants
          WHERE user_id = $1 AND kind = 'oauth' AND client_id = $2 AND revoked_at IS NULL
          FOR UPDATE`,
        [user.id, req.client.id],
      )
    ).rows[0];
    let id: string;
    if (before) {
      id = before.id;
      raised =
        AGENT_ACCESS_RANK[d.access] > AGENT_ACCESS_RANK[before.access] ||
        (d.bookings && !before.toolsets.includes("booking"));
      await db.query(
        `UPDATE agent_grants SET client_name = $2, name = $2, access = $3, team_ids = $4,
           personal = $5, toolsets = $6, flags = $7,
           expires_at = now() + make_interval(days => $8::int), suspended_at = NULL
         WHERE id = $1`,
        [
          id,
          req.client.name,
          d.access,
          teamIds,
          d.personal,
          toolsets,
          flags,
          days,
        ],
      );
    } else {
      const live = (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM agent_grants WHERE user_id = $1
              AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
          [user.id],
        )
      ).rows[0].n;
      if (live >= MAX_GRANTS)
        fail(
          409,
          `You can have up to ${MAX_GRANTS} connected agents. Disconnect one first.`,
        );
      id = (
        await db.query<{ id: string }>(
          `INSERT INTO agent_grants (user_id, kind, client_id, client_name, name, access,
             team_ids, personal, toolsets, flags, expires_at)
           VALUES ($1, 'oauth', $2, $3, $3, $4, $5, $6, $7, $8,
                   now() + make_interval(days => $9::int))
           RETURNING id`,
          [
            user.id,
            req.client.id,
            req.client.name,
            d.access,
            teamIds,
            d.personal,
            toolsets,
            flags,
            days,
          ],
        )
      ).rows[0].id;
      added = true;
    }
    await audit(
      {
        actorId: user.id,
        action: added ? "agent_grant.authorized" : "agent_grant.reauthorized",
        targetType: "agent_grant",
        targetId: id,
        details: {
          user_id: user.id,
          client_id: req.client.id,
          host: req.client.host,
          access: d.access,
          personal: d.personal,
          team_ids: teamIds,
          toolsets,
          notify_teammates: d.notify_teammates,
          hide_outside_content: d.hide_outside_content,
          scope,
          days,
        },
        requestId,
      },
      db,
    );
    if (added || raised)
      await noticeAgentEvent(db, user.id, {
        ref: `grant:${id}`,
        title: added
          ? `${req.client.name} was connected to your Orbyn`
          : `${req.client.name} can now do more in your Orbyn`,
        body: `${req.client.name} (${req.client.host}) can ${
          d.access === "write"
            ? "read and change"
            : d.access === "suggest"
              ? "read and suggest changes to"
              : "read"
        } what you chose. If this wasn't you, disconnect it in Settings → Connected agents and change your password.`,
        email: true,
      });
    await db.query(
      "UPDATE oauth_clients SET last_used_at = now() WHERE id = $1",
      [req.client.id],
    );
    return id;
  });
  const code = await issueCode(pool, {
    grantId,
    clientId: req.client.id,
    redirectUri: req.redirectUri,
    challenge: req.challenge,
    resource: req.resource,
    scope,
  });
  return { redirect_to: backTo(req, { code }) };
}

/** Declines a request: the browser goes back to the app with access_denied. */
export async function denyRequest(
  raw: unknown,
  s: LiveSettings,
): Promise<{ redirect_to: string }> {
  const body = (raw ?? {}) as { request?: unknown };
  const req = await validateRequest(body.request, s);
  return {
    redirect_to: backTo(req, {
      error: "access_denied",
      error_description: "The person declined.",
    }),
  };
}
