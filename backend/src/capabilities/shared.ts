import type { ReviewAction, ReviewChangeInput } from "@orbyn/core";
import {
  Params,
  scopeFor,
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../lib/visibility.js";
import { cleanTitle } from "./format.js";
import { docId, projectId } from "./common.js";
import { appUrl, parseRef, refs, type RefType } from "./refs.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";
import type { DoneEntry } from "./write.js";

/**
 * What the toolset capabilities (workspace, planner, study, follow-through,
 * teams, bookings, files) share: finding a page, task or project the
 * connection can see without locking it (reads run read-only), the answer
 * line for one thing, and a change filed for review through its service.
 */

export const notReachable = () =>
  new CapabilityError(
    "NOT_FOUND",
    "Nothing with that id is reachable from this connection.",
    "Search for it and use an id from the results.",
  );

/** A page the connection can see (no lock). */
export async function seeDoc(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{
      id: string;
      title: string;
      team_id: string | null;
      user_id: string;
      version: number;
      project_id: string | null;
      imported: boolean;
    }>(
      `SELECT d.id, d.title, d.team_id, d.user_id, d.version, d.project_id,
              d.imported_from IS NOT NULL AS imported
         FROM docs d WHERE d.id = ${params.add(docId(input))}
          AND ${visibleDocs("d", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notReachable();
  return row;
}

/** A task or event the connection can see (no lock). */
export async function seeItem(ctx: CapabilityContext, input: string) {
  const ref = parseRef(input);
  if (ref.type !== "task" && ref.type !== "event" && ref.type !== "any")
    throw new CapabilityError(
      "INVALID",
      "That isn't a task or event id.",
      "Use a task:<id> or event:<id> from search, query or fetch.",
    );
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{
      id: string;
      title: string;
      kind: string;
      status: string;
      team_id: string | null;
      user_id: string;
      version: number;
      project_id: string | null;
    }>(
      `SELECT i.id, i.title, i.kind, i.status, i.team_id, i.user_id, i.version, i.project_id
         FROM items i WHERE i.id = ${params.add(ref.id)} AND ${visibleItems("i", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notReachable();
  return row;
}

/** A project the connection can see (no lock). */
export async function seeProject(ctx: CapabilityContext, input: string) {
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const row = (
    await ctx.db.query<{
      id: string;
      name: string;
      team_id: string | null;
      user_id: string;
      status: string;
      updated_at: Date;
    }>(
      `SELECT p.id, p.name, p.team_id, p.user_id, p.status, p.updated_at
         FROM projects p WHERE p.id = ${params.add(projectId(input))}
          AND ${visibleProjects("p", scope)}`,
      params.values,
    )
  ).rows[0];
  if (!row) throw notReachable();
  return row;
}

/** One thing a change made or changed, as the answers list it. */
export function entryOf(
  type: RefType | "list" | "tag" | "folder" | "frame" | "habit" | "place",
  id: string,
  title: string,
  version: number | null,
  change: string,
  projectId?: string | null,
): DoneEntry {
  const typed = [
    "task",
    "event",
    "doc",
    "project",
    "record",
    "template",
    "view",
    "proposal",
    "import",
  ].includes(type);
  const r = typed
    ? refs({ type: type as RefType, id }, projectId)
    : { id: `${type}:${id}`, url: `${appUrl()}/app` };
  return {
    id: r.id,
    title: cleanTitle(title) || "Untitled",
    url: r.url,
    version,
    change,
  };
}

/** A change for the Review inbox, applied through its own service. */
export function actionChange(c: {
  action: ReviewAction;
  target_id: string | null;
  title: string;
  team_id: string | null;
  headline: string;
  rows?: { label: string; before: string | null; after: string | null }[];
  emails?: string[];
  input: Record<string, unknown>;
  version?: number | null;
}): ReviewChangeInput {
  return {
    type: "action",
    action: c.action,
    target_id: c.target_id,
    title: c.title.slice(0, 300),
    team_id: c.team_id,
    headline: c.headline.slice(0, 300),
    rows: (c.rows ?? []).slice(0, 60).map((r) => ({
      label: r.label.slice(0, 60),
      before: r.before?.slice(0, 2000) ?? null,
      after: r.after?.slice(0, 2000) ?? null,
    })),
    emails: c.emails ?? [],
    input: c.input,
    version: c.version ?? null,
  };
}

/** A quoted title for review headlines. */
export const quoted = (t: string) => `“${cleanTitle(t) || "Untitled"}”`;
