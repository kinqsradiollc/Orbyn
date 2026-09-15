import React, { createContext, useContext, useMemo } from "react";
import type { Tag, TaskList } from "@orbyn/core";

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
 * Lists and tags for rows, the editor and filters. The value only changes
 * when the lists or tags themselves change, so rows don't re-render on polls.
 */
export function PlanningProvider({
  lists,
  tags,
  reload,
  children,
}: {
  lists: TaskList[];
  tags: Tag[];
  reload: () => Promise<void>;
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
      {children}
    </PlanningContext.Provider>
  );
}

export const usePlanning = () => useContext(PlanningContext);
