import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BookOpen, CalendarPlus, Sprout, User, Users } from "lucide-react";
import {
  defaultStarter,
  FIRST_RUN_PURPOSES,
  PURPOSE_LABELS,
  startersFor,
  type FirstRunPurpose,
  type FirstRunResult,
  type StarterId,
  type User as Person,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { useModalFocus } from "../../hooks/useModalFocus";
import { session } from "../../lib/session";
import "./firstrun.css";

const PURPOSE_ICONS = { study: BookOpen, team: Users, personal: User } as const;

/**
 * The guided first run (DSN-02), for a new account: what Orbyn is for
 * (Study, Team or Personal), a calendar to show alongside if you like, and a
 * starter. The starter is a small project with a brief page that links to
 * its other pages, so links and "Linked here" are there from the first day.
 * "Not now" skips it for good.
 */
export function FirstRun({
  user,
  onDone,
}: {
  user: Person;
  /** Finished or skipped; the result opens the brief when there is one. */
  onDone: (user: Person, made: FirstRunResult | null) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [purpose, setPurpose] = useState<FirstRunPurpose>("study");
  const [starter, setStarter] = useState<StarterId>("term");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [calendarNote, setCalendarNote] = useState("");
  const [teamName, setTeamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const account = session.get();
  const latest = useRef({ account, userId: user.id });
  latest.current = { account, userId: user.id };
  const mounted = useRef(true);
  const pending = useRef(false);
  const connectedUrl = useRef("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Escape must not permanently dismiss setup. Only “Not now” does that.
  const modal = useModalFocus(() => {}, busy);
  const run = async (fn: (current: () => boolean) => Promise<void>) => {
    const userId = user.id;
    const current = () =>
      mounted.current &&
      session.get() === account &&
      latest.current.account === account &&
      latest.current.userId === userId;
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn(current);
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const skip = () =>
    run(async (current) => {
      const person = await client.skipFirstRun();
      if (current()) onDone(person, null);
    });
  const connect = () =>
    run(async (current) => {
      const url = calendarUrl.trim();
      if (url && connectedUrl.current !== url) {
        await client.createCalendarSubscription({ url, name: "My calendar" });
        if (!current()) return;
        connectedUrl.current = url;
        setCalendarNote("Calendar connected.");
      }
      if (current()) setStep(2);
    });
  const finish = () =>
    run(async (current) => {
      const made = await client.finishFirstRun({
        purpose,
        starter,
        ...(starter === "sprint" && teamName.trim()
          ? { team_name: teamName.trim() }
          : {}),
      });
      if (current()) onDone(made.user, made);
    });

  const moveChoice = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        'button[role="radio"]:not(:disabled)',
      ),
    );
    if (!buttons.length) return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index +
              (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
              buttons.length) %
            buttons.length;
    buttons[next].click();
    buttons[next].focus();
  };
  const first = user.name.split(" ")[0];
  return (
    <div className="modal-backdrop first-run-backdrop">
      <section
        ref={modal.ref}
        data-modal-owner={modal.id}
        tabIndex={-1}
        className="modal first-run"
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
      >
        <p className="first-run-step" aria-live="polite">
          Step {step + 1} of 3
        </p>
        {step === 0 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Choose a starting point
            </h2>
            <p className="muted">Start with a project, or skip setup.</p>
            <div
              className="first-run-choices"
              onKeyDown={moveChoice}
              role="radiogroup"
              aria-label="What Orbyn is for"
            >
              {FIRST_RUN_PURPOSES.map((p) => {
                const Icon = PURPOSE_ICONS[p];
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={busy}
                    role="radio"
                    aria-checked={purpose === p}
                    tabIndex={purpose === p ? 0 : -1}
                    className={
                      "first-run-choice" + (purpose === p ? " is-on" : "")
                    }
                    onClick={() => {
                      setPurpose(p);
                      setStarter(defaultStarter(p));
                    }}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <strong>{PURPOSE_LABELS[p].name}</strong>
                    <small>{PURPOSE_LABELS[p].blurb}</small>
                  </button>
                );
              })}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Add a calendar
            </h2>
            <p className="muted">
              Add a private .ics link to show its events alongside your plans.
            </p>
            <label className="first-run-field">
              Calendar address
              <input
                disabled={busy}
                type="url"
                inputMode="url"
                value={calendarUrl}
                placeholder="https://…/basic.ics"
                onChange={(e) => setCalendarUrl(e.target.value)}
              />
            </label>
          </>
        )}
        {step === 2 && (
          <>
            <h2 id="first-run-title" ref={heading} tabIndex={-1}>
              Pick a starter
            </h2>
            {calendarNote && <p className="first-run-ok">{calendarNote}</p>}
            <div
              className="first-run-choices is-list"
              onKeyDown={moveChoice}
              role="radiogroup"
              aria-label="Starter"
            >
              {startersFor(purpose).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy}
                  role="radio"
                  aria-checked={starter === s.id}
                  tabIndex={starter === s.id ? 0 : -1}
                  className={
                    "first-run-choice" + (starter === s.id ? " is-on" : "")
                  }
                  onClick={() => setStarter(s.id)}
                >
                  <Sprout size={16} aria-hidden="true" />
                  <strong>{s.name}</strong>
                  <small>{s.blurb}</small>
                </button>
              ))}
            </div>
            {starter === "sprint" && (
              <label className="first-run-field">
                The team's name
                <input
                  disabled={busy}
                  value={teamName}
                  maxLength={80}
                  placeholder={`${first || "My"}'s team`}
                  onChange={(e) => setTeamName(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="first-run-error">
            {error}
          </p>
        )}
        <div className="first-run-foot">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void skip()}
          >
            Not now
          </button>
          <span className="first-run-nav">
            {step > 0 && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setStep((s) => (s - 1) as 0 | 1)}
              >
                Back
              </button>
            )}
            {step === 0 && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Next
              </button>
            )}
            {step === 1 && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void connect()}
              >
                <CalendarPlus size={15} />{" "}
                {calendarUrl.trim() ? "Connect" : "Skip this"}
              </button>
            )}
            {step === 2 && (
              <button
                className="primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                {starter === "none" ? "Start" : "Create starter"}
              </button>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}
