import { useCallback, useEffect, useRef, useState } from "react";
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
  type FocusRhythm,
  type FocusState,
  type Item,
  type ItemDetail,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { deviceId, deviceLabel } from "../../lib/device";
import { usePlanning } from "../../app/planning";
import { session as authSession } from "../../lib/session";

const RHYTHM_KEY = "orbyn-focus-rhythm";

const stored = () => {
  try {
    return localStorage.getItem(RHYTHM_KEY);
  } catch {
    return null;
  }
};

/** Midnight today, here. */
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** A short, soft two-note chime; silent where audio isn't allowed yet. */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((hz, n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      const at = ctx.currentTime + n * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.55);
    });
    setTimeout(() => void ctx.close(), 1500);
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

type Options = {
  item: Item;
  canWrite: boolean;
  /** The task after work minutes were logged to it. */
  onLogged: (detail: ItemDetail) => void;
  onError: (e: unknown) => void;
};

/**
 * Work sessions and breaks for focus mode. The rhythm comes from what the
 * person chose last, or from the breaks they asked the planner for. Every
 * phase that ends is kept, its work minutes logged to the task; the running
 * phase is shared with their other devices.
 */
export function useFocusSession({
  item,
  canWrite,
  onLogged,
  onError,
}: Options) {
  const { prefs } = usePlanning();
  const owner = useRef(authSession.get()).current;
  const mounted = useRef(true);
  const currentOwner = useCallback(
    () => mounted.current && authSession.get() === owner,
    [owner],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const recording = useRef<Promise<void> | null>(null);
  const sharing = useRef<Promise<void>>(Promise.resolve());
  const records = useRef(
    new Map<
      string,
      {
        payload: Parameters<typeof client.saveFocusSession>[0];
        saved: boolean;
      }
    >(),
  );
  const failed = useRef(false);
  const retryAction = useRef<(() => void) | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryRevision, setRetryRevision] = useState(0);
  const [rhythm, setRhythm] = useState<FocusRhythm>(
    () => focusRhythm(stored()) ?? rhythmForBreakLevel(prefs?.break_level),
  );
  const chosen = useRef(!!focusRhythm(stored()));
  // Preferences arrive after the first render: follow them until a choice.
  const [state, setState] = useState<FocusState>(() =>
    freshFocus(rhythm, item.id),
  );
  useEffect(() => {
    if (chosen.current || !prefs) return;
    const next = rhythmForBreakLevel(prefs.break_level);
    setRhythm(next);
    // Only a session not yet started takes the new rhythm.
    setState((s) =>
      s.ends_at || s.ran_ms || s.round > 1 ? s : freshFocus(next, s.item_id),
    );
  }, [prefs]);
  const [now, setNow] = useState(() => Date.now());
  const [today, setToday] = useState<number | null>(null);
  /** The session went on elsewhere: where, to say so here. */
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const latest = useRef({ state, rhythm, item, canWrite, onLogged, onError });
  latest.current = { state, rhythm, item, canWrite, onLogged, onError };

  const intervals = rhythm.work > 0;
  const running = state.ends_at !== null;

  const refreshToday = useCallback(() => {
    client.focusSummary(startOfToday(), new Date(Date.now() + 60_000)).then(
      (s) => {
        if (currentOwner()) setToday(s.work_minutes);
      },
      () => {},
    );
  }, [currentOwner]);
  useEffect(refreshToday, [refreshToday]);

  /** Keep a phase that ran; work minutes go to the task. */
  const record = useCallback(
    async (s: FocusState, completed: boolean, at: number) => {
      const { rhythm: r, item: task, canWrite: can } = latest.current;
      const ran = Math.min(focusRan(s, at), 12 * 3_600_000);
      const minutes = Math.round(ran / 60_000);
      // A stray start and stop isn't a session.
      if (ran < 60_000 || !can) return;
      if (!currentOwner())
        throw new Error("Focus session is no longer active.");
      if (recording.current) await recording.current;
      if (!currentOwner())
        throw new Error("Focus session is no longer active.");
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
            minutes,
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
        if (!currentOwner()) return;
        failed.current = false;
        setSaveFailed(false);
        if (saved.item) latest.current.onLogged(saved.item);
        refreshToday();
      })();
      try {
        await recording.current;
      } catch (e) {
        if (currentOwner()) {
          failed.current = true;
          setSaveFailed(true);
        }
        throw e;
      } finally {
        recording.current = null;
        if (currentOwner()) setSaving(false);
      }
    },
    [refreshToday, currentOwner],
  );

  // Tell the other devices what's running here, whenever it changes.
  const share = useCallback(
    (s: FocusState) => {
      if (!currentOwner()) return;
      const { item: task } = latest.current;
      const payload = { ...s, item_title: task.title.slice(0, 200) };
      sharing.current = sharing.current.then(async () => {
        if (!currentOwner()) return;
        try {
          await client.setCurrentFocus(payload, deviceLabel(), deviceId());
        } catch (e) {
          if (currentOwner()) latest.current.onError(e);
        }
      });
    },
    [currentOwner],
  );

  const update = useCallback(
    (next: FocusState) => {
      if (!currentOwner()) return;
      latest.current.state = next;
      setState(next);
      share(next);
    },
    [share, currentOwner],
  );

  // The clock: redraw each second, and move on when a phase ends — also
  // after the tab was in the background, since time is kept as instants.
  useEffect(() => {
    if (!running || !intervals) return;
    const tick = () => {
      if (!currentOwner() || recording.current || failed.current) return;
      const at = Date.now();
      setNow(at);
      const s = latest.current.state;
      if (!s.ends_at || focusRemaining(s, at) > 0) return;
      const ended = Date.parse(s.ends_at);
      void record(s, true, ended)
        .then(() => {
          if (!currentOwner() || latest.current.state !== s) return;
          const next = advanceFocus(latest.current.rhythm, s, at);
          update(next);
          tell(
            s.phase === "work" ? "Time for a break" : "Break's over",
            s.phase === "work"
              ? `${phaseMinutes(latest.current.rhythm, next.phase)} minutes. ${latest.current.item.title} will be here.`
              : `Ready for ${focusPhaseLabel(latest.current.rhythm, next).toLowerCase()}?`,
          );
        })
        .catch((e) => {
          if (currentOwner()) {
            retryAction.current = tick;
            latest.current.onError(e);
          }
        });
    };
    tick();
    const id = setInterval(tick, 1000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, intervals, record, update, currentOwner, retryRevision]);

  // Picking up a session: from another device the time left carries over and
  // only what runs here is logged here; from this device (after stepping
  // away) it simply carries on where it is.
  useEffect(() => {
    let alive = true;
    const initialState = latest.current.state;
    client.currentFocus().then(
      (c) => {
        if (
          !alive ||
          !currentOwner() ||
          latest.current.state !== initialState ||
          !c ||
          c.state.item_id !== latest.current.item.id
        )
          return;
        if (latest.current.state.ends_at || latest.current.state.ran_ms) return;
        const r = focusRhythm(c.state.rhythm);
        if (!r || !r.work) return;
        chosen.current = true;
        setRhythm(r);
        // Its own session: the server already holds this state, so only
        // show it — sharing it again would echo back as news.
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
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [update, currentOwner]);

  // Handing over: another device picked this session up, so this one logs
  // what it ran and stops, rather than both counting the same time.
  useEffect(
    () =>
      onLive((news) => {
        if (!currentOwner() || recording.current || failed.current) return;
        if (news.kind !== "focus" || news.by === deviceId()) return;
        const s = latest.current.state;
        if (!s.ends_at) return;
        void client.currentFocus().then(
          (c) => {
            if (
              !currentOwner() ||
              latest.current.state !== s ||
              !c ||
              c.state.item_id !== s.item_id ||
              c.device_id === deviceId() ||
              !c.device_id
            )
              return;
            const at = Date.now();
            const keepHandover = () => {
              void record(s, false, at)
                .then(() => {
                  if (!currentOwner() || latest.current.state !== s) return;
                  const next = freshFocus(latest.current.rhythm, s.item_id);
                  latest.current.state = next;
                  setState(next);
                  setMovedTo(c.device ?? "another device");
                })
                .catch((e) => {
                  if (currentOwner()) {
                    retryAction.current = keepHandover;
                    latest.current.onError(e);
                  }
                });
            };
            keepHandover();
          },
          () => {},
        );
      }),
    [record, currentOwner],
  );

  const start = () => {
    if (!currentOwner() || recording.current || failed.current || !canWrite)
      return;
    if ("Notification" in window && Notification.permission === "default")
      void Notification.requestPermission().catch(() => {});
    update(startFocus(state, Date.now()));
  };
  const pause = () => {
    if (!recording.current && !failed.current)
      update(pauseFocus(state, Date.now()));
  };

  /** End a break early and go back to work. */
  const skip = () => {
    if (!currentOwner() || recording.current || failed.current) return;
    const at = Date.now();
    const keepSkip = () => {
      void record(state, false, at)
        .then(() => {
          if (currentOwner()) update(advanceFocus(rhythm, state, at));
        })
        .catch((e) => {
          if (currentOwner()) {
            retryAction.current = keepSkip;
            latest.current.onError(e);
          }
        });
    };
    keepSkip();
  };

  const chooseRhythm = (next: FocusRhythm) => {
    if (
      !currentOwner() ||
      recording.current ||
      failed.current ||
      state.ends_at ||
      state.ran_ms
    )
      return;
    chosen.current = true;
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
    if (!currentOwner()) throw new Error("Focus session is no longer active.");
    if (recording.current) await recording.current;
    const s = latest.current.state;
    if (latest.current.rhythm.work > 0) await record(s, false, Date.now());
    await sharing.current;
    if (!currentOwner()) throw new Error("Focus session is no longer active.");
    // Only this device's own session: never one picked up elsewhere.
    const current = await client.currentFocus();
    if (!currentOwner()) throw new Error("Focus session is no longer active.");
    if (!current || !current.device_id || current.device_id === deviceId())
      await client.clearCurrentFocus();
  }, [record, currentOwner]);

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
      if (!currentOwner() || recording.current) return;
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
