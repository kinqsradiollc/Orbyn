import { createHash } from "node:crypto";
import { fail } from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { assistantPrincipal } from "../agents/assistant.js";
import { readAiProviderChoice } from "../auth/ai-provider-choice.js";

/** Stable execution authority; progress, activity and approved targets are not configuration. */
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const assistantExecutionDigest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export async function assistantExecutionContext(
  db: Queryable,
  owner: string,
  lane: "background" | "overnight",
) {
  const person = (
    await db.query<{ id: string; name: string; role: "member" | "admin" }>(
      "SELECT id,name,role FROM users WHERE id=$1 AND NOT disabled",
      [owner],
    )
  ).rows[0];
  const grant = (
    await db.query(
      "SELECT id FROM agent_grants WHERE user_id=$1 AND kind='assistant' AND revoked_at IS NULL AND suspended_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR SHARE",
      [owner],
    )
  ).rows[0];
  if (!person || !grant) return null;
  return assistantPrincipal(person, {
    db,
    touch: false,
    lane,
    refusePaused: true,
  });
}
export async function assistantExecutionFingerprints(
  db: Queryable,
  owner: string,
  lane: "background" | "overnight",
) {
  const principal = await assistantExecutionContext(db, owner, lane);
  if (!principal) fail(409, "Your assistant permission is unavailable.");
  const choice = await readAiProviderChoice(db, owner);
  const managed =
    (
      await db.query(
        `SELECT s.provider_id,s.model,s.generation_revision::text AS revision,p.generation_revision::text AS provider_revision,p.enabled FROM ai_settings s LEFT JOIN ai_providers p ON p.id=s.provider_id WHERE s.id`,
      )
    ).rows[0] ?? null;
  const preference = choice.connection_id
    ? ((
        await db.query(
          "SELECT model,version::text FROM chatgpt_model_preferences WHERE connection_id=$1",
          [choice.connection_id],
        )
      ).rows[0] ?? null)
    : null;
  return {
    provider_hash: assistantExecutionDigest({
      choice,
      managed:
        choice.primary === "default" || choice.fallback_to_default
          ? managed
          : null,
      preference,
    }),
    scope_hash: assistantExecutionDigest({
      grant: principal.grant_id,
      access: principal.access,
      personal: principal.personal,
      team_ids: principal.team_ids,
      teams: principal.teams,
      toolsets: principal.toolsets,
      trust: principal.trust,
      flags: principal.flags,
      rules: principal.assistant_rules,
      rules_revision: principal.assistant_rules_revision,
    }),
  };
}
