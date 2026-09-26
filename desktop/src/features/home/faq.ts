import { DATA_ANSWER } from "@orbyn/core";

/**
 * The questions the homepage answers. One list feeds both the page and the
 * FAQPage structured data written into index.html at build time, so what a
 * search engine is told is always exactly what a visitor can read.
 *
 * Every answer here has to stay true of the product. When a feature changes,
 * change its answer.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Orbyn?",
    a: "A planner that keeps your tasks, calendar, projects and notes in one place, and plans your time around them. It works on the web, on desktop, and on iOS and Android, all connected to the same planner.",
  },
  {
    q: "Who can see my plans?",
    a: "Personal tasks, events and pages stay personal. Anything you share with a team is visible to that team, with roles that decide who can change it, and teammates can see when you are busy without seeing what you are doing. When you ask the assistant something, your request and the items it needs are sent to the AI provider that answers it — the app tells you so beside the assistant.",
  },
  {
    q: "Will the AI change my plans on its own?",
    a: "No. The assistant suggests; you decide. Every change it proposes — a new task, a moved event, a whole project, an edit to a page — waits for you to review and approve it.",
  },
  {
    q: "How does automatic planning work?",
    a: "You tell Orbyn when you like to work and how long things take. It finds room for your tasks between your meetings, inside the focus hours you set aside, in an order that respects what has to happen first. You see the plan before anything lands on your calendar.",
  },
  {
    q: "Does it work with my existing calendar?",
    a: "Yes. Subscribe to any iCal link to see those events alongside your own, publish your Orbyn calendar as a feed, or see your events in Apple Calendar, Thunderbird or DAVx5 over CalDAV.",
  },
  {
    q: "Can I use Orbyn with a team?",
    a: "Yes. Share tasks, events and pages with a team, with roles that decide who can see and change what. See when people are free without seeing their private events, and share a booking page so others can find a time with you.",
  },
  // The one plain answer on data handling (OTH-03), shared with Security.
  DATA_ANSWER,
  {
    q: "Can I take my data with me?",
    a: "Any time. Export everything as a .zip: every page as Markdown in its folders, plus your projects, folders and tasks. You can also download any page as PDF, Word, Markdown, HTML or plain text.",
  },
];
