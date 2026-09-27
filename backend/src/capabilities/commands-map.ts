/**
 * Every command in Orbyn's command list (packages/core/src/commands.ts: ⌘K,
 * the shortcut sheet and the phone's "Search & do", settings included),
 * and what an agent does instead: the tool (with arguments of the shape it
 * takes) or, for what agents never do or that means nothing to them, the
 * reason. The command-list test (tests/commands-map.test.ts) checks every
 * command is here, every tool exists and every example parses, so a new
 * command fails CI until it is placed (H6b).
 */

/** A command an agent does with a tool: an example call. */
export type CommandTool = { tool: string; args: Record<string, unknown> };
/** A command agents don't do, and why. */
export type CommandReason = { reason: string };
export type CommandPlace = CommandTool | CommandReason;

// Example ids in calls (any id of the right shape).
const DOC = "doc:00000000-0000-4000-8000-000000000001";
const TEMPLATE = "page_template:00000000-0000-4000-8000-000000000003";
const CALENDAR = "00000000-0000-4000-8000-000000000004";
const ON = "2026-10-02T15:00:00+10:00";
const OFF = "2026-10-02T16:00:00+10:00";

const why = {
  hostedAi:
    "Orbyn's own assistant: the agent is the assistant here, and never spends the hosted one.",
  peopleOnly:
    "The Review inbox is the person's to decide; agents file changes into it (propose_changes, or asking) and read outcomes with fetch(proposal:…).",
  admin: "The admin console: people only.",
  screen:
    "How the app draws itself on a screen (a window, the sidebar, presenting, keys): nothing for an agent to do.",
  device:
    "A choice for this device's app (theme, reading mode, where it opens, the sidebar's order): the person's own view.",
  file: "A file to download; the agent reads the same page as Markdown with fetch.",
  signIn:
    "Signing in and how an account signs in (two-step, passkeys, devices): people only.",
  credentials:
    "Keys, webhooks, feeds, chat delivery, the Clipper and agent connections: an agent never mints access or sends data somewhere new.",
  account:
    "The account itself (name, email, consent, privacy, analytics, export everything, deleting it, email reminders, the email-to-task address): people only.",
  news: "Orbyn's release notes and service status, for people; agents read tool changes in the MCP catalog's changelog.",
  library:
    "Archiving a page is the person's arrangement of their library; agents file pages with organize and move them to Trash with propose_changes.",
  record:
    "Recording uses the device's microphone; agents transcribe themselves and send text (create_doc, append_doc).",
};

export const COMMAND_TOOLS: Record<string, CommandPlace> = {
  "go.overview": { tool: "get_today", args: {} },
  "go.agenda": {
    tool: "create_doc",
    args: { title: "Agenda", kind: "agenda" },
  },
  "go.my-tasks": { tool: "query", args: { over: "tasks" } },
  "go.calendar": { tool: "get_calendar", args: {} },
  "go.projects": { tool: "query", args: { over: "projects" } },
  "go.docs": { tool: "query", args: { over: "docs" } },
  "go.views": { tool: "search", args: { query: "views" } },
  "go.study": { tool: "get_study", args: {} },
  "go.lists": { tool: "search", args: { query: "lists" } },
  "go.ai-assistant": { reason: why.hostedAi },
  "go.teams": { tool: "get_context", args: {} },
  "go.booking": { tool: "get_bookings", args: {} },
  "go.notifications": { tool: "get_inbox", args: {} },
  "go.review": { reason: why.peopleOnly },
  "go.admin": { reason: why.admin },
  "go.settings": { tool: "get_context", args: {} },
  "new.task": {
    tool: "create_tasks",
    args: { tasks: [{ title: "Essay outline" }] },
  },
  "new.event": {
    tool: "create_tasks",
    args: {
      tasks: [{ title: "Tutorial", kind: "event", due_at: ON, end_at: OFF }],
    },
  },
  "new.page": {
    tool: "create_doc",
    args: { title: "Notes", markdown: "# Notes" },
  },
  "new.from-template": {
    tool: "create_doc",
    args: { title: "Lab 3", template: TEMPLATE },
  },
  "new.project": { tool: "create_project", args: { name: "Thesis" } },
  "new.import": {
    tool: "start_import",
    args: { file_name: "lecture.pdf", bytes: 120_000 },
  },
  "page.link": { tool: "fetch", args: { id: DOC } },
  "page.markdown": { tool: "fetch", args: { id: DOC } },
  "page.download-md": { tool: "fetch", args: { id: DOC } },
  "page.download-pdf": { reason: why.file },
  "page.read": { tool: "fetch", args: { id: DOC } },
  "page.history": { tool: "get_history", args: { of: DOC } },
  "page.template": {
    tool: "save_template",
    args: { kind: "page", from_page: DOC },
  },
  "page.ask": { reason: why.hostedAi },
  "page.present": { reason: why.screen },
  "page.window": { reason: why.screen },
  "page.star": {
    tool: "organize",
    args: { changes: [{ do: "star", kind: "doc", id: DOC }] },
  },
  // Where it's filed: fetch names its space and folder.
  "page.show-in-library": { tool: "fetch", args: { id: DOC } },
  "page.archive": { reason: why.library },
  "page.record": { reason: why.record },
  "plan.day": { tool: "plan_schedule", args: { days: 1 } },
  "plan.focus": { tool: "set_focus_timer", args: { action: "start" } },
  "plan.today": { tool: "get_calendar", args: { days: 1 } },
  "app.search": { tool: "search", args: { query: "essay" } },
  "app.shortcuts": { reason: why.screen },
  "app.sidebar": { reason: why.screen },
  "app.changes": { tool: "get_history", args: { of: "changes" } },
  "app.whats-new": { reason: why.news },
  "app.security": { reason: why.signIn },
  // Settings: "Settings: …" commands (NAV-10).
  "settings.account": { reason: why.account },
  "settings.theme": { reason: why.device },
  "settings.reading": { reason: why.device },
  "settings.start": { reason: why.device },
  "settings.sidebar": { reason: why.device },
  "settings.shortcuts": { reason: why.screen },
  "settings.clipper": { reason: why.credentials },
  "settings.email-reminders": { reason: why.account },
  "settings.two-step": { reason: why.signIn },
  "settings.passkeys": { reason: why.signIn },
  "settings.signed-in": { reason: why.signIn },
  "settings.status": { reason: why.news },
  "settings.whats-new": { reason: why.news },
  "settings.how-you-work": {
    tool: "update_planner_settings",
    args: { settings: { work_start: "09:00", work_end: "17:00" } },
  },
  "settings.frames": {
    tool: "manage_routines",
    args: {
      changes: [
        {
          do: "add",
          kind: "frame",
          fields: {
            name: "Deep work",
            days: [1, 3],
            start_time: "09:00",
            end_time: "11:00",
          },
        },
      ],
    },
  },
  "settings.places": {
    tool: "manage_routines",
    args: {
      changes: [
        {
          do: "add",
          kind: "place",
          fields: { label: "Campus", travel_minutes: 30 },
        },
      ],
    },
  },
  "settings.habits": {
    tool: "manage_routines",
    args: {
      changes: [
        {
          do: "add",
          kind: "habit",
          fields: {
            name: "Run",
            cadence: 3,
            period: "week",
            duration_minutes: 30,
          },
        },
      ],
    },
  },
  "settings.time": { tool: "get_work_patterns", args: {} },
  "settings.tags": {
    tool: "organize",
    args: { changes: [{ do: "create_tag", name: "biology" }] },
  },
  "settings.agents": { reason: why.credentials },
  "settings.api-keys": { reason: why.credentials },
  "settings.webhooks": { reason: why.credentials },
  "settings.calendar-feed": { reason: why.credentials },
  "settings.calendars": {
    tool: "update_planner_settings",
    args: { subscribe: { id: CALENDAR, refresh: true } },
  },
  "settings.email-to-task": { reason: why.account },
  "settings.chat": { reason: why.credentials },
  "settings.import": {
    tool: "import_tasks",
    args: { format: "csv", data: "title\nRead chapter 3", dry_run: true },
  },
  "settings.agreed": { reason: why.account },
  "settings.analytics": { reason: why.account },
  "settings.your-data": { reason: why.account },
  "settings.delete-account": { reason: why.account },
};
