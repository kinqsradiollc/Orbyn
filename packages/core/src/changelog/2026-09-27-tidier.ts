import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-27-tidier",
  date: "2026-09-27",
  title: "A calmer, tidier Orbyn",
  summary:
    "Nothing new to learn: the same Orbyn, with steadier text, one icon per idea and quieter screens on the web and on phones.",
  sections: {
    better: [
      "Text comes in a few steady sizes across the web and phones, so every screen reads as one.",
      "Pages, projects, tasks, events, agendas and Study each have one icon, the same in the menu, search, links and Starred.",
      "Empty screens say one short sentence and offer at most two next steps.",
      "Each settings card starts with a bold lead-in and one sentence, so you can tell what it does at a glance.",
      "In a page, block handles and fold arrows only appear on the line you are on or pointing at, and lines stop at a comfortable reading width.",
      "Undo always appears in the same small message at the bottom of the screen, the calendar included.",
      "On phones, sheets and the task editor have a grab handle, buttons show when they are pressed, and tick boxes grow with your text size.",
      "A team's member list is calmer: add someone by email, then see their initials, name and role.",
    ],
    fixed: [
      "Buttons, switches and rows on phones are big enough to tap comfortably.",
      "A team's agent settings and the ⌘K hint fit on a phone screen.",
      "The calendar's empty card sits properly on phones.",
    ],
  },
});
