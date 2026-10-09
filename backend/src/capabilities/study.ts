import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  RATINGS,
  cardLine,
  cardsInBlocks,
  dayTime,
  linkLabel,
  linkMarkdown,
  plainText,
  type DocBlock,
  type StudyCard,
} from "@orbyn/core";
import { Params, scopeFor, visibleDocs } from "../lib/visibility.js";
import { createDoc } from "../modules/docs/service.js";
import {
  applyRevision,
  examRow,
  markNeedsWork,
  planRevision,
  quizQueue,
  reviewCard,
  reviewQueue,
  saveExam,
  syncSavedPages,
  withCardSources,
  cardById,
  cardOf,
  studyOverview,
} from "../modules/study/service.js";
import { READ, minutesText, teamFilter } from "./common.js";
import { both, clean, cleanTitle, fencedTitle, labelled } from "./format.js";
import { appUrl, parseRef, refUrl, refs } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { seeDoc } from "./shared.js";
import { learningFor } from "../modules/agent-context/service.js";
import { sealRevision } from "./write-sessions.js";
import { editPage, withIds } from "./write-docs.js";
import { readMarkdown } from "./doc-markdown.js";
import type { UndoOp } from "./undo.js";
import {
  ADDS,
  MAX_BATCH,
  actorOf,
  clientRefInput,
  dbOf,
  cantWait,
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
 *
 * Practice first (H4), with no AI of Orbyn's: the agent writes the cards
 * (update_study cards: question/answer, cloze, picture, each linked to the
 * notes line it came from), quizzes one card at a time (get_study queue,
 * practice order, answers only through get_study card), judges an
 * explanation against the person's own notes and card answers (get_study
 * explain) and records the outcome (a rating, or "needs work"). Orbyn
 * stores, orders and schedules.
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
  if (!ctx.spaces.personal)
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

/**
 * "Lecture 5 › The mitochondria makes ATP (doc:…#b1)": where a card came
 * from. The line's words can give the answer away, so they're left out
 * (`line` false) until the answer is shown.
 */
function fromText(source: StudyCard["source"], line = true): string | null {
  if (!source) return null;
  const title = cleanTitle(source.doc_title) || "Untitled";
  const words = line ? clean(source.text, 160) : "";
  return `${title}${words ? ` › ${words}` : ""} (doc:${source.doc_id}${source.block_id ? `#${source.block_id}` : ""})`;
}

/** A card's source, only when this connection may read that page. */
const sourceIn = (reach: Set<string>, c: StudyCard, line = true) =>
  c.source && reach.has(c.source.doc_id) ? fromText(c.source, line) : null;

const pictureRef = (c: StudyCard) =>
  c.picture ? `orbyn://file/${c.picture}` : null;

/** The pages of an exam (its key from get_study), or NOT_FOUND. */
async function examPages(ctx: CapabilityContext, key: string) {
  const o = await studyOverview(ctx.principal.user.id, ctx.now, ctx.db);
  const exam = o.exams.find((e) => e.key === key);
  if (!exam) throw noExam();
  return exam.doc_ids;
}

const noExam = () =>
  new CapabilityError(
    "NOT_FOUND",
    "That exam isn't in Study in the next 60 days.",
    "get_study lists the exams with their keys.",
  );

/** Lowercased words to find a topic by. */
const topicWords = (topic: string) =>
  topic
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1)
    .slice(0, 8);

const MAX_NOTES = 40;
const MAX_EXPLAIN_CARDS = 25;

/**
 * Explain-it-back: the person's own notes lines and cards (with answers)
 * about a topic or a set of cards, from pages this connection can read, so
 * the agent can judge an explanation. Orbyn only finds; it never grades.
 */
async function explainMaterial(
  ctx: CapabilityContext,
  a: { topic?: string; cards?: string[]; pages: string[] | null },
) {
  const me = ctx.principal.user.id;
  const words = a.topic ? topicWords(a.topic) : [];
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const u = params.add(me);
  const pagesP = params.add(a.pages);
  const cardsP = params.add(a.cards?.length ? a.cards : null);
  const rows = (
    await ctx.db.query<{
      id: string;
      doc_id: string;
      question: string;
      answer: string;
      source_doc_id: string | null;
      source_block_id: string | null;
    }>(
      `SELECT c.id, c.doc_id, c.question, c.answer, c.source_doc_id, c.source_block_id
         FROM study_cards c JOIN docs d ON d.id = c.doc_id AND d.deleted_at IS NULL
        WHERE c.user_id = ${u} AND ${visibleDocs("d", scope)}
          AND (${pagesP}::uuid[] IS NULL OR c.doc_id = ANY (${pagesP}::uuid[]))
          AND (${cardsP}::uuid[] IS NULL OR c.id = ANY (${cardsP}::uuid[]))
        ORDER BY c.created_at LIMIT 2000`,
      params.values,
    )
  ).rows;
  const hits = (text: string) => {
    const t = text.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const cards = rows
    .filter((c) => !words.length || hits(`${c.question} ${c.answer}`))
    .slice(0, MAX_EXPLAIN_CARDS);
  // Pages about the topic (the search index), when no pages are given.
  const topical =
    a.topic && !a.pages
      ? await (async () => {
          const p = new Params();
          const sc = scopeFor(ctx.spaces, p);
          return (
            await ctx.db.query<{ id: string }>(
              `SELECT d.id FROM docs d
                WHERE d.search @@ websearch_to_tsquery('english', ${p.add(a.topic)})
                  AND ${visibleDocs("d", sc)}
                ORDER BY d.updated_at DESC LIMIT 20`,
              p.values,
            )
          ).rows.map((r) => r.id);
        })()
      : [];
  // Notes: the pages asked about or found, the cards' own pages, and the
  // lines the cards came from; only pages this connection can read.
  const docIds = [
    ...new Set([
      ...(a.pages ?? []),
      ...topical,
      ...cards.map((c) => c.doc_id),
      ...cards.flatMap((c) => (c.source_doc_id ? [c.source_doc_id] : [])),
      ...(a.pages || a.cards?.length
        ? []
        : rows.flatMap((c) => [
            c.doc_id,
            ...(c.source_doc_id ? [c.source_doc_id] : []),
          ])),
    ]),
  ].slice(0, 60);
  const reach = await reachablePages(ctx, docIds);
  const pages = reach.size
    ? (
        await ctx.db.query<{ id: string; title: string; content: DocBlock[] }>(
          "SELECT id, title, content FROM docs WHERE id = ANY ($1::uuid[])",
          [[...reach]],
        )
      ).rows
    : [];
  const sourceLines = new Set(
    cards.flatMap((c) =>
      c.source_doc_id && c.source_block_id
        ? [`${c.source_doc_id}#${c.source_block_id}`]
        : [],
    ),
  );
  const notes: { line: string; page: string; text: string }[] = [];
  for (const page of pages) {
    const blocks = Array.isArray(page.content) ? page.content : [];
    const cardLines = new Set(
      cardsInBlocks(blocks).flatMap((c) => (c.block_id ? [c.block_id] : [])),
    );
    for (const b of blocks) {
      if (!("text" in b) || !b.id || cardLines.has(b.id)) continue;
      if (b.type === "code" || b.type === "table" || b.type === "image")
        continue;
      const text = plainText(b.text).trim();
      if (!text) continue;
      const cited = sourceLines.has(`${page.id}#${b.id}`);
      if (!cited && (words.length ? !hits(text) : !a.pages?.includes(page.id)))
        continue;
      notes.push({
        line: `doc:${page.id}#${b.id}`,
        page: cleanTitle(page.title) || "Untitled",
        text: clean(text, 600),
      });
      if (notes.length >= MAX_NOTES) break;
    }
    if (notes.length >= MAX_NOTES) break;
  }
  const full = await withCardSources(
    ctx.db,
    me,
    (await Promise.all(cards.map((c) => cardById(ctx.db, me, c.id)))).flatMap(
      (r) => (r ? [cardOf(r, ctx.now)] : []),
    ),
  );
  return { notes, reach, cards: full.filter((c) => reach.has(c.doc_id)) };
}

const queueCard = z.object({
  card: z.string(),
  doc: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  due: z.string(),
  from: z.string().nullable(),
  picture: z.string().nullable(),
  misses: z.number(),
});

export const getStudy = defineCapability({
  name: "get_study",
  title: "Study overview",
  description:
    "Decks, cards due, exams and what the person keeps getting wrong (wrong). queue: cards to quiz, practice order (needs work, most missed, due, new; decks mixed), answers hidden; limit 1 for one at a time. card: that card with its answer, once they've tried. explain: their notes lines and cards with answers on a topic or cards, for you to judge an explanation.",
  input: z
    .object({
      queue: z.boolean().default(false),
      deck: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Only this page's cards."),
      exam: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("Only this exam's pages (key)."),
      ahead: z.boolean().default(false).describe("Include cards not due yet."),
      reveal: z.boolean().default(false),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Default: about a card a minute of their session length, else 20.",
        ),
      card: idField.optional(),
      explain: z
        .object({
          topic: z.string().trim().min(1).max(200).optional(),
          cards: z.array(idField).max(MAX_EXPLAIN_CARDS).optional(),
        })
        .strict()
        .optional(),
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
        target: z.string().nullable(),
      }),
    ),
    wrong: z.array(
      z.object({
        card: z.string(),
        question: z.string(),
        misses: z.number(),
        from: z.string().nullable(),
      }),
    ),
    queue: z.array(queueCard),
    left_today: z.number().nullable(),
    notes: z.array(
      z.object({ line: z.string(), page: z.string(), text: z.string() }),
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
      ...o.weak.flatMap((w) => (w.source ? [w.source.doc_id] : [])),
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
      target: e.target ? clean(e.target, 100) : null,
    }));
    const wrong = o.weak
      .filter((w) => reach.has(w.doc_id))
      .map((w) => ({
        card: w.id,
        question: clean(w.question, 500),
        misses: w.misses,
        from:
          w.source && reach.has(w.source.doc_id)
            ? `${cleanTitle(w.source.doc_title) || "Untitled"} (doc:${w.source.doc_id}${w.source.block_id ? `#${w.source.block_id}` : ""})`
            : null,
      }));
    const shape = (c: StudyCard, answer: boolean) => ({
      card: c.id,
      doc: `doc:${c.doc_id}`,
      question: clean(c.question, 2000),
      answer: answer ? clean(c.answer, 4000) : null,
      due: c.due_at ?? ctx.now.toISOString(),
      from: sourceIn(reach, c, answer),
      picture: pictureRef(c),
      misses: c.misses ?? 0,
    });
    // The notes pages cards came from, where this connection may read them.
    const reachSources = async (cards: StudyCard[]) => {
      const more = cards.flatMap((c) =>
        c.source && !reach.has(c.source.doc_id) ? [c.source.doc_id] : [],
      );
      for (const id of await reachablePages(ctx, more)) reach.add(id);
    };
    const deck = a.deck ? (await seeDoc(ctx, a.deck)).id : undefined;
    const scoped = deck
      ? [deck]
      : a.exam
        ? (await examPages(ctx, a.exam)).filter((id) => reach.has(id))
        : undefined;
    if (deck) reach.add(deck);
    if (a.explain && !a.explain.topic && !a.explain.cards?.length && !scoped)
      throw new CapabilityError(
        "INVALID",
        "explain needs a topic, cards, a deck or an exam.",
      );
    let queue: z.output<typeof queueCard>[] = [];
    let progress: { done_today: number; left_today: number } | null = null;
    if (a.queue) {
      // Their learning profile (H8): as many cards as their usual session
      // holds (about one a minute), their card style first.
      const learning = await learningFor(ctx.db, me);
      const limit =
        a.limit ??
        (learning?.session_minutes
          ? Math.min(100, Math.max(5, learning.session_minutes))
          : 20);
      let cards: StudyCard[];
      if (a.ahead) {
        cards = await withCardSources(
          ctx.db,
          me,
          await reviewQueue(
            me,
            { docId: deck, limit, ahead: true },
            ctx.now,
            ctx.db,
          ),
        );
      } else {
        const q = await quizQueue(
          me,
          { docIds: scoped, limit, style: learning?.card_style },
          ctx.now,
          ctx.db,
        );
        cards = q.cards;
        progress = q.progress;
      }
      await reachSources(cards);
      queue = cards
        .filter((c) => reach.has(c.doc_id))
        .map((c) => shape(c, a.reveal));
    }
    // The answer, once they've tried: that one card, answer shown.
    if (a.card) {
      const row = await cardById(ctx.db, me, a.card);
      const reachable =
        row &&
        (reach.has(row.doc_id) ||
          (await reachablePages(ctx, [row.doc_id])).size > 0);
      if (!row || !reachable)
        throw new CapabilityError(
          "NOT_FOUND",
          "No such card.",
          "Use a card id from get_study.",
        );
      const [c] = await withCardSources(ctx.db, me, [cardOf(row, ctx.now)]);
      await reachSources([c]);
      queue = [shape(c, true)];
    }
    let notes: { line: string; page: string; text: string }[] = [];
    if (a.explain) {
      const found = await explainMaterial(ctx, {
        ...a.explain,
        pages: scoped ?? null,
      });
      notes = found.notes;
      for (const id of found.reach) reach.add(id);
      queue = found.cards.map((c) => shape(c, true));
    }
    const structured = {
      due_today: o.due_today,
      new_cards: o.new_cards,
      reviewed_today: o.reviewed_today,
      streak: o.streak,
      decks,
      exams,
      wrong,
      queue,
      left_today: progress?.left_today ?? null,
      notes,
    };
    const cardText = (q: z.output<typeof queueCard>, i?: number) =>
      `${i === undefined ? "" : `${i + 1}. `}${labelled(q.question, "you")}${q.picture ? ` [picture ${q.picture}]` : ""}${q.answer ? ` — ${q.answer}` : ""} · card ${q.card}${q.from ? ` · from: ${q.from}` : ""}`;
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
                  `- ${e.title} ${e.starts.local} (${e.days_left} days${e.target ? `, target ${e.target}` : ""}) · key ${e.key}`,
              ),
            ]
          : []),
        ...(wrong.length
          ? [
              "Keeps getting wrong:",
              ...wrong.map(
                (w) =>
                  `- ${labelled(w.question, "you")} (wrong ${w.misses}×) · card ${w.card}${w.from ? ` · re-read ${w.from}` : ""}`,
              ),
            ]
          : []),
        ...(progress
          ? [`Today: ${progress.done_today} done, ${progress.left_today} left.`]
          : []),
        ...(a.explain
          ? [
              "Their notes:",
              ...notes.map(
                (n) => `- ${labelled(n.text, "you")} (${n.page}, ${n.line})`,
              ),
            ]
          : []),
        ...(queue.length
          ? [
              a.card
                ? "Card:"
                : a.explain
                  ? "Their cards:"
                  : a.reveal
                    ? "Queue:"
                    : "Queue (answers hidden: ask, then get_study card for the answer):",
              ...queue.map((q, i) => cardText(q, i)),
            ]
          : []),
        ...(a.explain
          ? [
              "Judge the explanation against these yourself, then record it with update_study (a rating, or needs_work).",
            ]
          : []),
      ].join("\n"),
    };
  },
});

// --- update_study -----------------------------------------------------------

const newCard = z
  .object({
    q: z.string().trim().min(1).max(500).optional(),
    a: z.string().trim().min(1).max(1000).optional(),
    cloze: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .optional()
      .describe("A line with {{hidden}} words."),
    picture: z
      .string()
      .trim()
      .max(300)
      .optional()
      .describe("orbyn://file/<id> the q asks about."),
    from: z.string().trim().max(300).optional().describe("doc:<id>#<anchor>"),
  })
  .strict()
  .refine((c) => (c.cloze ? !c.q && !c.a && !c.picture : !!(c.q && c.a)), {
    message: "Give q and a, or cloze.",
  })
  .refine((c) => !c.cloze || /\{\{[^}]+\}\}/.test(c.cloze), {
    message: "A cloze hides words in {{ }}.",
  });

const FILE_REF =
  /^(?:orbyn:\/\/file\/|file:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** One line of words: no line breaks, no `::` of its own. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The source links for new cards: `[src: Page › line](orbyn://doc/<id>#<line>)`,
 * only for lines this connection can read.
 */
async function sourceLinks(
  ctx: CapabilityContext,
  cards: z.output<typeof newCard>[],
): Promise<(string | null)[]> {
  const refsOf = cards.map((c) => {
    if (!c.from) return null;
    const r = parseRef(c.from);
    if ((r.type !== "doc" && r.type !== "any") || !r.block)
      throw new CapabilityError(
        "INVALID",
        `from must name a line, like doc:<id>#<anchor> (got “${c.from.slice(0, 80)}”).`,
        "read_doc or fetch shows each line's ^anchor.",
      );
    return { id: r.id.toLowerCase(), block: r.block };
  });
  const ids = [...new Set(refsOf.flatMap((r) => (r ? [r.id] : [])))];
  if (!ids.length) return refsOf.map(() => null);
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const pages = new Map(
    (
      await ctx.db.query<{ id: string; title: string; content: DocBlock[] }>(
        `SELECT d.id, d.title, d.content FROM docs d
          WHERE d.id = ANY (${params.add(ids)}::uuid[]) AND ${visibleDocs("d", scope)}`,
        params.values,
      )
    ).rows.map((d) => [d.id, d]),
  );
  return refsOf.map((r) => {
    if (!r) return null;
    const page = pages.get(r.id);
    const line = page?.content?.find((b) => b.id === r.block);
    if (!page || !line)
      throw new CapabilityError(
        "INVALID",
        `There is no line ${r.block} on a page this connection can read.`,
        "Fetch the page and use one of its line anchors.",
      );
    // Its words without card marks, so the link never reads as a card.
    const words =
      "text" in line
        ? oneLine(plainText(line.text).replace(/:{2,}|\{\{|\}\}/g, " "))
        : "";
    const label = `src: ${cleanTitle(page.title) || "Untitled"}${words ? ` › ${words.length > 60 ? `${words.slice(0, 59)}…` : words}` : ""}`;
    return linkMarkdown(
      { kind: "doc", id: r.id, block: r.block },
      linkLabel(label),
    );
  });
}

/** New cards as Orbyn Markdown lines (a picture line above a picture card). */
async function cardsMarkdown(
  ctx: CapabilityContext,
  cards: z.output<typeof newCard>[],
): Promise<string> {
  const links = await sourceLinks(ctx, cards);
  return cards
    .map((c, i) => {
      const src = links[i] ? ` ${links[i]}` : "";
      if (c.cloze) return `- ${oneLine(c.cloze)}${src}`;
      const line = `- ${cardLine(oneLine(c.q!), oneLine(c.a!))}${src}`;
      if (!c.picture) return line;
      const file = FILE_REF.exec(c.picture)?.[1];
      if (!file)
        throw new CapabilityError(
          "INVALID",
          "picture must be a file already in Orbyn: orbyn://file/<id>.",
          "fetch shows a page's pictures; add_file sends a new one.",
        );
      return `![](orbyn://file/${file.toLowerCase()})\n\n${line}`;
    })
    .join("\n\n");
}

/**
 * Add cards: into an existing page under its Cards heading (made when it
 * has none), or as a new deck page. The page's own edit, so undo takes
 * them away and Study follows the page.
 */
async function addCards(
  ctx: CapabilityContext,
  a: {
    page?: string;
    new_deck?: string;
    team?: string;
    items: z.output<typeof newCard>[];
  },
) {
  refuseSecrets(a.new_deck, ...a.items.flatMap((c) => [c.q, c.a, c.cloze]));
  const lines = await cardsMarkdown(ctx, a.items);
  const n = a.items.length;
  const change = `${n} card${n === 1 ? "" : "s"} added`;
  if (a.page) {
    const doc = await seeDoc(ctx, a.page);
    const content =
      (
        await ctx.db.query<{ content: DocBlock[] }>(
          "SELECT content FROM docs WHERE id = $1",
          [doc.id],
        )
      ).rows[0]?.content ?? [];
    const heading = content.find(
      (b) =>
        b.type === "heading" &&
        b.id &&
        plainText(b.text).trim().toLowerCase() === "cards",
    );
    const edited = await editPage(
      ctx,
      {
        doc: doc.id,
        version: null,
        edits: [
          heading
            ? { op: "append_to_section", heading: heading.id!, markdown: lines }
            : { op: "append", markdown: `## Cards\n\n${lines}` },
        ],
      },
      change,
    );
    // Told as cards, not as one page edited (H7).
    if (edited.write)
      edited.write = { ...edited.write, counts: { "added:card": n } };
    return edited;
  }
  const title = a.new_deck!;
  const team = teamFilter(a.team);
  const teamId = team && "team" in team ? team.team : null;
  const markdown = `## Cards\n\n${lines}`;
  const content = withIds(await readMarkdown(ctx, markdown, null));
  if (destination(ctx, teamId, teamId ? "W2" : "W1") === "review")
    return finishWrite(ctx, "Adding cards", {
      done: [],
      review: [
        {
          type: "doc.create",
          title,
          team_id: teamId,
          kind: "doc",
          markdown,
          folder_id: null,
          project_id: null,
        },
      ],
      reviewSummary: `Make the deck “${cleanTitle(title)}” with ${n} card${n === 1 ? "" : "s"}`,
      teamId,
    });
  const doc = await createDoc(dbOf(ctx), actorOf(ctx.principal), {
    title,
    kind: "doc",
    team_id: teamId,
    item_id: null,
    content,
    folder_id: null,
    project_id: null,
    tags: [],
  });
  return finishWrite(ctx, "Adding cards", {
    done: [
      {
        id: `doc:${doc.id}`,
        title: cleanTitle(doc.title) || "Untitled",
        url: refUrl({ type: "doc", id: doc.id }),
        version: doc.version,
        change: `New deck, ${change}`,
      },
    ],
    undo: [{ op: "doc.trash", doc_id: doc.id, version: doc.version }],
    after: [() => syncSavedPages(doc.id)],
    teamId,
    counts: { "added:card": n },
  });
}

/** YYYY-MM-DD (all day, in the person's zone) or an ISO time. */
function examStart(ctx: CapabilityContext, date: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date))
    return {
      starts_at: dayTime(date, 0, ctx.timezone).toISOString(),
      all_day: true,
    };
  const at = Date.parse(date);
  if (Number.isNaN(at))
    throw new CapabilityError(
      "INVALID",
      "date is YYYY-MM-DD or an ISO date and time.",
    );
  return { starts_at: new Date(at).toISOString(), all_day: false };
}

const examInput = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .optional()
      .describe("From get_study; none names a new one."),
    title: z.string().trim().min(1).max(200).optional(),
    date: z
      .string()
      .trim()
      .max(40)
      .optional()
      .describe("YYYY-MM-DD or ISO time."),
    pages: z.array(z.string().trim().max(300)).max(30).optional(),
    target: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional()
      .describe('e.g. "80%".'),
    plan: z
      .boolean()
      .default(false)
      .describe("Also book plan_revision's sessions."),
    minutes: z
      .number()
      .int()
      .min(15)
      .max(120)
      .optional()
      .describe("Default: their session length, else 30."),
  })
  .strict();

/**
 * Revision session minutes and study times from the person's learning
 * profile (H8), when they don't say.
 */
async function revisionShape(ctx: CapabilityContext, minutes?: number) {
  const learning = await learningFor(ctx.db, ctx.principal.user.id);
  const fromProfile = learning?.session_minutes
    ? Math.min(120, Math.max(15, learning.session_minutes))
    : null;
  return {
    minutes: minutes ?? fromProfile ?? 30,
    windows: (learning?.study_times ?? []).flatMap((t) =>
      t.start && t.end ? [{ start: t.start, end: t.end }] : [],
    ),
  };
}

/** Name or change an exam, attach its pages, and book revision if asked. */
async function writeExam(
  ctx: CapabilityContext,
  e: z.output<typeof examInput>,
  done: DoneEntry[],
  undo: UndoOp[],
) {
  const me = ctx.principal.user.id;
  const db = dbOf(ctx);
  const o = await studyOverview(me, ctx.now, db);
  let key = e.key;
  let found = key ? o.exams.find((x) => x.key === key) : undefined;
  if (key && !found) throw noExam();
  const own = !key || key.startsWith("own:");
  if (!own && (e.title || e.date))
    throw new CapabilityError(
      "INVALID",
      "That exam comes from the calendar; change its title or time there.",
    );
  if (!key && !(e.title && e.date))
    throw new CapabilityError(
      "INVALID",
      "A new exam needs a title and a date.",
    );
  key ??= `own:${randomUUID()}`;
  const was = await examRow(db, me, key);
  const when = e.date
    ? examStart(ctx, e.date)
    : { starts_at: found!.starts_at, all_day: found!.all_day };
  if (Date.parse(when.starts_at) <= ctx.now.getTime())
    throw new CapabilityError("INVALID", "The exam has to be in the future.");
  const title = e.title ?? found!.title;
  refuseSecrets(title, e.target);
  const pages: string[] | undefined = e.pages ? [] : undefined;
  for (const p of e.pages ?? []) pages!.push((await seeDoc(ctx, p)).id);
  await saveExam(db, me, {
    key,
    title,
    starts_at: when.starts_at,
    all_day: when.all_day,
    own,
    ...(pages ? { doc_ids: pages } : {}),
    ...(e.target !== undefined ? { target: e.target } : {}),
  });
  undo.push({ op: "exam.restore", key, was });
  const bits = [
    !e.key ? "Named" : e.title || e.date ? "Changed" : "",
    pages
      ? `${pages.length} page${pages.length === 1 ? "" : "s"} attached`
      : "",
    e.target !== undefined ? `target ${e.target ?? "cleared"}` : "",
  ].filter(Boolean);
  const entry = {
    id: `exam:${key}`,
    title: e.title
      ? cleanTitle(title)
      : found
        ? examTitle(ctx, found)
        : cleanTitle(title),
    url: `${appUrl()}/app/today`,
    version: null,
    change: `${bits.join(", ") || "Saved"} · key ${key}`,
  };
  done.push(entry);
  if (!e.plan) return;
  // One step: plan and book revision sessions (plan_revision + schedule_sessions).
  const exam = (await studyOverview(me, ctx.now, db)).exams.find(
    (x) => x.key === key,
  );
  if (!exam) throw noExam();
  const shape = await revisionShape(ctx, e.minutes);
  const plan = await planRevision(
    me,
    exam,
    shape.minutes,
    ctx.now,
    db,
    shape.windows,
  );
  if (!plan.sessions.length) {
    entry.change += "; no free time for revision sessions before it";
    return;
  }
  const made = await applyRevision(db, actorOf(ctx.principal) as never, {
    key,
    sessions: plan.sessions,
  });
  const task = (
    await db.query<{ version: number; title: string }>(
      "SELECT version, title FROM items WHERE id = $1",
      [made.item_id],
    )
  ).rows[0];
  undo.push({ op: "item.delete", id: made.item_id, version: task.version });
  done.push({
    id: `task:${made.item_id}`,
    title: cleanTitle(task.title),
    url: refUrl({ type: "task", id: made.item_id }),
    version: task.version,
    change: `Made, with ${made.block_ids.length} revision session${made.block_ids.length === 1 ? "" : "s"}: ${plan.sessions
      .map((s) => both(s.start_at, ctx.timezone)!.local)
      .join("; ")}`,
  });
}

export const updateStudy = defineCapability({
  name: "update_study",
  title: "Cards, reviews and exams",
  description:
    "cards: your q/a, cloze or picture cards into a page's Cards section or a new deck, each linked to its notes line (from); undo removes them. reviews: how each card was recalled. needs_work: explanations that fell short (asked first next quiz). exam: name or change one (title, date, pages, target); plan also books revision sessions.",
  input: z
    .object({
      cards: z
        .object({
          page: z.string().trim().max(300).optional(),
          new_deck: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .describe("A new deck's title."),
          team: z.string().trim().max(100).optional(),
          items: z.array(newCard).min(1).max(50),
        })
        .strict()
        .refine((c) => !!c.page !== !!c.new_deck, {
          message: "Give page or new_deck.",
        })
        .optional(),
      reviews: z
        .array(z.object({ card: idField, rating: z.enum(RATINGS) }).strict())
        .max(MAX_BATCH)
        .optional(),
      needs_work: z
        .array(
          z
            .object({
              card: idField,
              note: z.string().trim().max(300).optional(),
            })
            .strict(),
        )
        .max(MAX_BATCH)
        .optional(),
      exam: examInput.optional(),
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
    if (a.cards) {
      if (a.reviews || a.needs_work || a.exam)
        throw new CapabilityError(
          "INVALID",
          "Send cards in a call of their own.",
        );
      return addCards(ctx, a.cards);
    }
    personal(ctx);
    if (destination(ctx, null, "W1") === "review") throw cantWait(ctx, null);
    const db = dbOf(ctx);
    const me = ctx.principal.user.id;
    const done: DoneEntry[] = [];
    const undo: UndoOp[] = [];
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
    for (const w of a.needs_work ?? []) {
      refuseSecrets(w.note);
      const card = await markNeedsWork(db, me, w.card, w.note ?? null, ctx.now);
      done.push({
        id: `card:${card.id}`,
        title: cleanTitle(card.question).slice(0, 120) || "Card",
        url: refs({ type: "doc", id: card.doc_id }).url,
        version: null,
        change: "Needs work: asked first in the next quiz",
      });
    }
    if (a.exam) await writeExam(ctx, a.exam, done, undo);
    if (!done.length)
      throw new CapabilityError(
        "INVALID",
        "Give cards, reviews, needs_work or an exam.",
      );
    return finishWrite(ctx, "Study", { done, undo });
  },
});

// --- plan_revision ----------------------------------------------------------

export const planRevisionCapability = defineCapability({
  name: "plan_revision",
  title: "Preview revision sessions",
  description:
    'Previews revision sessions in free working time before an exam (one a day from up to three weeks out, longer in the last three days) without changing anything, and returns a plan_token: schedule_sessions puts them on the calendar with a "Revise for …" task. update_study exam.plan books them in one step.',
  input: z
    .object({
      exam: z
        .string()
        .trim()
        .min(1)
        .max(300)
        .describe("The exam's key from get_study."),
      minutes: z
        .number()
        .int()
        .min(15)
        .max(120)
        .optional()
        .describe("Default: their session length, else 30."),
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
    if (!exam) throw noExam();
    ctx.progress?.(1, 2, "Finding free working time before the exam");
    const shape = await revisionShape(ctx, a.minutes);
    const plan = await planRevision(
      me,
      exam,
      shape.minutes,
      ctx.now,
      ctx.db,
      shape.windows,
    );
    const sealed = await sealRevision(
      ctx,
      exam.key,
      shape.minutes,
      plan.sessions,
    );
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
