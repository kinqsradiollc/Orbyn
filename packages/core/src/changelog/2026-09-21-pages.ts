import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-21-pages",
  date: "2026-09-21",
  title: "Pages that work together",
  summary:
    "Pages became a place to work with other people: comment on the words, suggest changes, go back in time, and ask the assistant.",
  highlight:
    "Comments sit beside the words they are about, and Suggesting mode lets you propose a change for someone else to take or leave.",
  sections: {
    new: [
      "Comments anchored to the words they are about, on the web and on phones.",
      "Suggesting mode: propose a change for someone else to take or leave.",
      "Page history: see and restore an earlier version.",
      "Read a page without an editor in the way.",
      "Notes kept beside the work they are about.",
      "Block tools and a / menu, and new pages that start blank.",
      "Search inside what you wrote, not only the titles, and find a page by what it means.",
      "Ask the assistant about a page, with sources; it can also draft notes that you choose to keep.",
      "Export a page as Markdown, Word, PDF or a web page.",
      "Write pages on your phone, with comments and live co-editing.",
      "On phones: folders and stars, meeting notes, a team's time, and moving a task between stages or skipping one occurrence.",
    ],
    better: [
      "Settings fold into short sections, remembered between visits.",
      "Our own dropdowns and dialogs replace the browser's.",
      "Buttons share one height everywhere.",
    ],
    fixed: [
      "The phone's offline copy no longer overwrites newer data from the server.",
    ],
  },
});
