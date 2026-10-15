import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ListChecks,
  Coffee,
  Pause,
  Play,
  SkipForward,
  X,
} from "lucide-react";
import {
  customRhythmId,
  dateLabel,
  dueLine,
  FOCUS_RHYTHMS,
  focusRhythm,
  type HttpError,
  type Item,
  type ItemDetail,
  type ItemStep,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText, minutesLabel, nextUp } from "../../lib/planning";
import { useFocusSession } from "./useFocusSession";
import "./focus.css";
import { useModalFocus } from "../../hooks/useModalFocus";
import { session as authSession } from "../../lib/session";

type Props = {
  item: Item;
  /** Everything in the planner, for "Next up". */
  items: Item[];
  canWrite: boolean;
  onClose: () => void;
  /** Focus on another task instead. */
  onSwitch: (item: Item) => void;
  onChanged: () => Promise<void>;
  onError: (e: unknown) => void;
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
};

/**
 * One task, full screen: its checklist, a timer, "Mark done" with a small
 * celebration, and what's next. The timer runs in a rhythm — work, then the
 * break it asks for — or open, counting up until paused. Work minutes are
 * logged to the task either way. Render it keyed by the task id.
 */
export function FocusMode(props: Props) {
  return <FocusBody key={`${authSession.get()}:${props.item.id}`} {...props} />;
}
function FocusBody({
  item,
  items,
  canWrite,
  onClose,
  onSwitch,
  onChanged,
  onError,
}: Props) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [loggedNow, setLoggedNow] = useState(0);
  const [done, setDone] = useState(item.status === "done");
  const [readFailed, setReadFailed] = useState(false);
  const [readRevision, setReadRevision] = useState(0);
  const [error, setError] = useState("");
  const [operationPending, setPending] = useState(false);
  const owner = authSession.get();
  const alive = useRef(true);
  const mutation = useRef(false);
  const flushing = useRef<Promise<boolean> | null>(null);
  const unsaved = useRef<Parameters<typeof client.saveFocusSession>[0] | null>(
    null,
  );
  const currentOwner = useCallback(
    () => alive.current && authSession.get() === owner,
    [owner],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** Seconds timed but not yet logged, and when the current run started. */
  const banked = useRef(0);
  const startedAt = useRef<number | null>(null);
  /** Seconds timed this session, for the clock. */
  const session = useRef(0);
  const startButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onError });
  latest.current = { onError };
  const focus = useFocusSession({
    item,
    canWrite,
    onLogged: (d) => {
      if (!currentOwner()) return;
      setDetail(d);
      void onChanged().catch((e) => {
        if (currentOwner()) setError(errorText(e));
      });
    },
    onError: (e) => {
      if (!currentOwner()) return;
      setError(errorText(e));
      if ((e as HttpError).status === 401) onError(e);
    },
  });
  const pending = operationPending || focus.saving;
  const [custom, setCustom] = useState(() => {
    const r = focus.rhythm.work ? focus.rhythm : focusRhythm("25-5")!;
    return { work: r.work, rest: r.short_break };
  });

  useEffect(() => {
    let alive = true;
    setReadFailed(false);
    client.getItem(item.id).then(
      (d) => {
        if (alive && currentOwner()) setDetail(d);
      },
      (e) => {
        if (alive && currentOwner()) {
          setReadFailed(true);
          if ((e as HttpError).status === 401) latest.current.onError(e);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [item.id, readRevision, currentOwner]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const { refreshToday } = focus;
  const runSeconds = () =>
    startedAt.current ? (Date.now() - startedAt.current) / 1000 : 0;

  /** Stop the clock and log whole minutes (at least one). */
  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    if (!currentOwner()) return Promise.resolve(false);
    const run = runSeconds();
    banked.current += run;
    session.current += run;
    startedAt.current = null;
    setRunning(false);
    const work = async () => {
      while (currentOwner()) {
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
          if (!currentOwner()) return false;
          banked.current = Math.max(0, banked.current - snapshot.minutes * 60);
          unsaved.current = null;
          if (saved.item) setDetail(saved.item);
          setLoggedNow((m) => m + snapshot.minutes);
          refreshToday();
        } catch (e) {
          if (currentOwner()) {
            setError(errorText(e));
            if ((e as HttpError).status === 401) onError(e);
          }
          return false;
        }
      }
      return false;
    };
    flushing.current = work()
      .then(async (saved) => {
        if (saved && currentOwner()) {
          try {
            await onChanged();
          } catch (e) {
            if (currentOwner()) setError(`Time saved. ${errorText(e)}`);
          }
        }
        return saved;
      })
      .finally(() => {
        flushing.current = null;
      });
    return flushing.current;
  }, [canWrite, item.id, onChanged, onError, refreshToday, currentOwner]);

  const start = () => {
    if (mutation.current || flushing.current || !currentOwner() || !canWrite)
      return;
    startedAt.current = Date.now();
    setRunning(true);
    setError("");
  };

  const { finish } = focus;
  // Leaving while the timer runs is stepping away, not stopping: the session
  // keeps going and "Back to focus" in the app returns to it. Leaving a timer
  // that isn't running, or ending the session, stops it.
  const keepsRunning = focus.running && !!focus.state.ends_at;
  const act = useCallback(
    async (work: () => Promise<void>) => {
      if (mutation.current || !currentOwner()) return;
      mutation.current = true;
      setPending(true);
      setError("");
      try {
        await work();
      } catch (e) {
        if (currentOwner()) {
          setError(errorText(e));
          if ((e as HttpError).status === 401) onError(e);
        }
      } finally {
        mutation.current = false;
        if (currentOwner()) setPending(false);
      }
    },
    [currentOwner, onError],
  );
  const close = useCallback(() => {
    void act(async () => {
      if (!(await flush()) || !currentOwner()) return;
      if (!keepsRunning) await finish();
      if (currentOwner()) onClose();
    });
  }, [act, flush, finish, onClose, keepsRunning, currentOwner]);
  const endSession = () =>
    void act(async () => {
      if (!(await flush()) || !currentOwner()) return;
      await finish();
      if (currentOwner()) onClose();
    });
  const switchTo = (next: Item) =>
    void act(async () => {
      if (!(await flush()) || !currentOwner()) return;
      await finish();
      if (currentOwner()) onSwitch(next);
    });
  const markDone = () =>
    act(async () => {
      if (!canWrite || !(await flush()) || !currentOwner()) return;
      await finish();
      if (!currentOwner()) return;
      const saved = await client.postItemUpdate(item.id, { status: "done" });
      if (!currentOwner()) return;
      setDetail(saved);
      setDone(true);
      try {
        await onChanged();
      } catch (e) {
        if (currentOwner()) setError(`Task completed. ${errorText(e)}`);
      }
    });
  const toggleStep = (step: ItemStep) =>
    act(async () => {
      if (!canWrite) return;
      const saved = await client.updateStep(item.id, step.id, {
        done: !step.done,
      });
      if (!currentOwner()) return;
      setDetail(saved);
      try {
        await onChanged();
      } catch (e) {
        if (currentOwner()) setError(`Step saved. ${errorText(e)}`);
      }
    });

  const modal = useModalFocus(close, pending);

  // Log what's on the clock if the page is closed mid-session.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && startedAt.current)
        void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  const current: Item = detail ?? item;
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const spent = current.spent_minutes ?? 0;
  const seconds = session.current + runSeconds();
  const upcoming = nextUp(items, item.id, 4);

  return createPortal(
    <section
      ref={modal.ref}
      data-modal-focus={modal.id}
      tabIndex={-1}
      className="focus-mode"
      role="dialog"
      aria-modal="true"
      aria-labelledby="focus-title"
    >
      <header className="focus-head">
        <span className="eyebrow">Focus</span>
        <button
          className="icon-button"
          aria-label={
            keepsRunning
              ? "Step away (the session keeps running)"
              : "Leave focus mode"
          }
          disabled={pending}
          onClick={close}
        >
          <X size={22} />
        </button>
      </header>
      <div className="focus-body">
        <main className="focus-main">
          <h1 id="focus-title">{current.title}</h1>
          <p className="focus-facts">
            {current.due_at && <span>{dueLine(current)}</span>}
            {current.estimate_minutes && (
              <span>Estimate {minutesLabel(current.estimate_minutes)}</span>
            )}
            <span>
              {minutesLabel(spent)} spent
              {loggedNow > 0 && ` (${minutesLabel(loggedNow)} just now)`}
            </span>
          </p>

          {canWrite && !done && (
            <div className="focus-rhythm">
              <div className="segmented" role="group" aria-label="Rhythm">
                {FOCUS_RHYTHMS.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={focus.rhythm.id === r.id}
                    className={focus.rhythm.id === r.id ? "active" : ""}
                    disabled={
                      pending ||
                      focus.saveFailed ||
                      focus.running ||
                      running ||
                      focus.state.ran_ms > 0
                    }
                    onClick={() => focus.chooseRhythm(r)}
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  aria-pressed={focus.rhythm.id.startsWith("custom:")}
                  className={
                    focus.rhythm.id.startsWith("custom:") ? "active" : ""
                  }
                  disabled={
                    pending ||
                    focus.saveFailed ||
                    focus.running ||
                    running ||
                    focus.state.ran_ms > 0
                  }
                  onClick={() =>
                    focus.chooseRhythm(
                      focusRhythm(
                        customRhythmId(
                          custom.work,
                          custom.rest,
                          custom.rest * 3,
                          4,
                        ),
                      )!,
                    )
                  }
                >
                  Custom
                </button>
              </div>
              {focus.rhythm.id.startsWith("custom:") && !focus.running && (
                <div className="focus-custom">
                  <label>
                    Work
                    <input
                      type="number"
                      disabled={
                        pending ||
                        focus.saveFailed ||
                        running ||
                        focus.state.ran_ms > 0
                      }
                      min={5}
                      max={180}
                      value={custom.work}
                      onChange={(e) => {
                        const work = Math.max(
                          5,
                          Math.min(180, Number(e.target.value) || 5),
                        );
                        setCustom({ ...custom, work });
                        focus.chooseRhythm(
                          focusRhythm(
                            customRhythmId(
                              work,
                              custom.rest,
                              custom.rest * 3,
                              4,
                            ),
                          )!,
                        );
                      }}
                    />
                    min
                  </label>
                  <label>
                    Break
                    <input
                      type="number"
                      disabled={
                        pending ||
                        focus.saveFailed ||
                        running ||
                        focus.state.ran_ms > 0
                      }
                      min={1}
                      max={30}
                      value={custom.rest}
                      onChange={(e) => {
                        const rest = Math.max(
                          1,
                          Math.min(30, Number(e.target.value) || 1),
                        );
                        setCustom({ ...custom, rest });
                        focus.chooseRhythm(
                          focusRhythm(
                            customRhythmId(custom.work, rest, rest * 3, 4),
                          )!,
                        );
                      }}
                    />
                    min
                  </label>
                </div>
              )}
            </div>
          )}

          {focus.intervals ? (
            <div
              className={
                "focus-timer focus-interval" +
                (focus.running ? " is-running" : "") +
                (focus.state.phase !== "work" ? " is-break" : "")
              }
            >
              <div className="focus-interval-row">
                <div
                  className="focus-ring"
                  style={
                    {
                      "--p": `${
                        Math.round(
                          (1 - focus.remaining / Math.max(1, focus.total)) *
                            1000,
                        ) / 10
                      }%`,
                    } as never
                  }
                  aria-hidden="true"
                >
                  <span>
                    {focus.state.phase === "work" ? (
                      <Play size={18} />
                    ) : (
                      <Coffee size={18} />
                    )}
                  </span>
                </div>
                <div className="focus-interval-text">
                  <strong>{focus.label}</strong>
                  <span className="focus-clock" role="timer" aria-live="off">
                    {clock(focus.remaining / 1000)}
                  </span>
                  <small>{focus.then}</small>
                  <span
                    className="focus-dots"
                    aria-label={focus.label}
                    role="img"
                  >
                    {Array.from({ length: focus.rhythm.rounds }, (_, n) => {
                      const within =
                        ((focus.state.round - 1) % focus.rhythm.rounds) + 1;
                      const cls =
                        n + 1 < within ||
                        (n + 1 === within && focus.state.phase !== "work")
                          ? "on"
                          : n + 1 === within
                            ? "now"
                            : "";
                      return <i key={n} className={cls} />;
                    })}
                  </span>
                </div>
              </div>
              <div className="focus-controls">
                <button
                  ref={startButton}
                  className="primary focus-start"
                  disabled={pending || focus.saveFailed || done || !canWrite}
                  onClick={() =>
                    focus.running ? focus.pause() : focus.start()
                  }
                >
                  {focus.running ? (
                    <>
                      <Pause size={17} /> Pause
                    </>
                  ) : (
                    <>
                      <Play size={17} />{" "}
                      {focus.state.phase !== "work"
                        ? "Resume break"
                        : focus.state.ran_ms > 0
                          ? "Resume"
                          : focus.state.round > 1
                            ? `Start ${focus.label.toLowerCase()}`
                            : "Start"}
                    </>
                  )}
                </button>
                {keepsRunning && (
                  <button
                    className="secondary"
                    disabled={pending}
                    onClick={endSession}
                  >
                    End session
                  </button>
                )}
                {focus.state.phase !== "work" && (
                  <button
                    className="secondary"
                    disabled={pending || focus.saveFailed}
                    onClick={focus.skip}
                  >
                    <SkipForward size={17} /> Skip break
                  </button>
                )}
                <button
                  className="secondary"
                  disabled={done || pending || !canWrite}
                  onClick={() => void markDone()}
                >
                  <Check size={17} /> {done ? "Done" : "Mark done"}
                </button>
              </div>
              {focus.saveFailed && (
                <div className="focus-controls">
                  <span role="status">Focus time couldn’t save.</span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={focus.retrySave}
                  >
                    Retry save
                  </button>
                </div>
              )}
              <small className="focus-hint">
                {focus.today !== null && focus.today > 0
                  ? `${minutesLabel(focus.today)} focused today. `
                  : ""}
                Work time saves when a session ends.
              </small>
              {focus.movedTo && (
                <small className="focus-hint" role="status">
                  Continued on {focus.movedTo}. The time you ran here is logged.
                </small>
              )}
            </div>
          ) : (
            <div className={"focus-timer" + (running ? " is-running" : "")}>
              <span className="focus-clock" role="timer" aria-live="off">
                {clock(seconds)}
              </span>
              <div className="focus-controls">
                <button
                  ref={startButton}
                  className="primary focus-start"
                  disabled={pending || done || !canWrite}
                  onClick={() =>
                    running
                      ? void act(async () => {
                          await flush();
                        })
                      : start()
                  }
                >
                  {running ? (
                    <>
                      <Pause size={17} /> Pause
                    </>
                  ) : (
                    <>
                      <Play size={17} /> {seconds > 0 ? "Resume" : "Start"}
                    </>
                  )}
                </button>
                <button
                  className="secondary"
                  disabled={done || pending || !canWrite}
                  onClick={() => void markDone()}
                >
                  <Check size={17} /> {done ? "Done" : "Mark done"}
                </button>
              </div>
              <small className="focus-hint">
                {canWrite
                  ? "Pausing logs whole minutes to this task."
                  : "View only. Time logging is unavailable."}
                {canWrite && focus.today !== null && focus.today > 0
                  ? ` ${minutesLabel(focus.today)} focused today.`
                  : ""}
              </small>
            </div>
          )}

          {done && (
            <p className="focus-completion" role="status">
              <Check size={18} aria-hidden="true" /> Task completed
            </p>
          )}

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <section className="focus-steps" aria-labelledby="focus-steps-title">
            <h2 id="focus-steps-title">
              <ListChecks size={16} aria-hidden="true" /> Checklist
            </h2>
            {readFailed ? (
              <div className="focus-read-error">
                <p className="drawer-hint" role="alert">
                  Couldn't load the checklist.
                </p>
                <button
                  className="secondary"
                  disabled={pending}
                  onClick={() => setReadRevision((n) => n + 1)}
                >
                  Retry
                </button>
              </div>
            ) : detail === null ? (
              <p className="drawer-hint">Loading checklist…</p>
            ) : steps.length ? (
              <ul className="step-list">
                {steps.map((s) => (
                  <li key={s.id} className={"step " + (s.done ? "done" : "")}>
                    <button
                      role="checkbox"
                      aria-checked={s.done}
                      aria-label={s.title}
                      className={"check " + (s.done ? "checked can-pop" : "")}
                      disabled={pending || !canWrite}
                      onClick={() => void toggleStep(s)}
                    >
                      {s.done && <Check size={13} />}
                    </button>
                    <span className="step-title">{s.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drawer-hint">No checklist steps.</p>
            )}
          </section>
        </main>

        <aside className="focus-next" aria-labelledby="focus-next-title">
          <h2 id="focus-next-title">Next up</h2>
          {upcoming.length ? (
            <ul>
              {upcoming.map((i) => (
                <li key={i.id}>
                  <button disabled={pending} onClick={() => switchTo(i)}>
                    <span>
                      <strong>{i.title}</strong>
                      <small>
                        {i.due_at ? dateLabel(i.due_at) : "No date"}
                        {i.estimate_minutes &&
                          " · " + minutesLabel(i.estimate_minutes)}
                      </small>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="drawer-hint">No other open tasks.</p>
          )}
        </aside>
      </div>
    </section>,
    document.body,
  );
}
