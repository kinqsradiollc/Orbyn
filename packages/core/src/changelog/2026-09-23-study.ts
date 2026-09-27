import { defineRelease } from "./release.js";

export default defineRelease({
  id: "2026-09-23-study",
  date: "2026-09-23",
  title: "Study, imports and follow-through",
  summary:
    "Turn your notes into flashcards, bring in PDFs and Word files, and see whether your plans are really holding.",
  highlight:
    "Study: write Question :: Answer in any page and Orbyn makes flashcards, reviews them with you, and plans revision around your exams.",
  sections: {
    new: [
      "Study: flashcards from your pages, spaced review, and revision planned around your exams.",
      "Import PDFs, Word files and photos into Docs as pages.",
      "Follow-through: see how much of your plan really got done, try a change before you make it, and catch up on what happened while you were away.",
      "Track promises and decisions, and see which decisions no task delivers yet.",
      "Focus sessions that you can hand over from one device to another.",
      "Calendars you subscribe to show up everywhere in Orbyn, and the assistant plans around them.",
      "The agenda follows your own time zone, and past agendas live in the library.",
      "Turn a project into scheduled tasks that wait on one another.",
      "Folders and sorting in the document library.",
      "Changes reach your other devices as they happen.",
    ],
    better: [
      "Orbyn's own dropdowns, date pickers and checkboxes, the same on every browser.",
      "The sidebar folds to a thin rail, and the Docs library can hide for a full-width page.",
      "The phone's workspaces, chat, planning and calendar are redesigned.",
      "Terms and privacy are clear at sign-up and in the apps.",
    ],
    fixed: [
      "You stay signed in instead of being signed out unexpectedly.",
      "An abandoned import no longer blocks new ones.",
    ],
  },
});
