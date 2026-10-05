import {
  fail,
  agendaPrivatePermissionInput,
  aiProviderChoice,
  type AiProviderChoice,
  type AgendaPrivatePermission,
} from "@orbyn/core";
import { transaction, type Db } from "../../db/pool.js";
import { requireLiveSession } from "./chatgpt-connections.js";
import { readAiProviderChoice } from "./ai-provider-choice.js";
import { readChatgptCatalogLocked } from "./chatgpt-model-catalog.js";

type Session = { userId: string; sessionId: string };
type PermissionRow = {
  id: string;
  enabled: boolean;
  version: string;
  provider_choice: AiProviderChoice | null;
  model: string | null;
  preference_version: string | null;
};
export type AgendaScheduleGrant = {
  id: string;
  version: number;
  providerChoice: AiProviderChoice;
  model: string;
  preferenceVersion: number;
};

async function currentPermission(db: Db, owner: string) {
  return (
    await db.query<PermissionRow>(
      "SELECT * FROM agenda_private_permissions WHERE user_id=$1 FOR SHARE",
      [owner],
    )
  ).rows[0];
}
async function preference(db: Db, choice: AiProviderChoice) {
  if (choice.primary !== "chatgpt" || !choice.connection_id) return null;
  return (
    (
      await db.query<{ model: string | null; version: string }>(
        "SELECT model,version FROM chatgpt_model_preferences WHERE connection_id=$1 FOR SHARE",
        [choice.connection_id],
      )
    ).rows[0] ?? null
  );
}
function matches(
  row: PermissionRow,
  choice: AiProviderChoice,
  selected: { model: string | null; version: string } | null,
) {
  const captured = aiProviderChoice.safeParse(row.provider_choice);
  return (
    row.enabled &&
    choice.primary === "chatgpt" &&
    !!choice.connection_id &&
    !!choice.executor_id &&
    !!selected?.model &&
    captured.success &&
    JSON.stringify(captured.data) === JSON.stringify(choice) &&
    row.model === selected.model &&
    Number(row.preference_version) === Number(selected.version)
  );
}

/** Read owner-only setting; stale account/model choices are explicitly inactive. */
export async function readAgendaPrivatePermission(
  session: Session,
): Promise<AgendaPrivatePermission> {
  return transaction(async (db) => {
    await requireLiveSession(db, session);
    const row = await currentPermission(db, session.userId);
    if (!row)
      return {
        id: null,
        enabled: false,
        active: false,
        version: 0,
        model: null,
      };
    const choice = await readAiProviderChoice(db, session.userId);
    return {
      id: row.id,
      enabled: row.enabled,
      active: !!matches(row, choice, await preference(db, choice)),
      version: Number(row.version),
      model: row.model,
    };
  });
}

/** Only a live first-party session can grant or revoke scheduled private plan use. */
export async function saveAgendaPrivatePermission(
  session: Session,
  raw: unknown,
) {
  const input = agendaPrivatePermissionInput.parse(raw);
  await transaction(async (db) => {
    // Match provider/settings lock ordering and serialize a missing permission row.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      session.userId,
    ]);
    await requireLiveSession(db, session);
    const row = await currentPermission(db, session.userId);
    if (Number(row?.version ?? 0) !== input.expected_version)
      fail(409, "Agenda permission changed. Refresh before saving.");
    const choice = await readAiProviderChoice(db, session.userId);
    let selected: Awaited<ReturnType<typeof preference>> = null;
    if (input.enabled) {
      if (choice.version !== input.expected_provider_choice_version)
        fail(
          409,
          "Your provider choice changed. Review it before allowing scheduled summaries.",
        );
      if (
        choice.primary !== "chatgpt" ||
        !choice.connection_id ||
        !choice.executor_id
      )
        fail(409, "Choose a connected ChatGPT provider first.");
      selected = await preference(db, choice);
      if (
        !selected?.model ||
        Number(selected.version) !== input.expected_preference_version
      )
        fail(
          409,
          "Your ChatGPT model changed. Review it before allowing scheduled summaries.",
        );
      const catalog = await readChatgptCatalogLocked(
        db,
        session,
        {
          connection_id: choice.connection_id,
          executor_id: choice.executor_id,
        },
        false,
        true,
        true,
      );
      if (catalog.status !== "ready")
        fail(
          503,
          "Reconnect your ChatGPT device before granting scheduled summaries.",
        );
      if (!catalog.models.some((m) => m.slug === selected!.model))
        fail(409, "This ChatGPT model is no longer available.");
    }
    await db.query(
      `INSERT INTO agenda_private_permissions(user_id,enabled,provider_choice,model,preference_version)
      VALUES($1,$2,$3::jsonb,$4,$5)
      ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,provider_choice=excluded.provider_choice,model=excluded.model,preference_version=excluded.preference_version,version=agenda_private_permissions.version+1,updated_at=now()`,
      [
        session.userId,
        input.enabled,
        input.enabled ? JSON.stringify(choice) : null,
        selected?.model ?? null,
        selected?.version ?? null,
      ],
    );
  });
  return readAgendaPrivatePermission(session);
}

/** A worker gets no authority from recent sessions, a digest toggle, or a caller's grant data. */
export async function captureAgendaScheduleGrant(
  db: Db,
  owner: string,
): Promise<AgendaScheduleGrant | null> {
  const person = (
    await db.query(
      "SELECT id FROM users WHERE id=$1 AND NOT disabled AND email_verified FOR SHARE",
      [owner],
    )
  ).rowCount;
  if (!person) return null;
  const row = await currentPermission(db, owner);
  if (!row) return null;
  const choice = await readAiProviderChoice(db, owner);
  const selected = await preference(db, choice);
  if (!matches(row, choice, selected)) return null;
  return {
    id: row.id,
    version: Number(row.version),
    providerChoice: choice,
    model: selected!.model!,
    preferenceVersion: Number(selected!.version),
  };
}

/** Revoke and re-enable creates a new version; old scheduled jobs cannot reuse it. */
export async function assertAgendaScheduleGrant(
  db: Db,
  owner: string,
  captured: AgendaScheduleGrant,
) {
  const current = await captureAgendaScheduleGrant(db, owner);
  if (!current || JSON.stringify(current) !== JSON.stringify(captured))
    fail(409, "Scheduled Agenda permission or provider selection changed.");
}
