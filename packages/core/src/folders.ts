/**
 * Folders and favourites: the two light ways to tidy a workspace. Folders are
 * flat — one level is enough to group documents without becoming a filing
 * cabinet — and favourites pin the few things someone keeps coming back to.
 */

/**
 * What can be starred (NAV-07): pages, projects, saved views, tasks, and one
 * heading or line of a page (a `heading` star is the page's id plus the
 * line's `block_id`).
 */
export const FAVOURITE_KINDS = [
  "doc",
  "project",
  "view",
  "task",
  "heading",
] as const;
export type FavouriteKind = (typeof FAVOURITE_KINDS)[number];

export type Folder = {
  id: string;
  user_id: string;
  team_id: string | null;
  name: string;
  position: number;
  created_at: string;
  /** How many documents are filed here. */
  doc_count: number;
  /** When it was archived (SRCH-03): its pages leave lists and search. */
  archived_at?: string | null;
};

export type Favourite = {
  kind: FavouriteKind;
  target_id: string;
  /** The line of a page a `heading` star points at; '' for anything else. */
  block_id?: string;
  created_at: string;
};

/** Quick lookup for "is this starred?" without scanning a list each render. */
export const favouriteKey = (kind: FavouriteKind, id: string, blockId = "") =>
  blockId ? `${kind}:${id}#${blockId}` : `${kind}:${id}`;

export const favouriteSet = (favourites: Favourite[]) =>
  new Set(
    favourites.map((f) => favouriteKey(f.kind, f.target_id, f.block_id ?? "")),
  );

/**
 * A star with what it points at, for the Starred group (GET /starred): the
 * live title, and for a heading the page it is on. Things the reader can no
 * longer open are left out.
 */
export type StarredItem = {
  kind: FavouriteKind;
  id: string;
  block_id: string;
  title: string;
  /** Where it is: the page a heading is on, a task's project, a view's source. */
  hint: string | null;
  /** A task that is finished, or a project that is done or archived. */
  closed: boolean;
  created_at: string;
};

/** Stars in the order the Starred group lists them: the newest first. */
export const STARRED_KIND_LABELS: Record<FavouriteKind, string> = {
  doc: "Page",
  project: "Project",
  view: "View",
  task: "Task",
  heading: "Heading",
};
