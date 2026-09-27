import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-26-pages",
  date: "2026-09-26",
  title: "Richer pages and saved views",
  summary:
    "Pages can hold much more, from tables and pictures to live task lists, and saved views let you see your work the way you want.",
  highlight:
    "Saved views: a named filter, sort and layout over tasks, pages or projects, as a list, board, table, calendar or gallery.",
  sections: {
    new: [
      "Saved views: a named filter, sort and layout over tasks, pages or projects, as a list, board, table, calendar or gallery. Pin the ones you use to the sidebar.",
      "Your own fields on pages and projects, and date fields on the calendar.",
      "Board columns by any field, with folding groups and totals.",
      "Drag tasks onto pages, folders and calendar days.",
      "An Info panel beside each page with its links, contents and versions.",
      "Pictures and files in pages, kept in Orbyn's own file store, with a full-screen viewer.",
      "Tables, callouts, footnotes, highlights, diagrams and coloured code in pages.",
      "Live task lists and live embeds inside a page.",
      "Link to one heading or line of a page, and see hover cards on links.",
      "Fold headings, move a section to a new page, or merge one page into another.",
      "Give a page other names, and see where it is mentioned without a link.",
    ],
    better: [
      "Web on phones: nothing wider than the screen, and the project view strip stays inside it.",
      "The command list is one list everywhere, with recent and pinned commands first.",
      "Copy a page as Markdown or rich text that pastes well into other apps.",
    ],
    fixed: [
      "A page's pictures follow their lines when a section moves to a new page.",
      "Big tables are split instead of cut when imported.",
      "A page only links pictures and files its writer can see, and leaving a team unlinks its files.",
    ],
  },
});
