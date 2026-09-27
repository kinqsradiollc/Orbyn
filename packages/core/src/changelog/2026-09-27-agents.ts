import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-27-agents",
  date: "2026-09-27",
  title: "AI agents that can get things done",
  summary:
    "The AI agents you connect, such as Claude, ChatGPT, Codex and Cursor, can now make changes as well as read, and anything bigger waits for you.",
  highlight:
    "A connected agent can add tasks, plan sessions and write pages for you. Bigger changes wait in Review until you accept them, and you can undo what an agent did.",
  sections: {
    new: [
      "Connected agents can add, update and finish tasks, tick checklist lines, plan and move sessions, write and edit pages, link things together and start projects.",
      "Bigger changes, and anything that reaches other people, wait in Review until you accept or decline them.",
      "Undo something an agent did from its activity list.",
      "Agents can reach the rest of Orbyn too: Study, routines, follow-through, teams, booking and files. You choose which parts when you connect one, and can change it later in Settings.",
      "An agent can follow a task, page or project and hear when it changes, and long jobs such as big plans or imports report their progress as they go.",
      "One-click setup for Cursor, VS Code, Goose and LM Studio in Settings → Connected agents, and ready-made plugins for Claude Code, Codex and Gemini CLI.",
      "A public page for developers lists every tool an agent can use, what changed, and how long an old tool keeps working.",
    ],
    better: [
      "Page history shows which agent made a change.",
      "An agent's edit to a team page arrives as a suggestion for the team to take or leave.",
      "Changes an agent is waiting on are cancelled when you disconnect it, leave the team, or the team turns agents off.",
    ],
    fixed: ["Agents no longer see pages that are in the Trash."],
  },
});
