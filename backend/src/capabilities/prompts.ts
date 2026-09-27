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
  /**
   * The prompt's words. `learned` is the person's learning profile in a
   * sentence (H8: card style, cards a lecture, session length, study
   * times), for the study prompts, when their About me page says it.
   */
  text(args: Record<string, string>, learned?: string): string;
  /** Reads the person's learning profile (study prompts). */
  learns?: boolean;
};

/** "How I learn" for a study prompt, when the profile says. */
const learnedLine = (learned: string | undefined, use: string) =>
  learned ? `\nHow I learn (from my About me page): ${learned}. ${use}` : "";

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
      "Quizzes you on your cards one at a time, practice first (what you keep getting wrong comes first), and records how each went.",
    arguments: [
      {
        name: "exam",
        description: "An exam or page to study for (optional).",
        complete: "exam",
      },
    ],
    needs: ["study"],
    learns: true,
    text: (a, learned) =>
      `Quiz me with my Orbyn flashcards.${given(a.exam, "For")}${learnedLine(learned, "Keep the session about that long (get_study's queue is sized to it), and write new cards in that style.")}

1. Get the next card with get_study (queue, limit 1${a.exam ? ", exam" : ""}). Answers stay hidden; ask me the question (show a picture card's picture) and let me answer in my own words before you look.
2. Then get its answer with get_study (card), compare my answer yourself, tell me what I got right and what I missed, and ask "why?" or "how does that connect to …?" when I got it right too.
3. Record how it went with update_study (reviews: again, hard, good or easy) and go on to the next card; stop when nothing is left for today or I say so. Cards I keep getting wrong come first; point me to the notes line a card came from (from) when I miss it.
4. Now and then, ask me to explain a topic in my own words: get my notes and cards on it with get_study (explain), judge my explanation against them yourself, and mark what fell short with update_study (needs work).
5. If an exam is close and not planned, offer to book revision with update_study (exam with plan: true).
6. When a topic has no cards yet, write retrieval questions from my notes (not summaries): question/answer, cloze and "why" cards, each with from set to the line it came from, via update_study (cards).`,
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
  // Agent 2 (H5): one call, whole job. The agent does the thinking; Orbyn
  // stores the result with one apply_plan call.
  {
    name: "lecture_to_notes",
    title: "Lecture to notes and cards",
    description:
      "Turns a lecture you have (transcript, slides, file) into sourced notes, practice-first cards, tasks and a first review, applied in one step.",
    arguments: [
      {
        name: "lecture",
        description: "The lecture: its title, and where its text is.",
        required: true,
      },
      {
        name: "project",
        description: "The course or project it belongs to (optional).",
        complete: "project",
      },
      {
        name: "exam",
        description: "An exam it counts for (optional).",
        complete: "exam",
      },
    ],
    needs: ["study"],
    learns: true,
    text: (a, learned) =>
      `Turn this lecture into study material in Orbyn. Do the thinking yourself: Orbyn only keeps what you send.
Lecture: ${(a.lecture ?? "").trim()}${given(a.project, "Project")}${given(a.exam, "Exam")}${learnedLine(learned, "Write the cards in that style and about that many, and make the first review session that long.")}

1. Call get_context for my time zone and spaces, and follow any profile or standing rules it has on how I like notes and cards.
2. Read the lecture yourself: the transcript, slides or file you have (transcribe a recording yourself). Find my earlier notes on the topic with find_passages or search.
3. Write the notes in Orbyn Markdown (orbyn://spec/markdown): a heading per topic, definitions, worked examples, a callout for what is likely examined, [[links]] to earlier pages, and a source at the end of each line you took from the lecture, like [src: Lecture 5 slides, slide 12]. Name the lines cards will point at (## Glycolysis ^glyco).
4. Write practice-first cards: retrieval questions, not summaries (question and answer, cloze, "why" and "how does this connect" cards), each from the notes line it tests.
5. Add tasks with dates for what I have to do (readings, problem sets), a "Review: <lecture>" task, and its first review session a day or two from now.
6. Apply everything with ONE apply_plan call, steps in order: create_doc (id notes; in the project if given), update_study (cards: page "$notes.id", each card's from "$notes.lines.<anchor>"${a.exam?.trim() ? "; and the exam's pages" : ""}), create_tasks (id tasks), link (related: "$notes.id" to earlier pages), schedule_sessions (task "$tasks.ids[0]" for the review task). Give it a summary and a client_ref.
7. Orbyn asks me once, only for what is on my ask-first list; if the plan waits in my Review inbox, say so. Show me what was made with links, and the job id (undo with it takes it all back).`,
  },
  {
    name: "research_brief",
    title: "Research brief",
    description:
      "Researches a question with the sources you can reach and writes a sourced brief with next steps, applied in one step.",
    arguments: [
      {
        name: "question",
        description: "What to find out.",
        required: true,
      },
      {
        name: "project",
        description: "A project to file it in (optional).",
        complete: "project",
      },
    ],
    needs: ["study"],
    text: (a) =>
      `Research this and write me a brief in Orbyn. Do the reading and thinking yourself: Orbyn only keeps what you send.
Question: ${(a.question ?? "").trim()}${given(a.project, "Project")}

1. Call get_context, and follow any profile or standing rules it has.
2. See what I already have with find_passages and search, so the brief builds on it.
3. Read the sources you can reach yourself. Keep each one's address, title, author and a short quote.
4. Write the brief in Orbyn Markdown (orbyn://spec/markdown): the question, a short answer, findings, disagreements, open questions and next steps; end every line that relies on a source with [src: its title], and name those lines (^finding1).
5. Apply it with ONE apply_plan call: create_doc (id brief; in the project if given), then save_source for each source (doc "$brief.id", lines naming the lines that use it), create_tasks for the next steps with dates, and link (related) to my earlier pages. Give it a summary and a client_ref.
6. Orbyn asks me once, only for what is on my ask-first list. Show me the brief's link, the sources kept, and the job id.`,
  },
  {
    name: "exam_prep",
    title: "Prepare for an exam",
    description:
      "Checks what an exam covers and how ready you are, fills gaps with practice-first cards, and books revision, applied in one step.",
    arguments: [
      {
        name: "exam",
        description: "The exam.",
        required: true,
        complete: "exam",
      },
      { name: "date", description: "Its date, if Orbyn doesn't know it." },
    ],
    needs: ["study"],
    learns: true,
    text: (a, learned) =>
      `Help me prepare for "${(a.exam ?? "").trim()}" in Orbyn. Do the thinking yourself: Orbyn only keeps what you send.${given(a.date, "Date")}${learnedLine(learned, "Write cards in that style; revision sessions follow my session length and study times on their own.")}

1. Call get_context, and follow any profile or standing rules on how I study.
2. Read where I stand with get_study: the exam, its pages, readiness, due cards and what I keep getting wrong.
3. Read the exam's pages with fetch. Find the topics with few or weak cards, and write practice-first cards for them: retrieval questions, cloze and "why" cards, each from the notes line it tests (doc:<id>#<anchor>). Never summaries.
4. Draft a short exam plan page: topics by weakness, past papers to do, and the days before the exam.
5. Apply it with ONE apply_plan call: update_study (exam: title, date, pages, target, plan: true to book revision sessions), update_study (cards, one step per page), create_doc (the exam plan), create_tasks (past papers and practice with dates). Give it a summary and a client_ref.
6. Orbyn asks me once, only for what is on my ask-first list. Then quiz me: the next card with get_study, the first question now.`,
  },
  {
    name: "meeting_to_actions",
    title: "Meeting to actions",
    description:
      "Turns a meeting's notes or transcript into a meeting note, dated tasks with owners and links, applied in one step.",
    arguments: [
      {
        name: "meeting",
        description: "The meeting (its event, or a title).",
        required: true,
        complete: "event",
      },
      {
        name: "project",
        description: "A project the actions belong to (optional).",
        complete: "project",
      },
    ],
    needs: [],
    text: (a) =>
      `Turn my meeting "${(a.meeting ?? "").trim()}" into notes and actions in Orbyn. Do the thinking yourself: Orbyn only keeps what you send.${given(a.project, "Project")}

1. Call get_context for my time zone and teams, and follow any standing rules.
2. Open the event with fetch (find it with search or get_calendar), and read the notes or transcript you have.
3. Write a meeting note in Orbyn Markdown (orbyn://spec/markdown): who came, decisions (a callout each), discussion, and a checklist of actions with an owner and a date, naming each action line (^a1).
4. Apply it with ONE apply_plan call: create_doc (kind meeting, event set, id note), create_tasks (id tasks; one per action with its date and project; a teammate's only as assignee), link (kind task_doc, from "$tasks.ids[0]" and so on, to "$note.id", block the action's line anchor, like a1). Give it a summary and a client_ref.
5. Orbyn asks me once, only for what is on my ask-first list (assigning a teammate notifies them, so it asks). Show me the note and tasks with links, and the job id.`,
  },
];

/** The prompts a connection is offered. */
export const promptsFor = (p: Principal) =>
  PROMPTS.filter((x) => x.needs.every((t) => p.toolsets.includes(t)));
