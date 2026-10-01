import { z } from "zod";
import { docContent } from "./schemas.js";
import { isValidRrule } from "./time.js";
import type { DocBlock, DocHeadingLevel } from "./docs.js";

/**
 * Project templates: how a person or a team runs a kind of project — sprint
 * planning, a retro, OKRs — kept to start the next one from. A template is a
 * project draft (tasks, estimates, days from the start, what waits on what),
 * with a brief page, and may start itself on a rhythm. Starting one always
 * makes a proposal to review first.
 */
const templateTask = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-zA-Z0-9_-]+$/),
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(10000).default(""),
    estimate_minutes: z.number().int().min(5).max(10080),
    /** Due this many days after the project starts. */
    due_in_days: z.number().int().min(0).max(365),
    depends_on: z.array(z.string().min(1).max(60)).max(14).default([]),
    /** A number to reach, for a key result. */
    target_value: z.number().min(-1e12).max(1e12).nullable().default(null),
    value_unit: z.string().trim().max(16).default(""),
  })
  .strict();

export type TemplateTask = z.infer<typeof templateTask>;

const templatePage = z
  .object({
    title: z.string().trim().max(200),
    content: docContent,
  })
  .strict();

export const templateInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    /** A team template; null for your own. Only owners and admins make them. */
    team_id: z.uuid().nullable().default(null),
    tasks: z.array(templateTask).min(1).max(15),
    page: templatePage.nullable().default(null),
    /** Start itself on this rhythm, e.g. "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR". */
    rrule: z
      .string()
      .trim()
      .max(200)
      .refine(isValidRrule, "That repeat rule isn't supported")
      .nullable()
      .default(null),
  })
  .strict();

export const templateUpdate = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    tasks: z.array(templateTask).min(1).max(15).optional(),
    page: templatePage.nullable().optional(),
    rrule: z
      .string()
      .trim()
      .max(200)
      .refine(isValidRrule, "That repeat rule isn't supported")
      .nullable()
      .optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, "Nothing to update");

/** Start a project from a template: the project's name, and whose it is. */
export const templateUseInput = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    team_id: z.uuid().nullable().optional(),
  })
  .strict();

export type TemplateInput = z.input<typeof templateInput>;
export type TemplateUpdate = z.input<typeof templateUpdate>;

export type ProjectTemplate = {
  /** "starter:retro" for the built-in ones. */
  id: string;
  source: "starter" | "personal" | "team";
  name: string;
  description: string;
  team_id: string | null;
  team_name: string | null;
  tasks: TemplateTask[];
  page: { title: string; content: DocBlock[] } | null;
  rrule: string | null;
  /** When it next starts itself, for one with a rhythm. */
  next_at: string | null;
  /** Whether you may change or delete it. */
  can_edit: boolean;
  created_at: string | null;
};

const h = (text: string, level: DocHeadingLevel = 2): DocBlock => ({
  type: "heading",
  level,
  text,
});
const p = (text: string): DocBlock => ({ type: "paragraph", text });
const b = (text: string): DocBlock => ({ type: "bullet", text });
const todo = (text: string): DocBlock => ({ type: "todo", text, done: false });

const task = (
  id: string,
  title: string,
  estimate_minutes: number,
  due_in_days: number,
  depends_on: string[] = [],
  extra: Partial<TemplateTask> = {},
): TemplateTask => ({
  id,
  title,
  notes: "",
  estimate_minutes,
  due_in_days,
  depends_on,
  target_value: null,
  value_unit: "",
  ...extra,
});

/**
 * The templates everyone starts with. They're served by the server, so they
 * can change without a new release of the apps.
 */
export const TEMPLATE_STARTERS: Omit<
  ProjectTemplate,
  "source" | "team_id" | "team_name" | "can_edit" | "created_at" | "next_at"
>[] = [
  {
    id: "starter:sprint",
    name: "Sprint planning",
    description:
      "Two weeks from goal to demo: plan, build, review and look back.",
    tasks: [
      task("goal", "Agree the sprint goal", 30, 0),
      task("backlog", "Groom and estimate the backlog", 60, 0, ["goal"]),
      task("commit", "Commit to the sprint's work", 45, 1, ["backlog"]),
      task("midpoint", "Mid-sprint check-in", 30, 7, ["commit"]),
      task("demo", "Sprint review and demo", 60, 13, ["midpoint"]),
      task("retro", "Sprint retrospective", 45, 13, ["demo"]),
    ],
    page: {
      title: "Sprint brief",
      content: [
        h("Goal"),
        p("What will be true at the end of this sprint?"),
        h("In scope"),
        b(""),
        h("Out of scope"),
        b(""),
        h("Risks"),
        b(""),
      ],
    },
    rrule: null,
  },
  {
    id: "starter:retro",
    name: "Retrospective",
    description: "What went well, what didn't, and what to try next.",
    tasks: [
      task("collect", "Collect notes from everyone", 20, 0),
      task("run", "Run the retrospective", 60, 1, ["collect"]),
      task("actions", "Turn the tries into tasks", 20, 2, ["run"]),
    ],
    page: {
      title: "Retrospective",
      content: [
        h("Went well"),
        b(""),
        h("Didn't go well"),
        b(""),
        h("Try next"),
        todo(""),
      ],
    },
    rrule: null,
  },
  {
    id: "starter:okr",
    name: "OKR tracking",
    description:
      "One objective and the key results that show it happened, each with a number to reach.",
    tasks: [
      task("objective", "Write the objective", 45, 0),
      task("kr1", "Key result 1", 60, 84, ["objective"], {
        target_value: 100,
        value_unit: "",
      }),
      task("kr2", "Key result 2", 60, 84, ["objective"], {
        target_value: 100,
        value_unit: "",
      }),
      task("kr3", "Key result 3", 60, 84, ["objective"], {
        target_value: 100,
        value_unit: "",
      }),
      task("midquarter", "Mid-quarter check-in", 45, 42, ["kr1", "kr2", "kr3"]),
      task("score", "Score the quarter", 60, 89, ["midquarter"]),
    ],
    page: {
      title: "Objective",
      content: [
        h("Objective"),
        p("One sentence: what you want to be true."),
        h("Key results"),
        p("Each has a number. Update it on the task as it moves."),
        h("Why it matters"),
        p(""),
      ],
    },
    rrule: null,
  },
  {
    id: "starter:launch",
    name: "Product launch",
    description: "From brief to announcement, in the order it has to happen.",
    tasks: [
      task("brief", "Write the launch brief", 90, 1),
      task("audience", "Pin down who it's for", 45, 2, ["brief"]),
      task("copy", "Draft the announcement", 120, 5, ["audience"]),
      task("assets", "Make screenshots and assets", 180, 6, ["audience"]),
      task("review", "Review with the team", 60, 8, ["copy", "assets"]),
      task("ship", "Publish and announce", 60, 10, ["review"]),
      task("followup", "Follow up on feedback", 60, 14, ["ship"]),
    ],
    page: {
      title: "Launch brief",
      content: [
        h("What we're launching"),
        p(""),
        h("Who it's for"),
        p(""),
        h("The one thing to remember"),
        p(""),
        h("Launch checklist"),
        todo("Announcement written"),
        todo("Assets ready"),
        todo("Team briefed"),
      ],
    },
    rrule: null,
  },
  {
    id: "starter:weekly",
    name: "Weekly review",
    description: "Close the week and set up the next one.",
    tasks: [
      task("inbox", "Clear the inbox and loose ends", 30, 0),
      task("review", "Look back at the week", 20, 0, ["inbox"]),
      task("plan", "Choose next week's three priorities", 20, 0, ["review"]),
    ],
    page: {
      title: "Weekly review",
      content: [
        h("Done this week"),
        b(""),
        h("Carried over"),
        b(""),
        h("Next week's three"),
        todo(""),
        todo(""),
        todo(""),
      ],
    },
    rrule: "FREQ=WEEKLY;BYDAY=FR",
  },
  {
    id: "starter:one-to-one",
    name: "One-to-one",
    description: "A regular conversation with its own running notes.",
    tasks: [
      task("topics", "Gather topics", 15, 0),
      task("meet", "Meet", 30, 1, ["topics"]),
      task("follow", "Send follow-ups", 15, 1, ["meet"]),
    ],
    page: {
      title: "One-to-one",
      content: [
        h("Their topics"),
        b(""),
        h("My topics"),
        b(""),
        h("Agreed"),
        todo(""),
      ],
    },
    rrule: null,
  },
];
