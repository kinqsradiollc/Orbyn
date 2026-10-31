import {
  customRhythmId,
  dateLabel,
  dueLine,
  FOCUS_RHYTHMS,
  focusPhaseLabel,
  focusRemaining,
  focusRhythm,
  type FocusCurrent,
  type Item,
  type ItemDetail,
  type ItemStep,
  type BreakLevel,
} from "@orbyn/core";
import {
  ArrowRight,
  Check,
  Coffee,
  Pause,
  Play,
  SkipForward,
  Timer,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import "./calendar.css";
import { Button, ErrorNotice, IconButton, Input, Loading } from "../../ui/kit";
import { minutesLabel } from "./format";
import { messageOf } from "./model";
import { nextUp } from "../shared-task/format";
import { deviceId, useFocusTimer } from "./useFocusTimer";

const clockText = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

type Props = {
  item: Item;
  items: Item[];
  canWrite: boolean;
  breakLevel?: BreakLevel;
  onClose: () => void;
  onSwitch: (item: Item) => void;
  onChanged: () => Promise<void> | void;
};

/**
 * One task, full screen: its checklist, a timer in a rhythm or left open,
 * "Mark done", and what's next. Leaving while it runs is stepping away, and
 * the banner brings you back. Render it keyed by the task id.
 */
export function FocusMode({
  item,
  items,
  canWrite,
  breakLevel,
  onClose,
  onSwitch,
  onChanged,
}: Props) {
  const box = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [readError, setReadError] = useState("");
  const [readAttempt, setReadAttempt] = useState(0);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [loggedNow, setLoggedNow] = useState(0);
  const [done, setDone] = useState(item.status === "done");
  const [error, setError] = useState("");
  const [pendingOp, setPendingOp] = useState(false);
  const alive = useRef(true);
  const mutation = useRef(false);
  const flushing = useRef<Promise<boolean> | null>(null);
  const unsaved = useRef<Parameters<typeof client.saveFocusSession>[0] | null>(
    null,
  );
  const banked = useRef(0);
  const startedAt = useRef<number | null>(null);
  const session = useRef(0);
  useEffect(() => {
    alive.current = true;
    const node = box.current;
    if (node && !node.open) node.showModal();
    return () => {
      alive.current = false;
    };
  }, []);

  const changed = useCallback(async () => {
    try {
      await onChanged();
    } catch (failure) {
      if (alive.current)
        setError(messageOf(failure, "Saved, but the calendar didn't refresh."));
    }
  }, [onChanged]);

  const focus = useFocusTimer({
    item,
    canWrite,
    breakLevel,
    onLogged: (d) => {
      setDetail(d);
      void changed();
    },
    onError: (failure) =>
      setError(messageOf(failure, "Focus time couldn't save.")),
  });
  const pending = pendingOp || focus.saving;
  const [custom, setCustom] = useState(() => {
    const r = focus.rhythm.work ? focus.rhythm : focusRhythm("25-5");
    return { work: r?.work ?? 25, rest: r?.short_break ?? 5 };
  });

  useEffect(() => {
    let live = true;
    setReadError("");
    client.getItem(item.id).then(
      (d) => live && setDetail(d),
      (failure) =>
        live &&
        setReadError(messageOf(failure, "Couldn't load the checklist.")),
    );
    return () => {
      live = false;
    };
  }, [item.id, readAttempt]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const { refreshToday, finish } = focus;
  const runSeconds = () =>
    startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;

  /** Stop the open timer and log whole minutes. */
  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const run = runSeconds();
    banked.current += run;
    session.current += run;
    startedAt.current = null;
    setRunning(false);
    const work = async () => {
      for (;;) {
        const minutes = Math.min(600, Math.floor(banked.current / 60));
        if (!unsaved.current && (minutes < 1 || !canWrite)) return true;
        if (!unsaved.current) {
          const ended = Date.now();
          unsaved.current = {
            id: crypto.randomUUID(),
            item_id: item.id,
            kind: "work",
            started_at: new Date(ended - minutes * 60_000).toISOString(),
            ended_at: new Date(ended).toISOString(),
            planned_minutes: 0,
            minutes,
            completed: true,
          };
        }
        const snapshot = unsaved.current;
        try {
          const saved = await client.saveFocusSession(snapshot);
          banked.current = Math.max(0, banked.current - snapshot.minutes * 60);
          unsaved.current = null;
          if (saved.item) setDetail(saved.item);
          setLoggedNow((m) => m + snapshot.minutes);
          refreshToday();
        } catch (failure) {
          if (alive.current)
            setError(messageOf(failure, "Focus time couldn't save."));
          return false;
        }
      }
    };
    flushing.current = work()
      .then(async (saved) => {
        if (saved) await changed();
        return saved;
      })
      .finally(() => {
        flushing.current = null;
      });
    return flushing.current;
  }, [canWrite, changed, item.id, refreshToday]);

  const act = useCallback(async (work: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true;
    setPendingOp(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      if (alive.current)
        setError(messageOf(failure, "That didn't save. Try again."));
    } finally {
      mutation.current = false;
      if (alive.current) setPendingOp(false);
    }
  }, []);

  // Leaving while the timer runs is stepping away, not stopping.
  const keepsRunning = focus.running && !!focus.state.ends_at;
  const close = useCallback(() => {
    void act(async () => {
      if (!(await flush())) return;
      if (!keepsRunning) await finish();
      onClose();
    });
  }, [act, finish, flush, keepsRunning, onClose]);
  const endSession = () =>
    void act(async () => {
      if (!(await flush())) return;
      await finish();
      onClose();
    });
  const switchTo = (next: Item) =>
    void act(async () => {
      if (!(await flush())) return;
      await finish();
      onSwitch(next);
    });
  const markDone = () =>
    void act(async () => {
      if (!canWrite || !(await flush())) return;
      await finish();
      setDetail(await client.postItemUpdate(item.id, { status: "done" }));
      setDone(true);
      await changed();
    });
  const toggleStep = (step: ItemStep) =>
    void act(async () => {
      if (!canWrite) return;
      setDetail(
        await client.updateStep(item.id, step.id, { done: !step.done }),
      );
      await changed();
    });

  // Log what's on the clock if the page is closed mid-session.
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden" && startedAt.current)
        void flush();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [flush]);

  const current: Item = detail ?? item;
  const steps = [...(detail?.steps ?? [])].sort(
    (a, b) => a.position - b.position,
  );
  const seconds = session.current + runSeconds();
  const upcoming = nextUp(items, item.id, 4);
  const locked =
    pending ||
    focus.saveFailed ||
    focus.running ||
    running ||
    focus.state.ran_ms > 0;
  const pickCustom = (work: number, rest: number) => {
    setCustom({ work, rest });
    const r = focusRhythm(customRhythmId(work, rest, rest * 3, 4));
    if (r) focus.chooseRhythm(r);
  };

  return (
    <dialog
      ref={box}
      className="calendar-focus"
      aria-labelledby="calendar-focus-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) close();
      }}
    >
      <header className="calendar-focus-head">
        <span className="small muted">Focus</span>
        <IconButton
          label={
            keepsRunning
              ? "Step away, the session keeps running"
              : "Leave focus mode"
          }
          disabled={pending}
          onClick={close}
        >
          <X />
        </IconButton>
      </header>
      <div className="calendar-focus-body">
        <main>
          <h1 id="calendar-focus-title" dir="auto">
            {current.title}
          </h1>
          <p className="calendar-focus-facts">
            {current.due_at && <span>{dueLine(current)}</span>}
            {current.estimate_minutes && (
              <span>Estimate {minutesLabel(current.estimate_minutes)}</span>
            )}
            <span>
              {minutesLabel(current.spent_minutes ?? 0)} spent
              {loggedNow > 0 && ` (${minutesLabel(loggedNow)} just now)`}
            </span>
          </p>
          {canWrite && !done && (
            <div className="calendar-focus-rhythm">
              <div className="segmented" role="group" aria-label="Rhythm">
                {FOCUS_RHYTHMS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={focus.rhythm.id === r.id}
                    disabled={locked}
                    onClick={() => focus.chooseRhythm(r)}
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={focus.rhythm.id.startsWith("custom:")}
                  disabled={locked}
                  onClick={() => pickCustom(custom.work, custom.rest)}
                >
                  Custom
                </button>
              </div>
              {focus.rhythm.id.startsWith("custom:") && !focus.running && (
                <div className="calendar-form-grid">
                  <label className="field">
                    Work minutes
                    <Input
                      type="number"
                      min={5}
                      max={180}
                      disabled={locked}
                      value={custom.work}
                      onChange={(e) =>
                        pickCustom(
                          Math.max(
                            5,
                            Math.min(180, Number(e.target.value) || 5),
                          ),
                          custom.rest,
                        )
                      }
                    />
                  </label>
                  <label className="field">
                    Break minutes
                    <Input
                      type="number"
                      min={1}
                      max={30}
                      disabled={locked}
                      value={custom.rest}
                      onChange={(e) =>
                        pickCustom(
                          custom.work,
                          Math.max(
                            1,
                            Math.min(30, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {focus.intervals ? (
            <div
              className={`calendar-timer${focus.running ? " is-running" : ""}`}
            >
              <div className="calendar-timer-row">
                <span
                  className="calendar-ring"
                  aria-hidden="true"
                  style={
                    {
                      "--p": `${Math.round((1 - focus.remaining / Math.max(1, focus.total)) * 1000) / 10}%`,
                    } as React.CSSProperties
                  }
                >
                  {focus.state.phase === "work" ? <Play /> : <Coffee />}
                </span>
                <div>
                  <b>{focus.label}</b>
                  <div className="calendar-clock" role="timer" aria-live="off">
                    {clockText(focus.remaining / 1000)}
                  </div>
                  <small className="muted">{focus.then}</small>
                </div>
              </div>
              <div className="calendar-answers">
                <Button
                  variant="primary"
                  disabled={pending || focus.saveFailed || done || !canWrite}
                  onClick={() =>
                    focus.running ? focus.pause() : focus.start()
                  }
                >
                  {focus.running ? (
                    <Pause aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {focus.running
                    ? "Pause"
                    : focus.state.phase !== "work"
                      ? "Resume break"
                      : focus.state.ran_ms > 0
                        ? "Resume"
                        : focus.state.round > 1
                          ? `Start ${focus.label.toLowerCase()}`
                          : "Start"}
                </Button>
                {keepsRunning && (
                  <Button disabled={pending} onClick={endSession}>
                    End session
                  </Button>
                )}
                {focus.state.phase !== "work" && (
                  <Button
                    disabled={pending || focus.saveFailed}
                    onClick={focus.skip}
                  >
                    <SkipForward aria-hidden="true" /> Skip break
                  </Button>
                )}
                <Button
                  disabled={done || pending || !canWrite}
                  onClick={markDone}
                >
                  <Check aria-hidden="true" /> {done ? "Done" : "Mark done"}
                </Button>
              </div>
              {focus.saveFailed && (
                <ErrorNotice
                  message="Focus time couldn't save."
                  onRetry={focus.retrySave}
                />
              )}
              <small className="muted">
                {focus.today
                  ? `${minutesLabel(focus.today)} focused today. `
                  : ""}
                Work time saves when a session ends.
              </small>
              {focus.movedTo && (
                <small role="status" className="muted">
                  Continued on {focus.movedTo}. The time you ran here is logged.
                </small>
              )}
            </div>
          ) : (
            <div className={`calendar-timer${running ? " is-running" : ""}`}>
              <div className="calendar-clock" role="timer" aria-live="off">
                {clockText(seconds)}
              </div>
              <div className="calendar-answers">
                <Button
                  variant="primary"
                  disabled={pending || done || !canWrite}
                  onClick={() => {
                    if (running)
                      void act(async () => {
                        await flush();
                      });
                    else if (
                      !mutation.current &&
                      !flushing.current &&
                      canWrite
                    ) {
                      startedAt.current = Date.now();
                      setRunning(true);
                      setError("");
                    }
                  }}
                >
                  {running ? (
                    <Pause aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                  {running ? "Pause" : seconds > 0 ? "Resume" : "Start"}
                </Button>
                <Button
                  disabled={done || pending || !canWrite}
                  onClick={markDone}
                >
                  <Check aria-hidden="true" /> {done ? "Done" : "Mark done"}
                </Button>
              </div>
              <small className="muted">
                {canWrite
                  ? "Pausing logs whole minutes to this task."
                  : "View only. Time logging is off."}
                {canWrite && focus.today
                  ? ` ${minutesLabel(focus.today)} focused today.`
                  : ""}
              </small>
            </div>
          )}

          {done && (
            <p className="calendar-applied" role="status">
              <Check aria-hidden="true" /> Task completed
            </p>
          )}
          {error && <ErrorNotice message={error} />}

          <section aria-labelledby="calendar-focus-steps">
            <h2 id="calendar-focus-steps">Checklist</h2>
            {readError ? (
              <ErrorNotice
                message={readError}
                onRetry={() => setReadAttempt((n) => n + 1)}
              />
            ) : !detail ? (
              <Loading label="Loading checklist" />
            ) : steps.length ? (
              <div className="calendar-checks">
                {steps.map((s) => (
                  <label key={s.id} className="check">
                    <input
                      type="checkbox"
                      checked={s.done}
                      disabled={pending || !canWrite}
                      onChange={() => toggleStep(s)}
                    />
                    <span dir="auto">{s.title}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="small muted">No checklist steps.</p>
            )}
          </section>
        </main>
        <aside aria-labelledby="calendar-focus-next">
          <h2 id="calendar-focus-next">Next up</h2>
          {upcoming.length ? (
            <div className="rows">
              {upcoming.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="row"
                  disabled={pending}
                  onClick={() => switchTo(i)}
                >
                  <span className="row-main">
                    <span className="row-title" dir="auto">
                      {i.title}
                    </span>
                    <small className="muted">
                      {i.due_at ? dateLabel(i.due_at) : "No date"}
                      {i.estimate_minutes
                        ? ` · ${minutesLabel(i.estimate_minutes)}`
                        : ""}
                    </small>
                  </span>
                  <ArrowRight aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : (
            <p className="small muted">No other open tasks.</p>
          )}
        </aside>
      </div>
    </dialog>
  );
}

/**
 * A session running while focus mode is closed. On another device, "Continue
 * here" picks it up; on this one, "Back to focus" returns to it, so leaving
 * never strands a session. Exported for the shell to show on every screen.
 */
export function FocusBanner({
  items,
  hidden,
  version,
  onOpen,
}: {
  items: Item[];
  hidden: boolean;
  version: unknown;
  onOpen: (item: Item) => void;
}) {
  const request = useRef(0);
  const [current, setCurrent] = useState<FocusCurrent | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (hidden) return;
    const mine = ++request.current;
    client.currentFocus().then(
      (next) => {
        if (mine === request.current) setCurrent(next);
      },
      () => undefined,
    );
    return () => {
      request.current++;
    };
  }, [hidden, version]);
  const running = !!current?.state.ends_at;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!current || hidden) return null;
  const here = current.device_id === deviceId();
  const rhythm = focusRhythm(current.state.rhythm);
  const left = focusRemaining(current.state, now);
  const item = items.find((i) => i.id === current.state.item_id);
  const what = rhythm?.work ? focusPhaseLabel(rhythm, current.state) : "Focus";
  const seconds = Math.max(0, Math.round(left / 1000));
  return (
    <div className="calendar-note" role="status">
      <Timer aria-hidden="true" />
      <span dir="auto">
        <b>
          {here ? what : `${what} on ${current.device ?? "another device"}`}
        </b>
        {current.state.item_title && ` · ${current.state.item_title}`}
        <span role="timer" aria-live="off">
          {" · "}
          {running
            ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`
            : "Paused"}
        </span>
      </span>
      {item && (
        <Button onClick={() => onOpen(item)}>
          {here ? "Back to focus" : "Continue here"}
        </Button>
      )}
      <IconButton
        label="Hide for now"
        onClick={() => {
          request.current++;
          setCurrent(null);
        }}
      >
        <X />
      </IconButton>
    </div>
  );
}
