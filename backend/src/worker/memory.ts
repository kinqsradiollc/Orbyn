import { z } from "zod";
import type {
  ChatMessage,
  ResolvedAi,
} from "../modules/ai/providers/adapters.js";
import { complete } from "../modules/ai/providers/adapters.js";
import { pool, transaction } from "../db/pool.js";
import { keptOutFor } from "../lib/assistant-off.js";
import {
  completeChatMaintenance,
  finishChatMaintenance,
  releaseChatMaintenance,
} from "../modules/ai/providers/chat-maintenance.js";
import { rememberMemory } from "../modules/memory/service.js";
import { ChatgptDeviceDeferred } from "../modules/ai/providers/user-choice.js";

const extraction = z
  .object({
    topics: z
      .array(
        z
          .object({
            topic: z.string().trim().min(1).max(120),
            facts: z.array(z.string().trim().min(1).max(500)).max(8),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

const system = `You extract a small set of durable, useful facts the person explicitly shared in this completed Orbyn assistant conversation. Return only JSON: {"topics":[{"topic":"short topic","facts":["one concise fact"]}]}.
Remember stable preferences, ongoing goals, and personal context that will help in future conversations. Do not infer facts, repeat temporary task details, or store passwords, credentials, financial or health details, or other sensitive information. If nothing is clearly useful to remember, return {"topics":[]}. Keep each topic distinct and each fact short.`;

/** A turn that fails this many times is dropped rather than retried forever. */
export const MAX_ATTEMPTS = 5;

type QueuedTurn = {
  id: string;
  chat_id: string;
  user_id: string;
  turns: { role: "user" | "assistant"; content: string }[];
  source_project_id: string | null;
  maintenance_job_id: string | null;
};

export type MemoryCompleter = (
  ai: ResolvedAi,
  messages: ChatMessage[],
) => Promise<string>;

function parseJson(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return extraction.parse(JSON.parse(clean));
}

/** Process finished assistant turns away from the request path. */
export async function drainMemoryQueue(
  options: {
    ai?: ResolvedAi | null;
    completeTurn?: MemoryCompleter;
    limit?: number;
  } = {},
): Promise<number> {
  if (options.ai === null) return 0;
  const completeTurn = options.completeTurn ?? complete;
  const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
  const jobs = await transaction(async (db) => {
    await db.query("DELETE FROM memory_queue WHERE attempts >= $1", [
      MAX_ATTEMPTS,
    ]);
    const rows = (
      await db.query<QueuedTurn>(
        `SELECT id, chat_id, user_id, turns, source_project_id, maintenance_job_id
           FROM memory_queue
          WHERE claimed_at IS NULL OR claimed_at < now() -
            make_interval(mins => least(60, greatest(5, attempts * 5)))
          ORDER BY queued_at, id
          LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit],
      )
    ).rows;
    if (!rows.length) return rows;
    await db.query(
      "UPDATE memory_queue SET claimed_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])",
      [rows.map((row) => row.id)],
    );
    return rows;
  });

  for (const job of jobs) {
    let claim: string | undefined;
    try {
      // Recheck persisted provenance before any provider call, including queued
      // turns written by an older worker during a rolling deployment.
      const personalChat = (
        await pool.query(
          "SELECT 1 FROM ai_chats WHERE id=$1 AND user_id=$2 AND origin='person'",
          [job.chat_id, job.user_id],
        )
      ).rowCount;
      if (!personalChat) {
        await pool.query("DELETE FROM memory_queue WHERE id = $1", [job.id]);
        continue;
      }
      const keptOut = await keptOutFor(pool, job.user_id);
      if (
        job.source_project_id &&
        keptOut.projects.has(job.source_project_id)
      ) {
        await pool.query("DELETE FROM memory_queue WHERE id = $1", [job.id]);
        continue;
      }
      const conversation = job.turns
        .filter(
          (turn) =>
            (turn.role === "user" || turn.role === "assistant") &&
            typeof turn.content === "string",
        )
        .map((turn) => `${turn.role}: ${turn.content}`)
        .join("\n\n")
        .slice(-24_000);
      if (!job.maintenance_job_id)
        throw new Error("Queued maintenance authority is unverified");
      const response = await completeChatMaintenance(
        job.user_id,
        job.maintenance_job_id,
        [
          { role: "system", content: system },
          { role: "user", content: conversation },
        ],
        {
          ai: options.ai,
          send: completeTurn,
          onClaim: (value) => {
            claim = value;
          },
        },
      );
      const result = parseJson(response);
      const sources = [
        {
          type: "chat" as const,
          id: job.chat_id,
          label: "Assistant conversation",
          quote: null,
        },
        ...(job.source_project_id
          ? [
              {
                type: "project" as const,
                id: job.source_project_id,
                label: "Project conversation",
                quote: null,
              },
            ]
          : []),
      ];
      await transaction(async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `memory:${job.user_id}`,
        ]);
        const stillQueued = (
          await db.query(
            `SELECT 1 FROM memory_queue q JOIN ai_chats c ON c.id=q.chat_id
             WHERE q.id=$1 AND q.user_id=$2 AND c.user_id=$2 AND c.origin='person'
             FOR SHARE OF c`,
            [job.id, job.user_id],
          )
        ).rowCount;
        if (!stillQueued) {
          await db.query(
            "DELETE FROM memory_queue WHERE id=$1 AND user_id=$2",
            [job.id, job.user_id],
          );
          return;
        }
        await finishChatMaintenance(
          db,
          job.user_id,
          job.maintenance_job_id!,
          claim!,
        );
        for (const topic of result.topics)
          await rememberMemory(
            db,
            job.user_id,
            topic.topic,
            topic.facts,
            sources,
          );
        await db.query("DELETE FROM memory_queue WHERE id = $1", [job.id]);
      });
    } catch (error) {
      // A source removed during the model call must not leave queued personal text behind.
      await pool.query(
        `DELETE FROM memory_queue q WHERE q.id=$1 AND q.user_id=$2
         AND NOT EXISTS(SELECT 1 FROM ai_chats c WHERE c.id=q.chat_id
           AND c.user_id=q.user_id AND c.origin='person')`,
        [job.id, job.user_id],
      );
      if (job.maintenance_job_id && claim)
        await releaseChatMaintenance(
          job.user_id,
          job.maintenance_job_id,
          claim,
          error instanceof SyntaxError || error instanceof z.ZodError,
        ).catch(() => {});
      // The queued text stays available for retry; logs and error fields never hold it.
      await pool
        .query(
          "UPDATE memory_queue SET last_error=$2,attempts=greatest(0,attempts-$3) WHERE id=$1",
          [
            job.id,
            error instanceof ChatgptDeviceDeferred
              ? "Waiting for your ChatGPT device."
              : "Learning failed",
            error instanceof ChatgptDeviceDeferred ? 1 : 0,
          ],
        )
        .catch(() => {});
    }
  }
  return jobs.length;
}
