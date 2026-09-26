import { z } from "zod";
import { docContent } from "./schemas.js";
import { PAGE_TAG_LIMIT, type DocTag } from "./page-tags.js";
import type { DocBlock } from "./docs.js";

/**
 * Page templates (DAY-02): a page kept to start the next one from — lecture
 * notes, a lab report, a meeting — the way project templates keep how a kind
 * of project is run. Everyone has the same starters; you can save any page
 * as a template of your own, and a team page as the team's.
 *
 * A template can hold blanks that fill themselves in when a page is made
 * from it: {date}, {title}, {project} and {event}. Single braces on purpose,
 * because double braces are a cloze card ({{answer}}) and "::" makes a
 * flashcard, and a template must never turn into study cards by accident.
 *
 * A template can also say where its pages go (a folder) and what they are
 * tagged, and when it is used its to-do lines can become real tasks in the
 * project chosen for the page.
 */

/** The blanks a template can hold, as they are written in it. */
export const PAGE_BLANKS = ["date", "title", "project", "event"] as const;
export type PageBlank = (typeof PAGE_BLANKS)[number];
export type BlankValues = Partial<Record<PageBlank, string>>;

/** What each blank becomes, in the words the picker shows. */
export const BLANK_LABELS: Record<PageBlank, string> = {
  date: "today's date, or the event's",
  title: "the page's title",
  project: "the project you choose",
  event: "the event you choose",
};

/**
 * A blank: one of the names in single braces. Not one in double braces
 * ("{{date}}" is a cloze card and stays exactly as written).
 */
const BLANK_RE = /(?<!\{)\{(date|title|project|event)\}(?!\})/g;

/** Fill the blanks in one line. A blank with no value becomes nothing. */
export const fillBlanks = (text: string, values: BlankValues): string =>
  text.replace(BLANK_RE, (_m, name: PageBlank) => values[name] ?? "");

/** Which blanks a template uses, in its title or anywhere on its page. */
export function blanksIn(template: {
  title: string;
  content: DocBlock[];
}): PageBlank[] {
  const found = new Set<PageBlank>();
  const scan = (text: string) => {
    for (const m of text.matchAll(BLANK_RE)) found.add(m[1] as PageBlank);
  };
  scan(template.title);
  for (const b of template.content) if (b.type !== "divider") scan(b.text);
  return PAGE_BLANKS.filter((b) => found.has(b));
}

/**
 * A title with its blanks filled, tidied where a blank came out empty:
 * "{event} · {date}" with no event reads "24 September 2026", not
 * "· 24 September 2026". With `standIn` (the template's name), an empty
 * {event} reads as that instead, so a meeting page with no event chosen is
 * "Meeting · 24 September 2026".
 */
export function fillTitle(
  title: string,
  values: BlankValues,
  standIn?: string,
): string {
  const event = values.event?.trim() || standIn?.trim() || "";
  return fillBlanks(title, { ...values, event })
    .replace(/\s+/g, " ")
    .replace(/^[\s·:—–-]+|[\s·:—–-]+$/g, "")
    .replace(/(\s[·:—–-])(\s[·:—–-])+/g, "$1")
    .trim()
    .slice(0, 200);
}

/**
 * Whether a line is only a label left waiting for blanks that came out
 * empty — "Course: " once no project was chosen — and so is better left
 * off the page than left dangling.
 */
function onlyALabel(before: string, after: string, values: BlankValues) {
  const blanks = [...before.matchAll(BLANK_RE)].map((m) => m[1] as PageBlank);
  if (!blanks.length || blanks.some((b) => values[b]?.trim())) return false;
  return /^\s*[\p{L}\p{N}][\p{L}\p{N} '’&/-]{0,40}:\s*$/u.test(after);
}

/**
 * A template's page, filled in: the title, then every line but code and
 * maths, which are kept exactly as written. `{title}` on the page is the
 * page's own title as it was finally named. A line that was only a label
 * for blanks left empty ("Course: {project}" with no project) is left out.
 */
export function fillTemplate(
  template: { title: string; content: DocBlock[]; name?: string },
  values: BlankValues,
  title?: string,
): { title: string; content: DocBlock[] } {
  const named =
    title?.trim().slice(0, 200) ||
    fillTitle(
      template.title,
      { ...values, title: values.title ?? "" },
      template.name,
    ) ||
    template.name?.slice(0, 200) ||
    "";
  const all = { ...values, title: named };
  return {
    title: named,
    content: template.content.flatMap((b): DocBlock[] => {
      if (b.type === "divider" || b.type === "code" || b.type === "math")
        return [b];
      const text = fillBlanks(b.text, all);
      return onlyALabel(b.text, text, all) ? [] : [{ ...b, text }];
    }),
  };
}

/**
 * A page as a template: its lines as they are, with every box unticked and
 * without the names lines carry for comments and tasks — a template starts
 * fresh, and its lines belong to no task until a page is made from it.
 */
export function templateFromPage(content: DocBlock[]): DocBlock[] {
  return content.map((b) => {
    const { id: _id, ...rest } = b;
    return (rest.type === "todo" ? { ...rest, done: false } : rest) as DocBlock;
  });
}

/** How many to-do lines have words, so could become tasks. */
export const templateTodos = (content: DocBlock[]) =>
  content.filter((b) => b.type === "todo" && !b.done && b.text.trim()).length;

/** "24 September 2026", for {date}, in the reader's zone. */
export const blankDate = (at: Date, timeZone: string) =>
  at.toLocaleDateString("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export type PageTemplate = {
  /** "starter:lecture" for the built-in ones. */
  id: string;
  source: "starter" | "personal" | "team";
  name: string;
  description: string;
  team_id: string | null;
  team_name: string | null;
  /** The new page's title, blanks and all. */
  title: string;
  content: DocBlock[];
  /** Where pages made from it are filed, when it says. */
  folder_id: string | null;
  folder_name: string | null;
  /** Tags pages made from it start with. */
  tags: DocTag[];
  /** Whether you may change or delete it. */
  can_edit: boolean;
  created_at: string | null;
};

export const pageTemplateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    /** A team's template; null for your own. */
    team_id: z.uuid().nullable().default(null),
    title: z.string().trim().max(200).default(""),
    content: docContent.default([]),
    folder_id: z.uuid().nullable().default(null),
    tags: z.array(z.uuid()).max(PAGE_TAG_LIMIT).default([]),
  })
  .strict();

export const pageTemplateUpdate = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    title: z.string().trim().max(200).optional(),
    content: docContent.optional(),
    folder_id: z.uuid().nullable().optional(),
    tags: z.array(z.uuid()).max(PAGE_TAG_LIMIT).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/**
 * Save a page as a template. It is kept in the page's own space — a team
 * page makes a team template — unless `personal` asks for your own copy.
 */
export const pageTemplateFromDoc = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    personal: z.boolean().default(false),
  })
  .strict();

/**
 * Make a page from a template. Everything is optional: the title defaults
 * to the template's, filled in; the page is yours unless a team is named
 * (a team's template makes team pages); it goes in the template's folder
 * unless another is chosen. With a project, the page belongs to it and
 * {project} is its name; with `make_tasks`, the to-do lines become tasks
 * in it. With an event, {event} is its title and the page is its note.
 */
export const pageTemplateUse = z
  .object({
    title: z.string().trim().max(200).optional(),
    team_id: z.uuid().nullable().optional(),
    folder_id: z.uuid().nullable().optional(),
    project_id: z.uuid().nullable().default(null),
    event_id: z.uuid().nullable().default(null),
    /** When the event (this time of it) starts, for its {date}. */
    event_at: z.iso.datetime({ offset: true }).optional(),
    /**
     * Which class of a repeating event the page is the note for: the
     * calendar entry's `occurrence`. Left out, `event_at` says which.
     */
    occurrence: z.iso.datetime({ offset: true }).optional(),
    make_tasks: z.boolean().default(false),
  })
  .strict();

export type PageTemplateInput = z.input<typeof pageTemplateInput>;
export type PageTemplateUpdate = z.input<typeof pageTemplateUpdate>;
export type PageTemplateFromDoc = z.input<typeof pageTemplateFromDoc>;
export type PageTemplateUse = z.input<typeof pageTemplateUse>;

const h = (text: string): DocBlock => ({ type: "heading", level: 2, text });
const p = (text: string): DocBlock => ({ type: "paragraph", text });
const b = (text: string): DocBlock => ({ type: "bullet", text });
const n = (text: string): DocBlock => ({ type: "numbered", text });
const todo = (text: string): DocBlock => ({ type: "todo", text, done: false });

type Starter = Pick<
  PageTemplate,
  "id" | "name" | "description" | "title" | "content"
>;

/**
 * The templates everyone starts with. Served by the server, like the
 * project starters, so they can change without a new release of the apps.
 */
export const PAGE_TEMPLATE_STARTERS: Starter[] = [
  {
    id: "starter:lecture",
    name: "Lecture notes",
    description: "Key ideas, notes and questions from a class.",
    title: "Lecture notes · {date}",
    content: [
      p("Course: {project}"),
      p("Class: {event}"),
      h("Key ideas"),
      b(""),
      h("Notes"),
      p(""),
      h("Questions"),
      b(""),
      h("Follow up"),
      todo("Review these notes before the next class"),
    ],
  },
  {
    id: "starter:lab",
    name: "Lab report",
    description: "Aim, method, results and what they mean.",
    title: "Lab report · {date}",
    content: [
      p("Course: {project}"),
      h("Aim"),
      p(""),
      h("Hypothesis"),
      p(""),
      h("Equipment"),
      b(""),
      h("Method"),
      n(""),
      h("Results"),
      p(""),
      h("Discussion"),
      p(""),
      h("Conclusion"),
      p(""),
      h("To do"),
      todo("Write up the results"),
      todo("Check the report against the marking guide"),
      todo("Hand in the report"),
    ],
  },
  {
    id: "starter:essay",
    name: "Essay plan",
    description: "The question, your answer and the shape of the essay.",
    title: "Essay plan · {date}",
    content: [
      p("Course: {project}"),
      h("The question"),
      p(""),
      h("My answer in one sentence"),
      p(""),
      h("Outline"),
      n("Introduction"),
      n(""),
      n(""),
      n("Conclusion"),
      h("Sources"),
      b(""),
      h("To do"),
      todo("Finish the outline"),
      todo("Write the first draft"),
      todo("Check the references"),
      todo("Proofread and hand in"),
    ],
  },
  {
    id: "starter:meeting",
    name: "Meeting",
    description: "Agenda, notes, decisions and who does what.",
    title: "{event} · {date}",
    content: [
      p("When: {date}"),
      h("Agenda"),
      b(""),
      h("Notes"),
      p(""),
      h("Decisions"),
      b(""),
      h("Action items"),
      todo(""),
    ],
  },
  {
    id: "starter:weekly-review",
    name: "Weekly review",
    description: "Close the week and choose next week's three.",
    title: "Weekly review · {date}",
    content: [
      h("Done this week"),
      b(""),
      h("Didn't get to"),
      b(""),
      h("What I learned"),
      p(""),
      h("Next week's three"),
      todo(""),
      todo(""),
      todo(""),
    ],
  },
  {
    id: "starter:one-to-one",
    name: "One-to-one",
    description: "A regular conversation with its own running notes.",
    title: "One-to-one · {date}",
    content: [
      h("Their topics"),
      b(""),
      h("My topics"),
      b(""),
      h("Notes"),
      p(""),
      h("Agreed"),
      todo(""),
    ],
  },
];
