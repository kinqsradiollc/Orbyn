import {
  AGENT_ACCESS_RANK,
  AGENT_TOOLSETS,
  assistantActionRules,
  type AgentAccess,
  type AgentAskFirst,
  type AgentSpaceTrust,
  type AgentTrust,
} from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import { reachableTeams, type Principal } from "./policy.js";
import { CapabilityError } from "./registry.js";

const trustRank = { full: 0, ask: 1, suggest: 2 } as const;
const stricterTrust = (a: AgentTrust, b: AgentTrust): AgentTrust =>
  trustRank[a] >= trustRank[b] ? a : b;

/** Current built-in authority intersects, never expands, a server-selected caller. */
export async function currentAssistantPrincipal(
  db: Queryable,
  p: Principal,
  write = false,
): Promise<Principal> {
  if (p.via !== "assistant") return p;
  const grant = (
    await db.query<{
      rules: unknown;
      revision: number;
      access: AgentAccess;
      personal: boolean;
      team_ids: string[] | null;
      toolsets: string[] | null;
      flags: { notify_teammates?: boolean; hide_outside_content?: boolean };
      trust: AgentTrust;
      space_trust: AgentSpaceTrust;
      acts_alone: AgentAskFirst[];
    }>(
      `SELECT g.assistant_rules AS rules,g.assistant_rules_revision AS revision,
        g.access,g.personal,g.team_ids,g.toolsets,g.flags,g.trust,g.space_trust,g.acts_alone
       FROM agent_grants g JOIN users u ON u.id=g.user_id AND NOT u.disabled
       WHERE g.id=$1 AND g.user_id=$2 AND g.kind='assistant'
         AND g.revoked_at IS NULL AND g.suspended_at IS NULL
         AND (g.expires_at IS NULL OR g.expires_at>now())${write ? " FOR SHARE OF g" : ""}`,
      [p.grant_id, p.user.id],
    )
  ).rows[0];
  if (!grant)
    throw new CapabilityError(
      "FORBIDDEN",
      "Your assistant is paused or unavailable.",
    );
  if (
    p.assistant_rules_revision !== undefined &&
    p.assistant_rules_revision !== grant.revision
  )
    throw new CapabilityError(
      "FORBIDDEN",
      "Assistant rules changed. Review the plan again.",
    );
  const teamIds =
    grant.team_ids === null
      ? p.team_ids
      : p.team_ids === null
        ? grant.team_ids
        : grant.team_ids.filter((id) => p.team_ids!.includes(id));
  const roleRank = { viewer: 0, member: 1, admin: 2, owner: 3 } as const;
  const teamAccessRank = { off: 0, read: 1, suggest: 2, role: 3 } as const;
  const teams = (
    await reachableTeams(db, p.user.id, teamIds, "assistant")
  ).flatMap((team) => {
    const before = p.teams.find((old) => old.id === team.id);
    if (!before) return [];
    return [
      {
        ...team,
        role:
          roleRank[before.role] < roleRank[team.role] ? before.role : team.role,
        agent_access:
          teamAccessRank[before.agent_access] <
          teamAccessRank[team.agent_access]
            ? before.agent_access
            : team.agent_access,
      },
    ];
  });
  const spaces: AgentSpaceTrust = {};
  for (const space of new Set([
    ...Object.keys(p.trust.spaces),
    ...Object.keys(grant.space_trust ?? {}),
  ]))
    spaces[space] = stricterTrust(
      p.trust.spaces[space] ?? p.trust.level,
      grant.space_trust?.[space] ?? grant.trust,
    );
  const toolsets =
    grant.toolsets ?? AGENT_TOOLSETS.filter((toolset) => toolset !== "booking");
  return {
    ...p,
    access:
      AGENT_ACCESS_RANK[p.access] <= AGENT_ACCESS_RANK[grant.access]
        ? p.access
        : grant.access,
    personal: p.personal && grant.personal,
    team_ids: teamIds,
    teams,
    toolsets: p.toolsets.filter((toolset) => toolsets.includes(toolset)),
    flags: {
      ...p.flags,
      notify_teammates:
        p.flags.notify_teammates && !!grant.flags?.notify_teammates,
      hide_outside_content:
        p.flags.hide_outside_content || !!grant.flags?.hide_outside_content,
    },
    trust: {
      level: stricterTrust(p.trust.level, grant.trust),
      spaces,
      acts_alone: p.trust.acts_alone.filter((action) =>
        (grant.acts_alone ?? []).includes(action),
      ),
    },
    assistant_rules_revision: grant.revision,
    assistant_rules: assistantActionRules.parse(grant.rules),
  };
}
