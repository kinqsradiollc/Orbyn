import {
  aiProviderChoice,
  aiProviderChoiceInput,
  fail,
  type AiProviderChoice,
} from "@orbyn/core";
import { transaction, type Queryable } from "../../db/pool.js";
import { requireLiveSession } from "./chatgpt-connections.js";
import { readChatgptCatalogLocked } from "./chatgpt-model-catalog.js";
export async function readAiProviderChoice(
  db: Queryable,
  userId: string,
): Promise<AiProviderChoice> {
  const row = (
    await db.query(
      "SELECT primary_provider AS primary,connection_id,executor_id,fallback_to_default,version FROM user_ai_provider_choice WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  if (!row)
    return {
      primary: "default",
      connection_id: null,
      executor_id: null,
      fallback_to_default: false,
      version: 0,
    };
  // Revocation keeps the user's ChatGPT choice; it never silently enables default billing.
  if (row.primary === "chatgpt" && (!row.connection_id || !row.executor_id))
    return { ...row, version: Number(row.version) };
  return aiProviderChoice.parse({ ...row, version: Number(row.version) });
}
export async function saveAiProviderChoice(
  session: { userId: string; sessionId: string },
  value: unknown,
) {
  const input = aiProviderChoiceInput.parse(value);
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      session.userId,
    ]);
    await requireLiveSession(db, session);
    if (input.primary === "chatgpt") {
      const catalog = await readChatgptCatalogLocked(
        db,
        session,
        {
          connection_id: input.connection_id,
          executor_id: input.executor_id,
        },
        false,
        true,
      );
      if (catalog.status !== "ready" || !catalog.preference.model)
        fail(409, "Choose an available ChatGPT model first.");
    }
    const current = await readAiProviderChoice(db, session.userId);
    if (current.version !== input.expected_version)
      fail(409, "Your provider choice changed. Reload before saving.");
    await db.query(
      `INSERT INTO user_ai_provider_choice(user_id,primary_provider,connection_id,executor_id,fallback_to_default)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET primary_provider=EXCLUDED.primary_provider,
   connection_id=EXCLUDED.connection_id,executor_id=EXCLUDED.executor_id,fallback_to_default=EXCLUDED.fallback_to_default,version=user_ai_provider_choice.version+1,updated_at=now()`,
      [
        session.userId,
        input.primary,
        input.primary === "chatgpt" ? input.connection_id : null,
        input.primary === "chatgpt" ? input.executor_id : null,
        input.fallback_to_default,
      ],
    );
    return readAiProviderChoice(db, session.userId);
  });
}
