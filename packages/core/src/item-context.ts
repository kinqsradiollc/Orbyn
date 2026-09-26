import type { DocBlock, DocKind } from "./docs.js";
import type { ProjectStatus } from "./projects.js";

/**
 * What a task hangs off and what hangs off it, for its panel: the project
 * it's filed in, the page line it was made from, and the other pages about
 * it. Pages the reader can't open are never in it, so a task moved into a
 * team never shows its author's own notes to the rest of the team.
 */
export type ItemContext = {
  /** The project the task is filed in, and its stage there; null when none. */
  project: {
    id: string;
    name: string;
    team_id: string | null;
    status: ProjectStatus;
    /** The project's latest date, if it has one. */
    deadline: string | null;
    stage_id: string | null;
    stage_name: string | null;
  } | null;
  /**
   * The page line the task was made from (the first one tied to it). The
   * line itself may have been taken out of the page since, when `quote` is
   * null and the page opens at the top.
   */
  came_from: {
    doc_id: string;
    title: string;
    kind: DocKind;
    block_id: string;
    /** The line's words as they now read, shortened. */
    quote: string | null;
    /** A checklist line, and whether it reads ticked. */
    todo: boolean;
    done: boolean;
  } | null;
  /**
   * Other pages that point at the task, newest first: pages about it (made
   * with "New page about this task", or an event's meeting note) and pages
   * with a line tied to it. The page it came from isn't repeated here.
   */
  pages: ItemContextPage[];
};

export type ItemContextPage = {
  id: string;
  title: string;
  kind: DocKind;
  team_id: string | null;
  updated_at: string;
  /** A line on the page tied to the task, when that's how it points at it. */
  block_id: string | null;
};

/** How long a quoted line may be before it's cut short. */
export const QUOTE_LENGTH = 160;

/** A line's words for quoting under "Came from", cut at a word. */
export function quoteOf(block: DocBlock | undefined): string | null {
  if (!block || !("text" in block)) return null;
  const text = block.text.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= QUOTE_LENGTH) return text;
  const cut = text.slice(0, QUOTE_LENGTH);
  const space = cut.lastIndexOf(" ");
  return (space > QUOTE_LENGTH / 2 ? cut.slice(0, space) : cut) + "…";
}

/** Where a task sits in its project: "Website relaunch › Draft". */
export const projectPlace = (p: {
  name: string;
  stage_name?: string | null;
}) => (p.stage_name ? `${p.name} › ${p.stage_name}` : p.name);

/**
 * A new page about a task ("New page about this task"): a note in the
 * task's own space, hanging off the task and filed in its project, named
 * after it so it's easy to find again.
 */
export const pageAboutTask = (item: {
  id: string;
  title: string;
  team_id?: string | null;
  project_id?: string | null;
}) => ({
  title: item.title.slice(0, 200),
  kind: "note" as const,
  item_id: item.id,
  team_id: item.team_id ?? null,
  project_id: item.project_id ?? null,
  content: [{ type: "paragraph" as const, text: "" }],
});
