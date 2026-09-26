import {
  addDays,
  cardsInBlocks,
  dayTime,
  isKnown,
  localDateKey,
  newCardState,
  nextIntervals,
  projectKnown,
  type CardState,
  type DocBlock,
  type RevisionPlan,
  type StudyCard,
  type StudyDeck,
  type StudyExam,
  type StudyOverview,
} from "@orbyn/core";
import { pool, transaction, type Queryable as Db } from "../../db/pool.js";
import {
  agendaEntries,
  busyIntervals,
  loadPrefs,
} from "../planner/calendar.js";
import { freeSpans, workingSpans } from "../planner/plans.js";
import { visibleDocs } from "../../lib/visibility.js";

/**
 * Study: cards live in pages as "Question :: Answer" lines, and each person
 * keeps their own review state for the cards on the pages they can see (a
 * team page's cards are studied by each member on their own schedule).
 */

/** Pages `$1` can see. */
export const VISIBLE_DOC = visibleDocs("d");

/** An exam on the calendar: a subscribed exams calendar, or an event named like one. */
const EXAM_WORDS =
  /\b(exams?|midterms?|finals?|tests?|quiz(zes)?|assessments?)\b/i;
const EXAM_HORIZON_DAYS = 60;
/** New cards introduced per day, so a big page doesn't bury you. */
export const NEW_PER_DAY = 20;

type CardRow = {
  id: string;
  doc_id: string;
  doc_title: string;
  card_key: string;
  block_id: string | null;
  question: string;
  answer: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  last_review_at: Date | null;
  due_at: Date;
};

export const stateOf = (r: CardRow): CardState => ({
  stability: r.stability,
  difficulty: r.difficulty,
  reps: r.reps,
  lapses: r.lapses,
  last_review_at: r.last_review_at?.toISOString() ?? null,
  due_at: r.due_at.toISOString(),
});

export const cardOf = (r: CardRow, now = new Date()): StudyCard => {
  const state = stateOf(r);
  return {
    ...state,
    id: r.id,
    doc_id: r.doc_id,
    doc_title: r.doc_title || "Untitled",
    key: r.card_key,
    block_id: r.block_id,
    question: r.question,
    answer: r.answer,
    next: nextIntervals(state, now),
  };
};

/**
 * Cards (`c`) whose page (`d`) is not in Trash. A trashed page keeps its cards
 * so restoring brings them back, so every count and list reads through this.
 */
export const LIVE_CARDS =
  "study_cards c JOIN docs d ON d.id = c.doc_id AND d.deleted_at IS NULL";

export const CARD_SELECT = `SELECT c.id, c.doc_id, d.title AS doc_title, c.card_key, c.block_id,
    c.question, c.answer, c.stability, c.difficulty, c.reps, c.lapses,
    c.last_review_at, c.due_at
  FROM ${LIVE_CARDS}`;

/**
 * Bring one page's cards in line with the page and who can read it: each
 * reader (its author for a personal page, every member for a team page)
 * has a card per line; new lines become new cards (due now), edited lines
 * update theirs, and cards whose line is gone, or whose person can no
 * longer read the page, are dropped. Review state is kept for any card
 * whose line survives. A page in the Trash keeps its cards and their
 * review history, hidden, so restoring it brings them back as they were.
 *
 * This is the write side of Study: pages are synced when they are saved
 * (see {@link drainStudyQueue}), so reading Study never writes.
 */
export async function syncDocCards(db: Db, docId: string): Promise<void> {
  const doc = (
    await db.query<{
      id: string;
      user_id: string;
      team_id: string | null;
      deleted_at: Date | null;
      content: DocBlock[];
    }>(
      "SELECT id, user_id, team_id, deleted_at, content FROM docs WHERE id = $1",
      [docId],
    )
  ).rows[0];
  // A page deleted for good takes its cards with it (ON DELETE CASCADE).
  if (!doc || doc.deleted_at) return;
  const readers = doc.team_id
    ? (
        await db.query<{ user_id: string }>(
          "SELECT user_id FROM team_members WHERE team_id = $1",
          [doc.team_id],
        )
      ).rows.map((r) => r.user_id)
    : [doc.user_id];
  const cards = cardsInBlocks(doc.content ?? []);
  if (cards.length && readers.length)
    await db.query(
      // Page order is kept as each card's creation order, so new cards are
      // learnt top to bottom.
      `INSERT INTO study_cards (user_id, doc_id, card_key, block_id, question, answer, created_at)
       SELECT u.id, $1, x.key, x.block_id, x.question, x.answer,
              now() + (x.ord * interval '1 millisecond')
         FROM unnest($2::uuid[]) AS u(id)
        CROSS JOIN jsonb_to_recordset($3::jsonb)
           AS x(key text, block_id text, question text, answer text, ord int)
       ON CONFLICT (user_id, doc_id, card_key) DO UPDATE
         SET question = EXCLUDED.question, answer = EXCLUDED.answer, block_id = EXCLUDED.block_id
         WHERE study_cards.question IS DISTINCT FROM EXCLUDED.question
            OR study_cards.answer IS DISTINCT FROM EXCLUDED.answer
            OR study_cards.block_id IS DISTINCT FROM EXCLUDED.block_id`,
      [doc.id, readers, JSON.stringify(cards.map((c, ord) => ({ ...c, ord })))],
    );
  await db.query(
    `DELETE FROM study_cards
      WHERE doc_id = $1
        AND (NOT (user_id = ANY ($2::uuid[])) OR NOT (card_key = ANY ($3::text[])))`,
    [doc.id, readers, cards.map((c) => c.key)],
  );
}

/** Pages synced per drain, at most (the notifier drains again next cycle). */
const DRAIN_LIMIT = 200;

/**
 * Sync the pages waiting in the study queue (migration 150 queues a page
 * when its card lines, its space or its Trash state change, and a team's
 * pages when someone joins or leaves it). The API calls this with the ids
 * it just saved, so Study is current at once; the notifier calls it with
 * none, to take whatever is left. Several callers never sync one page at
 * the same time (SKIP LOCKED). Returns how many pages were synced.
 */
export async function drainStudyQueue(
  only: { docIds?: string[]; teamId?: string } = {},
  limit = DRAIN_LIMIT,
): Promise<number> {
  if (only.docIds && !only.docIds.length) return 0;
  return transaction(async (db) => {
    const queued = (
      await db.query<{ doc_id: string }>(
        `SELECT q.doc_id FROM study_card_queue q
          WHERE ($1::uuid[] IS NULL OR q.doc_id = ANY ($1::uuid[]))
            AND ($2::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM docs d WHERE d.id = q.doc_id AND d.team_id = $2))
          ORDER BY q.queued_at LIMIT $3
          FOR UPDATE OF q SKIP LOCKED`,
        [only.docIds ?? null, only.teamId ?? null, limit],
      )
    ).rows.map((r) => r.doc_id);
    for (const id of queued) await syncDocCards(db, id);
    if (queued.length)
      await db.query(
        "DELETE FROM study_card_queue WHERE doc_id = ANY ($1::uuid[])",
        [queued],
      );
    return queued.length;
  });
}

/**
 * {@link drainStudyQueue} for pages just saved, after the answer is ready:
 * a failure here never fails the save (the notifier syncs the page later).
 */
export async function syncSavedPages(...docIds: string[]): Promise<void> {
  try {
    await drainStudyQueue({ docIds });
  } catch {
    // Left in the queue for the notifier.
  }
}

/**
 * The same for a team whose members changed: its pages' cards now belong to
 * the new set of members (someone who joined studies them; someone who left
 * no longer does).
 */
export async function syncTeamPages(teamId: string): Promise<void> {
  try {
    await drainStudyQueue({ teamId }, 1000);
  } catch {
    // Left in the queue for the notifier.
  }
}

/** Upcoming exams: subscribed "exams" calendars, and events named like an exam. */
export async function upcomingExams(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<Omit<StudyExam, "doc_ids" | "readiness">[]> {
  const to = new Date(now.getTime() + EXAM_HORIZON_DAYS * 86_400_000);
  const entries = await agendaEntries(db, userId, now, to, { hidden: true });
  return entries
    .filter(
      (e) => e.calendar_kind === "exams" || EXAM_WORDS.test(e.title ?? ""),
    )
    .filter((e) => e.calendar_kind !== "holidays")
    .slice(0, 30)
    .map((e) => ({
      key: `${e.source === "subscription" ? `sub:${e.calendar}` : `item:${e.item_id}`}|${e.start_at}`,
      title: e.title,
      starts_at: e.start_at,
      all_day: e.all_day,
      source: e.calendar ?? "yours",
      days_left: Math.max(
        0,
        Math.ceil((Date.parse(e.start_at) - now.getTime()) / 86_400_000),
      ),
    }));
}

/** Start of tomorrow in the person's zone. */
const endOfToday = (now: Date, tz: string) =>
  dayTime(addDays(localDateKey(now, tz), 1), 0, tz);

export async function studyOverview(
  userId: string,
  now = new Date(),
): Promise<StudyOverview> {
  const tz = (await loadPrefs(pool, userId)).timezone || "UTC";
  const todayEnd = endOfToday(now, tz);
  const todayStart = dayTime(localDateKey(now, tz), 0, tz);
  const [decks, counts, reviewed, days, weak, exams, attached, ahead, states] =
    await Promise.all([
      pool.query<{
        doc_id: string;
        title: string;
        team_id: string | null;
        cards: number;
        due: number;
        fresh: number;
        known: number;
        next_due_at: string | null;
        imported_from: string | null;
      }>(
        `SELECT c.doc_id, d.title, d.team_id, count(*)::int AS cards,
                min(c.due_at) FILTER (WHERE c.reps > 0) AS next_due_at,
                d.imported_from->>'file_name' AS imported_from,
                count(*) FILTER (WHERE c.reps > 0 AND c.due_at < $2)::int AS due,
                count(*) FILTER (WHERE c.reps = 0)::int AS fresh,
                count(*) FILTER (WHERE c.reps > 0 AND c.stability >= 7)::int AS known
           FROM ${LIVE_CARDS}
          WHERE c.user_id = $1
          GROUP BY c.doc_id, d.title, d.team_id, d.updated_at, d.imported_from
          ORDER BY max(d.updated_at) DESC`,
        [userId, todayEnd],
      ),
      pool.query<{ due: number; fresh: number }>(
        `SELECT count(*) FILTER (WHERE c.reps > 0 AND c.due_at < $2)::int AS due,
                count(*) FILTER (WHERE c.reps = 0)::int AS fresh
           FROM ${LIVE_CARDS} WHERE c.user_id = $1`,
        [userId, todayEnd],
      ),
      pool.query<{ n: number; new_today: number }>(
        `SELECT count(*)::int AS n,
                count(DISTINCT r.card_id) FILTER (
                  WHERE NOT EXISTS (SELECT 1 FROM study_reviews p
                                     WHERE p.card_id = r.card_id AND p.at < $2))::int AS new_today
           FROM study_reviews r WHERE r.user_id = $1 AND r.at >= $2`,
        [userId, todayStart],
      ),
      pool.query<{ day: string }>(
        `SELECT DISTINCT to_char(at AT TIME ZONE $2, 'YYYY-MM-DD') AS day
           FROM study_reviews WHERE user_id = $1 AND at > now() - interval '400 days'
          ORDER BY day DESC`,
        [userId, tz],
      ),
      pool.query<{
        id: string;
        question: string;
        doc_id: string;
        doc_title: string;
        lapses: number;
      }>(
        `SELECT c.id, c.question, c.doc_id, d.title AS doc_title, c.lapses
           FROM ${LIVE_CARDS}
          WHERE c.user_id = $1 AND c.lapses > 0
          ORDER BY c.lapses DESC, c.difficulty DESC LIMIT 6`,
        [userId],
      ),
      upcomingExams(pool, userId, now),
      pool.query<{ exam_key: string; doc_ids: string[] }>(
        "SELECT exam_key, doc_ids FROM study_exams WHERE user_id = $1",
        [userId],
      ),
      // Reviews due on each of the next seven days (overdue counts today).
      pool.query<{ day: string; n: number }>(
        `SELECT to_char(greatest(c.due_at, $3) AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
                count(*)::int AS n
           FROM ${LIVE_CARDS}
          WHERE c.user_id = $1 AND c.reps > 0 AND c.due_at < $3 + interval '8 days'
          GROUP BY 1`,
        [userId, tz, now],
      ),
      pool.query<CardRow>(
        `${CARD_SELECT} WHERE c.user_id = $1 ORDER BY c.created_at`,
        [userId],
      ),
    ]);
  // A streak counts back from today, or from yesterday if today's review
  // hasn't happened yet.
  const reviewedDays = new Set(days.rows.map((d) => d.day));
  let streak = 0;
  let cursor = localDateKey(now, tz);
  if (!reviewedDays.has(cursor)) cursor = addDays(cursor, -1);
  while (reviewedDays.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  const deckList: StudyDeck[] = decks.rows.map((d) => ({
    doc_id: d.doc_id,
    title: d.title || "Untitled",
    team_id: d.team_id,
    cards: d.cards,
    due: d.due,
    new: d.fresh,
    known: d.known,
    next_due_at: d.next_due_at,
    imported_from: d.imported_from,
  }));
  const dueOn = new Map(ahead.rows.map((a) => [a.day, a.n]));
  const forecast = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(localDateKey(now, tz), i);
    return { date, due: dueOn.get(date) ?? 0 };
  });
  const statesBy = new Map<string, CardState[]>();
  for (const c of states.rows) {
    const list = statesBy.get(c.doc_id) ?? [];
    list.push(stateOf(c));
    statesBy.set(c.doc_id, list);
  }
  const byDoc = new Map(deckList.map((d) => [d.doc_id, d]));
  const attachedBy = new Map(attached.rows.map((a) => [a.exam_key, a.doc_ids]));
  const newLeft = Math.max(0, NEW_PER_DAY - reviewed.rows[0].new_today);
  return {
    due_today: counts.rows[0].due,
    new_cards: Math.min(counts.rows[0].fresh, newLeft),
    reviewed_today: reviewed.rows[0].n,
    streak,
    decks: deckList,
    forecast,
    exams: exams.map((e) => {
      const docIds = (attachedBy.get(e.key) ?? []).filter((id) =>
        byDoc.has(id),
      );
      const cards = docIds.reduce((n, id) => n + byDoc.get(id)!.cards, 0);
      const known = docIds.reduce((n, id) => n + byDoc.get(id)!.known, 0);
      return {
        ...e,
        doc_ids: docIds,
        readiness: cards ? Math.round((known / cards) * 100) / 100 : null,
        projected: projectKnown(
          docIds.flatMap((id) => statesBy.get(id) ?? []),
          new Date(e.starts_at),
          now,
          NEW_PER_DAY,
        ),
      };
    }),
    weak: weak.rows.map((w) => ({
      ...w,
      doc_title: w.doc_title || "Untitled",
    })),
  };
}

/**
 * The cards to review now: those due, then up to today's allowance of new
 * ones. `ahead` also brings cards not yet due, soonest first (a last run
 * before an exam).
 */
export async function reviewQueue(
  userId: string,
  options: { docId?: string; limit: number; ahead: boolean },
  now = new Date(),
): Promise<StudyCard[]> {
  const tz = (await loadPrefs(pool, userId)).timezone || "UTC";
  const todayStart = dayTime(localDateKey(now, tz), 0, tz);
  const newToday = (
    await pool.query<{ n: number }>(
      `SELECT count(DISTINCT r.card_id)::int AS n FROM study_reviews r
        WHERE r.user_id = $1 AND r.at >= $2
          AND NOT EXISTS (SELECT 1 FROM study_reviews p
                           WHERE p.card_id = r.card_id AND p.at < $2)`,
      [userId, todayStart],
    )
  ).rows[0].n;
  const doc = options.docId ?? null;
  const due = (
    await pool.query<CardRow>(
      `${CARD_SELECT}
        WHERE c.user_id = $1 AND c.reps > 0 AND ($2::uuid IS NULL OR c.doc_id = $2)
          AND ($3::boolean OR c.due_at <= $4)
        ORDER BY c.due_at LIMIT $5`,
      [userId, doc, options.ahead, now, options.limit],
    )
  ).rows;
  const room = Math.min(
    options.limit - due.length,
    doc ? options.limit : Math.max(0, NEW_PER_DAY - newToday),
  );
  const fresh =
    room > 0
      ? (
          await pool.query<CardRow>(
            `${CARD_SELECT}
              WHERE c.user_id = $1 AND c.reps = 0 AND ($2::uuid IS NULL OR c.doc_id = $2)
              ORDER BY c.created_at, c.id LIMIT $3`,
            [userId, doc, room],
          )
        ).rows
      : [];
  return [...due, ...fresh].map((r) => cardOf(r, now));
}

export async function cardById(db: Db, userId: string, id: string) {
  return (
    await db.query<CardRow>(
      `${CARD_SELECT} WHERE c.id = $2 AND c.user_id = $1`,
      [userId, id],
    )
  ).rows[0];
}

/**
 * Review sessions before an exam, in free working time: one a day from
 * tomorrow (today too if there's room) until the day before, up to three
 * weeks out, a little longer in the last three days. A day with no free
 * stretch long enough is skipped and listed. Nothing is saved here.
 */
export async function planRevision(
  userId: string,
  exam: StudyExam,
  minutes: number,
  now = new Date(),
): Promise<RevisionPlan> {
  const prefs = await loadPrefs(pool, userId);
  const tz = prefs.timezone || "UTC";
  const examDay = localDateKey(new Date(exam.starts_at), tz);
  const today = localDateKey(now, tz);
  const first = [addDays(examDay, -21), today].sort().at(-1)!;
  const sessions: RevisionPlan["sessions"] = [];
  const skipped: string[] = [];
  const from = new Date(
    Math.max(now.getTime(), dayTime(first, 0, tz).getTime()),
  );
  const to = dayTime(examDay, 0, tz);
  if (to <= from)
    return { exam, sessions, total_minutes: 0, skipped_days: skipped };
  const busy = await busyIntervals(pool, userId, from, to, {
    blocks: true,
    derived: true,
  });
  for (let day = first; day < examDay; day = addDays(day, 1)) {
    const start = new Date(
      Math.max(now.getTime(), dayTime(day, 0, tz).getTime()),
    );
    const end = dayTime(addDays(day, 1), 0, tz);
    const daysBefore = Math.round(
      (dayTime(examDay, 0, tz).getTime() - dayTime(day, 0, tz).getTime()) /
        86_400_000,
    );
    const length =
      (daysBefore <= 3 ? Math.round((minutes * 1.5) / 5) * 5 : minutes) *
      60_000;
    const slot = freeSpans(workingSpans(prefs, start, end), busy).find(
      (s) => s.end - s.start >= length,
    );
    if (!slot) {
      skipped.push(day);
      continue;
    }
    sessions.push({
      start_at: new Date(slot.start).toISOString(),
      end_at: new Date(slot.start + length).toISOString(),
    });
  }
  return {
    exam,
    sessions,
    total_minutes: Math.round(
      sessions.reduce(
        (n, s) => n + (Date.parse(s.end_at) - Date.parse(s.start_at)),
        0,
      ) / 60_000,
    ),
    skipped_days: skipped,
  };
}

export { isKnown, newCardState };
