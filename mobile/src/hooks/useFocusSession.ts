import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  advanceFocus,
  focusPhaseLabel,
  focusRan,
  focusRemaining,
  focusRhythm,
  focusThen,
  freshFocus,
  newId,
  OPEN_TIMER,
  pauseFocus,
  phaseMinutes,
  rhythmForBreakLevel,
  startFocus,
  type FocusRhythm,
  type FocusState,
  type Item,
  type ItemDetail,
} from "@orbyn/core";
import { client } from "../lib/api";
import { session } from "../lib/session";
import {
  endFocusActivity,
  startFocusActivity,
} from "../../modules/orbyn-capture";
import { onLive } from "../lib/live";
import { deviceId, deviceLabel } from "../lib/device";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { errorText } from "../lib/errors";

const RHYTHM_KEY = "orbyn-focus-rhythm";

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Ask the phone to tell the person when this phase ends, even with the app
 * closed. Returns the notification's id, or null where it can't (the web
 * build, or notifications turned off).
 */
async function remindAt(s: FocusState, rhythm: FocusRhythm, title: string) {
  if (Platform.OS === "web" || !s.ends_at) return null;
  try {
    const permission = await Notifications.getPermissionsAsync();
    const granted =
      permission.status === "granted" ||
      (permission.canAskAgain &&
        (await Notifications.requestPermissionsAsync()).status === "granted");
    if (!granted) return null;
    const next = advanceFocus(rhythm, s, Date.parse(s.ends_at));
    return await Notifications.scheduleNotificationAsync({
      content:
        s.phase === "work"
          ? {
              title: "Time for a break",
              body: `${phaseMinutes(rhythm, next.phase)} minutes. ${title} will be here.`,
            }
          : {
              title: "Break's over",
              body: `Ready for ${focusPhaseLabel(rhythm, next).toLowerCase()}?`,
            },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(s.ends_at),
      },
    });
  } catch {
    return null;
  }
}

type Options = {
  item: Item;
  canWrite: boolean;
  onLogged: (detail: ItemDetail) => void;
  onError: (message: string) => void;
};

/**
 * Work sessions and breaks for focus, the same rhythm as on the web. Time is
 * kept as instants, so the phase still ends on time after the phone slept;
 * the phone is asked to say so even when the app is closed. Every phase that
 * ends is kept, and work minutes are logged to the task.
 */
export function useFocusSession({
  item,
  canWrite,
  onLogged,
  onError,
}: Options) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const owns = () => mounted.current && session.token === owner;
  const changeSequence = useRef(0);
  const finishing = useRef(false);
  const recording = useRef(false);
  const [saving, setSaving] = useState(false);
  const [pendingLog, setPendingLog] = useState(false);
  const failed = useRef(false);
  const logRequests = useRef(
    new Map<
      string,
      {
        input: Parameters<typeof client.saveFocusSession>[0];
        state: FocusState;
        completed: boolean;
        at: number;
      }
    >(),
  );
  const logged = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const saved = focusRhythm(readLocal(RHYTHM_KEY));
  const [rhythm, setRhythm] = useState<FocusRhythm>(
    () => saved ?? rhythmForBreakLevel("normal"),
  );
  const chosen = useRef(!!saved);
  const [state, setState] = useState<FocusState>(() =>
    freshFocus(rhythm, item.id),
  );
  const [now, setNow] = useState(() => Date.now());
  const [today, setToday] = useState<number | null>(null);
  /** The session went on elsewhere: where, to say so here. */
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const reminder = useRef<string | null>(null);
  const latest = useRef({ state, rhythm, item, canWrite, onLogged, onError });
  latest.current = { state, rhythm, item, canWrite, onLogged, onError };

  // Before a choice, the rhythm follows the breaks asked of the planner.
  useEffect(() => {
    if (chosen.current) return;
    const sequence = changeSequence.current;
    let alive = true;
    client.getPlannerPrefs().then(
      (p) => {
        if (
          !alive ||
          !owns() ||
          chosen.current ||
          sequence !== changeSequence.current
        )
          return;
        const next = rhythmForBreakLevel(p.break_level);
        setRhythm(next);
        setState((s) =>
          s.ends_at || s.ran_ms || s.round > 1
            ? s
            : freshFocus(next, s.item_id),
        );
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, []);

  const refreshToday = useCallback(() => {
    client.focusSummary(startOfToday(), new Date(Date.now() + 60_000)).then(
      (s) => {
        if (owns()) setToday(s.work_minutes);
      },
      () => {},
    );
  }, []);
  useEffect(refreshToday, [refreshToday]);

  const record = useCallback(
    async (s: FocusState, completed: boolean, at: number): Promise<boolean> => {
      if (!owns()) return false;
      const key = JSON.stringify(s);
      if (logged.current.has(key)) return true;
      const { rhythm: r, item: task, canWrite: can } = latest.current;
      const ran = Math.min(focusRan(s, at), 12 * 3_600_000);
      if (!can) return false;
      if (ran < 60_000) return true;
      const entry = logRequests.current.get(key) ?? {
        state: s,
        completed,
        at,
        input: {
          id: newId(),
          item_id: s.phase === "work" ? task.id : null,
          kind: s.phase,
          started_at: new Date(at - ran).toISOString(),
          ended_at: new Date(at).toISOString(),
          planned_minutes: phaseMinutes(r, s.phase),
          minutes: Math.round(ran / 60_000),
          completed,
        },
      };
      logRequests.current.set(key, entry);
      if (recording.current) {
        failed.current = true;
        setPendingLog(true);
        return false;
      }
      recording.current = true;
      setSaving(true);
      try {
        const kept = await client.saveFocusSession(entry.input);
        if (!owns()) return false;
        logRequests.current.delete(key);
        logged.current.add(key);
        failed.current = logRequests.current.size > 0;
        setPendingLog(failed.current);
        if (kept.item) latest.current.onLogged(kept.item);
        refreshToday();
        return true;
      } catch (e) {
        if (owns()) {
          failed.current = true;
          setPendingLog(true);
          latest.current.onError(errorText(e));
        }
        return false;
      } finally {
        recording.current = false;
        if (owns()) setSaving(false);
      }
    },
    [refreshToday],
  );
  const retryLogging = async () => {
    if (!owns() || recording.current || finishing.current) return;
    for (const entry of [...logRequests.current.values()]) {
      if (!(await record(entry.state, entry.completed, entry.at))) return;
    }
  };

  const update = useCallback((next: FocusState) => {
    if (!owns() || !latest.current.canWrite) return;
    changeSequence.current++;
    latest.current.state = next;
    setState(next);
    const { rhythm: r, item: task } = latest.current;
    // One reminder at a time: the one for the phase now running.
    const old = reminder.current;
    reminder.current = null;
    if (old)
      void Notifications.cancelScheduledNotificationAsync(old).catch(() => {});
    if (next.ends_at)
      void remindAt(next, r, task.title).then((id) => {
        if (owns() && latest.current.state.ends_at === next.ends_at)
          reminder.current = id;
        else if (id)
          void Notifications.cancelScheduledNotificationAsync(id).catch(
            () => {},
          );
      });
    // The session on the Lock Screen and in the Dynamic Island (CAP-05).
    if (next.ends_at)
      startFocusActivity(
        next.phase === "work" ? task.title : "Break",
        new Date(next.ends_at),
      );
    else endFocusActivity();
    void client
      .setCurrentFocus(
        { ...next, item_title: task.title.slice(0, 200) },
        deviceLabel(),
        deviceId(),
      )
      .catch(() => {});
  }, []);

  const intervals = rhythm.work > 0;
  const running = state.ends_at !== null;

  useEffect(() => {
    if (!running || !intervals) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      const s = latest.current.state;
      if (
        !owns() ||
        finishing.current ||
        recording.current ||
        failed.current ||
        !s.ends_at ||
        focusRemaining(s, at) > 0
      )
        return;
      void record(s, true, Date.parse(s.ends_at)).then((ok) => {
        if (!ok || !owns() || latest.current.state !== s) return;
        reminder.current = null;
        update(advanceFocus(latest.current.rhythm, s, Date.now()));
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [running, intervals, record, update]);

  // Picking up a session running on another device: the time left carries
  // over, and from here on only what runs here is logged here.
  useEffect(() => {
    const sequence = changeSequence.current;
    let alive = true;
    client.currentFocus().then(
      (c) => {
        if (
          sequence !== changeSequence.current ||
          !alive ||
          !owns() ||
          !latest.current.canWrite ||
          !c ||
          c.state.item_id !== latest.current.item.id
        )
          return;
        const r = focusRhythm(c.state.rhythm);
        if (!r || !r.work) return;
        chosen.current = true;
        latest.current.rhythm = r;
        setRhythm(r);
        // This phone's own session, after stepping away: carry on where it
        // is. The server already holds it, so it isn't shared again.
        if (c.device_id === deviceId()) {
          changeSequence.current++;
          latest.current.state = c.state;
          setState(c.state);
          return;
        }
        const at = Date.now();
        update({
          ...c.state,
          ran_ms: 0,
          run_started_at: c.state.ends_at ? new Date(at).toISOString() : null,
        });
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [update]);

  // Handing over: another device picked this session up, so this one logs
  // what it ran and stops, rather than both counting the same time.
  useEffect(
    () =>
      onLive((news) => {
        if (
          !owns() ||
          !latest.current.canWrite ||
          news.kind !== "focus" ||
          news.by === deviceId()
        )
          return;
        const s = latest.current.state;
        if (!s.ends_at) return;
        void client.currentFocus().then(
          (c) => {
            if (
              !owns() ||
              latest.current.state !== s ||
              !c ||
              c.device_id === deviceId() ||
              !c.device_id
            )
              return;
            const at = Date.now();
            void record(s, false, at);
            changeSequence.current++;
            latest.current.state = freshFocus(latest.current.rhythm, s.item_id);
            setState(latest.current.state);
            const old = reminder.current;
            reminder.current = null;
            if (old)
              void Notifications.cancelScheduledNotificationAsync(old).catch(
                () => {},
              );
            endFocusActivity();
            setMovedTo(c.device ?? "another device");
          },
          () => {},
        );
      }),
    [record],
  );

  const start = () => {
    if (!recording.current && !failed.current && !finishing.current)
      update(startFocus(latest.current.state, Date.now()));
  };
  const pause = () => {
    if (!recording.current && !failed.current && !finishing.current)
      update(pauseFocus(latest.current.state, Date.now()));
  };
  const skip = () => {
    const at = Date.now();
    if (recording.current || failed.current || finishing.current) return;
    const currentState = latest.current.state;
    void record(currentState, false, at).then((ok) => {
      if (ok && owns() && latest.current.state === currentState)
        update(advanceFocus(latest.current.rhythm, currentState, Date.now()));
    });
  };
  const chooseRhythm = (next: FocusRhythm) => {
    if (
      !owns() ||
      !latest.current.canWrite ||
      recording.current ||
      failed.current ||
      finishing.current ||
      latest.current.state.ends_at
    )
      return;
    changeSequence.current++;
    chosen.current = true;
    saveLocal(RHYTHM_KEY, next.id);
    latest.current.rhythm = next;
    latest.current.state = freshFocus(next, item.id);
    setRhythm(next);
    setState(latest.current.state);
  };

  /** Leaving: keep the work so far, cancel the reminder, stop sharing. */
  const finish = useCallback(async (): Promise<boolean> => {
    if (!owns() || finishing.current || recording.current) return false;
    if (!latest.current.canWrite) return true;
    finishing.current = true;
    try {
      const s = latest.current.state;
      if (
        latest.current.rhythm.work > 0 &&
        s.phase === "work" &&
        !(await record(s, false, Date.now()))
      )
        return false;
      if (!owns() || logRequests.current.size) return false;
      const current = await client.currentFocus();
      if (!owns()) return false;
      if (!current || !current.device_id || current.device_id === deviceId())
        await client.clearCurrentFocus();
      if (!owns()) return false;
      const old = reminder.current;
      reminder.current = null;
      if (old)
        await Notifications.cancelScheduledNotificationAsync(old).catch(
          () => {},
        );
      if (!owns()) return false;
      latest.current.state = freshFocus(latest.current.rhythm, s.item_id);
      setState(latest.current.state);
      endFocusActivity();
      return true;
    } catch (e) {
      if (owns()) latest.current.onError(errorText(e));
      return false;
    } finally {
      finishing.current = false;
    }
  }, [record]);

  return {
    saving,
    hasUnfinishedLog: () => recording.current || logRequests.current.size > 0,
    pendingLog,
    retryLogging,
    rhythm: intervals ? rhythm : OPEN_TIMER,
    chooseRhythm,
    intervals,
    state,
    running,
    remaining: focusRemaining(state, now),
    total: phaseMinutes(rhythm, state.phase) * 60_000,
    label: intervals ? focusPhaseLabel(rhythm, state) : "",
    then: intervals ? focusThen(rhythm, state) : "",
    today,
    movedTo,
    start,
    pause,
    skip,
    finish,
    refreshToday,
  };
}
