import { z } from "zod";
import { CapabilityError, type Annotations } from "./registry.js";
import { parseRef } from "./refs.js";

/** Pieces the capability files share: filters, schemas, annotations. */

/** Every read tool: read-only, safe to repeat, nothing outside Orbyn. */
export const READ: Annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const cursorInput = z
  .string()
  .max(120)
  .optional()
  .describe("next_cursor from the previous page of the same call.");

/** A project given as its id, typed id, link or URI. */
export const projectInput = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .optional()
  .describe("A project: project:<id>, its id or its link.");

/** "personal", or a team id. */
export const teamInput = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .optional()
  .describe('"personal", or a team id from get_context.');

/** The project id in a filter, or undefined; INVALID when it isn't one. */
export function projectId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const ref = parseRef(value);
  if (ref.type === "project" || ref.type === "any") return ref.id;
  throw new CapabilityError(
    "INVALID",
    "project must be a project id, like project:<id>.",
    "Use an id from search or query.",
  );
}

/** A doc id in a filter (doc:<id>, a link or an id). */
export function docId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const ref = parseRef(value);
  if (ref.type === "doc" || ref.type === "any") return ref.id;
  throw new CapabilityError(
    "INVALID",
    "doc must be a page id, like doc:<id>.",
    "Use an id from search.",
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A team filter: "personal" (null), a team id, or undefined for every
 * space. An id outside the connection's spaces is simply not found.
 */
export function teamFilter(
  value: string | undefined,
): { personal: true } | { team: string } | undefined {
  if (value === undefined) return undefined;
  if (value.toLowerCase() === "personal") return { personal: true };
  if (UUID.test(value)) return { team: value.toLowerCase() };
  throw new CapabilityError(
    "INVALID",
    'team must be "personal" or a team id.',
    "Team ids are listed by get_context.",
  );
}

/** A plain uuid, or INVALID naming the field. */
export function uuidOf(value: string, field: string): string {
  const ref = parseRef(value);
  if (ref.type !== "title") return ref.id;
  throw new CapabilityError("INVALID", `${field} must be an id.`);
}

/** Minutes as "1 h 30 min". */
export const minutesText = (m: number) => {
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return h ? (rest ? `${h} h ${rest} min` : `${h} h`) : `${rest} min`;
};

/** The team's name for display, or "Personal". */
export const spaceName = (
  teamId: string | null,
  teams: { id: string; name: string }[],
) =>
  teamId === null
    ? "Personal"
    : (teams.find((t) => t.id === teamId)?.name ?? "a team");
