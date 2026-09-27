import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-26-planning",
  date: "2026-09-26",
  title: "Plans that fit before the deadline",
  summary:
    "Orbyn is clearer about what is planned, what is due and whether it still fits, and projects gather everything in one place.",
  highlight:
    "Today shows what's planned and what's due in one list, and every task tells you whether it still fits before its deadline.",
  sections: {
    new: [
      "Today shows what's planned and what's due in one list under Up next, and your tasks have a Today filter.",
      "Each task says whether it still fits before its deadline, and Orbyn offers to move sessions that land too late.",
      "Tasks to place lists the work that has no time yet, and Plan it to the deadline finds that time for you.",
      "Task rows show when they are planned, like “Planned 9:15”.",
      "Link tasks, projects and pages to one another; a project's Home gathers its deadlines, milestones, files and links.",
      "A short check-in after each session: how it went and what is left.",
      "Session reminders, with Start right in the reminder.",
      "@mention people in a page, and see where you were mentioned.",
      "Save a project's assistant chats to come back to later.",
      "Keep a project out of the assistant entirely.",
      "Keep the original file of anything you import.",
      "The assistant shows the sources behind its answers.",
    ],
    better: [
      "Only time before a deadline counts as planned.",
      "Sessions say what they are for, like “Session 2 of 3”.",
      "“Due” always means the deadline, everywhere a task shows a date.",
      "Search by meaning is easier to switch on.",
    ],
    fixed: [
      "Ticking a line in a page finishes its task once, and the page follows the task.",
      "Planning again no longer piles up late sessions for a task at risk.",
      "Short plans no longer set off a false “at risk” warning.",
    ],
  },
});
