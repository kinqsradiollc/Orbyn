import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-26-connected",
  date: "2026-09-26",
  title: "Sign in with Orbyn, and one command list",
  summary:
    "Connecting an AI agent is now a sign-in you control, and finding or doing anything starts from one list.",
  sections: {
    new: [
      "Sign in with Orbyn: connect an AI agent by signing in, then choose what it can do, which spaces it sees and for how long.",
      "Team owners decide whether outside agents can use their team, and see which ones do.",
      "One command list and a quick switcher: jump to any page, task or project, or run a command, from ⌘K.",
      "Search filters, and Copy link on pages, tasks, projects and views.",
      "A Security and data page that says plainly how your data is kept.",
      "On phones: a toolbar above the keyboard, one + for everything you can create, and a slimmer page header.",
      "Share into Orbyn from other apps, and share pages and projects out.",
      "Press and hold the app icon for quick actions.",
    ],
    fixed: [
      "Shared page and project links open on the web.",
      "Undo covers a page's title too.",
    ],
  },
});
