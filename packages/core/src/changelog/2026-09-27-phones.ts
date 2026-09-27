import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-27-phones",
  date: "2026-09-27",
  title: "Reading and working on phones",
  summary:
    "Your phone becomes a good place to read and keep up: pages open for reading, work offline, and everything is a search away.",
  sections: {
    new: [
      "Pages open for reading on phones; double-tap a line to edit it. On the web, Read hides the editing handles (⌘⇧R).",
      "Maths is typeset on phones, fractions, roots and all.",
      "The last 20 pages you opened work offline on your phone, and edits made offline are merged when you are back.",
      "Recent changes shows who changed which team page or task, grouped by day, with your own changes hidden.",
      "Search & do on phones finds pages, tasks and projects and runs the same commands as ⌘K on the web.",
      "Open a page, task or project in a side peek beside the one you are in (⌘-click a link, or ⌘Enter in ⌘K).",
      "Search Settings by name, on the web, on phones and from ⌘K.",
      "A short first run for new accounts: Study, Team or Personal, a calendar if you like, and a starter project.",
      "Publish a page or a folder to the web, with an optional password; it is off until you turn it on.",
      "Import Markdown, a Notion export, or tasks from Todoist and TickTick, with a dry run first.",
      "Summarise, pull out deadlines or make flashcards when you share, import or scan, as suggestions you accept.",
      "What's new tells you what changed since you last looked, on the web and on phones.",
    ],
    better: [
      "Sheets on phones have a grab handle and close with a swipe down; menus are equal-height rows.",
      "Long-press a task, page or project on a phone for its menu.",
      "The header and tabs step aside while you read a long page on a phone.",
      "Text follows your phone's text size.",
      "Link and / suggestions on phones appear under the line you are writing.",
    ],
    fixed: [
      "Dates in imported Todoist, TickTick and Notion tasks, and deadlines the assistant finds, are read in your own time zone; anything unclear is pointed out in the dry run.",
      "A page that clashed with another save goes through on the next try.",
      "Pages kept offline are let go when they are deleted, moved to the Trash or belong to a team you left.",
    ],
  },
});
