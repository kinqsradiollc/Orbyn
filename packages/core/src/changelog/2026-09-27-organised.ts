import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-27-organised",
  date: "2026-09-27",
  title: "Stars, archive and the Orbyn Clipper",
  summary:
    "Keep what matters in reach, put old pages away without deleting them, and save things from the web in one click.",
  highlight:
    "Star a page, a heading, a task, a project or a saved view, and find it again in Starred on the web and on your phone.",
  sections: {
    new: [
      "Star pages, headings, tasks, projects and saved views, and find them in a Starred list; with nothing typed, ⌘K shows your starred things first.",
      "Archive pages and folders: they leave the library, search and pickers, and wait in Archived until you want them back.",
      "Pick several pages at once to move, tag or archive them, with a searchable Move to… and Show in library.",
      "Present a page as slides.",
      "Open a page in a window of its own, in the browser and in the desktop app.",
      "Record audio into a page and get a summary and a list of action items.",
      "The Orbyn Clipper browser extension saves articles, papers, assignments, read-later links and highlights into Orbyn, and shows you what it will save first. Highlights can become quotes or study cards.",
      "The Connections map in a page's or a project's Info shows what it is linked to, one or two steps out.",
      "Arrange the sidebar, change keyboard shortcuts and choose what opens when you start, in Settings.",
      "Team owners can turn publishing, the assistant and booking on or off for their team.",
      "In the desktop app, open Markdown, Word and PDF files straight into Orbyn.",
      "On an iPad or a wide window, a task opens beside your task list and a page beside the library.",
    ],
    better: [
      "Lines that start in a right-to-left language read right to left.",
      "Your task and calendar view choices follow your account to every device.",
      "Pull down on a page or on the library on your phone to open Search & do.",
      "Security and data gives a plain answer on how your data is handled.",
      "The library can sort newest first.",
    ],
    fixed: [
      "A link to a page, task or project someone can't open now shows to them as Private page, Private task or Private project instead of its title: in pages, exports, history, comments, search, the assistant and published pages.",
    ],
  },
});
