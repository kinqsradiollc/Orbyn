import type { AgentToolset } from "@orbyn/core";
import type { Principal } from "./policy.js";

/**
 * Prompts: the workflows people pick from their agent's prompt menu
 * ("Plan my day", "Catch up on a project"). Each is plain text the person
 * can read, naming only Orbyn's own tools, with no hidden instructions.
 * A prompt is offered only when the connection has the toolsets its steps
 * use; the text says where a step needs the person's go-ahead.
 */

/** What an argument is completed from (completion/complete). */
export type ArgumentSource = "project" | "doc" | "event" | "team" | "exam";

export type PromptArgument = {
  name: string;
  description: string;
  required?: boolean;
  /** Filled from titles this connection can see. */
  complete?: ArgumentSource;
};

export type PromptSpec = {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
  /** Toolsets the steps use (core is always there). */
  needs: AgentToolset[];
  text(args: Record<string, string>): string;
};

const given = (v: string | undefined, label: string) =>
  v?.trim() ? `\n${label}: ${v.trim()}` : "";

export const PROMPTS: PromptSpec[] = [
  {
    name: "plan_my_day",
    title: "Plan my day",
    description:
      "Looks at today in Orbyn and proposes sessions for the rest of it, then asks before adding them.",
    arguments: [
      { name: "focus", description: "What matters most today (optional)." },
      {
        name: "hours_available",
        description: "Hours free for work today (optional).",
      },
    ],
    needs: [],
    text: (a) =>
      `Help me plan the rest of today in Orbyn.${given(a.focus, "Focus")}${given(a.hours_available, "Hours available")}

1. Read my day with get_today (what's planned, what's due, what needs me).
2. Preview sessions for today with plan_schedule (days: 1). Nothing is written yet.
3. Show me the plan: each session, why it's there, and anything that didn't fit.
4. Only when I say yes, apply it with schedule_sessions using the plan_token.`,
  },
  {
    name: "plan_my_week",
    title: "Plan my week",
    description:
      "Lines up the week's work around what's due and what's already on the calendar, and asks once before scheduling.",
    arguments: [
      { name: "priorities", description: "What should come first (optional)." },
      {
        name: "focus_project",
        description: "A project to put first (optional).",
        complete: "project",
      },
    ],
    needs: [],
    text: (a) =>
      `Help me plan my week in Orbyn.${given(a.priorities, "Priorities")}${given(a.focus_project, "Project to put first")}

1. List my open tasks due in the next 7 days with query (due_before "+7d", sort priority).
2. Read the week's calendar with get_calendar, including frames and habits.
3. Preview sessions for the week with plan_schedule (days: 7). Nothing is written yet.
4. Show me the plan by day, with the load per day and anything that didn't fit.
5. Ask me once; when I agree, apply it with schedule_sessions.`,
  },
  {
    name: "daily_shutdown",
    title: "Daily shutdown",
    description:
      "Closes the day: what got done, what slipped, and a start on tomorrow.",
    arguments: [],
    needs: [],
    text: () =>
      `Help me close my day in Orbyn.

1. Read today with get_today: what was planned, what's done and what slipped.
2. Ask me which tasks I finished, and mark only those with complete_tasks.
3. Preview tomorrow with plan_schedule (start_date tomorrow, days 1): unfinished work is planned again, and sessions that should move before a deadline are listed.
4. Show me the plan for tomorrow. Apply it with schedule_sessions only after I say yes.`,
  },
  {
    name: "weekly_review",
    title: "Weekly review",
    description:
      "Planned against done, follow-ups and overdue work, then a short summary with suggested changes filed for review.",
    arguments: [
      {
        name: "team",
        description: "A team to review instead of Personal (optional).",
        complete: "team",
      },
    ],
    needs: ["planner", "followthrough"],
    text: (a) =>
      `Run my weekly review in Orbyn.${given(a.team, "Team")}

1. Compare planned and done time with get_work_patterns.
2. Read asks, promises, decisions and tasks at risk with get_follow_through.
3. List overdue tasks with query (overdue true).
4. Summarise the week in a few lines, with links.
5. File any changes you suggest with propose_changes, so I approve them in Orbyn's Review inbox.`,
  },
  {
    name: "project_kickoff",
    title: "Start a project",
    description:
      "Looks for similar projects and templates, drafts stages and first tasks, then plans the first sessions.",
    arguments: [
      { name: "name", description: "The project's name.", required: true },
      { name: "deadline", description: "Its latest date (optional)." },
      { name: "template", description: "A template to start from (optional)." },
    ],
    needs: [],
    text: (a) =>
      `Help me start a project in Orbyn called "${(a.name ?? "").trim()}".${given(a.deadline, "Deadline")}${given(a.template, "Template")}

1. Look for similar projects and templates with search (types project and template).
2. Draft stages and first tasks, and show them to me.
3. When I agree, make it with create_project. The deadline is the project's latest date; it doesn't set task deadlines.
4. Preview first sessions with plan_schedule, and apply them only after I say yes.`,
  },
  {
    name: "catch_up_on_project",
    title: "Catch up on a project",
    description:
      "A re-entry brief: where the project stands, what changed since you were last there, and what links to it.",
    arguments: [
      {
        name: "project",
        description: "The project.",
        required: true,
        complete: "project",
      },
    ],
    needs: ["workspace"],
    text: (a) =>
      `Catch me up on the Orbyn project "${(a.project ?? "").trim()}".

1. Open it with get_project (find its id with search first if needed).
2. Read what changed recently with get_history.
3. Read what links to it with get_links.
4. Give me a short brief: where it stands, what changed, what needs me next. Cite pages and lines with their links.`,
  },
  {
    name: "ask_project",
    title: "Ask about a project",
    description:
      "Answers a question from a project's pages, tasks and decisions, with numbered citations.",
    arguments: [
      {
        name: "project",
        description: "The project.",
        required: true,
        complete: "project",
      },
      { name: "question", description: "What to ask.", required: true },
    ],
    needs: [],
    text: (a) =>
      `Answer this from my Orbyn project "${(a.project ?? "").trim()}": ${(a.question ?? "").trim()}

1. Find the project's id with search if needed.
2. Find the passages that answer it with find_passages, scoped to the project.
3. Answer in a few sentences, citing each claim with a numbered link to its line. If the pages don't say, say so.`,
  },
  {
    name: "study_session",
    title: "Study session",
    description:
      "Quizzes you on due flashcards one at a time and records how each went.",
    arguments: [
      {
        name: "exam",
        description: "An exam or page to study for (optional).",
        complete: "exam",
      },
    ],
    needs: ["study"],
    text: (a) =>
      `Quiz me with my Orbyn flashcards.${given(a.exam, "For")}

1. Get the cards due with get_study (queue). Keep each answer hidden until I've tried.
2. Ask one card at a time, show the answer, and ask how it went (again, hard, good or easy).
3. Record each with update_study.
4. If the exam is close, preview revision sessions with plan_revision and ask before scheduling them.`,
  },
  {
    name: "meeting_prep",
    title: "Prepare for a meeting",
    description:
      "Gathers what's linked to a meeting and drafts a meeting note for it.",
    arguments: [
      {
        name: "event",
        description: "The meeting.",
        required: true,
        complete: "event",
      },
    ],
    needs: [],
    text: (a) =>
      `Help me prepare for "${(a.event ?? "").trim()}" in Orbyn.

1. Open the event with fetch (find it with search or get_calendar if needed).
2. Read what's linked to it with get_links, and related passages with find_passages.
3. Draft an agenda and show it to me.
4. When I agree, save it as a meeting note for the event with create_doc (kind meeting).`,
  },
  {
    name: "triage_inbox",
    title: "Triage loose ends",
    description:
      "Finds tasks with no date, project or estimate, and asks waiting on you, and drafts updates for you to confirm.",
    arguments: [],
    needs: [],
    text: () =>
      `Help me tidy loose ends in Orbyn.

1. Find open tasks with no deadline or project with query, and what needs me with get_today.
2. Suggest a deadline, project or estimate for each, briefly.
3. File the suggestions with propose_changes, so I confirm them in Orbyn's Review inbox. Change nothing directly.`,
  },
  {
    name: "turn_notes_into_tasks",
    title: "Turn notes into tasks",
    description:
      "Makes tasks from a page's open checklist lines, linked both ways.",
    arguments: [
      {
        name: "doc",
        description: "The page.",
        required: true,
        complete: "doc",
      },
    ],
    needs: ["workspace"],
    text: (a) =>
      `Turn the open checklist lines of my Orbyn page "${(a.doc ?? "").trim()}" into tasks.

1. Open the page with fetch (find it with search if needed) and show me the open checklist lines.
2. When I agree, make them tasks with tasks_from_doc; ticking a line or its task ticks the other.
3. If there are more than 25, file them with propose_changes instead.`,
  },
];

/** The prompts a connection is offered. */
export const promptsFor = (p: Principal) =>
  PROMPTS.filter((x) => x.needs.every((t) => p.toolsets.includes(t)));
