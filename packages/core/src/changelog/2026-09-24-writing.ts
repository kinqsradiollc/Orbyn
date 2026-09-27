import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-24-writing",
  date: "2026-09-24",
  title: "Pages that are nicer to write in",
  summary:
    "Writing in Orbyn feels like a proper editor, deleted pages can come back, and AI agents can read your plans with keys you control.",
  sections: {
    new: [
      "Nested and numbered lists, a bar for the words you select, keyboard shortcuts, and a / menu for anything you can add.",
      "Paste from Google Docs, Word or the web and keep the headings, lists, checklists and links.",
      "The Trash keeps deleted pages for 30 days, and Undo brings one back at once.",
      "Show changes: see what changed on a page, and bring back a single line.",
      "The agenda by day, page templates, and tags on pages.",
      "A note for each class of a repeating event, so each week's lecture keeps its own notes.",
      "Export everything in your account in one go.",
      "Connect AI agents such as Claude Code, Codex and Cursor to read your tasks, calendar, pages and projects, with keys that say which spaces they see and when they expire. Find them under Connected agents.",
    ],
    better: [
      "Personal API keys can no longer manage your account: two-step sign-in, passkeys, other keys, exports or deleting it.",
    ],
    fixed: [
      "New task, then Enter, keeps the new line.",
      "Study leaves out anything in the Trash.",
    ],
  },
});
