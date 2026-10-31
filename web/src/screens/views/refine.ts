import {
  type Item,
  type Priority,
  type Status,
  type ViewChoice,
  type ViewRow,
} from "@orbyn/core";
import { sizeOf } from "../shared-task";

/**
 * What a saved definition can't hold: one priority, one size, one exact
 * status. They are kept in the account's view choices beside the view, and
 * applied here to the rows the server returns, so they follow this person and
 * not the view's other viewers, and they don't reach the CSV export.
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
    priority: pick("p:") as Refine["priority"],
    size: pick("z:"),
    status: pick("s:") as Refine["status"],
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
