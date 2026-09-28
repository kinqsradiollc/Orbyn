import {
  AGENT_ACCESS_RANK,
  AGENT_TOOLSETS,
  trustIn as grantTrustIn,
  type AgentAccess,
  type AgentAskFirst,
  type AgentSpaceTrust,
  type AgentToolset,
  type AgentTrust,
  type SystemRole,
  type TeamAgentAccess,
  type TeamRole,
} from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import type { Spaces } from "../lib/visibility.js";

/**
 * Who is acting, and how far they may go. A Principal is built fresh for
 * every call from live data: the person, how they signed in, the
 * connection's choices (access level, spaces, toolsets, flags), and their
 * teams with each team's agent policy. Capabilities never look at a request
 * or a token, only at this.
 *
 * An agent never sees or changes more than its person can: its level in a
 * space is the lowest of the connection's access level, the person's team
 * role (viewers only read) and the team's agent policy. Agents act as an
 * ordinary member, so the system-admin team override never applies to them.
 */

export type Via =
  "session" | "legacy_key" | "agent_key" | "oauth" | "assistant";

/** A team as this principal reaches it right now. */
export type PrincipalTeam = {
  id: string;
  name: string;
  role: TeamRole;
  agent_access: TeamAgentAccess;
};

export type PrincipalFlags = {
  /** Assigning or changing team items may notify teammates directly. */
  notify_teammates: boolean;
  /** Leave out text from outside sources (like GitHub's lockdown mode). */
  hide_outside_content: boolean;
  /** Narrowed to reading for this call (X-MCP-Readonly). */
  readonly: boolean;
};

export type Principal = {
  user: { id: string; name: string; role: SystemRole };
  via: Via;
  /** The connection (agent_grants.id); null for the person's own session. */
  grant_id: string | null;
  client: { id: string | null; name: string };
  access: AgentAccess;
  /** Teams the connection was given; null means every team (old API keys). */
  team_ids: string[] | null;
  personal: boolean;
  toolsets: AgentToolset[];
  flags: PrincipalFlags;
  /**
   * How much it does alone where it may change things (full power, ask
   * first, suggest only), per space, and the ask-first items the person
   * let it do alone. See write.ts destination().
   */
  trust: {
    level: AgentTrust;
    spaces: AgentSpaceTrust;
    acts_alone: AgentAskFirst[];
  };
  /**
   * The person's teams that this principal reaches: memberships, within the
   * connection's teams, without teams whose policy turns agents off.
   */
  teams: PrincipalTeam[];
};

/** What an action needs: to read, to suggest, or to change. */
export type PolicyAction = AgentAccess;

export type Decision =
  | { ok: true; level: AgentAccess }
  | {
      ok: false;
      /**
       * NOT_FOUND also covers "can't see it", so nothing's existence leaks;
       * FORBIDDEN means it can be seen but not changed this way.
       */
      code: "NOT_FOUND" | "FORBIDDEN";
      message: string;
    };

const isAgent = (p: Principal) =>
  p.via === "assistant" ||
  p.via === "agent_key" ||
  p.via === "oauth" ||
  p.via === "legacy_key";

const lowest = (...levels: AgentAccess[]): AgentAccess =>
  levels.reduce((a, b) =>
    AGENT_ACCESS_RANK[a] <= AGENT_ACCESS_RANK[b] ? a : b,
  );

/** The most a team role allows. */
const ROLE_CAP: Record<TeamRole, AgentAccess> = {
  owner: "write",
  admin: "write",
  member: "write",
  viewer: "read",
};

/** The most a team's agent policy allows (null: agents can't reach it). */
const TEAM_CAP: Record<TeamAgentAccess, AgentAccess | null> = {
  role: "write",
  suggest: "suggest",
  read: "read",
  off: null,
};

/**
 * The principal's level in a space: Personal (`teamId` null) or a team.
 * null means it can't reach the space at all.
 */
export function levelIn(
  p: Principal,
  teamId: string | null,
): AgentAccess | null {
  const ceiling: AgentAccess = p.flags.readonly ? "read" : "write";
  if (teamId === null) {
    if (!p.personal) return null;
    return lowest(p.access, ceiling);
  }
  const team = p.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const cap = isAgent(p) ? TEAM_CAP[team.agent_access] : "write";
  if (cap === null) return null;
  return lowest(p.access, ROLE_CAP[team.role], cap, ceiling);
}

/**
 * May `p` do `action` on something in `target`'s space? Checked on every
 * call, from live data.
 */
function can(
  p: Principal,
  action: PolicyAction,
  target: { team_id: string | null },
): Decision {
  const level = levelIn(p, target.team_id);
  if (level === null)
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Nothing with that id is reachable from this connection.",
    };
  if (AGENT_ACCESS_RANK[level] < AGENT_ACCESS_RANK[action])
    return {
      ok: false,
      code: "FORBIDDEN",
      message:
        level === "read"
          ? "This connection can only read here."
          : "This connection can only suggest changes here; they wait for review.",
    };
  return { ok: true, level };
}

/** Whether `p` may use a capability at all (before any target is known). */
function allows(
  p: Principal,
  cap: {
    access: AgentAccess;
    toolset: AgentToolset;
    legacyOnly?: boolean;
    aliasOf?: string;
  },
): boolean {
  if (cap.legacyOnly && !cap.aliasOf && p.via !== "legacy_key") return false;
  if (!p.toolsets.includes(cap.toolset)) return false;
  const ceiling: AgentAccess = p.flags.readonly ? "read" : p.access;
  return AGENT_ACCESS_RANK[cap.access] <= AGENT_ACCESS_RANK[ceiling];
}

/** The spaces a principal's reads reach, for the visibility builders. */
function spaces(p: Principal): Spaces {
  return {
    userId: p.user.id,
    teamIds: p.teams.map((t) => t.id),
    personal: p.personal,
  };
}

/**
 * The user a principal's changes are made as: a plain copy with the system
 * role of an ordinary member, so requireTeam's admin override (which only a
 * signed-in session gets) and every system permission stay off.
 */
function actor(p: Principal): { id: string; name: string; role: SystemRole } {
  return { id: p.user.id, name: p.user.name, role: "member" };
}

/**
 * The principal's trust in a space (null: Personal). A connection that may
 * only suggest there (its access or the team's policy) suggests, whatever
 * its trust says.
 */
export function trustIn(p: Principal, teamId: string | null): AgentTrust {
  if (p.access === "suggest") return "suggest";
  return grantTrustIn(
    { trust: p.trust.level, space_trust: p.trust.spaces },
    teamId,
  );
}

export const policy = { can, allows, levelIn, spaces, actor, trustIn };

/**
 * The person's teams as a principal reaches them: current memberships, only
 * the connection's teams when it names some, and never a team whose agent
 * policy is off.
 */
export async function reachableTeams(
  db: Queryable,
  userId: string,
  grantTeamIds: string[] | null,
  via: Via,
): Promise<PrincipalTeam[]> {
  const rows = (
    await db.query<PrincipalTeam>(
      `SELECT t.id, t.name, m.role, t.agent_access
         FROM team_members m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = $1
          AND ($2::uuid[] IS NULL OR t.id = ANY ($2::uuid[]))
        ORDER BY t.name`,
      [userId, grantTeamIds],
    )
  ).rows;
  const agent =
    via === "assistant" ||
    via === "agent_key" ||
    via === "oauth" ||
    via === "legacy_key";
  return agent ? rows.filter((t) => t.agent_access !== "off") : rows;
}

/**
 * The person themselves, signed in to Orbyn's own apps: every space they
 * belong to, full access, every toolset. Lets the app run the same
 * capability code (a saved view's rows) the agents do.
 */
export async function sessionPrincipal(
  db: Queryable,
  user: { id: string; name: string; role: SystemRole },
): Promise<Principal> {
  return {
    user: { id: user.id, name: user.name, role: user.role },
    via: "session",
    grant_id: null,
    client: { id: null, name: "Orbyn" },
    access: "write",
    team_ids: null,
    personal: true,
    toolsets: [...AGENT_TOOLSETS],
    flags: {
      notify_teammates: true,
      hide_outside_content: false,
      readonly: false,
    },
    trust: { level: "full", spaces: {}, acts_alone: [] },
    teams: await reachableTeams(db, user.id, null, "session"),
  };
}
