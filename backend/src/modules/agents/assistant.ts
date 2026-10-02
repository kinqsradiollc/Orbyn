import { AGENT_TOOLSETS, type SystemRole } from "@orbyn/core";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { reachableTeams, type Principal } from "../../capabilities/policy.js";

const approvalScopeInput = z.union([
  z.literal("always"),
  z.object({ scope: z.enum(["goal", "routine"]), id: z.uuid() }).strict(),
]);
const approvalScopesInput = z
  .partialRecord(
    z.enum([
      "tasks",
      "sessions",
      "pages",
      "projects",
      "memory",
      "study",
      "other",
    ]),
    approvalScopeInput,
  )
  .default({});
type ApprovalScopes = z.output<typeof approvalScopesInput>;

type AssistantGrantRow = {
  id: string;
  assistant_rules_revision: number;
  trust: "full" | "ask" | "suggest";
  space_trust: Record<string, "full" | "ask" | "suggest">;
  acts_alone: string[];
  toolsets: string[] | null;
  suspended_at: Date | null;
};

/** The person paused their built-in assistant in Connected agents. */
export class AssistantPausedError extends Error {
  constructor() {
    super("Your assistant is paused in Connected agents.");
    this.name = "AssistantPausedError";
  }
}

/** Toolsets a new assistant grant starts with: booking is opt-in. */
const DEFAULT_ASSISTANT_TOOLSETS = AGENT_TOOLSETS.filter(
  (toolset) => toolset !== "booking",
);

/**
 * One stable, non-revocable grant for the built-in assistant. With
 * `refusePaused`, a grant paused in Connected agents throws
 * AssistantPausedError instead of acting.
 */
export async function assistantPrincipal(
  user: {
    id: string;
    name: string;
    role: SystemRole;
  },
  options: { refusePaused?: boolean } = {},
): Promise<Principal> {
  const identity = (
    await pool.query<{ name: string }>(
      "SELECT name FROM agent_settings WHERE user_id = $1",
      [user.id],
    )
  ).rows[0];
  const name = identity?.name || "Orbyn";
  const grant = (
    await pool.query<AssistantGrantRow>(
      `INSERT INTO agent_grants
         (user_id, kind, name, client_name, access, team_ids, personal,
          toolsets, flags, trust, space_trust, acts_alone)
       VALUES ($1, 'assistant', $3, $3, 'write',
          NULL, true, $2::text[], '{"notify_teammates":false}'::jsonb,
          'full', '{}'::jsonb, '{}')
       ON CONFLICT (user_id) WHERE kind = 'assistant'
       DO UPDATE SET name = EXCLUDED.name, client_name = EXCLUDED.client_name,
                     last_used_at = now()
       RETURNING id, trust, space_trust, acts_alone, toolsets, suspended_at, assistant_rules_revision`,
      [user.id, [...DEFAULT_ASSISTANT_TOOLSETS], name],
    )
  ).rows[0];
  if (!grant) throw new Error("The Orbyn assistant grant is unavailable.");
  if (options.refusePaused && grant.suspended_at)
    throw new AssistantPausedError();
  return {
    user: { id: user.id, name: user.name, role: user.role },
    via: "assistant",
    assistant_rules_revision: grant.assistant_rules_revision,
    grant_id: grant.id,
    client: { id: null, name },
    access: "write",
    team_ids: null,
    personal: true,
    toolsets: AGENT_TOOLSETS.filter((toolset) =>
      (
        (grant.toolsets ?? DEFAULT_ASSISTANT_TOOLSETS) as readonly string[]
      ).includes(toolset),
    ),
    flags: {
      notify_teammates: false,
      hide_outside_content: false,
      readonly: false,
    },
    trust: {
      level: grant.trust,
      spaces: grant.space_trust ?? {},
      acts_alone: (grant.acts_alone ?? []) as Principal["trust"]["acts_alone"],
    },
    teams: await reachableTeams(pool, user.id, null, "assistant"),
  };
}

/** Approval scopes are stored separately from the assistant's base trust. */
export async function assistantApprovalScopes(
  userId: string,
): Promise<ApprovalScopes> {
  const grant = (
    await pool.query<{ approval_scopes: unknown }>(
      `SELECT approval_scopes FROM agent_grants
        WHERE user_id = $1 AND kind = 'assistant' AND revoked_at IS NULL`,
      [userId],
    )
  ).rows[0];
  return approvalScopesInput.parse(grant?.approval_scopes ?? {});
}
