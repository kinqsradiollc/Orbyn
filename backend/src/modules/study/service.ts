import type { z } from "zod";
import {
  actionSchema,
  applyRevisionInput,
  examDecksInput,
  fail,
  review,
  type Rating,
  type SystemRole,
  addDays,
  cardsInBlocks,
  dayTime,
  isKnown,
  localDateKey,
  newCardState,
  nextIntervals,
  plainText,
  projectKnown,
  type CardState,
  type DocBlock,
  type RevisionPlan,
  type StudyCard,
  type StudyDeck,
  type StudyExam,
  type StudyOverview,
} from "@orbyn/core";
import {
  pool,
  transaction,
  type Db as Tx,
  type Queryable as Db,
} from "../../db/pool.js";
import {
  agendaEntries,
  busyIntervals,
  loadPrefs,
} from "../planner/calendar.js";
import { freeSpans, workingSpans } from "../planner/plans.js";
import { readableDocs, visibleDocs } from "../../lib/visibility.js";
import { mutate } from "../items/service.js";
import { readableLinks } from "../links/privacy.js";

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
/** Cards listed under "Keeps getting wrong". */
export const WEAK_LIMIT = 6;

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
  source_doc_id: string | null;
  source_block_id: string | null;
  picture_file: string | null;
  misses: number;
  needs_work_at: Date | null;
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
    source: r.source_doc_id
      ? {
          doc_id: r.source_doc_id,
          block_id: r.source_block_id,
          doc_title: "",
          text: "",
        }
      : null,
    picture: r.picture_file,
    misses: r.misses,
    needs_work: !!r.needs_work_at,
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
    c.last_review_at, c.due_at, c.source_doc_id, c.source_block_id,
    c.picture_file, c.misses, c.needs_work_at
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
      // A card's source page is kept only while it exists (a link to a
      // page deleted for good, or never there, names nothing).
      `INSERT INTO study_cards (user_id, doc_id, card_key, block_id, question, answer,
                               source_doc_id, source_block_id, picture_file, created_at)
       SELECT u.id, $1, x.key, x.block_id, x.question, x.answer,
              (SELECT s.id FROM docs s WHERE s.id = x.source_doc_id),
              x.source_block_id, x.picture,
              now() + (x.ord * interval '1 millisecond')
         FROM unnest($2::uuid[]) AS u(id)
        CROSS JOIN jsonb_to_recordset($3::jsonb)
           AS x(key text, block_id text, question text, answer text,
                source_doc_id uuid, source_block_id text, picture text, ord int)
       ON CONFLICT (user_id, doc_id, card_key) DO UPDATE
         SET question = EXCLUDED.question, answer = EXCLUDED.answer, block_id = EXCLUDED.block_id,
             source_doc_id = EXCLUDED.source_doc_id, source_block_id = EXCLUDED.source_block_id,
             picture_file = EXCLUDED.picture_file
         WHERE study_cards.question IS DISTINCT FROM EXCLUDED.question
            OR study_cards.answer IS DISTINCT FROM EXCLUDED.answer
            OR study_cards.block_id IS DISTINCT FROM EXCLUDED.block_id
            OR study_cards.source_doc_id IS DISTINCT FROM EXCLUDED.source_doc_id
            OR study_cards.source_block_id IS DISTINCT FROM EXCLUDED.source_block_id
            OR study_cards.picture_file IS DISTINCT FROM EXCLUDED.picture_file`,
      [
        doc.id,
        readers,
        JSON.stringify(
          cards.map((c, ord) => ({
            key: c.key,
            block_id: c.block_id,
            question: c.question,
            answer: c.answer,
            source_doc_id: c.source?.doc_id ?? null,
            source_block_id: c.source?.block_id ?? null,
            picture: c.picture,
            ord,
          })),
        ),
      ],
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
  options: { horizonDays?: number; limit?: number | null } = {},
): Promise<Omit<StudyExam, "doc_ids" | "readiness">[]> {
  const limit = options.limit === undefined ? 30 : options.limit;
  const to = new Date(
    now.getTime() + (options.horizonDays ?? EXAM_HORIZON_DAYS) * 86_400_000,
  );
  const [entries, own] = await Promise.all([
    agendaEntries(db, userId, now, to, { hidden: true }),
    // Exams named in Study itself (H4), not on the calendar.
    db.query<{
      exam_key: string;
      title: string;
      starts_at: Date;
      all_day: boolean;
    }>(
      `SELECT exam_key, title, starts_at, all_day FROM study_exams
        WHERE user_id = $1 AND own AND starts_at > $2 AND starts_at <= $3
        ORDER BY starts_at LIMIT $4::int`,
      [userId, now, to, limit],
    ),
  ]);
  const daysLeft = (at: string) =>
    Math.max(0, Math.ceil((Date.parse(at) - now.getTime()) / 86_400_000));
  return [
    ...entries
      .filter(
        (e) => e.calendar_kind === "exams" || EXAM_WORDS.test(e.title ?? ""),
      )
      .filter((e) => e.calendar_kind !== "holidays")
      .map((e) => ({
        key: `${e.source === "subscription" ? `sub:${e.calendar}` : `item:${e.item_id}`}|${e.start_at}`,
        title: e.title,
        starts_at: e.start_at,
        all_day: e.all_day,
        source: e.calendar ?? "yours",
        days_left: daysLeft(e.start_at),
      })),
    ...own.rows.map((e) => ({
      key: e.exam_key,
      title: e.title,
      starts_at: e.starts_at.toISOString(),
      all_day: e.all_day,
      source: "yours",
      days_left: daysLeft(e.starts_at.toISOString()),
    })),
  ]
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    .slice(0, limit ?? undefined);
}

/** Start of tomorrow in the person's zone. */
const endOfToday = (now: Date, tz: string) =>
  dayTime(addDays(localDateKey(now, tz), 1), 0, tz);

export async function studyOverview(
  userId: string,
  now = new Date(),
  db: Db = pool,
): Promise<StudyOverview> {
  const tz = (await loadPrefs(db, userId)).timezone || "UTC";
  const todayEnd = endOfToday(now, tz);
  const todayStart = dayTime(localDateKey(now, tz), 0, tz);
  const [decks, counts, reviewed, days, weak, exams, attached, ahead, states] =
    await Promise.all([
      db.query<{
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
      db.query<{ due: number; fresh: number }>(
        `SELECT count(*) FILTER (WHERE c.reps > 0 AND c.due_at < $2)::int AS due,
                count(*) FILTER (WHERE c.reps = 0)::int AS fresh
           FROM ${LIVE_CARDS} WHERE c.user_id = $1`,
        [userId, todayEnd],
      ),
      db.query<{ n: number; new_today: number }>(
        `SELECT count(*)::int AS n,
                count(DISTINCT r.card_id) FILTER (
                  WHERE NOT EXISTS (SELECT 1 FROM study_reviews p
                                     WHERE p.card_id = r.card_id AND p.at < $2))::int AS new_today
           FROM study_reviews r WHERE r.user_id = $1 AND r.at >= $2`,
        [userId, todayStart],
      ),
      db.query<{ day: string }>(
        `SELECT DISTINCT to_char(at AT TIME ZONE $2, 'YYYY-MM-DD') AS day
           FROM study_reviews WHERE user_id = $1 AND at > now() - interval '400 days'
          ORDER BY day DESC`,
        [userId, tz],
      ),
      db.query<{
        id: string;
        question: string;
        doc_id: string;
        doc_title: string;
        lapses: number;
        misses: number;
        source_doc_id: string | null;
        source_block_id: string | null;
        source_title: string | null;
      }>(
        // What the person keeps getting wrong: most "again" answers first.
        // The notes line to re-read is named only while they can read it.
        `SELECT c.id, c.question, c.doc_id, d.title AS doc_title, c.lapses, c.misses,
                s.id AS source_doc_id, CASE WHEN s.id IS NULL THEN NULL ELSE c.source_block_id END AS source_block_id,
                s.title AS source_title
           FROM ${LIVE_CARDS}
           LEFT JOIN docs s ON s.id = c.source_doc_id AND s.deleted_at IS NULL
                           AND ${readableDocs("s")}
          WHERE c.user_id = $1 AND (c.misses > 0 OR c.lapses > 0)
          ORDER BY c.misses DESC, c.lapses DESC, c.difficulty DESC LIMIT ${WEAK_LIMIT}`,
        [userId],
      ),
      upcomingExams(db, userId, now),
      db.query<{ exam_key: string; doc_ids: string[]; target: string | null }>(
        "SELECT exam_key, doc_ids, target FROM study_exams WHERE user_id = $1",
        [userId],
      ),
      // Reviews due on each of the next seven days (overdue counts today).
      db.query<{ day: string; n: number }>(
        `SELECT to_char(greatest(c.due_at, $3) AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
                count(*)::int AS n
           FROM ${LIVE_CARDS}
          WHERE c.user_id = $1 AND c.reps > 0 AND c.due_at < $3 + interval '8 days'
          GROUP BY 1`,
        [userId, tz, now],
      ),
      db.query<CardRow>(
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
  const targetBy = new Map(attached.rows.map((a) => [a.exam_key, a.target]));
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
        target: targetBy.get(e.key) ?? null,
        projected: projectKnown(
          docIds.flatMap((id) => statesBy.get(id) ?? []),
          new Date(e.starts_at),
          now,
          NEW_PER_DAY,
        ),
      };
    }),
    weak: (await readableLinks(pool, userId, weak.rows)).map(
      ({ source_doc_id, source_block_id, source_title, ...w }) => ({
        ...w,
        doc_title: w.doc_title || "Untitled",
        source: source_doc_id
          ? {
              doc_id: source_doc_id,
              block_id: source_block_id,
              doc_title: source_title || "Untitled",
            }
          : null,
      }),
    ),
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
  db: Db = pool,
): Promise<StudyCard[]> {
  const tz = (await loadPrefs(db, userId)).timezone || "UTC";
  const todayStart = dayTime(localDateKey(now, tz), 0, tz);
  const newToday = (
    await db.query<{ n: number }>(
      `SELECT count(DISTINCT r.card_id)::int AS n FROM study_reviews r
        WHERE r.user_id = $1 AND r.at >= $2
          AND NOT EXISTS (SELECT 1 FROM study_reviews p
                           WHERE p.card_id = r.card_id AND p.at < $2)`,
      [userId, todayStart],
    )
  ).rows[0].n;
  const doc = options.docId ?? null;
  const due = (
    await db.query<CardRow>(
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
          await db.query<CardRow>(
            `${CARD_SELECT}
              WHERE c.user_id = $1 AND c.reps = 0 AND ($2::uuid IS NULL OR c.doc_id = $2)
              ORDER BY c.created_at, c.id LIMIT $3`,
            [userId, doc, room],
          )
        ).rows
      : [];
  // Cards are copied from page lines when synced; the words of links this
  // person can't open (now) read "Private page" (D3aF).
  return (await readableLinks(pool, userId, [...due, ...fresh])).map((r) =>
    cardOf(r, now),
  );
}

/** One of `userId`'s cards, its words as they may read them (D3aF). */
export async function cardById(db: Db, userId: string, id: string) {
  const row = (
    await db.query<CardRow>(
      `${CARD_SELECT} WHERE c.id = $2 AND c.user_id = $1`,
      [userId, id],
    )
  ).rows[0];
  return row ? readableLinks(db, userId, row) : row;
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
  db: Db = pool,
  /**
   * When the person likes to study ("HH:MM" ranges from their profile,
   * H8): tried first each day, before working hours.
   */
  windows: { start: string; end: string }[] = [],
): Promise<RevisionPlan> {
  const prefs = await loadPrefs(db, userId);
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
  const busy = await busyIntervals(db, userId, from, to, {
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
    const fits = (spans: { start: number; end: number }[]) =>
      freeSpans(spans, busy).find((s) => s.end - s.start >= length);
    const study = windows.flatMap((w) => {
      const [sh, sm] = w.start.split(":").map(Number);
      const [eh, em] = w.end.split(":").map(Number);
      const from = dayTime(day, sh * 60 + sm, tz).getTime();
      let to = dayTime(day, eh * 60 + em, tz).getTime();
      if (to <= from) to = dayTime(addDays(day, 1), eh * 60 + em, tz).getTime();
      to = Math.min(to, dayTime(examDay, 0, tz).getTime());
      const a = Math.max(from, start.getTime());
      return to > a ? [{ start: a, end: to }] : [];
    });
    const slot =
      (study.length ? fits(study) : undefined) ??
      fits(workingSpans(prefs, start, end));
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

/** One review: the card's next date comes from how well it was recalled. */
export async function reviewCard(
  db: Db,
  userId: string,
  cardId: string,
  rating: Rating,
  now = new Date(),
): Promise<StudyCard> {
  const card = await cardById(db, userId, cardId);
  if (!card) fail(404, "Card not found");
  const next = review(stateOf(card), rating, now);
  // "Again" counts as a miss (what the person keeps getting wrong); a card
  // marked "needs work" is cleared once it's recalled well.
  await db.query(
    `UPDATE study_cards SET stability = $3, difficulty = $4, reps = $5,
   lapses = $6, last_review_at = $7, due_at = $8,
   misses = misses + CASE WHEN $9 = 'again' THEN 1 ELSE 0 END,
   needs_work_at = CASE WHEN $9 IN ('good', 'easy') THEN NULL ELSE needs_work_at END,
   needs_work_note = CASE WHEN $9 IN ('good', 'easy') THEN NULL ELSE needs_work_note END
 WHERE id = $1 AND user_id = $2`,
    [
      card.id,
      userId,
      next.stability,
      next.difficulty,
      next.reps,
      next.lapses,
      next.last_review_at,
      next.due_at,
      rating,
    ],
  );
  await db.query(
    "INSERT INTO study_reviews (user_id, card_id, rating, at) VALUES ($1, $2, $3, $4)",
    [userId, card.id, rating, now],
  );
  return cardOf((await cardById(db, userId, card.id))!, now);
}

/** Which pages are revised for an exam (only pages the person can read). */
export async function setExamDecks(
  db: Db,
  userId: string,
  input: z.input<typeof examDecksInput>,
) {
  const d = examDecksInput.parse(input);
  const visible = (
    await db.query<{ id: string }>(
      `SELECT d.id FROM docs d WHERE d.id = ANY ($2::uuid[])
       AND d.deleted_at IS NULL
       AND ${readableDocs("d")}`,
      [userId, d.doc_ids],
    )
  ).rows.map((x) => x.id);
  await db.query(
    `INSERT INTO study_exams (user_id, exam_key, title, starts_at, doc_ids)
   VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (user_id, exam_key) DO UPDATE
     SET title = EXCLUDED.title, starts_at = EXCLUDED.starts_at,
         doc_ids = EXCLUDED.doc_ids, updated_at = now()`,
    [
      userId,
      d.key,
      d.title,
      d.starts_at,
      d.doc_ids.filter((id) => visible.includes(id)),
    ],
  );
}

/**
 * Apply an approved revision plan: a task "Revise for …" due at the exam,
 * with the chosen sessions set aside for it on the calendar.
 */
export async function applyRevision(
  db: Tx,
  u: { id: string; role: SystemRole },
  input: z.input<typeof applyRevisionInput>,
) {
  const d = applyRevisionInput.parse(input);
  const exam = (await studyOverview(u.id, new Date(), db)).exams.find(
    (e) => e.key === d.key,
  );
  if (!exam) fail(404, "That exam isn't on your calendar in the next 60 days.");
  for (const s of d.sessions)
    if (Date.parse(s.end_at) <= Date.parse(s.start_at))
      fail(422, "Each session has to end after it starts.");
  const minutes = Math.round(
    d.sessions.reduce(
      (n, s) => n + (Date.parse(s.end_at) - Date.parse(s.start_at)),
      0,
    ) / 60_000,
  );
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
  await db.query(
    `INSERT INTO study_exams(user_id,exam_key,title,starts_at,all_day)
     VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,exam_key) DO NOTHING`,
    [u.id, exam.key, exam.title, exam.starts_at, exam.all_day],
  );
  await db.query(
    `UPDATE items SET study_exam_id = (SELECT id FROM study_exams WHERE user_id=$2 AND exam_key=$3)
     WHERE id=$1 AND user_id=$2`,
    [task!.id, u.id, exam.key],
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
}

// ---- H4: practice first ---------------------------------------------------

/**
 * Round-robin over decks: one card from each page in turn, keeping each
 * page's own order, so a quiz mixes subjects (interleaving) instead of
 * running through one page at a time.
 */
export function interleave<T extends { doc_id: string }>(cards: T[]): T[] {
  const by = new Map<string, T[]>();
  for (const c of cards) {
    const list = by.get(c.doc_id) ?? [];
    list.push(c);
    by.set(c.doc_id, list);
  }
  const lists = [...by.values()];
  const out: T[] = [];
  for (let i = 0; out.length < cards.length; i++)
    for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** Whether a card is a cloze (one per hidden part of its line: `…#c1`). */
export const isClozeKey = (key: string) => /#c\d+$/.test(key);

/**
 * Cards of the style the person likes first (their learning profile, H8),
 * each group keeping its order; "mixed" or no style changes nothing.
 */
export function preferStyle<T extends { card_key: string }>(
  cards: T[],
  style: "qa" | "cloze" | "mixed" | null | undefined,
): T[] {
  if (style !== "qa" && style !== "cloze") return cards;
  const liked = (c: T) => isClozeKey(c.card_key) === (style === "cloze");
  return [...cards.filter(liked), ...cards.filter((c) => !liked(c))];
}

/** How far today's practice has got. */
export type QuizProgress = { done_today: number; left_today: number };

/**
 * The next cards to quiz, practice first: cards marked "needs work", then
 * due cards the person keeps getting wrong (most misses first), then the
 * rest of what's due, then today's new cards; decks interleaved within
 * each group. `docIds` limits it to those pages (a deck or an exam's).
 */
export async function quizQueue(
  userId: string,
  options: {
    docIds?: string[];
    limit: number;
    /** The card style the person likes, asked first within each group. */
    style?: "qa" | "cloze" | "mixed" | null;
  },
  now = new Date(),
  db: Db = pool,
): Promise<{ cards: StudyCard[]; progress: QuizProgress }> {
  const tz = (await loadPrefs(db, userId)).timezone || "UTC";
  const todayStart = dayTime(localDateKey(now, tz), 0, tz);
  const docs = options.docIds ?? null;
  const [today, due, fresh] = await Promise.all([
    db.query<{ n: number; new_today: number }>(
      `SELECT count(*)::int AS n,
              count(DISTINCT r.card_id) FILTER (
                WHERE NOT EXISTS (SELECT 1 FROM study_reviews p
                                   WHERE p.card_id = r.card_id AND p.at < $2))::int AS new_today
         FROM study_reviews r WHERE r.user_id = $1 AND r.at >= $2`,
      [userId, todayStart],
    ),
    db.query<CardRow>(
      `${CARD_SELECT}
        WHERE c.user_id = $1 AND ($2::uuid[] IS NULL OR c.doc_id = ANY ($2::uuid[]))
          AND ((c.reps > 0 AND c.due_at <= $3) OR c.needs_work_at IS NOT NULL)
        ORDER BY (c.needs_work_at IS NOT NULL) DESC, c.misses DESC, c.due_at
        LIMIT 500`,
      [userId, docs, now],
    ),
    db.query<CardRow>(
      `${CARD_SELECT}
        WHERE c.user_id = $1 AND ($2::uuid[] IS NULL OR c.doc_id = ANY ($2::uuid[]))
          AND c.reps = 0 AND c.needs_work_at IS NULL
        ORDER BY c.created_at, c.id LIMIT $3`,
      [userId, docs, NEW_PER_DAY],
    ),
  ]);
  const room = Math.max(0, NEW_PER_DAY - today.rows[0].new_today);
  const flagged = due.rows.filter((c) => c.needs_work_at);
  const missed = due.rows.filter((c) => !c.needs_work_at && c.misses > 0);
  const rest = due.rows.filter((c) => !c.needs_work_at && c.misses === 0);
  const style = options.style;
  const order = [
    ...preferStyle(interleave(flagged), style),
    ...preferStyle(interleave(missed), style),
    ...preferStyle(interleave(rest), style),
    ...preferStyle(interleave(fresh.rows.slice(0, room)), style),
  ];
  const picked = order.slice(0, options.limit);
  const cards = (await readableLinks(pool, userId, picked)).map((r) =>
    cardOf(r, now),
  );
  return {
    cards: await withCardSources(db, userId, cards),
    progress: { done_today: today.rows[0].n, left_today: order.length },
  };
}

/**
 * Fill in each card's source line (the page's title and the line's words)
 * where the person can read that page; a source they can't read is left
 * out.
 */
export async function withCardSources(
  db: Db,
  userId: string,
  cards: StudyCard[],
): Promise<StudyCard[]> {
  const ids = [
    ...new Set(cards.flatMap((c) => (c.source ? [c.source.doc_id] : []))),
  ];
  if (!ids.length) return cards;
  const pages = new Map(
    (
      await db.query<{ id: string; title: string; content: DocBlock[] }>(
        `SELECT d.id, d.title, d.content FROM docs d
          WHERE d.id = ANY ($2::uuid[]) AND d.deleted_at IS NULL
            AND ${readableDocs("d")}`,
        [userId, ids],
      )
    ).rows.map((d) => [d.id, d]),
  );
  return cards.map((c) => {
    const page = c.source ? pages.get(c.source.doc_id) : undefined;
    if (!c.source || !page) return { ...c, source: null };
    const line = c.source.block_id
      ? (page.content ?? []).find((b) => b.id === c.source!.block_id)
      : undefined;
    return {
      ...c,
      source: {
        ...c.source,
        doc_title: page.title || "Untitled",
        text: line && "text" in line ? plainText(line.text).slice(0, 300) : "",
      },
    };
  });
}

/**
 * Mark cards "needs work" (an explanation fell short): they come first in
 * the next quiz and are due now, until they're recalled well.
 */
export async function markNeedsWork(
  db: Db,
  userId: string,
  cardId: string,
  note: string | null,
  now = new Date(),
): Promise<StudyCard> {
  const card = await cardById(db, userId, cardId);
  if (!card) fail(404, "Card not found");
  await db.query(
    `UPDATE study_cards SET needs_work_at = $3, needs_work_note = $4,
            due_at = LEAST(due_at, $3)
      WHERE id = $1 AND user_id = $2`,
    [card.id, userId, now, note],
  );
  return cardOf((await cardById(db, userId, card.id))!, now);
}

/** An exam as Study keeps it (for undoing a change to it). */
export type ExamRow = {
  exam_key: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  own: boolean;
  doc_ids: string[];
  target: string | null;
};

export async function examRow(
  db: Db,
  userId: string,
  key: string,
): Promise<ExamRow | null> {
  const r = (
    await db.query<Omit<ExamRow, "starts_at"> & { starts_at: Date }>(
      `SELECT exam_key, title, starts_at, all_day, own, doc_ids, target
         FROM study_exams WHERE user_id = $1 AND exam_key = $2`,
      [userId, key],
    )
  ).rows[0];
  return r ? { ...r, starts_at: r.starts_at.toISOString() } : null;
}

/**
 * Save an exam: one of the person's own (`own`), or a calendar exam's
 * pages and goal. Pages they can't read are left out; `doc_ids`
 * undefined keeps the ones it has.
 */
export async function saveExam(
  db: Db,
  userId: string,
  e: {
    key: string;
    title: string;
    starts_at: string;
    all_day: boolean;
    own: boolean;
    doc_ids?: string[];
    target?: string | null;
  },
): Promise<void> {
  const visible = e.doc_ids
    ? (
        await db.query<{ id: string }>(
          `SELECT d.id FROM docs d WHERE d.id = ANY ($2::uuid[])
             AND d.deleted_at IS NULL AND ${readableDocs("d")}`,
          [userId, e.doc_ids],
        )
      ).rows.map((x) => x.id)
    : null;
  await db.query(
    `INSERT INTO study_exams (user_id, exam_key, title, starts_at, all_day, own, doc_ids, target)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::uuid[], '{}'), $8)
     ON CONFLICT (user_id, exam_key) DO UPDATE
       SET title = EXCLUDED.title, starts_at = EXCLUDED.starts_at,
           all_day = EXCLUDED.all_day, own = EXCLUDED.own,
           doc_ids = COALESCE($7::uuid[], study_exams.doc_ids),
           target = CASE WHEN $9 THEN EXCLUDED.target ELSE study_exams.target END,
           updated_at = now()`,
    [
      userId,
      e.key,
      e.title,
      e.starts_at,
      e.all_day,
      e.own,
      visible ? e.doc_ids!.filter((id) => visible.includes(id)) : null,
      e.target ?? null,
      e.target !== undefined,
    ],
  );
}

/** Put an exam back as it was, or remove it when it wasn't there. */
export async function restoreExam(
  db: Db,
  userId: string,
  key: string,
  was: ExamRow | null,
): Promise<void> {
  if (!was) {
    await db.query(
      "DELETE FROM study_exams WHERE user_id = $1 AND exam_key = $2",
      [userId, key],
    );
    return;
  }
  await saveExam(db, userId, {
    key,
    title: was.title,
    starts_at: was.starts_at,
    all_day: was.all_day,
    own: was.own,
    doc_ids: was.doc_ids,
    target: was.target,
  });
}
