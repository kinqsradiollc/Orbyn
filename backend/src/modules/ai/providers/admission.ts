import { pool } from "../../../db/pool.js";
import { readAiProviderChoice } from "../../auth/ai-provider-choice.js";
import { resolveAi } from "./resolve.js";
import type { AiProviderChoice } from "@orbyn/core";
import type { ResolvedAi } from "./adapters.js";

/** Admission advertises the selected route; dispatch still verifies live account authority. */
export async function assistantProviderCapabilities(
  owner: string,
  readChoice: (owner: string) => Promise<AiProviderChoice> = (id) =>
    readAiProviderChoice(pool, id),
  managed: () => Promise<ResolvedAi | null> = resolveAi,
): Promise<{ enabled: boolean; tools: boolean }> {
  const choice = await readChoice(owner);
  if (choice.primary === "chatgpt") {
    // Device readiness is rechecked at dispatch. Admission must not require
    // a workspace provider or substitute it for this personal choice.
    if (choice.connection_id && choice.executor_id)
      return { enabled: true, tools: false };
    if (!choice.fallback_to_default) return { enabled: false, tools: false };
    return { enabled: !!(await managed()), tools: false };
  }
  const provider = await managed();
  return {
    enabled: !!provider,
    tools: !!provider && !provider.structuredOutput,
  };
}

/**
 * Scheduler eligibility, before LIMIT/claims. Only trusted SQL column expressions
 * may be passed. Like interactive admission, a personal binding needs no managed
 * provider. Catalog, credentials and captured authority are checked at dispatch;
 * admission never decrypts an unrelated workspace credential.
 */
export function assistantProviderAdmissionSql(
  ownerColumn: string,
  override?: ResolvedAi | null,
): string {
  if (override !== undefined) return override ? "TRUE" : "FALSE";
  const managed = `EXISTS (SELECT 1 FROM ai_settings scheduler_settings
    JOIN ai_providers scheduler_provider ON scheduler_provider.id=scheduler_settings.provider_id
    WHERE scheduler_settings.id AND scheduler_provider.enabled AND scheduler_settings.model<>'')`;
  return `coalesce((SELECT CASE WHEN scheduler_choice.primary_provider='chatgpt' THEN
    CASE WHEN scheduler_choice.connection_id IS NOT NULL AND scheduler_choice.executor_id IS NOT NULL
      THEN TRUE ELSE scheduler_choice.fallback_to_default AND ${managed} END
    ELSE ${managed} END
    FROM user_ai_provider_choice scheduler_choice WHERE scheduler_choice.user_id=${ownerColumn}), ${managed})`;
}
