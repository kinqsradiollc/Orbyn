import type { FastifyInstance } from "fastify";
import {
  actionSchema,
  applyRevisionInput,
  examDecksInput,
  fail,
  review,
  reviewInput,
  revisionPlanInput,
  studyQueueQuery,
} from "@orbyn/core";
import { pool, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import { idParam } from "../../lib/params.js";
import { mutate } from "../items/service.js";
import { announceTo } from "../presence/live.js";
import {
  cardById,
  cardOf,
  planRevision,
  reviewQueue,
  stateOf,
  studyOverview,
} from "./service.js";

/**
 * Study: what's due, reviewing cards, exams and the pages revised for them,
 * and revision sessions planned into free time. Nothing is scheduled until
 * the person approves the plan.
 */
export async function studyRoutes(app: FastifyInstance) {
  app.get("/study", async (r) => {
    const u = await authenticate(r);
    return studyOverview(u.id);
  });

  app.get("/study/queue", async (r) => {
    const u = await authenticate(r);
    const q = studyQueueQuery.parse(r.query);
    return reviewQueue(u.id, {
      docId: q.doc_id,
      limit: q.limit,
      ahead: q.ahead,
    });
  });

  // One review: the card's next date comes from how well it was recalled.
  app.post("/study/cards/:id/review", async (r) => {
    const u = await authenticate(r);
    const { rating } = reviewInput.parse(r.body ?? {});
    const now = new Date();
    return transaction(async (db) => {
      const card = await cardById(db, u.id, idParam(r));
      if (!card) fail(404, "Card not found");
      const next = review(stateOf(card), rating, now);
      await db.query(
        `UPDATE study_cards SET stability = $3, difficulty = $4, reps = $5,
           lapses = $6, last_review_at = $7, due_at = $8
         WHERE id = $1 AND user_id = $2`,
        [
          card.id,
          u.id,
          next.stability,
          next.difficulty,
          next.reps,
          next.lapses,
          next.last_review_at,
          next.due_at,
        ],
      );
      await db.query(
        "INSERT INTO study_reviews (user_id, card_id, rating, at) VALUES ($1, $2, $3, $4)",
        [u.id, card.id, rating, now],
      );
      return cardOf((await cardById(db, u.id, card.id))!, now);
    });
  });

  // Which pages you're revising for an exam.
  app.put("/study/exams", async (r) => {
    const u = await authenticate(r);
    const d = examDecksInput.parse(r.body ?? {});
    const visible = (
      await pool.query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE d.id = ANY ($2::uuid[])
           AND d.deleted_at IS NULL
           AND ((d.team_id IS NULL AND d.user_id = $1)
             OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $1))`,
        [u.id, d.doc_ids],
      )
    ).rows.map((x) => x.id);
    await pool.query(
      `INSERT INTO study_exams (user_id, exam_key, title, starts_at, doc_ids)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, exam_key) DO UPDATE
         SET title = EXCLUDED.title, starts_at = EXCLUDED.starts_at,
             doc_ids = EXCLUDED.doc_ids, updated_at = now()`,
      [
        u.id,
        d.key,
        d.title,
        d.starts_at,
        d.doc_ids.filter((id) => visible.includes(id)),
      ],
    );
    return studyOverview(u.id);
  });

  /**
   * Revision sessions before an exam, proposed into free time. Nothing is
   * saved: the person reviews them and applies the ones they want.
   */
  app.post("/study/revision/plan", async (r) => {
    const u = await authenticate(r);
    const d = revisionPlanInput.parse(r.body ?? {});
    const exam = (await studyOverview(u.id)).exams.find((e) => e.key === d.key);
    if (!exam)
      fail(404, "That exam isn't on your calendar in the next 60 days.");
    return planRevision(u.id, exam, d.minutes);
  });

  /**
   * Apply an approved plan: a task "Revise for …" due at the exam, with the
   * chosen sessions set aside for it, so they sit on the calendar and the
   * planner works around them.
   */
  app.post("/study/revision/apply", async (r, reply) => {
    const u = await authenticate(r);
    const d = applyRevisionInput.parse(r.body ?? {});
    const exam = (await studyOverview(u.id)).exams.find((e) => e.key === d.key);
    if (!exam)
      fail(404, "That exam isn't on your calendar in the next 60 days.");
    for (const s of d.sessions)
      if (Date.parse(s.end_at) <= Date.parse(s.start_at))
        fail(422, "Each session has to end after it starts.");
    const minutes = Math.round(
      d.sessions.reduce(
        (n, s) => n + (Date.parse(s.end_at) - Date.parse(s.start_at)),
        0,
      ) / 60_000,
    );
    const result = await transaction(async (db) => {
      const task = await mutate(
        db,
        { id: u.id, role: u.role },
        actionSchema.parse({
          operation: "create",
          data: {
            title: `Revise for ${exam.title}`.slice(0, 200),
            kind: "task",
            due_at: exam.starts_at,
            estimate_minutes: Math.min(minutes, 6000),
            notes:
              "Planned by Study. Review your cards in each session; the sessions are on your calendar.",
          },
        }),
      );
      const blocks: string[] = [];
      for (const s of d.sessions)
        blocks.push(
          (
            await db.query<{ id: string }>(
              `INSERT INTO time_blocks (item_id, user_id, start_at, end_at)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [task!.id, u.id, s.start_at, s.end_at],
            )
          ).rows[0].id,
        );
      return { item_id: task!.id, block_ids: blocks, minutes };
    });
    await announceTo(pool, { user_id: u.id }, "changed").catch(() => {});
    reply.code(201);
    return result;
  });
}
