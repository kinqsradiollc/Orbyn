import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-24-learns",
  date: "2026-09-24",
  title: "A planner that learns from you",
  summary:
    "Orbyn plans with how you really work, reads more kinds of pages, and fits phone screens better.",
  highlight:
    "Orbyn learns how long your tasks really take, your best hours and your usual day, and plans with them.",
  sections: {
    new: [
      "Orbyn learns how long your tasks really take, your best hours and your usual day, and plans with them.",
      "Up next shows what to do now.",
      "Imported PDFs keep their columns, tables and maths, and scanned pages are read too.",
      "A better Study home and flashcard view.",
    ],
    better: [
      "Every field is the same size, with room at the edges, and errors are in plain words.",
      "The web on phones: nothing wider than the screen, the Overview in one column, and tables shown as cards.",
      "Short blocks on the calendar fit their box.",
      "On phones, the whole card opens a page or project, and the buttons are tidier.",
    ],
    fixed: [
      "The assistant's conversation scrolls again, and its tables fit the column.",
      "Screens on phones no longer stay blank after fading in.",
      "Dropdowns are no longer cut off at the edge of a card.",
    ],
  },
});
