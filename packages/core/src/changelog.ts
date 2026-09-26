/**
 * What's new (DSN-03): each release with its date and three headings, New,
 * Better and No longer broken, one plain sentence per item. The public
 * /changelog page and the apps' "What's new" sheet both read this list, so
 * the two never disagree. Newest first; add a release at the top.
 */

export type ChangelogRelease = {
  /** The day it shipped ("2026-09-27"): its name, and how it is sorted. */
  date: string;
  /** A few words for the release as a whole. */
  title: string;
  new: string[];
  better: string[];
  fixed: string[];
};

export const CHANGELOG_HEADINGS = {
  new: "New",
  better: "Better",
  fixed: "No longer broken",
} as const;

export const CHANGELOG: ChangelogRelease[] = [
  {
    date: "2026-09-27",
    title: "Reading and working on phones",
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
    ],
    better: [
      "Sheets on phones have a grab handle and close with a swipe down; menus are equal-height rows.",
      "Long-press a task, page or project on a phone for its menu.",
      "The header and tabs step aside while you read a long page on a phone.",
      "Text follows your phone's text size.",
      "Link and / suggestions on phones appear under the line you are writing.",
    ],
    fixed: [],
  },
  {
    date: "2026-09-26",
    title: "Richer pages and saved views",
    new: [
      "Saved views: a named filter, sort and layout over tasks, pages or projects, as a list, board, table, calendar or gallery.",
      "Your own fields on pages and projects, and date fields on the calendar.",
      "Pictures and files in pages, kept in Orbyn's own file store, with a full-screen viewer.",
      "Tables, callouts, footnotes, highlights, diagrams and coloured code in pages.",
      "Link to one heading or line of a page, and see hover cards on links.",
      "Plan this project, with sessions only before each deadline counting as planned.",
    ],
    better: [
      "Web on phones: nothing wider than the screen, and the project view strip stays inside it.",
      "The command list is one list everywhere, with recent and pinned commands first.",
    ],
    fixed: [
      "A page's pictures follow their lines when a section moves to a new page.",
      "Big tables are split instead of cut when imported.",
    ],
  },
  {
    date: "2026-09-21",
    title: "Pages that work together",
    new: [
      "Comments anchored to the words they are about, on the web and on phones.",
      "Suggesting mode: propose a change for someone else to take or leave.",
      "Page history: see and restore an earlier version.",
      "Export a page as Markdown, Word, PDF or a web page.",
      "Ask the assistant about a page, with sources.",
    ],
    better: [
      "Settings fold into short sections, remembered between visits.",
      "Our own dropdowns and dialogs replace the browser's.",
    ],
    fixed: [
      "The phone's offline copy no longer overwrites newer data from the server.",
    ],
  },
];

/** The newest release. */
export const latestRelease = () => CHANGELOG[0];

/**
 * Whether "What's new" should open by itself: there is a release newer than
 * the one this person last saw. Someone who has never seen one (a new
 * account) is not shown it; the first run is enough on day one.
 */
export function hasUnseenRelease(lastSeen: string | null | undefined) {
  if (!lastSeen) return false;
  return CHANGELOG.some((r) => r.date > lastSeen);
}

/** "27 September 2026". */
export const releaseDate = (r: ChangelogRelease) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${r.date}T12:00:00Z`));
