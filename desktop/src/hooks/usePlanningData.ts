import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PlannerPrefs,
  PlannerPrefsInput,
  Tag,
  TaskList,
} from "@orbyn/core";
import { client } from "../lib/api";
import type { Planning } from "../app/planning";

/**
 * Loads lists, tags and planner preferences for the signed-in user, and again
 * after every planner refresh (`revision`), so views that show them stay fresh.
 */
export function usePlanningData(
  token: string,
  revision: number,
  report: (e: unknown) => void,
): Planning {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [prefs, setPrefs] = useState<PlannerPrefs | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!token) return;
    const mine = ++seq.current;
    const [l, t, p] = await Promise.all([
      client.listLists(),
      client.listTags(),
      client.getPlannerPrefs(),
    ]);
    if (mine !== seq.current) return;
    setLists(l);
    setTags(t);
    setPrefs(p);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLists([]);
      setTags([]);
      setPrefs(null);
      return;
    }
    reload().catch((e) => reportRef.current(e));
  }, [token, reload, revision]);

  const savePrefs = useCallback(async (input: PlannerPrefsInput) => {
    const next = await client.updatePlannerPrefs(input);
    setPrefs(next);
    return next;
  }, []);

  return useMemo(
    () => ({
      lists,
      tags,
      prefs,
      listById: new Map(lists.map((l) => [l.id, l])),
      tagById: new Map(tags.map((t) => [t.id, t])),
      reload,
      savePrefs,
    }),
    [lists, tags, prefs, reload, savePrefs],
  );
}
