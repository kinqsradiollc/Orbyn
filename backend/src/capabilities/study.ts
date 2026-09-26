import { z } from "zod";
import { RATINGS } from "@orbyn/core";
import { Params, scopeFor, visibleDocs } from "../lib/visibility.js";
import {
  planRevision,
  reviewCard,
  reviewQueue,
  setExamDecks,
  studyOverview,
} from "../modules/study/service.js";
import { READ, minutesText } from "./common.js";
import { both, clean, cleanTitle, fencedTitle, labelled } from "./format.js";
import { appUrl, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { seeDoc } from "./shared.js";
import { sealRevision } from "./write-sessions.js";
import {
  ADDS,
  MAX_BATCH,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  idField,
  refuseSecrets,
  writeOutput,
  type DoneEntry,
} from "./write.js";

/**
 * The study toolset: decks built from pages, cards due, exams and their
 * pages, recording reviews after quizzing the person, attaching pages to an
 * exam, and previewing revision sessions (applied by schedule_sessions).
 * Study is the person's own: every card is theirs, from pages they can
 * read; a deck from a page outside this connection's spaces is left out.
 */

/** The pages (decks) this connection may see, out of `ids`. */
async function reachablePages(ctx: CapabilityContext, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const p = new Params();
  const scope = scopeFor(ctx.spaces, p);
  return new Set(
    (
      await ctx.db.query<{ id: string }>(
        `SELECT d.id FROM docs d WHERE d.id = ANY (${p.add(ids)}::uuid[])
            AND ${visibleDocs("d", scope)}`,
        p.values,
      )
    ).rows.map((r) => r.id),
  );
}

const personal = (ctx: CapabilityContext) => {
  if (!ctx.principal.personal)
    throw new CapabilityError(
      "FORBIDDEN",
      "Study is the person's own, so this connection needs their Personal space.",
    );
};

/** An exam's title as an agent sees it: one from a subscribed calendar is outside text. */
const examTitle = (
  ctx: CapabilityContext,
  e: { title: string; source: string },
) =>
  e.source === "yours"
    ? cleanTitle(e.title)
    : ctx.principal.flags.hide_outside_content
      ? "An exam from a subscribed calendar"
      : fencedTitle(e.title, "subscribed_feed");

// --- get_study ------------------------------------------------------------

export const getStudy = defineCapability({
  name: "get_study",
  title: "Study overview",
  description:
    "Decks (pages with Question :: Answer cards), cards due today and ahead, upcoming exams with their pages and readiness, and, with queue, the cards to review now (answers hidden unless reveal is true, so the person can be quizzed).",
  input: z
    .object({
      queue: z.boolean().default(false),
      deck: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Only this page's cards."),
      ahead: z.boolean().default(false).describe("Include cards not due yet."),
      reveal: z.boolean().default(false),
      limit: z.number().int().min(1).max(100).default(20),
    })
    .strict(),
  output: z.object({
    due_today: z.number(),
    new_cards: z.number(),
    reviewed_today: z.number(),
    streak: z.number(),
    decks: z.array(
      z.object({
        doc: z.string(),
        title: z.string(),
        url: z.string(),
        cards: z.number(),
        due: z.number(),
        known: z.number(),
      }),
    ),
    exams: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        starts: z.object({ at: z.string(), local: z.string() }),
        days_left: z.number(),
        pages: z.array(z.string()),
        readiness: z.number().nullable(),
      }),
    ),
    queue: z.array(
      z.object({
        card: z.string(),
        doc: z.string(),
        question: z.string(),
        answer: z.string().nullable(),
        due: z.string(),
      }),
    ),
  }),
  annotations: READ,
  access: "read",
  toolset: "study",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    personal(ctx);
    const me = ctx.principal.user.id;
    const o = await studyOverview(me, ctx.now, ctx.db);
    const reach = await reachablePages(ctx, [
      ...o.decks.map((d) => d.doc_id),
      ...o.exams.flatMap((e) => e.doc_ids),
    ]);
    const decks = o.decks
      .filter((d) => reach.has(d.doc_id))
      .map((d) => {
        const r = refs({ type: "doc", id: d.doc_id });
        return {
          doc: r.id,
          title: cleanTitle(d.title) || "Untitled",
          url: r.url,
          cards: d.cards,
          due: d.due,
          known: d.known,
        };
      });
    const exams = o.exams.map((e) => ({
      key: e.key,
      title: examTitle(ctx, e),
      starts: both(e.starts_at, ctx.timezone)!,
      days_left: e.days_left,
      pages: e.doc_ids.filter((id) => reach.has(id)).map((id) => `doc:${id}`),
      readiness: e.readiness,
    }));
    let queue: {
      card: string;
      doc: string;
      question: string;
      answer: string | null;
      due: string;
    }[] = [];
    if (a.queue) {
      const deck = a.deck ? (await seeDoc(ctx, a.deck)).id : undefined;
      const cards = await reviewQueue(
        me,
        { docId: deck, limit: a.limit, ahead: a.ahead },
        ctx.now,
        ctx.db,
      );
      queue = cards
        .filter((c) => reach.has(c.doc_id) || c.doc_id === deck)
        .map((c) => ({
          card: c.id,
          doc: `doc:${c.doc_id}`,
          question: clean(c.question, 2000),
          answer: a.reveal ? clean(c.answer, 4000) : null,
          due: c.due_at ?? ctx.now.toISOString(),
        }));
    }
    const structured = {
      due_today: o.due_today,
      new_cards: o.new_cards,
      reviewed_today: o.reviewed_today,
      streak: o.streak,
      decks,
      exams,
      queue,
    };
    return {
      structured,
      markdown: [
        `${o.due_today} card${o.due_today === 1 ? "" : "s"} due today, ${o.new_cards} new; ${o.reviewed_today} reviewed today; a ${o.streak}-day streak.`,
        ...(decks.length
          ? [
              "Decks:",
              ...decks.map(
                (d) =>
                  `- ${d.title}: ${d.cards} cards, ${d.due} due · ${d.doc}`,
              ),
            ]
          : []),
        ...(exams.length
          ? [
              "Exams:",
              ...exams.map(
                (e) =>
                  `- ${e.title} ${e.starts.local} (${e.days_left} days) · key ${e.key}`,
              ),
            ]
          : []),
        ...(queue.length
          ? [
              "Queue:",
              ...queue.map(
                (q, i) =>
                  `${i + 1}. ${labelled(q.question, "you")}${q.answer ? ` — ${q.answer}` : ""} · card ${q.card}`,
              ),
            ]
          : []),
      ].join("\n"),
    };
  },
});

// --- update_study -----------------------------------------------------------

export const updateStudy = defineCapability({
  name: "update_study",
  title: "Record reviews and exams",
  description:
    "Records how the person recalled cards (again, hard, good or easy) after quizzing them, and sets which pages are revised for an exam (key from get_study; pages they can't read are left out). New cards come from editing pages with Question :: Answer lines.",
  input: z
    .object({
      reviews: z
        .array(z.object({ card: idField, rating: z.enum(RATINGS) }).strict())
        .max(MAX_BATCH)
        .optional(),
      exam: z
        .object({
          key: z.string().trim().min(1).max(300),
          pages: z.array(z.string().trim().max(300)).max(30),
        })
        .strict()
        .optional(),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "write",
  toolset: "study",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    personal(ctx);
    if (destination(ctx, null, "W1") === "review")
      throw new CapabilityError(
        "FORBIDDEN",
        "This connection can only suggest changes, and study reviews don't go through review.",
      );
    const db = dbOf(ctx);
    const me = ctx.principal.user.id;
    const done: DoneEntry[] = [];
    for (const r of a.reviews ?? []) {
      const card = await reviewCard(db, me, r.card, r.rating, ctx.now);
      done.push({
        id: `card:${card.id}`,
        title: cleanTitle(card.question).slice(0, 120) || "Card",
        url: refs({ type: "doc", id: card.doc_id }).url,
        version: null,
        change: `Reviewed (${r.rating}); back ${both(card.due_at ?? ctx.now, ctx.timezone)!.local}`,
      });
    }
    if (a.exam) {
      const o = await studyOverview(me, ctx.now, db);
      const exam = o.exams.find((e) => e.key === a.exam!.key);
      if (!exam)
        throw new CapabilityError(
          "NOT_FOUND",
          "That exam isn't on the calendar in the next 60 days.",
          "get_study lists the exams with their keys.",
        );
      const ids: string[] = [];
      for (const p of a.exam.pages) ids.push((await seeDoc(ctx, p)).id);
      refuseSecrets(exam.title);
      await setExamDecks(db, me, {
        key: exam.key,
        title: exam.title,
        starts_at: exam.starts_at,
        doc_ids: ids,
      });
      done.push({
        id: `exam:${exam.key}`,
        title: examTitle(ctx, exam),
        url: `${appUrl()}/app/today`,
        version: null,
        change: `${ids.length} page${ids.length === 1 ? "" : "s"} attached`,
      });
    }
    if (!done.length)
      throw new CapabilityError("INVALID", "Give reviews or an exam.");
    return finishWrite(ctx, "Study", { done });
  },
});

// --- plan_revision ----------------------------------------------------------

export const planRevisionCapability = defineCapability({
  name: "plan_revision",
  title: "Preview revision sessions",
  description:
    'Previews revision sessions in free working time before an exam (one a day from up to three weeks out, longer in the last three days) without changing anything, and returns a plan_token: schedule_sessions puts them on the calendar with a "Revise for …" task.',
  input: z
    .object({
      exam: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe("The exam's key from get_study."),
      minutes: z.number().int().min(15).max(120).default(30),
    })
    .strict(),
  output: z.object({
    exam: z.string(),
    sessions: z.array(
      z.object({ start_at: z.string(), end_at: z.string(), local: z.string() }),
    ),
    total_minutes: z.number(),
    skipped_days: z.array(z.string()),
    plan_token: z.string(),
    expires_at: z.string(),
  }),
  annotations: READ,
  access: "read",
  toolset: "study",
  mode: "read",
  tier: "R",
  async run(ctx, a) {
    personal(ctx);
    const me = ctx.principal.user.id;
    const o = await studyOverview(me, ctx.now, ctx.db);
    const exam = o.exams.find((e) => e.key === a.exam);
    if (!exam)
      throw new CapabilityError(
        "NOT_FOUND",
        "That exam isn't on the calendar in the next 60 days.",
        "get_study lists the exams with their keys.",
      );
    ctx.progress?.(1, 2, "Finding free working time before the exam");
    const plan = await planRevision(me, exam, a.minutes, ctx.now, ctx.db);
    const sealed = await sealRevision(ctx, exam.key, a.minutes, plan.sessions);
    ctx.progress?.(2, 2, "Plan ready");
    const sessions = plan.sessions.map((s) => ({
      ...s,
      local: both(s.start_at, ctx.timezone)!.local,
    }));
    return {
      structured: {
        exam: examTitle(ctx, exam),
        sessions,
        total_minutes: plan.total_minutes,
        skipped_days: plan.skipped_days,
        plan_token: sealed.token,
        expires_at: sealed.expires_at,
      },
      markdown: [
        `${sessions.length} revision session${sessions.length === 1 ? "" : "s"} (${minutesText(plan.total_minutes)}) before ${examTitle(ctx, exam)}:`,
        ...sessions.map((s) => `- ${s.local}`),
        ...(plan.skipped_days.length
          ? [`No free time on ${plan.skipped_days.join(", ")}.`]
          : []),
        "",
        "Nothing is on the calendar yet. To keep these, call schedule_sessions with plan_token.",
      ].join("\n"),
    };
  },
});
