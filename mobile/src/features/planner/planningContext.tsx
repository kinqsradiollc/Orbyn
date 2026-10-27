import React, { createContext, useContext, useMemo } from "react";
import type { PlannedFeed, Tag, TaskList, TodayList } from "@orbyn/core";
import { PlannedProvider } from "./plannedContext";

type Planning = {
  lists: TaskList[];
  tags: Tag[];
  listById: Map<string, TaskList>;
  tagById: Map<string, Tag>;
  /** Reload lists and tags after one is created, renamed or deleted. */
  reload: () => Promise<void>;
};

const PlanningContext = createContext<Planning>({
  lists: [],
  tags: [],
  listById: new Map(),
  tagById: new Map(),
  reload: async () => {},
});

/**
 * Lists and tags for rows, the editor and filters, and planned time (see
 * `PlannedProvider`). The value only changes when the lists or tags
 * themselves change, so rows don't re-render on polls.
 */
export function PlanningProvider({
  lists,
  tags,
  reload,
  planned = null,
  today = null,
  children,
}: {
  lists: TaskList[];
  tags: Tag[];
  reload: () => Promise<void>;
  /** Planned time by task, for this day. */
  planned?: PlannedFeed | null;
  /** The Today list, for this day. */
  today?: TodayList | null;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      lists,
      tags,
      listById: new Map(lists.map((l) => [l.id, l])),
      tagById: new Map(tags.map((t) => [t.id, t])),
      reload,
    }),
    [lists, tags, reload],
  );
  return (
    <PlanningContext.Provider value={value}>
      <PlannedProvider feed={planned} today={today}>
        {children}
      </PlannedProvider>
    </PlanningContext.Provider>
  );
}

export const usePlanning = () => useContext(PlanningContext);
