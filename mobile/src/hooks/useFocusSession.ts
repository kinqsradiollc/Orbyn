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
import { onLive } from "../lib/live";
import { deviceId, deviceLabel } from "../lib/device";
import { readLocal, saveLocal } from "../lib/localPrefs";

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
    let alive = true;
    client.getPlannerPrefs().then(
      (p) => {
        if (!alive || chosen.current) return;
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
      (s) => setToday(s.work_minutes),
      () => {},
    );
  }, []);
  useEffect(refreshToday, [refreshToday]);

  const record = useCallback(
    async (s: FocusState, completed: boolean, at: number) => {
      const { rhythm: r, item: task, canWrite: can } = latest.current;
      const ran = Math.min(focusRan(s, at), 12 * 3_600_000);
      if (ran < 60_000 || !can) return;
      try {
        const kept = await client.saveFocusSession({
          id: newId(),
          item_id: s.phase === "work" ? task.id : null,
          kind: s.phase,
          started_at: new Date(at - ran).toISOString(),
          ended_at: new Date(at).toISOString(),
          planned_minutes: phaseMinutes(r, s.phase),
          minutes: Math.round(ran / 60_000),
          completed,
        });
        if (kept.item) latest.current.onLogged(kept.item);
        refreshToday();
      } catch (e) {
        latest.current.onError((e as Error).message);
      }
    },
    [refreshToday],
  );

  const update = useCallback((next: FocusState) => {
    setState(next);
    const { rhythm: r, item: task } = latest.current;
    // One reminder at a time: the one for the phase now running.
    const old = reminder.current;
    reminder.current = null;
    if (old)
      void Notifications.cancelScheduledNotificationAsync(old).catch(() => {});
    if (next.ends_at)
      void remindAt(next, r, task.title).then((id) => {
        reminder.current = id;
      });
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
      if (!s.ends_at || focusRemaining(s, at) > 0) return;
      void record(s, true, Date.parse(s.ends_at));
      // The reminder for this phase has fired (or is firing): let it be.
      reminder.current = null;
      update(advanceFocus(latest.current.rhythm, s, at));
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
    let alive = true;
    client.currentFocus().then(
      (c) => {
        if (!alive || !c || c.state.item_id !== latest.current.item.id) return;
        const r = focusRhythm(c.state.rhythm);
        if (!r || !r.work) return;
        chosen.current = true;
        setRhythm(r);
        // This phone's own session, after stepping away: carry on where it
        // is. The server already holds it, so it isn't shared again.
        if (c.device_id === deviceId()) {
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
        if (news.kind !== "focus" || news.by === deviceId()) return;
        const s = latest.current.state;
        if (!s.ends_at) return;
        void client.currentFocus().then(
          (c) => {
            if (!c || c.device_id === deviceId() || !c.device_id) return;
            const at = Date.now();
            void record(s, false, at);
            setState(freshFocus(latest.current.rhythm, s.item_id));
            setMovedTo(c.device ?? "another device");
          },
          () => {},
        );
      }),
    [record],
  );

  const start = () => update(startFocus(state, Date.now()));
  const pause = () => update(pauseFocus(state, Date.now()));
  const skip = () => {
    const at = Date.now();
    void record(state, false, at);
    update(advanceFocus(rhythm, state, at));
  };
  const chooseRhythm = (next: FocusRhythm) => {
    chosen.current = true;
    saveLocal(RHYTHM_KEY, next.id);
    setRhythm(next);
    setState(freshFocus(next, item.id));
  };

  /** Leaving: keep the work so far, cancel the reminder, stop sharing. */
  const finish = useCallback(async () => {
    const s = latest.current.state;
    const old = reminder.current;
    reminder.current = null;
    if (old)
      await Notifications.cancelScheduledNotificationAsync(old).catch(() => {});
    if (latest.current.rhythm.work > 0 && s.phase === "work")
      await record(s, false, Date.now());
    // Only this device's own session: never one picked up elsewhere.
    const current = await client.currentFocus().catch(() => null);
    if (!current || !current.device_id || current.device_id === deviceId())
      await client.clearCurrentFocus().catch(() => {});
  }, [record]);

  return {
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
