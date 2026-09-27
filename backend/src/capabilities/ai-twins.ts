/**
 * No built-in AI on the agent path (Agent 2, H9). Every route that runs
 * Orbyn's own assistant stays EXCLUDED for agents (reason hosted_ai); an
 * agent does the same job with its own model through these tools and
 * prompts, which only read, store, schedule and link what the agent wrote.
 * tests/agent-no-ai.test.ts fails when a hosted_ai route has no twin here,
 * or a twin names a tool or prompt that doesn't exist.
 */

export type AiTwin = {
  /** The tools that do it through the agent ("every": all toolsets). */
  tools: string[] | "every";
  /** Prompts that walk an agent through it, when there are any. */
  prompts?: string[];
  /** What the hosted route does, and how the agent does it instead. */
  how: string;
};

/** Orbyn's assistant chat: an agent is a chat with every tool. */
const CHAT: AiTwin = {
  tools: "every",
  how: "The assistant chat: an outside agent is that chat, with every toolset.",
};

/** Saved assistant chats: what an agent did is kept as its activity. */
const SAVED: AiTwin = {
  tools: ["list_agent_changes", "get_history"],
  how: "Saved chats: an agent's work is kept as its activity (list_agent_changes) and each thing's history.",
};

/** Every hosted_ai route in exclusions.ts, with its agent-path twin. */
export const AI_TWINS: Record<string, AiTwin> = {
  "POST /ai/chat": CHAT,
  "POST /ai/chat/start": CHAT,
  "GET /ai/chat/:id": CHAT,
  "GET /ai/capabilities": {
    tools: ["get_context"],
    how: "What the assistant can do here: tools/list and get_context say what this connection may do.",
  },
  "GET /ai/chats/:id": SAVED,
  "PUT /ai/chats/:id": SAVED,
  "DELETE /ai/chats/:id": SAVED,
  "GET /ai/projects/:id/chats": {
    tools: ["get_project", "find_passages", "get_history"],
    prompts: ["ask_project"],
    how: "Asking a project: the agent reads the hub and the passages that answer, and writes the cited answer itself.",
  },
  "POST /ai/project": {
    tools: ["create_project", "apply_plan", "plan_schedule"],
    prompts: ["project_kickoff"],
    how: "Drafting a project: the agent writes stages and tasks and makes them in one apply_plan, then plans sessions.",
  },
  "POST /ai/agenda/today": {
    tools: ["get_today", "create_doc"],
    how: "The agenda's summary: the agent reads the day and writes the agenda page (create_doc kind agenda) and its own words.",
  },
  "POST /docs/:id/assist": {
    tools: ["fetch", "edit_doc"],
    how: "Page assist: the agent reads the page and edits it itself.",
  },
  "POST /docs/:id/ask": {
    tools: ["fetch", "find_passages"],
    how: "Asking a page: the agent reads it (or its passages) and answers with citations.",
  },
  "POST /ai/study/pages/:id/cards": {
    tools: ["update_study"],
    prompts: ["lecture_to_notes", "exam_prep"],
    how: "Cards from a page: the agent writes the cards (update_study cards), each linked to its line.",
  },
  "POST /ai/study/grade": {
    tools: ["get_study", "update_study"],
    prompts: ["study_session"],
    how: "Grading an answer: get_study explain gives the notes and card answers; the agent judges and records it.",
  },
  "POST /ai/study/cards/:id/explain": {
    tools: ["get_study"],
    how: "Explaining a card: get_study card gives its answer and source line; the agent explains.",
  },
  "POST /ai/assist": {
    tools: ["create_doc", "create_tasks", "update_study"],
    how: "Capture chips (a page, tasks or cards from a capture): the agent writes them itself.",
  },
  "POST /ai/recordings/:id/summary": {
    tools: ["create_doc", "append_doc"],
    prompts: ["lecture_to_notes", "meeting_to_actions"],
    how: "Transcribing and summarising a recording: the agent transcribes and sends the text (append_doc for long ones).",
  },
};

/**
 * Hosted AI features that aren't routes of their own (they ride on routes
 * agents already have), and their twins.
 */
export const AI_FEATURE_TWINS: Record<string, AiTwin> = {
  "Search by meaning (GET /search with semantic search on)": {
    tools: ["search", "find_passages"],
    how: "Agents search by words and titles; the agent's own model does the meaning.",
  },
  "The assistant's session change suggestions (Review inbox session changes)": {
    tools: ["reschedule_sessions", "schedule_sessions"],
    how: "The agent moves or adds sessions itself (plan_schedule previews).",
  },
};
