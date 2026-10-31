import {
  advanceFocus,
  focusPhaseLabel,
  focusRan,
  focusRemaining,
  focusRhythm,
  focusThen,
  freshFocus,
  OPEN_TIMER,
  pauseFocus,
  phaseMinutes,
  rhythmForBreakLevel,
  startFocus,
  type BreakLevel,
  type FocusRhythm,
  type FocusState,
  type Item,
  type ItemDetail,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { onNews } from "./useWorkspace";

const RHYTHM_KEY = "orbyn-focus-rhythm";
const DEVICE_KEY = "orbyn-device-id";

const stored = () => {
  try {
    return localStorage.getItem(RHYTHM_KEY);
  } catch {
    return null;
  }
};

let cachedDevice: string | null = null;
export function deviceId() {
  if (cachedDevice) return cachedDevice;
  let id: string | null = null;
  try {
    id = localStorage.getItem(DEVICE_KEY);
  } catch {
    id = null;
  }
  if (!id) {
    id = `d-${crypto.randomUUID()}`;
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      // Private windows: a new id per visit is fine.
    }
  }
  cachedDevice = id;
  return id;
}

const deviceLabel = () => "Web browser";

function chime() {
  try {
    const context = new AudioContext();
    [660, 880].forEach((hz, n) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = hz;
      const at = context.currentTime + n * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(context.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
    setTimeout(() => void context.close(), 1500);
  } catch {
    // No sound is fine.
  }
}

function tell(title: string, body: string) {
  chime();
  try {
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(title, { body, tag: "orbyn-focus", silent: true });
  } catch {
    // Notifications are a nicety.
  }
}

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

type SavePayload = Parameters<typeof client.saveFocusSession>[0];

/**
 * Work sessions and breaks. The rhythm comes from what the person chose last,
 * or the breaks they asked the planner for. Every phase that ends is kept, its
 * work minutes logged to the task, and the running phase is shared with their
 * other devices, so a session can be picked up elsewhere and handed back.
 */
export function useFocusTimer({
  item,
  canWrite,
  breakLevel,
  onLogged,
  onError,
}: {
  item: Item;
  canWrite: boolean;
  breakLevel?: BreakLevel;
  onLogged: (detail: ItemDetail) => void;
  onError: (error: unknown) => void;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const recording = useRef<Promise<void> | null>(null);
  const sharing = useRef<Promise<void>>(Promise.resolve());
  const records = useRef(
    new Map<string, { payload: SavePayload; saved: boolean }>(),
  );
  const failed = useRef(false);
  const retryAction = useRef<(() => void) | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [rhythm, setRhythm] = useState<FocusRhythm>(
    () => focusRhythm(stored()) ?? rhythmForBreakLevel(breakLevel),
  );
  const [state, setState] = useState<FocusState>(() =>
    freshFocus(rhythm, item.id),
  );
  const [now, setNow] = useState(() => Date.now());
  const [today, setToday] = useState<number | null>(null);
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const latest = useRef({ state, rhythm, item, canWrite, onLogged, onError });
  latest.current = { state, rhythm, item, canWrite, onLogged, onError };

  const intervals = rhythm.work > 0;
  const running = state.ends_at !== null;

  const refreshToday = useCallback(() => {
    client.focusSummary(startOfToday(), new Date(Date.now() + 60_000)).then(
      (s) => {
        if (alive.current) setToday(s.work_minutes);
      },
      () => undefined,
    );
  }, []);
  useEffect(refreshToday, [refreshToday]);

  /** Keep a phase that ran; work minutes go to the task. */
  const record = useCallback(
    async (s: FocusState, completed: boolean, at: number) => {
      const { rhythm: r, item: task, canWrite: can } = latest.current;
      const ran = Math.min(focusRan(s, at), 12 * 3_600_000);
      // A stray start and stop isn't a session.
      if (ran < 60_000 || !can) return;
      if (recording.current) await recording.current;
      const key = JSON.stringify([
        s.phase,
        s.round,
        s.run_started_at,
        s.ends_at,
        s.ran_ms,
      ]);
      let entry = records.current.get(key);
      if (entry?.saved) return;
      if (!entry) {
        entry = {
          saved: false,
          payload: {
            id: crypto.randomUUID(),
            item_id: s.phase === "work" ? task.id : null,
            kind: s.phase,
            started_at: new Date(at - ran).toISOString(),
            ended_at: new Date(at).toISOString(),
            planned_minutes: phaseMinutes(r, s.phase),
            minutes: Math.round(ran / 60_000),
            completed,
          },
        };
        records.current.set(key, entry);
      }
      const receipt = entry;
      setSaving(true);
      recording.current = (async () => {
        const saved = await client.saveFocusSession(receipt.payload);
        receipt.saved = true;
        if (!alive.current) return;
        failed.current = false;
        setSaveFailed(false);
        if (saved.item) latest.current.onLogged(saved.item);
        refreshToday();
      })();
      try {
        await recording.current;
      } catch (error) {
        if (alive.current) {
          failed.current = true;
          setSaveFailed(true);
        }
        throw error;
      } finally {
        recording.current = null;
        if (alive.current) setSaving(false);
      }
    },
    [refreshToday],
  );

  const share = useCallback((s: FocusState) => {
    const payload = {
      ...s,
      item_title: latest.current.item.title.slice(0, 200),
    };
    sharing.current = sharing.current.then(async () => {
      try {
        await client.setCurrentFocus(payload, deviceLabel(), deviceId());
      } catch (error) {
        if (alive.current) latest.current.onError(error);
      }
    });
  }, []);

  const update = useCallback(
    (next: FocusState) => {
      if (!alive.current) return;
      latest.current.state = next;
      setState(next);
      share(next);
    },
    [share],
  );

  // The clock: time is kept as instants, so a phase also ends correctly after
  // the tab was in the background.
  useEffect(() => {
    if (!running || !intervals) return;
    const tick = () => {
      if (!alive.current || recording.current || failed.current) return;
      const at = Date.now();
      setNow(at);
      const s = latest.current.state;
      if (!s.ends_at || focusRemaining(s, at) > 0) return;
      void record(s, true, Date.parse(s.ends_at))
        .then(() => {
          if (!alive.current || latest.current.state !== s) return;
          const next = advanceFocus(latest.current.rhythm, s, at);
          update(next);
          tell(
            s.phase === "work" ? "Time for a break" : "Break's over",
            s.phase === "work"
              ? `${phaseMinutes(latest.current.rhythm, next.phase)} minutes. ${latest.current.item.title} will be here.`
              : `Ready for ${focusPhaseLabel(latest.current.rhythm, next).toLowerCase()}?`,
          );
        })
        .catch((error) => {
          if (alive.current) {
            retryAction.current = tick;
            latest.current.onError(error);
          }
        });
    };
    tick();
    const id = setInterval(tick, 1000);
    const visible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [running, intervals, record, update, retryRevision]);

  // Picking up: from another device the time left carries over and only what
  // runs here is logged here; from this device it simply carries on.
  useEffect(() => {
    let stale = false;
    const initial = latest.current.state;
    client.currentFocus().then(
      (c) => {
        if (
          stale ||
          !alive.current ||
          latest.current.state !== initial ||
          !c ||
          c.state.item_id !== latest.current.item.id ||
          latest.current.state.ends_at ||
          latest.current.state.ran_ms
        )
          return;
        const r = focusRhythm(c.state.rhythm);
        if (!r || !r.work) return;
        setRhythm(r);
        if (c.device_id === deviceId()) {
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
      () => undefined,
    );
    return () => {
      stale = true;
    };
  }, [update]);

  // Handing over: another device picked this up, so this one logs what it
  // ran and stops, rather than both counting the same time.
  const handOver = useCallback(() => {
    if (!alive.current || recording.current || failed.current) return;
    const s = latest.current.state;
    if (!s.ends_at) return;
    void client.currentFocus().then(
      (c) => {
        if (
          !alive.current ||
          latest.current.state !== s ||
          !c ||
          c.state.item_id !== s.item_id ||
          c.device_id === deviceId() ||
          !c.device_id
        )
          return;
        const at = Date.now();
        const keep = () => {
          void record(s, false, at)
            .then(() => {
              if (!alive.current || latest.current.state !== s) return;
              const next = freshFocus(latest.current.rhythm, s.item_id);
              latest.current.state = next;
              setState(next);
              setMovedTo(c.device ?? "another device");
            })
            .catch((error) => {
              if (alive.current) {
                retryAction.current = keep;
                latest.current.onError(error);
              }
            });
        };
        keep();
      },
      () => undefined,
    );
  }, [record]);

  useEffect(() => {
    return onNews((news) => {
      if (news.kind === "focus" && news.by !== deviceId()) handOver();
    });
  }, [handOver]);

  const start = () => {
    if (recording.current || failed.current || !canWrite) return;
    if ("Notification" in window && Notification.permission === "default")
      void Notification.requestPermission().catch(() => undefined);
    update(startFocus(state, Date.now()));
  };
  const pause = () => {
    if (!recording.current && !failed.current)
      update(pauseFocus(state, Date.now()));
  };
  const skip = () => {
    if (recording.current || failed.current) return;
    const at = Date.now();
    const keep = () => {
      void record(state, false, at)
        .then(() => {
          if (alive.current) update(advanceFocus(rhythm, state, at));
        })
        .catch((error) => {
          if (alive.current) {
            retryAction.current = keep;
            latest.current.onError(error);
          }
        });
    };
    keep();
  };
  const chooseRhythm = (next: FocusRhythm) => {
    if (recording.current || failed.current || state.ends_at || state.ran_ms)
      return;
    try {
      localStorage.setItem(RHYTHM_KEY, next.id);
    } catch {
      // Remembered for this visit only.
    }
    setRhythm(next);
    const nextState = freshFocus(next, item.id);
    latest.current.state = nextState;
    setState(nextState);
  };

  /** Leaving: keep the work done so far, and stop sharing it. */
  const finish = useCallback(async () => {
    if (recording.current) await recording.current;
    const s = latest.current.state;
    if (latest.current.rhythm.work > 0) await record(s, false, Date.now());
    await sharing.current;
    const current = await client.currentFocus();
    if (!current || !current.device_id || current.device_id === deviceId())
      await client.clearCurrentFocus();
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
    saving,
    saveFailed,
    retrySave: () => {
      if (recording.current) return;
      failed.current = false;
      setSaveFailed(false);
      const retry = retryAction.current;
      retryAction.current = null;
      if (retry) retry();
      else setRetryRevision((n) => n + 1);
    },
    start,
    pause,
    skip,
    finish,
    refreshToday,
  };
}
