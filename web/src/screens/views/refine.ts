import {
  type Item,
  type Priority,
  type Status,
  type ViewChoice,
  type ViewRow,
  type ViewDefinition,
  type TaskSize,
} from "@orbyn/core";
import { sizeOf } from "../shared-task";

/**
 * Existing account pins remain a private overlay until explicit promotion.
 * The shared runner evaluates them before its caps; CSV by saved ID continues
 * to export the unchanged saved definition.
 */
export type Refine = {
  priority: Priority | "";
  size: string;
  status: Status | "";
};

export const NO_REFINE: Refine = { priority: "", size: "", status: "" };

export const refinePlace = (viewId: string) => `view:${viewId}`;

export const readRefine = (choice?: ViewChoice): Refine => {
  const pick = (prefix: string) =>
    choice?.pins?.find((p) => p.startsWith(prefix))?.slice(prefix.length) ?? "";
  return {
    priority: ["high", "medium", "low"].includes(pick("p:"))
      ? (pick("p:") as Refine["priority"])
      : "",
    size: ["quick", "short", "long", "none"].includes(pick("z:"))
      ? pick("z:")
      : "",
    status: ["todo", "in_progress", "blocked", "done", "cancelled"].includes(
      pick("s:"),
    )
      ? (pick("s:") as Refine["status"])
      : "",
  };
};

export const writeRefine = (refine: Refine): ViewChoice | null => {
  const pins = [
    refine.priority && `p:${refine.priority}`,
    refine.size && `z:${refine.size}`,
    refine.status && `s:${refine.status}`,
  ].filter((p): p is string => !!p);
  return pins.length ? { pins } : null;
};

export const hasRefine = (refine: Refine) =>
  !!(refine.priority || refine.size || refine.status);

export const refineRows = (rows: ViewRow[], refine: Refine) =>
  hasRefine(refine)
    ? rows.filter((row) => {
        if (row.kind !== "task") return true;
        if (refine.status && row.status !== refine.status) return false;
        if (refine.priority && row.priority !== refine.priority) return false;
        if (
          refine.size &&
          !(row.item && sizeOf(row.item as Item) === refine.size)
        )
          return false;
        return true;
      })
    : rows;

/** A private overlay is evaluated on the server before either row cap; never persisted implicitly. */
export function refineDefinition(
  def: ViewDefinition,
  refine: Refine,
): ViewDefinition {
  if (def.source !== "tasks") return def;
  return {
    ...def,
    filters: {
      ...def.filters,
      ...(refine.priority ? { priority: refine.priority } : {}),
      ...(refine.size ? { size: refine.size as TaskSize } : {}),
      ...(refine.status ? { status: "any", task_status: refine.status } : {}),
    },
  };
}
