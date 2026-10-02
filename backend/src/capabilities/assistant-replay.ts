import { createHash } from "node:crypto";
import { policy, type Principal } from "./policy.js";
import { Params, scopeFor } from "../lib/visibility.js";
import type { Queryable } from "../db/pool.js";
import { assistantJobSourcesVisible } from "../lib/assistant-job-sources.js";
import { assistantChatVisible } from "../lib/assistant-visibility.js";
import { CapabilityError } from "./registry.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}

/** Bind a cached assistant result to effective authority, without storing permission content. */
export function assistantReplayAuthority(p: Principal): string | undefined {
  if (p.via !== "assistant") return undefined;
  const evidence = {
    version: 1,
    owner: p.user.id,
    grant: p.grant_id,
    lane: p.assistant_lane ?? "interactive",
    job: p.assistant_job_id ?? null,
    unattended: !!p.unattended,
    access: p.access,
    personal: p.personal,
    team_ids: p.team_ids === null ? null : [...p.team_ids].sort(),
    teams: p.teams
      .map(({ id, role, agent_access }) => ({ id, role, agent_access }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    toolsets: [...p.toolsets].sort(),
    flags: p.flags,
    trust: { ...p.trust, acts_alone: [...p.trust.acts_alone].sort() },
    rules_revision: p.assistant_rules_revision,
    rules: [...(p.assistant_rules ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
  return `v1:${createHash("sha256")
    .update(JSON.stringify(canonical(evidence)))
    .digest("base64url")}`;
}

/** Recheck the producer's container and strict current sources before revealing a cached result. */
export async function assertAssistantReplaySources(
  db: Queryable,
  p: Principal,
) {
  if (p.via !== "assistant" || !p.assistant_job_id) return;
  const params = new Params(
    p.assistant_job_id,
    p.assistant_lane ?? "interactive",
  );
  const scope = scopeFor(policy.spaces(p), params);
  const source = await db.query(
    `SELECT j.id FROM ai_jobs j JOIN ai_chats c ON c.id=j.chat_id
     WHERE j.id=$1 AND j.runtime_lane=$2
       AND ${assistantChatVisible("c", scope.user, scope)}
       AND ${assistantJobSourcesVisible("j", scope.user, false, scope)}
     FOR SHARE OF j,c`,
    params.values,
  );
  if (!source.rowCount)
    throw new CapabilityError(
      "FORBIDDEN",
      "The producing work or its sources are unavailable. The cached result was held.",
      "Read the current work or ask the person to review it. Do not repeat the change with a new client_ref.",
    );
}
