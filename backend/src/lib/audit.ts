import { query, type Db } from "../db/pool.js";

export type AuditTarget =
  | "user"
  | "team"
  | "item"
  | "session"
  | "proposal"
  | "ai_provider"
  | "system"
  /** A personal API key; `details.user_id` names whose it is. */
  | "api_key"
  /** An outside agent's connection (an agent key or an OAuth sign-in). */
  | "agent_grant"
  /** An app registered to sign in over OAuth. */
  | "oauth_client";

/**
 * Append an entry to the audit log. Pass `db` to write inside a transaction,
 * and `requestId` to join the entry to its request (request_log, and
 * agent_activity for agents).
 */
export async function audit(
  entry: {
    actorId: string | null;
    action: string;
    targetType: AuditTarget;
    targetId?: string | null;
    details?: Record<string, unknown>;
    requestId?: string;
  },
  db?: Db,
) {
  const values = [
    entry.actorId,
    entry.action,
    entry.targetType,
    entry.targetId ?? null,
    JSON.stringify(entry.details ?? {}),
  ];
  await query(
    // The actor's email is saved too, so the entry stays attributable if the account is deleted.
    entry.requestId
      ? "INSERT INTO audit_log(actor_id,actor_email,action,target_type,target_id,details,request_id) VALUES($1,(SELECT email FROM users WHERE id=$1),$2,$3,$4,$5,$6)"
      : "INSERT INTO audit_log(actor_id,actor_email,action,target_type,target_id,details) VALUES($1,(SELECT email FROM users WHERE id=$1),$2,$3,$4,$5)",
    entry.requestId ? [...values, entry.requestId.slice(0, 64)] : values,
    db,
  );
}
