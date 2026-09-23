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
      (s) => setToday(s.work_minutes),
      () => {},
    );
  }, []);
  useEffect(refreshToday, [refreshToday]);

  /** Keep a phase that ran; work minutes go to the task. */
  const record = useCallback(
    async (s: FocusState, completed: boolean, at: number) => {
      const { rhythm: r, item: task, canWrite: can } = latest.current;
      const ran = Math.min(focusRan(s, at), 12 * 3_600_000);
      const minutes = Math.round(ran / 60_000);
      // A stray start and stop isn't a session.
      if (ran < 60_000 || !can) return;
      try {
        const saved = await client.saveFocusSession({
          id: crypto.randomUUID(),
          item_id: s.phase === "work" ? task.id : null,
          kind: s.phase,
          started_at: new Date(at - ran).toISOString(),
          ended_at: new Date(at).toISOString(),
          planned_minutes: phaseMinutes(r, s.phase),
          minutes,
          completed,
        });
        if (saved.item) latest.current.onLogged(saved.item);
        refreshToday();
      } catch (e) {
        latest.current.onError(e);
      }
    },
    [refreshToday],
  );

  // Tell the other devices what's running here, whenever it changes.
  const share = useCallback((s: FocusState) => {
    const { item: task } = latest.current;
    void client
      .setCurrentFocus(
        { ...s, item_title: task.title.slice(0, 200) },
        deviceLabel(),
        deviceId(),
      )
      .catch(() => {});
  }, []);

  const update = useCallback(
    (next: FocusState) => {
      setState(next);
      share(next);
    },
    [share],
  );

  // The clock: redraw each second, and move on when a phase ends — also
  // after the tab was in the background, since time is kept as instants.
  useEffect(() => {
    if (!running || !intervals) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      const s = latest.current.state;
      if (!s.ends_at || focusRemaining(s, at) > 0) return;
      const ended = Date.parse(s.ends_at);
      void record(s, true, ended);
      const next = advanceFocus(latest.current.rhythm, s, at);
      update(next);
      tell(
        s.phase === "work" ? "Time for a break" : "Break's over",
        s.phase === "work"
          ? `${phaseMinutes(latest.current.rhythm, next.phase)} minutes. ${latest.current.item.title} will be here.`
          : `Ready for ${focusPhaseLabel(latest.current.rhythm, next).toLowerCase()}?`,
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, intervals, record, update]);

  // Picking up a session running on another device: the time left carries
  // over, and from here on only what runs here is logged here.
  useEffect(() => {
    let alive = true;
    client.currentFocus().then(
      (c) => {
        if (
          !alive ||
          !c ||
          c.device_id === deviceId() ||
          c.state.item_id !== latest.current.item.id
        )
          return;
        const r = focusRhythm(c.state.rhythm);
        if (!r || !r.work) return;
        chosen.current = true;
        setRhythm(r);
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

  const start = () => {
    if ("Notification" in window && Notification.permission === "default")
      void Notification.requestPermission().catch(() => {});
    update(startFocus(state, Date.now()));
  };
  const pause = () => update(pauseFocus(state, Date.now()));

  /** End a break early and go back to work. */
  const skip = () => {
    const at = Date.now();
    void record(state, false, at);
    update(advanceFocus(rhythm, state, at));
  };

  const chooseRhythm = (next: FocusRhythm) => {
    chosen.current = true;
    try {
      localStorage.setItem(RHYTHM_KEY, next.id);
    } catch {
      // Remembered for this visit only.
    }
    setRhythm(next);
    setState(freshFocus(next, item.id));
  };

  /** Leaving: keep the work done so far, and stop sharing it. */
  const finish = useCallback(async () => {
    const s = latest.current.state;
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
