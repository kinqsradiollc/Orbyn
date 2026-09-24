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
  | "api_key";

/** Append an entry to the audit log. Pass `db` to write inside a transaction. */
export async function audit(
  entry: {
    actorId: string | null;
    action: string;
    targetType: AuditTarget;
    targetId?: string | null;
    details?: Record<string, unknown>;
  },
  db?: Db,
) {
  await query(
    // The actor's email is saved too, so the entry stays attributable if the account is deleted.
    "INSERT INTO audit_log(actor_id,actor_email,action,target_type,target_id,details) VALUES($1,(SELECT email FROM users WHERE id=$1),$2,$3,$4,$5)",
    [
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId ?? null,
      JSON.stringify(entry.details ?? {}),
    ],
    db,
  );
}
