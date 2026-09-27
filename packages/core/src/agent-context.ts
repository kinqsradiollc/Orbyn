import { z } from "zod";

/**
 * Agents start warm (Agent 2, H8): what an agent reads before it helps.
 *
 * - "About me for agents": one ordinary page per person, in Personal, that
 *   the person or an agent fills in (courses, exams, how they like notes
 *   and cards, study times, working hours). Orbyn remembers which page it
 *   is; it is edited like any page.
 * - Instructions per space: a few lines for Personal and for each team
 *   ("In Biology, cards are cloze"). A team's instructions are the team's:
 *   members who can change the team's work edit them, and agents are
 *   asked first (they change teammates' agents too).
 * - Standing rules stay where H0 put them (Connected agents → Standing
 *   rules): one list, linked from the page, never copied into it.
 *
 * The learning profile (card style, cards per lecture, session length,
 * study times) is read from the page's "Key: value" lines, so the person
 * writes it in plain words and quizzes, revision plans and prompts follow.
 */

/** The page's title when Orbyn makes it. */
export const AGENT_PROFILE_TITLE = "About me for agents";

/** The most an instruction for one space may say. */
export const MAX_AGENT_INSTRUCTIONS = 2000;

/** The page Orbyn starts with, in Orbyn Markdown. */
export const AGENT_PROFILE_TEMPLATE = `What my agents should know before they help me. They read this page first and may fill it in; I can change anything. Write "Card style" as Q&A, cloze or both, "Session length" in minutes and "Study times" like Weekdays 19:00–21:00.

## Courses and subjects

-

## Upcoming exams

-

## How I like notes

-

## How I like cards

- Card style:
- Cards per lecture:

## Study times

- Study times:
- Session length:

## Working hours

-

## Standing rules

My standing rules are kept in Settings → Connected agents → Standing rules, so every agent follows one list.`;

/** How someone likes their cards. */
export type CardStyle = "qa" | "cloze" | "mixed";

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
  qa: "Question and answer",
  cloze: "Cloze (fill the gap)",
  mixed: "Both",
};

/** A time of day someone studies, as written, with its clock times when given. */
export type StudyTime = {
  text: string;
  /** "HH:MM", when the words name a time range. */
  start: string | null;
  end: string | null;
};

/** What the profile page says about how someone learns. */
export type LearningProfile = {
  card_style: CardStyle | null;
  /** About how many cards for a lecture or page. */
  cards: number | null;
  session_minutes: number | null;
  study_times: StudyTime[];
};

export const EMPTY_LEARNING: LearningProfile = {
  card_style: null,
  cards: null,
  session_minutes: null,
  study_times: [],
};

const KEYS: [RegExp, keyof LearningProfile][] = [
  [/^(card|cards?) (style|type|kind)s?$/, "card_style"],
  [
    /^(cards? (per|a|for each) \w+|card count|how many cards|number of cards)$/,
    "cards",
  ],
  [
    /^((study )?session( length)?|session minutes|study length)$/,
    "session_minutes",
  ],
  [/^(study times?|when i study|study hours)$/, "study_times"],
];

const clock = (h: string, m: string | undefined, ampm: string | undefined) => {
  let hour = Number(h);
  const min = Number(m ?? "0");
  if (ampm) {
    const pm = ampm.toLowerCase().startsWith("p");
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (hour > 24 || min > 59) return null;
  return `${String(hour % 24).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
};

/** "Weekdays 19:00–21:00" → its text and clock times. */
export function studyTimeOf(text: string): StudyTime | null {
  const t = text.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!t) return null;
  const m =
    /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i.exec(
      t,
    );
  const start = m ? clock(m[1], m[2], m[3] ?? m[6]) : null;
  const end = m ? clock(m[4], m[5], m[6]) : null;
  return {
    text: t,
    start: start && end ? start : null,
    end: start && end ? end : null,
  };
}

function cardStyleOf(v: string): CardStyle | null {
  const s = v.toLowerCase();
  const cloze = /cloze|fill|gap|blank/.test(s);
  const qa = /q\s*(&|and|\/)\s*a|\bqa\b|question/.test(s);
  if (/both|mix/.test(s) || (cloze && qa)) return "mixed";
  if (cloze) return "cloze";
  if (qa) return "qa";
  return null;
}

function minutesOf(v: string): number | null {
  const s = v.toLowerCase();
  const hours = /(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(s);
  const mins = /(\d+)\s*(m|min|mins|minute|minutes)?\b/.exec(s);
  const n = hours
    ? Math.round(Number(hours[1].replace(",", ".")) * 60) +
      Number(
        /(\d+)\s*(m|min|mins|minutes)\b/.exec(
          s.slice(hours.index + hours[0].length),
        )?.[1] ?? 0,
      )
    : mins
      ? Number(mins[1])
      : NaN;
  return Number.isFinite(n) && n >= 5 && n <= 480 ? n : null;
}

/**
 * The learning profile in a profile page's words: its "Key: value" lines
 * (bullets or not), wherever they are. Missing or unclear values are null.
 */
export function learningProfileOf(text: string): LearningProfile {
  const out: LearningProfile = { ...EMPTY_LEARNING, study_times: [] };
  for (const raw of text.split("\n")) {
    const line = raw
      .replace(/\s\^[\w-]+\s*$/, "")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
      .replace(/\*\*|__/g, "")
      .trim();
    const m = /^([A-Za-z][A-Za-z ]{2,40}?)\s*[:：]\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, " ");
    const value = m[2].trim();
    if (!value) continue;
    const field = KEYS.find(([re]) => re.test(key))?.[1];
    if (field === "card_style") out.card_style ??= cardStyleOf(value);
    else if (field === "cards") {
      const n = Number(/(\d{1,3})/.exec(value)?.[1]);
      if (out.cards === null && n >= 1 && n <= 200) out.cards = n;
    } else if (field === "session_minutes")
      out.session_minutes ??= minutesOf(value);
    else if (field === "study_times")
      for (const part of value.split(/[,;]|\band\b/i)) {
        const t = studyTimeOf(part);
        if (t && out.study_times.length < 6) out.study_times.push(t);
      }
  }
  return out;
}

/** Whether a learning profile says anything. */
export const hasLearning = (l: LearningProfile | null | undefined) =>
  !!l &&
  (l.card_style !== null ||
    l.cards !== null ||
    l.session_minutes !== null ||
    l.study_times.length > 0);

/** The learning profile in a sentence, for prompts and summaries. */
export function learningText(l: LearningProfile): string {
  const bits = [
    l.card_style
      ? `cards as ${CARD_STYLE_LABELS[l.card_style].toLowerCase()}`
      : "",
    l.cards ? `about ${l.cards} cards a lecture` : "",
    l.session_minutes ? `study sessions of ${l.session_minutes} minutes` : "",
    l.study_times.length
      ? `studies ${l.study_times.map((t) => t.text).join(", ")}`
      : "",
  ].filter(Boolean);
  return bits.join("; ");
}

// --- Instructions per space ---------------------------------------------------

/** One space's instructions, as Connected agents shows them. */
export type AgentInstructions = {
  /** null: Personal. */
  team_id: string | null;
  /** "Personal", or the team's name. */
  space: string;
  text: string;
  /** Whether this person may change them (a team's viewers can't). */
  can_edit: boolean;
  updated_at: string | null;
  /** Who changed them last, and through which agent, when one did. */
  updated_by: string | null;
  updated_via: string | null;
};

export const agentInstructionsInput = z
  .object({
    text: z.string().trim().max(MAX_AGENT_INSTRUCTIONS),
  })
  .strict();
export type AgentInstructionsInput = z.input<typeof agentInstructionsInput>;

/** Settings → Connected agents: the profile page and every space's instructions. */
export type AgentContextSettings = {
  profile: { doc_id: string; title: string; updated_at: string } | null;
  instructions: AgentInstructions[];
};
