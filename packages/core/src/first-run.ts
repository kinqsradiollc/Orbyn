import { z } from "zod";
import { linkMarkdown } from "./links.js";

/**
 * A guided first run (DSN-02), in three steps: what Orbyn is for (Study,
 * Team or Personal), a calendar if you like, and a starter. A starter makes
 * a small project with a brief page that links to its other pages, so
 * links and "Linked here" are there to see from the first day.
 *
 * Everything here is words and shape; the server makes the project and pages
 * in one go, and the apps show the steps.
 */

export const FIRST_RUN_PURPOSES = ["study", "team", "personal"] as const;
export type FirstRunPurpose = (typeof FIRST_RUN_PURPOSES)[number];

export const PURPOSE_LABELS: Record<
  FirstRunPurpose,
  { name: string; blurb: string }
> = {
  study: {
    name: "Study",
    blurb: "Lectures, assignments and exams, planned around your week.",
  },
  team: {
    name: "Team",
    blurb: "Shared projects and pages, and who is doing what.",
  },
  personal: {
    name: "Personal",
    blurb: "Your own tasks, notes and plans in one calm place.",
  },
};

export const STARTERS = ["term", "weekly", "sprint", "none"] as const;
export type StarterId = (typeof STARTERS)[number];

type StarterPage = { title: string; body: string };

export type Starter = {
  id: StarterId;
  name: string;
  blurb: string;
  /** For which purposes it is offered first. */
  for: FirstRunPurpose[];
  project: { name: string; summary: string; stages: string[] };
  brief: { title: string; intro: string };
  /** Pages the brief links to. */
  pages: StarterPage[];
  /** A few first tasks, in the project. */
  tasks: string[];
};

export const STARTER_LIST: Starter[] = [
  {
    id: "term",
    name: "A term",
    blurb: "A project for this term, with lecture notes and a lab report page.",
    for: ["study"],
    project: {
      name: "This term",
      summary: "Lectures, assignments and exams for the term.",
      stages: ["Lectures", "Assignments", "Exams"],
    },
    brief: {
      title: "Term brief",
      intro:
        "What this term is about, what is due when, and where the notes are.",
    },
    pages: [
      {
        title: "Lecture notes",
        body: "## Lecture 1\n\n- Key idea\n- Question to ask\n\nTerm :: A word worth remembering",
      },
      {
        title: "Lab report",
        body: "## Aim\n\n## Method\n\n## Results\n\n## Discussion",
      },
    ],
    tasks: ["Add your exam dates", "Write up the first lecture"],
  },
  {
    id: "weekly",
    name: "A weekly review",
    blurb: "A short page to look back on the week and plan the next.",
    for: ["personal", "study"],
    project: {
      name: "Weekly review",
      summary: "Looking back on each week, and planning the next.",
      stages: ["This week", "Next week"],
    },
    brief: {
      title: "How I review my week",
      intro: "Fifteen minutes, once a week, with the review page below.",
    },
    pages: [
      {
        title: "This week's review",
        body: "## What went well\n\n## What got in the way\n\n## Next week\n\n- [ ] Pick three things that matter",
      },
    ],
    tasks: ["Do this week's review"],
  },
  {
    id: "sprint",
    name: "A team sprint",
    blurb: "A two-week project with a brief and a notes page for the team.",
    for: ["team"],
    project: {
      name: "First sprint",
      summary: "Two weeks of work, shared with the team.",
      stages: ["To do", "Doing", "Done"],
    },
    brief: {
      title: "Sprint brief",
      intro: "The goal for these two weeks, who is doing what, and the notes.",
    },
    pages: [
      {
        title: "Sprint notes",
        body: "## Stand-up notes\n\n## Decisions\n\n## Retro",
      },
    ],
    tasks: ["Agree the sprint goal", "Share the brief with the team"],
  },
  {
    id: "none",
    name: "Nothing for now",
    blurb: "Start with an empty Orbyn.",
    for: ["study", "team", "personal"],
    project: { name: "", summary: "", stages: [] },
    brief: { title: "", intro: "" },
    pages: [],
    tasks: [],
  },
];

export const starterById = (id: StarterId) =>
  STARTER_LIST.find((s) => s.id === id)!;

/** The starters for a purpose: the ones made for it first, then the rest. */
export const startersFor = (purpose: FirstRunPurpose) => [
  ...STARTER_LIST.filter((s) => s.id !== "none" && s.for[0] === purpose),
  ...STARTER_LIST.filter((s) => s.id !== "none" && s.for[0] !== purpose),
  starterById("none"),
];

/** The starter chosen when someone does not choose. */
export const defaultStarter = (purpose: FirstRunPurpose): StarterId =>
  purpose === "study" ? "term" : purpose === "team" ? "sprint" : "weekly";

/** The brief's words: its introduction, then a link to each of its pages. */
export function starterBrief(
  starter: Starter,
  pages: { id: string; title: string }[],
  projectId: string | null,
): string {
  const lines = [starter.brief.intro, "", "## Pages"];
  for (const p of pages)
    lines.push(`- ${linkMarkdown({ kind: "doc", id: p.id }, p.title)}`);
  if (projectId)
    lines.push(
      "",
      `Everything for this lives in ${linkMarkdown({ kind: "project", id: projectId }, starter.project.name)}.`,
    );
  return lines.join("\n");
}

export const firstRunInput = z.object({
  purpose: z.enum(FIRST_RUN_PURPOSES),
  starter: z.enum(STARTERS).default("none"),
  /** For a team sprint: the team it goes in; a new team when left out. */
  team_id: z.uuid().nullable().optional(),
  /** A new team's name, for a team sprint with no team given. */
  team_name: z.string().trim().min(1).max(80).optional(),
});
export type FirstRunInput = z.input<typeof firstRunInput>;

export type FirstRunResult = {
  project_id: string | null;
  brief_id: string | null;
  team_id: string | null;
};
