/**
 * Searching with filters (SRCH-01): the chips under a search box (Pages,
 * Tasks, Projects; a project, a tag, a team; when it was changed) and the
 * few plain operators that set the same filters from the keyboard:
 *
 *   tag:physics   project:"Big launch"   team:lab   is:task   edited:week
 *
 * One reading for web and phone, so a search typed on either means the same
 * thing, and one sentence that says what it means ("Pages tagged physics
 * changed in the past week, matching “forces”"). Names are resolved to ids
 * by the caller, from the lists it already has.
 */

/** What a search can be narrowed to. */
export type SearchKind = "doc" | "task" | "project";

/** When things were last changed. */
export type SearchDate = "today" | "week" | "month";

export type SearchFilters = {
  /** The words left once the operators are taken out. */
  words: string;
  /** Only this kind of thing; null for everything. */
  type: SearchKind | null;
  /** A project's name, as typed or chosen. */
  project: string | null;
  /** A tag's name. */
  tag: string | null;
  /** A team's name, or "personal". */
  team: string | null;
  date: SearchDate | null;
};

export const EMPTY_SEARCH: SearchFilters = {
  words: "",
  type: null,
  project: null,
  tag: null,
  team: null,
  date: null,
};

/** The chips, in the order they show. */
export const SEARCH_KIND_CHIPS: { kind: SearchKind; label: string }[] = [
  { kind: "doc", label: "Pages" },
  { kind: "task", label: "Tasks" },
  { kind: "project", label: "Projects" },
];

export const SEARCH_DATE_CHIPS: { date: SearchDate; label: string }[] = [
  { date: "today", label: "Today" },
  { date: "week", label: "Past week" },
  { date: "month", label: "Past month" },
];

const KIND_WORDS: Record<string, SearchKind> = {
  doc: "doc",
  docs: "doc",
  page: "doc",
  pages: "doc",
  note: "doc",
  notes: "doc",
  task: "task",
  tasks: "task",
  project: "project",
  projects: "project",
};

const DATE_WORDS: Record<string, SearchDate> = {
  today: "today",
  day: "today",
  week: "week",
  month: "month",
};

/** `name:value` or `name:"a few words"`, at a word's start. */
const OPERATOR = /(^|\s)([a-z]+):(?:"([^"]*)"|(\S+))/gi;

/**
 * Read a search box's text into its filters. Operators it doesn't know
 * (`http://`, `10:30`) stay in the words, so nothing typed is lost.
 */
export function parseSearch(text: string): SearchFilters {
  const out: SearchFilters = { ...EMPTY_SEARCH };
  const words = String(text ?? "").replace(
    OPERATOR,
    (whole, lead: string, name: string, quoted?: string, bare?: string) => {
      const value = (quoted ?? bare ?? "").trim();
      const key = name.toLowerCase();
      if (!value) return whole;
      if (key === "tag") out.tag = value.replace(/^#/, "");
      else if (key === "project") out.project = value;
      else if (key === "team") out.team = value;
      else if (
        (key === "is" || key === "in") &&
        KIND_WORDS[value.toLowerCase()]
      )
        out.type = KIND_WORDS[value.toLowerCase()];
      else if (
        (key === "edited" || key === "changed") &&
        DATE_WORDS[value.toLowerCase()]
      )
        out.date = DATE_WORDS[value.toLowerCase()];
      else return whole;
      return lead;
    },
  );
  out.words = words.replace(/\s+/g, " ").trim();
  return out;
}

const quote = (value: string) => (/\s/.test(value) ? `"${value}"` : value);

/** Filters back into text with operators, as a person would type them. */
export function formatSearch(f: SearchFilters): string {
  const parts = [
    f.type ? `is:${f.type === "doc" ? "page" : f.type}` : "",
    f.project ? `project:${quote(f.project)}` : "",
    f.tag ? `tag:${quote(f.tag)}` : "",
    f.team ? `team:${quote(f.team)}` : "",
    f.date ? `edited:${f.date}` : "",
    f.words,
  ];
  return parts.filter(Boolean).join(" ");
}

/** Whether anything narrows the search besides its words. */
export const hasSearchFilters = (f: SearchFilters) =>
  !!(f.type || f.project || f.tag || f.team || f.date);

/** The start of the changes a date filter keeps, as an ISO instant. */
export function editedSince(date: SearchDate, now = new Date()): string {
  if (date === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  const days = date === "week" ? 7 : 30;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

const DATE_PHRASES: Record<SearchDate, string> = {
  today: "changed today",
  week: "changed in the past week",
  month: "changed in the past month",
};

/**
 * One plain sentence for a search: "Pages tagged physics in Lab, changed in
 * the past week, matching “forces”". Tags are on pages only, so a tag with
 * no kind chosen reads as pages.
 */
export function searchSummary(f: SearchFilters): string {
  const type = f.type ?? (f.tag ? "doc" : null);
  const subject =
    type === "doc"
      ? "Pages"
      : type === "task"
        ? "Tasks"
        : type === "project"
          ? "Projects"
          : "Pages, tasks and projects";
  const parts: string[] = [subject];
  if (f.tag) parts.push(`tagged ${f.tag}`);
  if (f.project && type !== "project")
    parts.push(`in the project ${f.project}`);
  if (f.team)
    parts.push(
      f.team.toLowerCase() === "personal"
        ? "in your personal space"
        : `in the team ${f.team}`,
    );
  let sentence = parts.join(" ");
  const more: string[] = [];
  if (f.date) more.push(DATE_PHRASES[f.date]);
  if (f.words) more.push(`matching “${f.words}”`);
  if (more.length)
    sentence += (parts.length > 1 ? ", " : " ") + more.join(", ");
  return sentence;
}

/**
 * Something with a name, as the lists a client already holds have them, to
 * turn a typed name into an id.
 */
export type Named = { id: string; name: string };

/**
 * The one whose name matches, ignoring case: an exact match first, then the
 * only one that starts with it. Null when none (or several) fit.
 */
export function findNamed<T extends Named>(
  list: readonly T[],
  name: string | null,
): T | null {
  if (!name) return null;
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = list.find((x) => x.name.trim().toLowerCase() === want);
  if (exact) return exact;
  const starts = list.filter((x) =>
    x.name.trim().toLowerCase().startsWith(want),
  );
  return starts.length === 1 ? starts[0] : null;
}
