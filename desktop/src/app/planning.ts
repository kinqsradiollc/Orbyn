import { createContext, useContext } from "react";
import type {
  PlannerPrefs,
  PlannerPrefsInput,
  Tag,
  TaskList,
} from "@orbyn/core";

/** Lists, tags and planner preferences, shared by every signed-in view. */
export type Planning = {
  lists: TaskList[];
  tags: Tag[];
  /** Null until the first load. */
  prefs: PlannerPrefs | null;
  listById: Map<string, TaskList>;
  tagById: Map<string, Tag>;
  /** Reload lists, tags and preferences. */
  reload: () => Promise<void>;
  /** Save some preferences; resolves with the saved set. */
  savePrefs: (input: PlannerPrefsInput) => Promise<PlannerPrefs>;
};

const empty: Planning = {
  lists: [],
  tags: [],
  prefs: null,
  listById: new Map(),
  tagById: new Map(),
  reload: async () => undefined,
  savePrefs: async () => {
    throw new Error("Not signed in");
  },
};

export const PlanningContext = createContext<Planning>(empty);

/** Lists, tags and preferences from the nearest provider. */
export const usePlanning = () => useContext(PlanningContext);
