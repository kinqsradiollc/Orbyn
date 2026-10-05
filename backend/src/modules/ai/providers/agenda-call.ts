import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  fail,
  aiProviderChoice,
  aiFeatureProvider,
  type AiFeatureProvider,
  type AiProviderChoice,
} from "@orbyn/core";
import { readAiProviderChoice } from "../../auth/ai-provider-choice.js";
import { pool, transaction, type Db } from "../../../db/pool.js";
import { recordAssistantSources } from "../../../lib/assistant-job-sources.js";
import { requireLiveSession } from "../../auth/chatgpt-connections.js";
import { assertChatgptJobAccess } from "../../auth/chatgpt-inference.js";
import {
  assertAgendaAiSnapshot,
  type AgendaAiSnapshot,
} from "../../docs/agenda-ai-snapshot.js";
import { resolveUserAi } from "./user-choice.js";
import { complete, type ChatMessage } from "./adapters.js";

const source = z
  .object({
    kind: z.enum(["doc", "task", "calendar", "habit", "exam"]),
    id: z.uuid(),
    version: z.number().int().nonnegative().optional(),
  })
  .strict();
const reference = z.union([
  z
    .object({
      kind: z.enum(["time_block", "habit_block"]),
      id: z.uuid(),
      version: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("calendar_event"),
      calendarId: z.uuid(),
      uid: z.string().max(4096),
      startAt: z.iso.datetime(),
    })
    .strict(),
]);
const title = z.string().max(100);
const when = z.string().max(64);
const factsSchema = z
  .object({
    now: when,
    calendar: z.array(z.object({ when, title }).strict()).max(20),
    due_today: z.array(title).max(10),
    top_priorities: z.array(title).max(3),
    study: z
      .object({
        cards_to_review: z.number().int().nonnegative(),
        exams: z
          .array(z.object({ title, days_left: z.number().int() }).strict())
          .max(2000),
      })
      .strict()
      .optional(),
    slipped: z.number().int().nonnegative(),
    set_aside: z.array(z.object({ when, title }).strict()).max(8),
    free_minutes_left: z.number().int().nonnegative().nullable(),
    coming_up: z
      .array(
        z
          .object({ title, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
          .strict(),
      )
      .max(8),
  })
  .strict();
const stateSchema = z
  .object({
    version: z.literal(4),
    feature: z.literal("agenda_brief"),
    operation_id: z.uuid(),
    session_id: z.uuid(),
    provider_choice: aiProviderChoice,
    preference: z
      .object({
        connection_id: z.uuid(),
        model: z.string().nullable(),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    snapshot: z
      .object({
        ownerId: z.uuid(),
        capturedAt: z.iso.datetime(),
        digest: z.string().regex(/^[0-9a-f]{64}$/),
        facts: factsSchema,
        sources: z.array(source).max(2000),
        references: z.array(reference).max(10000),
      })
      .strict(),
  })
  .strict();
type Session = { userId: string; sessionId: string };
export const agendaSnapshotSchema = stateSchema.shape.snapshot;
async function preferenceFor(db: Db, choice: AiProviderChoice) {
  if (choice.primary !== "chatgpt" || !choice.connection_id) return null;
  const row = (
    await db.query(
      "SELECT model,version FROM chatgpt_model_preferences WHERE connection_id=$1 FOR SHARE",
      [choice.connection_id],
    )
  ).rows[0];
  return row
    ? {
        connection_id: choice.connection_id,
        model: row.model,
        version: Number(row.version),
      }
    : null;
}

/** Recheck the originating app session and Agenda snapshot on the broker's connection. */
export async function guardAgendaInferenceJob(
  db: Db,
  owner: string,
  jobId: string,
) {
  const row = (
    await db.query(
      "SELECT run_state,agenda_summary_run_id,claimed_by FROM ai_jobs WHERE id=$1 AND user_id=$2",
      [jobId, owner],
    )
  ).rows[0];
  if (row?.run_state?.version === 5 || row?.agenda_summary_run_id) {
    const { guardScheduledAgendaJob } =
      await import("../../docs/agenda-summary-runs.js");
    await guardScheduledAgendaJob(db, owner, jobId, row);
    return;
  }
  if (row?.run_state?.version !== 4) return;
  const parsed = stateSchema.safeParse(row.run_state);
  if (!parsed.success)
    fail(409, "This Agenda inference context is unavailable.");
  await requireLiveSession(db, {
    userId: owner,
    sessionId: parsed.data.session_id,
  });
  const choice = await readAiProviderChoice(db, owner);
  if (
    JSON.stringify(choice) !== JSON.stringify(parsed.data.provider_choice) ||
    JSON.stringify(await preferenceFor(db, choice)) !==
      JSON.stringify(parsed.data.preference)
  )
    fail(409, "The captured Agenda provider or model changed.");
  try {
    await assertAgendaAiSnapshot(
      owner,
      new Date(parsed.data.snapshot.capturedAt),
      parsed.data.snapshot,
      db,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Agenda "))
      fail(409, "The captured Agenda sources or facts changed.");
    throw error;
  }
}

/** One app-authorized Agenda completion; no chat/tool authority or implicit scheduled consent. */
export async function completeAgendaFeature(
  session: Session,
  snapshot: AgendaAiSnapshot,
  messages: ChatMessage[],
  expectedChoice?: AiProviderChoice,
  onProvider?: (provider: AiFeatureProvider) => void,
): Promise<string> {
  const owner = session.userId;
  const operationId = randomUUID();
  const claimedBy = `agenda:${randomUUID()}`;
  const jobId = await transaction(async (db) => {
    await requireLiveSession(db, session);
    const choice = await readAiProviderChoice(db, owner);
    if (
      expectedChoice &&
      JSON.stringify(choice) !== JSON.stringify(expectedChoice)
    )
      fail(409, "The Agenda provider choice changed.");
    await assertAgendaAiSnapshot(
      owner,
      new Date(snapshot.capturedAt),
      snapshot,
      db,
    );
    const state = stateSchema.parse({
      version: 4,
      feature: "agenda_brief",
      operation_id: operationId,
      session_id: session.sessionId,
      snapshot,
      provider_choice: choice,
      preference: await preferenceFor(db, choice),
    });
    return (
      await db.query<{ id: string }>(
        "INSERT INTO ai_jobs(user_id,state,claimed_by,lease_until,run_state) VALUES($1,'running',$2,clock_timestamp()+interval '150 seconds',$3::jsonb) RETURNING id",
        [owner, claimedBy, JSON.stringify(state)],
      )
    ).rows[0].id;
  });
  try {
    await recordAssistantSources(
      jobId,
      owner,
      {},
      snapshot.sources.map((s) => `${s.kind}:${s.id}`),
    );
    const ai = await resolveUserAi(owner, jobId, async () => {});
    if (!ai) fail(503, "The selected AI provider is unavailable.");
    const assertAuthority = async () => {
      await ai.assertAuthority?.();
      await assertChatgptJobAccess(owner, jobId);
    };
    const text = await complete(
      { ...ai, operationId, assertAuthority },
      messages,
      {
        signal: AbortSignal.timeout(30_000),
        timeoutMs: 30_000,
        maxOutputTokens: 512,
      },
    );
    await assertAuthority();
    await ai.recordCompletion?.();
    const done = await pool.query(
      "UPDATE ai_jobs SET state='done',lease_until=NULL,claimed_by=NULL,heartbeat_at=now() WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$3 AND lease_until>clock_timestamp() RETURNING result",
      [jobId, owner, claimedBy],
    );
    if (!done.rowCount) fail(409, "This Agenda completion expired.");
    const provider = aiFeatureProvider.safeParse(
      done.rows[0]?.result?.feature_provider,
    );
    if (provider.success) onProvider?.(provider.data);
    return text;
  } catch (error) {
    await pool
      .query(
        "UPDATE ai_jobs SET state='failed',lease_until=NULL,claimed_by=NULL,error_status=503,error_message='This Agenda completion did not finish. It was not retried.',heartbeat_at=now() WHERE id=$1 AND user_id=$2 AND state='running' AND claimed_by=$3",
        [jobId, owner, claimedBy],
      )
      .catch(() => {});
    throw error;
  }
}
