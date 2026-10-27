import React, { createContext, useContext, useMemo } from "react";
import type { PlannedFeed, PlannedTask, TodayList } from "@orbyn/core";

type Planned = {
  feed: PlannedFeed | null;
  /** The feed's tasks by id. */
  byItem: Map<string, PlannedTask>;
  /** The Today list (GET /today), for this day. */
  today: TodayList | null;
};

const PlannedContext = createContext<Planned>({
  feed: null,
  byItem: new Map(),
  today: null,
});

/**
 * Your planned time next to your tasks, for rows ("Planned 9:15", status
 * chips), the Today filter, "Tasks to place" and the Today list. The value
 * changes only when the data does, so rows don't re-render on every poll.
 */
export function PlannedProvider({
  feed,
  today,
  children,
}: {
  feed: PlannedFeed | null;
  today: TodayList | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      feed,
      byItem: new Map((feed?.tasks ?? []).map((t) => [t.item_id, t])),
      today,
    }),
    [feed, today],
  );
  return (
    <PlannedContext.Provider value={value}>{children}</PlannedContext.Provider>
  );
}

export const usePlanned = () => useContext(PlannedContext);
