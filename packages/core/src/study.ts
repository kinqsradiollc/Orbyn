import { z } from "zod";
import {
  newBlockId,
  parseDocInline,
  withoutSources,
  type DocBlock,
} from "./docs.js";
import { parseObjectHref } from "./links.js";

/**
 * Study: flashcards written in your own pages, reviewed with spaced
 * repetition, and revision planned around your exams.
 *
 * A card is any line of a page written as `Question :: Answer` (a paragraph,
 * bullet or numbered line). `Front ::: Back` makes a card each way, and a
 * line with `{{hidden words}}` makes one card per hidden part (a cloze). Cards come only from Orbyn pages — nothing is
 * imported from other apps — and each keeps a link to the line it came from,
 * so editing the page edits the card.
 */

export const CARD_SEPARATOR = " :: ";

export type PageCard = {
  /** Stable within the page: the line's name, or its question. */
  key: string;
  /** The line it came from, when the line has a name. */
  block_id: string | null;
  question: string;
  answer: string;
  /**
   * The notes line it was made from (H4): a `[src: …](orbyn://doc/<id>#<line>)`
   * link on the card's line. Null when it has none.
   */
  source: CardSource | null;
  /** The picture it asks about: a card line right under a picture line. */
  picture: string | null;
};

/** The notes line a card was made from. */
export type CardSource = { doc_id: string; block_id: string | null };

/**
 * A card line's source links: `[src: Lecture 5 › The mitochondria…](orbyn://doc/<id>#<line>)`.
 * Any `[src: …](…)` link says where the card came from and isn't asked;
 * the first one to an Orbyn page is the card's source.
 */
const SOURCE_LINK = /\[src:[^\]\n]*\]\(([^)\s]+)\)/g;

/** A card line without its source links, and the first page line they name. */
export function cardSource(text: string): {
  text: string;
  source: CardSource | null;
} {
  if (!text.includes("[src:")) return { text, source: null };
  let source: CardSource | null = null;
  const rest = text.replace(SOURCE_LINK, (_m, href: string) => {
    const ref = parseObjectHref(href);
    if (!source && ref?.kind === "doc")
      source = { doc_id: ref.id, block_id: ref.block ?? null };
    return "";
  });
  return {
    text: withoutSources(rest)
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
    source,
  };
}

const CARD_LINE = /^(.+?)\s+::\s+(.+)$/s;
const BOTH_WAYS = /^(.+?)\s+:::\s+(.+)$/s;
const CLOZE = /\{\{(.+?)\}\}/g;

/** The blank shown in place of a hidden part of a cloze card. */
export const CLOZE_BLANK = "[…]";

/** A line's cloze cards: one per `{{…}}`, the others shown. */
export function clozeCards(
  text: string,
): { question: string; answer: string }[] {
  const parts = [...text.matchAll(CLOZE)].map((m) => m[1].trim());
  return parts
    .map((answer, n) => {
      let i = -1;
      const question = text.replace(CLOZE, (_m, inner: string) => {
        i++;
        return i === n ? CLOZE_BLANK : inner;
      });
      return { question: question.trim(), answer };
    })
    .filter((c) => c.answer);
}

/** Whether a line makes cards (for quick checks before reading a page). */
export const isCardLine = (text: string) =>
  CARD_LINE.test(text) || BOTH_WAYS.test(text) || /\{\{.+?\}\}/.test(text);

/** A normalised question, for matching a card to its line again. */
const questionKey = (q: string) =>
  "q:" + q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);

/** The cards on a page, in page order. Repeated questions count once. */
export function cardsInBlocks(blocks: DocBlock[]): PageCard[] {
  const out: PageCard[] = [];
  const seen = new Set<string>();
  blocks.forEach((b, i) => {
    if (b.type !== "paragraph" && b.type !== "bullet" && b.type !== "numbered")
      return;
    // A card line right under a picture asks about that picture.
    const above = blocks[i - 1];
    const picture = above?.type === "image" ? above.file : null;
    // A card's source (`[src: …]`, or a `[src: …](orbyn://doc/…)` link to
    // the notes line it was made from) says where it came from; it isn't asked.
    const { text, source } = cardSource(b.text);
    const add = (key: string, question: string, answer: string) => {
      if (!question || !answer || seen.has(key)) return;
      seen.add(key);
      out.push({
        key,
        block_id: b.id ?? null,
        question,
        answer,
        source,
        picture,
      });
    };
    const both = text.match(BOTH_WAYS);
    if (both) {
      const front = both[1].trim();
      const back = both[2].trim();
      const key = b.id ?? questionKey(front);
      add(key, front, back);
      add(`${key}#r`, back, front);
      return;
    }
    const m = text.match(CARD_LINE);
    if (m) {
      const question = m[1].trim();
      add(b.id ?? questionKey(question), question, m[2].trim());
      return;
    }
    const cloze = clozeCards(text);
    if (cloze.length) {
      const base = b.id ?? questionKey(text.replace(CLOZE, "$1"));
      cloze.forEach((c, n) => add(`${base}#c${n + 1}`, c.question, c.answer));
    }
  });
  return out;
}

/** A card as a line to add to a page. */
export const cardLine = (question: string, answer: string) =>
  `${question.trim().replace(/\s+::\s+/g, " : ")}${CARD_SEPARATOR}${answer
    .trim()
    .replace(/\s+::\s+/g, " : ")}`;

/**
 * A page with approved cards added: under its "Cards" heading when it has
 * one, or a new one at the end. Each line gets a name, so its review history
 * survives later edits to the wording.
 */
export function withCards(
  blocks: DocBlock[],
  cards: { question: string; answer: string }[],
): DocBlock[] {
  const lines: DocBlock[] = cards.map((c) => ({
    type: "bullet",
    id: newBlockId(),
    text: cardLine(c.question, c.answer),
  }));
  const at = blocks.findIndex(
    (b) => b.type === "heading" && b.text.trim().toLowerCase() === "cards",
  );
  if (at < 0)
    return [
      ...blocks.filter(
        (b, i) =>
          // Drop a trailing empty paragraph so the cards sit right after the notes.
          !(
            i === blocks.length - 1 &&
            b.type === "paragraph" &&
            !b.text.trim()
          ),
      ),
      { type: "heading", level: 2, text: "Cards" },
      ...lines,
    ];
  // After the last line of the existing Cards section.
  let end = at + 1;
  while (end < blocks.length && blocks[end].type !== "heading") end++;
  return [...blocks.slice(0, end), ...lines, ...blocks.slice(end)];
}

// ---- Cards from highlights (EDT-05) ----------------------------------------

/**
 * Cloze cards made from what was highlighted: each line with ==highlighted==
 * words becomes the same sentence with those words hidden ("The
 * {{mitochondria}} makes energy"). Lines that are already cards, and cards
 * the page already has, are left out, so asking twice adds nothing twice.
 */
export function highlightCards(blocks: DocBlock[]): string[] {
  const have = new Set(
    blocks.flatMap((b) =>
      b.type === "paragraph" || b.type === "bullet" || b.type === "numbered"
        ? [b.text.trim()]
        : [],
    ),
  );
  const out: string[] = [];
  for (const b of blocks) {
    if (
      b.type !== "paragraph" &&
      b.type !== "bullet" &&
      b.type !== "numbered" &&
      b.type !== "todo" &&
      b.type !== "quote" &&
      b.type !== "callout"
    )
      continue;
    if (isCardLine(b.text)) continue;
    const runs = parseDocInline(b.text);
    if (!runs.some((r) => r.highlight && r.text.trim())) continue;
    const line = runs
      .map((r) =>
        r.highlight
          ? `{{${r.text.replace(/[{}]/g, "")}}}`
          : r.footnote || r.source
            ? ""
            : r.link
              ? r.text
              : r.math
                ? `$${r.text}$`
                : r.code
                  ? `\`${r.text}\``
                  : r.text,
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (line && !have.has(line) && !out.includes(line)) out.push(line);
  }
  return out;
}

/**
 * A page with cloze card lines added under its "Cards" heading (made when
 * it has none), each line named so its review history survives edits. The
 * person's own page edit, like any card they write.
 */
export function withClozeLines(
  blocks: DocBlock[],
  lines: string[],
): DocBlock[] {
  if (!lines.length) return blocks;
  const made: DocBlock[] = lines.map((text) => ({
    type: "bullet",
    id: newBlockId(),
    text,
  }));
  const at = blocks.findIndex(
    (b) => b.type === "heading" && b.text.trim().toLowerCase() === "cards",
  );
  if (at < 0) {
    const kept = blocks.filter(
      (b, i) =>
        !(i === blocks.length - 1 && b.type === "paragraph" && !b.text.trim()),
    );
    // Before the footnotes, which stay at the page's end.
    let end = kept.length;
    while (end > 0 && kept[end - 1].type === "footnote") end--;
    return [
      ...kept.slice(0, end),
      { type: "heading", level: 2, id: newBlockId(), text: "Cards" },
      ...made,
      ...kept.slice(end),
    ];
  }
  let end = at + 1;
  while (
    end < blocks.length &&
    blocks[end].type !== "heading" &&
    blocks[end].type !== "footnote"
  )
    end++;
  return [...blocks.slice(0, end), ...made, ...blocks.slice(end)];
}

// ---- Spaced repetition (FSRS v4.5, standard parameters) --------------------

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type Rating = (typeof RATINGS)[number];
const GRADE: Record<Rating, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/** The published default weights; no per-person tuning. */
const W = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];
const DECAY = -0.5;
const FACTOR = 19 / 81;
/** Aim to remember nine cards in ten when they come back. */
const RETENTION = 0.9;
const MAX_DAYS = 365;
/** A forgotten card, or a new one rated Again, comes back this soon. */
const RELEARN_MINUTES = 10;

export type CardState = {
  /** Days until recall drops to 90%. 0 for a card never reviewed. */
  stability: number;
  /** 1 (easy) to 10 (hard). */
  difficulty: number;
  reps: number;
  lapses: number;
  last_review_at: string | null;
  due_at: string;
};

export const newCardState = (now = new Date()): CardState => ({
  stability: 0,
  difficulty: 0,
  reps: 0,
  lapses: 0,
  last_review_at: null,
  due_at: now.toISOString(),
});

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const initialDifficulty = (g: number) => clamp(W[4] - (g - 3) * W[5], 1, 10);

/** How likely the card is to be remembered `days` after its last review. */
export const retrievability = (days: number, stability: number) =>
  stability > 0 ? Math.pow(1 + (FACTOR * days) / stability, DECAY) : 0;

const intervalDays = (stability: number) =>
  clamp(
    Math.round((stability / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1)),
    1,
    MAX_DAYS,
  );

/** The card after a review rated `rating` at `now`. */
/**
 * The share of cards known well (stable for a week or more) at `at`, if
 * every review is done "good" when it's due and new cards are learnt
 * `perDay` a day from `now`. A plan, not a promise: it shows whether
 * keeping up is enough before an exam.
 */
export function projectKnown(
  cards: CardState[],
  at: Date,
  now = new Date(),
  perDay = 20,
): number | null {
  if (!cards.length) return null;
  let known = 0;
  let fresh = 0;
  for (const c of cards) {
    let s = c;
    let when =
      c.reps === 0
        ? new Date(now.getTime() + Math.floor(fresh++ / perDay) * 86_400_000)
        : new Date(Math.max(Date.parse(c.due_at), now.getTime()));
    for (let step = 0; step < 40 && when < at; step++) {
      s = review(s, "good", when);
      when = new Date(s.due_at);
    }
    if (s.reps > 0 && s.stability >= 7) known++;
  }
  return Math.round((known / cards.length) * 100) / 100;
}

export function review(
  card: CardState,
  rating: Rating,
  now = new Date(),
): CardState {
  const g = GRADE[rating];
  let stability: number;
  let difficulty: number;
  if (card.reps === 0 || card.stability <= 0) {
    stability = W[g - 1];
    difficulty = initialDifficulty(g);
  } else {
    const days = card.last_review_at
      ? Math.max(
          0,
          (now.getTime() - Date.parse(card.last_review_at)) / 86_400_000,
        )
      : 0;
    const r = retrievability(days, card.stability);
    const next = card.difficulty - W[6] * (g - 3);
    difficulty = clamp(W[7] * initialDifficulty(3) + (1 - W[7]) * next, 1, 10);
    stability =
      g === 1
        ? W[11] *
          Math.pow(card.difficulty, -W[12]) *
          (Math.pow(card.stability + 1, W[13]) - 1) *
          Math.exp(W[14] * (1 - r))
        : card.stability *
          (1 +
            Math.exp(W[8]) *
              (11 - card.difficulty) *
              Math.pow(card.stability, -W[9]) *
              (Math.exp(W[10] * (1 - r)) - 1) *
              (g === 2 ? W[15] : 1) *
              (g === 4 ? W[16] : 1));
  }
  const due =
    g === 1
      ? new Date(now.getTime() + RELEARN_MINUTES * 60_000)
      : new Date(now.getTime() + intervalDays(stability) * 86_400_000);
  return {
    stability: Math.round(stability * 1000) / 1000,
    difficulty: Math.round(difficulty * 1000) / 1000,
    reps: card.reps + 1,
    lapses: card.lapses + (g === 1 && card.reps > 0 ? 1 : 0),
    last_review_at: now.toISOString(),
    due_at: due.toISOString(),
  };
}

/** "10 min", "1 day", "3 days", "2 mo" — when each rating would bring it back. */
export function nextIntervals(card: CardState, now = new Date()) {
  const label = (iso: string) => {
    const minutes = Math.round((Date.parse(iso) - now.getTime()) / 60_000);
    if (minutes < 60) return `${minutes} min`;
    const days = Math.round(minutes / 1440);
    if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
    const months = Math.round(days / 30);
    return months < 12 ? `${months} mo` : `${Math.round(days / 365)} yr`;
  };
  return Object.fromEntries(
    RATINGS.map((r) => [r, label(review(card, r, now).due_at)]),
  ) as Record<Rating, string>;
}

/** A card is known well enough when it has held for a week or more. */
export const isKnown = (card: Pick<CardState, "stability" | "reps">) =>
  card.reps > 0 && card.stability >= 7;

// ---- What the apps read -------------------------------------------------------

export type StudyCard = CardState & {
  id: string;
  doc_id: string;
  doc_title: string;
  key: string;
  block_id: string | null;
  question: string;
  answer: string;
  /** When each rating would bring it back, for the review buttons. */
  next: Record<Rating, string>;
  /** The notes line it was made from, when its line names one (H4). */
  source?: (CardSource & { doc_title: string; text: string }) | null;
  /** The picture it asks about (a page file id). */
  picture?: string | null;
  /** How many times it was answered "again". */
  misses?: number;
  /** Marked "needs work" (explain-it-back), until it's next recalled well. */
  needs_work?: boolean;
};

export type StudyDeck = {
  doc_id: string;
  title: string;
  team_id: string | null;
  cards: number;
  due: number;
  new: number;
  known: number;
  /** When its next card comes back (null when all are new). */
  next_due_at?: string | null;
  /** The file the page was imported from, for an imported page. */
  imported_from?: string | null;
};

export type StudyExam = {
  /** Stable for the same exam: its source and start. */
  key: string;
  title: string;
  starts_at: string;
  all_day: boolean;
  /** Where it came from: a subscribed calendar's name, or "yours". */
  source: string;
  doc_ids: string[];
  /** Share of the attached decks' cards known well (0–1); null with none. */
  readiness: number | null;
  /** The person's goal for it, in their words ("80%", "a 7"). */
  target?: string | null;
  /**
   * The share known well by the exam if every review is done when it's
   * due and new cards are learnt at the daily pace (0–1); null with none.
   */
  projected?: number | null;
  days_left: number;
};

export type StudyOverview = {
  due_today: number;
  new_cards: number;
  reviewed_today: number;
  /** Days in a row with at least one review, up to today. */
  streak: number;
  decks: StudyDeck[];
  exams: StudyExam[];
  /** Reviews due on each of the next 7 days (today includes overdue). */
  forecast?: { date: string; due: number }[];
  /**
   * The cards the person keeps getting wrong (most "again" answers first),
   * with the page to re-read: the notes line the card came from when it
   * has one.
   */
  weak: {
    id: string;
    question: string;
    doc_id: string;
    doc_title: string;
    lapses: number;
    /** Times answered "again". */
    misses: number;
    /** The notes line to re-read, when the card names one. */
    source?: (CardSource & { doc_title: string }) | null;
  }[];
};

export type RevisionSession = { start_at: string; end_at: string };
export type RevisionPlan = {
  exam: StudyExam;
  sessions: RevisionSession[];
  total_minutes: number;
  /** Days before the exam with no free time for a session. */
  skipped_days: string[];
};

// ---- Inputs --------------------------------------------------------------------

export const reviewInput = z.object({ rating: z.enum(RATINGS) }).strict();

export const studyQueueQuery = z.object({
  doc_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Include cards not yet due (cramming before an exam). */
  ahead: z.coerce.boolean().default(false),
});

export const examDecksInput = z
  .object({
    key: z.string().trim().min(1).max(300),
    title: z.string().trim().min(1).max(300),
    starts_at: z.iso.datetime({ offset: true }),
    doc_ids: z.array(z.uuid()).max(30),
  })
  .strict();

export const revisionPlanInput = z
  .object({
    key: z.string().trim().min(1).max(300),
    /** Minutes per session; heavier in the last three days. */
    minutes: z.number().int().min(15).max(120).default(30),
    timezone: z.string().trim().min(1).max(64),
  })
  .strict();

export const applyRevisionInput = z
  .object({
    key: z.string().trim().min(1).max(300),
    sessions: z
      .array(
        z.object({
          start_at: z.iso.datetime({ offset: true }),
          end_at: z.iso.datetime({ offset: true }),
        }),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const addCardsInput = z
  .object({
    cards: z
      .array(
        z.object({
          question: z.string().trim().min(1).max(500),
          answer: z.string().trim().min(1).max(1000),
        }),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const quizGradeInput = z
  .object({
    card_id: z.uuid(),
    /** What the person answered, in their own words. */
    answer: z.string().trim().min(1).max(2000),
  })
  .strict();

/** A card the assistant suggests from a page, before anyone approves it. */
export type SuggestedCard = {
  question: string;
  answer: string;
  /** The line of the page it's drawn from. */
  source: string;
};
