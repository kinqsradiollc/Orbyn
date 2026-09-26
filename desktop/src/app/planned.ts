import { createContext, useContext } from "react";
import type { PlannedFeed, PlannedTask, TodayList } from "@orbyn/core";

/**
 * Your planned time next to your tasks: the planned feed (`GET /planned`,
 * for "Planned 9:15" and status chips on task rows, the Today filter and
 * "Tasks to place") and the Today list (`GET /today`, for the Overview's
 * Today card). Both are for this device's day.
 */
export type PlannedData = {
  feed: PlannedFeed | null;
  /** The feed's tasks by id. */
  byItem: Map<string, PlannedTask>;
  today: TodayList | null;
  /** The first load has finished (so null means the server has none). */
  ready: boolean;
  /** Load both again now. */
  reload: () => Promise<void>;
};

const empty: PlannedData = {
  feed: null,
  byItem: new Map(),
  today: null,
  ready: false,
  reload: async () => undefined,
};

export const PlannedContext = createContext<PlannedData>(empty);

/** Planned time and the Today list from the nearest provider. */
export const usePlanned = () => useContext(PlannedContext);
