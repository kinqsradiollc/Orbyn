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
  applyRevision,
  planRevision,
  reviewCard,
  reviewQueue,
  setExamDecks,
  studyOverview,
  withCardSources,
} from "./service.js";
import { readableDocs } from "../../lib/visibility.js";

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
    // Each card with the notes line it came from, where they can read it.
    return withCardSources(
      pool,
      u.id,
      await reviewQueue(u.id, {
        docId: q.doc_id,
        limit: q.limit,
        ahead: q.ahead,
      }),
    );
  });

  // One review: the card's next date comes from how well it was recalled.
  app.post("/study/cards/:id/review", async (r) => {
    const u = await authenticate(r);
    const { rating } = reviewInput.parse(r.body ?? {});
    return transaction((db) => reviewCard(db, u.id, idParam(r), rating));
  });

  // Which pages you're revising for an exam.
  app.put("/study/exams", async (r) => {
    const u = await authenticate(r);
    const d = examDecksInput.parse(r.body ?? {});
    await setExamDecks(pool, u.id, d);
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
    const result = await transaction((db) => applyRevision(db, u, d));
    await announceTo(pool, { user_id: u.id }, "changed").catch(() => {});
    reply.code(201);
    return result;
  });
}
