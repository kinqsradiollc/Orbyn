import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PlannerPrefs,
  PlannerPrefsInput,
  Tag,
  TaskList,
} from "@orbyn/core";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import type { Planning } from "../../app/planning";

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
  const owner = useRef(token);
  owner.current = token;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current++;
    };
  }, []);
  const current = useCallback(
    () => mounted.current && owner.current === token && session.get() === token,
    [token],
  );

  const reload = useCallback(async () => {
    if (!token || !current()) return;
    const mine = ++seq.current;
    const [l, t, p] = await Promise.all([
      client.listLists(),
      client.listTags(),
      client.getPlannerPrefs(),
    ]);
    if (mine !== seq.current || !current()) return;
    setLists(l);
    setTags(t);
    setPrefs(p);
  }, [token, current]);

  useEffect(() => {
    if (!token) {
      setLists([]);
      setTags([]);
      setPrefs(null);
      return;
    }
    reload().catch((e) => {
      if (current()) reportRef.current(e);
    });
  }, [token, reload, revision, current]);

  const savePrefs = useCallback(
    async (input: PlannerPrefsInput) => {
      if (!current()) throw new Error("Account changed. Reopen settings.");
      const mine = ++seq.current;
      const next = await client.updatePlannerPrefs(input);
      if (current() && mine === seq.current) setPrefs(next);
      return next;
    },
    [current],
  );

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
